/// <reference types="jest" />
import type { FixQuality, GeoFix } from '@/domain/types';
import { averageFixes, distanceM, offsetMeters } from '@/geo';
import { qualityOf, selectBestQuality } from '@/geo/averaging';

const BHM = { lat: 33.5136, lng: -86.8064 };

function f(n: number, e: number, acc: number | null, q?: FixQuality, extra: Partial<GeoFix> = {}): GeoFix {
  const p = offsetMeters(BHM, n, e);
  return {
    lat: p.lat,
    lng: p.lng,
    accuracyM: acc,
    altitudeM: 180,
    samples: 1,
    capturedAt: `2026-11-13T00:00:0${Math.round(Math.abs(n * 10)) % 10}Z`,
    source: q ? 'external' : 'gps',
    ...(q ? { fixQuality: q } : {}),
    ...extra,
  };
}

test('qualityOf treats legacy samples as gps and manual as manual', () => {
  expect(qualityOf({ source: 'gps' })).toBe('gps');
  expect(qualityOf({ source: 'manual' })).toBe('manual');
  expect(qualityOf({ source: 'external', fixQuality: 'rtk_float' })).toBe('rtk_float');
});

test('selectBestQuality keeps only the highest class', () => {
  const s = [f(0, 0, 0.3, 'rtk_float'), f(0, 0, 0.01, 'rtk_fixed'), f(0, 0, 3, 'gps')];
  const r = selectBestQuality(s);
  expect(r.quality).toBe('rtk_fixed');
  expect(r.samples).toHaveLength(1);
});

test('RTK fixed window ignores float and standalone samples', () => {
  const fixed = [f(0, 0, 0.012, 'rtk_fixed'), f(0.01, 0, 0.012, 'rtk_fixed'), f(0, 0.01, 0.012, 'rtk_fixed')];
  const junk = [f(0.6, 0.4, 0.3, 'rtk_float'), f(3, -2, 2.5, 'gps'), f(1, 1, 0.8, 'dgps')];
  const avg = averageFixes([...junk, ...fixed]);
  expect(avg.samples).toBe(3);
  expect(avg.fixQuality).toBe('rtk_fixed');
  expect(avg.source).toBe('external');
  expect(distanceM(BHM, avg)).toBeLessThan(0.02);
  // centimeter-level accuracy survives (no 0.5 m floor, 1 mm rounding)
  expect(avg.accuracyM!).toBeGreaterThan(0);
  expect(avg.accuracyM!).toBeLessThan(0.02);
});

test('without RTK fixed, float wins over standalone', () => {
  const avg = averageFixes([f(0, 0, 0.2, 'rtk_float'), f(0.05, 0, 0.2, 'rtk_float'), f(5, 5, 3, 'gps')]);
  expect(avg.fixQuality).toBe('rtk_float');
  expect(avg.samples).toBe(2);
});

test('bestQualityOnly: false averages everything', () => {
  const avg = averageFixes([f(0, 0, 0.012, 'rtk_fixed'), f(1, 0, 0.3, 'rtk_float')], { bestQualityOnly: false });
  expect(avg.samples).toBe(2);
});

test('metadata: median HDOP, min satellites, common receiver', () => {
  const avg = averageFixes([
    f(0, 0, 0.01, 'rtk_fixed', { hdop: 0.6, satellites: 24, receiver: 'Reach' }),
    f(0.005, 0, 0.01, 'rtk_fixed', { hdop: 0.8, satellites: 22, receiver: 'Reach' }),
    f(0, 0.005, 0.01, 'rtk_fixed', { hdop: 0.7, satellites: 23, receiver: 'Reach' }),
  ]);
  expect(avg).toMatchObject({ hdop: 0.7, satellites: 22, receiver: 'Reach' });
});

test('phone-only samples keep the original result shape', () => {
  const avg = averageFixes([f(0, 0, 4), f(1, 0, 4)]);
  expect(avg.source).toBe('gps_avg');
  expect('fixQuality' in avg).toBe(false);
  expect('hdop' in avg).toBe(false);
  expect(avg.accuracyM).toBe(Math.round(avg.accuracyM! * 10) / 10);
});

test('a single external sample stays external', () => {
  const one = averageFixes([f(0, 0, 0.01, 'rtk_fixed')]);
  expect(one.source).toBe('external');
  expect(one.fixQuality).toBe('rtk_fixed');
});
