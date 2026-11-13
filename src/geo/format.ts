import { FEET_PER_MILE, feetToMeters } from './distance';

/** Integer with thousands separators ("6,600"). Does not depend on Intl (Hermes builds vary). */
export function groupThousands(n: number): string {
  const r = Math.round(n);
  const sign = r < 0 ? '-' : '';
  return sign + String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Human length from feet.
 * Imperial: "245 ft", "1,320 ft"; above one mile "1.25 mi (6,600 ft)".
 * Metric: "74.7 m"; at 1 km and above "1.23 km (1,234 m)".
 */
export function formatLength(ft: number, units: 'imperial' | 'metric'): string {
  if (!Number.isFinite(ft)) return '--';
  if (units === 'metric') {
    const m = feetToMeters(ft);
    if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(2)} km (${groupThousands(m)} m)`;
    return `${m.toFixed(1)} m`;
  }
  if (Math.abs(ft) > FEET_PER_MILE) {
    return `${(ft / FEET_PER_MILE).toFixed(2)} mi (${groupThousands(ft)} ft)`;
  }
  return `${groupThousands(ft)} ft`;
}
