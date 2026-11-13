// Native Repository on expo-sqlite (async API). JSON columns hold fields/aiMeta/position/fix.
// Cascades use ON DELETE CASCADE with PRAGMA foreign_keys = ON; photo FILES are deleted manually.
//
// Sync (migration v3): every app write bumps `dirty`; deletes of company rows leave tombstones
// (deleted_at) that every list/get hides; sync-side methods never bump `dirty`.
// All access is serialized through one queue: expo-sqlite's withTransactionAsync is not exclusive,
// so without it an app write could land inside (and roll back with) a sync transaction.
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type {
  ApplyOptions,
  ApplyOutcome,
  LocalChangeEvent,
  PendingCounts,
  PendingPhotoUpload,
  PhotoStore,
  ServerApplyRow,
  SyncAck,
  SyncRecord,
  SyncRejection,
  SyncRepository,
  SyncRowFor,
  SyncTable,
} from '@/domain/contracts';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ClientTemplate,
  type MapNode,
  type PhotoRef,
  type Project,
  type Span,
} from '@/domain/types';

import { runMigrations } from './migrations';
import {
  NODE_COLUMNS,
  PHOTO_COLUMNS,
  PROJECT_COLUMNS,
  SPAN_COLUMNS,
  TEMPLATE_COLUMNS,
  nodeParams,
  parseJson,
  photoParams,
  projectParams,
  rowToMeta,
  rowToNode,
  rowToPhoto,
  rowToProject,
  rowToSpan,
  rowToTemplate,
  spanParams,
  templateParams,
  type BindValue,
  type NodeRow,
  type PhotoRow,
  type ProjectRow,
  type SpanRow,
  type TemplateRow,
} from './rowMapping';

export const DB_NAME = 'linemap.db';
const SETTINGS_KEY = 'app';

const nowIso = () => new Date().toISOString();
const timeOf = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** The subset of expo-sqlite's SQLiteDatabase this repository uses (lets tests plug in another SQLite). */
export type RepoDb = Pick<SQLiteDatabase, 'execAsync' | 'runAsync' | 'getAllAsync' | 'getFirstAsync' | 'withTransactionAsync'>;

const sets = (cols: string[]) =>
  cols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

// App-write SQL: bumps dirty, clears a previous refusal, never touches a tombstoned row, keeps
// org_id as stored (children always inherit their project's org).
const SQL = {
  upsertProject:
    `INSERT INTO projects (${PROJECT_COLUMNS.join(', ')}, org_id, dirty) VALUES (${marks(PROJECT_COLUMNS.length + 1)}, 1) ` +
    `ON CONFLICT(id) DO UPDATE SET ${sets(PROJECT_COLUMNS)}, dirty = projects.dirty + 1, sync_error = NULL ` +
    `WHERE projects.deleted_at IS NULL`,
  upsertNode:
    `INSERT INTO nodes (${NODE_COLUMNS.join(', ')}, org_id, dirty) ` +
    `VALUES (${marks(NODE_COLUMNS.length)}, (SELECT org_id FROM projects WHERE id = ?), 1) ` +
    `ON CONFLICT(id) DO UPDATE SET ${sets(NODE_COLUMNS)}, org_id = excluded.org_id, dirty = nodes.dirty + 1, sync_error = NULL ` +
    `WHERE nodes.deleted_at IS NULL`,
  upsertSpan:
    `INSERT INTO spans (${SPAN_COLUMNS.join(', ')}, org_id, dirty) ` +
    `VALUES (${marks(SPAN_COLUMNS.length)}, (SELECT org_id FROM projects WHERE id = ?), 1) ` +
    `ON CONFLICT(id) DO UPDATE SET ${sets(SPAN_COLUMNS)}, org_id = excluded.org_id, dirty = spans.dirty + 1, sync_error = NULL ` +
    `WHERE spans.deleted_at IS NULL`,
  upsertTemplate:
    `INSERT INTO templates (${TEMPLATE_COLUMNS.join(', ')}, org_id, dirty) VALUES (${marks(TEMPLATE_COLUMNS.length + 1)}, 1) ` +
    `ON CONFLICT(id) DO UPDATE SET ${sets(TEMPLATE_COLUMNS)}, dirty = templates.dirty + 1, sync_error = NULL ` +
    `WHERE templates.deleted_at IS NULL`,
  // Photos: an empty uri never replaces a stored file; a new original or watermarked file resets
  // its bucket path so it is uploaded again.
  upsertPhoto:
    `INSERT INTO photos (${PHOTO_COLUMNS.join(', ')}, updated_at, org_id, dirty, upload_state) ` +
    `VALUES (${marks(PHOTO_COLUMNS.length + 1)}, (SELECT org_id FROM projects WHERE id = ?), 1, 'pending') ` +
    `ON CONFLICT(id) DO UPDATE SET ` +
    `node_id = excluded.node_id, project_id = excluded.project_id, ` +
    `uri = CASE WHEN excluded.uri = '' THEN photos.uri ELSE excluded.uri END, ` +
    `watermarked_uri = COALESCE(excluded.watermarked_uri, photos.watermarked_uri), ` +
    `storage_path = CASE WHEN excluded.uri <> '' AND photos.uri <> '' AND excluded.uri <> photos.uri THEN NULL ELSE photos.storage_path END, ` +
    `watermarked_path = CASE WHEN excluded.watermarked_uri IS NOT NULL AND excluded.watermarked_uri IS NOT photos.watermarked_uri THEN NULL ELSE photos.watermarked_path END, ` +
    `upload_state = CASE WHEN (excluded.uri <> '' AND photos.uri <> '' AND excluded.uri <> photos.uri) ` +
    `OR (excluded.watermarked_uri IS NOT NULL AND excluded.watermarked_uri IS NOT photos.watermarked_uri) THEN 'pending' ELSE photos.upload_state END, ` +
    `width = excluded.width, height = excluded.height, taken_at = excluded.taken_at, fix = excluded.fix, ` +
    `is_primary = excluded.is_primary, updated_at = excluded.updated_at, org_id = excluded.org_id, ` +
    `dirty = photos.dirty + 1, sync_error = NULL ` +
    `WHERE photos.deleted_at IS NULL`,
};

// Sync-write SQL: whole row including bookkeeping, no dirty bump.
const META_COLS = ['org_id', 'dirty', 'deleted_at', 'server_rev', 'synced_at', 'sync_error'];
const PHOTO_SYNC_COLS = [...PHOTO_COLUMNS, 'updated_at', 'storage_path', 'watermarked_path', 'upload_state'];
const syncUpsert = (table: string, cols: string[]) => {
  const all = [...cols, ...META_COLS];
  return `INSERT INTO ${table} (${all.join(', ')}) VALUES (${marks(all.length)}) ON CONFLICT(id) DO UPDATE SET ${sets(all)}`;
};
const SYNC_SQL: Record<SyncTable, string> = {
  templates: syncUpsert('templates', [...TEMPLATE_COLUMNS]),
  projects: syncUpsert('projects', PROJECT_COLUMNS),
  nodes: syncUpsert('nodes', NODE_COLUMNS),
  spans: syncUpsert('spans', SPAN_COLUMNS),
  photos: syncUpsert('photos', PHOTO_SYNC_COLS),
};

const PENDING_UPLOAD_WHERE =
  `deleted_at IS NULL AND ((storage_path IS NULL AND uri <> '') ` +
  `OR (watermarked_uri IS NOT NULL AND watermarked_uri <> '' AND watermarked_path IS NULL))`;

type FileRow = { uri: string; watermarked_uri: string | null };
type AnyRow = ProjectRow | NodeRow | SpanRow | PhotoRow | TemplateRow;

function rowToDomain(table: SyncTable, r: AnyRow): SyncRecord['row'] {
  switch (table) {
    case 'projects':
      return rowToProject(r as ProjectRow);
    case 'nodes':
      return rowToNode(r as NodeRow);
    case 'spans':
      return rowToSpan(r as SpanRow);
    case 'photos':
      return rowToPhoto(r as PhotoRow);
    case 'templates':
      return rowToTemplate(r as TemplateRow);
  }
}

function toRecord(table: SyncTable, r: AnyRow): SyncRecord {
  return { table, row: rowToDomain(table, r), meta: rowToMeta(r) } as SyncRecord;
}

function domainUpdatedAt(table: SyncTable, row: SyncRecord['row']): string {
  if (table === 'photos') {
    const p = row as PhotoRef;
    return p.updatedAt ?? p.takenAt;
  }
  return (row as Project).updatedAt;
}

export class SqliteRepository implements SyncRepository {
  private dbPromise: Promise<RepoDb> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(e: LocalChangeEvent) => void>();

  constructor(
    private readonly photoStore: PhotoStore | null = null,
    private readonly dbName: string = DB_NAME,
    /** Tests inject a database; the app opens expo-sqlite. */
    private readonly openDb: (name: string) => Promise<RepoDb> = openDatabaseAsync,
  ) {}

  private db(): Promise<RepoDb> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const db = await this.openDb(this.dbName);
        // PRAGMAs must run outside transactions, per connection.
        await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
        await runMigrations(db);
        return db;
      })();
      this.dbPromise.catch(() => {
        this.dbPromise = null; // allow retry after a failed open
      });
    }
    return this.dbPromise;
  }

  /** Runs fn with exclusive access to the database. Never call locked() from inside fn. */
  private locked<T>(fn: (db: RepoDb) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => fn(await this.db()));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private emit(table: SyncTable, id: string) {
    for (const l of this.listeners) {
      try {
        l({ table, id });
      } catch {
        /* a listener must never break a write */
      }
    }
  }

  onLocalChange(listener: (e: LocalChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async init(): Promise<void> {
    await this.locked(async () => undefined);
  }

  private async removeFiles(rows: FileRow[]) {
    if (!this.photoStore) return;
    for (const r of rows) {
      if (r.uri) await this.photoStore.remove(r.uri).catch(() => undefined);
      if (r.watermarked_uri) await this.photoStore.remove(r.watermarked_uri).catch(() => undefined);
    }
  }

  private async orgOf(db: RepoDb, table: SyncTable, id: string): Promise<{ org_id: string | null } | null> {
    return db.getFirstAsync<{ org_id: string | null }>(`SELECT org_id FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id]);
  }

  // ---------- hard deletes (no tombstones), shared by local-only deletes and sync purges ----------
  // These run plain statements; callers wrap them in a transaction and remove the files after.
  private async hardDeleteProject(db: RepoDb, id: string): Promise<FileRow[]> {
    const files = await db.getAllAsync<FileRow>('SELECT uri, watermarked_uri FROM photos WHERE project_id = ?', [id]);
    // Explicit deletes in dependency order (cascades would cover this; being explicit protects
    // databases opened without foreign_keys).
    await db.runAsync('DELETE FROM photos WHERE project_id = ?', [id]);
    await db.runAsync('DELETE FROM spans WHERE project_id = ?', [id]);
    await db.runAsync('DELETE FROM nodes WHERE project_id = ?', [id]);
    await db.runAsync('DELETE FROM projects WHERE id = ?', [id]);
    return files;
  }

  private async hardDeleteNode(db: RepoDb, id: string): Promise<FileRow[]> {
    const files = await db.getAllAsync<FileRow>('SELECT uri, watermarked_uri FROM photos WHERE node_id = ?', [id]);
    await db.runAsync('DELETE FROM photos WHERE node_id = ?', [id]);
    await db.runAsync('DELETE FROM spans WHERE from_node_id = ? OR to_node_id = ?', [id, id]);
    await db.runAsync('UPDATE nodes SET possible_duplicate_of = NULL WHERE possible_duplicate_of = ?', [id]);
    await db.runAsync('DELETE FROM nodes WHERE id = ?', [id]);
    return files;
  }

  private async hardDelete(db: RepoDb, table: SyncTable, id: string): Promise<FileRow[]> {
    switch (table) {
      case 'projects':
        return this.hardDeleteProject(db, id);
      case 'nodes':
        return this.hardDeleteNode(db, id);
      case 'photos': {
        const files = await db.getAllAsync<FileRow>('SELECT uri, watermarked_uri FROM photos WHERE id = ?', [id]);
        await db.runAsync('DELETE FROM photos WHERE id = ?', [id]);
        return files;
      }
      case 'spans':
        await db.runAsync('DELETE FROM spans WHERE id = ?', [id]);
        return [];
      case 'templates':
        await db.runAsync('UPDATE projects SET template_id = NULL WHERE template_id = ?', [id]);
        await db.runAsync('DELETE FROM templates WHERE id = ?', [id]);
        return [];
    }
  }

  // ---------- projects ----------
  async listProjects() {
    return this.locked(async (db) => {
      const rows = await db.getAllAsync<ProjectRow>('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC');
      return rows.map(rowToProject);
    });
  }

  async getProject(id: string) {
    return this.locked(async (db) => {
      const r = await db.getFirstAsync<ProjectRow>('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL', [id]);
      return r ? rowToProject(r) : null;
    });
  }

  async upsertProject(p: Project) {
    const changed = await this.locked(async (db) => {
      const res = await db.runAsync(SQL.upsertProject, [...projectParams(p), p.orgId ?? null]);
      return res.changes > 0;
    });
    if (changed) this.emit('projects', p.id);
  }

  async deleteProject(id: string) {
    const deleted = await this.locked(async (db) => {
      const row = await this.orgOf(db, 'projects', id);
      if (!row) return false;
      let files: FileRow[] = [];
      await db.withTransactionAsync(async () => {
        if (!row.org_id) {
          files = await this.hardDeleteProject(db, id);
          return;
        }
        const t = nowIso();
        files = await db.getAllAsync<FileRow>(
          'SELECT uri, watermarked_uri FROM photos WHERE project_id = ? AND deleted_at IS NULL',
          [id],
        );
        for (const table of ['photos', 'spans', 'nodes'] as const) {
          await db.runAsync(
            `UPDATE ${table} SET deleted_at = ?, updated_at = ?, dirty = dirty + 1, sync_error = NULL ` +
              `WHERE project_id = ? AND deleted_at IS NULL`,
            [t, t, id],
          );
        }
        await db.runAsync(
          'UPDATE projects SET deleted_at = ?, updated_at = ?, dirty = dirty + 1, sync_error = NULL WHERE id = ?',
          [t, t, id],
        );
      });
      await this.removeFiles(files);
      return true;
    });
    if (deleted) this.emit('projects', id);
  }

  // ---------- nodes ----------
  async listNodes(projectId: string) {
    return this.locked(async (db) => {
      const rows = await db.getAllAsync<NodeRow>(
        'SELECT * FROM nodes WHERE project_id = ? AND deleted_at IS NULL ORDER BY seq ASC',
        [projectId],
      );
      return rows.map(rowToNode);
    });
  }

  async getNode(id: string) {
    return this.locked(async (db) => {
      const r = await db.getFirstAsync<NodeRow>('SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL', [id]);
      return r ? rowToNode(r) : null;
    });
  }

  async upsertNode(n: MapNode) {
    const changed = await this.locked(async (db) => {
      const res = await db.runAsync(SQL.upsertNode, [...nodeParams(n), n.projectId]);
      return res.changes > 0;
    });
    if (changed) this.emit('nodes', n.id);
  }

  async deleteNode(id: string) {
    const deleted = await this.locked(async (db) => {
      const row = await this.orgOf(db, 'nodes', id);
      if (!row) return false;
      let files: FileRow[] = [];
      await db.withTransactionAsync(async () => {
        if (!row.org_id) {
          files = await this.hardDeleteNode(db, id);
          return;
        }
        const t = nowIso();
        files = await db.getAllAsync<FileRow>(
          'SELECT uri, watermarked_uri FROM photos WHERE node_id = ? AND deleted_at IS NULL',
          [id],
        );
        await db.runAsync(
          'UPDATE photos SET deleted_at = ?, updated_at = ?, dirty = dirty + 1, sync_error = NULL WHERE node_id = ? AND deleted_at IS NULL',
          [t, t, id],
        );
        await db.runAsync(
          'UPDATE spans SET deleted_at = ?, updated_at = ?, dirty = dirty + 1, sync_error = NULL ' +
            'WHERE (from_node_id = ? OR to_node_id = ?) AND deleted_at IS NULL',
          [t, t, id, id],
        );
        await db.runAsync(
          'UPDATE nodes SET possible_duplicate_of = NULL, updated_at = ?, dirty = dirty + 1 WHERE possible_duplicate_of = ? AND deleted_at IS NULL',
          [t, id],
        );
        await db.runAsync('UPDATE nodes SET deleted_at = ?, updated_at = ?, dirty = dirty + 1, sync_error = NULL WHERE id = ?', [t, t, id]);
      });
      await this.removeFiles(files);
      return true;
    });
    if (deleted) this.emit('nodes', id);
  }

  // ---------- spans ----------
  async listSpans(projectId: string) {
    return this.locked(async (db) => {
      const rows = await db.getAllAsync<SpanRow>(
        'SELECT * FROM spans WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
        [projectId],
      );
      return rows.map(rowToSpan);
    });
  }

  async upsertSpan(s: Span) {
    const changed = await this.locked(async (db) => {
      const res = await db.runAsync(SQL.upsertSpan, [...spanParams(s), s.projectId]);
      return res.changes > 0;
    });
    if (changed) this.emit('spans', s.id);
  }

  async deleteSpan(id: string) {
    await this.softOrHardDelete('spans', id);
  }

  /** Delete for leaf tables (spans, photos, templates): tombstone company rows, remove local-only ones. */
  private async softOrHardDelete(table: 'spans' | 'photos' | 'templates', id: string) {
    const deleted = await this.locked(async (db) => {
      const row = await this.orgOf(db, table, id);
      if (!row) return false;
      let files: FileRow[] = [];
      await db.withTransactionAsync(async () => {
        if (!row.org_id) {
          files = await this.hardDelete(db, table, id);
          return;
        }
        const t = nowIso();
        if (table === 'photos') {
          files = await db.getAllAsync<FileRow>('SELECT uri, watermarked_uri FROM photos WHERE id = ?', [id]);
        }
        if (table === 'templates') {
          await db.runAsync(
            'UPDATE projects SET template_id = NULL, dirty = dirty + 1 WHERE template_id = ? AND deleted_at IS NULL',
            [id],
          );
        }
        await db.runAsync(
          `UPDATE ${table} SET deleted_at = ?, updated_at = ?, dirty = dirty + 1, sync_error = NULL WHERE id = ?`,
          [t, t, id],
        );
      });
      await this.removeFiles(files);
      return true;
    });
    if (deleted) this.emit(table, id);
  }

  // ---------- photos ----------
  async listPhotos(projectId: string) {
    return this.locked(async (db) => {
      const rows = await db.getAllAsync<PhotoRow>(
        'SELECT * FROM photos WHERE project_id = ? AND deleted_at IS NULL ORDER BY taken_at ASC',
        [projectId],
      );
      return rows.map(rowToPhoto);
    });
  }

  async upsertPhoto(p: PhotoRef) {
    const changed = await this.locked(async (db) => {
      // App writes are edits made now (photos have no updatedAt of their own in Phase 1 code paths).
      const res = await db.runAsync(SQL.upsertPhoto, [...photoParams(p), nowIso(), p.projectId]);
      return res.changes > 0;
    });
    if (changed) this.emit('photos', p.id);
  }

  async deletePhoto(id: string) {
    await this.softOrHardDelete('photos', id);
  }

  // ---------- templates ----------
  async listTemplates() {
    return this.locked(async (db) => {
      const rows = await db.getAllAsync<TemplateRow>(
        'SELECT * FROM templates WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE ASC',
      );
      return rows.map(rowToTemplate);
    });
  }

  async upsertTemplate(t: ClientTemplate) {
    const changed = await this.locked(async (db) => {
      const res = await db.runAsync(SQL.upsertTemplate, [...templateParams(t), t.orgId ?? null]);
      return res.changes > 0;
    });
    if (changed) this.emit('templates', t.id);
  }

  async deleteTemplate(id: string) {
    await this.softOrHardDelete('templates', id);
  }

  // ---------- settings ----------
  async getSettings(): Promise<AppSettings> {
    return this.locked(async (db) => {
      const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [SETTINGS_KEY]);
      return { ...DEFAULT_SETTINGS, ...parseJson<Partial<AppSettings>>(r?.value, {}) };
    });
  }

  async saveSettings(s: AppSettings) {
    await this.locked(async (db) => {
      await db.runAsync(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [SETTINGS_KEY, JSON.stringify(s)],
      );
    });
  }

  // =============================================================================================
  // Sync
  // =============================================================================================
  async listDirty(scope: { orgId: string } | { projectId: string }): Promise<SyncRecord[]> {
    return this.locked(async (db) => {
      const out: SyncRecord[] = [];
      const order: Record<SyncTable, string> = {
        templates: 'created_at',
        projects: 'created_at',
        nodes: 'seq',
        spans: 'created_at',
        photos: 'taken_at',
      };
      for (const table of ['templates', 'projects', 'nodes', 'spans', 'photos'] as SyncTable[]) {
        let where: string;
        let params: BindValue[];
        if ('orgId' in scope) {
          where = 'org_id = ?';
          params = [scope.orgId];
        } else if (table === 'templates') {
          continue;
        } else {
          where = table === 'projects' ? 'id = ?' : 'project_id = ?';
          params = [scope.projectId];
        }
        const rows = await db.getAllAsync<AnyRow>(
          `SELECT * FROM ${table} WHERE ${where} AND org_id IS NOT NULL AND dirty > 0 AND sync_error IS NULL ORDER BY ${order[table]} ASC`,
          params,
        );
        for (const r of rows) out.push(toRecord(table, r));
      }
      return out;
    });
  }

  async markSynced(table: SyncTable, acks: SyncAck[]): Promise<void> {
    if (!acks.length) return;
    await this.locked(async (db) => {
      const t = nowIso();
      await db.withTransactionAsync(async () => {
        for (const a of acks) {
          const res = await db.runAsync(
            `UPDATE ${table} SET dirty = 0, server_rev = COALESCE(?, server_rev), synced_at = ?, sync_error = NULL WHERE id = ? AND dirty = ?`,
            [a.rev, t, a.id, a.dirty],
          );
          if (res.changes === 0) {
            // Edited again while the push was in flight: stays dirty, but remember the server revision.
            await db.runAsync(`UPDATE ${table} SET server_rev = COALESCE(?, server_rev) WHERE id = ?`, [a.rev, a.id]);
          }
          // An acknowledged tombstone has done its job.
          await db.runAsync(`DELETE FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL AND dirty = 0`, [a.id]);
        }
      });
    });
  }

  async markRejected(table: SyncTable, items: SyncRejection[]): Promise<void> {
    if (!items.length) return;
    await this.locked(async (db) => {
      for (const it of items) {
        await db.runAsync(`UPDATE ${table} SET sync_error = ? WHERE id = ? AND dirty = ?`, [it.reason || 'Refused', it.id, it.dirty]);
      }
    });
  }

  async clearRejected(orgId: string): Promise<number> {
    return this.locked(async (db) => {
      let n = 0;
      for (const table of ['templates', 'projects', 'nodes', 'spans', 'photos'] as SyncTable[]) {
        const res = await db.runAsync(`UPDATE ${table} SET sync_error = NULL WHERE org_id = ? AND sync_error IS NOT NULL`, [orgId]);
        n += res.changes;
      }
      return n;
    });
  }

  async purgeLocal(table: SyncTable, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.locked(async (db) => {
      let files: FileRow[] = [];
      await db.withTransactionAsync(async () => {
        for (const id of ids) files = files.concat(await this.hardDelete(db, table, id));
      });
      await this.removeFiles(files);
    });
  }

  private async parentsPresent(db: RepoDb, table: SyncTable, row: SyncRecord['row']): Promise<boolean> {
    const has = async (t: string, id: string) =>
      !!(await db.getFirstAsync<{ one: number }>(`SELECT 1 AS one FROM ${t} WHERE id = ?`, [id]));
    if (table === 'nodes') return has('projects', (row as MapNode).projectId);
    if (table === 'spans') {
      const s = row as Span;
      return (await has('projects', s.projectId)) && (await has('nodes', s.fromNodeId)) && (await has('nodes', s.toNodeId));
    }
    if (table === 'photos') {
      const p = row as PhotoRef;
      return (await has('projects', p.projectId)) && (await has('nodes', p.nodeId));
    }
    return true;
  }

  async applyServerRows<T extends SyncTable>(
    table: T,
    rows: ServerApplyRow<SyncRowFor<T>>[],
    opts: ApplyOptions = {},
  ): Promise<ApplyOutcome> {
    const out: ApplyOutcome = { applied: [], deleted: [], keptLocal: [], orphans: [], stopped: false, projectIds: [] };
    if (!rows.length) return out;
    const projectIds = new Set<string>();
    await this.locked(async (db) => {
      let files: FileRow[] = [];
      const t = nowIso();
      await db.withTransactionAsync(async () => {
        for (const sr of rows) {
          const row = sr.row as SyncRecord['row'];
          const id = row.id;
          const pid = table === 'projects' ? id : table === 'templates' ? null : (row as MapNode).projectId;
          const local = await db.getFirstAsync<AnyRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);

          if (sr.deletedAt) {
            if (local) {
              files = files.concat(await this.hardDelete(db, table, id));
              out.deleted.push(id);
              if (pid) projectIds.add(pid);
            }
            continue;
          }

          if (local && !opts.force) {
            const meta = rowToMeta(local);
            // Our own push coming back (or a repeat page): nothing new.
            if (meta.dirty === 0 && !meta.deletedAt && meta.serverRev != null && sr.rev != null && meta.serverRev >= sr.rev) {
              continue;
            }
            // A pending local delete wins (deletes win on the server too).
            if (meta.deletedAt) {
              out.keptLocal.push(id);
              continue;
            }
            const localUpdated = domainUpdatedAt(table, rowToDomain(table, local));
            if (meta.dirty > 0 && timeOf(localUpdated) > timeOf(domainUpdatedAt(table, row))) {
              out.keptLocal.push(id);
              continue;
            }
          }

          if (!(await this.parentsPresent(db, table, row))) {
            if (opts.stopAtOrphan) {
              out.stopped = true;
              break;
            }
            out.orphans.push(id);
            continue;
          }

          const meta: BindValue[] = [sr.orgId, 0, null, sr.rev, t, null];
          let params: BindValue[];
          switch (table) {
            case 'projects':
              params = projectParams({ ...(row as Project), orgId: sr.orgId });
              break;
            case 'nodes':
              params = nodeParams(row as MapNode);
              break;
            case 'spans':
              params = spanParams(row as Span);
              break;
            case 'templates':
              params = templateParams({ ...(row as ClientTemplate), orgId: sr.orgId });
              break;
            case 'photos': {
              const p = row as PhotoRef;
              const lp = local ? rowToPhoto(local as PhotoRow) : null;
              // Keep files already on this phone; take the server's bucket paths.
              const merged: PhotoRef = {
                ...p,
                uri: lp?.uri || p.uri || '',
                watermarkedUri: lp?.watermarkedUri ?? p.watermarkedUri ?? null,
              };
              const storagePath = p.storagePath ?? lp?.storagePath ?? null;
              const watermarkedPath = p.watermarkedPath ?? lp?.watermarkedPath ?? null;
              const needs =
                (!storagePath && !!merged.uri) || (!!merged.watermarkedUri && !watermarkedPath);
              params = [
                ...photoParams(merged),
                p.updatedAt ?? p.takenAt,
                storagePath,
                watermarkedPath,
                needs ? 'pending' : 'uploaded',
              ];
              break;
            }
            default:
              params = [];
          }
          await db.runAsync(SYNC_SQL[table], [...params, ...meta]);
          out.applied.push(id);
          if (pid) projectIds.add(pid);
        }
      });
      await this.removeFiles(files);
    });
    out.projectIds = [...projectIds];
    return out;
  }

  async listPendingPhotoUploads(orgId: string): Promise<PendingPhotoUpload[]> {
    return this.locked(async (db) => {
      const rows = await db.getAllAsync<PhotoRow>(
        `SELECT * FROM photos WHERE org_id = ? AND ${PENDING_UPLOAD_WHERE} ORDER BY taken_at ASC`,
        [orgId],
      );
      return rows.map((r) => ({
        photo: rowToPhoto(r),
        orgId,
        needsOriginal: !r.storage_path && !!r.uri,
        needsWatermarked: !!r.watermarked_uri && !r.watermarked_path,
      }));
    });
  }

  async markPhotoUploaded(photoId: string, paths: { storagePath?: string; watermarkedPath?: string }): Promise<void> {
    await this.locked(async (db) => {
      await db.runAsync(
        `UPDATE photos SET storage_path = COALESCE(?, storage_path), watermarked_path = COALESCE(?, watermarked_path), ` +
          `dirty = dirty + 1, sync_error = NULL WHERE id = ? AND deleted_at IS NULL`,
        [paths.storagePath ?? null, paths.watermarkedPath ?? null, photoId],
      );
      await db.runAsync(
        `UPDATE photos SET upload_state = CASE WHEN storage_path IS NOT NULL AND (watermarked_uri IS NULL OR watermarked_uri = '' ` +
          `OR watermarked_path IS NOT NULL) THEN 'uploaded' ELSE 'pending' END WHERE id = ?`,
        [photoId],
      );
    });
  }

  async markPhotoUploadFailed(photoId: string, _reason: string): Promise<void> {
    await this.locked(async (db) => {
      await db.runAsync(`UPDATE photos SET upload_state = 'failed' WHERE id = ?`, [photoId]);
    });
  }

  async setPhotoLocalFiles(photoId: string, files: { uri?: string; watermarkedUri?: string | null }): Promise<void> {
    await this.locked(async (db) => {
      if (files.uri !== undefined) await db.runAsync('UPDATE photos SET uri = ? WHERE id = ?', [files.uri, photoId]);
      if (files.watermarkedUri !== undefined) {
        await db.runAsync('UPDATE photos SET watermarked_uri = ? WHERE id = ?', [files.watermarkedUri, photoId]);
      }
    });
  }

  async getSyncState(orgId: string, key: string): Promise<string | null> {
    return this.locked(async (db) => {
      const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_state WHERE org_id = ? AND key = ?', [orgId, key]);
      return r?.value ?? null;
    });
  }

  async setSyncState(orgId: string, key: string, value: string | null): Promise<void> {
    await this.locked(async (db) => {
      if (value == null) await db.runAsync('DELETE FROM sync_state WHERE org_id = ? AND key = ?', [orgId, key]);
      else {
        await db.runAsync(
          'INSERT INTO sync_state (org_id, key, value) VALUES (?, ?, ?) ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value',
          [orgId, key, value],
        );
      }
    });
  }

  async countPending(orgId: string): Promise<PendingCounts> {
    return this.locked(async (db) => {
      let changes = 0;
      let rejected = 0;
      for (const table of ['templates', 'projects', 'nodes', 'spans', 'photos'] as SyncTable[]) {
        const r = await db.getFirstAsync<{ c: number; e: number }>(
          `SELECT SUM(CASE WHEN dirty > 0 AND sync_error IS NULL THEN 1 ELSE 0 END) AS c, ` +
            `SUM(CASE WHEN sync_error IS NOT NULL THEN 1 ELSE 0 END) AS e FROM ${table} WHERE org_id = ?`,
          [orgId],
        );
        changes += r?.c ?? 0;
        rejected += r?.e ?? 0;
      }
      const p = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) AS c FROM photos WHERE org_id = ? AND ${PENDING_UPLOAD_WHERE}`,
        [orgId],
      );
      return { changes, photos: p?.c ?? 0, rejected };
    });
  }

  async moveProjectToOrg(projectId: string, orgId: string): Promise<void> {
    const moved = await this.locked(async (db) => {
      const row = await db.getFirstAsync<{ org_id: string | null }>(
        'SELECT org_id FROM projects WHERE id = ? AND deleted_at IS NULL',
        [projectId],
      );
      if (!row) throw new Error('Project not found');
      if (row.org_id === orgId) return false;
      if (row.org_id) throw new Error('This project already belongs to another company');
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE projects SET org_id = ?, dirty = dirty + 1, sync_error = NULL WHERE id = ?', [orgId, projectId]);
        for (const table of ['nodes', 'spans'] as const) {
          await db.runAsync(`UPDATE ${table} SET org_id = ?, dirty = dirty + 1, sync_error = NULL WHERE project_id = ?`, [
            orgId,
            projectId,
          ]);
        }
        await db.runAsync(
          `UPDATE photos SET org_id = ?, dirty = dirty + 1, sync_error = NULL, storage_path = NULL, watermarked_path = NULL, ` +
            `upload_state = 'pending' WHERE project_id = ?`,
          [orgId, projectId],
        );
      });
      return true;
    });
    if (moved) this.emit('projects', projectId);
  }
}

