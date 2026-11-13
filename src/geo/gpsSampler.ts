// GPS capture. The source follows settings.gpsSource (see src/gps/positionSource.ts):
// - 'device': expo-location. Works on Android, iOS and web (expo-location's web module wraps
//   navigator.geolocation; web requires a secure context, i.e. https or localhost). Receivers that
//   feed the phone's location services arrive here too; their fix quality is inferred.
// - 'external_tcp': NMEA over TCP from the receiver, with fix quality reported by the receiver.
// Public API (sampleGps, getQuickFix, watchQuickFix, locationToFix) is unchanged.
import * as Location from 'expo-location';

import type { GeoFix } from '@/domain/types';
import {
  acquireReceiver,
  deviceLocationToFix,
  deviceQuickFix,
  effectiveSourceKind,
  getExternalFix,
  getPositionConfig,
  EXTERNAL_FIX_MAX_AGE_MS,
  type PositionConfig,
} from '@/gps/positionSource';

import { averageFixes } from './averaging';

export const LOCATION_PERMISSION_DENIED =
  'Location permission denied. Allow location access for LineMap Pro in your device or browser settings.';

/** Samples older than this (relative to sampling start) are treated as stale cached fixes. */
const STALE_TOLERANCE_MS = 2000;

/** expo-location reading -> GeoFix (with an inferred fixQuality; see positionSource). */
export function locationToFix(loc: Location.LocationObject, source: GeoFix['source'] = 'gps'): GeoFix {
  return deviceLocationToFix(loc, source);
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
  const cfg = getPositionConfig();
  if (effectiveSourceKind(cfg) === 'external_tcp') return sampleExternal(cfg, seconds, onProgress, signal);
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

/** Averages receiver fixes for `seconds`. Never falls back to phone GPS: a recalibration must not silently degrade. */
async function sampleExternal(
  cfg: PositionConfig,
  seconds: number,
  onProgress: ((fix: GeoFix, n: number) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<GeoFix> {
  const lease = acquireReceiver(cfg);
  if (!lease) throw new Error('Receiver address is not set. Open GPS receiver settings.');
  const rx = lease.receiver;
  const samples: GeoFix[] = [];
  const off = rx.onFix((f) => {
    samples.push(f);
    onProgress?.(f, samples.length);
  });
  try {
    // Wait the requested time, then up to 4 s more if nothing has arrived yet (receiver reconnecting).
    const deadline = Date.now() + Math.max(0, seconds) * 1000;
    const hardDeadline = deadline + 4000;
    await new Promise<void>((resolve, reject) => {
      const tick = setInterval(() => {
        const now = Date.now();
        if (now >= hardDeadline || (now >= deadline && samples.length > 0)) finish();
      }, 100);
      function finish() {
        clearInterval(tick);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }
      function onAbort() {
        clearInterval(tick);
        reject(abortError());
      }
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  } finally {
    off();
    lease.release();
  }
  if (samples.length > 0) return averageFixes(samples);
  const last = rx.getLastFix();
  if (last && rx.fixAgeMs() <= EXTERNAL_FIX_MAX_AGE_MS) {
    onProgress?.(last, 1);
    return last;
  }
  const st = rx.getStatus();
  const why = st.lastError ? ` (${st.lastError})` : st.state === 'streaming' ? ' (receiver has no position fix)' : '';
  throw new Error(`Could not get a position from the receiver at ${cfg.receiverHost}:${cfg.receiverPort}${why}.`);
}

/**
 * Best-effort single fix for the live "you are here" dot. Never throws; returns null when
 * permission is denied or no position is available. With an external receiver configured, returns
 * its fresh fix, falling back to the phone when the receiver has nothing (the fix then carries
 * fixQuality 'gps' so capture gating can flag it).
 */
export async function getQuickFix(): Promise<GeoFix | null> {
  try {
    const cfg = getPositionConfig();
    if (effectiveSourceKind(cfg) === 'external_tcp') {
      const ext = await getExternalFix({ cfg, timeoutMs: 4000 });
      if (ext) return ext;
    }
  } catch {
    // fall through to the phone
  }
  return deviceQuickFix();
}

/**
 * Continuous position updates for the live location dot. Returns an unsubscribe function, or null
 * when permission is not granted.
 */
export async function watchQuickFix(onFix: (fix: GeoFix) => void): Promise<(() => void) | null> {
  const cfg = getPositionConfig();
  if (effectiveSourceKind(cfg) === 'external_tcp') {
    const lease = acquireReceiver(cfg);
    if (lease) {
      const rx = lease.receiver;
      const last = rx.getLastFix();
      if (last && rx.fixAgeMs() <= EXTERNAL_FIX_MAX_AGE_MS) onFix(last);
      // Receivers stream up to 10 Hz; the map dot only needs about 1 Hz.
      let lastEmit = 0;
      const off = rx.onFix((f) => {
        const now = Date.now();
        if (now - lastEmit < 900) return;
        lastEmit = now;
        onFix(f);
      });
      return () => {
        off();
        lease.release();
      };
    }
  }
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
