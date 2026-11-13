// Display formatting for the dashboard (US English, feet).
import { relativeTime } from '@/components/format';
import { FEET_PER_MILE, groupThousands } from '@/geo';

export { relativeTime };

/** "12,340" (feet, no unit). */
export const ft = (n: number) => groupThousands(n);

/** "12,340 ft" or "2.34 mi" above a mile. */
export function ftOrMiles(n: number): { value: string; unit: string } {
  if (Math.abs(n) >= FEET_PER_MILE) return { value: (n / FEET_PER_MILE).toFixed(n >= 10 * FEET_PER_MILE ? 1 : 2), unit: 'mi' };
  return { value: groupThousands(n), unit: 'ft' };
}

export function usd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '--';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return '--';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '--';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export const count = (n: number) => groupThousands(n);
