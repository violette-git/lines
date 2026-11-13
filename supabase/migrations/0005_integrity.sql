-- LineMap Pro: data integrity hardening (Phase 2 security review).
--
-- What this adds
--   * photos.storage_path / watermarked_path must be exactly <org_id>/<project_id>/<file name>
--     with a plain file name (no "..", no extra folders). 0001 only checked the prefix, so a row
--     could carry "<org>/<project>/../../<other org>/..." and hand that path to whoever later
--     resolves it (signed links, cleanup jobs, storage backends that normalize paths).
--   * A span's two nodes, and a photo's node, must belong to the span's or photo's own project.
--     The composite foreign keys from 0001 only keep them in the same ORGANIZATION, so a tech
--     could attach a span in project A to nodes of project B (footage billed to the wrong job,
--     and deleting project B would not remove the span).
--   * A node cannot be moved to another project (its spans and photos would be left behind).
--
-- Rows already stored that break these rules are not touched; the checks apply to new writes
-- (the path constraints are added NOT VALID for the same reason, then validated when possible).

-- ---------------------------------------------------------------------------------------------
-- Photo object paths
-- ---------------------------------------------------------------------------------------------
alter table public.photos drop constraint if exists photos_storage_path_format;
alter table public.photos drop constraint if exists photos_watermarked_path_format;
alter table public.photos add constraint photos_storage_path_format check (
  storage_path is null
  or storage_path ~ ('^' || org_id::text || '/' || project_id::text || '/[A-Za-z0-9_-]{1,100}\.(jpg|jpeg|png)$')
) not valid;
alter table public.photos add constraint photos_watermarked_path_format check (
  watermarked_path is null
  or watermarked_path ~ ('^' || org_id::text || '/' || project_id::text || '/[A-Za-z0-9_-]{1,100}\.(jpg|jpeg|png)$')
) not valid;

do $$
begin
  alter table public.photos validate constraint photos_storage_path_format;
  alter table public.photos validate constraint photos_watermarked_path_format;
exception when check_violation then
  raise warning 'photos: some existing rows have unusual storage paths; the new format applies to new writes only';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Same-project references
-- ---------------------------------------------------------------------------------------------
-- SECURITY INVOKER: the caller can read every node of an org they may write to. A node the caller
-- cannot see is not checked here, but then the composite foreign key or row-level security
-- refuses the write anyway.
create or replace function public.tg_same_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'nodes' then
    if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
      raise exception 'A node cannot be moved to another project' using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_table_name = 'spans' then
    if tg_op = 'UPDATE' then
      if new.project_id is not distinct from old.project_id
         and new.from_node_id is not distinct from old.from_node_id
         and new.to_node_id is not distinct from old.to_node_id then
        return new;
      end if;
    end if;
    if exists (select 1 from public.nodes n
                where n.id in (new.from_node_id, new.to_node_id)
                  and n.project_id is distinct from new.project_id) then
      raise exception 'A span can only connect nodes of its own project' using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_table_name = 'photos' then
    if tg_op = 'UPDATE' then
      if new.project_id is not distinct from old.project_id and new.node_id is not distinct from old.node_id then
        return new;
      end if;
    end if;
    if exists (select 1 from public.nodes n
                where n.id = new.node_id and n.project_id is distinct from new.project_id) then
      raise exception 'A photo must belong to the project of its node' using errcode = '23514';
    end if;
    return new;
  end if;

  return new;
end;
$$;

revoke execute on function public.tg_same_project() from public, anon, authenticated;

drop trigger if exists t12_same_project on public.nodes;
drop trigger if exists t12_same_project on public.spans;
drop trigger if exists t12_same_project on public.photos;
create trigger t12_same_project before update of project_id on public.nodes
  for each row execute function public.tg_same_project();
create trigger t12_same_project before insert or update of project_id, from_node_id, to_node_id on public.spans
  for each row execute function public.tg_same_project();
create trigger t12_same_project before insert or update of project_id, node_id on public.photos
  for each row execute function public.tg_same_project();
