// NMEA 0183 parsing for external GNSS receivers (Emlid Reach, Trimble, Bad Elf, Eos, u-blox based kits).
//
// Pure TypeScript, no React Native imports, so it runs in jest and in a plain Node TCP test.
//
// Supported sentences: GGA, RMC, GST, GSA, GNS with any two-letter talker (GP, GN, GL, GA, GB, BD, GQ, GI).
// Every sentence must carry a valid "*hh" checksum unless requireChecksum is turned off.
//
// Accuracy model (GeoFix.accuracyM):
// - When a recent GST is available: DRMS = sqrt(sigmaLat^2 + sigmaLon^2). DRMS is the radius that
//   contains roughly 63 to 68 percent of positions, the same meaning as the "accuracy" phones report.
// - Otherwise: HDOP x UERE, where UERE (user equivalent range error, meters) depends on the fix
//   quality. See UERE_BY_QUALITY. These are conservative typical values, not guarantees.
//
// Altitude model:
// - GGA/GNS altitude is orthometric (height above mean sea level / geoid) of the ANTENNA.
// - Ellipsoid height = orthometric + geoid separation (reported for the status panel).
// - GeoFix.altitudeM = orthometric - antennaHeightM, i.e. ground elevation above mean sea level.
import type { FixQuality, GeoFix } from '@/domain/types';
import { QUALITY_RANK } from '@/geo/averaging';

// ---------------------------------------------------------------------------------------------
// Low-level helpers

/** XOR of every character between '$' and '*', as two uppercase hex digits. */
export function nmeaChecksum(body: string): string {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i) & 0xff;
  return x.toString(16).toUpperCase().padStart(2, '0');
}

/** Appends "*hh" to a sentence body that starts with '$' (handy for tests and simulators). */
export function withChecksum(sentenceWithoutChecksum: string): string {
  const s = sentenceWithoutChecksum.startsWith('$') ? sentenceWithoutChecksum : `$${sentenceWithoutChecksum}`;
  return `${s}*${nmeaChecksum(s.slice(1))}`;
}

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function int(s: string | undefined): number | null {
  const v = num(s);
  return v == null ? null : Math.trunc(v);
}

/** "123519.00" -> seconds of day (UTC). */
export function parseNmeaTime(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (h > 23 || min > 59 || sec >= 61) return null;
  return h * 3600 + min * 60 + sec;
}

/** "4807.038","N" -> 48.1173. Works for ddmm.mmmm (lat) and dddmm.mmmm (lng). */
export function parseNmeaCoord(value: string | undefined, hemi: string | undefined, isLat: boolean): number | null {
  if (!value || !hemi) return null;
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const dot = v.indexOf('.');
  const intLen = dot === -1 ? v.length : dot;
  if (intLen < 3) return null;
  const deg = Number(v.slice(0, intLen - 2));
  const min = Number(v.slice(intLen - 2));
  if (!Number.isFinite(deg) || !Number.isFinite(min) || min >= 60) return null;
  let out = deg + min / 60;
  const h = hemi.trim().toUpperCase();
  if (isLat) {
    if (h !== 'N' && h !== 'S') return null;
    if (out > 90) return null;
    if (h === 'S') out = -out;
  } else {
    if (h !== 'E' && h !== 'W') return null;
    if (out > 180) return null;
    if (h === 'W') out = -out;
  }
  return out;
}

/** GGA quality indicator -> FixQuality. */
export function ggaQualityToFixQuality(code: number | null): FixQuality {
  switch (code) {
    case null:
    case 0:
      return 'none';
    case 1:
      return 'gps';
    case 2:
      return 'dgps';
    case 3:
      return 'gps'; // PPS fix
    case 4:
      return 'rtk_fixed';
    case 5:
      return 'rtk_float';
    case 6:
      return 'estimated'; // dead reckoning
    case 7:
      return 'manual'; // manual input mode
    case 8:
      return 'estimated'; // simulator mode: never survey grade
    case 9:
      return 'dgps'; // SBAS / WAAS on some vendors
    default:
      return 'gps';
  }
}

/** One NMEA 2.3+/4.x mode indicator letter -> FixQuality. */
export function modeLetterToFixQuality(c: string): FixQuality {
  switch (c.toUpperCase()) {
    case 'R':
      return 'rtk_fixed';
    case 'F':
      return 'rtk_float';
    case 'P':
      return 'ppp';
    case 'D':
      return 'dgps';
    case 'A':
      return 'gps';
    case 'E':
      return 'estimated';
    case 'M':
      return 'manual';
    default:
      return 'none'; // N (no fix), S (simulator), unknown
  }
}

/** Relative rank of fix quality classes, higher is better (shared with averaging). */
export const FIX_QUALITY_RANK = QUALITY_RANK;

/** GNS mode string has one letter per constellation ("RRNN"): the best one wins. */
export function modeStringToFixQuality(mode: string | undefined): FixQuality {
  if (!mode) return 'none';
  let best: FixQuality = 'none';
  for (const c of mode.trim()) {
    const q = modeLetterToFixQuality(c);
    if (FIX_QUALITY_RANK[q] > FIX_QUALITY_RANK[best]) best = q;
  }
  return best;
}

/**
 * User equivalent range error per fix quality, meters. Horizontal accuracy estimate = HDOP x UERE.
 * Used only when the receiver does not send GST.
 * - gps 4.0: standalone single-frequency code solution.
 * - dgps 1.0: SBAS/beacon differential, typically 0.5 to 1.5 m.
 * - ppp 0.1: converged precise point positioning.
 * - rtk_float 0.3: ambiguities not resolved, typically 0.1 to 1 m.
 * - rtk_fixed 0.015: ambiguities fixed, 1 to 2 cm horizontal on a good baseline.
 * - estimated 10: dead reckoning or simulated.
 */
export const UERE_BY_QUALITY: Record<FixQuality, number | null> = {
  rtk_fixed: 0.015,
  rtk_float: 0.3,
  ppp: 0.1,
  dgps: 1.0,
  gps: 4.0,
  estimated: 10,
  manual: null,
  none: null,
};

/** HDOP assumed when the receiver does not report one. */
export const DEFAULT_HDOP = 1.5;

/** Horizontal accuracy estimate (m) from HDOP and fix quality. Null when the quality has no meaningful accuracy. */
export function estimateAccuracyFromHdop(hdop: number | null | undefined, quality: FixQuality): number | null {
  const uere = UERE_BY_QUALITY[quality];
  if (uere == null) return null;
  const h = hdop != null && Number.isFinite(hdop) && hdop > 0 ? hdop : DEFAULT_HDOP;
  return h * uere;
}

/** DRMS horizontal accuracy from GST sigmas. */
export function accuracyFromGst(sigmaLatM: number | null, sigmaLonM: number | null): number | null {
  if (sigmaLatM == null || sigmaLonM == null) return null;
  if (!Number.isFinite(sigmaLatM) || !Number.isFinite(sigmaLonM) || sigmaLatM < 0 || sigmaLonM < 0) return null;
  return Math.sqrt(sigmaLatM * sigmaLatM + sigmaLonM * sigmaLonM);
}

// ---------------------------------------------------------------------------------------------
// Sentence types

interface NmeaBase {
  /** Two-letter talker ID: GP, GN, GL, GA, GB, BD, GQ, GI ... */
  talker: string;
  raw: string;
}

export interface GgaSentence extends NmeaBase {
  type: 'GGA';
  utcSeconds: number | null;
  lat: number | null;
  lng: number | null;
  qualityCode: number | null;
  fixQuality: FixQuality;
  satellites: number | null;
  hdop: number | null;
  /** Antenna height above mean sea level (orthometric), meters. */
  altitudeMslM: number | null;
  /** Geoid separation (ellipsoid minus geoid), meters. */
  geoidSeparationM: number | null;
  /** Age of differential corrections, seconds. */
  diffAgeS: number | null;
  diffStationId: string | null;
}

export interface RmcSentence extends NmeaBase {
  type: 'RMC';
  utcSeconds: number | null;
  /** UTC date when present. */
  date: { y: number; m: number; d: number } | null;
  valid: boolean;
  lat: number | null;
  lng: number | null;
  speedKnots: number | null;
  courseDeg: number | null;
  modeIndicator: string | null;
  fixQuality: FixQuality;
}

export interface GstSentence extends NmeaBase {
  type: 'GST';
  utcSeconds: number | null;
  rmsM: number | null;
  sigmaMajorM: number | null;
  sigmaMinorM: number | null;
  orientationDeg: number | null;
  sigmaLatM: number | null;
  sigmaLonM: number | null;
  sigmaAltM: number | null;
}

export interface GsaSentence extends NmeaBase {
  type: 'GSA';
  selectionMode: string | null;
  /** 1 no fix, 2 = 2D, 3 = 3D. */
  fixType: number | null;
  satelliteIds: number[];
  pdop: number | null;
  hdop: number | null;
  vdop: number | null;
  /** NMEA 4.1 GNSS system id (1 GPS, 2 GLONASS, 3 Galileo, 4 BeiDou). */
  systemId: number | null;
}

export interface GnsSentence extends NmeaBase {
  type: 'GNS';
  utcSeconds: number | null;
  lat: number | null;
  lng: number | null;
  modeIndicator: string;
  fixQuality: FixQuality;
  satellites: number | null;
  hdop: number | null;
  altitudeMslM: number | null;
  geoidSeparationM: number | null;
  diffAgeS: number | null;
  diffStationId: string | null;
  navStatus: string | null;
}

export type NmeaSentence = GgaSentence | RmcSentence | GstSentence | GsaSentence | GnsSentence;

export type NmeaParseFailure =
  | 'empty'
  | 'no_start'
  | 'missing_checksum'
  | 'checksum'
  | 'unsupported'
  | 'malformed';

export type NmeaParseResult =
  | { ok: true; sentence: NmeaSentence }
  | { ok: false; reason: NmeaParseFailure; talker?: string; type?: string; raw: string };

export interface NmeaParseOptions {
  /** Reject sentences without "*hh". Default true. */
  requireChecksum?: boolean;
}

const SUPPORTED = new Set(['GGA', 'RMC', 'GST', 'GSA', 'GNS']);

/**
 * Parses one NMEA sentence. Leading junk before '$' and trailing CR/LF/whitespace are ignored.
 * Returns ok:false with a reason for empty, checksum failures, unsupported and malformed sentences.
 * A sentence that is 'unsupported' still had a valid checksum (the stream is alive).
 */
export function parseNmea(line: string, opts: NmeaParseOptions = {}): NmeaParseResult {
  const requireChecksum = opts.requireChecksum !== false;
  const trimmed = (line ?? '').replace(/[\r\n\0]+/g, '').trim();
  if (!trimmed) return { ok: false, reason: 'empty', raw: trimmed };
  const start = trimmed.lastIndexOf('$');
  if (start === -1) return { ok: false, reason: 'no_start', raw: trimmed };
  let s = trimmed.slice(start);
  const star = s.indexOf('*');
  let body: string;
  if (star === -1) {
    if (requireChecksum) return { ok: false, reason: 'missing_checksum', raw: s };
    body = s.slice(1);
  } else {
    body = s.slice(1, star);
    const given = s.slice(star + 1, star + 3).toUpperCase();
    if (!/^[0-9A-F]{2}$/.test(given)) return { ok: false, reason: 'checksum', raw: s };
    if (given !== nmeaChecksum(body)) return { ok: false, reason: 'checksum', raw: s };
    s = s.slice(0, star + 3);
  }
  const fields = body.split(',');
  const address = fields[0] ?? '';
  if (address.length < 5 || address.startsWith('P')) {
    // Proprietary ($PUBX, $PTNL ...) or garbage: valid checksum, not ours.
    return { ok: false, reason: 'unsupported', type: address, raw: s };
  }
  const talker = address.slice(0, 2);
  const type = address.slice(2, 5);
  if (!SUPPORTED.has(type)) return { ok: false, reason: 'unsupported', talker, type, raw: s };
  const f = fields.slice(1);
  try {
    const sentence = parseFields(type, talker, f, s);
    if (!sentence) return { ok: false, reason: 'malformed', talker, type, raw: s };
    return { ok: true, sentence };
  } catch {
    return { ok: false, reason: 'malformed', talker, type, raw: s };
  }
}

function parseFields(type: string, talker: string, f: string[], raw: string): NmeaSentence | null {
  switch (type) {
    case 'GGA': {
      // 0 time,1 lat,2 N/S,3 lon,4 E/W,5 quality,6 sats,7 hdop,8 alt,9 M,10 sep,11 M,12 age,13 station
      if (f.length < 9) return null;
      const qualityCode = int(f[5]);
      const lat = parseNmeaCoord(f[1], f[2], true);
      const lng = parseNmeaCoord(f[3], f[4], false);
      return {
        type: 'GGA',
        talker,
        raw,
        utcSeconds: parseNmeaTime(f[0]),
        lat,
        lng,
        qualityCode,
        fixQuality: lat == null || lng == null ? 'none' : ggaQualityToFixQuality(qualityCode),
        satellites: int(f[6]),
        hdop: num(f[7]),
        altitudeMslM: num(f[8]),
        geoidSeparationM: num(f[10]),
        diffAgeS: num(f[12]),
        diffStationId: f[13]?.trim() ? f[13].trim() : null,
      };
    }
    case 'RMC': {
      // 0 time,1 status,2 lat,3 N/S,4 lon,5 E/W,6 speed kn,7 course,8 date,9 magvar,10 E/W,11 mode,12 nav status
      if (f.length < 9) return null;
      const valid = (f[1] ?? '').trim().toUpperCase() === 'A';
      const lat = parseNmeaCoord(f[2], f[3], true);
      const lng = parseNmeaCoord(f[4], f[5], false);
      const mode = f[11]?.trim() ? f[11].trim().slice(0, 1) : null;
      let date: RmcSentence['date'] = null;
      const dm = /^(\d{2})(\d{2})(\d{2})$/.exec((f[8] ?? '').trim());
      if (dm) date = { d: Number(dm[1]), m: Number(dm[2]), y: 2000 + Number(dm[3]) };
      let fixQuality: FixQuality = 'none';
      if (valid && lat != null && lng != null) fixQuality = mode ? modeLetterToFixQuality(mode) : 'gps';
      return {
        type: 'RMC',
        talker,
        raw,
        utcSeconds: parseNmeaTime(f[0]),
        date,
        valid,
        lat,
        lng,
        speedKnots: num(f[6]),
        courseDeg: num(f[7]),
        modeIndicator: mode,
        fixQuality,
      };
    }
    case 'GST': {
      // 0 time,1 rms,2 sigma major,3 sigma minor,4 orientation,5 sigma lat,6 sigma lon,7 sigma alt
      if (f.length < 8) return null;
      return {
        type: 'GST',
        talker,
        raw,
        utcSeconds: parseNmeaTime(f[0]),
        rmsM: num(f[1]),
        sigmaMajorM: num(f[2]),
        sigmaMinorM: num(f[3]),
        orientationDeg: num(f[4]),
        sigmaLatM: num(f[5]),
        sigmaLonM: num(f[6]),
        sigmaAltM: num(f[7]),
      };
    }
    case 'GSA': {
      // 0 mode M/A,1 fix type,2..13 sat ids,14 pdop,15 hdop,16 vdop,17 system id (4.1)
      if (f.length < 17) return null;
      const ids: number[] = [];
      for (let i = 2; i <= 13; i++) {
        const v = int(f[i]);
        if (v != null) ids.push(v);
      }
      return {
        type: 'GSA',
        talker,
        raw,
        selectionMode: f[0]?.trim() || null,
        fixType: int(f[1]),
        satelliteIds: ids,
        pdop: num(f[14]),
        hdop: num(f[15]),
        vdop: num(f[16]),
        systemId: int(f[17]),
      };
    }
    case 'GNS': {
      // 0 time,1 lat,2 N/S,3 lon,4 E/W,5 mode,6 sats,7 hdop,8 alt,9 sep,10 age,11 station,12 nav status
      if (f.length < 10) return null;
      const lat = parseNmeaCoord(f[1], f[2], true);
      const lng = parseNmeaCoord(f[3], f[4], false);
      const mode = (f[5] ?? '').trim();
      return {
        type: 'GNS',
        talker,
        raw,
        utcSeconds: parseNmeaTime(f[0]),
        lat,
        lng,
        modeIndicator: mode,
        fixQuality: lat == null || lng == null ? 'none' : modeStringToFixQuality(mode),
        satellites: int(f[6]),
        hdop: num(f[7]),
        altitudeMslM: num(f[8]),
        geoidSeparationM: num(f[9]),
        diffAgeS: num(f[10]),
        diffStationId: f[11]?.trim() ? f[11].trim() : null,
        navStatus: f[12]?.trim() ? f[12].trim() : null,
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Line buffering across TCP chunks

/**
 * Splits a byte stream into NMEA lines. TCP delivers arbitrary chunks: a sentence can be split
 * across chunks, and several sentences can arrive in one chunk. Handles CRLF, LF and lone CR, and
 * two sentences glued together without a line break. Binary junk (RTCM/UBX mixed into the stream)
 * is dropped: only text starting at '$' is returned.
 */
export class NmeaLineBuffer {
  private buf = '';

  constructor(private readonly maxLineLength = 1024) {}

  push(chunk: string): string[] {
    if (!chunk) return [];
    this.buf += chunk;
    const out: string[] = [];
    const parts = this.buf.split(/\r\n|\n|\r/);
    this.buf = parts.pop() ?? '';
    for (const p of parts) out.push(...splitSentences(p));
    if (this.buf.length > this.maxLineLength) {
      // A runaway line without a terminator (binary data, wrong baud). Keep only the last '$' onwards.
      const i = this.buf.lastIndexOf('$');
      this.buf = i > 0 && this.buf.length - i <= this.maxLineLength ? this.buf.slice(i) : '';
    }
    return out;
  }

  /** Text received but not yet terminated by a line break. */
  get pending(): string {
    return this.buf;
  }

  reset(): void {
    this.buf = '';
  }
}

function splitSentences(line: string): string[] {
  if (!line.includes('$')) return [];
  const out: string[] = [];
  const pieces = line.split('$');
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i].trim();
    if (p) out.push(`$${p}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Assembling sentences into position fixes

export interface NmeaAssemblerOptions {
  /** Antenna height above the ground mark, meters. Subtracted from the orthometric altitude. */
  antennaHeightM?: number | null;
  /** Label stored in GeoFix.receiver. */
  receiverName?: string | null;
  /** A GST/GSA older than this is ignored, ms. Default 2500. */
  maxAuxAgeMs?: number;
  /** GNS/RMC only produce fixes when no GGA arrived in this long, ms. Default 2500. */
  primaryHoldMs?: number;
}

export interface ReceiverSnapshot {
  fixQuality: FixQuality;
  /** Raw GGA quality code when known. */
  qualityCode: number | null;
  satellites: number | null;
  hdop: number | null;
  pdop: number | null;
  vdop: number | null;
  sigmaLatM: number | null;
  sigmaLonM: number | null;
  sigmaAltM: number | null;
  accuracyM: number | null;
  accuracySource: 'gst' | 'hdop' | null;
  /** Antenna orthometric height (above mean sea level). */
  altitudeMslM: number | null;
  /** Ground orthometric height (antenna minus antenna height). */
  groundAltitudeM: number | null;
  ellipsoidHeightM: number | null;
  geoidSeparationM: number | null;
  diffAgeS: number | null;
  diffStationId: string | null;
  talker: string | null;
  lastType: string | null;
  utcSeconds: number | null;
}

const EMPTY_SNAPSHOT: ReceiverSnapshot = {
  fixQuality: 'none',
  qualityCode: null,
  satellites: null,
  hdop: null,
  pdop: null,
  vdop: null,
  sigmaLatM: null,
  sigmaLonM: null,
  sigmaAltM: null,
  accuracyM: null,
  accuracySource: null,
  altitudeMslM: null,
  groundAltitudeM: null,
  ellipsoidHeightM: null,
  geoidSeparationM: null,
  diffAgeS: null,
  diffStationId: null,
  talker: null,
  lastType: null,
  utcSeconds: null,
};

/**
 * Combines GGA (or GNS/RMC fallback), GST and GSA into GeoFix updates. GGA is the primary epoch
 * sentence; GNS is used when a receiver sends GNS instead of GGA, and RMC as a last resort.
 * Fixes with quality 'none' are never emitted (the snapshot still updates so the UI can show NO FIX).
 */
export class NmeaFixAssembler {
  private opts: Required<NmeaAssemblerOptions>;
  private snap: ReceiverSnapshot = { ...EMPTY_SNAPSHOT };
  private lastGst: { s: GstSentence; at: number } | null = null;
  private lastGsa: { s: GsaSentence; at: number } | null = null;
  private lastGgaAt = -Infinity;
  private lastGnsAt = -Infinity;

  constructor(opts: NmeaAssemblerOptions = {}) {
    this.opts = {
      antennaHeightM: opts.antennaHeightM ?? null,
      receiverName: opts.receiverName ?? null,
      maxAuxAgeMs: opts.maxAuxAgeMs ?? 2500,
      primaryHoldMs: opts.primaryHoldMs ?? 2500,
    };
  }

  setOptions(patch: NmeaAssemblerOptions): void {
    this.opts = {
      ...this.opts,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    } as Required<NmeaAssemblerOptions>;
  }

  get snapshot(): ReceiverSnapshot {
    return this.snap;
  }

  reset(): void {
    this.snap = { ...EMPTY_SNAPSHOT };
    this.lastGst = null;
    this.lastGsa = null;
    this.lastGgaAt = -Infinity;
    this.lastGnsAt = -Infinity;
  }

  /** Feeds one parsed sentence. Returns a GeoFix when this sentence completes a usable position. */
  push(s: NmeaSentence, receivedAtMs: number): GeoFix | null {
    this.snap = { ...this.snap, talker: s.talker, lastType: s.type };
    switch (s.type) {
      case 'GST':
        if (s.sigmaLatM != null && s.sigmaLonM != null) this.lastGst = { s, at: receivedAtMs };
        this.snap = { ...this.snap, sigmaLatM: s.sigmaLatM, sigmaLonM: s.sigmaLonM, sigmaAltM: s.sigmaAltM };
        return null;
      case 'GSA':
        this.lastGsa = { s, at: receivedAtMs };
        this.snap = { ...this.snap, pdop: s.pdop, vdop: s.vdop, hdop: this.snap.hdop ?? s.hdop };
        return null;
      case 'GGA':
        this.lastGgaAt = receivedAtMs;
        return this.positionEpoch(s, receivedAtMs);
      case 'GNS':
        this.lastGnsAt = receivedAtMs;
        if (receivedAtMs - this.lastGgaAt < this.opts.primaryHoldMs) return null;
        return this.positionEpoch(s, receivedAtMs);
      case 'RMC':
        if (receivedAtMs - Math.max(this.lastGgaAt, this.lastGnsAt) < this.opts.primaryHoldMs) return null;
        return this.positionEpoch(s, receivedAtMs);
      default:
        return null;
    }
  }

  private recentGst(at: number): GstSentence | null {
    if (!this.lastGst || at - this.lastGst.at > this.opts.maxAuxAgeMs) return null;
    return this.lastGst.s;
  }

  private recentGsa(at: number): GsaSentence | null {
    if (!this.lastGsa || at - this.lastGsa.at > this.opts.maxAuxAgeMs) return null;
    return this.lastGsa.s;
  }

  private positionEpoch(s: GgaSentence | GnsSentence | RmcSentence, at: number): GeoFix | null {
    const quality = s.fixQuality;
    const gsa = this.recentGsa(at);
    const gst = this.recentGst(at);
    const hdop = s.type === 'RMC' ? gsa?.hdop ?? null : s.hdop ?? gsa?.hdop ?? null;
    const satellites = s.type === 'RMC' ? (gsa ? gsa.satelliteIds.length || null : null) : s.satellites;
    const altitudeMslM = s.type === 'RMC' ? null : s.altitudeMslM;
    const geoidSeparationM = s.type === 'RMC' ? null : s.geoidSeparationM;
    const antenna = this.opts.antennaHeightM ?? 0;
    const groundAltitudeM = altitudeMslM != null ? altitudeMslM - (Number.isFinite(antenna) ? antenna : 0) : null;
    const ellipsoidHeightM = altitudeMslM != null && geoidSeparationM != null ? altitudeMslM + geoidSeparationM : null;

    let accuracyM: number | null = null;
    let accuracySource: ReceiverSnapshot['accuracySource'] = null;
    if (quality !== 'none') {
      const fromGst = gst ? accuracyFromGst(gst.sigmaLatM, gst.sigmaLonM) : null;
      if (fromGst != null) {
        accuracyM = fromGst;
        accuracySource = 'gst';
      } else {
        accuracyM = estimateAccuracyFromHdop(hdop, quality);
        accuracySource = accuracyM != null ? 'hdop' : null;
      }
    }

    this.snap = {
      ...this.snap,
      fixQuality: quality,
      qualityCode: s.type === 'GGA' ? s.qualityCode : null,
      satellites,
      hdop,
      accuracyM,
      accuracySource,
      altitudeMslM,
      groundAltitudeM,
      ellipsoidHeightM,
      geoidSeparationM,
      diffAgeS: s.type === 'RMC' ? null : s.diffAgeS,
      diffStationId: s.type === 'RMC' ? null : s.diffStationId,
      utcSeconds: s.utcSeconds,
    };

    if (quality === 'none' || s.lat == null || s.lng == null) return null;
    return {
      lat: s.lat,
      lng: s.lng,
      accuracyM,
      altitudeM: groundAltitudeM,
      samples: 1,
      capturedAt: new Date(at).toISOString(),
      source: 'external',
      fixQuality: quality,
      hdop,
      satellites,
      receiver: this.opts.receiverName,
    };
  }
}
