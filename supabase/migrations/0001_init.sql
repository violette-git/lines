-- LineMap Pro: initial multi-tenant schema (Phase 1).
--
-- Tenancy model: every business row carries org_id. Row Level Security (RLS) policies only ever
-- compare org_id against the caller's own memberships, so no policy can reach another org's rows.
-- Child rows (nodes, spans, photos) also use composite foreign keys (org_id, parent_id) so a row
-- can never point at a parent that lives in a different org, even if a policy were wrong.
--
-- Sync model (used by Phase 2 push/pull, designed now):
--   updated_at         server clock, set by trigger on every write
--   client_updated_at  device clock at the moment of the edit, used for last-write-wins
--   rev                global, monotonically increasing counter, set by trigger; pull cursor
--   deleted_at         soft delete (tombstone) so other devices learn about deletions
--
-- Supabase specifics assumed: schemas auth and storage exist, auth.uid() and auth.jwt() exist,
-- roles anon, authenticated and service_role exist (service_role bypasses RLS).

-- ---------------------------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------------------------
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Shared sequence for sync revisions
-- ---------------------------------------------------------------------------------------------
create sequence if not exists public.sync_rev_seq as bigint;

-- ---------------------------------------------------------------------------------------------
-- Organizations and membership
-- ---------------------------------------------------------------------------------------------
create table public.organizations (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(btrim(name)) between 1 and 120),
  slug                    text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  plan                    text not null default 'trial'
                            check (plan in ('trial', 'starter', 'pro', 'enterprise')),
  seat_limit              integer not null default 3 check (seat_limit >= 1),
  ai_monthly_photo_quota  integer not null default 50 check (ai_monthly_photo_quota >= 0),
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  subscription_status     text not null default 'trialing'
                            check (subscription_status in ('trialing', 'active', 'past_due', 'canceled',
                              'incomplete', 'incomplete_expired', 'unpaid', 'paused')),
  trial_ends_at           timestamptz default (now() + interval '14 days'),
  -- Timestamp (Stripe event "created") of the last billing event applied. Older events are ignored
  -- so out-of-order webhook delivery cannot roll a subscription back.
  stripe_event_at         timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.organizations is 'A customer company (tenant). Billing columns are written only by the Stripe webhook (service role).';

create table public.org_members (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'admin', 'manager', 'tech', 'viewer')),
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on public.org_members (user_id);

create table public.org_invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  email        text not null check (email ~ '^[^@\s]+@[^@\s]+$'),
  role         text not null default 'tech' check (role in ('owner', 'admin', 'manager', 'tech', 'viewer')),
  token        text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by   uuid references auth.users (id) on delete set null,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
-- One open invite per email per org.
create unique index org_invites_open_email_idx
  on public.org_invites (org_id, lower(email)) where accepted_at is null;

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Helper functions for RLS. SECURITY DEFINER so they can read org_members without recursing into
-- org_members' own policies; search_path is pinned to '' so nothing can hijack object lookups.
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.org_role(org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.org_members m
  where m.org_id = org and m.user_id = (select auth.uid());
$$;

create or replace function public.has_org_role(org uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = org and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

-- Safe uuid parse (used by storage policies on user-supplied object paths).
create or replace function public.try_uuid(t text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t::uuid
    else null
  end;
$$;

revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.org_role(uuid) from public, anon;
revoke execute on function public.has_org_role(uuid, text[]) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.org_role(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.try_uuid(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Field data: client templates, projects, nodes, spans, photos
-- ---------------------------------------------------------------------------------------------
create table public.client_templates (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  name               text not null default '',
  client             text not null default '',
  label_patterns     jsonb not null default '{}'::jsonb,
  required_fields    jsonb not null default '{}'::jsonb,
  defaults           jsonb not null default '{}'::jsonb,
  default_span_kind  text not null default 'aerial' check (default_span_kind in ('aerial', 'underground')),
  default_sag_pct    numeric(6, 2) not null default 2 check (default_sag_pct >= 0 and default_sag_pct <= 100),
  default_slack_ft   numeric(10, 2) not null default 0 check (default_slack_ft >= 0),
  rate_per_foot      numeric(12, 4),
  rate_per_node      numeric(12, 4),
  watermark_photos   boolean not null default true,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  rev                bigint not null default 0,
  unique (org_id, id)
);

create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  name               text not null default '',
  client             text not null default '',
  job_number         text not null default '',
  work_type          text not null default 'aerial' check (work_type in ('aerial', 'underground', 'mixed', 'qc')),
  notes              text not null default '',
  status             text not null default 'active' check (status in ('active', 'complete', 'archived')),
  rate_per_foot      numeric(12, 4),
  rate_per_node      numeric(12, 4),
  template_id        uuid,
  walk_mode          boolean not null default false,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  rev                bigint not null default 0,
  unique (org_id, id),
  foreign key (org_id, template_id) references public.client_templates (org_id, id)
    on delete set null (template_id)
);

create table public.nodes (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations (id) on delete cascade,
  project_id             uuid not null,
  seq                    integer not null default 0,
  type                   text not null check (type in ('pole', 'handhole', 'vault', 'pedestal', 'splice_case',
                           'riser', 'anchor', 'building_entry', 'custom')),
  label                  text not null default '',
  -- GeoFix, flattened. lat/lng are the source of truth; geom is derived from them.
  lat                    double precision not null check (lat between -90 and 90),
  lng                    double precision not null check (lng between -180 and 180),
  accuracy_m             double precision,
  altitude_m             double precision,
  gps_samples            integer not null default 0,
  position_captured_at   timestamptz,
  position_source        text not null default 'manual' check (position_source in ('gps', 'gps_avg', 'manual', 'external')),
  position_extra         jsonb not null default '{}'::jsonb,
  geom                   extensions.geography(Point, 4326)
                           generated always as (
                             extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
                           ) stored,
  fields                 jsonb not null default '{}'::jsonb,
  ai_meta                jsonb not null default '{}'::jsonb,
  icon_scale             numeric(4, 2) not null default 1 check (icon_scale between 0.5 and 3),
  status                 text not null default 'draft'
                           check (status in ('draft', 'ai_pending', 'ai_done', 'ai_failed', 'reviewed')),
  notes                  text not null default '',
  possible_duplicate_of  uuid,
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  client_updated_at      timestamptz not null default now(),
  deleted_at             timestamptz,
  rev                    bigint not null default 0,
  unique (org_id, id),
  foreign key (org_id, project_id) references public.projects (org_id, id) on delete cascade,
  foreign key (org_id, possible_duplicate_of) references public.nodes (org_id, id)
    on delete set null (possible_duplicate_of)
);

create table public.spans (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  project_id          uuid not null,
  from_node_id        uuid not null,
  to_node_id          uuid not null,
  kind                text not null default 'aerial' check (kind in ('aerial', 'underground')),
  slack_ft            numeric(10, 2) not null default 0 check (slack_ft >= 0),
  sag_pct             numeric(6, 2) not null default 0 check (sag_pct >= 0 and sag_pct <= 100),
  length_override_ft  numeric(12, 2) check (length_override_ft is null or length_override_ft >= 0),
  fields              jsonb not null default '{}'::jsonb,
  -- Maintained by triggers from the two node positions.
  geom                extensions.geography(LineString, 4326),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  client_updated_at   timestamptz not null default now(),
  deleted_at          timestamptz,
  rev                 bigint not null default 0,
  unique (org_id, id),
  check (from_node_id <> to_node_id),
  foreign key (org_id, project_id) references public.projects (org_id, id) on delete cascade,
  foreign key (org_id, from_node_id) references public.nodes (org_id, id) on delete cascade,
  foreign key (org_id, to_node_id) references public.nodes (org_id, id) on delete cascade
);

create table public.photos (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  project_id         uuid not null,
  node_id            uuid not null,
  -- Object path inside the private 'photos' bucket: <org_id>/<project_id>/<photo_id>.jpg
  storage_path       text,
  -- Watermarked copy, same folder: <org_id>/<project_id>/<photo_id>_wm.jpg
  watermarked_path   text,
  width              integer not null default 0 check (width >= 0),
  height             integer not null default 0 check (height >= 0),
  taken_at           timestamptz not null default now(),
  fix                jsonb,
  is_primary         boolean not null default false,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  rev                bigint not null default 0,
  unique (org_id, id),
  foreign key (org_id, project_id) references public.projects (org_id, id) on delete cascade,
  foreign key (org_id, node_id) references public.nodes (org_id, id) on delete cascade,
  -- Paths must live under this row's org/project folder.
  check (storage_path is null or storage_path like org_id::text || '/' || project_id::text || '/%'),
  check (watermarked_path is null or watermarked_path like org_id::text || '/' || project_id::text || '/%')
);

-- Indexes
create index client_templates_org_rev_idx on public.client_templates (org_id, rev);
create index projects_org_rev_idx on public.projects (org_id, rev);
create index projects_org_updated_idx on public.projects (org_id, updated_at);
create index projects_template_idx on public.projects (template_id);
create index nodes_org_rev_idx on public.nodes (org_id, rev);
create index nodes_project_updated_idx on public.nodes (project_id, updated_at);
create index nodes_project_seq_idx on public.nodes (project_id, seq);
create index nodes_geom_gix on public.nodes using gist (geom);
create index spans_org_rev_idx on public.spans (org_id, rev);
create index spans_project_updated_idx on public.spans (project_id, updated_at);
create index spans_from_idx on public.spans (from_node_id);
create index spans_to_idx on public.spans (to_node_id);
create index spans_geom_gix on public.spans using gist (geom);
create index photos_org_rev_idx on public.photos (org_id, rev);
create index photos_project_updated_idx on public.photos (project_id, updated_at);
create index photos_node_idx on public.photos (node_id);

-- ---------------------------------------------------------------------------------------------
-- AI usage metering
-- ---------------------------------------------------------------------------------------------
create table public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  user_id            uuid references auth.users (id) on delete set null,
  -- Plain uuids, intentionally NOT foreign keys: in Phase 1 projects and nodes live only on the
  -- device, so the server may not have these rows yet.
  project_id         uuid,
  node_id            uuid,
  model              text not null,
  status             text not null default 'reserved' check (status in ('reserved', 'ok', 'error')),
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cost_usd_estimate  numeric(12, 6) not null default 0,
  image_bytes        integer,
  latency_ms         integer,
  error              text,
  created_at         timestamptz not null default now()
);
create index ai_usage_org_created_idx on public.ai_usage (org_id, created_at);
create index ai_usage_user_idx on public.ai_usage (user_id, created_at);

-- security_invoker: the view runs with the caller's permissions, so RLS on ai_usage still applies.
create view public.ai_usage_monthly
with (security_invoker = true)
as
select
  u.org_id,
  date_trunc('month', u.created_at at time zone 'utc')::date as month,
  count(*) filter (where u.status <> 'error')                as photo_count,
  count(*) filter (where u.status = 'error')                 as error_count,
  coalesce(sum(u.input_tokens), 0)::bigint                   as input_tokens,
  coalesce(sum(u.output_tokens), 0)::bigint                  as output_tokens,
  coalesce(sum(u.cost_usd_estimate), 0)::numeric(14, 6)      as cost_usd_estimate
from public.ai_usage u
group by u.org_id, date_trunc('month', u.created_at at time zone 'utc');

-- Atomic quota check + reservation, called only by the analyze-photo Edge Function (service role).
-- Locks the org row so two simultaneous requests cannot both slip under the quota.
create or replace function public.ai_reserve_usage(
  p_org_id uuid,
  p_user_id uuid,
  p_model text,
  p_project_id uuid default null,
  p_node_id uuid default null,
  p_image_bytes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quota integer;
  v_used integer;
  v_id uuid;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
begin
  select o.ai_monthly_photo_quota into v_quota
  from public.organizations o where o.id = p_org_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_org');
  end if;

  select count(*) into v_used
  from public.ai_usage u
  where u.org_id = p_org_id and u.created_at >= v_month_start and u.status <> 'error';

  if v_used >= v_quota then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'used', v_used, 'quota', v_quota);
  end if;

  insert into public.ai_usage (org_id, user_id, project_id, node_id, model, status, image_bytes)
  values (p_org_id, p_user_id, p_project_id, p_node_id, p_model, 'reserved', p_image_bytes)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'usage_id', v_id, 'used', v_used + 1, 'quota', v_quota);
end;
$$;

revoke execute on function public.ai_reserve_usage(uuid, uuid, text, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_reserve_usage(uuid, uuid, text, uuid, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Billing webhook idempotency (service role only)
-- ---------------------------------------------------------------------------------------------
create table public.billing_events (
  id           text primary key,          -- Stripe event id (evt_...)
  type         text not null,
  org_id       uuid references public.organizations (id) on delete set null,
  received_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  table_name  text not null,
  row_id      uuid not null,
  action      text not null check (action in ('insert', 'update', 'delete', 'soft_delete', 'restore')),
  actor       uuid,
  changes     jsonb,
  at          timestamptz not null default now()
);
create index audit_log_org_at_idx on public.audit_log (org_id, at desc);
create index audit_log_row_idx on public.audit_log (row_id);

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

-- Generic sync stamping for templates, projects, nodes, spans, photos.
--  * insert: created_by = caller, rev = next value, updated_at = now()
--  * update: last-write-wins (an edit made earlier on a device than the stored one is skipped
--            silently), org_id / created_by / created_at are immutable, then re-stamp.
create or replace function public.tg_sync_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.created_by := v_uid;
    end if;
    new.created_at := coalesce(new.created_at, now());
    new.client_updated_at := coalesce(new.client_updated_at, now());
  else
    if new.client_updated_at is not null and old.client_updated_at is not null
       and new.client_updated_at < old.client_updated_at then
      return null;  -- stale write from an older edit: keep the newer stored row
    end if;
    if new.org_id is distinct from old.org_id then
      raise exception 'org_id cannot be changed' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.client_updated_at := coalesce(new.client_updated_at, old.client_updated_at);
  end if;
  new.updated_at := now();
  new.rev := nextval('public.sync_rev_seq');
  return new;
end;
$$;

-- Simple updated_at for non-synced tables.
create or replace function public.tg_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Span geometry from its two nodes.
create or replace function public.tg_span_geom()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select extensions.st_makeline(a.geom::extensions.geometry, b.geom::extensions.geometry)::extensions.geography
    into new.geom
  from public.nodes a, public.nodes b
  where a.id = new.from_node_id and b.id = new.to_node_id;
  return new;
end;
$$;

-- When a node moves, refresh the geometry of every span touching it. SECURITY DEFINER so a
-- moving node always updates its spans even if a policy would hide them from the caller
-- (they are in the same org by construction, so this crosses no tenant boundary).
create or replace function public.tg_node_moved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.spans s
     set geom = extensions.st_makeline(a.geom::extensions.geometry, b.geom::extensions.geometry)::extensions.geography
    from public.nodes a, public.nodes b
   where (s.from_node_id = new.id or s.to_node_id = new.id)
     and a.id = s.from_node_id and b.id = s.to_node_id;
  return null;
end;
$$;

-- Lightweight audit trail: who changed which columns.
create or replace function public.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_changes jsonb;
  v_old jsonb;
  v_new jsonb;
  v_row public.audit_log.row_id%type;
  v_org uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'insert';
    v_row := new.id; v_org := new.org_id;
    v_changes := null;
  elsif tg_op = 'DELETE' then
    -- Whole org being deleted (cascade): nothing to audit into.
    if not exists (select 1 from public.organizations o where o.id = old.org_id) then
      return null;
    end if;
    v_action := 'delete';
    v_row := old.id; v_org := old.org_id;
    v_changes := null;
  else
    v_row := new.id; v_org := new.org_id;
    v_old := to_jsonb(old) - array['rev', 'updated_at', 'client_updated_at', 'geom'];
    v_new := to_jsonb(new) - array['rev', 'updated_at', 'client_updated_at', 'geom'];
    select jsonb_object_agg(n.key, n.value) into v_changes
    from jsonb_each(v_new) n
    where v_old -> n.key is distinct from n.value;
    if v_changes is null then
      return null;  -- nothing meaningful changed (e.g. span geometry refresh)
    end if;
    if old.deleted_at is null and new.deleted_at is not null then
      v_action := 'soft_delete';
    elsif old.deleted_at is not null and new.deleted_at is null then
      v_action := 'restore';
    else
      v_action := 'update';
    end if;
  end if;

  insert into public.audit_log (org_id, table_name, row_id, action, actor, changes)
  values (v_org, tg_table_name, v_row, v_action, (select auth.uid()), v_changes);
  return null;
end;
$$;

-- Profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), ''),
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Seat limit and last-owner protection on org_members.
create or replace function public.tg_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
  v_owners integer;
begin
  if tg_op = 'INSERT' then
    select o.seat_limit into v_limit from public.organizations o where o.id = new.org_id for update;
    select count(*) into v_count from public.org_members m where m.org_id = new.org_id;
    if v_count >= v_limit then
      raise exception 'Seat limit reached (% of % seats used). Upgrade the plan to add members.', v_count, v_limit
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- UPDATE or DELETE that removes an owner: make sure another owner remains.
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    perform 1 from public.organizations o where o.id = old.org_id for update;
    select count(*) into v_owners from public.org_members m
     where m.org_id = old.org_id and m.role = 'owner';
    -- When the whole org is being deleted (cascade), the org row is already gone: allow.
    if v_owners <= 1 and exists (select 1 from public.organizations o where o.id = old.org_id) then
      raise exception 'An organization must keep at least one owner' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.org_id <> old.org_id or new.user_id <> old.user_id then
    raise exception 'Membership org/user cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger t10_sync_stamp before insert or update on public.client_templates
  for each row execute function public.tg_sync_stamp();
create trigger t10_sync_stamp before insert or update on public.projects
  for each row execute function public.tg_sync_stamp();
create trigger t10_sync_stamp before insert or update on public.nodes
  for each row execute function public.tg_sync_stamp();
create trigger t10_sync_stamp before insert or update on public.spans
  for each row execute function public.tg_sync_stamp();
create trigger t10_sync_stamp before insert or update on public.photos
  for each row execute function public.tg_sync_stamp();

create trigger t20_span_geom before insert or update of from_node_id, to_node_id on public.spans
  for each row execute function public.tg_span_geom();
create trigger t20_node_moved after update of lat, lng on public.nodes
  for each row when (old.lat is distinct from new.lat or old.lng is distinct from new.lng)
  execute function public.tg_node_moved();

create trigger t90_audit after insert or update or delete on public.projects
  for each row execute function public.tg_audit();
create trigger t90_audit after insert or update or delete on public.nodes
  for each row execute function public.tg_audit();
create trigger t90_audit after insert or update or delete on public.spans
  for each row execute function public.tg_audit();

create trigger t10_touch before update on public.organizations
  for each row execute function public.tg_touch_updated_at();
create trigger t10_touch before update on public.profiles
  for each row execute function public.tg_touch_updated_at();

create trigger t10_members_guard before insert or update or delete on public.org_members
  for each row execute function public.tg_members_guard();

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- RPCs callable by signed-in users
-- ---------------------------------------------------------------------------------------------

-- Creates an org and makes the caller its owner, in one transaction.
create or replace function public.create_organization(name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(name, ''));
  v_base text;
  v_slug text;
  v_org uuid;
  v_owned integer;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if length(v_name) < 1 or length(v_name) > 120 then
    raise exception 'Organization name must be 1 to 120 characters' using errcode = '22023';
  end if;

  -- Free-trial abuse guard: one user can own at most 3 organizations.
  select count(*) into v_owned from public.org_members m where m.user_id = v_uid and m.role = 'owner';
  if v_owned >= 3 then
    raise exception 'You already own the maximum number of organizations' using errcode = 'P0001';
  end if;

  v_base := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_base := left(coalesce(nullif(v_base, ''), 'org'), 48);
  if length(v_base) < 2 then
    v_base := v_base || '-org';
  end if;
  v_slug := v_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_slug := v_base || '-' || substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6);
  end loop;

  insert into public.organizations (name, slug) values (v_name, v_slug) returning id into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org, v_uid, 'owner');
  return v_org;
end;
$$;

-- Accepts an invite addressed to the caller's email. Returns the org id.
create or replace function public.accept_invite(token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_inv public.org_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_inv from public.org_invites i
   where i.token = accept_invite.token
   for update;

  if not found or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'Invite is invalid, already used, or expired' using errcode = 'P0002';
  end if;
  if lower(v_inv.email) <> v_email then
    raise exception 'This invite was sent to a different email address' using errcode = '42501';
  end if;

  if exists (select 1 from public.org_members m where m.org_id = v_inv.org_id and m.user_id = v_uid) then
    -- Already a member: do not change the existing role, just close the invite.
    null;
  else
    insert into public.org_members (org_id, user_id, role, invited_by)
    values (v_inv.org_id, v_uid, v_inv.role, v_inv.invited_by);
  end if;

  update public.org_invites set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.org_id;
end;
$$;

revoke execute on function public.create_organization(text) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;

-- Trigger functions are not meant to be called directly.
revoke execute on function public.tg_sync_stamp() from public, anon, authenticated;
revoke execute on function public.tg_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.tg_span_geom() from public, anon, authenticated;
revoke execute on function public.tg_node_moved() from public, anon, authenticated;
revoke execute on function public.tg_audit() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tg_members_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Table privileges. Anonymous (signed-out) callers get nothing. Signed-in users get only what
-- the policies below allow. Billing columns on organizations are not updatable by users at all.
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke all on public.organizations from authenticated;
grant select on public.organizations to authenticated;
grant update (name, slug) on public.organizations to authenticated;

revoke all on public.ai_usage, public.billing_events, public.audit_log from authenticated;
grant select on public.ai_usage, public.audit_log to authenticated;
grant select on public.ai_usage_monthly to authenticated;

revoke all on public.org_members, public.org_invites, public.profiles from authenticated;
grant select, update (role), delete on public.org_members to authenticated;
grant select, insert, delete on public.org_invites to authenticated;
grant select, update (full_name, phone) on public.profiles to authenticated;

revoke all on public.client_templates, public.projects, public.nodes, public.spans, public.photos from authenticated;
grant select, insert, update, delete on public.client_templates, public.projects, public.nodes, public.spans, public.photos to authenticated;
-- created_by, created_at, rev, updated_at are forced by triggers regardless of what is sent.

grant usage on sequence public.sync_rev_seq to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------
alter table public.organizations    enable row level security;
alter table public.org_members      enable row level security;
alter table public.org_invites      enable row level security;
alter table public.profiles         enable row level security;
alter table public.client_templates enable row level security;
alter table public.projects         enable row level security;
alter table public.nodes            enable row level security;
alter table public.spans            enable row level security;
alter table public.photos           enable row level security;
alter table public.ai_usage         enable row level security;
alter table public.billing_events   enable row level security;
alter table public.audit_log        enable row level security;

-- organizations: members read; admins/owners rename (only name/slug are grantable, see above).
-- No insert policy (use create_organization), no delete policy (contact support).
create policy org_select on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy org_update on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']))
  with check (public.has_org_role(id, array['owner', 'admin']));

-- org_members: members see who is in their org. New members join only through
-- create_organization or accept_invite (no direct insert, so nobody can be added without consent).
-- Admins/owners change roles and remove members, but only an owner may create, change or remove an
-- owner. Anyone may leave (delete own row); the last owner cannot leave (trigger).
create policy members_select on public.org_members
  for select to authenticated using (public.is_org_member(org_id));
create policy members_update on public.org_members
  for update to authenticated
  using (
    public.has_org_role(org_id, array['owner', 'admin'])
    and (role <> 'owner' or public.has_org_role(org_id, array['owner']))
  )
  with check (
    public.has_org_role(org_id, array['owner', 'admin'])
    and (role <> 'owner' or public.has_org_role(org_id, array['owner']))
  );
create policy members_delete on public.org_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (
      public.has_org_role(org_id, array['owner', 'admin'])
      and (role <> 'owner' or public.has_org_role(org_id, array['owner']))
    )
  );

-- org_invites: only admins/owners see (tokens are secrets) and manage. Only owners invite owners.
create policy invites_select on public.org_invites
  for select to authenticated using (public.has_org_role(org_id, array['owner', 'admin']));
create policy invites_insert on public.org_invites
  for insert to authenticated
  with check (
    public.has_org_role(org_id, array['owner', 'admin'])
    and (role <> 'owner' or public.has_org_role(org_id, array['owner']))
    and invited_by = (select auth.uid())
    and accepted_at is null
    and accepted_by is null
  );
create policy invites_delete on public.org_invites
  for delete to authenticated using (public.has_org_role(org_id, array['owner', 'admin']));

-- profiles: you edit your own; you can read your own and those of people who share an org with you.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.org_members mine
      join public.org_members theirs on theirs.org_id = mine.org_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- client_templates and projects: members read; manager and up write.
create policy templates_select on public.client_templates
  for select to authenticated using (public.is_org_member(org_id));
create policy templates_insert on public.client_templates
  for insert to authenticated with check (public.has_org_role(org_id, array['owner', 'admin', 'manager']));
create policy templates_update on public.client_templates
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'admin', 'manager']));
create policy templates_delete on public.client_templates
  for delete to authenticated using (public.has_org_role(org_id, array['owner', 'admin', 'manager']));

create policy projects_select on public.projects
  for select to authenticated using (public.is_org_member(org_id));
create policy projects_insert on public.projects
  for insert to authenticated with check (public.has_org_role(org_id, array['owner', 'admin', 'manager']));
create policy projects_update on public.projects
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'admin', 'manager']));
create policy projects_delete on public.projects
  for delete to authenticated using (public.has_org_role(org_id, array['owner', 'admin', 'manager']));

-- nodes, spans, photos: members read; tech and up insert/update (including soft delete via
-- deleted_at); manager and up hard delete.
create policy nodes_select on public.nodes
  for select to authenticated using (public.is_org_member(org_id));
create policy nodes_insert on public.nodes
  for insert to authenticated with check (public.has_org_role(org_id, array['owner', 'admin', 'manager', 'tech']));
create policy nodes_update on public.nodes
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin', 'manager', 'tech']))
  with check (public.has_org_role(org_id, array['owner', 'admin', 'manager', 'tech']));
create policy nodes_delete on public.nodes
  for delete to authenticated using (public.has_org_role(org_id, array['owner', 'admin', 'manager']));

create policy spans_select on public.spans
  for select to authenticated using (public.is_org_member(org_id));
create policy spans_insert on public.spans
  for insert to authenticated with check (public.has_org_role(org_id, array['owner', 'admin', 'manager', 'tech']));
create policy spans_update on public.spans
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin', 'manager', 'tech']))
  with check (public.has_org_role(org_id, array['owner', 'admin', 'manager', 'tech']));
create policy spans_delete on public.spans
  for delete to authenticated using (public.has_org_role(org_id, array['owner', 'admin', 'manager']));

create policy photos_select on public.photos
  for select to authenticated using (public.is_org_member(org_id));
create policy photos_insert on public.photos
  for insert to authenticated with check (public.has_org_role(org_id, array['owner', 'admin', 'manager', 'tech']));
create policy photos_update on public.photos
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin', 'manager', 'tech']))
  with check (public.has_org_role(org_id, array['owner', 'admin', 'manager', 'tech']));
create policy photos_delete on public.photos
  for delete to authenticated using (public.has_org_role(org_id, array['owner', 'admin', 'manager']));

-- ai_usage: managers and up see the org's usage; everyone sees their own. No insert/update/delete
-- policies: only the service role (Edge Function) writes, and it bypasses RLS.
create policy ai_usage_select on public.ai_usage
  for select to authenticated
  using (
    public.has_org_role(org_id, array['owner', 'admin', 'manager'])
    or (user_id = (select auth.uid()) and public.is_org_member(org_id))
  );

-- audit_log: managers and up read; written only by the audit trigger.
create policy audit_select on public.audit_log
  for select to authenticated using (public.has_org_role(org_id, array['owner', 'admin', 'manager']));

-- billing_events: RLS on, no policies, so only the service role can touch it.

-- ---------------------------------------------------------------------------------------------
-- Storage: private 'photos' bucket. Object path: <org_id>/<project_id>/<photo_id>.jpg
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 15728640, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy photos_bucket_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and public.is_org_member(public.try_uuid(split_part(name, '/', 1)))
  );

create policy photos_bucket_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and array_length(string_to_array(name, '/'), 1) = 3
    and public.try_uuid(split_part(name, '/', 2)) is not null
    and public.has_org_role(public.try_uuid(split_part(name, '/', 1)), array['owner', 'admin', 'manager', 'tech'])
  );

create policy photos_bucket_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'photos'
    and public.has_org_role(public.try_uuid(split_part(name, '/', 1)), array['owner', 'admin', 'manager', 'tech'])
  )
  with check (
    bucket_id = 'photos'
    and array_length(string_to_array(name, '/'), 1) = 3
    and public.try_uuid(split_part(name, '/', 2)) is not null
    and public.has_org_role(public.try_uuid(split_part(name, '/', 1)), array['owner', 'admin', 'manager', 'tech'])
  );

create policy photos_bucket_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and public.has_org_role(public.try_uuid(split_part(name, '/', 1)), array['owner', 'admin', 'manager'])
  );
