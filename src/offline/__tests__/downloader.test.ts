import { DownloadManager, type DownloadIO, type PersistedIndex, type SavedArea } from '../downloader';
import type { TileProvider } from '../providers';
import { countTiles, tileKey, type BBox, type TileCoord } from '../tileMath';

const BOX_A: BBox = [-86.82, 33.51, -86.8, 33.53]; // 1514 tiles z12..19, use smaller zooms below
const BOX_B: BBox = [-86.81, 33.505, -86.79, 33.52];

class FakeDisk {
  files = new Map<string, number>();
  index: unknown = null;
  downloads = 0;
  failUrls: (url: string) => boolean = () => false;
  saves = 0;

  /** io() for one manager; setting life.dead freezes it forever, like a killed app process. */
  io(life: { dead: boolean } = { dead: false }): DownloadIO {
    return {
      areaTileSize: (p: TileProvider, t: TileCoord) => this.files.get(tileKey(p.id, t)) ?? 0,
      downloadAreaTile: async (p: TileProvider, t: TileCoord, url: string, signal: AbortSignal) => {
        // Real downloads take a network round trip; yield a macrotask so tests can observe progress.
        await new Promise((r) => setTimeout(r, 1));
        if (life.dead) await new Promise(() => undefined);
        if (signal.aborted) throw new Error('aborted');
        this.downloads++;
        if (this.failUrls(url)) throw new Error('HTTP 403');
        this.files.set(tileKey(p.id, t), 1000);
        return 1000;
      },
      removeAreaTile: (p: TileProvider, t: TileCoord) => {
        this.files.delete(tileKey(p.id, t));
      },
      loadIndex: async () => (this.index ? JSON.parse(JSON.stringify(this.index)) : null),
      saveIndex: async (idx: PersistedIndex) => {
        this.saves++;
        this.index = JSON.parse(JSON.stringify(idx));
      },
      freeBytes: () => 10 * 1024 ** 3,
    };
  }
}

function makeManager(
  disk: FakeDisk,
  net = { online: true },
  extra: Partial<ConstructorParameters<typeof DownloadManager>[0]> = {},
  life = { dead: false },
) {
  let n = 0;
  return new DownloadManager({
    io: disk.io(life),
    isOnline: () => net.online,
    getApiKey: () => null,
    backoffMs: () => 0,
    persistEveryMs: 0,
    newId: () => `a${++n}`,
    ...extra,
  });
}

async function waitFor(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 2));
  }
}

const area = (m: DownloadManager, id: string): SavedArea => m.getArea(id)!;

describe('DownloadManager', () => {
  it('downloads every tile of an area once and records bytes and completion', async () => {
    const disk = new FakeDisk();
    const m = makeManager(disk);
    await m.init();
    const a = await m.addArea({ name: 'Downtown', providerId: 'test-osm', bbox: BOX_A, minZoom: 12, maxZoom: 17 });
    const total = countTiles(BOX_A, 12, 17);
    expect(a.totalTiles).toBe(total);
    expect(a.estimatedBytes).toBe(total * 15 * 1024);
    await waitFor(() => area(m, a.id).status === 'complete');
    const done = area(m, a.id);
    expect(done.doneTiles).toBe(total);
    expect(done.cursor).toBe(total);
    expect(done.bytes).toBe(total * 1000);
    expect(done.failedTiles).toBe(0);
    expect(disk.downloads).toBe(total);
    await m.flush();
    expect((disk.index as PersistedIndex).areas[0].status).toBe('complete');
  });

  it('refuses providers and sizes the licensing or limits do not allow', async () => {
    const m = makeManager(new FakeDisk());
    await expect(m.addArea({ name: 'x', providerId: 'esri-imagery', bbox: BOX_A, minZoom: 12, maxZoom: 15 })).rejects.toThrow(
      /does not allow saving/,
    );
    await expect(m.addArea({ name: 'x', providerId: 'osm-standard', bbox: BOX_A, minZoom: 12, maxZoom: 15 })).rejects.toThrow(
      /does not allow saving/,
    );
    // 1514 tiles is over the 500 tile test cap
    await expect(m.addArea({ name: 'x', providerId: 'test-osm', bbox: BOX_A, minZoom: 12, maxZoom: 19 })).rejects.toThrow(/500/);
    await expect(
      m.addArea({ name: 'x', providerId: 'maptiler-satellite', bbox: BOX_A, minZoom: 12, maxZoom: 15 }),
    ).rejects.toThrow(/API key/);
    await expect(m.addArea({ name: 'x', providerId: 'test-osm', bbox: [10, 5, 9, 6], minZoom: 12, maxZoom: 13 })).rejects.toThrow(
      /not valid/,
    );
    expect(m.getSnapshot().areas).toHaveLength(0);
  });

  it('accepts MapTiler only with a key and a confirmed agreement', async () => {
    const disk = new FakeDisk();
    const m = makeManager(disk, { online: true }, { getApiKey: () => 'KEY' });
    await expect(
      m.addArea({ name: 'x', providerId: 'maptiler-streets', bbox: BOX_A, minZoom: 12, maxZoom: 14 }),
    ).rejects.toThrow(/agreement/);
    const urls: string[] = [];
    disk.failUrls = (u) => {
      urls.push(u);
      return false;
    };
    const a = await m.addArea({
      name: 'x',
      providerId: 'maptiler-streets',
      bbox: BOX_A,
      minZoom: 12,
      maxZoom: 14,
      agreementConfirmed: true,
    });
    await waitFor(() => area(m, a.id).status === 'complete');
    expect(urls[0]).toMatch(/^https:\/\/api\.maptiler\.com\/maps\/streets-v2\/256\/12\/\d+\/\d+\.png\?key=KEY$/);
  });

  it('resumes after an app restart from the persisted cursor without re-downloading', async () => {
    const disk = new FakeDisk();
    const life1 = { dead: false };
    const m1 = makeManager(disk, { online: true }, {}, life1);
    await m1.init();
    const a = await m1.addArea({ name: 'R', providerId: 'test-osm', bbox: BOX_A, minZoom: 12, maxZoom: 17 });
    const total = a.totalTiles;
    await waitFor(() => area(m1, a.id).doneTiles >= 40);
    // "Kill the app": freeze downloads, persist, and drop the manager.
    life1.dead = true;
    await m1.flush();
    const saved = (disk.index as PersistedIndex).areas[0];
    expect(saved.status).toBe('downloading');
    expect(saved.cursor).toBeGreaterThan(0);
    expect(saved.cursor).toBeLessThan(total);
    const before = disk.downloads;

    const m2 = makeManager(disk);
    await m2.init();
    await waitFor(() => area(m2, a.id)?.status === 'complete');
    const done = area(m2, a.id);
    expect(done.doneTiles).toBe(total);
    expect(done.bytes).toBe(total * 1000);
    // m2 only fetched what was missing above the persisted cursor
    expect(disk.files.size).toBe(total);
    expect(disk.downloads - before).toBeLessThanOrEqual(total - saved.cursor);
  });

  it('pause stops downloading; resume finishes', async () => {
    const disk = new FakeDisk();
    const m = makeManager(disk);
    await m.init();
    const a = await m.addArea({ name: 'P', providerId: 'test-osm', bbox: BOX_A, minZoom: 12, maxZoom: 17 });
    await waitFor(() => area(m, a.id).doneTiles >= 10);
    await m.pause(a.id);
    expect(area(m, a.id).status).toBe('paused');
    const n = disk.downloads;
    await new Promise((r) => setTimeout(r, 20));
    expect(disk.downloads).toBe(n);
    await m.resume(a.id);
    await waitFor(() => area(m, a.id).status === 'complete');
    expect(area(m, a.id).doneTiles).toBe(a.totalTiles);
  });

  it('waits for network and continues when it comes back', async () => {
    const disk = new FakeDisk();
    const net = { online: true };
    const m = makeManager(disk, net);
    await m.init();
    const a = await m.addArea({ name: 'N', providerId: 'test-osm', bbox: BOX_A, minZoom: 12, maxZoom: 17 });
    await waitFor(() => area(m, a.id).doneTiles >= 10);
    net.online = false;
    await waitFor(() => area(m, a.id).status === 'waiting_network');
    expect(area(m, a.id).doneTiles).toBeLessThan(a.totalTiles);
    net.online = true;
    m.setOnline(true);
    await waitFor(() => area(m, a.id).status === 'complete');
    expect(area(m, a.id).failedTiles).toBe(0);
  });

  it('stops with a clear error when the server keeps refusing', async () => {
    const disk = new FakeDisk();
    disk.failUrls = () => true;
    const m = makeManager(disk, { online: true }, { maxConsecutiveFailures: 5 });
    await m.init();
    const a = await m.addArea({ name: 'E', providerId: 'test-osm', bbox: BOX_A, minZoom: 12, maxZoom: 16 });
    await waitFor(() => area(m, a.id).status === 'error');
    expect(area(m, a.id).error).toMatch(/keeps refusing/);
    expect(area(m, a.id).failedTiles).toBeGreaterThanOrEqual(5);
  });

  it('delete removes only tiles no other saved area uses', async () => {
    const disk = new FakeDisk();
    const m = makeManager(disk);
    await m.init();
    const a = await m.addArea({ name: 'A', providerId: 'test-osm', bbox: BOX_A, minZoom: 14, maxZoom: 17 });
    const b = await m.addArea({ name: 'B', providerId: 'test-osm', bbox: BOX_B, minZoom: 14, maxZoom: 17 });
    await waitFor(() => area(m, a.id).status === 'complete' && area(m, b.id).status === 'complete');
    const union = disk.files.size;
    expect(union).toBeLessThan(a.totalTiles + b.totalTiles); // overlap downloaded once
    const { removedTiles } = await m.remove(a.id);
    expect(removedTiles).toBe(union - b.totalTiles);
    expect(disk.files.size).toBe(b.totalTiles); // every tile of B survived
    expect(m.getArea(a.id)).toBeNull();
    await m.remove(b.id);
    expect(disk.files.size).toBe(0);
    expect((disk.index as PersistedIndex).areas).toHaveLength(0);
  });

  it('ignores a corrupt index and sanitizes stored areas', async () => {
    const disk = new FakeDisk();
    disk.index = {
      version: 1,
      areas: [
        { id: 'ok', name: 'Ok', providerId: 'test-osm', bbox: BOX_A, minZoom: 12, maxZoom: 13, cursor: 999, status: 'complete' },
        { id: 'bad', providerId: 'test-osm', bbox: [1, 2], minZoom: 1, maxZoom: 2 },
        'junk',
      ],
    };
    const m = makeManager(disk);
    await m.init();
    const areas = m.getSnapshot().areas;
    expect(areas.map((x) => x.id)).toEqual(['ok']);
    expect(areas[0].cursor).toBe(countTiles(BOX_A, 12, 13));
  });
});
