/// <reference types="jest" />
import * as Location from 'expo-location';

import { getQuickFix, locationToFix, sampleGps, watchQuickFix } from '@/geo/gpsSampler';
import {
  DEFAULT_POSITION_CONFIG,
  acquireReceiver,
  configFromSettings,
  effectiveSourceKind,
  getSharedReceiver,
  inferDeviceQuality,
  isInferredQuality,
  resetPositionSourceForTests,
  setPositionSettingsProvider,
  setReceiverSocketFactory,
  watchPosition,
  type PositionConfig,
} from '@/gps/positionSource';

import { fakeFactory, type FakeSocket } from '../__fixtures__/fakeSocket';
import { NMEA } from '../__fixtures__/nmeaSamples';

jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
}));

const L = Location as jest.Mocked<typeof Location>;
const granted = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' } as unknown as Location.LocationPermissionResponse;

const loc = (accuracy: number, mocked?: boolean): Location.LocationObject => ({
  coords: { latitude: 33.5, longitude: -86.8, accuracy, altitude: 180, altitudeAccuracy: null, heading: null, speed: null },
  timestamp: Date.now(),
  mocked,
});

const EXT: PositionConfig = { gpsSource: 'external_tcp', receiverHost: '192.168.42.1', receiverPort: 9001, antennaHeightM: 1.5 };

let sockets: FakeSocket[];

beforeEach(() => {
  jest.resetAllMocks();
  resetPositionSourceForTests();
  L.getForegroundPermissionsAsync.mockResolvedValue(granted);
  L.requestForegroundPermissionsAsync.mockResolvedValue(granted);
  L.getLastKnownPositionAsync.mockResolvedValue(null);
  const ff = fakeFactory();
  sockets = ff.sockets;
  setReceiverSocketFactory(ff.factory);
});

afterEach(() => {
  resetPositionSourceForTests();
  jest.useRealTimers();
});

/** Connects the newest fake socket and streams the given lines. */
function stream(...lines: string[]) {
  const s = sockets[sockets.length - 1];
  s.connect();
  s.send(lines.map((l) => `${l}\r\n`).join(''));
}

describe('device fix quality inference', () => {
  test('thresholds', () => {
    expect(inferDeviceQuality(0.014)).toBe('rtk_fixed');
    expect(inferDeviceQuality(0.05)).toBe('rtk_fixed');
    expect(inferDeviceQuality(0.3)).toBe('rtk_float');
    expect(inferDeviceQuality(0.5)).toBe('rtk_float');
    expect(inferDeviceQuality(3.9)).toBe('gps');
    expect(inferDeviceQuality(null)).toBe('gps');
    expect(inferDeviceQuality(0)).toBe('gps');
  });

  test('locationToFix tags inferred quality and mock location receivers', () => {
    const phone = locationToFix(loc(4));
    expect(phone).toMatchObject({ source: 'gps', fixQuality: 'gps', receiver: null });
    expect(isInferredQuality(phone)).toBe(false);
    const rtk = locationToFix(loc(0.02, true));
    expect(rtk).toMatchObject({ fixQuality: 'rtk_fixed', receiver: 'Receiver via phone location (quality inferred)' });
    expect(isInferredQuality(rtk)).toBe(true);
    expect(locationToFix(loc(2, true)).receiver).toBe('Receiver via phone location');
  });
});

describe('config', () => {
  test('configFromSettings validates host and port', () => {
    expect(configFromSettings({ gpsSource: 'external_tcp', receiverHost: ' 10.0.0.2 ', receiverPort: 70000 })).toEqual({
      gpsSource: 'external_tcp',
      receiverHost: '10.0.0.2',
      receiverPort: null,
      antennaHeightM: null,
    });
    expect(configFromSettings(undefined)).toEqual(DEFAULT_POSITION_CONFIG);
  });

  test('external falls back to device when unsupported or incomplete', () => {
    expect(effectiveSourceKind(EXT)).toBe('external_tcp');
    expect(effectiveSourceKind({ ...EXT, receiverPort: null })).toBe('device');
    setReceiverSocketFactory(null);
    expect(effectiveSourceKind(EXT)).toBe('device');
  });
});

describe('switching by settings.gpsSource', () => {
  test('device: getQuickFix uses expo-location and never opens a socket', async () => {
    setPositionSettingsProvider(() => DEFAULT_POSITION_CONFIG);
    L.getLastKnownPositionAsync.mockResolvedValue(loc(5));
    await expect(getQuickFix()).resolves.toMatchObject({ source: 'gps', fixQuality: 'gps' });
    expect(sockets).toHaveLength(0);
  });

  test('external: getQuickFix returns the receiver fix', async () => {
    setPositionSettingsProvider(() => EXT);
    const p = getQuickFix();
    stream(NMEA.gst, NMEA.ggaRtkFixed);
    const f = await p;
    expect(f).toMatchObject({ source: 'external', fixQuality: 'rtk_fixed' });
    expect(f!.altitudeM).toBeCloseTo(182.345 - 1.5, 6);
    expect(L.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(sockets[0].opts).toMatchObject({ host: '192.168.42.1', port: 9001 });
  });

  test('external: getQuickFix falls back to the phone when the receiver is silent', async () => {
    jest.useFakeTimers();
    setPositionSettingsProvider(() => EXT);
    L.getLastKnownPositionAsync.mockResolvedValue(loc(6));
    const p = getQuickFix();
    await jest.advanceTimersByTimeAsync(4100);
    await expect(p).resolves.toMatchObject({ source: 'gps', fixQuality: 'gps' });
  });

  test('external unsupported (web / Expo Go): everything uses the phone', async () => {
    setReceiverSocketFactory(null);
    setPositionSettingsProvider(() => EXT);
    L.getLastKnownPositionAsync.mockResolvedValue(loc(5));
    await expect(getQuickFix()).resolves.toMatchObject({ source: 'gps' });
    const w = await watchPosition({ onFix: () => undefined });
    expect(w.kind).toBe('device');
    w.remove();
  });

  test('external: sampleGps averages receiver fixes and keeps RTK fixed only', async () => {
    setPositionSettingsProvider(() => EXT);
    const progress = jest.fn();
    const p = sampleGps(0.05, progress);
    stream(NMEA.gst, NMEA.ggaRtkFixed, NMEA.ggaRtkFloat, NMEA.ggaRtkFixed);
    const f = await p;
    expect(f).toMatchObject({ source: 'external', fixQuality: 'rtk_fixed', samples: 2 });
    expect(progress).toHaveBeenCalledTimes(3);
    expect(L.watchPositionAsync).not.toHaveBeenCalled();
  });

  test('external: sampleGps errors clearly instead of silently using the phone', async () => {
    jest.useFakeTimers();
    setPositionSettingsProvider(() => EXT);
    const p = sampleGps(0.1);
    const assertion = expect(p).rejects.toThrow(/receiver at 192\.168\.42\.1:9001/);
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  test('external: watchQuickFix streams receiver fixes (throttled) and releases the connection', async () => {
    jest.useFakeTimers();
    setPositionSettingsProvider(() => EXT);
    const got: unknown[] = [];
    const off = await watchQuickFix((f) => got.push(f));
    stream(NMEA.ggaRtkFixed, NMEA.ggaRtkFixed);
    expect(got).toHaveLength(1);
    off!();
    expect(getSharedReceiver()).not.toBeNull(); // lingers
    await jest.advanceTimersByTimeAsync(16_000);
    expect(getSharedReceiver()).toBeNull();
    expect(sockets[0].destroyed).toBe(true);
  });

  test('watchPosition external maps receiver states to source status', async () => {
    jest.useFakeTimers();
    const statuses: string[] = [];
    const fixes: unknown[] = [];
    const w = await watchPosition({ onFix: (f) => fixes.push(f), onStatus: (s) => statuses.push(s) }, { cfg: EXT });
    expect(w.kind).toBe('external_tcp');
    stream(NMEA.ggaRtkFloat);
    await jest.advanceTimersByTimeAsync(3100);
    expect(fixes).toHaveLength(1);
    expect(statuses).toEqual(expect.arrayContaining(['starting', 'live', 'stale']));
    w.remove();
  });

  test('one shared connection serves several users; a new address replaces it', () => {
    const a = acquireReceiver(EXT)!;
    const b = acquireReceiver(EXT)!;
    expect(a.receiver).toBe(b.receiver);
    expect(sockets).toHaveLength(1);
    const c = acquireReceiver({ ...EXT, receiverHost: '10.0.0.9' })!;
    expect(c.receiver).not.toBe(a.receiver);
    expect(sockets[0].destroyed).toBe(true);
    a.release();
    b.release();
    c.release();
  });
});
