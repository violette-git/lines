import type { FixQuality, GeoFix } from '@/domain/types';

import { metersPerDegree } from './distance';

/** Accuracy assumed for samples that report none, meters. */
const DEFAULT_ACCURACY_M = 15;
/** Never let a single sample claim better than this (avoids divide-by-zero weights). */
const MIN_ACCURACY_M = 0.5;
/** Samples farther than this multiple of the median distance from the median point are dropped. */
const OUTLIER_FACTOR = 2.5;
/** Floor for the median distance so near-identical samples do not make every tiny jitter an outlier. */
const MIN_MEDIAN_DIST_M = 0.5;

/** Relative rank of fix quality classes, higher is better. */
export const QUALITY_RANK: Record<FixQuality, number> = {
  rtk_fixed: 7,
  rtk_float: 6,
  ppp: 5,
  dgps: 4,
  gps: 3,
  estimated: 2,
  manual: 1,
  none: 0,
};

/** Classes whose accuracy is centimeter to decimeter level: smaller floors and finer rounding. */
const PRECISE: ReadonlySet<FixQuality> = new Set<FixQuality>(['rtk_fixed', 'rtk_float', 'ppp']);

/** Per-class accuracy floor (m) for weighting. Phone-grade classes keep the original 0.5 m floor. */
function minAccuracyFor(q: FixQuality): number {
  if (q === 'rtk_fixed') return 0.005;
  if (q === 'rtk_float' || q === 'ppp') return 0.02;
  return MIN_ACCURACY_M;
}

/** Per-class floor for the outlier median distance (m). */
function minMedianDistFor(q: FixQuality): number {
  if (q === 'rtk_fixed') return 0.02;
  if (q === 'rtk_float' || q === 'ppp') return 0.1;
  return MIN_MEDIAN_DIST_M;
}

/** Quality class of a sample. Samples without fixQuality (phone GPS, legacy data) count as 'gps'. */
export function qualityOf(f: Pick<GeoFix, 'fixQuality' | 'source'>): FixQuality {
  if (f.fixQuality) return f.fixQuality;
  return f.source === 'manual' ? 'manual' : 'gps';
}

/**
 * "Best quality in window" rule: returns only the samples of the highest quality class present.
 * With any RTK fixed sample in the window, float/DGPS/standalone samples are never averaged in.
 */
export function selectBestQuality<T extends Pick<GeoFix, 'fixQuality' | 'source'>>(samples: T[]): { quality: FixQuality; samples: T[] } {
  let best: FixQuality = 'none';
  let bestRank = -1;
  for (const s of samples) {
    const q = qualityOf(s);
    if (QUALITY_RANK[q] > bestRank) {
      best = q;
      bestRank = QUALITY_RANK[q];
    }
  }
  return { quality: best, samples: samples.filter((s) => qualityOf(s) === best) };
}

export interface AverageOptions {
  /** Apply the best-quality-in-window rule before averaging. Default true. */
  bestQualityOnly?: boolean;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sampleAccuracy(f: GeoFix, minAcc = MIN_ACCURACY_M): number {
  const a = f.accuracyM;
  return a != null && Number.isFinite(a) && a > 0 ? Math.max(a, minAcc) : DEFAULT_ACCURACY_M;
}

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** Rounds to a multiple of step without binary noise (0.7, not 0.7000000000000001). */
const round = (v: number, step: number) => {
  const decimals = step >= 1 ? 0 : Math.round(-Math.log10(step));
  return Number((Math.round(v / step) * step).toFixed(decimals));
};

/**
 * Combines several GPS readings into one fix.
 *
 * 0. Best quality in window (default): only samples of the highest fix quality class are used, so an
 *    RTK fixed window never mixes in float or standalone readings. Samples without fixQuality count
 *    as 'gps', so phone-only windows behave exactly as before.
 * 1. With 4 or more samples, drops outliers farther than 2.5x the median distance from the
 *    component-wise median point.
 * 2. Weighted mean with weights 1/accuracy^2.
 * 3. Combined accuracy: the larger of the formal weighted error 1/sqrt(sum w), the observed
 *    scatter divided by sqrt(n), and half the best single accuracy. GPS errors over a few seconds
 *    are strongly correlated, so the formal value alone is far too optimistic; the floor keeps the
 *    reported accuracy honest.
 */
export function averageFixes(samples: GeoFix[], opts: AverageOptions = {}): GeoFix {
  let valid = samples.filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (valid.length === 0) throw new Error('averageFixes: no valid samples');
  const best = selectBestQuality(valid);
  if (opts.bestQualityOnly !== false) valid = best.samples;
  const cls = best.quality;
  const minAcc = minAccuracyFor(cls);
  const precise = PRECISE.has(cls);
  if (valid.length === 1) {
    const only = valid[0];
    const source: GeoFix['source'] = only.source === 'gps_avg' || only.source === 'external' ? only.source : 'gps';
    return { ...only, samples: 1, source };
  }

  // Local planar frame around the first sample, meters.
  const origin = valid[0];
  const m = metersPerDegree(origin.lat);
  const xy = valid.map((f) => ({ f, x: (f.lng - origin.lng) * m.lng, y: (f.lat - origin.lat) * m.lat }));

  let kept = xy;
  if (xy.length >= 4) {
    const mx = median(xy.map((p) => p.x));
    const my = median(xy.map((p) => p.y));
    const dists = xy.map((p) => Math.hypot(p.x - mx, p.y - my));
    const limit = OUTLIER_FACTOR * Math.max(median(dists), minMedianDistFor(cls));
    const filtered = xy.filter((_, i) => dists[i] <= limit);
    if (filtered.length > 0) kept = filtered;
  }

  let sw = 0;
  let sx = 0;
  let sy = 0;
  let altW = 0;
  let altSum = 0;
  let bestAcc = Infinity;
  let latest = kept[0].f.capturedAt;
  for (const p of kept) {
    const acc = sampleAccuracy(p.f, minAcc);
    const w = 1 / (acc * acc);
    sw += w;
    sx += w * p.x;
    sy += w * p.y;
    if (p.f.altitudeM != null && Number.isFinite(p.f.altitudeM)) {
      altW += w;
      altSum += w * p.f.altitudeM;
    }
    if (acc < bestAcc) bestAcc = acc;
    if (p.f.capturedAt > latest) latest = p.f.capturedAt;
  }
  const cx = sx / sw;
  const cy = sy / sw;

  let scatter = 0;
  for (const p of kept) {
    const acc = sampleAccuracy(p.f, minAcc);
    scatter += ((p.x - cx) ** 2 + (p.y - cy) ** 2) / (acc * acc);
  }
  const rmsScatter = Math.sqrt(scatter / sw);
  const formal = 1 / Math.sqrt(sw);
  const accuracyM = Math.max(formal, rmsScatter / Math.sqrt(kept.length), bestAcc / 2);

  const step = precise ? 0.001 : 0.1;
  const out: GeoFix = {
    lat: origin.lat + cy / m.lat,
    lng: origin.lng + cx / m.lng,
    accuracyM: round(accuracyM, step),
    altitudeM: altW > 0 ? round(altSum / altW, step) : null,
    samples: kept.length,
    capturedAt: latest,
    source: kept.every((p) => p.f.source === 'external') ? 'external' : 'gps_avg',
  };

  // Carry receiver metadata only when the inputs had it, so phone-only results keep their old shape.
  const fs = kept.map((p) => p.f);
  if (fs.some((f) => f.fixQuality != null)) out.fixQuality = cls;
  const hdops = fs.map((f) => f.hdop).filter((v): v is number => v != null && Number.isFinite(v));
  if (hdops.length) out.hdop = round(median(hdops), 0.1);
  const sats = fs.map((f) => f.satellites).filter((v): v is number => v != null && Number.isFinite(v));
  if (sats.length) out.satellites = Math.min(...sats);
  const receivers = fs.map((f) => f.receiver).filter((v): v is string => !!v);
  if (receivers.length) out.receiver = mostCommon(receivers);
  return out;
}
