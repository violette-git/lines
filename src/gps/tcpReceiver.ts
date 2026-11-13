// NMEA over TCP from an external GNSS receiver on the local Wi-Fi or hotspot (for example an Emlid
// Reach with Position streaming set to TCP server, NMEA).
//
// - The socket layer is injected (SocketFactory) so the same class runs on react-native-tcp-socket
//   in the app, on Node's `net` in tests, or on a fake socket in unit tests.
// - Native support is feature-detected: on web and in builds without the native module (Expo Go)
//   getNativeSocketFactory() returns null and the receiver reports state 'unsupported'.
// - Reconnects with exponential backoff (1 s, 2 s, 4 s ... 15 s, +/-20% jitter). The backoff resets
//   once a valid sentence arrives, so a server that accepts and immediately drops does not spin.
// - Stale detection: no valid sentence for 3 s -> 'stale'. No data for 10 s -> drop the socket and
//   reconnect (half-open connections after Wi-Fi roaming never report a close).
import { NativeModules, Platform } from 'react-native';
import type TcpSocketModule from 'react-native-tcp-socket';

import type { GeoFix } from '@/domain/types';

import { NmeaFixAssembler, NmeaLineBuffer, parseNmea, type ReceiverSnapshot } from './nmea';

// ---------------------------------------------------------------------------------------------
// Socket abstraction

type DataChunk = string | { toString(encoding?: string): string; length?: number };

/** Minimal socket surface the receiver needs. Adapters wrap real sockets into this. */
export interface SocketLike {
  onConnect(fn: () => void): void;
  onData(fn: (chunk: DataChunk) => void): void;
  onError(fn: (err: unknown) => void): void;
  onClose(fn: () => void): void;
  destroy(): void;
}

export interface SocketConnectOptions {
  host: string;
  port: number;
  connectTimeoutMs: number;
  /** Android only: route the socket over Wi-Fi even when Wi-Fi has no internet (receiver hotspots). */
  bindToWifi: boolean;
}

export type SocketFactory = (opts: SocketConnectOptions) => SocketLike;

type TcpSocketDefault = typeof TcpSocketModule;
type TcpConnectionOptions = Parameters<TcpSocketDefault['createConnection']>[0];

let nativeFactoryCache: SocketFactory | null | undefined;

/**
 * react-native-tcp-socket adapter, or null when TCP is not available (web, Expo Go, module missing).
 * The module is required lazily: on iOS its import constructs a NativeEventEmitter, which throws
 * when the native module is absent.
 */
export function getNativeSocketFactory(): SocketFactory | null {
  if (nativeFactoryCache !== undefined) return nativeFactoryCache;
  nativeFactoryCache = null;
  try {
    if (Platform.OS === 'web') return null;
    if (!NativeModules || !NativeModules.TcpSockets) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-tcp-socket') as { default?: TcpSocketDefault } & Partial<TcpSocketDefault>;
    const lib = (mod.default ?? mod) as TcpSocketDefault;
    if (!lib || typeof lib.createConnection !== 'function') return null;
    nativeFactoryCache = (o) => {
      const opts: TcpConnectionOptions = { host: o.host, port: o.port, connectTimeout: o.connectTimeoutMs };
      if (o.bindToWifi && Platform.OS === 'android') opts.interface = 'wifi';
      const sock = lib.createConnection(opts, () => undefined);
      sock.setEncoding('latin1');
      return {
        onConnect: (fn) => void sock.on('connect', fn),
        onData: (fn) => void sock.on('data', (d) => fn(d as DataChunk)),
        onError: (fn) => void sock.on('error', fn),
        onClose: (fn) => void sock.on('close', () => fn()),
        destroy: () => {
          try {
            sock.removeAllListeners();
            sock.destroy();
          } catch {
            // already gone
          }
        },
      };
    };
  } catch {
    nativeFactoryCache = null;
  }
  return nativeFactoryCache;
}

// ---------------------------------------------------------------------------------------------
// Receiver

export type ReceiverState =
  | 'idle' // not started or stopped
  | 'unsupported' // no TCP on this platform/build
  | 'connecting'
  | 'connected' // socket open, no valid sentence yet
  | 'streaming' // valid sentences within the stale window
  | 'stale' // connected but silent for staleMs
  | 'retrying'; // waiting for the next reconnect attempt

export interface ReceiverStatus {
  state: ReceiverState;
  host: string;
  port: number;
  /** Consecutive failed attempts since the last valid sentence. */
  attempt: number;
  lastError: string | null;
  nextRetryAt: number | null;
  connectedAt: number | null;
  lastSentenceAt: number | null;
  lastFixAt: number | null;
  lastSentence: string | null;
  sentences: number;
  checksumErrors: number;
  bytes: number;
  snapshot: ReceiverSnapshot;
  lastFix: GeoFix | null;
}

export interface TcpReceiverOptions {
  host: string;
  port: number;
  antennaHeightM?: number | null;
  receiverName?: string | null;
  /** Null = unsupported. Undefined = auto-detect native support. */
  socketFactory?: SocketFactory | null;
  staleMs?: number;
  staleReconnectMs?: number;
  connectTimeoutMs?: number;
  backoffInitialMs?: number;
  backoffMaxMs?: number;
  /** 0..1, fraction of random spread around each backoff delay. */
  backoffJitter?: number;
  random?: () => number;
  now?: () => number;
  /** Try binding to Wi-Fi first on Android. Default true. */
  bindToWifi?: boolean;
}

export const UNSUPPORTED_MESSAGE =
  'Receiver over Wi-Fi needs the installed LineMap Pro app (it is not available in the web preview or Expo Go). Use Phone location instead.';

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function chunkToText(c: DataChunk): string {
  if (typeof c === 'string') return c;
  try {
    return c.toString('latin1');
  } catch {
    return String(c);
  }
}

export function backoffDelay(attempt: number, initialMs: number, maxMs: number, jitter = 0, rnd = 0.5): number {
  const base = Math.min(maxMs, initialMs * Math.pow(2, Math.max(0, attempt - 1)));
  const spread = 1 + jitter * (rnd * 2 - 1);
  return Math.max(0, Math.round(base * spread));
}

type Listener<T> = (v: T) => void;

export class TcpNmeaReceiver {
  private o: Required<Omit<TcpReceiverOptions, 'socketFactory' | 'antennaHeightM' | 'receiverName'>> & {
    antennaHeightM: number | null;
    receiverName: string;
  };
  private factory: SocketFactory | null;
  private running = false;
  private gen = 0;
  private socket: SocketLike | null = null;
  private lines = new NmeaLineBuffer();
  private assembler: NmeaFixAssembler;
  private fixListeners = new Set<Listener<GeoFix>>();
  private statusListeners = new Set<Listener<ReceiverStatus>>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private deadTimer: ReturnType<typeof setTimeout> | null = null;
  private connectGuard: ReturnType<typeof setTimeout> | null = null;
  private useWifiBinding: boolean;
  private status: ReceiverStatus;

  constructor(opts: TcpReceiverOptions) {
    this.o = {
      host: opts.host,
      port: opts.port,
      antennaHeightM: opts.antennaHeightM ?? null,
      receiverName: opts.receiverName ?? `Receiver ${opts.host}:${opts.port}`,
      staleMs: opts.staleMs ?? 3000,
      staleReconnectMs: opts.staleReconnectMs ?? 10000,
      connectTimeoutMs: opts.connectTimeoutMs ?? 5000,
      backoffInitialMs: opts.backoffInitialMs ?? 1000,
      backoffMaxMs: opts.backoffMaxMs ?? 15000,
      backoffJitter: opts.backoffJitter ?? 0.2,
      random: opts.random ?? Math.random,
      now: opts.now ?? (() => Date.now()),
      bindToWifi: opts.bindToWifi ?? true,
    };
    this.factory = opts.socketFactory === undefined ? getNativeSocketFactory() : opts.socketFactory;
    this.useWifiBinding = this.o.bindToWifi;
    this.assembler = new NmeaFixAssembler({ antennaHeightM: this.o.antennaHeightM, receiverName: this.o.receiverName });
    this.status = this.freshStatus(this.factory ? 'idle' : 'unsupported');
    if (!this.factory) this.status.lastError = UNSUPPORTED_MESSAGE;
  }

  get supported(): boolean {
    return this.factory != null;
  }

  get host(): string {
    return this.o.host;
  }

  get port(): number {
    return this.o.port;
  }

  get isRunning(): boolean {
    return this.running;
  }

  getStatus(): ReceiverStatus {
    return this.status;
  }

  getLastFix(): GeoFix | null {
    return this.status.lastFix;
  }

  /** Milliseconds since the last fix, or Infinity. */
  fixAgeMs(): number {
    return this.status.lastFixAt == null ? Infinity : this.o.now() - this.status.lastFixAt;
  }

  onFix(fn: Listener<GeoFix>): () => void {
    this.fixListeners.add(fn);
    return () => this.fixListeners.delete(fn);
  }

  onStatus(fn: Listener<ReceiverStatus>): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Antenna height and label apply immediately; host/port changes reconnect. */
  updateConfig(patch: { host?: string; port?: number; antennaHeightM?: number | null; receiverName?: string | null }): void {
    if (patch.antennaHeightM !== undefined) {
      this.o.antennaHeightM = patch.antennaHeightM;
      this.assembler.setOptions({ antennaHeightM: patch.antennaHeightM });
    }
    if (patch.receiverName) {
      this.o.receiverName = patch.receiverName;
      this.assembler.setOptions({ receiverName: patch.receiverName });
    }
    const hostChanged = patch.host !== undefined && patch.host !== this.o.host;
    const portChanged = patch.port !== undefined && patch.port !== this.o.port;
    if (hostChanged || portChanged) {
      if (patch.host !== undefined) this.o.host = patch.host;
      if (patch.port !== undefined) this.o.port = patch.port;
      if (!patch.receiverName) {
        this.o.receiverName = `Receiver ${this.o.host}:${this.o.port}`;
        this.assembler.setOptions({ receiverName: this.o.receiverName });
      }
      const wasRunning = this.running;
      this.stop();
      this.assembler.reset();
      this.status = this.freshStatus(this.factory ? 'idle' : 'unsupported');
      if (wasRunning) this.start();
    }
  }

  start(): void {
    if (this.running) return;
    if (!this.factory) {
      this.setStatus({ state: 'unsupported', lastError: UNSUPPORTED_MESSAGE });
      return;
    }
    this.running = true;
    this.status = { ...this.status, attempt: 0, lastError: null };
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.gen++;
    this.teardownSocket();
    this.clearTimers();
    if (this.status.state !== 'unsupported') this.setStatus({ state: 'idle', nextRetryAt: null });
  }

  /** Drops the current connection and reconnects right away (the "Connect / test" button). */
  reconnectNow(): void {
    if (!this.factory) {
      this.setStatus({ state: 'unsupported', lastError: UNSUPPORTED_MESSAGE });
      return;
    }
    this.stop();
    this.status = { ...this.status, attempt: 0 };
    this.start();
  }

  // -------------------------------------------------------------------------------------------

  private freshStatus(state: ReceiverState): ReceiverStatus {
    return {
      state,
      host: this.o.host,
      port: this.o.port,
      attempt: 0,
      lastError: null,
      nextRetryAt: null,
      connectedAt: null,
      lastSentenceAt: null,
      lastFixAt: null,
      lastSentence: null,
      sentences: 0,
      checksumErrors: 0,
      bytes: 0,
      snapshot: this.assembler.snapshot,
      lastFix: null,
    };
  }

  private setStatus(patch: Partial<ReceiverStatus>): void {
    this.status = { ...this.status, ...patch, host: this.o.host, port: this.o.port, snapshot: this.assembler.snapshot };
    for (const fn of [...this.statusListeners]) {
      try {
        fn(this.status);
      } catch {
        // listener errors never break the stream
      }
    }
  }

  private clearTimers(): void {
    for (const t of [this.retryTimer, this.staleTimer, this.deadTimer, this.connectGuard]) if (t) clearTimeout(t);
    this.retryTimer = this.staleTimer = this.deadTimer = this.connectGuard = null;
  }

  private teardownSocket(): void {
    const s = this.socket;
    this.socket = null;
    if (s) {
      try {
        s.destroy();
      } catch {
        // ignore
      }
    }
    this.lines.reset();
  }

  private connect(): void {
    if (!this.running || !this.factory) return;
    const gen = ++this.gen;
    this.clearTimers();
    this.teardownSocket();
    this.setStatus({ state: 'connecting', attempt: this.status.attempt + 1, nextRetryAt: null, connectedAt: null });
    let sock: SocketLike;
    try {
      sock = this.factory({
        host: this.o.host,
        port: this.o.port,
        connectTimeoutMs: this.o.connectTimeoutMs,
        bindToWifi: this.useWifiBinding,
      });
    } catch (e) {
      this.fail(gen, errText(e));
      return;
    }
    this.socket = sock;
    this.connectGuard = setTimeout(() => this.fail(gen, `Timed out connecting to ${this.o.host}:${this.o.port}`), this.o.connectTimeoutMs + 1000);
    sock.onConnect(() => {
      if (gen !== this.gen) return;
      if (this.connectGuard) clearTimeout(this.connectGuard);
      this.connectGuard = null;
      this.setStatus({ state: 'connected', connectedAt: this.o.now(), lastError: null });
      this.armStaleTimers(gen);
    });
    sock.onData((chunk) => {
      if (gen !== this.gen) return;
      this.handleData(gen, chunk);
    });
    sock.onError((e) => this.fail(gen, errText(e)));
    sock.onClose(() => this.fail(gen, this.status.lastError ?? 'Connection closed by the receiver'));
  }

  private armStaleTimers(gen: number): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    if (this.deadTimer) clearTimeout(this.deadTimer);
    this.staleTimer = setTimeout(() => {
      if (gen !== this.gen) return;
      this.setStatus({ state: 'stale' });
    }, this.o.staleMs);
    this.deadTimer = setTimeout(() => {
      this.fail(gen, `No data from the receiver for ${Math.round(this.o.staleReconnectMs / 1000)} s`);
    }, this.o.staleReconnectMs);
  }

  private handleData(gen: number, chunk: DataChunk): void {
    const text = chunkToText(chunk);
    let bytes = this.status.bytes + text.length;
    let sentences = this.status.sentences;
    let checksumErrors = this.status.checksumErrors;
    let lastSentence = this.status.lastSentence;
    let alive = false;
    const fixes: GeoFix[] = [];
    const now = this.o.now();
    for (const line of this.lines.push(text)) {
      const r = parseNmea(line);
      if (r.ok) {
        alive = true;
        sentences++;
        lastSentence = r.sentence.raw;
        const fix = this.assembler.push(r.sentence, now);
        if (fix) fixes.push(fix);
      } else if (r.reason === 'unsupported') {
        alive = true;
        sentences++;
        lastSentence = r.raw;
      } else if (r.reason === 'checksum' || r.reason === 'missing_checksum') {
        checksumErrors++;
      }
    }
    bytes = Math.min(bytes, Number.MAX_SAFE_INTEGER);
    const patch: Partial<ReceiverStatus> = { bytes, sentences, checksumErrors, lastSentence };
    if (alive) {
      patch.state = 'streaming';
      patch.attempt = 0;
      patch.lastSentenceAt = now;
      patch.lastError = null;
      this.armStaleTimers(gen);
    }
    if (fixes.length) {
      patch.lastFix = fixes[fixes.length - 1];
      patch.lastFixAt = now;
    }
    this.setStatus(patch);
    for (const f of fixes) {
      for (const fn of [...this.fixListeners]) {
        try {
          fn(f);
        } catch {
          // ignore listener errors
        }
      }
    }
  }

  private fail(gen: number, message: string): void {
    if (gen !== this.gen) return;
    this.gen++; // ignore any further events from this socket
    this.teardownSocket();
    this.clearTimers();
    if (/unreachable/i.test(message) && this.useWifiBinding) {
      // Android could not find a Wi-Fi network (receiver on USB/ethernet or phone hotspot): try unbound.
      this.useWifiBinding = false;
    }
    if (!this.running) return;
    const delay = backoffDelay(this.status.attempt, this.o.backoffInitialMs, this.o.backoffMaxMs, this.o.backoffJitter, this.o.random());
    this.setStatus({ state: 'retrying', lastError: message, nextRetryAt: this.o.now() + delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }
}
