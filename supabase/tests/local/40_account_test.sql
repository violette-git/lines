-- LOCAL TEST ONLY. Account deletion rules from 0004_account.sql.
-- Run by run_account_local.sh after the stubs and all migrations. Any failure aborts with an error.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema if not exists ta;
grant usage on schema ta to authenticated, service_role, anon;

create function ta.expect_error(label text, q text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    raise warning 'ok (blocked): % -> %', label, sqlerrm;
    return;
  end;
  raise exception 'TEST FAIL: expected error for: %', label;
end $$;

create function ta.expect_eq(label text, q text, expected text) returns void language plpgsql as $$
declare v text;
begin
  execute q into v;
  if v is distinct from expected then
    raise exception 'TEST FAIL: % expected % got %', label, expected, v;
  end if;
  raise warning 'ok: % = %', label, v;
end $$;

create function ta.login(uid uuid, email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'email', email, 'role', 'authenticated')::text, false);
$$;

grant execute on all functions in schema ta to authenticated, service_role, anon;

-- ---------- Fixtures (as the database owner, which bypasses RLS) ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001', 'alice@acct.test', '{"full_name":"Alice"}'),
  ('b1000000-0000-4000-8000-000000000002', 'bob@acct.test',   '{"full_name":"Bob"}'),
  ('c1000000-0000-4000-8000-000000000003', 'carol@acct.test', '{"full_name":"Carol"}'),
  ('d1000000-0000-4000-8000-000000000004', 'dave@acct.test',  '{"full_name":"Dave"}'),
  ('e1000000-0000-4000-8000-000000000005', 'erin@acct.test',  '{"full_name":"Erin"}');

insert into public.organizations (id, name, slug) values
  ('51000000-0000-4000-8000-000000000001', 'Solo Splicing', 'solo-splicing'),
  ('52000000-0000-4000-8000-000000000002', 'Team Telecom', 'team-telecom'),
  ('53000000-0000-4000-8000-000000000003', 'Duo Drop Crew', 'duo-drop-crew');
insert into public.organizations (id, name, slug, plan, subscription_status, stripe_subscription_id, trial_ends_at) values
  ('54000000-0000-4000-8000-000000000004', 'Paid Plant Co', 'paid-plant-co', 'starter', 'active', 'sub_test_123', null);

insert into public.org_members (org_id, user_id, role) values
  ('51000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner'),
  ('52000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'owner'),
  ('52000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'tech'),
  ('53000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 'owner'),
  ('53000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004', 'owner'),
  ('54000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000005', 'owner');

-- Field data created by Alice in both of her companies.
select ta.login('a1000000-0000-4000-8000-000000000001', 'alice@acct.test');
insert into public.projects (id, org_id, name) values
  ('61000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'Solo job'),
  ('62000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000002', 'Team job');
insert into public.nodes (id, org_id, project_id, type, lat, lng) values
  ('71000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'pole', 33.5, -86.8),
  ('72000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000002', 'pole', 33.5, -86.8);
select set_config('request.jwt.claims', '', false);

insert into public.org_invites (org_id, email, role, accepted_at, accepted_by) values
  ('52000000-0000-4000-8000-000000000002', 'alice@acct.test', 'owner', now(), 'a1000000-0000-4000-8000-000000000001');
insert into public.org_invites (org_id, email, role) values
  ('53000000-0000-4000-8000-000000000003', 'ALICE@acct.test', 'tech');
insert into storage.buckets (id, name) values ('photos', 'photos') on conflict do nothing;
insert into storage.objects (bucket_id, name, owner) values
  ('photos', '52000000-0000-4000-8000-000000000002/62000000-0000-4000-8000-000000000002/x.jpg', 'a1000000-0000-4000-8000-000000000001');

-- ---------- Pure decision ----------
select ta.expect_eq('status: tech leaves', $q$select public.account_deletion_status('tech', 1, 5, true)$q$, 'leave');
select ta.expect_eq('status: co-owner leaves', $q$select public.account_deletion_status('owner', 2, 2, false)$q$, 'leave');
select ta.expect_eq('status: sole owner with members', $q$select public.account_deletion_status('owner', 1, 3, false)$q$, 'sole_owner_with_members');
select ta.expect_eq('status: sole member, subscribed', $q$select public.account_deletion_status('owner', 1, 1, true)$q$, 'sole_member_subscribed');
select ta.expect_eq('status: sole member', $q$select public.account_deletion_status('owner', 1, 1, false)$q$, 'sole_member');

-- ---------- Permissions ----------
set role anon;
select ta.expect_error('anon cannot preview', 'select public.account_deletion_preview()');
select ta.expect_error('anon cannot prepare', $q$select public.delete_account_prepare('a1000000-0000-4000-8000-000000000001', true)$q$);
reset role;

select ta.login('b1000000-0000-4000-8000-000000000002', 'bob@acct.test');
set role authenticated;
select ta.expect_error('user cannot call prepare (would delete anyone)', $q$select public.delete_account_prepare('a1000000-0000-4000-8000-000000000001', true)$q$);
select ta.expect_error('user cannot read memberships of any user', $q$select * from public.account_memberships('a1000000-0000-4000-8000-000000000001')$q$);
select ta.expect_eq('bob preview: one company, leave',
  $q$select string_agg(e->>'org_name' || ':' || (e->>'status'), ',') from jsonb_array_elements(public.account_deletion_preview()) e$q$,
  'Team Telecom:leave');
reset role;

select ta.login('a1000000-0000-4000-8000-000000000001', 'alice@acct.test');
set role authenticated;
select ta.expect_eq('alice preview statuses',
  $q$select string_agg(e->>'org_name' || ':' || (e->>'status') || ':' || (e->>'member_count'), ',' order by e->>'org_name') from jsonb_array_elements(public.account_deletion_preview()) e$q$,
  'Solo Splicing:sole_member:1,Team Telecom:sole_owner_with_members:2');
reset role;
select set_config('request.jwt.claims', '', false);
set role authenticated;
select ta.expect_error('signed-out preview', 'select public.account_deletion_preview()');
reset role;

-- ---------- Blocked runs change nothing ----------
set role service_role;
select ta.expect_eq('alice blocked without consent (2 blockers)',
  $q$select (r->>'ok') || ':' || jsonb_array_length(r->'blocked') from public.delete_account_prepare('a1000000-0000-4000-8000-000000000001', false) r$q$,
  'false:2');
select ta.expect_eq('alice still blocked with consent (team needs an owner)',
  $q$select (r->>'ok') || ':' || (r->'blocked'->0->>'reason') || ':' || (r->'blocked'->0->>'other_members') from public.delete_account_prepare('a1000000-0000-4000-8000-000000000001', true) r$q$,
  'false:sole_owner_with_members:1');
select ta.expect_eq('erin blocked by live subscription',
  $q$select (r->>'ok') || ':' || (r->'blocked'->0->>'reason') from public.delete_account_prepare('e1000000-0000-4000-8000-000000000005', true) r$q$,
  'false:active_subscription');
reset role;
select ta.expect_eq('nothing removed after blocked runs', 'select count(*)::text from public.org_members', '6');
select ta.expect_eq('profiles kept after blocked runs', 'select count(*)::text from public.profiles where full_name is not null and id::text like ''_1000000%''', '5');

-- ---------- Transfer ownership, then delete ----------
update public.org_members set role = 'owner'
 where org_id = '52000000-0000-4000-8000-000000000002' and user_id = 'b1000000-0000-4000-8000-000000000002';

set role service_role;
select ta.expect_eq('alice allowed after transfer',
  $q$select (r->>'ok') || ':' || (r->'deleted_orgs'->0->>'org_name') || ':' || (r->'left_orgs'->0->>'org_name') from public.delete_account_prepare('a1000000-0000-4000-8000-000000000001', true) r$q$,
  'true:Solo Splicing:Team Telecom');
reset role;

select ta.expect_eq('solo company deleted', $q$select count(*)::text from public.organizations where id = '51000000-0000-4000-8000-000000000001'$q$, '0');
select ta.expect_eq('solo company data deleted', $q$select count(*)::text from public.projects where org_id = '51000000-0000-4000-8000-000000000001'$q$, '0');
select ta.expect_eq('team company kept', $q$select count(*)::text from public.organizations where id = '52000000-0000-4000-8000-000000000002'$q$, '1');
select ta.expect_eq('team node kept', $q$select count(*)::text from public.nodes where id = '72000000-0000-4000-8000-000000000002'$q$, '1');
select ta.expect_eq('alice has no memberships', $q$select count(*)::text from public.org_members where user_id = 'a1000000-0000-4000-8000-000000000001'$q$, '0');
select ta.expect_eq('alice profile removed', $q$select count(*)::text from public.profiles where id = 'a1000000-0000-4000-8000-000000000001'$q$, '0');
select ta.expect_eq('open invite to alice removed', $q$select count(*)::text from public.org_invites where lower(email) = 'alice@acct.test'$q$, '0');
select ta.expect_eq('accepted invite redacted', $q$select count(*)::text from public.org_invites where email = 'deleted-user@deleted.invalid'$q$, '1');
select ta.expect_eq('storage owner cleared', $q$select count(*)::text from storage.objects where owner = 'a1000000-0000-4000-8000-000000000001'$q$, '0');
select ta.expect_eq('photo object kept', $q$select count(*)::text from storage.objects where name like '52000000-%'$q$, '1');

-- The Edge Function then deletes the login; the cascade must not trip the last-owner guard.
delete from auth.users where id = 'a1000000-0000-4000-8000-000000000001';
select ta.expect_eq('team node created_by cleared', $q$select coalesce(created_by::text, 'null') from public.nodes where id = '72000000-0000-4000-8000-000000000002'$q$, 'null');

-- The fix only applies to deleted logins: a live user cannot erase who created a row.
select ta.login('b1000000-0000-4000-8000-000000000002', 'bob@acct.test');
set role authenticated;
insert into public.nodes (id, org_id, project_id, type, lat, lng) values
  ('73000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000002', 'pole', 33.6, -86.8);
update public.nodes set created_by = null, label = 'x' where id = '73000000-0000-4000-8000-000000000003';
reset role;
select ta.expect_eq('created_by stays for a live user', $q$select created_by::text from public.nodes where id = '73000000-0000-4000-8000-000000000003'$q$, 'b1000000-0000-4000-8000-000000000002');

-- Running it again for an already-cleaned user is a harmless no-op (Edge Function retry).
set role service_role;
select ta.expect_eq('retry is a no-op',
  $q$select (r->>'ok') || ':' || jsonb_array_length(r->'deleted_orgs') || ':' || jsonb_array_length(r->'left_orgs') from public.delete_account_prepare('a1000000-0000-4000-8000-000000000001', false) r$q$,
  'true:0:0');

-- Bob is now the only member of Team: needs consent; a co-owner (Carol) just leaves.
select ta.expect_eq('bob now needs consent',
  $q$select (r->>'ok') || ':' || (r->'blocked'->0->>'reason') from public.delete_account_prepare('b1000000-0000-4000-8000-000000000002', false) r$q$,
  'false:sole_member_needs_consent');
select ta.expect_eq('carol leaves duo',
  $q$select (r->>'ok') || ':' || (r->'left_orgs'->0->>'org_name') from public.delete_account_prepare('c1000000-0000-4000-8000-000000000003', false) r$q$,
  'true:Duo Drop Crew');
reset role;
select ta.expect_eq('dave still owns duo', $q$select role from public.org_members where org_id = '53000000-0000-4000-8000-000000000003'$q$, 'owner');
delete from auth.users where id = 'c1000000-0000-4000-8000-000000000003';

select 'ALL ACCOUNT TESTS PASSED' as result;
