// One place that decides where positions come from.
//
// - 'device': expo-location (phone GNSS, or a receiver whose companion app feeds the phone's
//   location services: Android mock location, iOS MFi accessory). Fix quality is inferred from the
//   reported accuracy because receivers feeding mock location report tiny values:
//   <= 0.05 m -> 'rtk_fixed', <= 0.5 m -> 'rtk_float', else 'gps'. Inferred values are marked in
//   GeoFix.receiver (see INFERRED_TAG / isInferredQuality).
// - 'external_tcp': NMEA over TCP from the receiver (tcpReceiver.ts). One shared connection serves
//   every screen; it lingers 15 s after the last user so screen changes do not reconnect.
//
// The settings come from the app store by default (lazy require, so this module stays light for
// tests). Tests and tools can inject them with setPositionSettingsProvider.
import * as Location from 'expo-location';

import type { AppSettings, FixQuality, GeoFix } from '@/domain/types';

import { TcpNmeaReceiver, getNativeSocketFactory, type ReceiverStatus, type SocketFactory } from './tcpReceiver';

export type PositionSourceKind = 'device' | 'external_tcp';

export interface PositionConfig {
  gpsSource: PositionSourceKind;
  receiverHost: string | null;
  receiverPort: number | null;
  antennaHeightM: number | null;
}

export const DEFAULT_POSITION_CONFIG: PositionConfig = {
  gpsSource: 'device',
  receiverHost: null,
  receiverPort: null,
  antennaHeightM: null,
};

export function configFromSettings(s: Partial<AppSettings> | null | undefined): PositionConfig {
  return {
    gpsSource: s?.gpsSource === 'external_tcp' ? 'external_tcp' : 'device',
    receiverHost: s?.receiverHost?.trim() ? s.receiverHost.trim() : null,
    receiverPort: s?.receiverPort != null && Number.isInteger(s.receiverPort) && s.receiverPort > 0 && s.receiverPort < 65536 ? s.receiverPort : null,
    antennaHeightM: s?.antennaHeightM != null && Number.isFinite(s.antennaHeightM) ? s.antennaHeightM : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Settings provider

type SettingsProvider = () => PositionConfig;

let provider: SettingsProvider | null = null;

function storeProvider(): PositionConfig {
  try {
    // Lazy so importing gpsSampler does not pull in the store/database in tests and tools.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../state/store') as { useStore?: { getState(): { settings?: Partial<AppSettings> } } };
    return configFromSettings(mod.useStore?.getState().settings);
  } catch {
    return DEFAULT_POSITION_CONFIG;
  }
}

/** Overrides where settings come from (tests, tools). Pass null to go back to the app store. */
export function setPositionSettingsProvider(p: SettingsProvider | null): void {
  provider = p;
}

export function getPositionConfig(): PositionConfig {
  return (provider ?? storeProvider)();
}

// ---------------------------------------------------------------------------------------------
// Socket factory (TCP support)

let socketFactoryOverride: SocketFactory | null | undefined;

/** Tests: inject a socket factory (null = force unsupported, undefined = native auto-detect). */
export function setReceiverSocketFactory(f: SocketFactory | null | undefined): void {
  socketFactoryOverride = f;
}

function socketFactory(): SocketFactory | null {
  return socketFactoryOverride !== undefined ? socketFactoryOverride : getNativeSocketFactory();
}

/** True when this build can open TCP sockets (installed app with the native module, not web/Expo Go). */
export function isExternalTcpSupported(): boolean {
  return socketFactory() != null;
}

/**
 * The source that will actually be used. 'external_tcp' falls back to 'device' when TCP is not
 * supported here or the receiver address is incomplete.
 */
export function effectiveSourceKind(cfg: PositionConfig = getPositionConfig()): PositionSourceKind {
  if (cfg.gpsSource !== 'external_tcp') return 'device';
  if (!cfg.receiverHost || !cfg.receiverPort) return 'device';
  return isExternalTcpSupported() ? 'external_tcp' : 'device';
}

// ---------------------------------------------------------------------------------------------
// Device (expo-location) fixes with inferred quality

/** Appended to GeoFix.receiver when quality was inferred from accuracy, not reported by a receiver. */
export const INFERRED_TAG = '(quality inferred)';
export const RTK_FIXED_INFER_M = 0.05;
export const RTK_FLOAT_INFER_M = 0.5;

export function inferDeviceQuality(accuracyM: number | null | undefined): FixQuality {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= 0) return 'gps';
  if (accuracyM <= RTK_FIXED_INFER_M) return 'rtk_fixed';
  if (accuracyM <= RTK_FLOAT_INFER_M) return 'rtk_float';
  return 'gps';
}

/** expo-location reading -> GeoFix, tagged with an inferred fix quality. */
export function deviceLocationToFix(loc: Location.LocationObject, source: GeoFix['source'] = 'gps'): GeoFix {
  const accuracyM = loc.coords.accuracy ?? null;
  const fixQuality = inferDeviceQuality(accuracyM);
  const viaReceiver = loc.mocked === true;
  let receiver: string | null = null;
  if (fixQuality !== 'gps') receiver = `${viaReceiver ? 'Receiver via phone location' : 'Phone location'} ${INFERRED_TAG}`;
  else if (viaReceiver) receiver = 'Receiver via phone location';
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracyM,
    altitudeM: loc.coords.altitude ?? null,
    samples: 1,
    capturedAt: new Date(loc.timestamp || Date.now()).toISOString(),
    source,
    fixQuality,
    hdop: null,
    satellites: null,
    receiver,
  };
}

/** True when the fix quality was guessed from accuracy rather than reported by a receiver. */
export function isInferredQuality(fix: Pick<GeoFix, 'receiver' | 'source'> | null | undefined): boolean {
  return !!fix && fix.source !== 'external' && !!fix.receiver && fix.receiver.includes(INFERRED_TAG);
}

/** Best-effort device fix. Never throws. */
export async function deviceQuickFix(): Promise<GeoFix | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10000, requiredAccuracy: 50 }).catch(() => null);
    if (last) return deviceLocationToFix(last);
    const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return deviceLocationToFix(cur);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Shared external receiver

const LINGER_MS = 15000;

interface Shared {
  rx: TcpNmeaReceiver;
  key: string;
  refs: number;
  linger: ReturnType<typeof setTimeout> | null;
}

let shared: Shared | null = null;
const sharedListeners = new Set<(rx: TcpNmeaReceiver | null) => void>();

function notifyShared(): void {
  for (const fn of [...sharedListeners]) fn(shared?.rx ?? null);
}

export interface ReceiverLease {
  receiver: TcpNmeaReceiver;
  release(): void;
}

/**
 * Starts (or reuses) the shared TCP receiver for the configured host:port. Returns null when no
 * receiver address is configured. The connection stays up while any lease is held, plus 15 s.
 */
export function acquireReceiver(cfg: PositionConfig = getPositionConfig()): ReceiverLease | null {
  if (!cfg.receiverHost || !cfg.receiverPort) return null;
  const key = `${cfg.receiverHost}:${cfg.receiverPort}`;
  if (shared && shared.key !== key) {
    if (shared.linger) clearTimeout(shared.linger);
    shared.rx.stop();
    shared = null;
  }
  if (!shared) {
    shared = {
      rx: new TcpNmeaReceiver({
        host: cfg.receiverHost,
        port: cfg.receiverPort,
        antennaHeightM: cfg.antennaHeightM,
        socketFactory: socketFactory(),
      }),
      key,
      refs: 0,
      linger: null,
    };
    notifyShared();
  } else {
    shared.rx.updateConfig({ antennaHeightM: cfg.antennaHeightM });
  }
  const s = shared;
  if (s.linger) clearTimeout(s.linger);
  s.linger = null;
  s.refs++;
  s.rx.start();
  let released = false;
  return {
    receiver: s.rx,
    release() {
      if (released) return;
      released = true;
      s.refs = Math.max(0, s.refs - 1);
      if (s.refs === 0 && shared === s) {
        s.linger = setTimeout(() => {
          if (shared === s && s.refs === 0) {
            s.rx.stop();
            shared = null;
            notifyShared();
          }
        }, LINGER_MS);
      }
    },
  };
}

/** The shared receiver if one exists (connected, retrying or lingering). */
export function getSharedReceiver(): TcpNmeaReceiver | null {
  return shared?.rx ?? null;
}

/** Notified when the shared receiver instance is created or torn down. */
export function onSharedReceiverChange(fn: (rx: TcpNmeaReceiver | null) => void): () => void {
  sharedListeners.add(fn);
  return () => sharedListeners.delete(fn);
}

/** Tests: stop and forget the shared receiver and overrides. */
export function resetPositionSourceForTests(): void {
  if (shared) {
    if (shared.linger) clearTimeout(shared.linger);
    shared.rx.stop();
  }
  shared = null;
  provider = null;
  socketFactoryOverride = undefined;
}

/** External fixes older than this are not used for a capture. */
export const EXTERNAL_FIX_MAX_AGE_MS = 3000;

/**
 * Latest receiver fix if fresh, else waits up to timeoutMs for the next one. Null on timeout or
 * when no receiver is configured.
 */
export async function getExternalFix(
  opts: { timeoutMs?: number; maxAgeMs?: number; cfg?: PositionConfig } = {},
): Promise<GeoFix | null> {
  const lease = acquireReceiver(opts.cfg ?? getPositionConfig());
  if (!lease) return null;
  const rx = lease.receiver;
  const maxAge = opts.maxAgeMs ?? EXTERNAL_FIX_MAX_AGE_MS;
  try {
    const last = rx.getLastFix();
    if (last && rx.fixAgeMs() <= maxAge) return last;
    if (!rx.supported) return null;
    return await new Promise<GeoFix | null>((resolve) => {
      const t = setTimeout(() => {
        off();
        resolve(null);
      }, opts.timeoutMs ?? 4000);
      const off = rx.onFix((f) => {
        clearTimeout(t);
        off();
        resolve(f);
      });
    });
  } finally {
    lease.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Unified watch (used by useRollingGps)

/** Coarse source status for UI. 'stale' only happens with an external receiver. */
export type SourceStatus = 'starting' | 'live' | 'stale' | 'denied' | 'unavailable';

export interface PositionWatchHandlers {
  onFix(fix: GeoFix): void;
  onStatus?(status: SourceStatus, detail?: string | null): void;
  /** External receiver status on every change (external source only). */
  onReceiverStatus?(status: ReceiverStatus): void;
}

export interface PositionWatchOptions {
  /** 'highest' = 1 Hz survey sampling, 'high' = 2 s for a map dot. */
  precision?: 'highest' | 'high';
  /** Device: seed with a recent cached fix so the UI is not blank. Default true. */
  seedLastKnown?: boolean;
  cfg?: PositionConfig;
}

export interface PositionWatch {
  kind: PositionSourceKind;
  remove(): void;
}

export function receiverStateToSourceStatus(st: ReceiverStatus['state'], everLive: boolean): SourceStatus {
  switch (st) {
    case 'streaming':
      return 'live';
    case 'stale':
      return 'stale';
    case 'connecting':
    case 'connected':
      return everLive ? 'unavailable' : 'starting';
    case 'retrying':
      return 'unavailable';
    default:
      return 'unavailable';
  }
}

/** Subscribes to positions from the configured source. Never throws; status reports problems. */
export async function watchPosition(h: PositionWatchHandlers, opts: PositionWatchOptions = {}): Promise<PositionWatch> {
  const cfg = opts.cfg ?? getPositionConfig();
  const kind = effectiveSourceKind(cfg);
  if (kind === 'external_tcp') {
    const w = watchExternal(h, cfg);
    if (w) return w;
  }
  return watchDevice(h, opts);
}

function watchExternal(h: PositionWatchHandlers, cfg: PositionConfig): PositionWatch | null {
  const lease = acquireReceiver(cfg);
  if (!lease) return null;
  const rx = lease.receiver;
  let everLive = false;
  const emitStatus = (st: ReceiverStatus) => {
    if (st.state === 'streaming') everLive = true;
    h.onReceiverStatus?.(st);
    h.onStatus?.(receiverStateToSourceStatus(st.state, everLive), st.lastError);
  };
  const offFix = rx.onFix((f) => h.onFix(f));
  const offStatus = rx.onStatus(emitStatus);
  const last = rx.getLastFix();
  if (last && rx.fixAgeMs() <= EXTERNAL_FIX_MAX_AGE_MS) h.onFix(last);
  emitStatus(rx.getStatus());
  return {
    kind: 'external_tcp',
    remove() {
      offFix();
      offStatus();
      lease.release();
    },
  };
}

async function watchDevice(h: PositionWatchHandlers, opts: PositionWatchOptions): Promise<PositionWatch> {
  let cancelled = false;
  let sub: Location.LocationSubscription | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  const highest = (opts.precision ?? 'highest') === 'highest';

  const startPolling = () => {
    if (poll || cancelled) return;
    const tick = async () => {
      const f = await deviceQuickFix();
      if (cancelled) return;
      if (f) {
        h.onFix(f);
        h.onStatus?.('live');
      }
    };
    void tick();
    poll = setInterval(tick, 2000);
  };

  const handle: PositionWatch = {
    kind: 'device',
    remove() {
      cancelled = true;
      sub?.remove();
      if (poll) clearInterval(poll);
    },
  };

  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (cancelled) return handle;
    if (!perm.granted) {
      h.onStatus?.('denied', 'Location permission denied');
      return handle;
    }
    if (opts.seedLastKnown !== false) {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 15000, requiredAccuracy: 30 }).catch(() => null);
      if (cancelled) return handle;
      if (last) h.onFix(deviceLocationToFix(last));
    }
    sub = await Location.watchPositionAsync(
      highest
        ? { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 }
        : { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 1 },
      (loc) => {
        if (cancelled) return;
        h.onFix(deviceLocationToFix(loc));
        h.onStatus?.('live');
      },
      () => {
        if (!cancelled) startPolling();
      },
    );
    if (cancelled) sub.remove();
  } catch {
    if (!cancelled) {
      startPolling();
      h.onStatus?.('unavailable', 'Location updates could not start; polling instead');
    }
  }
  return handle;
}
