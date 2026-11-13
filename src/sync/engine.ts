// Offline-first sync engine for one company (org). Platform-agnostic: storage, network state,
// timers and the server are injected, so it runs the same on phones, web and in tests.
//
// One sync run:
//   1. push    dirty templates, projects, nodes, spans (parents first, batches of 200)
//   2. upload  pending photo files to the bucket (skipped off Wi-Fi when "photos on Wi-Fi only")
//   3. push    photo rows whose files are uploaded (and photo tombstones)
//   4. pull    every table until caught up, applying server rows without marking them dirty
// Triggers: start, app foreground, connectivity regained, local edits (debounced 5 s), every
// 2 minutes while in the foreground, and "Sync now". Failures retry with exponential backoff.
import type { SyncStatus } from '@/backend/contracts';
import type {
  ApplyOutcome,
  ServerApplyRow,
  SyncRecord,
  SyncRepository,
  SyncRowFor,
  SyncTable,
} from '@/domain/contracts';
import type { ClientTemplate, MapNode, PhotoRef, Project, Span } from '@/domain/types';
import type { RemoteChange } from '@/state/store';

import {
  SERVER_TABLES,
  fromServerNode,
  fromServerPhoto,
  fromServerProject,
  fromServerSpan,
  fromServerTemplate,
  photoStoragePath,
  toServerNode,
  toServerPhoto,
  toServerProject,
  toServerSpan,
  toServerTemplate,
  type AnyServerRow,
  type ServerNodeRow,
  type ServerPhotoRow,
  type ServerProjectRow,
  type ServerSpanRow,
  type ServerTable,
  type ServerTemplateRow,
} from './serverMapping';
import {
  SyncTransportError,
  contentTypeFor,
  type PullCursor,
  type PullCursors,
  type PushChanges,
  type PushResponse,
  type PushRowResult,
  type SyncTransport,
} from './transport';

export interface NetworkState {
  online: boolean;
  /** Wi-Fi or wired (unmetered). */
  wifi: boolean;
}

export interface EngineStatus extends SyncStatus {
  /** Rows the server refused (not retried until edited or "Sync now"). */
  rejected: number;
  /** Photos are waiting because "photos on Wi-Fi only" is on and the phone is on cellular. */
  waitingForWifi: boolean;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface SyncEngineOptions {
  orgId: string;
  repo: SyncRepository;
  transport: SyncTransport;
  getNetwork(): Promise<NetworkState>;
  getSettings(): { syncPhotosWifiOnly?: boolean };
  /** False for viewers: pull only. */
  canPush?: boolean;
  onStatus?(s: EngineStatus): void;
  onRemoteChange?(c: RemoteChange): void;
  timers?: Timers;
  now?(): number;
  random?(): number;
  debounceMs?: number;
  intervalMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  pushBatch?: number;
  pullLimit?: number;
}

const LOCAL_TO_SERVER: Record<SyncTable, ServerTable> = {
  templates: 'client_templates',
  projects: 'projects',
  nodes: 'nodes',
  spans: 'spans',
  photos: 'photos',
};
const SERVER_TO_LOCAL: Record<ServerTable, SyncTable> = {
  client_templates: 'templates',
  projects: 'projects',
  nodes: 'nodes',
  spans: 'spans',
  photos: 'photos',
};
/** Tables whose pages must be caught up before a child row with a missing parent is given up on. */
const PARENT_TABLES: Record<ServerTable, ServerTable[]> = {
  client_templates: [],
  projects: [],
  nodes: ['projects'],
  spans: ['projects', 'nodes'],
  photos: ['projects', 'nodes'],
};

export const cursorKey = (t: ServerTable) => `cursor:${t}`;

/** Domain row (with its sync meta) to the server row sync_push expects. */
export function toServerRecord(r: SyncRecord, orgId: string): Partial<AnyServerRow> {
  const opts = { deletedAt: r.meta.deletedAt };
  switch (r.table) {
    case 'templates':
      return toServerTemplate(r.row, orgId, opts);
    case 'projects':
      return toServerProject(r.row, orgId, opts);
    case 'nodes':
      return toServerNode(r.row, orgId, opts);
    case 'spans':
      return toServerSpan(r.row, orgId, opts);
    case 'photos':
      return toServerPhoto(r.row, orgId, opts);
  }
}

/** Server row to what the repository applies. */
export function fromServerRecord(table: ServerTable, row: AnyServerRow): ServerApplyRow<SyncRowFor<SyncTable>> {
  let domain: ClientTemplate | Project | MapNode | Span | PhotoRef;
  switch (table) {
    case 'client_templates':
      domain = fromServerTemplate(row as ServerTemplateRow);
      break;
    case 'projects':
      domain = fromServerProject(row as ServerProjectRow);
      break;
    case 'nodes':
      domain = fromServerNode(row as ServerNodeRow);
      break;
    case 'spans':
      domain = fromServerSpan(row as ServerSpanRow);
      break;
    case 'photos':
      domain = fromServerPhoto(row as ServerPhotoRow);
      break;
  }
  const rev = row.rev == null ? null : Number(row.rev);
  return { row: domain, orgId: row.org_id, rev: Number.isFinite(rev) ? rev : null, deletedAt: row.deleted_at ?? null };
}

/** Plain-language message for an error shown in the sync chip. */
export function friendlySyncError(e: unknown): string {
  const code = e instanceof SyncTransportError ? e.code : null;
  const msg = e instanceof Error ? e.message : String(e);
  if (code === '42501') return "You don't have access to this company's data.";
  if (code === '28000' || /jwt|token|not signed in/i.test(msg)) return 'Your sign-in expired. Please sign in again.';
  if (/network|fetch|timed? ?out|connection|offline/i.test(msg)) return "Can't reach the server right now. Will retry.";
  return `Sync problem: ${msg.slice(0, 120)}`;
}

function rejectionReason(r: PushRowResult): string {
  if (r.code === '42501') return "Your role can't make this change.";
  if (r.code === '23503') return 'A related item was not accepted yet.';
  if (r.code === '23514' || r.code === '22P02' || r.code === '22023') return 'The server found invalid data in this item.';
  return r.reason || 'Not accepted by the server.';
}

const emptyOutcome = (): ApplyOutcome => ({
  applied: [],
  deleted: [],
  keptLocal: [],
  orphans: [],
  stopped: false,
  projectIds: [],
});

class ChangeCollector {
  private tables: RemoteChange['tables'] = {};
  private projects = new Set<string>();
  add(table: SyncTable, o: ApplyOutcome) {
    if (!o.applied.length && !o.deleted.length) return;
    const t = (this.tables[table] ??= { upserted: [], deleted: [] });
    t.upserted.push(...o.applied);
    t.deleted.push(...o.deleted);
    for (const p of o.projectIds) this.projects.add(p);
  }
  take(): RemoteChange | null {
    if (!Object.keys(this.tables).length) return null;
    const c = { projectIds: [...this.projects], tables: this.tables };
    this.tables = {};
    this.projects = new Set();
    return c;
  }
}

export class SyncEngine {
  readonly orgId: string;
  private readonly o: Required<
    Pick<SyncEngineOptions, 'debounceMs' | 'intervalMs' | 'backoffBaseMs' | 'backoffMaxMs' | 'pushBatch' | 'pullLimit'>
  > &
    SyncEngineOptions;
  private readonly timers: Timers;
  private status: EngineStatus = {
    phase: 'idle',
    lastSyncedAt: null,
    pendingChanges: 0,
    pendingPhotos: 0,
    error: null,
    rejected: 0,
    waitingForWifi: false,
  };
  private running: Promise<void> | null = null;
  private rerun = false;
  private stopped = true;
  private foreground = true;
  private online: boolean | null = null;
  private failures = 0;
  private canPush: boolean;
  private debounceH: unknown = null;
  private intervalH: unknown = null;
  private retryH: unknown = null;
  private countsH: unknown = null;

  constructor(opts: SyncEngineOptions) {
    this.o = {
      debounceMs: 5_000,
      intervalMs: 120_000,
      backoffBaseMs: 2_000,
      backoffMaxMs: 300_000,
      pushBatch: 200,
      pullLimit: 500,
      ...opts,
    };
    this.orgId = opts.orgId;
    this.canPush = opts.canPush ?? true;
    this.timers = opts.timers ?? defaultTimers;
  }

  getStatus(): EngineStatus {
    return { ...this.status };
  }

  get failureCount() {
    return this.failures;
  }

  // ---------- lifecycle and triggers ----------
  start(): Promise<void> {
    this.stopped = false;
    this.startInterval();
    return this.requestSync();
  }

  stop() {
    this.stopped = true;
    for (const h of [this.debounceH, this.retryH, this.countsH]) if (h != null) this.timers.clearTimeout(h);
    this.debounceH = this.retryH = this.countsH = null;
    this.stopInterval();
  }

  setCanPush(canPush: boolean) {
    this.canPush = canPush;
  }

  /** Call after every local edit: syncs 5 seconds after the last one. */
  notifyLocalChange() {
    if (this.stopped) return;
    if (this.debounceH != null) this.timers.clearTimeout(this.debounceH);
    this.debounceH = this.timers.setTimeout(() => {
      this.debounceH = null;
      void this.requestSync();
    }, this.o.debounceMs);
    this.scheduleCounts();
  }

  setForeground(active: boolean) {
    if (this.stopped || active === this.foreground) return;
    this.foreground = active;
    if (active) this.startInterval();
    else this.stopInterval();
    // Coming back: catch up. Going to the background: one last chance to send edits.
    void this.requestSync();
  }

  setNetwork(state: NetworkState) {
    const was = this.online;
    this.online = state.online;
    if (this.stopped) return;
    if (!state.online) {
      this.update({ phase: 'offline' });
    } else if (was === false) {
      // Connectivity is back: retry right away instead of waiting for the backoff.
      this.failures = 0;
      this.clearRetry();
      void this.requestSync();
    }
  }

  /** Manual "Sync now": also retries rows the server refused before. */
  async syncNow(): Promise<void> {
    if (this.stopped) return;
    this.failures = 0;
    this.clearRetry();
    await this.o.repo.clearRejected(this.orgId).catch(() => 0);
    await this.requestSync();
  }

  /** Resolves when no sync run is in progress. */
  whenIdle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** Runs a sync now, or once more right after the one in progress. */
  requestSync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.debounceH != null) {
      this.timers.clearTimeout(this.debounceH);
      this.debounceH = null;
    }
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.runOnce();
        } while (this.rerun && !this.stopped);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private startInterval() {
    if (this.intervalH != null || !this.foreground) return;
    this.intervalH = this.timers.setInterval(() => void this.requestSync(), this.o.intervalMs);
  }

  private stopInterval() {
    if (this.intervalH != null) this.timers.clearInterval(this.intervalH);
    this.intervalH = null;
  }

  private clearRetry() {
    if (this.retryH != null) this.timers.clearTimeout(this.retryH);
    this.retryH = null;
  }

  private scheduleRetry() {
    this.clearRetry();
    const exp = Math.min(this.o.backoffMaxMs, this.o.backoffBaseMs * 2 ** Math.max(0, this.failures - 1));
    const jitter = 0.75 + (this.o.random ?? Math.random)() * 0.5;
    const delay = Math.round(Math.min(this.o.backoffMaxMs, exp * jitter));
    this.retryH = this.timers.setTimeout(() => {
      this.retryH = null;
      void this.requestSync();
    }, delay);
    return delay;
  }

  /** Last backoff delay chosen (for tests and diagnostics). */
  nextRetryDelay: number | null = null;

  private scheduleCounts() {
    if (this.countsH != null) return;
    this.countsH = this.timers.setTimeout(() => {
      this.countsH = null;
      void this.refreshCounts();
    }, 500);
  }

  private update(patch: Partial<EngineStatus>) {
    this.status = { ...this.status, ...patch };
    this.o.onStatus?.({ ...this.status });
  }

  private async refreshCounts() {
    try {
      const c = await this.o.repo.countPending(this.orgId);
      this.update({ pendingChanges: c.changes, pendingPhotos: c.photos, rejected: c.rejected });
    } catch {
      /* counts are cosmetic */
    }
  }

  private emitChanges(c: ChangeCollector) {
    const change = c.take();
    if (change) {
      try {
        this.o.onRemoteChange?.(change);
      } catch {
        /* a UI refresh must not break sync */
      }
    }
  }

  // ---------- one run ----------
  private async runOnce(): Promise<void> {
    if (this.stopped) return;
    let net: NetworkState;
    try {
      net = await this.o.getNetwork();
    } catch {
      net = { online: true, wifi: false };
    }
    this.online = net.online;
    if (!net.online) {
      this.update({ phase: 'offline' });
      await this.refreshCounts();
      return;
    }

    const changes = new ChangeCollector();
    try {
      let waitingForWifi = false;
      const uploadErrors: string[] = [];
      if (this.canPush) {
        this.update({ phase: 'pushing' });
        await this.pushRows((r) => r.table !== 'photos', changes);
        const up = await this.uploadPhotos(net);
        waitingForWifi = up.waitingForWifi;
        uploadErrors.push(...up.errors);
        this.update({ phase: 'pushing' });
        await this.pushRows((r) => r.table === 'photos', changes);
      }
      this.emitChanges(changes);

      this.update({ phase: 'pulling' });
      await this.pullAll(changes);

      const c = await this.o.repo.countPending(this.orgId);
      const counts = { pendingChanges: c.changes, pendingPhotos: c.photos, rejected: c.rejected, waitingForWifi };
      if (uploadErrors.length) {
        throw new Error(
          `${uploadErrors.length} photo${uploadErrors.length === 1 ? '' : 's'} could not upload (${uploadErrors[0]})`,
        );
      }
      this.failures = 0;
      this.nextRetryDelay = null;
      this.clearRetry();
      this.update({ phase: 'idle', lastSyncedAt: new Date((this.o.now ?? Date.now)()).toISOString(), error: null, ...counts });
    } catch (e) {
      this.emitChanges(changes);
      this.failures++;
      this.nextRetryDelay = this.scheduleRetry();
      this.update({ phase: 'error', error: friendlySyncError(e) });
      await this.refreshCounts();
    }
  }

  // ---------- push ----------
  private async pushRows(filter: (r: SyncRecord) => boolean, changes: ChangeCollector) {
    const dirty = (await this.o.repo.listDirty({ orgId: this.orgId })).filter(filter);
    // A photo row goes up only once its file is in the bucket (tombstones always go).
    const rows = dirty.filter((r) => r.table !== 'photos' || r.meta.deletedAt || !!r.row.storagePath);
    for (let i = 0; i < rows.length; i += this.o.pushBatch) {
      const chunk = rows.slice(i, i + this.o.pushBatch);
      const payload: PushChanges = {};
      for (const r of chunk) {
        const t = LOCAL_TO_SERVER[r.table];
        ((payload[t] ??= []) as Partial<AnyServerRow>[]).push(toServerRecord(r, this.orgId));
      }
      const res = await this.o.transport.push(this.orgId, payload);
      await this.handlePushResults(chunk, res, changes);
    }
  }

  private async handlePushResults(chunk: SyncRecord[], res: PushResponse, changes: ChangeCollector) {
    const results = new Map<string, PushRowResult>();
    for (const t of SERVER_TABLES) {
      for (const r of res.results?.[t] ?? []) if (r.id) results.set(`${SERVER_TO_LOCAL[t]}:${r.id}`, r);
    }
    const acks = new Map<SyncTable, { id: string; dirty: number; rev: number | null }[]>();
    const rejects = new Map<SyncTable, { id: string; dirty: number; reason: string }[]>();
    const push = <V>(m: Map<SyncTable, V[]>, t: SyncTable, v: V) => (m.get(t) ?? m.set(t, []).get(t)!).push(v);

    for (const r of chunk) {
      const result = results.get(`${r.table}:${r.row.id}`);
      if (!result) continue; // not answered: stays dirty, retried next run
      const st = LOCAL_TO_SERVER[r.table];
      switch (result.status) {
        case 'ok':
        case 'gone':
          push(acks, r.table, { id: r.row.id, dirty: r.meta.dirty, rev: result.rev ?? null });
          break;
        case 'stale':
          // Someone made a later edit: take the server's row (unless this phone edited again since).
          if (result.row) {
            changes.add(r.table, await this.o.repo.applyServerRows(r.table, [fromServerRecord(st, result.row)]));
          }
          break;
        case 'deleted':
          // Deleted on the server (deletes win): remove it here too.
          if (result.row && result.row.deleted_at) {
            changes.add(r.table, await this.o.repo.applyServerRows(r.table, [fromServerRecord(st, result.row)]));
          } else {
            await this.o.repo.purgeLocal(r.table, [r.row.id]);
            const pid = r.table === 'projects' ? r.row.id : r.table === 'templates' ? null : (r.row as MapNode).projectId;
            changes.add(r.table, { ...emptyOutcome(), deleted: [r.row.id], projectIds: pid ? [pid] : [] });
          }
          break;
        case 'rejected':
          push(rejects, r.table, { id: r.row.id, dirty: r.meta.dirty, reason: rejectionReason(result) });
          break;
      }
    }
    for (const [t, a] of acks) await this.o.repo.markSynced(t, a);
    for (const [t, a] of rejects) await this.o.repo.markRejected(t, a);
  }

  // ---------- photos ----------
  private async uploadPhotos(net: NetworkState): Promise<{ waitingForWifi: boolean; errors: string[] }> {
    const pending = await this.o.repo.listPendingPhotoUploads(this.orgId);
    if (!pending.length) return { waitingForWifi: false, errors: [] };
    const wifiOnly = this.o.getSettings().syncPhotosWifiOnly !== false;
    if (wifiOnly && !net.wifi) return { waitingForWifi: true, errors: [] };

    const errors: string[] = [];
    let left = pending.length;
    this.update({ phase: 'uploading_photos', pendingPhotos: left, waitingForWifi: false });
    for (const p of pending) {
      if (this.stopped) break;
      const { photo } = p;
      try {
        if (p.needsOriginal) {
          const path = photoStoragePath(this.orgId, photo.projectId, photo.id);
          await this.o.transport.uploadPhoto(path, photo.uri, contentTypeFor(photo.uri));
          await this.o.repo.markPhotoUploaded(photo.id, { storagePath: path });
        }
        if (p.needsWatermarked && photo.watermarkedUri) {
          const path = photoStoragePath(this.orgId, photo.projectId, photo.id, true);
          await this.o.transport.uploadPhoto(path, photo.watermarkedUri, contentTypeFor(photo.watermarkedUri));
          await this.o.repo.markPhotoUploaded(photo.id, { watermarkedPath: path });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(msg);
        await this.o.repo.markPhotoUploadFailed(photo.id, msg).catch(() => undefined);
      }
      left--;
      this.update({ pendingPhotos: left });
    }
    return { waitingForWifi: false, errors };
  }

  // ---------- pull ----------
  private async loadCursors(): Promise<PullCursors> {
    const out: PullCursors = {};
    for (const t of SERVER_TABLES) {
      const raw = await this.o.repo.getSyncState(this.orgId, cursorKey(t));
      if (!raw) continue;
      try {
        const c = JSON.parse(raw) as PullCursor;
        if (c && typeof c.txid === 'string' && typeof c.rev === 'number') out[t] = c;
      } catch {
        /* corrupt cursor: start that table over */
      }
    }
    return out;
  }

  private async pullAll(changes: ChangeCollector) {
    let cursors = await this.loadCursors();
    let resets = 0;
    for (let round = 0; round < 200 && !this.stopped; round++) {
      const res = await this.o.transport.pull(this.orgId, cursors, this.o.pullLimit);
      if (res.reset) {
        if (++resets > 1) throw new Error('The server asked to restart sync twice');
        for (const t of SERVER_TABLES) await this.o.repo.setSyncState(this.orgId, cursorKey(t), null);
        cursors = {};
        continue;
      }
      const pages = res.tables ?? {};
      let more = false;
      for (const t of SERVER_TABLES) {
        const page = pages[t];
        if (!page) continue;
        const local = SERVER_TO_LOCAL[t];
        const parentHasMore = PARENT_TABLES[t].some((p) => pages[p]?.has_more);
        const rows = (page.rows ?? []).map((r) => fromServerRecord(t, r));
        const outcome = await this.o.repo.applyServerRows(local, rows, { stopAtOrphan: parentHasMore });
        changes.add(local, outcome);
        if (outcome.stopped) {
          // A parent is on a later page: fetch this table's page again after the parents.
          more = true;
          continue;
        }
        cursors = { ...cursors, [t]: page.cursor };
        await this.o.repo.setSyncState(this.orgId, cursorKey(t), JSON.stringify(page.cursor));
        if (page.has_more) more = true;
      }
      this.emitChanges(changes);
      if (!more) return;
    }
  }
}
