/// <reference types="jest" />
import type { GeoFix, MapNode, Span } from '@/domain/types';
import {
  averageFixes,
  bearingDeg,
  boundsOf,
  computeSpanLengths,
  destinationPoint,
  distanceM,
  feetToMeters,
  findPossibleDuplicate,
  formatLength,
  haversineM,
  metersToFeet,
  midpoint,
  offsetMeters,
  offsetPosition,
  vincentyM,
} from '@/geo';

const BHM = { lat: 33.5136, lng: -86.8064 };

function node(id: string, type: MapNode['type'], lat: number, lng: number): MapNode {
  return {
    id,
    projectId: 'p',
    seq: 1,
    type,
    label: id,
    position: { lat, lng, accuracyM: 3, altitudeM: null, samples: 1, capturedAt: '2026-01-01T00:00:00Z', source: 'gps' },
    fields: {},
    aiMeta: {},
    iconScale: 1,
    status: 'draft',
    notes: '',
    possibleDuplicateOf: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function span(id: string, from: string, to: string, extra: Partial<Span> = {}): Span {
  return {
    id,
    projectId: 'p',
    fromNodeId: from,
    toNodeId: to,
    kind: 'aerial',
    slackFt: 0,
    sagPct: 0,
    lengthOverrideFt: null,
    fields: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function fix(lat: number, lng: number, acc: number | null, t = 0): GeoFix {
  return { lat, lng, accuracyM: acc, altitudeM: 180, samples: 1, capturedAt: new Date(1_700_000_000_000 + t * 1000).toISOString(), source: 'gps' };
}

describe('distance', () => {
  test('1 degree of latitude at the equator is about 110.574 km (WGS84)', () => {
    expect(distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(110574.389, 1);
  });

  test('1 degree of longitude at the equator is about 111.319 km', () => {
    expect(distanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111319.491, 1);
  });

  test('Flinders Peak to Buninyong geodesy reference (54,972.271 m)', () => {
    const a = { lat: -(37 + 57 / 60 + 3.7203 / 3600), lng: 144 + 25 / 60 + 29.5244 / 3600 };
    const b = { lat: -(37 + 39 / 60 + 10.1561 / 3600), lng: 143 + 55 / 60 + 35.3839 / 3600 };
    expect(distanceM(a, b)).toBeCloseTo(54972.271, 2);
  });

  test('about 100 m pair in Birmingham', () => {
    const b = offsetMeters(BHM, 60, 80);
    expect(distanceM(BHM, b)).toBeGreaterThan(99.8);
    expect(distanceM(BHM, b)).toBeLessThan(100.2);
    // Haversine agrees within 0.5 percent at this scale
    expect(Math.abs(haversineM(BHM, b) - distanceM(BHM, b))).toBeLessThan(0.5);
  });

  test('identical points are 0', () => {
    expect(distanceM(BHM, { ...BHM })).toBe(0);
  });

  test('nearly antipodal points fall back to haversine instead of failing', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0.5, lng: 179.7 };
    const d = distanceM(a, b);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(19_900_000);
    const v = vincentyM(a, b);
    if (v === null) expect(d).toBe(haversineM(a, b));
  });

  test('unit conversions', () => {
    expect(metersToFeet(0.3048)).toBeCloseTo(1, 10);
    expect(feetToMeters(5280)).toBeCloseTo(1609.344, 6);
  });
});

describe('bearing, midpoint, offsets, bounds', () => {
  test('bearings', () => {
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: -1, lng: 0 })).toBeCloseTo(180, 6);
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: -1 })).toBeCloseTo(270, 6);
  });

  test('destinationPoint goes the requested distance and bearing', () => {
    const p = destinationPoint(BHM, 60, 150);
    expect(distanceM(BHM, p)).toBeCloseTo(150, 0);
    expect(bearingDeg(BHM, p)).toBeCloseTo(60, 0);
  });

  test('midpoint', () => {
    const m = midpoint({ lat: 0, lng: 0 }, { lat: 0, lng: 2 });
    expect(m.lat).toBeCloseTo(0, 9);
    expect(m.lng).toBeCloseTo(1, 9);
  });

  test('offsetPosition adds degrees', () => {
    expect(offsetPosition({ lat: 10, lng: 20 }, 0.001, -0.002)).toEqual({ lat: 10.001, lng: 19.998 });
  });

  test('boundsOf', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ lat: 1, lng: 5 }, { lat: -2, lng: 7 }, { lat: 0, lng: 6 }])).toEqual({ minLat: -2, minLng: 5, maxLat: 1, maxLng: 7 });
  });
});

describe('computeSpanLengths', () => {
  const a = node('a', 'pole', BHM.lat, BHM.lng);
  const bPos = offsetMeters(BHM, 100, 0);
  const b = node('b', 'pole', bPos.lat, bPos.lng);
  const straight = metersToFeet(distanceM(a.position, b.position));

  test('straight footage only', () => {
    const [s] = computeSpanLengths([span('s', 'a', 'b')], [a, b]);
    expect(s.straightFt).toBeCloseTo(328.08, 1);
    expect(s.totalFt).toBeCloseTo(straight, 9);
  });

  test('sag and slack', () => {
    const [s] = computeSpanLengths([span('s', 'a', 'b', { sagPct: 2, slackFt: 50 })], [a, b]);
    expect(s.totalFt).toBeCloseTo(straight * 1.02 + 50, 9);
  });

  test('override wins over sag and slack', () => {
    const [s] = computeSpanLengths([span('s', 'a', 'b', { sagPct: 2, slackFt: 50, lengthOverrideFt: 300 })], [a, b]);
    expect(s.totalFt).toBe(300);
    expect(s.straightFt).toBeCloseTo(straight, 9);
  });

  test('spans with missing nodes are skipped', () => {
    const out = computeSpanLengths([span('s1', 'a', 'b'), span('s2', 'a', 'gone')], [a, b]);
    expect(out.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('findPossibleDuplicate', () => {
  const base = node('n', 'pole', BHM.lat, BHM.lng);
  const p2 = offsetMeters(BHM, 2, 0);
  const p3 = offsetMeters(BHM, 3, 0);
  const p10 = offsetMeters(BHM, 10, 0);

  test('nearest same-type node within radius', () => {
    const others = [node('far', 'pole', p10.lat, p10.lng), node('three', 'pole', p3.lat, p3.lng), node('two', 'pole', p2.lat, p2.lng)];
    expect(findPossibleDuplicate(base, others, 4)?.id).toBe('two');
  });

  test('ignores other types, itself, and nodes outside the radius', () => {
    const others = [base, node('hh', 'handhole', p2.lat, p2.lng), node('far', 'pole', p10.lat, p10.lng)];
    expect(findPossibleDuplicate(base, others, 4)).toBeNull();
    expect(findPossibleDuplicate(base, [node('two', 'pole', p2.lat, p2.lng)], 0)).toBeNull();
  });
});

describe('averageFixes', () => {
  test('single sample passes through', () => {
    const f = averageFixes([fix(BHM.lat, BHM.lng, 4)]);
    expect(f.samples).toBe(1);
    expect(f.lat).toBe(BHM.lat);
  });

  test('throws on empty input', () => {
    expect(() => averageFixes([])).toThrow();
  });

  test('accuracy weighting pulls toward the more accurate sample', () => {
    const b = offsetMeters(BHM, 10, 0);
    const f = averageFixes([fix(BHM.lat, BHM.lng, 2), fix(b.lat, b.lng, 10)]);
    // weights 1/4 vs 1/100 => 10 * 0.01 / 0.26 = 0.385 m from the accurate sample
    expect(distanceM(BHM, f)).toBeCloseTo(0.385, 2);
    expect(f.source).toBe('gps_avg');
    expect(f.samples).toBe(2);
  });

  test('drops an outlier with 4 or more samples', () => {
    const jitter = [
      [0.5, 0.2],
      [-0.4, 0.3],
      [0.1, -0.6],
      [-0.2, -0.1],
      [0.3, 0.4],
    ].map(([n, e], i) => {
      const p = offsetMeters(BHM, n, e);
      return fix(p.lat, p.lng, 5, i);
    });
    const out = offsetMeters(BHM, 45, 20);
    const f = averageFixes([...jitter, fix(out.lat, out.lng, 5, 9)]);
    expect(f.samples).toBe(5);
    expect(distanceM(BHM, f)).toBeLessThan(0.5);
    expect(f.accuracyM).not.toBeNull();
    expect(f.accuracyM!).toBeGreaterThanOrEqual(2.5); // floor: half the best single accuracy
    expect(f.accuracyM!).toBeLessThanOrEqual(5);
    expect(f.capturedAt).toBe(jitter[4].capturedAt); // latest kept sample
    expect(f.altitudeM).toBe(180);
  });

  test('samples without accuracy still average', () => {
    const b = offsetMeters(BHM, 2, 0);
    const f = averageFixes([fix(BHM.lat, BHM.lng, null), fix(b.lat, b.lng, null)]);
    expect(distanceM(BHM, f)).toBeCloseTo(1, 1);
  });
});

describe('formatLength', () => {
  test('imperial', () => {
    expect(formatLength(245, 'imperial')).toBe('245 ft');
    expect(formatLength(245.4, 'imperial')).toBe('245 ft');
    expect(formatLength(1320, 'imperial')).toBe('1,320 ft');
    expect(formatLength(5280, 'imperial')).toBe('5,280 ft');
    expect(formatLength(6600, 'imperial')).toBe('1.25 mi (6,600 ft)');
    expect(formatLength(0, 'imperial')).toBe('0 ft');
  });

  test('metric', () => {
    expect(formatLength(245, 'metric')).toBe('74.7 m');
    expect(formatLength(5000, 'metric')).toBe('1.52 km (1,524 m)');
  });

  test('non-finite', () => {
    expect(formatLength(NaN, 'imperial')).toBe('--');
  });
});
