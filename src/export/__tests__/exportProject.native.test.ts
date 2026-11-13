// Exercises the native delivery path against mocked Expo modules (shapes taken from the
// installed SDK 58 type definitions).
const mockWrite = jest.fn(async (_c: unknown) => undefined);
const mockCreate = jest.fn();
const mockMove = jest.fn(async (_dest: unknown, _opts?: unknown) => undefined);
const mockShare = jest.fn(async (_uri: string, _opts?: unknown) => undefined);
const mockPrint = jest.fn(async (_o: { html?: string }) => ({ uri: 'file:///cache/Print/abc.pdf', numberOfPages: 2 }));

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    create(opts: unknown) {
      mockCreate(this.uri, opts);
    }
    write(c: unknown) {
      return mockWrite(c);
    }
    async move(dest: { uri: string }, opts?: unknown) {
      await mockMove(dest, opts);
      this.uri = dest.uri;
    }
  }
  return { File: MockFile, Paths: { cache: { uri: 'file:///cache' } } };
});
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: (u: string, o?: unknown) => mockShare(u, o) }));
jest.mock('expo-print', () => ({ printToFileAsync: (o: { html?: string }) => mockPrint(o) }));

import { exportProject } from '..';
import { makeBundle } from '../__fixtures__/bundle';

beforeEach(() => jest.clearAllMocks());

describe('exportProject (native)', () => {
  it('writes KMZ bytes to the cache and shares with mime type', async () => {
    const res = await exportProject(makeBundle(), 'kmz');
    expect(res.fileName).toMatch(/^main-st-fiber-phase-2_\d{8}\.kmz$/);
    expect(res.uri).toBe(`file:///cache/${res.fileName}`);
    expect(mockCreate).toHaveBeenCalledWith(res.uri, { overwrite: true, intermediates: true });
    expect(mockWrite.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(mockShare).toHaveBeenCalledWith(res.uri, expect.objectContaining({ mimeType: 'application/vnd.google-earth.kmz' }));
  });

  it('writes GeoJSON as text without a UTI', async () => {
    const res = await exportProject(makeBundle(), 'geojson');
    expect(typeof mockWrite.mock.calls[0][0]).toBe('string');
    const opts = mockShare.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.mimeType).toBe('application/geo+json');
    expect(opts.UTI).toBeUndefined();
    expect(res.fileName.endsWith('.geojson')).toBe(true);
  });

  it('prints PDF via expo-print, renames it, then shares', async () => {
    const res = await exportProject(makeBundle(), 'pdf');
    expect(mockPrint).toHaveBeenCalledTimes(1);
    expect(mockPrint.mock.calls[0][0].html).toContain('P-1');
    expect(mockMove).toHaveBeenCalled();
    expect(res.uri).toBe(`file:///cache/${res.fileName}`);
    expect(mockShare).toHaveBeenCalledWith(res.uri, expect.objectContaining({ mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }));
  });

  it('builds every format', async () => {
    for (const f of ['csv', 'xlsx', 'shapefile'] as const) {
      const res = await exportProject(makeBundle(), f);
      expect(res.fileName).toMatch(f === 'shapefile' ? /_shp\.zip$/ : f === 'csv' ? /_csv\.zip$/ : /\.xlsx$/);
    }
    expect(mockShare).toHaveBeenCalledTimes(3);
  });
});
