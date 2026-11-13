/// <reference types="jest" />
import type { GeoFix } from '@/domain/types';
import {
  displayHeightToMeters,
  evaluateFixGate,
  fixQualityColor,
  fixQualityLabel,
  formatPreciseAccuracy,
  metersToDisplayHeight,
} from '@/gps/quality';
import { colors } from '@/theme';

jest.mock('expo-location', () => ({}));

const fx = (p: Partial<GeoFix> = {}): GeoFix => ({
  lat: 33.5,
  lng: -86.8,
  accuracyM: 0.014,
  altitudeM: null,
  samples: 1,
  capturedAt: '2026-11-13T00:00:00Z',
  source: 'external',
  fixQuality: 'rtk_fixed',
  ...p,
});

test('labels and colors', () => {
  expect(fixQualityLabel('rtk_fixed')).toBe('RTK FIX');
  expect(fixQualityLabel('rtk_float')).toBe('RTK FLOAT');
  expect(fixQualityLabel(null)).toBe('NO FIX');
  expect(fixQualityColor('rtk_fixed')).toBe(colors.success);
  expect(fixQualityColor('rtk_float')).toBe(colors.warning);
  expect(fixQualityColor('dgps')).toBe(colors.textMuted);
  expect(fixQualityColor('none')).toBe(colors.danger);
});

test('accuracy in cm and hundredths of a foot', () => {
  expect(formatPreciseAccuracy(0.014, 'metric')).toBe('± 1.4 cm');
  expect(formatPreciseAccuracy(0.32, 'metric')).toBe('± 32 cm');
  expect(formatPreciseAccuracy(3.4, 'metric')).toBe('± 3.4 m');
  expect(formatPreciseAccuracy(0.015, 'imperial')).toBe('± 0.05 ft');
  expect(formatPreciseAccuracy(2, 'imperial')).toBe('± 6.6 ft');
  expect(formatPreciseAccuracy(null, 'imperial')).toBe('--');
});

test('antenna height round trip in both unit systems', () => {
  expect(displayHeightToMeters('6', 'imperial')).toBeCloseTo(1.8288, 4);
  expect(displayHeightToMeters('1,8', 'metric')).toBeCloseTo(1.8, 6);
  expect(displayHeightToMeters('', 'metric')).toBeNull();
  expect(displayHeightToMeters('abc', 'metric')).toBeUndefined();
  expect(displayHeightToMeters('-1', 'metric')).toBeUndefined();
  expect(metersToDisplayHeight(1.8288, 'imperial')).toBe('6');
  expect(metersToDisplayHeight(null, 'metric')).toBe('');
});

describe('fix gate', () => {
  test('off: always ok', () => {
    expect(evaluateFixGate(null, false)).toEqual({ ok: true, reason: null, required: false });
    expect(evaluateFixGate(fx({ fixQuality: 'gps' }), undefined).ok).toBe(true);
  });

  test('on: only RTK fixed passes', () => {
    expect(evaluateFixGate(fx(), true)).toEqual({ ok: true, reason: null, required: true });
    expect(evaluateFixGate(fx({ fixQuality: 'rtk_float' }), true)).toMatchObject({ ok: false, reason: expect.stringMatching(/RTK FLOAT/) });
    expect(evaluateFixGate(fx({ fixQuality: 'dgps' }), true)).toMatchObject({ ok: false, reason: expect.stringMatching(/DGPS/) });
    expect(evaluateFixGate(null, true)).toMatchObject({ ok: false, reason: expect.stringMatching(/No position/) });
    expect(evaluateFixGate(fx(), true, 'stale')).toMatchObject({ ok: false, reason: expect.stringMatching(/stopped/) });
    expect(evaluateFixGate(fx({ source: 'gps', fixQuality: 'gps', receiver: null }), true)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Phone GPS only/),
    });
  });

  test('inferred RTK fixed from a mock location receiver passes', () => {
    expect(evaluateFixGate(fx({ source: 'gps_avg', receiver: 'Receiver via phone location (quality inferred)' }), true).ok).toBe(true);
  });
});
