// TEST ONLY. In-memory stand-in for sync_push / sync_pull / the photo bucket, following the same
// rules as supabase/migrations/0002_sync.sql: last write wins on client_updated_at, deletes win,
// tombstones cascade from projects and nodes, pull pages ordered by rev with has_more.
import type { AnyServerRow, ServerTable } from '../serverMapping';
import { SERVER_TABLES } from '../serverMapping';
import type {
  PullCursors,
  PullResponse,
  PushChanges,
  PushResponse,
  PushRowResult,
  SyncTransport,
} from '../transport';
import type { Timers } from '../engine';

type Row = AnyServerRow & { rev: number } & Record<string, unknown>;

export class FakeServer {
  rev = 0;
  tables: Record<ServerTable, Map<string, Row>> = {
    client_templates: new Map(),
    projects: new Map(),
    nodes: new Map(),
    spans: new Map(),
    photos: new Map(),
  };
  objects = new Map<string, string>();
  /** Rows of these tables are refused (simulates a role without permission). */
  refuse = new Set<ServerTable>();
  failPushes = 0;
  failUploads = 0;
  resetOnce = false;
  calls = { push: 0, pull: 0, upload: 0 };

  private stamp(table: ServerTable, row: AnyServerRow) {
    const r = { ...row, rev: ++this.rev } as Row;
    this.tables[table].set(r.id, r);
    return r;
  }

  private parentDeleted(table: ServerTable, row: Partial<AnyServerRow> & Record<string, unknown>) {
    const dead = (t: ServerTable, id: unknown) => typeof id === 'string' && !!this.tables[t].get(id)?.deleted_at;
    if (table === 'nodes' || table === 'spans' || table === 'photos') {
      if (dead('projects', row.project_id)) return true;
    }
    if (table === 'spans' && (dead('nodes', row.from_node_id) || dead('nodes', row.to_node_id))) return true;
    if (table === 'photos' && dead('nodes', row.node_id)) return true;
    return false;
  }

  private cascade(table: ServerTable, row: Row) {
    const kill = (t: ServerTable, match: (r: Row) => boolean) => {
      for (const r of [...this.tables[t].values()]) {
        if (!r.deleted_at && match(r)) {
          this.stamp(t, {
            ...r,
            deleted_at: row.deleted_at,
            client_updated_at: r.client_updated_at > row.client_updated_at ? r.client_updated_at : row.client_updated_at,
          });
        }
      }
    };
    const rec = (r: Row) => r as unknown as Record<string, unknown>;
    if (table === 'projects') {
      for (const t of ['nodes', 'spans', 'photos'] as ServerTable[]) kill(t, (r) => rec(r).project_id === row.id);
    } else if (table === 'nodes') {
      kill('spans', (r) => rec(r).from_node_id === row.id || rec(r).to_node_id === row.id);
      kill('photos', (r) => rec(r).node_id === row.id);
    }
  }

  async push(_org: string, changes: PushChanges): Promise<PushResponse> {
    this.calls.push++;
    if (this.failPushes > 0) {
      this.failPushes--;
      throw new Error('Network request failed');
    }
    const results: PushResponse['results'] = {};
    for (const t of SERVER_TABLES) {
      const out: PushRowResult[] = [];
      for (const raw of (changes[t] ?? []) as (Partial<AnyServerRow> & Record<string, unknown>)[]) {
        const id = raw.id as string;
        const existing = this.tables[t].get(id);
        const deleting = raw.deleted_at != null;
        if (this.refuse.has(t)) {
          out.push({ id, status: 'rejected', reason: 'new row violates row-level security policy', code: '42501' });
          continue;
        }
        if (!existing && deleting) {
          out.push({ id, status: 'gone' });
          continue;
        }
        if (existing?.deleted_at) {
          out.push(deleting ? { id, status: 'ok', rev: existing.rev } : { id, status: 'deleted', reason: 'deleted', row: existing });
          continue;
        }
        if (!deleting && this.parentDeleted(t, raw)) {
          out.push({ id, status: 'deleted', reason: 'parent_deleted', row: existing ?? null });
          continue;
        }
        if (existing && raw.client_updated_at && raw.client_updated_at < existing.client_updated_at) {
          out.push({ id, status: 'stale', reason: 'newer_edit_on_server', row: existing });
          continue;
        }
        const row = this.stamp(t, { ...(existing ?? {}), ...raw } as AnyServerRow);
        if (deleting) this.cascade(t, row);
        out.push({ id, status: 'ok', rev: row.rev });
      }
      results[t] = out;
    }
    return { results };
  }

  /** Edits a row directly on the server (like another phone or the office dashboard). */
  edit(table: ServerTable, id: string, patch: Partial<AnyServerRow>) {
    const r = this.tables[table].get(id);
    if (!r) throw new Error(`no ${table} ${id}`);
    const row = this.stamp(table, { ...r, ...patch } as AnyServerRow);
    if (patch.deleted_at) this.cascade(table, row);
    return row;
  }

  async pull(_org: string, since: PullCursors, limit: number): Promise<PullResponse> {
    this.calls.pull++;
    if (this.resetOnce && Object.keys(since).length) {
      this.resetOnce = false;
      return { reset: true };
    }
    const tables: PullResponse['tables'] = {};
    for (const t of SERVER_TABLES) {
      const from = since[t]?.rev ?? 0;
      const all = [...this.tables[t].values()].filter((r) => r.rev > from).sort((a, b) => a.rev - b.rev);
      const rows = all.slice(0, limit);
      const last = rows[rows.length - 1];
      tables[t] = {
        rows: rows.map((r) => ({ ...r })),
        cursor: { txid: '0', rev: last ? last.rev : from },
        has_more: all.length > limit,
      };
    }
    return { watermark: '0', tables };
  }

  transport(): SyncTransport {
    return {
      push: (o, c) => this.push(o, c),
      pull: (o, s, l) => this.pull(o, s, l),
      uploadPhoto: async (path, uri) => {
        this.calls.upload++;
        if (this.failUploads > 0) {
          this.failUploads--;
          throw new Error('upload failed');
        }
        this.objects.set(path, uri);
      },
      signedUrl: async (path) => `https://signed.test/${path}`,
    };
  }
}

/** Deterministic timers for engine tests. */
export class ManualTimers implements Timers {
  now = 0;
  private seq = 0;
  private tasks = new Map<number, { at: number; fn: () => void; every: number | null }>();

  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.now + ms, fn, every: null });
    return id;
  }
  clearTimeout(h: unknown) {
    this.tasks.delete(h as number);
  }
  setInterval(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.now + ms, fn, every: ms });
    return id;
  }
  clearInterval(h: unknown) {
    this.tasks.delete(h as number);
  }
  pending(): number[] {
    return [...this.tasks.values()].map((t) => t.at - this.now).sort((a, b) => a - b);
  }
  /** Moves time forward, firing due tasks in order. */
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due;
      this.now = t.at;
      if (t.every) t.at += t.every;
      else this.tasks.delete(id);
      t.fn();
    }
    this.now = end;
  }
}
