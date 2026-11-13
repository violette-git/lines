// Rolling GPS buffer for the capture screen. Starts the moment the screen mounts so a fully
// averaged position is already waiting when the shutter fires (no "hold still for 4 seconds").
//
// - Subscribes to the configured position source (src/gps/positionSource.ts): phone location
//   services at 1 Hz, or an external receiver over TCP (typically 1 to 10 Hz).
// - Keeps fixes received in the last `windowSec` seconds.
// - Drops samples far from the newest one (the user walked to the next pole), so the average
//   follows the user instead of smearing along the walk. The walk distance shrinks with fix
//   quality: 0.25 m for RTK fixed, 1 m for RTK float, 6 m for phone GPS.
// - Averages with averageFixes (best quality class in window, accuracy weighted, outlier rejected).
// - Falls back to polling the phone every 2 s if the watch cannot start.
//
// Public API is backward compatible: useRollingGps(windowSec, enabled) -> { status, fix,
// sampleCount, getFixNow, reset } plus optional extras (source, sourceStatus, latest, receiverStatus).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GeoFix } from '@/domain/types';
import { averageFixes, distanceM } from '@/geo';
import { qualityOf } from '@/geo/averaging';
import {
  configFromSettings,
  EXTERNAL_FIX_MAX_AGE_MS,
  watchPosition,
  type PositionSourceKind,
  type SourceStatus,
} from '@/gps/positionSource';
import type { ReceiverStatus } from '@/gps/tcpReceiver';
import { useStore } from '@/state/store';

export type RollingGpsStatus = 'starting' | 'live' | 'denied' | 'unavailable';

interface Sample {
  fix: GeoFix;
  receivedAt: number;
}

/** Minimum distance (m) beyond which older samples are considered a previous standing spot. */
const WALK_RESET_MIN_M = 6;
/** If no reading arrived for this long, the buffered fix may be from a previous pole: don't use it at shutter time. */
const STALE_AT_SHUTTER_MS = 30000;
/** UI state updates at most this often; the buffer itself takes every sample. */
const UI_THROTTLE_MS = 400;

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
  /** Where positions are coming from right now ('device' when an external receiver is unavailable here). */
  source?: PositionSourceKind;
  /** Finer status, including 'stale' for a receiver that stopped talking. */
  sourceStatus?: SourceStatus;
  /** Newest raw sample (not averaged). */
  latest?: GeoFix | null;
  /** Live receiver status when the source is 'external_tcp'. */
  receiverStatus?: ReceiverStatus | null;
}

/** How far (m) an older sample may be from the newest before it is treated as a previous spot. */
export function walkResetLimitM(f: GeoFix): number {
  const q = qualityOf(f);
  const acc = f.accuracyM ?? 10;
  if (q === 'rtk_fixed') return Math.max(0.25, 4 * acc);
  if (q === 'rtk_float' || q === 'ppp') return Math.max(1, 3 * acc);
  return Math.max(WALK_RESET_MIN_M, 2 * acc);
}

export function pruneSamples(buf: Sample[], windowMs: number, now: number): Sample[] {
  let out = buf.filter((s) => now - s.receivedAt <= windowMs);
  if (out.length === 0 && buf.length > 0) out = [buf[buf.length - 1]]; // keep newest so we never go blank
  const newest = out[out.length - 1];
  if (!newest) return out;
  const limit = walkResetLimitM(newest.fix);
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
  const gpsSource = useStore((s) => s.settings.gpsSource);
  const receiverHost = useStore((s) => s.settings.receiverHost);
  const receiverPort = useStore((s) => s.settings.receiverPort);
  const antennaHeightM = useStore((s) => s.settings.antennaHeightM);
  const cfg = useMemo(
    () => configFromSettings({ gpsSource, receiverHost, receiverPort, antennaHeightM }),
    [gpsSource, receiverHost, receiverPort, antennaHeightM],
  );

  const buf = useRef<Sample[]>([]);
  const kindRef = useRef<PositionSourceKind>('device');
  const lastUi = useRef(0);
  const [status, setStatus] = useState<RollingGpsStatus>('starting');
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>('starting');
  const [source, setSource] = useState<PositionSourceKind>('device');
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [latest, setLatest] = useState<GeoFix | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [receiverStatus, setReceiverStatus] = useState<ReceiverStatus | null>(null);

  const push = useCallback(
    (f: GeoFix) => {
      const now = Date.now();
      buf.current = pruneSamples([...buf.current, { fix: f, receivedAt: now }], windowMs, now);
      if (now - lastUi.current < UI_THROTTLE_MS) return;
      lastUi.current = now;
      setFix(average(buf.current));
      setLatest(f);
      setSampleCount(buf.current.length);
    },
    [windowMs],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let remove: (() => void) | null = null;
    let lastRxUi = 0;
    let lastRxState: ReceiverStatus['state'] | null = null;
    // A new source must not average with samples from the old one.
    buf.current = [];
    lastUi.current = 0;
    setFix(null);
    setLatest(null);
    setSampleCount(0);
    setStatus('starting');
    setSourceStatus('starting');
    setReceiverStatus(null);

    watchPosition(
      {
        onFix: (f) => {
          if (cancelled) return;
          push(f);
          setStatus('live');
        },
        onStatus: (s) => {
          if (cancelled) return;
          setSourceStatus(s);
          if (s === 'live') setStatus('live');
          else if (s === 'denied') setStatus('denied');
          else if (s === 'stale') setStatus('unavailable');
          else if (s === 'unavailable') {
            if (kindRef.current === 'external_tcp') setStatus('unavailable');
            else setStatus((cur) => (cur === 'starting' ? 'unavailable' : cur));
          } else if (s === 'starting' && kindRef.current === 'external_tcp') setStatus('starting');
        },
        onReceiverStatus: (st) => {
          if (cancelled) return;
          const now = Date.now();
          if (st.state === lastRxState && now - lastRxUi < 1000) return;
          lastRxState = st.state;
          lastRxUi = now;
          setReceiverStatus(st);
        },
      },
      { precision: 'highest', cfg },
    ).then((w) => {
      kindRef.current = w.kind;
      if (cancelled) w.remove();
      else {
        remove = () => w.remove();
        setSource(w.kind);
      }
    });

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [enabled, push, cfg]);

  const getFixNow = useCallback((): GeoFix | null => {
    const now = Date.now();
    buf.current = pruneSamples(buf.current, windowMs, now);
    // pruneSamples() keeps the newest sample forever so the chip never goes blank; but if updates
    // stalled (GPS lost, receiver dropped) that sample can be old. Return null so the caller takes a
    // fresh fix. A receiver streams continuously, so its limit is much tighter.
    const newest = buf.current[buf.current.length - 1];
    const maxAge = kindRef.current === 'external_tcp' ? EXTERNAL_FIX_MAX_AGE_MS : Math.max(STALE_AT_SHUTTER_MS, windowMs * 3);
    if (newest && now - newest.receivedAt > maxAge) return null;
    return average(buf.current);
  }, [windowMs]);

  const reset = useCallback(() => {
    const newest = buf.current[buf.current.length - 1];
    buf.current = newest ? [newest] : [];
    setSampleCount(buf.current.length);
  }, []);

  return { status, fix, sampleCount, getFixNow, reset, source, sourceStatus, latest, receiverStatus };
}
