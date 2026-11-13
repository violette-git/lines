-- LOCAL TEST ONLY. Checks the dashboard functions in 0003_admin.sql: role gates, tenant isolation,
-- footage math (PostGIS) and invite rules. Runs on a fresh database after stubs, migrations, seed.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema ta;
grant usage on schema ta to anon, authenticated, service_role;

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

create function ta.expect_eq(label text, q text, expected numeric) returns void language plpgsql as $$
declare v numeric;
begin
  execute q into v;
  if v is distinct from expected then
    raise exception 'TEST FAIL: % expected % got %', label, expected, v;
  end if;
  raise warning 'ok: % = %', label, v;
end $$;

create function ta.expect_between(label text, q text, lo numeric, hi numeric) returns void language plpgsql as $$
declare v numeric;
begin
  execute q into v;
  if v is null or v < lo or v > hi then
    raise exception 'TEST FAIL: % expected between % and % got %', label, lo, hi, v;
  end if;
  raise warning 'ok: % = % (in % .. %)', label, round(v, 2), lo, hi;
end $$;

create function ta.login(uid uuid, email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'email', email, 'role', 'authenticated')::text, false);
$$;

grant execute on all functions in schema ta to authenticated, service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001', 'owner@admin.test',   '{"full_name":"Olive Owner"}'),
  ('a1000000-0000-4000-8000-000000000002', 'admin@admin.test',   '{"full_name":"Adam Admin"}'),
  ('a1000000-0000-4000-8000-000000000003', 'manager@admin.test', '{"full_name":"Mia Manager"}'),
  ('a1000000-0000-4000-8000-000000000004', 'tech@admin.test',    '{"full_name":"Tess Tech"}'),
  ('a1000000-0000-4000-8000-000000000005', 'other@admin.test',   '{"full_name":"Otto Other"}'),
  ('a1000000-0000-4000-8000-000000000006', 'new@admin.test',     '{}');

-- Owner creates the org; members are added directly as the superuser (setup only).
select ta.login('a1000000-0000-4000-8000-000000000001', 'owner@admin.test');
set role authenticated;
select public.create_organization('Admin Test Fiber') as org \gset
reset role;
-- Room for the test members (trial default is 3 seats).
update public.organizations set seat_limit = 5 where id = :'org';
insert into public.org_members (org_id, user_id, role) values
  (:'org', 'a1000000-0000-4000-8000-000000000002', 'admin'),
  (:'org', 'a1000000-0000-4000-8000-000000000003', 'manager'),
  (:'org', 'a1000000-0000-4000-8000-000000000004', 'tech');

-- Other org with its own data.
select ta.login('a1000000-0000-4000-8000-000000000005', 'other@admin.test');
set role authenticated;
select public.create_organization('Other Co') as other_org \gset
insert into public.projects (id, org_id, name) values ('b2000000-0000-4000-8000-0000000000f1', :'other_org', 'Secret project');
reset role;

-- Tech captures a route: 3 poles about 100 m apart going north, then an underground run.
-- 0.0009 degrees of latitude is about 99.9 m.
select ta.login('a1000000-0000-4000-8000-000000000003', 'manager@admin.test');
set role authenticated;
insert into public.projects (id, org_id, name, client, job_number)
values ('b1000000-0000-4000-8000-0000000000a1', :'org', 'Route 9', 'Big Telco', 'J-9');
insert into public.projects (id, org_id, name, client, job_number, status)
values ('b1000000-0000-4000-8000-0000000000a2', :'org', 'Old job', 'Big Telco', 'J-1', 'complete');
reset role;

select ta.login('a1000000-0000-4000-8000-000000000004', 'tech@admin.test');
set role authenticated;
insert into public.nodes (id, org_id, project_id, seq, type, label, lat, lng) values
  ('c1000000-0000-4000-8000-000000000001', :'org', 'b1000000-0000-4000-8000-0000000000a1', 1, 'pole', 'P-1', 33.5000, -86.8000),
  ('c1000000-0000-4000-8000-000000000002', :'org', 'b1000000-0000-4000-8000-0000000000a1', 2, 'pole', 'P-2', 33.5009, -86.8000),
  ('c1000000-0000-4000-8000-000000000003', :'org', 'b1000000-0000-4000-8000-0000000000a1', 3, 'handhole', 'HH-3', 33.5018, -86.8000);
-- aerial: ~99.9 m = ~327.8 ft, sag 2% -> ~334.3 ft, + 10 ft slack -> ~344.3 ft
insert into public.spans (id, org_id, project_id, from_node_id, to_node_id, kind, sag_pct, slack_ft) values
  ('d1000000-0000-4000-8000-000000000001', :'org', 'b1000000-0000-4000-8000-0000000000a1',
   'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'aerial', 2, 10);
-- underground with a measured override of 400 ft
insert into public.spans (id, org_id, project_id, from_node_id, to_node_id, kind, length_override_ft) values
  ('d1000000-0000-4000-8000-000000000002', :'org', 'b1000000-0000-4000-8000-0000000000a1',
   'c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000003', 'underground', 400);
reset role;

-- AI usage rows (written by the Edge Function with the service role in real life).
insert into public.ai_usage (org_id, user_id, model, status, cost_usd_estimate) values
  (:'org', 'a1000000-0000-4000-8000-000000000004', 'claude-sonnet-5-5', 'ok', 0.02),
  (:'org', 'a1000000-0000-4000-8000-000000000004', 'claude-sonnet-5-5', 'ok', 0.02),
  (:'org', 'a1000000-0000-4000-8000-000000000004', 'claude-sonnet-5-5', 'error', 0),
  (:'org', 'a1000000-0000-4000-8000-000000000003', 'claude-haiku-5-5', 'ok', 0.001),
  (:'other_org', 'a1000000-0000-4000-8000-000000000005', 'claude-sonnet-5-5', 'ok', 0.5);

-- ---------- span_billable_ft ----------
select ta.expect_between('aerial span billable ft (ST_Length + sag + slack)',
  $q$select public.span_billable_ft(geom, sag_pct, slack_ft, length_override_ft) from public.spans
     where id = 'd1000000-0000-4000-8000-000000000001'$q$, 342, 347);
select ta.expect_eq('override wins',
  $q$select public.span_billable_ft(geom, sag_pct, slack_ft, length_override_ft)::numeric from public.spans
     where id = 'd1000000-0000-4000-8000-000000000002'$q$, 400);

-- ---------- Owner ----------
select ta.login('a1000000-0000-4000-8000-000000000001', 'owner@admin.test');
set role authenticated;
select ta.expect_eq('owner sees 4 members with emails',
  format('select count(*) from public.admin_org_members(%L) where email like %L', :'org', '%@admin.test'), 4);
select ta.expect_eq('members ordered owner first',
  format($q$select count(*) from (select role from public.admin_org_members(%L) limit 1) x where role = 'owner'$q$, :'org'), 1);
select ta.expect_eq('tech last_active from audit/ai',
  format($q$select count(*) from public.admin_org_members(%L) where email = 'tech@admin.test' and last_active_at is not null$q$, :'org'), 1);
select ta.expect_error('owner cannot list other org members',
  format('select * from public.admin_org_members(%L)', :'other_org'));

select ta.expect_eq('summaries: 2 projects', format('select count(*) from public.admin_project_summaries(%L)', :'org'), 2);
select ta.expect_eq('summaries: route nodes',
  format($q$select node_count from public.admin_project_summaries(%L) where name = 'Route 9'$q$, :'org'), 3);
select ta.expect_between('summaries: aerial ft',
  format($q$select aerial_ft from public.admin_project_summaries(%L) where name = 'Route 9'$q$, :'org'), 342, 347);
select ta.expect_eq('summaries: underground ft',
  format($q$select underground_ft::numeric from public.admin_project_summaries(%L) where name = 'Route 9'$q$, :'org'), 400);
select ta.expect_eq('summaries: tech listed as editor',
  format($q$select count(*) from public.admin_project_summaries(%L), jsonb_array_elements(editors) e
            where name = 'Route 9' and e ->> 'name' = 'Tess Tech'$q$, :'org'), 1);
select ta.expect_eq('summaries: other org returns nothing',
  format('select count(*) from public.admin_project_summaries(%L)', :'other_org'), 0);

select ta.expect_eq('overview nodes_total', format($q$select (public.admin_overview(%L) ->> 'nodes_total')::int$q$, :'org'), 3);
select ta.expect_between('overview footage this week',
  format($q$select (public.admin_overview(%L) ->> 'footage_week_ft')::numeric$q$, :'org'), 742, 747);
select ta.expect_eq('overview ai photos this month (errors excluded)',
  format($q$select (public.admin_overview(%L) ->> 'ai_photos_month')::int$q$, :'org'), 3);
select ta.expect_eq('overview active techs 7d',
  format($q$select (public.admin_overview(%L) ->> 'active_techs_7d')::int$q$, :'org'), 2);
select ta.expect_eq('overview projects_active', format($q$select (public.admin_overview(%L) ->> 'projects_active')::int$q$, :'org'), 1);
select ta.expect_error('overview of other org', format('select public.admin_overview(%L)', :'other_org'));

select ta.expect_eq('activity visible to owner (projects+nodes+spans inserts)',
  format('select count(*) from public.admin_activity(%L, 50)', :'org'), 7);
select ta.expect_eq('activity names actor',
  format($q$select count(*) from public.admin_activity(%L, 50) where actor_name = 'Tess Tech' and table_name = 'nodes'$q$, :'org'), 3);
select ta.expect_eq('activity row label + project name',
  format($q$select count(*) from public.admin_activity(%L, 50) where row_label = 'HH-3' and project_name = 'Route 9'$q$, :'org'), 1);
select ta.expect_eq('activity paging',
  format($q$select count(*) from public.admin_activity(%L, 2, (select max(id) from public.audit_log))$q$, :'org'), 2);
select ta.expect_eq('activity other org: nothing', format('select count(*) from public.admin_activity(%L, 50)', :'other_org'), 0);

select ta.expect_eq('ai usage rows this month (tech + manager)',
  format('select count(*) from public.admin_ai_usage(%L, 3)', :'org'), 2);
select ta.expect_eq('ai usage tech photos',
  format($q$select photo_count from public.admin_ai_usage(%L, 3) where full_name = 'Tess Tech'$q$, :'org'), 2);
select ta.expect_eq('ai usage tech errors',
  format($q$select error_count from public.admin_ai_usage(%L, 3) where full_name = 'Tess Tech'$q$, :'org'), 1);
select ta.expect_error('ai usage of other org', format('select * from public.admin_ai_usage(%L, 3)', :'other_org'));

select ta.expect_between('footage by tech (tess, this week)',
  format($q$select aerial_ft + underground_ft from public.admin_footage_by_tech(%L, 4) where full_name = 'Tess Tech'$q$, :'org'), 742, 747);

-- Invites
select ta.expect_eq('owner invites new person',
  format($q$select count(*) from public.admin_create_invite(%L, '  New@Admin.test ', 'tech') where email = 'new@admin.test'$q$, :'org'), 1);
select ta.expect_eq('re-invite replaces the open invite',
  format($q$select count(*) from (select public.admin_create_invite(%L, 'new@admin.test', 'manager')) x$q$, :'org'), 1);
select ta.expect_eq('one open invite, manager role',
  $q$select count(*) from public.org_invites where email = 'new@admin.test' and role = 'manager' and accepted_at is null$q$, 1);
select ta.expect_error('invite existing member', format($q$select public.admin_create_invite(%L, 'tech@admin.test', 'tech')$q$, :'org'));
select ta.expect_error('invite bad email', format($q$select public.admin_create_invite(%L, 'nope', 'tech')$q$, :'org'));
select ta.expect_error('invite bad role', format($q$select public.admin_create_invite(%L, 'x@y.test', 'god')$q$, :'org'));
select ta.expect_error('invite into other org', format($q$select public.admin_create_invite(%L, 'x@y.test', 'tech')$q$, :'other_org'));
select ta.expect_eq('owner may invite an owner',
  format($q$select count(*) from public.admin_create_invite(%L, 'co-owner@admin.test', 'owner')$q$, :'org'), 1);
reset role;

-- ---------- Admin ----------
select ta.login('a1000000-0000-4000-8000-000000000002', 'admin@admin.test');
set role authenticated;
select ta.expect_eq('admin sees members', format('select count(*) from public.admin_org_members(%L)', :'org'), 4);
select ta.expect_error('admin cannot invite an owner',
  format($q$select public.admin_create_invite(%L, 'boss@admin.test', 'owner')$q$, :'org'));
select ta.expect_eq('admin invites a viewer',
  format($q$select count(*) from public.admin_create_invite(%L, 'viewer@admin.test', 'viewer')$q$, :'org'), 1);
select ta.expect_eq('org_has_member_email true for member',
  format($q$select public.org_has_member_email(%L, 'TECH@admin.test')::int$q$, :'org'), 1);
reset role;

-- ---------- Manager ----------
select ta.login('a1000000-0000-4000-8000-000000000003', 'manager@admin.test');
set role authenticated;
select ta.expect_error('manager cannot list member emails', format('select * from public.admin_org_members(%L)', :'org'));
select ta.expect_error('manager cannot invite', format($q$select public.admin_create_invite(%L, 'z@admin.test', 'tech')$q$, :'org'));
select ta.expect_eq('manager org_has_member_email is false (no probing)',
  format($q$select public.org_has_member_email(%L, 'tech@admin.test')::int$q$, :'org'), 0);
select ta.expect_eq('manager sees activity', format('select count(*) from public.admin_activity(%L, 50)', :'org'), 7);
select ta.expect_eq('manager sees usage', format('select count(*) from public.admin_ai_usage(%L, 3)', :'org'), 2);
select ta.expect_eq('manager sees ai in overview',
  format($q$select (public.admin_overview(%L) ->> 'ai_photos_month')::int$q$, :'org'), 3);
reset role;

-- ---------- Tech ----------
select ta.login('a1000000-0000-4000-8000-000000000004', 'tech@admin.test');
set role authenticated;
select ta.expect_error('tech cannot list member emails', format('select * from public.admin_org_members(%L)', :'org'));
select ta.expect_error('tech cannot see team usage', format('select * from public.admin_ai_usage(%L, 3)', :'org'));
select ta.expect_error('tech cannot see footage by tech', format('select * from public.admin_footage_by_tech(%L, 4)', :'org'));
select ta.expect_eq('tech activity feed is empty (audit RLS)', format('select count(*) from public.admin_activity(%L, 50)', :'org'), 0);
select ta.expect_eq('tech overview hides AI numbers',
  format($q$select (public.admin_overview(%L) -> 'ai_photos_month' = 'null'::jsonb)::int$q$, :'org'), 1);
select ta.expect_eq('tech sees project summaries', format('select count(*) from public.admin_project_summaries(%L)', :'org'), 2);
select ta.expect_error('tech cannot invite', format($q$select public.admin_create_invite(%L, 'q@admin.test', 'viewer')$q$, :'org'));
reset role;

-- ---------- Seat limit blocks invites ----------
update public.organizations set seat_limit = 4 where id = :'org';
select ta.login('a1000000-0000-4000-8000-000000000001', 'owner@admin.test');
set role authenticated;
select ta.expect_error('no free seats', format($q$select public.admin_create_invite(%L, 'late@admin.test', 'tech')$q$, :'org'));
reset role;

-- ---------- Signed out ----------
select set_config('request.jwt.claims', '', false);
set role anon;
select ta.expect_error('anon cannot call admin_overview', format('select public.admin_overview(%L)', :'org'));
select ta.expect_error('anon cannot call admin_org_members', format('select * from public.admin_org_members(%L)', :'org'));
reset role;

select 'ALL ADMIN TESTS PASSED' as result;
