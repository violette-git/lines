import { getBasemap } from '@/map/basemaps';

import {
  canBulkDownload,
  defaultZoomRange,
  getProvider,
  MAX_TILES_PER_AREA,
  PROVIDERS,
  protocolTemplate,
  resolveProvider,
  tileUrl,
} from '../providers';

const t = { z: 16, x: 16964, y: 26284 };

describe('getProvider', () => {
  it('ignores inherited object keys sent by the map page', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(getProvider(id)).toBeNull();
    }
    expect(getProvider('test-osm')?.id).toBe('test-osm');
  });
});

describe('provider table', () => {
  it('has the required providers with complete configs', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['maptiler-satellite', 'maptiler-streets', 'esri-imagery', 'osm-standard', 'test-osm']),
    );
    for (const p of PROVIDERS) {
      expect(p.urlTemplates.length).toBeGreaterThan(0);
      for (const u of p.urlTemplates) {
        expect(u).toContain('{z}');
        expect(u).toContain('{x}');
        expect(u).toContain('{y}');
        expect(u.startsWith('https://')).toBe(true);
        expect(u.includes('{key}')).toBe(p.needsKey);
      }
      expect(p.attribution.length).toBeGreaterThan(10);
      expect(p.termsUrl.startsWith('https://')).toBe(true);
      expect(p.note.length).toBeGreaterThan(20);
      expect(p.note).not.toMatch(/\u2014/);
    }
    expect(getProvider('esri-imagery')!.allowsOfflineCaching).toBe(false);
    expect(getProvider('osm-standard')!.allowsOfflineCaching).toBe(false);
    expect(getProvider('maptiler-satellite')!.allowsOfflineCaching).toBe(true);
    expect(getProvider('test-osm')!.maxTilesPerArea).toBe(500);
  });

  it('fills URL templates (Esri uses z/y/x) and refuses keyed providers without a key', () => {
    expect(tileUrl(getProvider('esri-imagery')!, t)).toBe(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/26284/16964',
    );
    expect(tileUrl(getProvider('osm-standard')!, t)).toBe('https://tile.openstreetmap.org/16/16964/26284.png');
    expect(tileUrl(getProvider('maptiler-satellite')!, t, null)).toBeNull();
    expect(tileUrl(getProvider('maptiler-satellite')!, t, ' k&y ')).toBe(
      'https://api.maptiler.com/maps/satellite/256/16/16964/26284.jpg?key=k%26y',
    );
    expect(protocolTemplate(getProvider('test-osm')!)).toBe('lmtile://test-osm/{z}/{x}/{y}');
  });

  it('defaults zoom ranges: imagery to 19, streets to 18', () => {
    expect(defaultZoomRange(getProvider('maptiler-satellite')!)).toEqual({ minZoom: 12, maxZoom: 19 });
    expect(defaultZoomRange(getProvider('maptiler-streets')!)).toEqual({ minZoom: 12, maxZoom: 18 });
  });
});

describe('canBulkDownload gating', () => {
  it('refuses providers that forbid offline storage, in plain language', () => {
    for (const id of ['esri-imagery', 'osm-standard']) {
      const g = canBulkDownload(getProvider(id), { tileCount: 10 });
      expect(g.ok).toBe(false);
      if (!g.ok) {
        expect(g.code).toBe('no_caching');
        expect(g.reason).toMatch(/does not allow saving/);
        expect(g.reason).toMatch(/signal/);
      }
    }
  });

  it('needs a key, then a confirmed agreement, for MapTiler', () => {
    const p = getProvider('maptiler-satellite');
    const noKey = canBulkDownload(p, { tileCount: 10 });
    expect(noKey.ok || noKey.code).toBe('needs_key');
    const noAgreement = canBulkDownload(p, { tileCount: 10, apiKey: 'abc' });
    expect(noAgreement.ok || noAgreement.code).toBe('needs_agreement');
    expect(canBulkDownload(p, { tileCount: 10, apiKey: 'abc', agreementConfirmed: true })).toEqual({ ok: true });
  });

  it('caps the test provider at 500 tiles and everything at 60k', () => {
    const test = getProvider('test-osm');
    expect(canBulkDownload(test, { tileCount: 500 })).toEqual({ ok: true });
    const over = canBulkDownload(test, { tileCount: 501 });
    expect(over.ok || over.code).toBe('too_many');
    const mt = getProvider('maptiler-streets');
    const big = canBulkDownload(mt, { tileCount: MAX_TILES_PER_AREA + 1, apiKey: 'k', agreementConfirmed: true });
    expect(big.ok || big.code).toBe('too_many');
    expect(canBulkDownload(mt, { tileCount: 0, apiKey: 'k', agreementConfirmed: true }).ok).toBe(false);
    expect(canBulkDownload(null, { tileCount: 1 }).ok).toBe(false);
  });
});

describe('resolveProvider and basemaps', () => {
  it('falls back to the dev endpoints when nothing usable is set', () => {
    expect(resolveProvider('satellite', null, null)).toBeNull();
    expect(resolveProvider('satellite', 'maptiler-satellite', '')).toBeNull();
    expect(resolveProvider('satellite', 'test-osm', null)).toBeNull(); // test family has no imagery
    expect(getBasemap('hybrid').layers.map((l) => l.id)).toEqual(['bm-imagery', 'bm-transport', 'bm-places']);
  });

  it('a MapTiler key switches every basemap to the MapTiler family', () => {
    expect(resolveProvider('satellite', null, 'k')!.id).toBe('maptiler-satellite');
    expect(resolveProvider('hybrid', 'maptiler-streets', 'k')!.id).toBe('maptiler-hybrid');
    expect(resolveProvider('streets', 'maptiler-satellite', 'k')!.id).toBe('maptiler-streets');
    expect(resolveProvider('streets', 'test-osm', null)!.id).toBe('test-osm');
  });

  it('native uses the lmtile protocol for cacheable providers, web uses keyed URLs', () => {
    const native = getBasemap('satellite', { providerId: 'maptiler-satellite', apiKey: 'k', useTileProtocol: true });
    const src = native.sources['bm-imagery'] as { tiles: string[]; maxzoom: number; attribution: string };
    expect(src.tiles).toEqual(['lmtile://maptiler-satellite/{z}/{x}/{y}']);
    expect(src.maxzoom).toBe(20);
    expect(src.attribution).toMatch(/MapTiler/);
    const web = getBasemap('satellite', { providerId: 'maptiler-satellite', apiKey: 'k', useTileProtocol: false });
    expect((web.sources['bm-imagery'] as { tiles: string[] }).tiles[0]).toBe(
      'https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}.jpg?key=k',
    );
    expect(web.id).not.toBe(native.id);
    // the key is never part of the basemap id, but a key change changes the id
    const other = getBasemap('satellite', { providerId: 'maptiler-satellite', apiKey: 'k2', useTileProtocol: true });
    expect(native.id).not.toContain('k2');
    expect(other.id).not.toBe(native.id);
    // online-only providers never go through the cache protocol
    const esri = getBasemap('satellite', { providerId: 'esri-imagery', useTileProtocol: true });
    expect(JSON.stringify(esri)).not.toContain('lmtile://');
  });
});
