// GPS capture via expo-location. Works on Android, iOS and web (expo-location's web module wraps
// navigator.geolocation; web requires a secure context, i.e. https or localhost).
import * as Location from 'expo-location';

import type { GeoFix } from '@/domain/types';

import { averageFixes } from './averaging';

export const LOCATION_PERMISSION_DENIED =
  'Location permission denied. Allow location access for LineMap Pro in your device or browser settings.';

/** Samples older than this (relative to sampling start) are treated as stale cached fixes. */
const STALE_TOLERANCE_MS = 2000;

export function locationToFix(loc: Location.LocationObject, source: GeoFix['source'] = 'gps'): GeoFix {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracyM: loc.coords.accuracy ?? null,
    altitudeM: loc.coords.altitude ?? null,
    samples: 1,
    capturedAt: new Date(loc.timestamp || Date.now()).toISOString(),
    source,
  };
}

function abortError(): Error {
  const e = new Error('GPS sampling cancelled');
  e.name = 'AbortError';
  return e;
}

async function ensurePermission(): Promise<void> {
  let perm = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (!perm?.granted) perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error(LOCATION_PERMISSION_DENIED);
}

/**
 * Collects GPS readings for `seconds` and returns their accuracy-weighted average.
 * Falls back to a single getCurrentPositionAsync reading when the watch produced nothing.
 * Rejects with an Error named 'AbortError' when `signal` aborts.
 */
export async function sampleGps(
  seconds: number,
  onProgress?: (fix: GeoFix, n: number) => void,
  signal?: AbortSignal,
): Promise<GeoFix> {
  if (signal?.aborted) throw abortError();
  await ensurePermission();
  if (signal?.aborted) throw abortError();

  const startedAt = Date.now();
  const samples: GeoFix[] = [];
  let watchError: string | null = null;
  let sub: Location.LocationSubscription | null = null;

  if (seconds > 0) {
    try {
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 },
        (loc) => {
          if (loc.timestamp && loc.timestamp < startedAt - STALE_TOLERANCE_MS) return;
          const fix = locationToFix(loc);
          samples.push(fix);
          onProgress?.(fix, samples.length);
        },
        (reason) => {
          watchError = reason;
        },
      );
    } catch (e) {
      watchError = e instanceof Error ? e.message : String(e);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, seconds * 1000);
        function onAbort() {
          clearTimeout(t);
          reject(abortError());
        }
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    } finally {
      sub?.remove();
    }
  }

  if (samples.length > 0) return averageFixes(samples);

  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    if (signal?.aborted) throw abortError();
    const fix = locationToFix(loc);
    onProgress?.(fix, 1);
    return fix;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not get a GPS fix: ${watchError ?? msg}`);
  }
}

/**
 * Best-effort single fix for the live "you are here" dot. Never throws; returns null when
 * permission is denied or no position is available.
 */
export async function getQuickFix(): Promise<GeoFix | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10000, requiredAccuracy: 50 }).catch(() => null);
    if (last) return locationToFix(last);
    const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return locationToFix(cur);
  } catch {
    return null;
  }
}

/**
 * Continuous position updates for the live location dot. Returns an unsubscribe function, or null
 * when permission is not granted.
 */
export async function watchQuickFix(onFix: (fix: GeoFix) => void): Promise<(() => void) | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 1 },
      (loc) => onFix(locationToFix(loc)),
    );
    return () => sub.remove();
  } catch {
    return null;
  }
}
