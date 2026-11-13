-- LineMap Pro: in-app account deletion (Phase 2).
--
-- Apple and Google require apps that create accounts to let people delete them from inside the
-- app. Deleting an account removes the person's login, profile and memberships. Company data
-- (projects, nodes, photos) stays with the company; rows they created keep existing with
-- created_by set to null.
--
-- Rules (mirrored for display in src/backend/accountDeletion.ts, enforced here):
--   leave                     not the only owner: the person just leaves the company
--   sole_owner_with_members   only owner while others are members: BLOCKED, promote another owner
--   sole_member_subscribed    only member, but a Stripe subscription is still live: BLOCKED,
--                             cancel it on the website first so billing stops
--   sole_member               only member: the company is deleted too, only with explicit consent
--
-- Flow: the app calls the delete-account Edge Function with the user's login ticket. The function
-- calls delete_account_prepare() with the service role, then deletes the login with
-- auth.admin.deleteUser(). The membership rows have to go first: the last-owner guard on
-- org_members would otherwise stop the cascade from the auth.users delete.

-- Pure decision, same as membershipStatus() in the app.
create or replace function public.account_deletion_status(
  p_role text,
  p_owner_count integer,
  p_member_count integer,
  p_has_subscription boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_role <> 'owner' or p_owner_count > 1 then 'leave'
    when p_member_count > 1 then 'sole_owner_with_members'
    when coalesce(p_has_subscription, false) then 'sole_member_subscribed'
    else 'sole_member'
  end;
$$;

-- Every membership of one user with owner and member counts. Service role only (takes any user id).
create or replace function public.account_memberships(p_user_id uuid)
returns table (
  org_id uuid,
  org_name text,
  role text,
  owner_count integer,
  member_count integer,
  has_subscription boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.org_id,
    o.name,
    m.role,
    (select count(*) from public.org_members x where x.org_id = m.org_id and x.role = 'owner')::integer,
    (select count(*) from public.org_members x where x.org_id = m.org_id)::integer,
    (o.stripe_subscription_id is not null
      and o.subscription_status not in ('canceled', 'incomplete_expired'))
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  where m.user_id = p_user_id
  order by o.name, m.org_id;
$$;

-- What deleting my account would do, for the signed-in caller only.
create or replace function public.account_deletion_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'org_id', a.org_id,
      'org_name', a.org_name,
      'role', a.role,
      'owner_count', a.owner_count,
      'member_count', a.member_count,
      'has_subscription', a.has_subscription,
      'status', public.account_deletion_status(a.role, a.owner_count, a.member_count, a.has_subscription)
    ) order by a.org_name, a.org_id)
    from public.account_memberships(v_uid) a
  ), '[]'::jsonb);
end;
$$;

-- Removes everything about the user except the login itself, or reports what blocks it.
-- Returns { ok: true, deleted_orgs: [...], left_orgs: [...] }
--      or { ok: false, blocked: [{ org_id, org_name, reason, other_members }] } (nothing changed).
-- Service role only: the Edge Function passes the id from the verified login ticket.
create or replace function public.delete_account_prepare(p_user_id uuid, p_delete_sole_orgs boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_status text;
  v_blocked jsonb := '[]'::jsonb;
  v_deleted jsonb := '[]'::jsonb;
  v_left jsonb := '[]'::jsonb;
  v_delete_ids uuid[] := '{}';
  v_email text;
begin
  if p_user_id is null then
    raise exception 'A user id is required' using errcode = '22023';
  end if;

  -- Lock the user's companies (in a fixed order, so two requests cannot deadlock) so nobody can
  -- join, leave or change roles between the check and the delete. The seat and owner guards on
  -- org_members take the same lock.
  perform 1
    from public.organizations o
   where o.id in (select m.org_id from public.org_members m where m.user_id = p_user_id)
   order by o.id
     for update;

  for r in select * from public.account_memberships(p_user_id) loop
    v_status := public.account_deletion_status(r.role, r.owner_count, r.member_count, r.has_subscription);
    if v_status = 'leave' then
      v_left := v_left || jsonb_build_object('org_id', r.org_id, 'org_name', r.org_name);
    elsif v_status = 'sole_owner_with_members' then
      v_blocked := v_blocked || jsonb_build_object('org_id', r.org_id, 'org_name', r.org_name,
        'reason', 'sole_owner_with_members', 'other_members', r.member_count - 1);
    elsif v_status = 'sole_member_subscribed' then
      v_blocked := v_blocked || jsonb_build_object('org_id', r.org_id, 'org_name', r.org_name,
        'reason', 'active_subscription', 'other_members', 0);
    elsif p_delete_sole_orgs then
      v_delete_ids := v_delete_ids || r.org_id;
      v_deleted := v_deleted || jsonb_build_object('org_id', r.org_id, 'org_name', r.org_name);
    else
      v_blocked := v_blocked || jsonb_build_object('org_id', r.org_id, 'org_name', r.org_name,
        'reason', 'sole_member_needs_consent', 'other_members', 0);
    end if;
  end loop;

  if jsonb_array_length(v_blocked) > 0 then
    return jsonb_build_object('ok', false, 'blocked', v_blocked);
  end if;

  -- Companies where the user was the only member: delete them and (by cascade) all their data.
  delete from public.organizations o where o.id = any (v_delete_ids);

  -- Leave every other company. Their data stays with the company.
  delete from public.org_members m where m.user_id = p_user_id;

  -- Personal data held in invites: drop open invites to this person, redact accepted ones.
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is not null then
    delete from public.org_invites i where i.accepted_at is null and lower(i.email) = lower(v_email);
  end if;
  update public.org_invites i set email = 'deleted-user@deleted.invalid' where i.accepted_by = p_user_id;

  delete from public.profiles p where p.id = p_user_id;

  -- Supabase refuses to delete a login that still owns storage objects. Photos belong to the
  -- company, so clear the owner marker instead of deleting them. Done defensively because the
  -- storage table's columns differ between Supabase versions.
  begin
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner') then
      execute 'update storage.objects set owner = null where owner = $1' using p_user_id;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
      execute 'update storage.objects set owner_id = null where owner_id = $1' using p_user_id::text;
    end if;
  exception when others then
    raise warning 'delete_account_prepare: could not clear storage owner for %: %', p_user_id, sqlerrm;
  end;

  return jsonb_build_object('ok', true, 'deleted_orgs', v_deleted, 'left_orgs', v_left);
end;
$$;

-- When a login is deleted, "created_by ... on delete set null" runs as an UPDATE on the synced
-- tables, but tg_sync_stamp (0001) keeps created_by immutable and silently puts the old id back,
-- leaving a dangling user id. This extra BEFORE trigger runs after t10_sync_stamp (triggers fire
-- in name order) and clears created_by only when that user no longer exists. It is a separate
-- trigger so it does not replace tg_sync_stamp, which the sync migration may also change.
create or replace function public.tg_clear_deleted_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null
     and not exists (select 1 from auth.users u where u.id = new.created_by) then
    new.created_by := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.tg_clear_deleted_creator() from public, anon, authenticated;

drop trigger if exists t15_clear_deleted_creator on public.client_templates;
drop trigger if exists t15_clear_deleted_creator on public.projects;
drop trigger if exists t15_clear_deleted_creator on public.nodes;
drop trigger if exists t15_clear_deleted_creator on public.spans;
drop trigger if exists t15_clear_deleted_creator on public.photos;
create trigger t15_clear_deleted_creator before update on public.client_templates
  for each row when (old.created_by is not null) execute function public.tg_clear_deleted_creator();
create trigger t15_clear_deleted_creator before update on public.projects
  for each row when (old.created_by is not null) execute function public.tg_clear_deleted_creator();
create trigger t15_clear_deleted_creator before update on public.nodes
  for each row when (old.created_by is not null) execute function public.tg_clear_deleted_creator();
create trigger t15_clear_deleted_creator before update on public.spans
  for each row when (old.created_by is not null) execute function public.tg_clear_deleted_creator();
create trigger t15_clear_deleted_creator before update on public.photos
  for each row when (old.created_by is not null) execute function public.tg_clear_deleted_creator();

revoke execute on function public.account_deletion_status(text, integer, integer, boolean) from public, anon;
grant execute on function public.account_deletion_status(text, integer, integer, boolean) to authenticated, service_role;

revoke execute on function public.account_memberships(uuid) from public, anon, authenticated;
grant execute on function public.account_memberships(uuid) to service_role;

revoke execute on function public.account_deletion_preview() from public, anon;
grant execute on function public.account_deletion_preview() to authenticated;

revoke execute on function public.delete_account_prepare(uuid, boolean) from public, anon, authenticated;
grant execute on function public.delete_account_prepare(uuid, boolean) to service_role;
