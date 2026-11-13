// React Native side of the WebView tile protocol. The map page asks for "lmtile://<provider>/z/x/y";
// this host answers from (1) a small in-memory LRU, (2) tiles on disk (saved areas, then the browsing
// cache), or (3) the network when online, storing what it fetched in the browsing cache.
//
// Efficiency rules: duplicate requests for one tile share a job, disk reads and network fetches have
// separate concurrency limits, cancelled requests are dropped from the queues (in-flight fetches are
// aborted when nobody wants them any more), and answers are batched into one injectJavaScript call.
// All I/O is injected so this file is unit tested without a device.
import { getProvider, tileUrl, type TileProvider } from './providers';
import { parseTileUrl, tileKey, type TileCoord } from './tileMath';

export interface TileReplyOut {
  id: number;
  data: string | null;
}

export type TileServeSource = 'memory' | 'disk' | 'network' | 'miss';

export interface TileHostIO {
  /** base64 bytes of a stored tile (saved areas first, then the browsing cache), or null. */
  read(provider: TileProvider, t: TileCoord): Promise<string | null>;
  /** Downloads into the browsing cache and returns base64 bytes, or null on failure. */
  fetch(provider: TileProvider, t: TileCoord, url: string, signal: AbortSignal): Promise<string | null>;
}

export interface TileHostOptions {
  io: TileHostIO;
  /** Delivers a batch of answers to the page. */
  send(items: TileReplyOut[]): void;
  isOnline(): boolean;
  getApiKey(): string | null;
  lookupProvider?: (id: string) => TileProvider | null;
  /** Default 6. */
  maxConcurrentFetches?: number;
  /** Default 8. */
  maxConcurrentReads?: number;
  /** In-memory LRU budget in base64 characters (default 12M, about 9 MB of tiles). */
  memoryCapChars?: number;
  /** Answers are held this long to batch them (default 16 ms). */
  flushDelayMs?: number;
  /** A batch is sent at once when it reaches this many characters (default 1.5M). */
  maxBatchChars?: number;
  onServe?: (source: TileServeSource) => void;
}

interface Job {
  key: string;
  provider: TileProvider;
  tile: TileCoord;
  ids: Set<number>;
  phase: 'readQueue' | 'reading' | 'fetchQueue' | 'fetching';
  abort: AbortController | null;
}

/** Simple LRU of base64 strings with a character budget. */
export class Base64Lru {
  private map = new Map<string, string>();
  private chars = 0;
  constructor(private readonly capChars: number) {}

  get(key: string): string | null {
    const v = this.map.get(key);
    if (v === undefined) return null;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: string): void {
    if (value.length > this.capChars / 4) return;
    const old = this.map.get(key);
    if (old !== undefined) {
      this.chars -= old.length;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.chars += value.length;
    while (this.chars > this.capChars && this.map.size > 0) {
      const oldest = this.map.keys().next().value as string;
      const ov = this.map.get(oldest);
      this.map.delete(oldest);
      if (ov !== undefined) this.chars -= ov.length;
    }
  }

  get size(): number {
    return this.map.size;
  }

  get usedChars(): number {
    return this.chars;
  }

  clear(): void {
    this.map.clear();
    this.chars = 0;
  }
}

export class TileHost {
  private readonly o: Required<Omit<TileHostOptions, 'onServe' | 'lookupProvider'>> &
    Pick<TileHostOptions, 'onServe'> & { lookupProvider: (id: string) => TileProvider | null };
  private readonly memory: Base64Lru;
  private readonly jobs = new Map<string, Job>();
  private readonly jobByRequest = new Map<number, Job>();
  private readQueue: Job[] = [];
  private fetchQueue: Job[] = [];
  private reading = 0;
  private fetching = 0;
  private outbox: TileReplyOut[] = [];
  private outChars = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(opts: TileHostOptions) {
    this.o = {
      maxConcurrentFetches: 6,
      maxConcurrentReads: 8,
      memoryCapChars: 12_000_000,
      flushDelayMs: 16,
      maxBatchChars: 1_500_000,
      lookupProvider: getProvider,
      ...opts,
    };
    this.memory = new Base64Lru(this.o.memoryCapChars);
  }

  /** Number of tiles waiting for disk or network (for diagnostics and tests). */
  get queued(): number {
    return this.jobs.size;
  }

  request(reqs: Array<{ id: number; url: string }> | null | undefined): void {
    if (!reqs) return;
    for (const r of reqs) {
      if (!r || typeof r.id !== 'number' || typeof r.url !== 'string') continue;
      const parsed = parseTileUrl(r.url);
      const provider = parsed ? this.o.lookupProvider(parsed.providerId) : null;
      if (!parsed || !provider || !provider.allowsOfflineCaching) {
        this.reply(r.id, null, 'miss');
        continue;
      }
      const key = tileKey(provider.id, parsed.tile);
      const mem = this.memory.get(key);
      if (mem) {
        this.reply(r.id, mem, 'memory');
        continue;
      }
      const existing = this.jobs.get(key);
      if (existing && !existing.abort?.signal.aborted) {
        existing.ids.add(r.id);
        this.jobByRequest.set(r.id, existing);
        continue;
      }
      const job: Job = { key, provider, tile: parsed.tile, ids: new Set([r.id]), phase: 'readQueue', abort: null };
      this.jobs.set(key, job);
      this.jobByRequest.set(r.id, job);
      this.readQueue.push(job);
    }
    this.pump();
  }

  cancel(ids: number[] | null | undefined): void {
    if (!ids) return;
    for (const id of ids) {
      const job = this.jobByRequest.get(id);
      if (!job) continue;
      this.jobByRequest.delete(id);
      job.ids.delete(id);
      if (job.ids.size > 0) continue;
      // Nobody wants this tile any more.
      if (job.phase === 'readQueue') {
        this.readQueue = this.readQueue.filter((j) => j !== job);
        this.dropJob(job);
      } else if (job.phase === 'fetchQueue') {
        this.fetchQueue = this.fetchQueue.filter((j) => j !== job);
        this.dropJob(job);
      } else if (job.phase === 'fetching') {
        job.abort?.abort();
      }
      // 'reading' finishes quickly; its result is simply discarded (job has no ids).
    }
    this.pump();
  }

  /** Drop all work (WebView reloaded or unmounted). Pending page requests are not answered. */
  reset(): void {
    this.generation++;
    for (const job of this.jobs.values()) job.abort?.abort();
    this.jobs.clear();
    this.jobByRequest.clear();
    this.readQueue = [];
    this.fetchQueue = [];
    this.reading = 0;
    this.fetching = 0;
    this.outbox = [];
    this.outChars = 0;
    if (this.flushTimer != null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  /** Forget cached tile bytes (for example after deleting saved areas). */
  clearMemory(): void {
    this.memory.clear();
  }

  private dropJob(job: Job): void {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
  }

  private finish(job: Job, data: string | null, source: TileServeSource): void {
    this.dropJob(job);
    if (data) this.memory.set(job.key, data);
    for (const id of job.ids) {
      this.jobByRequest.delete(id);
      this.reply(id, data, source);
    }
    job.ids.clear();
  }

  private pump(): void {
    while (this.reading < this.o.maxConcurrentReads && this.readQueue.length > 0) {
      const job = this.readQueue.shift()!;
      job.phase = 'reading';
      this.reading++;
      const gen = this.generation;
      this.o.io
        .read(job.provider, job.tile)
        .catch(() => null)
        .then((data) => {
          if (gen !== this.generation) return;
          this.reading--;
          if (job.ids.size === 0) {
            this.dropJob(job);
          } else if (data) {
            this.finish(job, data, 'disk');
          } else {
            const url = this.o.isOnline() ? tileUrl(job.provider, job.tile, this.o.getApiKey()) : null;
            if (url) {
              job.phase = 'fetchQueue';
              this.fetchQueue.push(job);
            } else {
              this.finish(job, null, 'miss');
            }
          }
          this.pump();
        });
    }
    while (this.fetching < this.o.maxConcurrentFetches && this.fetchQueue.length > 0) {
      const job = this.fetchQueue.shift()!;
      const url = tileUrl(job.provider, job.tile, this.o.getApiKey());
      if (!url || !this.o.isOnline()) {
        this.finish(job, null, 'miss');
        continue;
      }
      job.phase = 'fetching';
      job.abort = new AbortController();
      this.fetching++;
      const gen = this.generation;
      this.o.io
        .fetch(job.provider, job.tile, url, job.abort.signal)
        .catch(() => null)
        .then((data) => {
          if (gen !== this.generation) return;
          this.fetching--;
          if (job.ids.size === 0) this.dropJob(job);
          else this.finish(job, data, data ? 'network' : 'miss');
          this.pump();
        });
    }
  }

  private reply(id: number, data: string | null, source: TileServeSource): void {
    this.o.onServe?.(source);
    this.outbox.push({ id, data });
    this.outChars += (data ? data.length : 0) + 16;
    if (this.outChars >= this.o.maxBatchChars) {
      this.flush();
      return;
    }
    if (this.flushTimer == null) this.flushTimer = setTimeout(() => this.flush(), this.o.flushDelayMs);
  }

  flush(): void {
    if (this.flushTimer != null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.outbox.length === 0) return;
    const items = this.outbox;
    this.outbox = [];
    this.outChars = 0;
    this.o.send(items);
  }
}
