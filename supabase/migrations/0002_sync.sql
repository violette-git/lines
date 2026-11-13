-- LineMap Pro: Phase 2 live sync (push / pull RPCs).
--
-- What this adds
--   * nodes.ai_report               the phone's last AI analysis summary per node
--   * <table>.sync_txid             id of the transaction that last wrote the row (pull cursor)
--   * soft-delete cascade           deleting a project or node tombstones its children
--   * sync_push(org, changes)       upload a batch of changed rows (last-write-wins, tombstones)
--   * sync_pull(org, since, row_limit)  download rows changed since a cursor, per table
--
-- Why the pull cursor is (sync_txid, rev) and not rev alone
--   rev comes from one shared sequence, but sequence numbers are taken when a row is written, not
--   when its transaction commits. Transaction A can take rev 10, transaction B rev 11, and B can
--   commit first. A phone pulling between those commits would see rev 11, move its cursor past
--   10, and never receive A's row.
--
--   Fix: every write stamps the writing transaction id (pg_current_xact_id(), a 64-bit xid8 that
--   never wraps). sync_pull reads the current snapshot's xmin: the oldest transaction that is
--   still running. Every transaction id below xmin has finished (committed or rolled back), and
--   any future write will carry a transaction id at or above xmin. So "all rows with
--   sync_txid < xmin" is a final, gap-free set. The pull only returns rows below that watermark,
--   ordered by (sync_txid, rev), and the cursor is the (sync_txid, rev) of the last row returned
--   (or (xmin, 0) once a table is caught up). An update gives the row a new, higher sync_txid,
--   so changed rows come back on the next pull. Nothing is skipped and no overlap or dedupe is
--   needed. Cost: a long-running transaction delays (never loses) pulls until it finishes.
--   Rejected alternatives: a time-based "ignore the last N seconds" window (still loses rows if
--   a commit takes longer than N) and overlap re-pulls (same problem, plus duplicate traffic).
--
--   If the database is ever restored from a dump (transaction ids restart), a phone's cursor
--   can be ahead of the server. sync_pull detects that and answers {"reset": true}; the phone
--   then clears its cursors and pulls everything again (its unsynced edits are kept).
--
-- Conflict rules (enforced here and by tg_sync_stamp from 0001)
--   * Last write wins on client_updated_at (device clock of the edit). An older edit is skipped
--     and sync_push answers "stale" with the server's current row so the phone can converge.
--   * Deletes win: once a row is tombstoned (deleted_at set), a live edit of it is refused with
--     "deleted" and the tombstone is returned. Live rows whose project or node is tombstoned
--     are refused the same way. A tombstone is never "stale": it wins over a live edit even when
--     that edit has a later device clock. Restores are an office action (dashboard), not a phone action.
--   * Deleting a project tombstones its nodes, spans and photos; deleting a node tombstones its
--     spans and photos, so other phones learn about every removed row.

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
alter table public.nodes add column if not exists ai_report jsonb;

alter table public.client_templates add column if not exists sync_txid xid8 not null default '0';
alter table public.projects         add column if not exists sync_txid xid8 not null default '0';
alter table public.nodes            add column if not exists sync_txid xid8 not null default '0';
alter table public.spans            add column if not exists sync_txid xid8 not null default '0';
alter table public.photos           add column if not exists sync_txid xid8 not null default '0';

create index if not exists client_templates_org_txid_idx on public.client_templates (org_id, sync_txid, rev);
create index if not exists projects_org_txid_idx         on public.projects (org_id, sync_txid, rev);
create index if not exists nodes_org_txid_idx            on public.nodes (org_id, sync_txid, rev);
create index if not exists spans_org_txid_idx            on public.spans (org_id, sync_txid, rev);
create index if not exists photos_org_txid_idx           on public.photos (org_id, sync_txid, rev);

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

-- Runs right after t10_sync_stamp (triggers fire in name order). If t10 skipped a stale write by
-- returning null, this trigger does not run either.
create or replace function public.tg_sync_txid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.sync_txid := pg_current_xact_id();
  return new;
end;
$$;

create trigger t11_sync_txid before insert or update on public.client_templates
  for each row execute function public.tg_sync_txid();
create trigger t11_sync_txid before insert or update on public.projects
  for each row execute function public.tg_sync_txid();
create trigger t11_sync_txid before insert or update on public.nodes
  for each row execute function public.tg_sync_txid();
create trigger t11_sync_txid before insert or update on public.spans
  for each row execute function public.tg_sync_txid();
create trigger t11_sync_txid before insert or update on public.photos
  for each row execute function public.tg_sync_txid();

-- Soft-delete cascade. SECURITY DEFINER for the same reason as tg_node_moved: the children are in
-- the same org by construction (composite foreign keys), so this crosses no tenant boundary.
-- client_updated_at is raised to at least the parent's so last-write-wins accepts the change.
create or replace function public.tg_soft_delete_cascade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'projects' then
    update public.nodes c
       set deleted_at = new.deleted_at,
           client_updated_at = greatest(c.client_updated_at, new.client_updated_at)
     where c.org_id = new.org_id and c.project_id = new.id and c.deleted_at is null;
    update public.spans c
       set deleted_at = new.deleted_at,
           client_updated_at = greatest(c.client_updated_at, new.client_updated_at)
     where c.org_id = new.org_id and c.project_id = new.id and c.deleted_at is null;
    update public.photos c
       set deleted_at = new.deleted_at,
           client_updated_at = greatest(c.client_updated_at, new.client_updated_at)
     where c.org_id = new.org_id and c.project_id = new.id and c.deleted_at is null;
  elsif tg_table_name = 'nodes' then
    update public.spans c
       set deleted_at = new.deleted_at,
           client_updated_at = greatest(c.client_updated_at, new.client_updated_at)
     where c.org_id = new.org_id and (c.from_node_id = new.id or c.to_node_id = new.id)
       and c.deleted_at is null;
    update public.photos c
       set deleted_at = new.deleted_at,
           client_updated_at = greatest(c.client_updated_at, new.client_updated_at)
     where c.org_id = new.org_id and c.node_id = new.id and c.deleted_at is null;
  end if;
  return null;
end;
$$;

create trigger t30_soft_delete_cascade after update of deleted_at on public.projects
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.tg_soft_delete_cascade();
create trigger t30_soft_delete_cascade after update of deleted_at on public.nodes
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.tg_soft_delete_cascade();

revoke execute on function public.tg_sync_txid() from public, anon, authenticated;
revoke execute on function public.tg_soft_delete_cascade() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- sync_push
-- ---------------------------------------------------------------------------------------------
-- changes: { "client_templates": [row...], "projects": [...], "nodes": [...], "spans": [...],
--            "photos": [...] }  (any key may be missing). Rows use the server column names; only
--            the writable columns listed below are used, others are ignored. A row may be partial
--            (for example a tombstone {id, org_id, deleted_at, client_updated_at}).
-- Returns: { "results": { "<table>": [ { "id", "status", "rev"?, "reason"?, "code"?, "row"? } ] } }
--   status ok        written; rev is the row's new server revision
--          stale     an edit with a newer client_updated_at is already stored; row = server row
--          deleted   the row (or its project/node) is deleted on the server; row = server row
--          gone      a tombstone for a row the server never had (nothing to do)
--          rejected  refused (permission, bad data, missing parent...); reason/code explain
-- SECURITY INVOKER: every write goes through the caller's row-level security policies.
create or replace function public.sync_push(org uuid, changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tables constant text[] := array['client_templates', 'projects', 'nodes', 'spans', 'photos'];
  v_cols jsonb := jsonb_build_object(
    'client_templates', jsonb_build_array('id', 'org_id', 'name', 'client', 'label_patterns', 'required_fields',
      'defaults', 'default_span_kind', 'default_sag_pct', 'default_slack_ft', 'rate_per_foot', 'rate_per_node',
      'watermark_photos', 'created_at', 'client_updated_at', 'deleted_at'),
    'projects', jsonb_build_array('id', 'org_id', 'name', 'client', 'job_number', 'work_type', 'notes', 'status',
      'rate_per_foot', 'rate_per_node', 'template_id', 'walk_mode', 'created_at', 'client_updated_at', 'deleted_at'),
    'nodes', jsonb_build_array('id', 'org_id', 'project_id', 'seq', 'type', 'label', 'lat', 'lng', 'accuracy_m',
      'altitude_m', 'gps_samples', 'position_captured_at', 'position_source', 'position_extra', 'fields', 'ai_meta',
      'icon_scale', 'status', 'notes', 'possible_duplicate_of', 'ai_report', 'created_at', 'client_updated_at',
      'deleted_at'),
    'spans', jsonb_build_array('id', 'org_id', 'project_id', 'from_node_id', 'to_node_id', 'kind', 'slack_ft',
      'sag_pct', 'length_override_ft', 'fields', 'created_at', 'client_updated_at', 'deleted_at'),
    'photos', jsonb_build_array('id', 'org_id', 'project_id', 'node_id', 'storage_path', 'watermarked_path', 'width',
      'height', 'taken_at', 'fix', 'is_primary', 'created_at', 'client_updated_at', 'deleted_at')
  );
  v_res jsonb := '{}'::jsonb;        -- { table: { id: result } }
  v_deferred_dups jsonb := '[]'::jsonb;  -- [{id, dup}] node duplicate links to set after all nodes
  v_total integer := 0;
  v_n integer := 0;
  v_tbl text;
  v_row jsonb;
  v_id uuid;
  v_existing jsonb;
  v_current jsonb;
  v_deleting boolean;
  v_rev bigint;
  v_cols_list text;
  v_vals_list text;
  v_set_list text;
  v_parent_deleted boolean;
  v_item jsonb;
  v_out jsonb := '{}'::jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if org is null or not public.is_org_member(org) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    raise exception 'changes must be a JSON object' using errcode = '22023';
  end if;

  foreach v_tbl in array v_tables loop
    if changes ? v_tbl and jsonb_typeof(changes -> v_tbl) <> 'array' then
      raise exception '% must be an array', v_tbl using errcode = '22023';
    end if;
    v_total := v_total + coalesce(jsonb_array_length(changes -> v_tbl), 0);
  end loop;
  if v_total > 1000 then
    raise exception 'Too many rows in one push (% > 1000)', v_total using errcode = '22023';
  end if;

  foreach v_tbl in array v_tables loop
    v_res := jsonb_set(v_res, array[v_tbl], '{}'::jsonb);

    for v_row in select e.value from jsonb_array_elements(coalesce(changes -> v_tbl, '[]'::jsonb)) e loop
      v_id := null;
      v_n := v_n + 1;
      begin  -- one subtransaction per row: a bad row is reported, the rest still go through
        if jsonb_typeof(v_row) <> 'object' then
          raise exception 'Each row must be an object' using errcode = '22023';
        end if;
        v_id := public.try_uuid(v_row ->> 'id');
        if v_id is null then
          raise exception 'Row id is missing or not a uuid' using errcode = '22023';
        end if;
        if v_row ? 'org_id' and (v_row ->> 'org_id') is distinct from org::text then
          raise exception 'Row belongs to a different organization' using errcode = '42501';
        end if;
        -- Keep only writable columns; org_id is always the org being synced.
        select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb) into v_row
          from jsonb_each(v_row) k
         where (v_cols -> v_tbl) ? k.key;
        v_row := v_row || jsonb_build_object('org_id', org);
        v_deleting := (v_row ->> 'deleted_at') is not null;

        execute format('select to_jsonb(t) - ''geom'' - ''sync_txid'' from public.%I t where t.id = $1', v_tbl)
          into v_existing using v_id;

        if v_existing is null and v_deleting then
          v_res := jsonb_set(v_res, array[v_tbl, v_id::text],
            jsonb_build_object('id', v_id, 'status', 'gone'));
          continue;
        end if;
        if v_existing is not null and (v_existing ->> 'deleted_at') is not null then
          -- Already deleted here. A tombstone is simply acknowledged; a live edit loses (deletes win).
          v_res := jsonb_set(v_res, array[v_tbl, v_id::text],
            case when v_deleting
              then jsonb_build_object('id', v_id, 'status', 'ok', 'rev', (v_existing ->> 'rev')::bigint)
              else jsonb_build_object('id', v_id, 'status', 'deleted', 'reason', 'deleted', 'row', v_existing)
            end);
          continue;
        end if;

        if v_deleting and v_existing is not null then
          -- Deletes win, even over a live edit with a later device clock: without this the
          -- tombstone would come back "stale", the phone would keep its pending delete (it also
          -- treats deletes as winning) and push it again on every sync, forever.
          v_row := jsonb_set(v_row, '{client_updated_at}', to_jsonb(greatest(
            coalesce((v_row ->> 'client_updated_at')::timestamptz, now()),
            (v_existing ->> 'client_updated_at')::timestamptz)));
        end if;

        if not v_deleting then
          -- Live rows may not hang off a deleted project or node.
          v_parent_deleted := false;
          if v_tbl in ('nodes', 'spans', 'photos') then
            select exists (select 1 from public.projects p
                            where p.id = public.try_uuid(coalesce(v_row ->> 'project_id', v_existing ->> 'project_id'))
                              and p.deleted_at is not null)
              into v_parent_deleted;
          end if;
          if not v_parent_deleted and v_tbl = 'spans' then
            select exists (select 1 from public.nodes n
                            where n.id in (public.try_uuid(coalesce(v_row ->> 'from_node_id', v_existing ->> 'from_node_id')),
                                           public.try_uuid(coalesce(v_row ->> 'to_node_id', v_existing ->> 'to_node_id')))
                              and n.deleted_at is not null)
              into v_parent_deleted;
          end if;
          if not v_parent_deleted and v_tbl = 'photos' then
            select exists (select 1 from public.nodes n
                            where n.id = public.try_uuid(coalesce(v_row ->> 'node_id', v_existing ->> 'node_id'))
                              and n.deleted_at is not null)
              into v_parent_deleted;
          end if;
          if v_parent_deleted then
            v_res := jsonb_set(v_res, array[v_tbl, v_id::text],
              jsonb_build_object('id', v_id, 'status', 'deleted', 'reason', 'parent_deleted', 'row', v_existing));
            continue;
          end if;
        end if;

        -- Optional references that may not have reached the server: write null instead of failing.
        if v_tbl = 'projects' and (v_row ->> 'template_id') is not null
           and not exists (select 1 from public.client_templates c
                            where c.id = public.try_uuid(v_row ->> 'template_id') and c.org_id = org) then
          v_row := jsonb_set(v_row, '{template_id}', 'null'::jsonb);
        end if;
        if v_tbl = 'nodes' and (v_row ->> 'possible_duplicate_of') is not null
           and not exists (select 1 from public.nodes n
                            where n.id = public.try_uuid(v_row ->> 'possible_duplicate_of') and n.org_id = org) then
          -- The other node may come later in this batch: link it once all nodes are in.
          v_deferred_dups := v_deferred_dups || jsonb_build_array(
            jsonb_build_object('id', v_id, 'dup', v_row ->> 'possible_duplicate_of'));
          v_row := jsonb_set(v_row, '{possible_duplicate_of}', 'null'::jsonb);
        end if;

        select string_agg(format('%I', k), ', '),
               string_agg(format('r.%I', k), ', '),
               string_agg(
                 case
                   when v_tbl = 'photos' and k in ('storage_path', 'watermarked_path')
                     then format('%I = coalesce(excluded.%I, t.%I)', k, k, k)
                   else format('%I = excluded.%I', k, k)
                 end, ', ') filter (where k <> 'id')
          into v_cols_list, v_vals_list, v_set_list
          from jsonb_object_keys(v_row) k;

        v_rev := null;
        if v_existing is null then
          -- New row (a full row is expected). ON CONFLICT covers a concurrent insert of the same id.
          execute format(
            'insert into public.%I as t (%s) select %s from jsonb_populate_record(null::public.%I, $1) r '
            'on conflict (id) do update set %s returning t.rev',
            v_tbl, v_cols_list, v_vals_list, v_tbl, v_set_list)
            into v_rev using v_row;
        else
          -- Existing row: a plain UPDATE, so partial rows (tombstones) work. Insert would check
          -- NOT NULL columns of the proposed new row before noticing the conflict.
          execute format(
            'update public.%I as t set %s from jsonb_populate_record(null::public.%I, $1) as excluded '
            'where t.id = $2 returning t.rev',
            v_tbl, v_set_list, v_tbl)
            into v_rev using v_row, v_id;
        end if;

        if v_rev is null then
          execute format('select to_jsonb(t) - ''geom'' - ''sync_txid'' from public.%I t where t.id = $1', v_tbl)
            into v_current using v_id;
          if v_current is not null and (v_row ->> 'client_updated_at') is not null
             and (v_current ->> 'client_updated_at')::timestamptz > (v_row ->> 'client_updated_at')::timestamptz then
            -- tg_sync_stamp skipped it: the stored edit is newer.
            v_res := jsonb_set(v_res, array[v_tbl, v_id::text],
              jsonb_build_object('id', v_id, 'status', 'stale', 'reason', 'newer_edit_on_server', 'row', v_current));
          else
            -- Row-level security filtered the update out (the caller's role may not edit it).
            raise exception 'You do not have permission to change this record' using errcode = '42501';
          end if;
        else
          v_res := jsonb_set(v_res, array[v_tbl, v_id::text],
            jsonb_build_object('id', v_id, 'status', 'ok', 'rev', v_rev));
        end if;
      exception when others then
        v_res := jsonb_set(v_res, array[v_tbl, coalesce(v_id::text, 'invalid-' || v_n::text)],
          jsonb_build_object('id', v_id, 'status', 'rejected', 'reason', sqlerrm, 'code', sqlstate));
      end;
    end loop;

    if v_tbl = 'nodes' then
      -- Second pass for duplicate links whose target arrived later in the same batch.
      for v_item in select e.value from jsonb_array_elements(v_deferred_dups) e loop
        begin
          update public.nodes n
             set possible_duplicate_of = (v_item ->> 'dup')::uuid
           where n.id = (v_item ->> 'id')::uuid
             and n.possible_duplicate_of is null
             and exists (select 1 from public.nodes d where d.id = (v_item ->> 'dup')::uuid and d.org_id = org)
          returning n.rev into v_rev;
          if v_rev is not null and (v_res -> 'nodes' -> (v_item ->> 'id') ->> 'status') = 'ok' then
            v_res := jsonb_set(v_res, array['nodes', v_item ->> 'id', 'rev'], to_jsonb(v_rev));
          end if;
        exception when others then
          null;  -- the link is a hint only; never fail the push for it
        end;
      end loop;
    end if;
  end loop;

  foreach v_tbl in array v_tables loop
    v_out := v_out || jsonb_build_object(v_tbl,
      (select coalesce(jsonb_agg(e.value), '[]'::jsonb) from jsonb_each(v_res -> v_tbl) e));
  end loop;
  return jsonb_build_object('results', v_out);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- sync_pull
-- ---------------------------------------------------------------------------------------------
-- since: { "<table>": { "txid": "<xid8 as text>", "rev": <bigint> } } (missing = from the start)
-- row_limit: max rows per table per call (1..2000, default 500)
-- Returns: { "watermark": "<xid8>",
--            "tables": { "<table>": { "rows": [...], "cursor": {"txid","rev"}, "has_more": bool } } }
--   or { "reset": true } when a cursor is ahead of this database (restored from a dump).
-- Rows are complete server rows (without geom / sync_txid), tombstones included, ordered by
-- (sync_txid, rev). Store each table's returned cursor and send it back next time.
create or replace function public.sync_pull(org uuid, since jsonb default '{}'::jsonb, row_limit integer default 500)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tables constant text[] := array['client_templates', 'projects', 'nodes', 'spans', 'photos'];
  v_snap pg_snapshot := pg_current_snapshot();
  v_wm xid8 := pg_snapshot_xmin(v_snap);
  v_next xid8 := pg_snapshot_xmax(v_snap);
  v_lim integer := least(greatest(coalesce(row_limit, 500), 1), 2000);
  v_since jsonb := coalesce(since, '{}'::jsonb);
  v_tbl text;
  v_cur_txid xid8;
  v_cur_rev bigint;
  v_rows jsonb;
  v_count integer;
  v_last_txid xid8;
  v_last_rev bigint;
  v_out jsonb := '{}'::jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if org is null or not public.is_org_member(org) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  if jsonb_typeof(v_since) <> 'object' then
    raise exception 'since must be a JSON object' using errcode = '22023';
  end if;

  foreach v_tbl in array v_tables loop
    v_cur_txid := coalesce(nullif(v_since -> v_tbl ->> 'txid', ''), '0')::xid8;
    v_cur_rev := coalesce((v_since -> v_tbl ->> 'rev')::bigint, 0);
    if v_cur_txid > v_next then
      return jsonb_build_object('reset', true, 'watermark', v_wm::text);
    end if;

    execute format(
      'select coalesce(jsonb_agg(x.j order by x.sync_txid, x.rev), ''[]''::jsonb), count(*)::int, '
      '       (array_agg(x.sync_txid order by x.sync_txid desc, x.rev desc))[1], '
      '       (array_agg(x.rev order by x.sync_txid desc, x.rev desc))[1] '
      '  from (select to_jsonb(t) - ''geom'' - ''sync_txid'' as j, t.sync_txid, t.rev '
      '          from public.%I t '
      '         where t.org_id = $1 and (t.sync_txid, t.rev) > ($2, $3) and t.sync_txid < $4 '
      '         order by t.sync_txid, t.rev '
      '         limit $5) x',
      v_tbl)
      into v_rows, v_count, v_last_txid, v_last_rev
      using org, v_cur_txid, v_cur_rev, v_wm, v_lim;

    if v_count >= v_lim then
      v_out := v_out || jsonb_build_object(v_tbl, jsonb_build_object(
        'rows', v_rows,
        'cursor', jsonb_build_object('txid', v_last_txid::text, 'rev', v_last_rev),
        'has_more', true));
    else
      -- Caught up: everything below the watermark has been delivered.
      if (v_wm, 0::bigint) > (v_cur_txid, v_cur_rev) then
        v_cur_txid := v_wm;
        v_cur_rev := 0;
      end if;
      if v_count > 0 and (v_last_txid, v_last_rev) > (v_cur_txid, v_cur_rev) then
        v_cur_txid := v_last_txid;
        v_cur_rev := v_last_rev;
      end if;
      v_out := v_out || jsonb_build_object(v_tbl, jsonb_build_object(
        'rows', v_rows,
        'cursor', jsonb_build_object('txid', v_cur_txid::text, 'rev', v_cur_rev),
        'has_more', false));
    end if;
  end loop;

  return jsonb_build_object('watermark', v_wm::text, 'tables', v_out);
end;
$$;

revoke execute on function public.sync_push(uuid, jsonb) from public, anon;
revoke execute on function public.sync_pull(uuid, jsonb, integer) from public, anon;
grant execute on function public.sync_push(uuid, jsonb) to authenticated;
grant execute on function public.sync_pull(uuid, jsonb, integer) to authenticated;
