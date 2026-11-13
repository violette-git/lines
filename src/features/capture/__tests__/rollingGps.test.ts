/// <reference types="jest" />
import type { FixQuality, GeoFix } from '@/domain/types';
import { pruneSamples, walkResetLimitM } from '@/features/capture/useRollingGps';
import { offsetMeters } from '@/geo';

jest.mock('@/state/store', () => ({ useStore: jest.fn() }));
jest.mock('expo-location', () => ({}));

const O = { lat: 33.5136, lng: -86.8064 };
const fix = (n: number, acc: number, q?: FixQuality): GeoFix => {
  const p = offsetMeters(O, n, 0);
  return { ...p, accuracyM: acc, altitudeM: null, samples: 1, capturedAt: '', source: q ? 'external' : 'gps', ...(q ? { fixQuality: q } : {}) };
};

test('walk reset distance shrinks with fix quality', () => {
  expect(walkResetLimitM(fix(0, 0.014, 'rtk_fixed'))).toBe(0.25);
  expect(walkResetLimitM(fix(0, 0.3, 'rtk_float'))).toBeCloseTo(1, 6);
  expect(walkResetLimitM(fix(0, 4))).toBe(8);
  expect(walkResetLimitM(fix(0, 1))).toBe(6);
});

test('RTK: stepping 1 m to the next asset drops the previous spot', () => {
  const now = 10_000;
  const buf = [
    { fix: fix(0, 0.014, 'rtk_fixed'), receivedAt: now - 2000 },
    { fix: fix(0.01, 0.014, 'rtk_fixed'), receivedAt: now - 1500 },
    { fix: fix(1.0, 0.014, 'rtk_fixed'), receivedAt: now - 100 },
  ];
  const out = pruneSamples(buf, 4000, now);
  expect(out).toHaveLength(1);
  // phone GPS keeps the same 1 m jitter
  const phone = buf.map((s, i) => ({ ...s, fix: fix(i === 2 ? 1 : 0, 4) }));
  expect(pruneSamples(phone, 4000, now)).toHaveLength(3);
});

test('keeps the newest sample when everything is outside the window', () => {
  const out = pruneSamples([{ fix: fix(0, 4), receivedAt: 0 }], 4000, 60_000);
  expect(out).toHaveLength(1);
});
