import { getProvider, type TileProvider } from '../providers';
import { Base64Lru, TileHost, type TileReplyOut } from '../tileHost';
import type { TileCoord } from '../tileMath';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(over: { online?: boolean; disk?: Record<string, string> } = {}) {
  const disk = over.disk ?? {};
  const sent: TileReplyOut[][] = [];
  const reads: string[] = [];
  const fetches: Array<{ url: string; signal: AbortSignal; d: ReturnType<typeof deferred<string | null>> }> = [];
  let online = over.online ?? true;
  const host = new TileHost({
    io: {
      read: async (p: TileProvider, t: TileCoord) => {
        const k = `${p.id}/${t.z}/${t.x}/${t.y}`;
        reads.push(k);
        return disk[k] ?? null;
      },
      fetch: (_p, _t, url, signal) => {
        const d = deferred<string | null>();
        fetches.push({ url, signal, d });
        return d.promise;
      },
    },
    send: (items) => sent.push(items),
    isOnline: () => online,
    getApiKey: () => null,
    maxConcurrentFetches: 2,
    flushDelayMs: 1,
  });
  return { host, sent, reads, fetches, setOnline: (v: boolean) => (online = v) };
}

const url = (z: number, x: number, y: number) => `lmtile://test-osm/${z}/${x}/${y}`;

describe('TileHost', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('answers disk hits in one batch and then from memory', async () => {
    const { host, sent, reads } = setup({ disk: { 'test-osm/1/0/0': 'AAAA', 'test-osm/1/1/0': 'BBBB' } });
    host.request([
      { id: 1, url: url(1, 0, 0) },
      { id: 2, url: url(1, 1, 0) },
    ]);
    await flush();
    jest.advanceTimersByTime(5);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([
      { id: 1, data: 'AAAA' },
      { id: 2, data: 'BBBB' },
    ]);
    host.request([{ id: 3, url: url(1, 0, 0) }]);
    jest.advanceTimersByTime(5);
    expect(sent[1]).toEqual([{ id: 3, data: 'AAAA' }]);
    expect(reads).toHaveLength(2); // the third came from memory
  });

  it('dedupes concurrent requests for one tile and limits network concurrency', async () => {
    const { host, sent, fetches } = setup();
    host.request([
      { id: 1, url: url(2, 0, 0) },
      { id: 2, url: url(2, 0, 0) },
      { id: 3, url: url(2, 1, 0) },
      { id: 4, url: url(2, 2, 0) },
    ]);
    await flush();
    expect(fetches).toHaveLength(2); // cap of 2
    expect(fetches[0].url).toBe('https://tile.openstreetmap.org/2/0/0.png');
    fetches[0].d.resolve('Z0');
    await flush();
    expect(fetches).toHaveLength(3);
    fetches[1].d.resolve('Z1');
    fetches[2].d.resolve(null);
    await flush();
    jest.advanceTimersByTime(5);
    const all = sent.flat();
    expect(all).toEqual(
      expect.arrayContaining([
        { id: 1, data: 'Z0' },
        { id: 2, data: 'Z0' },
        { id: 3, data: 'Z1' },
        { id: 4, data: null },
      ]),
    );
  });

  it('cancels queued work and aborts in-flight fetches nobody wants', async () => {
    const { host, sent, fetches } = setup();
    host.request([
      { id: 1, url: url(3, 0, 0) },
      { id: 2, url: url(3, 1, 0) },
      { id: 3, url: url(3, 2, 0) },
    ]);
    await flush();
    expect(fetches).toHaveLength(2);
    host.cancel([3]); // still queued for network: dropped
    host.cancel([1]); // in flight: aborted
    expect(fetches[0].signal.aborted).toBe(true);
    fetches[0].d.resolve(null);
    fetches[1].d.resolve('Q');
    await flush();
    jest.advanceTimersByTime(5);
    expect(fetches).toHaveLength(2); // tile 3 never fetched
    expect(sent.flat()).toEqual([{ id: 2, data: 'Q' }]);
    expect(host.queued).toBe(0);
  });

  it('offline: answers misses without touching the network', async () => {
    const { host, sent, fetches } = setup({ online: false, disk: { 'test-osm/4/1/1': 'HIT' } });
    host.request([
      { id: 1, url: url(4, 1, 1) },
      { id: 2, url: url(4, 2, 2) },
    ]);
    await flush();
    jest.advanceTimersByTime(5);
    expect(fetches).toHaveLength(0);
    expect(sent.flat()).toEqual([
      { id: 1, data: 'HIT' },
      { id: 2, data: null },
    ]);
  });

  it('refuses unknown or online-only providers and garbage', async () => {
    const { host, sent, reads } = setup();
    host.request([
      { id: 1, url: 'lmtile://esri-imagery/1/0/0' },
      { id: 2, url: 'lmtile://nope/1/0/0' },
      { id: 3, url: 'javascript:alert(1)' },
    ]);
    jest.advanceTimersByTime(5);
    expect(reads).toHaveLength(0);
    expect(sent.flat().map((x) => x.data)).toEqual([null, null, null]);
    expect(getProvider('esri-imagery')!.allowsOfflineCaching).toBe(false);
  });

  it('reset drops everything and ignores late results', async () => {
    const { host, sent, fetches } = setup();
    host.request([{ id: 1, url: url(5, 0, 0) }]);
    await flush();
    host.reset();
    fetches[0].d.resolve('LATE');
    await flush();
    jest.advanceTimersByTime(5);
    expect(sent).toHaveLength(0);
    expect(fetches[0].signal.aborted).toBe(true);
  });
});

describe('Base64Lru', () => {
  it('evicts least recently used entries past the budget', () => {
    const lru = new Base64Lru(40);
    lru.set('a', '1234567890');
    lru.set('b', '1234567890');
    lru.set('c', '1234567890');
    expect(lru.get('a')).not.toBeNull(); // a is now most recent
    lru.set('d', '1234567890');
    lru.set('e', '1234567890');
    expect(lru.usedChars).toBeLessThanOrEqual(40);
    expect(lru.get('b')).toBeNull();
    expect(lru.get('a')).not.toBeNull();
    lru.set('huge', 'x'.repeat(30)); // over a quarter of the budget: not cached
    expect(lru.get('huge')).toBeNull();
  });
});
