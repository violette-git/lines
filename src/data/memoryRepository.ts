// In-memory Repository used by the web preview. Persists the whole dataset as one JSON blob in
// localStorage (best effort; every storage call is wrapped in try/catch). Seeds a demo project on
// first run only: if the user deletes it, it stays deleted.
//
// Sync semantics match SqliteRepository: app writes bump a per-row "dirty" generation, deletes of
// company rows leave hidden tombstones until pushed, and sync-side methods never mark rows dirty.
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
  SyncRowMeta,
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

import { buildDemoSeed, type SeedData } from './demoSeed';
import type { KeyValueStorage } from './kvStorage';

export const MEMORY_STORAGE_KEY = 'linemap-pro:db:v1';
const STATE_VERSION = 1;
const TABLES: SyncTable[] = ['templates', 'projects', 'nodes', 'spans', 'photos'];

type MetaMap = Record<SyncTable, Record<string, SyncRowMeta>>;

interface MemoryState {
  version: number;
  projects: Project[];
  nodes: MapNode[];
  spans: Span[];
  photos: PhotoRef[];
  templates: ClientTemplate[];
  settings: AppSettings | null;
  /** Sync bookkeeping per table and row id (rows without an entry are clean local rows). */
  meta: MetaMap;
  /** Per-org key/value (sync cursors). */
  syncState: Record<string, Record<string, string>>;
}

export interface MemoryRepositoryOptions {
  storage?: KeyValueStorage | null;
  storageKey?: string;
  /** true = seed demo data on first run (default), false = start empty, function = custom seed. */
  seed?: boolean | (() => SeedData);
  /** Used to release photo data (object URLs) on delete. */
  photoStore?: PhotoStore | null;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const nowIso = () => new Date().toISOString();
const timeOf = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

const emptyMeta = (): MetaMap => ({ templates: {}, projects: {}, nodes: {}, spans: {}, photos: {} });

const emptyState = (): MemoryState => ({
  version: STATE_VERSION,
  projects: [],
  nodes: [],
  spans: [],
  photos: [],
  templates: [],
  settings: null,
  meta: emptyMeta(),
  syncState: {},
});

const freshMeta = (orgId: string | null): SyncRowMeta => ({
  orgId,
  dirty: 0,
  deletedAt: null,
  serverRev: null,
  syncedAt: null,
  syncError: null,
});

type AnyRow = SyncRecord['row'];

function updatedAtOf(table: SyncTable, row: AnyRow): string {
  if (table === 'photos') return (row as PhotoRef).updatedAt ?? (row as PhotoRef).takenAt;
  return (row as Project).updatedAt;
}

export class MemoryRepository implements SyncRepository {
  private state: MemoryState | null = null;
  private readonly storage: KeyValueStorage | null;
  private readonly key: string;
  private readonly seed: boolean | (() => SeedData);
  private readonly photoStore: PhotoStore | null;
  private warnedQuota = false;
  private listeners = new Set<(e: LocalChangeEvent) => void>();

  constructor(opts: MemoryRepositoryOptions = {}) {
    this.storage = opts.storage ?? null;
    this.key = opts.storageKey ?? MEMORY_STORAGE_KEY;
    this.seed = opts.seed ?? true;
    this.photoStore = opts.photoStore ?? null;
  }

  // ---------- persistence ----------
  private load(): MemoryState {
    if (this.state) return this.state;
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(this.key) ?? null;
    } catch {
      raw = null;
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<MemoryState>;
        this.state = { ...emptyState(), ...parsed, version: STATE_VERSION };
        this.state.meta = { ...emptyMeta(), ...(parsed.meta ?? {}) };
        this.state.syncState = parsed.syncState ?? {};
        return this.state;
      } catch {
        // Corrupt blob: keep a copy for debugging and start over.
        try {
          this.storage?.setItem(`${this.key}:corrupt`, raw);
        } catch {
          /* ignore */
        }
      }
    }
    const st = emptyState();
    if (this.seed) {
      const s = typeof this.seed === 'function' ? this.seed() : buildDemoSeed();
      Object.assign(st, clone(s));
    }
    this.state = st;
    this.persist();
    return st;
  }

  private persist() {
    if (!this.storage || !this.state) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.state));
      return;
    } catch {
      // Most likely quota exceeded because of inline photo data URLs. Save without them so at least
      // the field data survives a reload.
    }
    try {
      const slim: MemoryState = {
        ...this.state,
        photos: this.state.photos.map((p) => ({
          ...p,
          uri: p.uri.startsWith('data:') ? '' : p.uri,
          watermarkedUri: p.watermarkedUri?.startsWith('data:') ? null : p.watermarkedUri,
        })),
      };
      this.storage.setItem(this.key, JSON.stringify(slim));
      if (!this.warnedQuota) {
        this.warnedQuota = true;
        console.warn('LineMap: browser storage is full, photos will not survive a page reload.');
      }
    } catch {
      /* storage unavailable, keep running in memory */
    }
  }

  private mutate(fn: (s: MemoryState) => void) {
    fn(this.load());
    this.persist();
  }

  private async releasePhotos(photos: PhotoRef[]) {
    if (!this.photoStore) return;
    for (const p of photos) {
      if (p.uri) await this.photoStore.remove(p.uri).catch(() => undefined);
      if (p.watermarkedUri) await this.photoStore.remove(p.watermarkedUri).catch(() => undefined);
    }
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

  // ---------- meta helpers ----------
  private list(s: MemoryState, table: SyncTable): AnyRow[] {
    return s[table] as AnyRow[];
  }
  private setList(s: MemoryState, table: SyncTable, rows: AnyRow[]) {
    (s as unknown as Record<SyncTable, AnyRow[]>)[table] = rows;
  }
  private meta(s: MemoryState, table: SyncTable, id: string): SyncRowMeta {
    return s.meta[table][id] ?? freshMeta(null);
  }
  private alive(s: MemoryState, table: SyncTable, id: string) {
    return !s.meta[table][id]?.deletedAt;
  }
  private projectOrg(s: MemoryState, projectId: string): string | null {
    return s.meta.projects[projectId]?.orgId ?? s.projects.find((p) => p.id === projectId)?.orgId ?? null;
  }
  private bump(s: MemoryState, table: SyncTable, id: string, orgId: string | null) {
    const m = this.meta(s, table, id);
    s.meta[table][id] = { ...m, orgId, dirty: m.dirty + 1, syncError: null };
  }
  private tombstone(s: MemoryState, table: SyncTable, id: string, at: string) {
    const m = this.meta(s, table, id);
    s.meta[table][id] = { ...m, deletedAt: at, dirty: m.dirty + 1, syncError: null };
    this.setList(
      s,
      table,
      this.list(s, table).map((r) =>
        r.id === id ? ({ ...r, updatedAt: at } as AnyRow) : r,
      ),
    );
  }
  /** Removes a row (no tombstone) with the same cascades as Phase 1. Returns photos to release. */
  private hardDelete(s: MemoryState, table: SyncTable, id: string): PhotoRef[] {
    const drop = (t: SyncTable, keep: (r: AnyRow) => boolean) => {
      const gone = this.list(s, t).filter((r) => !keep(r));
      for (const r of gone) delete s.meta[t][r.id];
      this.setList(s, t, this.list(s, t).filter(keep));
      return gone;
    };
    let photos: PhotoRef[] = [];
    if (table === 'projects') {
      photos = drop('photos', (p) => (p as PhotoRef).projectId !== id) as PhotoRef[];
      drop('spans', (x) => (x as Span).projectId !== id);
      drop('nodes', (n) => (n as MapNode).projectId !== id);
      drop('projects', (p) => p.id !== id);
    } else if (table === 'nodes') {
      photos = drop('photos', (p) => (p as PhotoRef).nodeId !== id) as PhotoRef[];
      drop('spans', (x) => (x as Span).fromNodeId !== id && (x as Span).toNodeId !== id);
      drop('nodes', (n) => n.id !== id);
      s.nodes = s.nodes.map((n) => (n.possibleDuplicateOf === id ? { ...n, possibleDuplicateOf: null } : n));
    } else if (table === 'photos') {
      photos = drop('photos', (p) => p.id !== id) as PhotoRef[];
    } else if (table === 'spans') {
      drop('spans', (x) => x.id !== id);
    } else {
      drop('templates', (t) => t.id !== id);
      s.projects = s.projects.map((p) => (p.templateId === id ? { ...p, templateId: null } : p));
    }
    return photos;
  }

  async init(): Promise<void> {
    this.load();
  }

  // ---------- projects ----------
  async listProjects() {
    const s = this.load();
    return clone(
      s.projects.filter((p) => this.alive(s, 'projects', p.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

  async getProject(id: string) {
    const s = this.load();
    return clone(s.projects.find((p) => p.id === id && this.alive(s, 'projects', id)) ?? null);
  }

  async upsertProject(p: Project) {
    let changed = false;
    this.mutate((s) => {
      if (!this.alive(s, 'projects', p.id)) return;
      const existing = s.projects.find((x) => x.id === p.id);
      // org_id is kept as stored: only moveProjectToOrg changes it.
      const orgId = existing ? (s.meta.projects[p.id]?.orgId ?? existing.orgId ?? null) : (p.orgId ?? null);
      const row = clone(p);
      if (orgId) row.orgId = orgId;
      else delete row.orgId;
      s.projects = upsertById(s.projects, row);
      this.bump(s, 'projects', p.id, orgId);
      changed = true;
    });
    if (changed) this.emit('projects', p.id);
  }

  async deleteProject(id: string) {
    const s = this.load();
    if (!s.projects.some((p) => p.id === id) || !this.alive(s, 'projects', id)) return;
    let removed: PhotoRef[] = [];
    this.mutate((st) => {
      const org = this.projectOrg(st, id);
      if (!org) {
        removed = this.hardDelete(st, 'projects', id);
        return;
      }
      const t = nowIso();
      removed = st.photos.filter((p) => p.projectId === id && this.alive(st, 'photos', p.id));
      for (const p of removed) this.tombstone(st, 'photos', p.id, t);
      for (const x of st.spans.filter((x) => x.projectId === id && this.alive(st, 'spans', x.id))) this.tombstone(st, 'spans', x.id, t);
      for (const n of st.nodes.filter((n) => n.projectId === id && this.alive(st, 'nodes', n.id))) this.tombstone(st, 'nodes', n.id, t);
      this.tombstone(st, 'projects', id, t);
    });
    await this.releasePhotos(removed);
    this.emit('projects', id);
  }

  // ---------- nodes ----------
  async listNodes(projectId: string) {
    const s = this.load();
    return clone(
      s.nodes.filter((n) => n.projectId === projectId && this.alive(s, 'nodes', n.id)).sort((a, b) => a.seq - b.seq),
    );
  }

  async getNode(id: string) {
    const s = this.load();
    return clone(s.nodes.find((n) => n.id === id && this.alive(s, 'nodes', id)) ?? null);
  }

  async upsertNode(n: MapNode) {
    let changed = false;
    this.mutate((s) => {
      if (!this.alive(s, 'nodes', n.id)) return;
      s.nodes = upsertById(s.nodes, clone(n));
      this.bump(s, 'nodes', n.id, this.projectOrg(s, n.projectId));
      changed = true;
    });
    if (changed) this.emit('nodes', n.id);
  }

  async deleteNode(id: string) {
    const s = this.load();
    const node = s.nodes.find((n) => n.id === id);
    if (!node || !this.alive(s, 'nodes', id)) return;
    let removed: PhotoRef[] = [];
    this.mutate((st) => {
      const org = this.meta(st, 'nodes', id).orgId ?? this.projectOrg(st, node.projectId);
      if (!org) {
        removed = this.hardDelete(st, 'nodes', id);
        return;
      }
      const t = nowIso();
      removed = st.photos.filter((p) => p.nodeId === id && this.alive(st, 'photos', p.id));
      for (const p of removed) this.tombstone(st, 'photos', p.id, t);
      for (const x of st.spans.filter((x) => (x.fromNodeId === id || x.toNodeId === id) && this.alive(st, 'spans', x.id))) {
        this.tombstone(st, 'spans', x.id, t);
      }
      st.nodes = st.nodes.map((n) => {
        if (n.possibleDuplicateOf !== id || !this.alive(st, 'nodes', n.id)) return n;
        this.bump(st, 'nodes', n.id, org);
        return { ...n, possibleDuplicateOf: null, updatedAt: t };
      });
      this.tombstone(st, 'nodes', id, t);
    });
    await this.releasePhotos(removed);
    this.emit('nodes', id);
  }

  // ---------- spans ----------
  async listSpans(projectId: string) {
    const s = this.load();
    return clone(
      s.spans
        .filter((x) => x.projectId === projectId && this.alive(s, 'spans', x.id))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async upsertSpan(sp: Span) {
    let changed = false;
    this.mutate((s) => {
      if (!this.alive(s, 'spans', sp.id)) return;
      s.spans = upsertById(s.spans, clone(sp));
      this.bump(s, 'spans', sp.id, this.projectOrg(s, sp.projectId));
      changed = true;
    });
    if (changed) this.emit('spans', sp.id);
  }

  async deleteSpan(id: string) {
    await this.leafDelete('spans', id);
  }

  private async leafDelete(table: 'spans' | 'photos' | 'templates', id: string) {
    const s = this.load();
    const row = this.list(s, table).find((r) => r.id === id);
    if (!row || !this.alive(s, table, id)) return;
    let removed: PhotoRef[] = [];
    this.mutate((st) => {
      const org =
        table === 'templates'
          ? (st.meta.templates[id]?.orgId ?? (row as ClientTemplate).orgId ?? null)
          : this.projectOrg(st, (row as Span).projectId);
      if (!org) {
        removed = this.hardDelete(st, table, id);
        return;
      }
      const t = nowIso();
      if (table === 'photos') removed = [row as PhotoRef];
      if (table === 'templates') {
        st.projects = st.projects.map((p) => {
          if (p.templateId !== id || !this.alive(st, 'projects', p.id)) return p;
          this.bump(st, 'projects', p.id, this.projectOrg(st, p.id));
          return { ...p, templateId: null };
        });
      }
      this.tombstone(st, table, id, t);
    });
    await this.releasePhotos(removed);
    this.emit(table, id);
  }

  // ---------- photos ----------
  async listPhotos(projectId: string) {
    const s = this.load();
    return clone(
      s.photos
        .filter((p) => p.projectId === projectId && this.alive(s, 'photos', p.id))
        .sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    );
  }

  async upsertPhoto(p: PhotoRef) {
    let changed = false;
    this.mutate((s) => {
      if (!this.alive(s, 'photos', p.id)) return;
      const old = s.photos.find((x) => x.id === p.id);
      const next = clone(p);
      // Bucket paths and upload state belong to sync; the app's copy may be stale.
      delete next.storagePath;
      delete next.watermarkedPath;
      delete next.uploadState;
      next.updatedAt = nowIso();
      if (!old) {
        next.uploadState = 'pending';
      } else {
        if (!next.uri) next.uri = old.uri;
        next.watermarkedUri = next.watermarkedUri ?? old.watermarkedUri;
        const newOriginal = !!p.uri && !!old.uri && p.uri !== old.uri;
        const newWm = p.watermarkedUri != null && p.watermarkedUri !== old.watermarkedUri;
        if (!newOriginal && old.storagePath) next.storagePath = old.storagePath;
        if (!newWm && old.watermarkedPath) next.watermarkedPath = old.watermarkedPath;
        next.uploadState = newOriginal || newWm ? 'pending' : old.uploadState;
        if (!next.uploadState) delete next.uploadState;
      }
      s.photos = upsertById(s.photos, next);
      this.bump(s, 'photos', p.id, this.projectOrg(s, p.projectId));
      changed = true;
    });
    if (changed) this.emit('photos', p.id);
  }

  async deletePhoto(id: string) {
    await this.leafDelete('photos', id);
  }

  // ---------- templates ----------
  async listTemplates() {
    const s = this.load();
    return clone(
      s.templates.filter((t) => this.alive(s, 'templates', t.id)).sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async upsertTemplate(t: ClientTemplate) {
    let changed = false;
    this.mutate((s) => {
      if (!this.alive(s, 'templates', t.id)) return;
      const existing = s.templates.find((x) => x.id === t.id);
      const orgId = existing ? (s.meta.templates[t.id]?.orgId ?? existing.orgId ?? null) : (t.orgId ?? null);
      const row = clone(t);
      if (orgId) row.orgId = orgId;
      else delete row.orgId;
      s.templates = upsertById(s.templates, row);
      this.bump(s, 'templates', t.id, orgId);
      changed = true;
    });
    if (changed) this.emit('templates', t.id);
  }

  async deleteTemplate(id: string) {
    await this.leafDelete('templates', id);
  }

  // ---------- settings ----------
  async getSettings(): Promise<AppSettings> {
    return { ...DEFAULT_SETTINGS, ...clone(this.load().settings ?? {}) };
  }

  async saveSettings(settings: AppSettings) {
    this.mutate((s) => {
      s.settings = clone(settings);
    });
  }

  // =============================================================================================
  // Sync
  // =============================================================================================
  async listDirty(scope: { orgId: string } | { projectId: string }): Promise<SyncRecord[]> {
    const s = this.load();
    const out: SyncRecord[] = [];
    for (const table of TABLES) {
      if (!('orgId' in scope) && table === 'templates') continue;
      let rows = this.list(s, table).filter((r) => {
        const m = s.meta[table][r.id];
        if (!m || !m.orgId || m.dirty <= 0 || m.syncError) return false;
        if ('orgId' in scope) return m.orgId === scope.orgId;
        return table === 'projects' ? r.id === scope.projectId : (r as MapNode).projectId === scope.projectId;
      });
      rows = [...rows].sort((a, b) =>
        table === 'nodes'
          ? (a as MapNode).seq - (b as MapNode).seq
          : table === 'photos'
            ? (a as PhotoRef).takenAt.localeCompare((b as PhotoRef).takenAt)
            : (a as Project).createdAt.localeCompare((b as Project).createdAt),
      );
      for (const r of rows) out.push({ table, row: clone(r), meta: { ...s.meta[table][r.id] } } as SyncRecord);
    }
    return out;
  }

  async markSynced(table: SyncTable, acks: SyncAck[]): Promise<void> {
    if (!acks.length) return;
    this.mutate((s) => {
      const t = nowIso();
      for (const a of acks) {
        const m = s.meta[table][a.id];
        if (!m) continue;
        const clean = m.dirty === a.dirty;
        s.meta[table][a.id] = {
          ...m,
          serverRev: a.rev ?? m.serverRev,
          ...(clean ? { dirty: 0, syncedAt: t, syncError: null } : {}),
        };
        if (clean && m.deletedAt) this.hardDelete(s, table, a.id);
      }
    });
  }

  async markRejected(table: SyncTable, items: SyncRejection[]): Promise<void> {
    if (!items.length) return;
    this.mutate((s) => {
      for (const it of items) {
        const m = s.meta[table][it.id];
        if (m && m.dirty === it.dirty) s.meta[table][it.id] = { ...m, syncError: it.reason || 'Refused' };
      }
    });
  }

  async clearRejected(orgId: string): Promise<number> {
    let n = 0;
    this.mutate((s) => {
      for (const table of TABLES) {
        for (const [id, m] of Object.entries(s.meta[table])) {
          if (m.orgId === orgId && m.syncError) {
            s.meta[table][id] = { ...m, syncError: null };
            n++;
          }
        }
      }
    });
    return n;
  }

  async purgeLocal(table: SyncTable, ids: string[]): Promise<void> {
    if (!ids.length) return;
    let removed: PhotoRef[] = [];
    this.mutate((s) => {
      for (const id of ids) removed = removed.concat(this.hardDelete(s, table, id));
    });
    await this.releasePhotos(removed);
  }

  private parentsPresent(s: MemoryState, table: SyncTable, row: AnyRow): boolean {
    const hasProject = (id: string) => s.projects.some((p) => p.id === id);
    const hasNode = (id: string) => s.nodes.some((n) => n.id === id);
    if (table === 'nodes') return hasProject((row as MapNode).projectId);
    if (table === 'spans') {
      const x = row as Span;
      return hasProject(x.projectId) && hasNode(x.fromNodeId) && hasNode(x.toNodeId);
    }
    if (table === 'photos') {
      const p = row as PhotoRef;
      return hasProject(p.projectId) && hasNode(p.nodeId);
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
    let removed: PhotoRef[] = [];
    this.mutate((s) => {
      const t = nowIso();
      for (const sr of rows) {
        const row = clone(sr.row) as AnyRow;
        const id = row.id;
        const pid = table === 'projects' ? id : table === 'templates' ? null : (row as MapNode).projectId;
        const local = this.list(s, table).find((r) => r.id === id) ?? null;
        const lm = s.meta[table][id];

        if (sr.deletedAt) {
          if (local) {
            removed = removed.concat(this.hardDelete(s, table, id));
            out.deleted.push(id);
            if (pid) projectIds.add(pid);
          }
          continue;
        }
        if (local && lm && !opts.force) {
          // Our own push coming back (or a repeat page): nothing new.
          if (lm.dirty === 0 && !lm.deletedAt && lm.serverRev != null && sr.rev != null && lm.serverRev >= sr.rev) continue;
          if (lm.deletedAt) {
            out.keptLocal.push(id);
            continue;
          }
          if (lm.dirty > 0 && timeOf(updatedAtOf(table, local)) > timeOf(updatedAtOf(table, row))) {
            out.keptLocal.push(id);
            continue;
          }
        }
        if (!this.parentsPresent(s, table, row)) {
          if (opts.stopAtOrphan) {
            out.stopped = true;
            break;
          }
          out.orphans.push(id);
          continue;
        }

        let next: AnyRow = row;
        if (table === 'projects' || table === 'templates') (next as Project).orgId = sr.orgId;
        if (table === 'photos') {
          const p = row as PhotoRef;
          const lp = local as PhotoRef | null;
          const merged: PhotoRef = {
            ...p,
            uri: lp?.uri || p.uri || '',
            watermarkedUri: lp?.watermarkedUri ?? p.watermarkedUri ?? null,
            storagePath: p.storagePath ?? lp?.storagePath ?? null,
            watermarkedPath: p.watermarkedPath ?? lp?.watermarkedPath ?? null,
          };
          const needs = (!merged.storagePath && !!merged.uri) || (!!merged.watermarkedUri && !merged.watermarkedPath);
          merged.uploadState = needs ? 'pending' : 'uploaded';
          if (!merged.storagePath) delete merged.storagePath;
          if (!merged.watermarkedPath) delete merged.watermarkedPath;
          next = merged;
        }
        this.setList(s, table, upsertById(this.list(s, table), next));
        s.meta[table as SyncTable][id] = { orgId: sr.orgId, dirty: 0, deletedAt: null, serverRev: sr.rev, syncedAt: t, syncError: null };
        out.applied.push(id);
        if (pid) projectIds.add(pid);
      }
    });
    await this.releasePhotos(removed);
    out.projectIds = [...projectIds];
    return out;
  }

  private needsUpload(s: MemoryState, p: PhotoRef) {
    return (
      this.alive(s, 'photos', p.id) &&
      ((!p.storagePath && !!p.uri) || (!!p.watermarkedUri && !p.watermarkedPath))
    );
  }

  async listPendingPhotoUploads(orgId: string): Promise<PendingPhotoUpload[]> {
    const s = this.load();
    return s.photos
      .filter((p) => s.meta.photos[p.id]?.orgId === orgId && this.needsUpload(s, p))
      .sort((a, b) => a.takenAt.localeCompare(b.takenAt))
      .map((p) => ({
        photo: clone(p),
        orgId,
        needsOriginal: !p.storagePath && !!p.uri,
        needsWatermarked: !!p.watermarkedUri && !p.watermarkedPath,
      }));
  }

  async markPhotoUploaded(photoId: string, paths: { storagePath?: string; watermarkedPath?: string }): Promise<void> {
    this.mutate((s) => {
      if (!this.alive(s, 'photos', photoId)) return;
      s.photos = s.photos.map((p) => {
        if (p.id !== photoId) return p;
        const next: PhotoRef = {
          ...p,
          storagePath: paths.storagePath ?? p.storagePath ?? null,
          watermarkedPath: paths.watermarkedPath ?? p.watermarkedPath ?? null,
        };
        next.uploadState = next.storagePath && (!next.watermarkedUri || next.watermarkedPath) ? 'uploaded' : 'pending';
        return next;
      });
      const m = this.meta(s, 'photos', photoId);
      s.meta.photos[photoId] = { ...m, dirty: m.dirty + 1, syncError: null };
    });
  }

  async markPhotoUploadFailed(photoId: string, _reason: string): Promise<void> {
    this.mutate((s) => {
      s.photos = s.photos.map((p) => (p.id === photoId ? { ...p, uploadState: 'failed' } : p));
    });
  }

  async setPhotoLocalFiles(photoId: string, files: { uri?: string; watermarkedUri?: string | null }): Promise<void> {
    this.mutate((s) => {
      s.photos = s.photos.map((p) =>
        p.id !== photoId
          ? p
          : {
              ...p,
              ...(files.uri !== undefined ? { uri: files.uri } : {}),
              ...(files.watermarkedUri !== undefined ? { watermarkedUri: files.watermarkedUri } : {}),
            },
      );
    });
  }

  async getSyncState(orgId: string, key: string): Promise<string | null> {
    return this.load().syncState[orgId]?.[key] ?? null;
  }

  async setSyncState(orgId: string, key: string, value: string | null): Promise<void> {
    this.mutate((s) => {
      const bucket = { ...(s.syncState[orgId] ?? {}) };
      if (value == null) delete bucket[key];
      else bucket[key] = value;
      s.syncState = { ...s.syncState, [orgId]: bucket };
    });
  }

  async countPending(orgId: string): Promise<PendingCounts> {
    const s = this.load();
    let changes = 0;
    let rejected = 0;
    for (const table of TABLES) {
      for (const m of Object.values(s.meta[table])) {
        if (m.orgId !== orgId) continue;
        if (m.syncError) rejected++;
        else if (m.dirty > 0) changes++;
      }
    }
    const photos = s.photos.filter((p) => s.meta.photos[p.id]?.orgId === orgId && this.needsUpload(s, p)).length;
    return { changes, photos, rejected };
  }

  async moveProjectToOrg(projectId: string, orgId: string): Promise<void> {
    const s = this.load();
    const p = s.projects.find((x) => x.id === projectId);
    if (!p || !this.alive(s, 'projects', projectId)) throw new Error('Project not found');
    const current = this.projectOrg(s, projectId);
    if (current === orgId) return;
    if (current) throw new Error('This project already belongs to another company');
    this.mutate((st) => {
      st.projects = st.projects.map((x) => (x.id === projectId ? { ...x, orgId } : x));
      this.bump(st, 'projects', projectId, orgId);
      for (const n of st.nodes.filter((n) => n.projectId === projectId)) this.bump(st, 'nodes', n.id, orgId);
      for (const x of st.spans.filter((x) => x.projectId === projectId)) this.bump(st, 'spans', x.id, orgId);
      st.photos = st.photos.map((ph) => {
        if (ph.projectId !== projectId) return ph;
        this.bump(st, 'photos', ph.id, orgId);
        const next: PhotoRef = { ...ph, uploadState: 'pending' };
        delete next.storagePath;
        delete next.watermarkedPath;
        return next;
      });
    });
    this.emit('projects', projectId);
  }
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = [...list];
  next[i] = item;
  return next;
}
