-- LineMap Pro: web admin dashboard support (Phase 2).
--
-- Read-only reporting functions plus invite creation for the web dashboard. Everything here is
-- either SECURITY INVOKER (row level security applies exactly as for a normal query) or
-- SECURITY DEFINER with an explicit role check at the top, using public.has_org_role, before any
-- row is read. search_path is pinned to '' so nothing can hijack object lookups.
--
-- Who can call what:
--   admin_org_members      owner, admin            (shows member email addresses)
--   admin_create_invite    owner, admin            (owner role only by owners; RLS also enforces)
--   admin_overview         every member            (KPI numbers; AI numbers only for manager and up)
--   admin_project_summaries every member           (members can already read every project row)
--   admin_activity         owner, admin, manager   (same rule as the audit_log table)
--   admin_ai_usage         owner, admin, manager   (same rule as reading the whole org's ai_usage)
--   admin_footage_by_tech  owner, admin, manager
--
-- Footage in SQL: span length = ST_Length of the span line (a geography, so the result is in meters
-- on the earth's surface), converted to feet, then sag percent and slack loop added, or the
-- measured override when set. The phone app computes the same thing in src/geo/spans.ts.

-- ---------------------------------------------------------------------------------------------
-- Billable footage of one span row, in feet.
-- ---------------------------------------------------------------------------------------------
create or replace function public.span_billable_ft(
  p_geom extensions.geography,
  p_sag_pct numeric,
  p_slack_ft numeric,
  p_override_ft numeric
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case
    when p_override_ft is not null then p_override_ft::double precision
    when p_geom is null then 0::double precision
    else extensions.st_length(p_geom) * 3.280839895013123
           * (1 + coalesce(p_sag_pct, 0)::double precision / 100)
         + coalesce(p_slack_ft, 0)::double precision
  end;
$$;

revoke execute on function public.span_billable_ft(extensions.geography, numeric, numeric, numeric) from public, anon;
grant execute on function public.span_billable_ft(extensions.geography, numeric, numeric, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Members with email addresses (auth.users is not readable by app users, hence SECURITY DEFINER).
-- last_active_at: latest of sign-in time (when the auth schema records it), field edit (audit
-- log) or AI photo analysis.
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_org_members(p_org uuid)
returns table (
  user_id         uuid,
  email           text,
  full_name       text,
  role            text,
  joined_at       timestamptz,
  invited_by      uuid,
  last_active_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_org_role(p_org, array['owner', 'admin']) then
    raise exception 'Only owners and admins can see member details' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    u.email::text,
    p.full_name,
    m.role,
    m.created_at,
    m.invited_by,
    nullif(greatest(
      coalesce((to_jsonb(u.*) ->> 'last_sign_in_at')::timestamptz, '-infinity'::timestamptz),
      coalesce((select max(a.at) from public.audit_log a where a.org_id = p_org and a.actor = m.user_id), '-infinity'::timestamptz),
      coalesce((select max(x.created_at) from public.ai_usage x where x.org_id = p_org and x.user_id = m.user_id), '-infinity'::timestamptz)
    ), '-infinity'::timestamptz)
  from public.org_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.org_id = p_org
  order by
    case m.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 when 'tech' then 3 else 4 end,
    lower(coalesce(p.full_name, u.email::text));
end;
$$;

revoke execute on function public.admin_org_members(uuid) from public, anon;
grant execute on function public.admin_org_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Invite creation. SECURITY INVOKER: the org_invites insert/delete policies decide (admins and
-- owners only; only owners may invite an owner). Re-inviting the same email replaces the older
-- open invite (the unique index allows one open invite per email), which is how an expired invite
-- is re-sent. Refuses when every seat is already taken, because accepting would fail anyway.
-- ---------------------------------------------------------------------------------------------
-- "Is this email already a member?" needs auth.users, which app users cannot read directly. That
-- one lookup is a tiny definer function (admins and owners only) so the invite function itself can
-- stay SECURITY INVOKER.
create or replace function public.org_has_member_email(p_org uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(p_org, array['owner', 'admin'])
     and exists (
       select 1 from public.org_members m join auth.users u on u.id = m.user_id
       where m.org_id = p_org and lower(u.email) = lower(btrim(p_email))
     );
$$;

create or replace function public.admin_create_invite(p_org uuid, p_email text, p_role text default 'tech')
returns public.org_invites
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := coalesce(p_role, 'tech');
  v_limit integer;
  v_members integer;
  v_row public.org_invites;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if not public.has_org_role(p_org, array['owner', 'admin']) then
    raise exception 'Only owners and admins can invite members' using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'manager', 'tech', 'viewer') then
    raise exception 'Unknown role %', v_role using errcode = '22023';
  end if;
  if v_role = 'owner' and not public.has_org_role(p_org, array['owner']) then
    raise exception 'Only an owner can invite another owner' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;

  -- organizations and org_members are readable by every member under RLS.
  select o.seat_limit into v_limit from public.organizations o where o.id = p_org;
  select count(*) into v_members from public.org_members m where m.org_id = p_org;
  if v_members >= v_limit then
    raise exception 'All % seats are in use. Add seats on the Billing page before inviting.', v_limit
      using errcode = 'P0001';
  end if;
  if public.org_has_member_email(p_org, v_email) then
    raise exception 'That person is already a member' using errcode = '23505';
  end if;

  delete from public.org_invites i
   where i.org_id = p_org and lower(i.email) = v_email and i.accepted_at is null;

  insert into public.org_invites (org_id, email, role, invited_by)
  values (p_org, v_email, v_role, (select auth.uid()))
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.org_has_member_email(uuid, text) from public, anon;
grant execute on function public.org_has_member_email(uuid, text) to authenticated;
revoke execute on function public.admin_create_invite(uuid, text, text) from public, anon;
grant execute on function public.admin_create_invite(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Overview KPIs (one round trip). Weeks start Monday, months on the 1st, both in UTC.
-- AI numbers are null for tech and viewer (they may only see their own usage).
-- "Active techs" = members who added or changed field data in the last 7 days.
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_overview(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_week timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
  v_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_can_ai boolean;
  v_out jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  v_can_ai := public.has_org_role(p_org, array['owner', 'admin', 'manager']);

  select jsonb_build_object(
    'footage_week_ft', coalesce((
      select sum(public.span_billable_ft(s.geom, s.sag_pct, s.slack_ft, s.length_override_ft))
      from public.spans s where s.org_id = p_org and s.deleted_at is null and s.created_at >= v_week), 0),
    'footage_month_ft', coalesce((
      select sum(public.span_billable_ft(s.geom, s.sag_pct, s.slack_ft, s.length_override_ft))
      from public.spans s where s.org_id = p_org and s.deleted_at is null and s.created_at >= v_month), 0),
    'footage_total_ft', coalesce((
      select sum(public.span_billable_ft(s.geom, s.sag_pct, s.slack_ft, s.length_override_ft))
      from public.spans s where s.org_id = p_org and s.deleted_at is null), 0),
    'nodes_total', (select count(*) from public.nodes n where n.org_id = p_org and n.deleted_at is null),
    'nodes_week', (select count(*) from public.nodes n
                   where n.org_id = p_org and n.deleted_at is null and n.created_at >= v_week),
    'projects_active', (select count(*) from public.projects p
                        where p.org_id = p_org and p.deleted_at is null and p.status = 'active'),
    'active_techs_7d', (
      select count(distinct x.uid) from (
        select a.actor as uid from public.audit_log a
         where a.org_id = p_org and a.at >= now() - interval '7 days' and a.actor is not null
        union
        select n.created_by from public.nodes n
         where n.org_id = p_org and n.updated_at >= now() - interval '7 days' and n.created_by is not null
      ) x
      join public.org_members m on m.org_id = p_org and m.user_id = x.uid),
    'members', (select count(*) from public.org_members m where m.org_id = p_org),
    'seat_limit', (select o.seat_limit from public.organizations o where o.id = p_org),
    'ai_quota', (select o.ai_monthly_photo_quota from public.organizations o where o.id = p_org),
    'ai_photos_month', case when v_can_ai then (
      select count(*) from public.ai_usage u
       where u.org_id = p_org and u.created_at >= v_month and u.status <> 'error') else null end,
    'ai_cost_month_usd', case when v_can_ai then (
      select coalesce(sum(u.cost_usd_estimate), 0) from public.ai_usage u
       where u.org_id = p_org and u.created_at >= v_month) else null end,
    'week_start', v_week,
    'month_start', v_month
  ) into v_out;
  return v_out;
end;
$$;

revoke execute on function public.admin_overview(uuid) from public, anon;
grant execute on function public.admin_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- One row per (not deleted) project with node count, footage split and who has worked on it.
-- SECURITY INVOKER: projects, nodes, spans and profiles RLS apply, and every member may read them.
-- editors = members who created nodes or spans in the project, or appear in the audit log for
-- its nodes and spans (the audit log part is only visible to manager and up, by its own RLS).
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_project_summaries(p_org uuid)
returns table (
  id              uuid,
  name            text,
  client          text,
  job_number      text,
  work_type       text,
  status          text,
  created_at      timestamptz,
  last_updated_at timestamptz,
  node_count      bigint,
  span_count      bigint,
  aerial_ft       double precision,
  underground_ft  double precision,
  total_ft        double precision,
  editors         jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with p as (
    select * from public.projects pr
    where pr.org_id = p_org and pr.deleted_at is null
  ),
  n as (
    select nd.project_id, count(*) as cnt, max(nd.updated_at) as last_at
    from public.nodes nd
    where nd.org_id = p_org and nd.deleted_at is null
    group by nd.project_id
  ),
  s as (
    select sp.project_id,
           count(*) as cnt,
           max(sp.updated_at) as last_at,
           sum(public.span_billable_ft(sp.geom, sp.sag_pct, sp.slack_ft, sp.length_override_ft))
             filter (where sp.kind = 'aerial') as aerial_ft,
           sum(public.span_billable_ft(sp.geom, sp.sag_pct, sp.slack_ft, sp.length_override_ft))
             filter (where sp.kind = 'underground') as underground_ft
    from public.spans sp
    where sp.org_id = p_org and sp.deleted_at is null
    group by sp.project_id
  ),
  who as (
    select x.project_id, x.uid from (
      select nd.project_id, nd.created_by as uid from public.nodes nd
       where nd.org_id = p_org and nd.deleted_at is null
      union
      select sp.project_id, sp.created_by from public.spans sp
       where sp.org_id = p_org and sp.deleted_at is null
      union
      select nd.project_id, a.actor from public.audit_log a
       join public.nodes nd on nd.id = a.row_id and nd.org_id = p_org
       where a.org_id = p_org and a.table_name = 'nodes'
      union
      select sp.project_id, a.actor from public.audit_log a
       join public.spans sp on sp.id = a.row_id and sp.org_id = p_org
       where a.org_id = p_org and a.table_name = 'spans'
    ) x
    where x.uid is not null
  ),
  ed as (
    select w.project_id,
           jsonb_agg(jsonb_build_object('user_id', w.uid, 'name', pf.full_name) order by pf.full_name nulls last) as editors
    from who w
    left join public.profiles pf on pf.id = w.uid
    group by w.project_id
  )
  select
    p.id, p.name, p.client, p.job_number, p.work_type, p.status, p.created_at,
    greatest(p.updated_at, n.last_at, s.last_at),
    coalesce(n.cnt, 0), coalesce(s.cnt, 0),
    coalesce(s.aerial_ft, 0), coalesce(s.underground_ft, 0),
    coalesce(s.aerial_ft, 0) + coalesce(s.underground_ft, 0),
    coalesce(ed.editors, '[]'::jsonb)
  from p
  left join n on n.project_id = p.id
  left join s on s.project_id = p.id
  left join ed on ed.project_id = p.id
  order by greatest(p.updated_at, n.last_at, s.last_at) desc;
$$;

revoke execute on function public.admin_project_summaries(uuid) from public, anon;
grant execute on function public.admin_project_summaries(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Recent activity feed: audit log rows with the actor's name and a readable label for the row.
-- SECURITY INVOKER: audit_log RLS limits this to manager and up.
-- p_before_id pages backwards (pass the smallest id of the previous page).
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_activity(p_org uuid, p_limit integer default 30, p_before_id bigint default null)
returns table (
  id            bigint,
  at            timestamptz,
  actor         uuid,
  actor_name    text,
  table_name    text,
  row_id        uuid,
  action        text,
  changed_keys  text[],
  project_id    uuid,
  project_name  text,
  row_label     text,
  node_type     text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    a.id, a.at, a.actor, pf.full_name, a.table_name, a.row_id, a.action,
    case when a.changes is null then null
         else array(select k from jsonb_object_keys(a.changes) k order by k) end,
    coalesce(nd.project_id, sp.project_id, pr.id),
    coalesce(pn.name, ps.name, pr.name),
    case a.table_name
      when 'nodes' then nullif(nd.label, '')
      when 'projects' then pr.name
      else null
    end,
    nd.type
  from public.audit_log a
  left join public.profiles pf on pf.id = a.actor
  left join public.nodes nd on a.table_name = 'nodes' and nd.id = a.row_id
  left join public.spans sp on a.table_name = 'spans' and sp.id = a.row_id
  left join public.projects pr on a.table_name = 'projects' and pr.id = a.row_id
  left join public.projects pn on pn.id = nd.project_id
  left join public.projects ps on ps.id = sp.project_id
  where a.org_id = p_org
    and (p_before_id is null or a.id < p_before_id)
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 200);
$$;

revoke execute on function public.admin_activity(uuid, integer, bigint) from public, anon;
grant execute on function public.admin_activity(uuid, integer, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- AI photo usage per month per member, for the last p_months months (current month included).
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_ai_usage(p_org uuid, p_months integer default 6)
returns table (
  month              date,
  user_id            uuid,
  full_name          text,
  photo_count        bigint,
  error_count        bigint,
  input_tokens       bigint,
  output_tokens      bigint,
  cost_usd_estimate  numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
begin
  if not public.has_org_role(p_org, array['owner', 'admin', 'manager']) then
    raise exception 'Only owners, admins and managers can see the whole team''s AI usage' using errcode = '42501';
  end if;
  v_from := (date_trunc('month', now() at time zone 'utc')
             - make_interval(months => least(greatest(coalesce(p_months, 6), 1), 24) - 1)) at time zone 'utc';

  return query
  select
    date_trunc('month', u.created_at at time zone 'utc')::date,
    u.user_id,
    pf.full_name,
    count(*) filter (where u.status <> 'error'),
    count(*) filter (where u.status = 'error'),
    coalesce(sum(u.input_tokens), 0)::bigint,
    coalesce(sum(u.output_tokens), 0)::bigint,
    coalesce(sum(u.cost_usd_estimate), 0)::numeric
  from public.ai_usage u
  left join public.profiles pf on pf.id = u.user_id
  where u.org_id = p_org and u.created_at >= v_from
  group by 1, 2, 3
  order by 1 desc, 4 desc;
end;
$$;

revoke execute on function public.admin_ai_usage(uuid, integer) from public, anon;
grant execute on function public.admin_ai_usage(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Footage per member per week (by who created the span), last p_weeks weeks.
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_footage_by_tech(p_org uuid, p_weeks integer default 8)
returns table (
  week_start      date,
  user_id         uuid,
  full_name       text,
  aerial_ft       double precision,
  underground_ft  double precision,
  span_count      bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
begin
  if not public.has_org_role(p_org, array['owner', 'admin', 'manager']) then
    raise exception 'Only owners, admins and managers can see footage by tech' using errcode = '42501';
  end if;
  v_from := (date_trunc('week', now() at time zone 'utc')
             - make_interval(weeks => least(greatest(coalesce(p_weeks, 8), 1), 52) - 1)) at time zone 'utc';

  return query
  select
    date_trunc('week', s.created_at at time zone 'utc')::date,
    s.created_by,
    pf.full_name,
    coalesce(sum(public.span_billable_ft(s.geom, s.sag_pct, s.slack_ft, s.length_override_ft))
             filter (where s.kind = 'aerial'), 0),
    coalesce(sum(public.span_billable_ft(s.geom, s.sag_pct, s.slack_ft, s.length_override_ft))
             filter (where s.kind = 'underground'), 0),
    count(*)
  from public.spans s
  left join public.profiles pf on pf.id = s.created_by
  where s.org_id = p_org and s.deleted_at is null and s.created_at >= v_from
  group by 1, 2, 3
  order by 1 desc, 2;
end;
$$;

revoke execute on function public.admin_footage_by_tech(uuid, integer) from public, anon;
grant execute on function public.admin_footage_by_tech(uuid, integer) to authenticated;
