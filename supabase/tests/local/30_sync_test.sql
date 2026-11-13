-- LOCAL TEST ONLY. Exercises sync_push / sync_pull from 0002_sync.sql: two users in one org,
-- conflicting edits (last-write-wins), tombstones and their cascade, deletes-win, paging,
-- cursor reset, role limits and cross-org isolation. Self-contained (own users, orgs and
-- helpers in schema ts), so it can run with or without 20_rls_test.sql before it.
-- Run by run_local_sync.sh. Any failure aborts with an error.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema ts;
grant usage on schema ts to authenticated, service_role;

create function ts.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'SYNC TEST FAIL: %', label;
  end if;
  raise warning 'ok: %', label;
end $$;

create function ts.login(uid uuid, email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'email', email, 'role', 'authenticated')::text, false);
$$;

-- Status of one row in a sync_push result.
create function ts.st(res jsonb, tbl text, id uuid) returns text language sql immutable as $$
  select e ->> 'status' from jsonb_array_elements(res -> 'results' -> tbl) e where e ->> 'id' = id::text;
$$;
create function ts.res(res jsonb, tbl text, id uuid) returns jsonb language sql immutable as $$
  select e from jsonb_array_elements(res -> 'results' -> tbl) e where e ->> 'id' = id::text;
$$;

-- Pull pages until every table is caught up. Returns {rows: {table: [...]}, cursor: {...}, pages}.
create function ts.pull_all(org uuid, since jsonb, lim integer default 500) returns jsonb language plpgsql as $$
declare
  v_since jsonb := coalesce(since, '{}'::jsonb);
  v_rows jsonb := '{"client_templates":[],"projects":[],"nodes":[],"spans":[],"photos":[]}'::jsonb;
  v_page jsonb;
  v_more boolean;
  v_pages integer := 0;
  v_t text;
begin
  loop
    v_page := public.sync_pull(org, v_since, lim);
    v_pages := v_pages + 1;
    if v_page ? 'reset' then
      return jsonb_build_object('reset', true);
    end if;
    v_more := false;
    for v_t in select jsonb_object_keys(v_page -> 'tables') loop
      v_rows := jsonb_set(v_rows, array[v_t], (v_rows -> v_t) || (v_page -> 'tables' -> v_t -> 'rows'));
      v_since := jsonb_set(v_since, array[v_t], v_page -> 'tables' -> v_t -> 'cursor');
      v_more := v_more or (v_page -> 'tables' -> v_t ->> 'has_more')::boolean;
    end loop;
    exit when not v_more or v_pages > 1000;
  end loop;
  return jsonb_build_object('rows', v_rows, 'cursor', v_since, 'pages', v_pages);
end $$;

create function ts.cnt(pulled jsonb, tbl text) returns integer language sql immutable as $$
  select jsonb_array_length(pulled -> 'rows' -> tbl);
$$;
create function ts.find(pulled jsonb, tbl text, id uuid) returns jsonb language sql immutable as $$
  select e from jsonb_array_elements(pulled -> 'rows' -> tbl) e where e ->> 'id' = id::text;
$$;

-- Row builders (server column names, as the app's toServer* functions produce them).
create function ts.tpl(id uuid, org uuid, cua text) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', id, 'org_id', org, 'name', 'Std', 'client', 'Telco', 'label_patterns', '{"pole":"P-{seq}"}'::jsonb,
    'required_fields', '{}'::jsonb, 'defaults', '{}'::jsonb, 'default_span_kind', 'aerial', 'default_sag_pct', 2,
    'default_slack_ft', 0, 'rate_per_foot', 0.35, 'rate_per_node', null, 'watermark_photos', true,
    'created_at', '2026-11-01T00:00:00Z', 'client_updated_at', cua, 'deleted_at', null);
$$;
create function ts.proj(id uuid, org uuid, tpl uuid, name text, cua text) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', id, 'org_id', org, 'name', name, 'client', 'Telco', 'job_number', 'J-1', 'work_type', 'aerial',
    'notes', '', 'status', 'active', 'rate_per_foot', 0.35, 'rate_per_node', null, 'template_id', tpl, 'walk_mode', true,
    'created_at', '2026-11-01T00:00:00Z', 'client_updated_at', cua, 'deleted_at', null);
$$;
create function ts.node(id uuid, org uuid, project uuid, seq integer, label text, cua text, dup uuid default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', id, 'org_id', org, 'project_id', project, 'seq', seq, 'type', 'pole', 'label', label,
    'lat', 33.5 + seq * 0.0005, 'lng', -86.8, 'accuracy_m', 2.5, 'altitude_m', null, 'gps_samples', 4,
    'position_captured_at', '2026-11-01T00:00:00Z', 'position_source', 'gps_avg', 'position_extra', '{"fixQuality":"gps"}'::jsonb,
    'fields', '{"pole_tag":"T1"}'::jsonb, 'ai_meta', '{}'::jsonb, 'icon_scale', 1, 'status', 'draft', 'notes', '',
    'possible_duplicate_of', dup, 'ai_report', '{"summary":"Wood pole","warnings":[]}'::jsonb,
    'created_at', '2026-11-01T00:00:00Z', 'client_updated_at', cua, 'deleted_at', null);
$$;
create function ts.span(id uuid, org uuid, project uuid, a uuid, b uuid, cua text) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', id, 'org_id', org, 'project_id', project, 'from_node_id', a, 'to_node_id', b, 'kind', 'aerial',
    'slack_ft', 0, 'sag_pct', 2, 'length_override_ft', null, 'fields', '{}'::jsonb,
    'created_at', '2026-11-01T00:00:00Z', 'client_updated_at', cua, 'deleted_at', null);
$$;
create function ts.photo(id uuid, org uuid, project uuid, node uuid, cua text) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', id, 'org_id', org, 'project_id', project, 'node_id', node,
    'storage_path', org::text || '/' || project::text || '/' || id::text || '.jpg', 'watermarked_path', null,
    'width', 2048, 'height', 1536, 'taken_at', '2026-11-01T00:00:00Z', 'fix', null, 'is_primary', true,
    'created_at', '2026-11-01T00:00:00Z', 'client_updated_at', cua, 'deleted_at', null);
$$;

grant execute on all functions in schema ts to authenticated, service_role;

-- Users: Sam (owner), Tina (tech), Vic (viewer) share org S. Oscar owns org O.
insert into auth.users (id, email) values
  ('5a000000-0000-4000-8000-000000000001', 'sam@sync.test'),
  ('5a000000-0000-4000-8000-000000000002', 'tina@sync.test'),
  ('5a000000-0000-4000-8000-000000000003', 'vic@sync.test'),
  ('5a000000-0000-4000-8000-000000000004', 'oscar@sync.test');

\set sam  '5a000000-0000-4000-8000-000000000001'
\set tina '5a000000-0000-4000-8000-000000000002'
\set vic  '5a000000-0000-4000-8000-000000000003'
\set oscar '5a000000-0000-4000-8000-000000000004'
\set tpl  '5b000000-0000-4000-8000-0000000000a1'
\set prj  '5b000000-0000-4000-8000-0000000000b1'
\set n1   '5b000000-0000-4000-8000-0000000000c1'
\set n2   '5b000000-0000-4000-8000-0000000000c2'
\set n3   '5b000000-0000-4000-8000-0000000000c3'
\set n4   '5b000000-0000-4000-8000-0000000000c4'
\set s12  '5b000000-0000-4000-8000-0000000000d1'
\set s23  '5b000000-0000-4000-8000-0000000000d2'
\set ph2  '5b000000-0000-4000-8000-0000000000e2'

-- ---------- org setup ----------
select ts.login(:'sam', 'sam@sync.test');
set role authenticated;
select public.create_organization('Sync Test Co') as org_s \gset
insert into public.org_invites (org_id, email, role, invited_by) values
  (:'org_s', 'tina@sync.test', 'tech', :'sam'), (:'org_s', 'vic@sync.test', 'viewer', :'sam');
select token as tina_tok from public.org_invites where email = 'tina@sync.test' \gset
select token as vic_tok from public.org_invites where email = 'vic@sync.test' \gset
reset role;

select ts.login(:'tina', 'tina@sync.test'); set role authenticated;
select public.accept_invite(:'tina_tok'); reset role;
select ts.login(:'vic', 'vic@sync.test'); set role authenticated;
select public.accept_invite(:'vic_tok'); reset role;
select ts.login(:'oscar', 'oscar@sync.test'); set role authenticated;
select public.create_organization('Other Co') as org_o \gset
reset role;

-- ---------- Sam pushes a template and a project ----------
select ts.login(:'sam', 'sam@sync.test'); set role authenticated;
select public.sync_push(:'org_s', jsonb_build_object(
  'client_templates', jsonb_build_array(ts.tpl(:'tpl', :'org_s', '2026-11-01T10:00:00Z')),
  'projects', jsonb_build_array(ts.proj(:'prj', :'org_s', :'tpl', 'Main St', '2026-11-01T10:00:00Z')))) as r \gset
select ts.ok('owner pushes template', ts.st(:'r', 'client_templates', :'tpl') = 'ok');
select ts.ok('owner pushes project', ts.st(:'r', 'projects', :'prj') = 'ok');
select ts.ok('push returns a rev', (ts.res(:'r', 'projects', :'prj') ->> 'rev')::bigint > 0);
select ts.ok('created_by forced to pusher', (select created_by from public.projects where id = :'prj') = :'sam');
reset role;

-- ---------- Tina (tech) pulls from scratch, then captures ----------
select ts.login(:'tina', 'tina@sync.test'); set role authenticated;
select ts.pull_all(:'org_s', '{}') as p \gset
select ts.ok('tech pulls template', ts.cnt(:'p', 'client_templates') = 1);
select ts.ok('tech pulls project', ts.cnt(:'p', 'projects') = 1);
select ts.ok('pulled row has no geom/sync_txid', not (ts.find(:'p', 'projects', :'prj') ?| array['geom', 'sync_txid']));
select :'p'::jsonb -> 'cursor' as tina_cur \gset

select public.sync_push(:'org_s', jsonb_build_object(
  'nodes', jsonb_build_array(
    ts.node(:'n1', :'org_s', :'prj', 1, 'P-1', '2026-11-01T11:00:00Z'),
    ts.node(:'n2', :'org_s', :'prj', 2, 'P-2', '2026-11-01T11:00:01Z')),
  'spans', jsonb_build_array(
    ts.span(:'s12', :'org_s', :'prj', :'n1', :'n2', '2026-11-01T11:00:02Z')),
  'photos', jsonb_build_array(
    ts.photo(:'ph2', :'org_s', :'prj', :'n2', '2026-11-01T11:00:03Z')))) as r \gset
select ts.ok('tech pushes nodes', ts.st(:'r', 'nodes', :'n1') = 'ok' and ts.st(:'r', 'nodes', :'n2') = 'ok');
select ts.ok('tech pushes span', ts.st(:'r', 'spans', :'s12') = 'ok');
select ts.ok('tech pushes photo', ts.st(:'r', 'photos', :'ph2') = 'ok');
select ts.ok('span geometry built', (select geom is not null from public.spans where id = :'s12'));
select ts.ok('ai_report stored', (select ai_report ->> 'summary' from public.nodes where id = :'n1') = 'Wood pole');

-- A tech may not create projects: rejected with a reason, other rows in the batch still apply.
select public.sync_push(:'org_s', jsonb_build_object(
  'projects', jsonb_build_array(ts.proj('5b000000-0000-4000-8000-0000000000b9', :'org_s', null, 'Tech project', '2026-11-01T11:00:00Z')),
  'nodes', jsonb_build_array(ts.node(:'n3', :'org_s', :'prj', 3, 'P-3', '2026-11-01T11:05:00Z')))) as r \gset
select ts.ok('tech project rejected', ts.st(:'r', 'projects', '5b000000-0000-4000-8000-0000000000b9') = 'rejected');
select ts.ok('rejection carries sqlstate 42501', ts.res(:'r', 'projects', '5b000000-0000-4000-8000-0000000000b9') ->> 'code' = '42501');
select ts.ok('rest of batch still applied', ts.st(:'r', 'nodes', :'n3') = 'ok');
select ts.ok('bad id rejected, not fatal',
  (public.sync_push(:'org_s', '{"nodes":[{"id":"nope"}]}'::jsonb) -> 'results' -> 'nodes' -> 0 ->> 'status') = 'rejected');
reset role;

-- ---------- Sam pulls and sees Tina's work ----------
select ts.login(:'sam', 'sam@sync.test'); set role authenticated;
select ts.pull_all(:'org_s', '{}') as p \gset
select ts.ok('owner pulls 3 nodes', ts.cnt(:'p', 'nodes') = 3);
select ts.ok('owner pulls span and photo', ts.cnt(:'p', 'spans') = 1 and ts.cnt(:'p', 'photos') = 1);
select ts.ok('rows ordered, photo path kept', ts.find(:'p', 'photos', :'ph2') ->> 'storage_path' like :'org_s' || '/%');
select :'p'::jsonb -> 'cursor' as sam_cur \gset
select ts.ok('caught-up pull returns nothing new',
  (select ts.cnt(ts.pull_all(:'org_s', :'sam_cur'), 'nodes') + ts.cnt(ts.pull_all(:'org_s', :'sam_cur'), 'projects')) = 0);

-- ---------- Conflicting edits: last write (device clock) wins ----------
select public.sync_push(:'org_s', jsonb_build_object('nodes', jsonb_build_array(
  ts.node(:'n1', :'org_s', :'prj', 1, 'SAM', '2026-11-01T12:00:00Z')))) as r \gset
select ts.ok('sam edit ok', ts.st(:'r', 'nodes', :'n1') = 'ok');
reset role;

select ts.login(:'tina', 'tina@sync.test'); set role authenticated;
-- Tina edited offline EARLIER than Sam, and syncs later: she loses and gets Sam's row back.
select public.sync_push(:'org_s', jsonb_build_object('nodes', jsonb_build_array(
  ts.node(:'n1', :'org_s', :'prj', 1, 'TINA-OLD', '2026-11-01T11:30:00Z')))) as r \gset
select ts.ok('older edit is stale', ts.st(:'r', 'nodes', :'n1') = 'stale');
select ts.ok('stale result returns the winning row', ts.res(:'r', 'nodes', :'n1') -> 'row' ->> 'label' = 'SAM');
select ts.ok('server kept newer label', (select label from public.nodes where id = :'n1') = 'SAM');
-- Tina edits LATER than Sam: she wins.
select public.sync_push(:'org_s', jsonb_build_object('nodes', jsonb_build_array(
  ts.node(:'n1', :'org_s', :'prj', 1, 'TINA-NEW', '2026-11-01T12:30:00Z')))) as r \gset
select ts.ok('newer edit wins', ts.st(:'r', 'nodes', :'n1') = 'ok'
  and (select label from public.nodes where id = :'n1') = 'TINA-NEW');
-- Tina's incremental pull sees her own and Sam's changes (n1 once, at its latest version).
select ts.pull_all(:'org_s', :'tina_cur') as p \gset
select ts.ok('incremental pull has latest n1', ts.find(:'p', 'nodes', :'n1') ->> 'label' = 'TINA-NEW');
select ts.ok('incremental pull has no template change', ts.cnt(:'p', 'client_templates') = 0);
select :'p'::jsonb -> 'cursor' as tina_cur \gset
reset role;

-- ---------- Tombstones ----------
select ts.login(:'sam', 'sam@sync.test'); set role authenticated;
select public.sync_push(:'org_s', jsonb_build_object('nodes', jsonb_build_array(
  jsonb_build_object('id', :'n2', 'org_id', :'org_s', 'deleted_at', '2026-11-01T13:00:00Z',
                     'client_updated_at', '2026-11-01T13:00:00Z')))) as r \gset
select ts.ok('partial tombstone accepted', ts.st(:'r', 'nodes', :'n2') = 'ok');
select ts.ok('cascade tombstoned the span', (select deleted_at is not null from public.spans where id = :'s12'));
select ts.ok('cascade tombstoned the photo', (select deleted_at is not null from public.photos where id = :'ph2'));
select ts.ok('soft delete keeps the row', (select count(*) from public.nodes where id = :'n2') = 1);
select ts.ok('tombstone for unknown row is gone',
  ts.st(public.sync_push(:'org_s', jsonb_build_object('spans', jsonb_build_array(jsonb_build_object(
    'id', '5b000000-0000-4000-8000-0000000000ff', 'deleted_at', '2026-11-01T13:00:00Z')))),
    'spans', '5b000000-0000-4000-8000-0000000000ff') = 'gone');
reset role;

select ts.login(:'tina', 'tina@sync.test'); set role authenticated;
select ts.pull_all(:'org_s', :'tina_cur') as p \gset
select ts.ok('tech pulls node tombstone', ts.find(:'p', 'nodes', :'n2') ->> 'deleted_at' is not null);
select ts.ok('tech pulls cascaded span tombstone', ts.find(:'p', 'spans', :'s12') ->> 'deleted_at' is not null);
select ts.ok('tech pulls cascaded photo tombstone', ts.find(:'p', 'photos', :'ph2') ->> 'deleted_at' is not null);
select :'p'::jsonb -> 'cursor' as tina_cur \gset
-- Deletes win: an offline edit made after the delete does not resurrect the node.
select public.sync_push(:'org_s', jsonb_build_object('nodes', jsonb_build_array(
  ts.node(:'n2', :'org_s', :'prj', 2, 'EDIT-AFTER-DELETE', '2026-11-01T14:00:00Z')))) as r \gset
select ts.ok('edit of deleted node refused', ts.st(:'r', 'nodes', :'n2') = 'deleted');
select ts.ok('refusal returns the tombstone', ts.res(:'r', 'nodes', :'n2') -> 'row' ->> 'deleted_at' is not null);
-- A new span hanging off the deleted node is refused as parent_deleted.
select public.sync_push(:'org_s', jsonb_build_object('spans', jsonb_build_array(
  ts.span(:'s23', :'org_s', :'prj', :'n2', :'n3', '2026-11-01T14:00:00Z')))) as r \gset
select ts.ok('span to deleted node refused', ts.st(:'r', 'spans', :'s23') = 'deleted'
  and ts.res(:'r', 'spans', :'s23') ->> 'reason' = 'parent_deleted');
-- Tombstone of an already deleted row is simply acknowledged.
select ts.ok('repeat tombstone ok', ts.st(public.sync_push(:'org_s', jsonb_build_object('nodes', jsonb_build_array(
  jsonb_build_object('id', :'n2', 'deleted_at', '2026-11-01T15:00:00Z', 'client_updated_at', '2026-11-01T15:00:00Z')))),
  'nodes', :'n2') = 'ok');

-- Duplicate link to a node later in the same batch is set after both exist.
select public.sync_push(:'org_s', jsonb_build_object('nodes', jsonb_build_array(
  ts.node(:'n4', :'org_s', :'prj', 4, 'P-4', '2026-11-01T16:00:00Z', '5b000000-0000-4000-8000-0000000000c5'),
  ts.node('5b000000-0000-4000-8000-0000000000c5', :'org_s', :'prj', 5, 'P-5', '2026-11-01T16:00:00Z')))) as r \gset
select ts.ok('forward duplicate link resolved',
  (select possible_duplicate_of from public.nodes where id = :'n4') = '5b000000-0000-4000-8000-0000000000c5'
  and (ts.res(:'r', 'nodes', :'n4') ->> 'rev')::bigint = (select rev from public.nodes where id = :'n4'));
reset role;

-- ---------- Paging and cursor reset ----------
select ts.login(:'sam', 'sam@sync.test'); set role authenticated;
select ts.pull_all(:'org_s', '{}', 1) as p1 \gset
select ts.pull_all(:'org_s', '{}', 500) as p500 \gset
select ts.ok('paging with limit 1 returns the same rows',
  ts.cnt(:'p1', 'nodes') = ts.cnt(:'p500', 'nodes') and ts.cnt(:'p1', 'nodes') = 5
  and (:'p1'::jsonb ->> 'pages')::int > 3);
select ts.ok('cursor ahead of database asks for reset',
  (public.sync_pull(:'org_s', '{"nodes":{"txid":"99999999999","rev":1}}', 10) ->> 'reset')::boolean);
reset role;

-- ---------- Roles and isolation ----------
select set_config('ts.org_s', :'org_s', false);
select ts.login(:'vic', 'vic@sync.test'); set role authenticated;
select ts.ok('viewer can pull', ts.cnt(ts.pull_all(:'org_s', '{}'), 'nodes') = 5);
select public.sync_push(:'org_s', jsonb_build_object('nodes', jsonb_build_array(
  ts.node(:'n3', :'org_s', :'prj', 3, 'VIEWER', '2027-01-01T00:00:00Z')))) as r \gset
select ts.ok('viewer edit rejected', ts.st(:'r', 'nodes', :'n3') = 'rejected');
reset role;

select ts.login(:'oscar', 'oscar@sync.test'); set role authenticated;
do $$
begin
  begin
    perform public.sync_pull('5a000000-0000-4000-8000-00000000ffff'::uuid, '{}', 10);
    raise exception 'SYNC TEST FAIL: pull of unknown org allowed';
  exception when insufficient_privilege then
    raise warning 'ok: pull of a non-member org blocked';
  end;
end $$;
do $$
begin
  begin
    perform public.sync_pull(current_setting('ts.org_s')::uuid, '{}', 10);
    raise exception 'SYNC TEST FAIL: other org pulled org S';
  exception when insufficient_privilege then
    raise warning 'ok: other org cannot pull org S';
  end;
  begin
    perform public.sync_push(current_setting('ts.org_s')::uuid, '{}'::jsonb);
    raise exception 'SYNC TEST FAIL: other org pushed to org S';
  exception when insufficient_privilege then
    raise warning 'ok: other org cannot push to org S';
  end;
end $$;
select ts.ok('other org pull sees none of org S',
  (select ts.cnt(p, 'nodes') + ts.cnt(p, 'projects') + ts.cnt(p, 'photos') from ts.pull_all(:'org_o', '{}') p) = 0);
-- Rows claiming org S inside an org O push are refused.
select public.sync_push(:'org_o', jsonb_build_object('nodes', jsonb_build_array(
  ts.node(:'n1', :'org_s', :'prj', 1, 'HIJACK', '2030-01-01T00:00:00Z')))) as r \gset
select ts.ok('foreign org_id refused', ts.st(:'r', 'nodes', :'n1') = 'rejected');
-- Same id relabelled as org O: the existing row is invisible and cannot be overwritten.
select public.sync_push(:'org_o', jsonb_build_object('nodes', jsonb_build_array(
  ts.node(:'n1', :'org_o', :'prj', 1, 'HIJACK', '2030-01-01T00:00:00Z')))) as r \gset
select ts.ok('id collision with another org refused', ts.st(:'r', 'nodes', :'n1') = 'rejected');
reset role;
select ts.ok('org S node untouched', (select label from public.nodes where id = :'n1') = 'TINA-NEW');

-- Oversized batch
select ts.login(:'sam', 'sam@sync.test'); set role authenticated;
do $$
begin
  begin
    perform public.sync_push(current_setting('ts.org_s')::uuid,
      jsonb_build_object('nodes', (select jsonb_agg(jsonb_build_object('id', gen_random_uuid())) from generate_series(1, 1001))));
    raise exception 'SYNC TEST FAIL: oversized push accepted';
  exception when invalid_parameter_value then
    raise warning 'ok: oversized push refused';
  end;
end $$;
reset role;

-- Signed-out callers cannot use the RPCs at all.
select set_config('request.jwt.claims', '', false);
set role anon;
do $$
begin
  begin
    perform public.sync_pull(current_setting('ts.org_s')::uuid, '{}', 10);
    raise exception 'SYNC TEST FAIL: anon pulled';
  exception when insufficient_privilege then
    raise warning 'ok: anon cannot call sync_pull';
  end;
end $$;
reset role;
