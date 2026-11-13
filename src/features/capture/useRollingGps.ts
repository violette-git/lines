// Rolling GPS buffer for the capture screen. Starts the moment the screen mounts so a fully
// averaged position is already waiting when the shutter fires (no "hold still for 4 seconds").
//
// - Subscribes to high-accuracy position updates (1 Hz).
// - Keeps fixes received in the last `windowSec` seconds.
// - Drops samples far from the newest one (the user walked to the next pole), so the average
//   follows the user instead of smearing along the walk.
// - Averages with averageFixes (accuracy weighted, outlier rejected).
// - Falls back to polling getQuickFix every 2 s if the watch cannot start.
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { GeoFix } from '@/domain/types';
import { averageFixes, distanceM } from '@/geo';
import { getQuickFix, locationToFix } from '@/geo/gpsSampler';

export type RollingGpsStatus = 'starting' | 'live' | 'denied' | 'unavailable';

interface Sample {
  fix: GeoFix;
  receivedAt: number;
}

/** Minimum distance (m) beyond which older samples are considered a previous standing spot. */
const WALK_RESET_MIN_M = 6;
/** If no reading arrived for this long, the buffered fix may be from a previous pole: don't use it at shutter time. */
const STALE_AT_SHUTTER_MS = 30000;

export interface RollingGps {
  status: RollingGpsStatus;
  /** Averaged fix over the window (null until the first reading). */
  fix: GeoFix | null;
  /** Number of samples in the current average. */
  sampleCount: number;
  /** Synchronous read of the best fix right now (call at shutter time). */
  getFixNow(): GeoFix | null;
  /** Clears the buffer (e.g. after the user moved on). */
  reset(): void;
}

function prune(buf: Sample[], windowMs: number, now: number): Sample[] {
  let out = buf.filter((s) => now - s.receivedAt <= windowMs);
  if (out.length === 0 && buf.length > 0) out = [buf[buf.length - 1]]; // keep newest so we never go blank
  const newest = out[out.length - 1];
  if (!newest) return out;
  const limit = Math.max(WALK_RESET_MIN_M, 2 * (newest.fix.accuracyM ?? 10));
  return out.filter((s) => s === newest || distanceM(s.fix, newest.fix) <= limit);
}

function average(buf: Sample[]): GeoFix | null {
  if (buf.length === 0) return null;
  try {
    return averageFixes(buf.map((s) => s.fix));
  } catch {
    return buf[buf.length - 1].fix;
  }
}

export function useRollingGps(windowSec: number, enabled = true): RollingGps {
  const windowMs = Math.max(2, windowSec) * 1000;
  const buf = useRef<Sample[]>([]);
  const [status, setStatus] = useState<RollingGpsStatus>('starting');
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [sampleCount, setSampleCount] = useState(0);

  const push = useCallback(
    (f: GeoFix) => {
      const now = Date.now();
      buf.current = prune([...buf.current, { fix: f, receivedAt: now }], windowMs, now);
      const avg = average(buf.current);
      setFix(avg);
      setSampleCount(buf.current.length);
    },
    [windowMs],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      const tick = async () => {
        const f = await getQuickFix();
        if (cancelled) return;
        if (f) {
          push(f);
          setStatus('live');
        }
      };
      void tick();
      poll = setInterval(tick, 2000);
    };

    (async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!perm.granted) {
          setStatus('denied');
          return;
        }
        // Seed with a recent cached fix so the chip is never blank on open.
        const last = await Location.getLastKnownPositionAsync({ maxAge: 15000, requiredAccuracy: 30 }).catch(() => null);
        if (cancelled) return;
        if (last && buf.current.length === 0) push(locationToFix(last));
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 },
          (loc) => {
            if (cancelled) return;
            push(locationToFix(loc));
            setStatus('live');
          },
          () => {
            if (!cancelled && !poll) startPolling();
          },
        );
        if (cancelled) sub.remove();
      } catch {
        if (cancelled) return;
        startPolling();
        setStatus((s) => (s === 'starting' ? 'unavailable' : s));
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      if (poll) clearInterval(poll);
    };
  }, [enabled, push]);

  const getFixNow = useCallback((): GeoFix | null => {
    const now = Date.now();
    buf.current = prune(buf.current, windowMs, now);
    // prune() keeps the newest sample forever so the chip never goes blank; but if updates stalled
    // (GPS lost, watch died) that sample can be minutes old. Return null so the caller takes a fresh fix.
    const newest = buf.current[buf.current.length - 1];
    if (newest && now - newest.receivedAt > Math.max(STALE_AT_SHUTTER_MS, windowMs * 3)) return null;
    return average(buf.current);
  }, [windowMs]);

  const reset = useCallback(() => {
    const newest = buf.current[buf.current.length - 1];
    buf.current = newest ? [newest] : [];
    setSampleCount(buf.current.length);
  }, []);

  return { status, fix, sampleCount, getFixNow, reset };
}
