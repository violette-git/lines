// Offline area download manager.
//
// - An area is a bbox + zoom range + provider. Its tiles are enumerated in a fixed order
//   (zoom, x, y; see tileAtIndex) so progress is a single cursor that survives app restarts.
// - One area downloads at a time with `concurrency` parallel tile requests (default 6).
// - Progress is persisted (throttled) to a JSON index; on restart unfinished areas resume from the
//   cursor. Tiles already on disk are skipped, so overlapping areas and resumes never re-download.
// - Losing signal pauses the area as "waiting for network"; it resumes when the network returns.
// - Deleting an area removes only tiles no other saved area of the same provider covers.
// All I/O is injected (see DownloadIO); the native wiring is in ./manager.ts.
import { canBulkDownload, getProvider, MAX_TILES_PER_AREA, tileUrl, type TileProvider } from './providers';
import {
  countTiles,
  estimateArea,
  exclusiveTiles,
  isValidBBox,
  tileAtIndex,
  tileRanges,
  type BBox,
  type TileCoord,
} from './tileMath';

export type AreaStatus = 'queued' | 'downloading' | 'paused' | 'waiting_network' | 'complete' | 'error' | 'deleting';

export interface SavedArea {
  id: string;
  name: string;
  providerId: string;
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  totalTiles: number;
  estimatedBytes: number;
  /** Every tile index below this has been processed (saved, already present, or failed). */
  cursor: number;
  bytesAtCursor: number;
  failedAtCursor: number;
  /** Live totals (cursor plus finished tiles above it). */
  doneTiles: number;
  bytes: number;
  failedTiles: number;
  status: AreaStatus;
  error: string | null;
}

export interface PersistedIndex {
  version: 1;
  areas: SavedArea[];
}

export interface DownloadIO {
  /** Verified size of a saved-area tile on disk, 0 when missing or invalid. */
  areaTileSize(p: TileProvider, t: TileCoord): number;
  /** Download into saved-area storage; resolves to verified bytes, rejects on failure. */
  downloadAreaTile(p: TileProvider, t: TileCoord, url: string, signal: AbortSignal): Promise<number>;
  removeAreaTile(p: TileProvider, t: TileCoord): void;
  loadIndex(): Promise<unknown | null>;
  saveIndex(index: PersistedIndex): Promise<void>;
  freeBytes(): number | null;
}

export interface DownloadManagerOptions {
  io: DownloadIO;
  isOnline(): boolean;
  getApiKey(): string | null;
  lookupProvider?: (id: string) => TileProvider | null;
  concurrency?: number;
  /** Attempts per tile (default 3). */
  attempts?: number;
  /** Backoff before retry n (ms); default 400 * 3^(n-1). */
  backoffMs?: (attempt: number) => number;
  /** Consecutive failed tiles that stop an area with an error (default 25). */
  maxConsecutiveFailures?: number;
  persistEveryMs?: number;
  now?: () => Date;
  newId?: () => string;
  /** Yield to the event loop every n deletions (default 250). */
  deleteChunk?: number;
}

export interface NewAreaInput {
  name: string;
  providerId: string;
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  projectId?: string | null;
  /** User confirmed their plan allows offline downloads (providers with requiresAgreement). */
  agreementConfirmed?: boolean;
}

export interface OfflineSnapshot {
  ready: boolean;
  areas: SavedArea[];
  activeId: string | null;
}

interface Run {
  areaId: string;
  stop: boolean;
  aborts: Set<AbortController>;
  done: Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function sanitizeArea(a: unknown): SavedArea | null {
  if (!a || typeof a !== 'object') return null;
  const x = a as Partial<SavedArea>;
  if (typeof x.id !== 'string' || typeof x.providerId !== 'string' || !isValidBBox(x.bbox as BBox)) return null;
  const minZoom = Number(x.minZoom);
  const maxZoom = Number(x.maxZoom);
  if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom > maxZoom) return null;
  const totalTiles = countTiles(x.bbox as BBox, minZoom, maxZoom);
  const cursor = Math.min(totalTiles, Math.max(0, Math.floor(Number(x.cursor) || 0)));
  const bytesAtCursor = Math.max(0, Number(x.bytesAtCursor) || 0);
  const failedAtCursor = Math.max(0, Math.floor(Number(x.failedAtCursor) || 0));
  return {
    id: x.id,
    name: typeof x.name === 'string' && x.name ? x.name : 'Saved area',
    providerId: x.providerId,
    bbox: x.bbox as BBox,
    minZoom,
    maxZoom,
    projectId: typeof x.projectId === 'string' ? x.projectId : null,
    createdAt: typeof x.createdAt === 'string' ? x.createdAt : new Date(0).toISOString(),
    updatedAt: typeof x.updatedAt === 'string' ? x.updatedAt : new Date(0).toISOString(),
    totalTiles,
    estimatedBytes: Math.max(0, Number(x.estimatedBytes) || 0),
    cursor,
    bytesAtCursor,
    failedAtCursor,
    // Work above the cursor is redone on resume (present tiles are skipped quickly).
    doneTiles: cursor,
    bytes: bytesAtCursor,
    failedTiles: failedAtCursor,
    status: (x.status as AreaStatus) ?? 'paused',
    error: typeof x.error === 'string' ? x.error : null,
  };
}

export class DownloadManager {
  private readonly o: Required<Omit<DownloadManagerOptions, 'lookupProvider'>> & {
    lookupProvider: (id: string) => TileProvider | null;
  };
  private areas: SavedArea[] = [];
  private ready = false;
  private run: Run | null = null;
  private listeners = new Set<() => void>();
  private snapshot: OfflineSnapshot = { ready: false, areas: [], activeId: null };
  private lastPersist = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  private initPromise: Promise<void> | null = null;
  private pumping = false;

  constructor(opts: DownloadManagerOptions) {
    this.o = {
      concurrency: 6,
      attempts: 3,
      backoffMs: (n: number) => 400 * 3 ** (n - 1),
      maxConsecutiveFailures: 25,
      persistEveryMs: 1500,
      now: () => new Date(),
      newId: () => `area-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      deleteChunk: 250,
      lookupProvider: getProvider,
      ...opts,
    };
  }

  // ------------------------------------------------------------ state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): OfflineSnapshot => this.snapshot;

  private emit(): void {
    this.snapshot = { ready: this.ready, areas: this.areas.map((a) => ({ ...a })), activeId: this.run?.areaId ?? null };
    this.listeners.forEach((l) => l());
  }

  getArea(id: string): SavedArea | null {
    return this.areas.find((a) => a.id === id) ?? null;
  }

  private patch(id: string, p: Partial<SavedArea>): SavedArea | null {
    const a = this.areas.find((x) => x.id === id);
    if (!a) return null;
    Object.assign(a, p, { updatedAt: this.o.now().toISOString() });
    return a;
  }

  // ------------------------------------------------------------ persistence

  private persistNow(): Promise<void> {
    if (this.persistTimer != null) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.lastPersist = Date.now();
    const data: PersistedIndex = {
      version: 1,
      areas: this.areas.filter((a) => a.status !== 'deleting').map((a) => ({ ...a })),
    };
    this.persistChain = this.persistChain.then(() => this.o.io.saveIndex(data)).catch(() => undefined);
    return this.persistChain;
  }

  private persistSoon(): void {
    const wait = this.o.persistEveryMs - (Date.now() - this.lastPersist);
    if (wait <= 0) {
      void this.persistNow();
      return;
    }
    if (this.persistTimer == null) this.persistTimer = setTimeout(() => void this.persistNow(), wait);
  }

  /** Waits for queued index writes (tests, app background). */
  async flush(): Promise<void> {
    await this.persistNow();
  }

  // ------------------------------------------------------------ lifecycle

  /** Loads the saved index and resumes unfinished downloads. Safe to call many times. */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        let raw: unknown = null;
        try {
          raw = await this.o.io.loadIndex();
        } catch {
          raw = null;
        }
        const list = raw && typeof raw === 'object' && Array.isArray((raw as PersistedIndex).areas) ? (raw as PersistedIndex).areas : [];
        this.areas = list.map(sanitizeArea).filter((a): a is SavedArea => a !== null);
        for (const a of this.areas) {
          if (a.status === 'downloading' || a.status === 'waiting_network') a.status = 'queued';
          if (a.status === 'deleting') a.status = 'paused';
          if (a.cursor >= a.totalTiles && a.status !== 'error') a.status = 'complete';
        }
        this.ready = true;
        this.emit();
        this.pump();
      })();
    }
    return this.initPromise;
  }

  /** Call when connectivity changes. */
  setOnline(online: boolean): void {
    if (!online) return; // running workers notice on their next tile
    let changed = false;
    for (const a of this.areas) {
      if (a.status === 'waiting_network') {
        a.status = 'queued';
        changed = true;
      }
    }
    if (changed) this.emit();
    this.pump();
  }

  // ------------------------------------------------------------ public actions

  estimate(input: Pick<NewAreaInput, 'providerId' | 'bbox' | 'minZoom' | 'maxZoom'>) {
    const p = this.o.lookupProvider(input.providerId);
    if (!p || !isValidBBox(input.bbox)) return { tiles: 0, bytes: 0, perZoom: [] as Array<{ z: number; tiles: number }> };
    return estimateArea(input.bbox, input.minZoom, input.maxZoom, p.avgTileBytes);
  }

  /** Validates (licensing, key, limits, disk space) and queues a new area. Throws Error(reason) when refused. */
  async addArea(input: NewAreaInput): Promise<SavedArea> {
    await this.init();
    const p = this.o.lookupProvider(input.providerId);
    if (!isValidBBox(input.bbox)) throw new Error('That area is not valid. Frame a smaller area that does not cross the date line.');
    const minZoom = Math.floor(input.minZoom);
    const maxZoom = Math.floor(input.maxZoom);
    if (!(minZoom >= 0) || !(maxZoom >= minZoom) || maxZoom > 22) throw new Error('Pick a valid zoom range.');
    if (p && maxZoom > p.maxZoom) throw new Error(`${p.name} only goes to zoom ${p.maxZoom}.`);
    // Cheap guard before counting a huge area tile by tile.
    const est = estimateArea(input.bbox, minZoom, maxZoom, p?.avgTileBytes ?? 0);
    const gate = canBulkDownload(p, {
      apiKey: this.o.getApiKey(),
      tileCount: est.tiles,
      agreementConfirmed: input.agreementConfirmed,
    });
    if (!gate.ok) throw new Error(gate.reason);
    const free = this.o.io.freeBytes();
    if (free != null && est.bytes > free * 0.9) {
      throw new Error('There is not enough free space on this phone for that area. Free up space or pick a smaller area.');
    }
    const now = this.o.now().toISOString();
    const area: SavedArea = {
      id: this.o.newId(),
      name: input.name.trim() || 'Saved area',
      providerId: p!.id,
      bbox: [...input.bbox] as BBox,
      minZoom,
      maxZoom,
      projectId: input.projectId ?? null,
      createdAt: now,
      updatedAt: now,
      totalTiles: est.tiles,
      estimatedBytes: est.bytes,
      cursor: 0,
      bytesAtCursor: 0,
      failedAtCursor: 0,
      doneTiles: 0,
      bytes: 0,
      failedTiles: 0,
      status: 'queued',
      error: null,
    };
    this.areas.push(area);
    this.emit();
    await this.persistNow();
    this.pump();
    return { ...area };
  }

  async pause(id: string): Promise<void> {
    const a = this.getArea(id);
    if (!a || a.status === 'complete' || a.status === 'deleting') return;
    this.patch(id, { status: 'paused' });
    if (this.run?.areaId === id) await this.stopRun();
    this.emit();
    await this.persistNow();
    this.pump();
  }

  async resume(id: string): Promise<void> {
    const a = this.getArea(id);
    if (!a || a.status === 'deleting') return;
    if (a.status === 'paused' || a.status === 'error' || a.status === 'waiting_network') {
      this.patch(id, { status: 'queued', error: null });
      this.emit();
      await this.persistNow();
    }
    this.pump();
  }

  /** Re-runs an area from the start (retry failed tiles); tiles already saved are skipped. */
  async retry(id: string): Promise<void> {
    const a = this.getArea(id);
    if (!a || a.status === 'deleting') return;
    if (this.run?.areaId === id) await this.stopRun();
    this.patch(id, {
      status: 'queued',
      error: null,
      cursor: 0,
      bytesAtCursor: 0,
      failedAtCursor: 0,
      doneTiles: 0,
      bytes: 0,
      failedTiles: 0,
    });
    this.emit();
    await this.persistNow();
    this.pump();
  }

  /** Stops the area if running and deletes its tiles that no other saved area of the same provider uses. */
  async remove(id: string): Promise<{ removedTiles: number }> {
    await this.init();
    const a = this.getArea(id);
    if (!a) return { removedTiles: 0 };
    a.status = 'deleting';
    this.emit();
    if (this.run?.areaId === id) await this.stopRun();
    const p = this.o.lookupProvider(a.providerId);
    let removed = 0;
    if (p) {
      const others = this.areas
        .filter((x) => x.id !== id && x.providerId === a.providerId && x.status !== 'deleting')
        .map((x) => tileRanges(x.bbox, x.minZoom, x.maxZoom));
      let n = 0;
      for (const t of exclusiveTiles(tileRanges(a.bbox, a.minZoom, a.maxZoom), others)) {
        try {
          this.o.io.removeAreaTile(p, t);
        } catch {
          // keep going
        }
        removed++;
        if (++n % this.o.deleteChunk === 0) await sleep(0);
      }
    }
    this.areas = this.areas.filter((x) => x.id !== id);
    this.emit();
    await this.persistNow();
    this.pump();
    return { removedTiles: removed };
  }

  // ------------------------------------------------------------ download loop

  private async stopRun(): Promise<void> {
    const r = this.run;
    if (!r) return;
    r.stop = true;
    r.aborts.forEach((c) => c.abort());
    await r.done;
  }

  private nextQueued(): SavedArea | null {
    return (
      this.areas
        .filter((a) => a.status === 'queued' || a.status === 'downloading')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null
    );
  }

  /** Starts the next queued area if nothing is running. */
  pump(): void {
    if (!this.ready || this.run || this.pumping) return;
    const next = this.nextQueued();
    if (!next) return;
    if (!this.o.isOnline()) {
      next.status = 'waiting_network';
      this.emit();
      this.persistSoon();
      return;
    }
    this.pumping = true;
    try {
      this.startRun(next);
    } finally {
      this.pumping = false;
    }
  }

  private startRun(area: SavedArea): void {
    const p = this.o.lookupProvider(area.providerId);
    const run: Run = { areaId: area.id, stop: false, aborts: new Set(), done: Promise.resolve() };
    this.run = run;
    if (!p) {
      this.patch(area.id, { status: 'error', error: 'This map source is no longer available.' });
      this.run = null;
      this.emit();
      this.persistSoon();
      return;
    }
    this.patch(area.id, { status: 'downloading', error: null });
    this.emit();
    run.done = this.execute(run, area, p).finally(() => {
      if (this.run === run) this.run = null;
      this.emit();
      void this.persistNow();
      // Let the caller of stopRun finish its bookkeeping before the next area starts.
      setTimeout(() => this.pump(), 0);
    });
  }

  private async execute(run: Run, area: SavedArea, p: TileProvider): Promise<void> {
    const ranges = tileRanges(area.bbox, area.minZoom, area.maxZoom);
    const total = area.totalTiles;
    let next = area.cursor;
    const above = new Map<number, { bytes: number; failed: boolean }>();
    let aboveBytes = 0;
    let aboveFailed = 0;
    let consecutiveFailures = 0;
    // Mutated from the workers; an object so control-flow narrowing does not pin the initial values.
    const flags: { fatal: string | null; offline: boolean } = { fatal: null, offline: false };
    let lastEmit = 0;

    const publish = (force = false) => {
      area.doneTiles = area.cursor + above.size;
      area.bytes = area.bytesAtCursor + aboveBytes;
      area.failedTiles = area.failedAtCursor + aboveFailed;
      const now = Date.now();
      if (force || now - lastEmit > 250) {
        lastEmit = now;
        area.updatedAt = this.o.now().toISOString();
        this.emit();
      }
      this.persistSoon();
    };

    const record = (idx: number, bytes: number, failed: boolean) => {
      above.set(idx, { bytes, failed });
      aboveBytes += bytes;
      if (failed) aboveFailed++;
      while (above.has(area.cursor)) {
        const r = above.get(area.cursor)!;
        above.delete(area.cursor);
        aboveBytes -= r.bytes;
        if (r.failed) aboveFailed--;
        area.bytesAtCursor += r.bytes;
        if (r.failed) area.failedAtCursor++;
        area.cursor++;
      }
      publish();
    };

    const fetchTile = async (t: TileCoord): Promise<number | 'offline' | 'stopped' | 'failed'> => {
      for (let attempt = 1; attempt <= this.o.attempts; attempt++) {
        if (run.stop) return 'stopped';
        if (!this.o.isOnline()) return 'offline';
        const url = tileUrl(p, t, this.o.getApiKey());
        if (!url) {
          flags.fatal = `${p.name} needs an API key. Add it under Map source, then tap Resume.`;
          return 'stopped';
        }
        const ac = new AbortController();
        run.aborts.add(ac);
        try {
          return await this.o.io.downloadAreaTile(p, t, url, ac.signal);
        } catch {
          if (run.stop) return 'stopped';
          if (!this.o.isOnline()) return 'offline';
          if (attempt < this.o.attempts) await sleep(this.o.backoffMs(attempt));
        } finally {
          run.aborts.delete(ac);
        }
      }
      return 'failed';
    };

    const worker = async () => {
      while (!run.stop && !flags.fatal && !flags.offline) {
        if (next >= total) return;
        const idx = next++;
        const t = tileAtIndex(ranges, idx);
        if (!t) return;
        const have = this.o.io.areaTileSize(p, t);
        if (have > 0) {
          consecutiveFailures = 0;
          record(idx, have, false);
          continue;
        }
        const res = await fetchTile(t);
        if (res === 'stopped') return;
        if (res === 'offline') {
          flags.offline = true;
          return;
        }
        if (res === 'failed') {
          consecutiveFailures++;
          record(idx, 0, true);
          if (consecutiveFailures >= this.o.maxConsecutiveFailures) {
            flags.fatal =
              'The map server keeps refusing tiles. Check the API key, your plan and your signal, then tap Retry.';
          }
          continue;
        }
        consecutiveFailures = 0;
        record(idx, res, false);
      }
    };

    const n = Math.max(1, Math.min(this.o.concurrency, 16));
    await Promise.all(Array.from({ length: n }, () => worker()));
    publish(true);

    const current = this.getArea(area.id);
    if (!current || current.status === 'deleting') return;
    if (flags.fatal) this.patch(area.id, { status: 'error', error: flags.fatal });
    else if (area.cursor >= total) this.patch(area.id, { status: 'complete', error: null });
    else if (flags.offline) this.patch(area.id, { status: 'waiting_network' });
    else if (run.stop && current.status === 'downloading') this.patch(area.id, { status: 'paused' });
  }
}

/** Upper bound used by the UI before counting (keeps the estimate step instant for huge frames). */
export const AREA_TILE_LIMIT = MAX_TILES_PER_AREA;
