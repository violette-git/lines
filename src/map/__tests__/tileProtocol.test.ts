import { base64ToArrayBuffer, installTileProtocol, type TileRequestMessage } from '../core/mapCore';

type Handler = (p: { url: string }, ac: AbortController) => Promise<{ data: ArrayBuffer }>;

function setup() {
  let handler: Handler | null = null;
  const ml = { addProtocol: (scheme: string, fn: Handler) => (scheme === 'lmtile' ? (handler = fn) : null) };
  const posted: TileRequestMessage[] = [];
  const client = installTileProtocol(ml, 'lmtile', (m) => posted.push(m), { timeoutMs: 1000 });
  return { client, posted, load: (url: string, ac = new AbortController()) => handler!({ url }, ac) };
}

describe('installTileProtocol (page side of the native tile cache)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('batches requests into one message and resolves with decoded bytes', async () => {
    const { client, posted, load } = setup();
    const p1 = load('lmtile://test-osm/1/0/0');
    const p2 = load('lmtile://test-osm/1/1/0');
    expect(posted).toHaveLength(0);
    jest.advanceTimersByTime(0);
    expect(posted).toHaveLength(1);
    expect(posted[0].reqs.map((r) => r.url)).toEqual(['lmtile://test-osm/1/0/0', 'lmtile://test-osm/1/1/0']);
    const [id1, id2] = posted[0].reqs.map((r) => r.id);
    client.receive([
      { id: id1, data: 'iVBORw==' },
      { id: id2, data: null },
    ]);
    const r1 = await p1;
    expect(Array.from(new Uint8Array(r1.data))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await expect(p2).rejects.toThrow('tile unavailable');
    expect(client.pending()).toBe(0);
  });

  it('drops aborted requests before sending and reports aborts after sending', async () => {
    const { client, posted, load } = setup();
    const ac1 = new AbortController();
    const p1 = load('lmtile://test-osm/2/0/0', ac1);
    ac1.abort();
    await expect(p1).rejects.toThrow('aborted');
    const ac2 = new AbortController();
    const p2 = load('lmtile://test-osm/2/1/0', ac2);
    jest.advanceTimersByTime(0);
    expect(posted).toHaveLength(1);
    expect(posted[0].reqs.map((r) => r.url)).toEqual(['lmtile://test-osm/2/1/0']);
    ac2.abort();
    await expect(p2).rejects.toThrow('aborted');
    jest.advanceTimersByTime(0);
    expect(posted[1]).toEqual({ type: 'tileReq', reqs: [], cancel: [posted[0].reqs[0].id] });
    client.receive([{ id: posted[0].reqs[0].id, data: 'AAAA' }]); // late answer is ignored
    expect(client.pending()).toBe(0);
  });

  it('times out and fails everything on reset', async () => {
    const { client, load } = setup();
    const p1 = load('lmtile://test-osm/3/0/0');
    jest.advanceTimersByTime(1001);
    await expect(p1).rejects.toThrow('timeout');
    const p2 = load('lmtile://test-osm/3/1/0');
    client.failAll();
    await expect(p2).rejects.toThrow('reset');
  });

  it('decodes base64', () => {
    expect(Array.from(new Uint8Array(base64ToArrayBuffer('AQID')))).toEqual([1, 2, 3]);
  });
});
