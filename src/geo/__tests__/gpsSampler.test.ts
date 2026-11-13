/// <reference types="jest" />
import * as Location from 'expo-location';

import { LOCATION_PERMISSION_DENIED, getQuickFix, sampleGps } from '@/geo/gpsSampler';

jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
}));

const L = Location as jest.Mocked<typeof Location>;

const loc = (lat: number, lng: number, accuracy: number, timestamp = Date.now()): Location.LocationObject => ({
  coords: { latitude: lat, longitude: lng, accuracy, altitude: 180, altitudeAccuracy: null, heading: null, speed: null },
  timestamp,
});

const granted = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' } as unknown as Location.LocationPermissionResponse;
const denied = { granted: false, status: 'denied', canAskAgain: false, expires: 'never' } as unknown as Location.LocationPermissionResponse;

beforeEach(() => {
  jest.resetAllMocks();
  L.getForegroundPermissionsAsync.mockResolvedValue(granted);
  L.requestForegroundPermissionsAsync.mockResolvedValue(granted);
});

test('averages watched samples and reports progress', async () => {
  const remove = jest.fn();
  L.watchPositionAsync.mockImplementation(async (_opts, cb) => {
    cb(loc(33.5136, -86.8064, 4));
    cb(loc(33.51361, -86.80641, 4));
    cb(loc(33.5136, -86.8064, 4, Date.now() - 60_000)); // stale cached fix, ignored
    return { remove };
  });
  const progress = jest.fn();
  const f = await sampleGps(0.05, progress);
  expect(f.source).toBe('gps_avg');
  expect(f.samples).toBe(2);
  expect(progress).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalled();
  expect(L.watchPositionAsync.mock.calls[0][0].accuracy).toBe(Location.Accuracy.Highest);
});

test('falls back to getCurrentPositionAsync when no samples arrive', async () => {
  L.watchPositionAsync.mockResolvedValue({ remove: jest.fn() });
  L.getCurrentPositionAsync.mockResolvedValue(loc(33.5, -86.8, 8));
  const f = await sampleGps(0.02);
  expect(f.source).toBe('gps');
  expect(f.lat).toBe(33.5);
  expect(f.accuracyM).toBe(8);
});

test('throws a clear error when permission is denied', async () => {
  L.getForegroundPermissionsAsync.mockResolvedValue(denied);
  L.requestForegroundPermissionsAsync.mockResolvedValue(denied);
  await expect(sampleGps(1)).rejects.toThrow(LOCATION_PERMISSION_DENIED);
});

test('abort cancels sampling', async () => {
  const remove = jest.fn();
  L.watchPositionAsync.mockResolvedValue({ remove });
  const ac = new AbortController();
  const p = sampleGps(10, undefined, ac.signal);
  setTimeout(() => ac.abort(), 20);
  await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  expect(remove).toHaveBeenCalled();
});

test('getQuickFix returns null without permission and never throws', async () => {
  L.getForegroundPermissionsAsync.mockResolvedValue(denied);
  await expect(getQuickFix()).resolves.toBeNull();
  L.getForegroundPermissionsAsync.mockResolvedValue(granted);
  L.getLastKnownPositionAsync.mockResolvedValue(null);
  L.getCurrentPositionAsync.mockRejectedValue(new Error('no fix'));
  await expect(getQuickFix()).resolves.toBeNull();
  L.getLastKnownPositionAsync.mockResolvedValue(loc(1, 2, 5));
  await expect(getQuickFix()).resolves.toMatchObject({ lat: 1, lng: 2, source: 'gps' });
});
