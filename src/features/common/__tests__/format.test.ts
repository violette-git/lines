/// <reference types="jest" />
import { sourceLabel } from '../format';

const fix = { source: 'external' as const };

test('external receiver fixes show the receiver name', () => {
  expect(sourceLabel({ ...fix, receiver: 'Emlid Reach RS3', fixQuality: 'rtk_fixed' })).toBe('Emlid Reach RS3');
  expect(sourceLabel({ ...fix, receiver: '  ', fixQuality: 'rtk_float' })).toBe('External receiver');
  expect(sourceLabel({ ...fix, fixQuality: 'dgps' })).toBe('External receiver');
});

test('a photo EXIF position (no fix quality) is not called a receiver', () => {
  expect(sourceLabel({ ...fix })).toBe('Photo location (EXIF)');
});

test('bare source strings still work', () => {
  expect(sourceLabel('external')).toBe('External receiver');
  expect(sourceLabel('gps_avg')).toBe('GPS (averaged)');
  expect(sourceLabel({ source: 'manual' })).toBe('Placed by hand');
});
