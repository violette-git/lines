import type { GeoFix } from '@/domain/types';

import { metersPerDegree } from './distance';

/** Accuracy assumed for samples that report none, meters. */
const DEFAULT_ACCURACY_M = 15;
/** Never let a single sample claim better than this (avoids divide-by-zero weights). */
const MIN_ACCURACY_M = 0.5;
/** Samples farther than this multiple of the median distance from the median point are dropped. */
const OUTLIER_FACTOR = 2.5;
/** Floor for the median distance so near-identical samples do not make every tiny jitter an outlier. */
const MIN_MEDIAN_DIST_M = 0.5;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sampleAccuracy(f: GeoFix): number {
  const a = f.accuracyM;
  return a != null && Number.isFinite(a) && a > 0 ? Math.max(a, MIN_ACCURACY_M) : DEFAULT_ACCURACY_M;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Combines several GPS readings into one fix.
 *
 * 1. With 4 or more samples, drops outliers farther than 2.5x the median distance from the
 *    component-wise median point.
 * 2. Weighted mean with weights 1/accuracy^2.
 * 3. Combined accuracy: the larger of the formal weighted error 1/sqrt(sum w), the observed
 *    scatter divided by sqrt(n), and half the best single accuracy. GPS errors over a few seconds
 *    are strongly correlated, so the formal value alone is far too optimistic; the floor keeps the
 *    reported accuracy honest.
 */
export function averageFixes(samples: GeoFix[]): GeoFix {
  const valid = samples.filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (valid.length === 0) throw new Error('averageFixes: no valid samples');
  if (valid.length === 1) {
    const only = valid[0];
    return { ...only, samples: 1, source: only.source === 'gps_avg' ? 'gps_avg' : 'gps' };
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
    const limit = OUTLIER_FACTOR * Math.max(median(dists), MIN_MEDIAN_DIST_M);
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
    const acc = sampleAccuracy(p.f);
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
    const acc = sampleAccuracy(p.f);
    scatter += ((p.x - cx) ** 2 + (p.y - cy) ** 2) / (acc * acc);
  }
  const rmsScatter = Math.sqrt(scatter / sw);
  const formal = 1 / Math.sqrt(sw);
  const accuracyM = Math.max(formal, rmsScatter / Math.sqrt(kept.length), bestAcc / 2);

  return {
    lat: origin.lat + cy / m.lat,
    lng: origin.lng + cx / m.lng,
    accuracyM: round(accuracyM, 0.1),
    altitudeM: altW > 0 ? round(altSum / altW, 0.1) : null,
    samples: kept.length,
    capturedAt: latest,
    source: 'gps_avg',
  };
}
