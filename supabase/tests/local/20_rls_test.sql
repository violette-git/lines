-- LOCAL TEST ONLY. Exercises tenancy isolation, roles, sync triggers, storage paths and quota.
-- Run by run_local.sh after the stubs, the migration and the seed. Any failure aborts with an error.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema t;
grant usage on schema t to authenticated, service_role;

-- Run SQL and require that it raises an error.
create function t.expect_error(label text, q text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    raise warning 'ok (blocked): % -> %', label, sqlerrm;
    return;
  end;
  raise exception 'TEST FAIL: expected error for: %', label;
end $$;

-- Run a query returning one bigint and require a value.
create function t.expect_eq(label text, q text, expected bigint) returns void language plpgsql as $$
declare v bigint;
begin
  execute q into v;
  if v is distinct from expected then
    raise exception 'TEST FAIL: % expected % got %', label, expected, v;
  end if;
  raise warning 'ok: % = %', label, v;
end $$;

grant execute on all functions in schema t to authenticated, service_role;

-- Users
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test', '{"full_name":"Alice Owner"}'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test',   '{"full_name":"Bob Other"}'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test', '{"full_name":"Carol Tech"}'),
  ('d0000000-0000-4000-8000-000000000004', 'dave@example.test',  '{"full_name":"Dave Viewer"}'),
  ('e0000000-0000-4000-8000-000000000005', 'erin@example.test',  '{}');

select t.expect_eq('profiles created by trigger', 'select count(*) from public.profiles', 5);

create function t.login(uid uuid, email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'email', email, 'role', 'authenticated')::text, false);
$$;

-- ---------- Alice creates org A and data ----------
select t.login('a0000000-0000-4000-8000-000000000001', 'alice@example.test');
set role authenticated;
select public.create_organization('Acme Fiber, LLC') as org_a \gset
select :'org_a' <> '' as has_org;
select t.expect_eq('alice sees 1 org', 'select count(*) from public.organizations', 1);
select t.expect_eq('alice is owner', $q$select count(*) from public.org_members where role = 'owner'$q$, 1);

insert into public.client_templates (id, org_id, name, client)
values ('11111111-1111-4111-8111-111111111111', :'org_a', 'Default', 'Big Telco');
insert into public.projects (id, org_id, name, client, template_id)
values ('22222222-2222-4222-8222-222222222222', :'org_a', 'Main St', 'Big Telco', '11111111-1111-4111-8111-111111111111');
insert into public.nodes (id, org_id, project_id, seq, type, label, lat, lng)
values
  ('33333333-3333-4333-8333-333333333331', :'org_a', '22222222-2222-4222-8222-222222222222', 1, 'pole', 'P-1', 33.5186, -86.8104),
  ('33333333-3333-4333-8333-333333333332', :'org_a', '22222222-2222-4222-8222-222222222222', 2, 'pole', 'P-2', 33.5190, -86.8110);
insert into public.spans (id, org_id, project_id, from_node_id, to_node_id, kind, sag_pct)
values ('44444444-4444-4444-8444-444444444441', :'org_a', '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333332', 'aerial', 2);

select t.expect_eq('node geom generated', 'select count(*) from public.nodes where geom is not null', 2);
select t.expect_eq('span geom set on insert', 'select count(*) from public.spans where geom is not null', 1);
select t.expect_eq('created_by forced to caller',
  $q$select count(*) from public.nodes where created_by = 'a0000000-0000-4000-8000-000000000001'$q$, 2);

select round(extensions.st_length(geom)::numeric) as span_len_m_before from public.spans \gset
select rev as span_rev_before from public.spans \gset
update public.nodes set lat = 33.5200, client_updated_at = now() + interval '1 second'
 where id = '33333333-3333-4333-8333-333333333332';
select round(extensions.st_length(geom)::numeric) as span_len_m_after from public.spans \gset
select t.expect_eq('span geom follows node move',
  format('select (%s <> %s)::int', :span_len_m_after, :span_len_m_before), 1);
select t.expect_eq('span rev bumped after node move',
  'select count(*) from public.spans where rev > ' || :span_rev_before, 1);

-- Last-write-wins: an older device edit must not overwrite a newer one.
update public.nodes set label = 'NEWER', client_updated_at = '2030-01-01T00:00:00Z'
 where id = '33333333-3333-4333-8333-333333333331';
update public.nodes set label = 'OLDER', client_updated_at = '2029-01-01T00:00:00Z'
 where id = '33333333-3333-4333-8333-333333333331';
select t.expect_eq('LWW keeps newer', $q$select count(*) from public.nodes where label = 'NEWER'$q$, 1);

-- Immutable org_id / billing columns
select t.expect_error('owner cannot change plan', $q$update public.organizations set plan = 'enterprise'$q$);
select t.expect_error('owner cannot change quota', $q$update public.organizations set ai_monthly_photo_quota = 999999$q$);
update public.organizations set name = 'Acme Fiber' where id = :'org_a';
select t.expect_error('owner cannot write ai_usage',
  format($q$insert into public.ai_usage (org_id, model) values (%L, 'x')$q$, :'org_a'));
select t.expect_error('owner cannot call ai_reserve_usage',
  format($q$select public.ai_reserve_usage(%L, null, 'x')$q$, :'org_a'));
select t.expect_error('no direct member insert',
  format($q$insert into public.org_members (org_id, user_id, role) values (%L, 'e0000000-0000-4000-8000-000000000005', 'tech')$q$, :'org_a'));
select t.expect_error('last owner cannot leave',
  format($q$delete from public.org_members where org_id = %L and user_id = 'a0000000-0000-4000-8000-000000000001'$q$, :'org_a'));

-- Invites
insert into public.org_invites (org_id, email, role, invited_by)
values (:'org_a', 'carol@example.test', 'tech', 'a0000000-0000-4000-8000-000000000001');
insert into public.org_invites (org_id, email, role, invited_by)
values (:'org_a', 'dave@example.test', 'viewer', 'a0000000-0000-4000-8000-000000000001');
insert into public.org_invites (org_id, email, role, invited_by)
values (:'org_a', 'erin@example.test', 'tech', 'a0000000-0000-4000-8000-000000000001');
select token as carol_token from public.org_invites where email = 'carol@example.test' \gset
select token as dave_token from public.org_invites where email = 'dave@example.test' \gset
select token as erin_token from public.org_invites where email = 'erin@example.test' \gset

-- Storage: owner uploads into own org prefix
insert into storage.objects (bucket_id, name)
values ('photos', :'org_a' || '/22222222-2222-4222-8222-222222222222/55555555-5555-4555-8555-555555555555.jpg');
reset role;

-- ---------- Bob, another org ----------
select t.login('b0000000-0000-4000-8000-000000000002', 'bob@example.test');
set role authenticated;
select public.create_organization('Bravo Comms') as org_b \gset
insert into public.projects (id, org_id, name) values ('66666666-6666-4666-8666-666666666666', :'org_b', 'Bob project');

select t.expect_eq('bob sees only his org', 'select count(*) from public.organizations', 1);
select t.expect_eq('bob sees 0 of alice nodes', 'select count(*) from public.nodes', 0);
select t.expect_eq('bob sees only own project', 'select count(*) from public.projects', 1);
select t.expect_eq('bob sees 0 templates', 'select count(*) from public.client_templates', 0);
select t.expect_eq('bob sees 0 spans', 'select count(*) from public.spans', 0);
select t.expect_eq('bob sees 0 invites', 'select count(*) from public.org_invites', 0);
select t.expect_eq('bob sees 0 org A audit rows', format('select count(*) from public.audit_log where org_id = %L', :'org_a'), 0);
select t.expect_eq('bob sees own audit row', 'select count(*) from public.audit_log', 1);
select t.expect_eq('bob sees only own membership', 'select count(*) from public.org_members', 1);
select t.expect_eq('bob sees only own profile', 'select count(*) from public.profiles', 1);
select t.expect_eq('bob sees 0 photo objects', 'select count(*) from storage.objects', 0);

select t.expect_error('bob insert node into org A',
  format($q$insert into public.nodes (org_id, project_id, type, lat, lng) values (%L, '22222222-2222-4222-8222-222222222222', 'pole', 0, 0)$q$, :'org_a'));
select t.expect_error('bob node in own org pointing at alice project (composite FK)',
  format($q$insert into public.nodes (org_id, project_id, type, lat, lng) values (%L, '22222222-2222-4222-8222-222222222222', 'pole', 0, 0)$q$, :'org_b'));
select t.expect_error('bob upload into org A prefix',
  format($q$insert into storage.objects (bucket_id, name) values ('photos', %L)$q$, :'org_a' || '/22222222-2222-4222-8222-222222222222/x.jpg'));
select t.expect_error('garbage storage path rejected (no cast error leak)',
  $q$insert into storage.objects (bucket_id, name) values ('photos', 'not-a-uuid/also-not/x.jpg')$q$);
select t.expect_error('bob accepting carol invite (email mismatch)',
  format($q$select public.accept_invite(%L)$q$, :'carol_token'));

-- Updates/deletes against invisible rows affect nothing.
update public.nodes set label = 'HACKED';
delete from public.projects where id = '22222222-2222-4222-8222-222222222222';
update public.organizations set name = 'pwned' where id = :'org_a';
reset role;
select t.expect_eq('alice data untouched by bob',
  $q$select count(*) from public.nodes where label = 'HACKED'$q$, 0);
select t.expect_eq('alice project survives bob delete',
  $q$select count(*) from public.projects where id = '22222222-2222-4222-8222-222222222222'$q$, 1);
select t.expect_eq('alice org name intact', $q$select count(*) from public.organizations where name = 'pwned'$q$, 0);

-- ---------- Carol (tech) joins org A ----------
select t.login('c0000000-0000-4000-8000-000000000003', 'carol@example.test');
set role authenticated;
select public.accept_invite(:'carol_token') = :'org_a'::uuid as carol_joined;
select t.expect_eq('carol is tech', $q$select count(*) from public.org_members where user_id = auth.uid() and role = 'tech'$q$, 1);
select t.expect_error('invite cannot be reused', format($q$select public.accept_invite(%L)$q$, :'carol_token'));
select t.expect_eq('carol sees alice nodes', 'select count(*) from public.nodes', 2);
select t.expect_eq('carol cannot see invites', 'select count(*) from public.org_invites', 0);
insert into public.nodes (org_id, project_id, seq, type, label, lat, lng)
values (:'org_a', '22222222-2222-4222-8222-222222222222', 3, 'handhole', 'HH-3', 33.52, -86.81);
update public.nodes set deleted_at = now(), client_updated_at = '2031-01-01T00:00:00Z' where label = 'HH-3';
select t.expect_error('tech cannot create project',
  format($q$insert into public.projects (org_id, name) values (%L, 'x')$q$, :'org_a'));
-- Tech cannot hard delete: RLS filters the row out, so zero rows are deleted.
delete from public.nodes where id = '33333333-3333-4333-8333-333333333331';
select t.expect_eq('tech hard delete had no effect', $q$select count(*) from public.nodes where id = '33333333-3333-4333-8333-333333333331'$q$, 1);
-- Tech cannot promote self.
update public.org_members set role = 'admin' where user_id = auth.uid();
select t.expect_eq('tech still tech', $q$select count(*) from public.org_members where user_id = auth.uid() and role = 'tech'$q$, 1);
select t.expect_error('tech cannot change org name (no rows -> check)',
  format($q$do $d$ begin update public.organizations set name = 'x' where id = %L; if not found then raise exception 'no rows'; end if; end $d$$q$, :'org_a'));
insert into storage.objects (bucket_id, name)
values ('photos', :'org_a' || '/22222222-2222-4222-8222-222222222222/77777777-7777-4777-8777-777777777777.jpg');
select t.expect_eq('carol sees org photos', 'select count(*) from storage.objects', 2);
select t.expect_eq('carol sees only own ai usage rows (none)', 'select count(*) from public.ai_usage', 0);
reset role;

-- ---------- Dave (viewer) ----------
select t.login('d0000000-0000-4000-8000-000000000004', 'dave@example.test');
set role authenticated;
select public.accept_invite(:'dave_token') is not null as dave_joined;
select t.expect_eq('viewer reads nodes', 'select count(*) from public.nodes', 3);
select t.expect_error('viewer cannot insert node',
  format($q$insert into public.nodes (org_id, project_id, type, lat, lng) values (%L, '22222222-2222-4222-8222-222222222222', 'pole', 1, 1)$q$, :'org_a'));
select t.expect_error('viewer cannot upload',
  format($q$insert into storage.objects (bucket_id, name) values ('photos', %L)$q$, :'org_a' || '/22222222-2222-4222-8222-222222222222/v.jpg'));
update public.nodes set label = 'VIEWER-EDIT';
select t.expect_eq('viewer update had no effect', $q$select count(*) from public.nodes where label = 'VIEWER-EDIT'$q$, 0);
reset role;

-- ---------- Seat limit (trial org = 3 seats: alice, carol, dave) ----------
select t.login('e0000000-0000-4000-8000-000000000005', 'erin@example.test');
set role authenticated;
select t.expect_error('seat limit blocks 4th member', format($q$select public.accept_invite(%L)$q$, :'erin_token'));
reset role;

-- ---------- Admin cannot touch owners ----------
update public.org_members set role = 'admin'
 where user_id = 'c0000000-0000-4000-8000-000000000003' and org_id = :'org_a';
select t.login('c0000000-0000-4000-8000-000000000003', 'carol@example.test');
set role authenticated;
update public.org_members set role = 'viewer' where user_id = 'a0000000-0000-4000-8000-000000000001';
select t.expect_eq('admin cannot demote owner',
  $q$select count(*) from public.org_members where user_id = 'a0000000-0000-4000-8000-000000000001' and role = 'owner'$q$, 1);
select t.expect_error('admin cannot promote self to owner (with check)',
  $q$do $d$ begin update public.org_members set role = 'owner' where user_id = auth.uid(); end $d$$q$);
select t.expect_error('admin cannot invite an owner',
  format($q$insert into public.org_invites (org_id, email, role, invited_by) values (%L, 'z@example.test', 'owner', auth.uid())$q$, :'org_a'));
update public.org_members set role = 'manager' where user_id = 'd0000000-0000-4000-8000-000000000004';
select t.expect_eq('admin can change viewer to manager',
  $q$select count(*) from public.org_members where user_id = 'd0000000-0000-4000-8000-000000000004' and role = 'manager'$q$, 1);
reset role;

-- ---------- Quota reservation (service role) ----------
set role service_role;
update public.organizations set ai_monthly_photo_quota = 2 where id = :'org_a';
select (public.ai_reserve_usage(:'org_a', 'c0000000-0000-4000-8000-000000000003', 'claude-sonnet-5-5') ->> 'ok')::boolean as r1 \gset
select (public.ai_reserve_usage(:'org_a', 'c0000000-0000-4000-8000-000000000003', 'claude-sonnet-5-5') ->> 'ok')::boolean as r2 \gset
select public.ai_reserve_usage(:'org_a', 'c0000000-0000-4000-8000-000000000003', 'claude-sonnet-5-5') ->> 'reason' as r3 \gset
select t.expect_eq('quota reservations', format($q$select case when %L::boolean and %L::boolean and %L = 'quota' then 1 else 0 end$q$, :'r1', :'r2', :'r3'), 1);
update public.ai_usage set status = 'ok', input_tokens = 2500, output_tokens = 600, cost_usd_estimate = 0.011;
reset role;

select t.login('a0000000-0000-4000-8000-000000000001', 'alice@example.test');
set role authenticated;
select t.expect_eq('owner sees monthly usage', 'select photo_count from public.ai_usage_monthly', 2);
select t.expect_eq('owner sees audit trail', 'select (count(*) > 0)::int from public.audit_log', 1);
reset role;
select t.login('b0000000-0000-4000-8000-000000000002', 'bob@example.test');
set role authenticated;
select t.expect_eq('bob sees no usage of org A', 'select count(*) from public.ai_usage_monthly', 0);
reset role;

select t.expect_eq('anon has no table access',
  $q$select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'$q$, 0);

-- ---------- Every public table has RLS on ----------
select t.expect_eq('tables without RLS',
  $q$select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
       and c.relname <> 'spatial_ref_sys'$q$, 0);

-- ---------- Org delete cascades cleanly ----------
delete from public.organizations where id = :'org_a';
select t.expect_eq('cascade removed nodes', format('select count(*) from public.nodes where org_id = %L', :'org_a'), 0);

\echo 'ALL RLS TESTS PASSED'
