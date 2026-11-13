import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import type { MapNode, SpanWithLength } from '@/domain/types';

import { getBasemap } from '../basemaps';
import {
  circlePolygon,
  computeBounds,
  diffIds,
  escapeHtml,
  formatSpanLength,
  groupThousands,
  haversineM,
  nodeIconSvg,
  nodeSizePx,
  spanTotalFt,
} from '../core/mapCore';
import { buildCoreState } from '../coreState';
import { dispatchCoreEvent } from '../shared';

describe('circlePolygon', () => {
  it('produces a closed ring whose vertices sit at the requested radius', () => {
    const ring = circlePolygon(33.5, -86.8, 10, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lng, lat] of ring) {
      expect(haversineM(33.5, -86.8, lat, lng)).toBeCloseTo(10, 3);
    }
  });

  it('enforces a minimum vertex count and handles zero radius', () => {
    expect(circlePolygon(0, 0, 5, 3)).toHaveLength(9);
    const flat = circlePolygon(10, 20, 0, 8);
    for (const [lng, lat] of flat) {
      expect(lat).toBeCloseTo(10, 9);
      expect(lng).toBeCloseTo(20, 9);
    }
  });

  it('wraps longitudes near the antimeridian into [-180, 180)', () => {
    for (const [lng] of circlePolygon(0, 179.99999, 50, 16)) {
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThan(180);
    }
  });
});

describe('length math and formatting', () => {
  it('haversine matches a known distance', () => {
    // 0.001 deg of latitude is about 111.2 m
    expect(haversineM(0, 0, 0.001, 0)).toBeCloseTo(111.19, 1);
  });

  it('spanTotalFt applies sag and slack, and override wins', () => {
    expect(spanTotalFt(200, 2, 50, null)).toBeCloseTo(254, 6);
    expect(spanTotalFt(200, 2, 50, 300)).toBe(300);
    expect(spanTotalFt(200, NaN, NaN, null)).toBe(200);
  });

  it('formats imperial and metric labels', () => {
    expect(formatSpanLength(245.4, 'imperial')).toBe('245 ft');
    expect(formatSpanLength(6600, 'imperial')).toBe('6,600 ft');
    expect(formatSpanLength(245, 'metric')).toBe('74.7 m');
    expect(formatSpanLength(4035, 'metric')).toBe('1.23 km');
    expect(formatSpanLength(Number.NaN, 'imperial')).toBe('--');
    expect(groupThousands(-1234567)).toBe('-1,234,567');
  });
});

describe('diffIds', () => {
  it('splits ids into added, removed and kept', () => {
    const d = diffIds(['a', 'b', 'c'], ['b', 'c', 'd', 'd']);
    expect(d.added).toEqual(['d']);
    expect(d.removed).toEqual(['a']);
    expect(d.kept).toEqual(['b', 'c']);
  });

  it('accepts any iterable, e.g. Map keys', () => {
    const m = new Map([
      ['x', 1],
      ['y', 2],
    ]);
    expect(diffIds(m.keys(), [])).toEqual({ added: [], removed: ['x', 'y'], kept: [] });
  });
});

describe('bounds, sizes, icons', () => {
  it('computeBounds returns [[w,s],[e,n]] and skips invalid points', () => {
    expect(computeBounds([])).toBeNull();
    expect(
      computeBounds([
        { lat: 1, lng: 5 },
        { lat: -2, lng: 3 },
        { lat: Number.NaN, lng: 0 },
      ]),
    ).toEqual([
      [3, -2],
      [5, 1],
    ]);
  });

  it('nodeSizePx scales from 28px and clamps', () => {
    expect(nodeSizePx(1, 1)).toBe(28);
    expect(nodeSizePx(1.5, 2)).toBe(84);
    expect(nodeSizePx(1, 0.1)).toBe(14);
    expect(nodeSizePx(10, 10)).toBe(120);
  });

  it('draws a distinct shape per node type and escapes text', () => {
    const types = ['pole', 'handhole', 'vault', 'pedestal', 'splice_case', 'riser', 'anchor', 'building_entry', 'custom'];
    const shapes = types.map((t) => nodeIconSvg(t, '#FFB020', 'X').replace(/<text[\s\S]*<\/text>/, ''));
    expect(new Set(shapes).size).toBe(types.length);
    expect(nodeIconSvg('custom', 'javascript:alert(1)', '<b>')).toContain('&lt;b&gt;');
    expect(nodeIconSvg('custom', 'javascript:alert(1)', '?')).not.toContain('javascript');
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
});

describe('buildCoreState', () => {
  const now = '2026-01-01T00:00:00.000Z';
  const node = (id: string, over: Partial<MapNode> = {}): MapNode => ({
    id,
    projectId: 'p',
    seq: 1,
    type: 'handhole',
    label: 'HH-1',
    position: { lat: 1, lng: 2, accuracyM: 3, altitudeM: null, samples: 4, capturedAt: now, source: 'gps_avg' },
    fields: {},
    aiMeta: {},
    iconScale: 1.5,
    status: 'ai_pending',
    notes: '',
    possibleDuplicateOf: 'other',
    createdAt: now,
    updatedAt: now,
    ...over,
  });
  const span: SpanWithLength = {
    id: 's',
    projectId: 'p',
    fromNodeId: 'a',
    toNodeId: 'b',
    kind: 'underground',
    slackFt: 10,
    sagPct: 0,
    lengthOverrideFt: null,
    fields: {},
    createdAt: now,
    updatedAt: now,
    straightFt: 100,
    totalFt: 110,
  };

  it('maps domain objects to the serializable engine state', () => {
    const s = buildCoreState({
      nodes: [node('a'), node('b', { type: 'pole', possibleDuplicateOf: null })],
      spans: [span],
      selectedNodeId: 'a',
      selectedSpanId: null,
      basemap: 'satellite',
      globalIconScale: 1,
      editMode: 'move',
      units: 'metric',
      userLocation: null,
      showAccuracy: true,
    });
    expect(s.nodes[0]).toEqual({
      id: 'a',
      lat: 1,
      lng: 2,
      type: 'handhole',
      label: 'HH-1',
      color: '#3DDC97',
      short: 'HH',
      scale: 1.5,
      status: 'ai_pending',
      dup: true,
      accuracyM: 3,
    });
    expect(s.nodes[1].dup).toBe(false);
    expect(s.spans[0]).toEqual({
      id: 's',
      from: 'a',
      to: 'b',
      kind: 'underground',
      sagPct: 0,
      slackFt: 10,
      overrideFt: null,
      totalFt: 110,
    });
    expect(s.basemap.id).toBe('satellite');
    expect(s.user).toBeNull();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('basemaps', () => {
  it('builds raster-only styles with attribution and bm- prefixed ids', () => {
    for (const id of ['satellite', 'hybrid', 'streets'] as const) {
      const bm = getBasemap(id);
      expect(bm.layers.length).toBeGreaterThan(0);
      for (const l of bm.layers) {
        expect(l.id.startsWith('bm-')).toBe(true);
        expect(bm.sources[l.source as string]).toBeDefined();
      }
      for (const [sid, src] of Object.entries(bm.sources)) {
        expect(sid.startsWith('bm-')).toBe(true);
        expect((src as { attribution: string }).attribution.length).toBeGreaterThan(0);
      }
    }
    expect(getBasemap('hybrid').layers.map((l) => l.id)).toEqual(['bm-imagery', 'bm-transport', 'bm-places']);
    expect((getBasemap('satellite').sources['bm-imagery'] as { maxzoom: number }).maxzoom).toBe(19);
  });
});

describe('dispatchCoreEvent', () => {
  it('routes engine events to the prop callbacks', () => {
    const cb = {
      onNodePress: jest.fn(),
      onNodeMoved: jest.fn(),
      onSpanPress: jest.fn(),
      onMapPress: jest.fn(),
      onMapLongPress: jest.fn(),
    };
    const open = jest.fn();
    dispatchCoreEvent({ type: 'nodePress', id: 'n' }, cb, open);
    dispatchCoreEvent({ type: 'nodeMoved', id: 'n', lat: 1, lng: 2 }, cb, open);
    dispatchCoreEvent({ type: 'spanPress', id: 's' }, cb, open);
    dispatchCoreEvent({ type: 'mapPress', lat: 3, lng: 4 }, cb, open);
    dispatchCoreEvent({ type: 'mapLongPress', lat: 5, lng: 6 }, cb, open);
    dispatchCoreEvent({ type: 'openUrl', url: 'javascript:alert(1)' }, cb, open);
    dispatchCoreEvent({ type: 'openUrl', url: 'https://www.esri.com/' }, cb, open);
    expect(cb.onNodePress).toHaveBeenCalledWith('n');
    expect(cb.onNodeMoved).toHaveBeenCalledWith('n', { lat: 1, lng: 2 });
    expect(cb.onSpanPress).toHaveBeenCalledWith('s');
    expect(cb.onMapPress).toHaveBeenCalledWith({ lat: 3, lng: 4 });
    expect(cb.onMapLongPress).toHaveBeenCalledWith({ lat: 5, lng: 6 });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://www.esri.com/');
  });
});

describe('generated native bundle', () => {
  it('was rebuilt after the last mapCore.ts change (run: node scripts/build-map-bundle.mjs)', () => {
    const mapDir = join(__dirname, '..');
    const src = readFileSync(join(mapDir, 'core', 'mapCore.ts'), 'utf8').replace(/\r\n/g, '\n');
    const generated = readFileSync(join(mapDir, 'generated', 'mapHtml.ts'), 'utf8');
    const m = generated.match(/MAP_CORE_SOURCE_SHA256 = "([0-9a-f]{64})"/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(createHash('sha256').update(src).digest('hex'));
  });
});
