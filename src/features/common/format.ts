import { NODE_TYPE_META } from '@/domain/nodeSchemas';
import type { GeoFix, NodeType } from '@/domain/types';
import { groupThousands, metersToFeet } from '@/geo';
import { colors } from '@/theme';

export type Units = 'imperial' | 'metric';

/** "± 9 ft" / "± 2.7 m" / "no GPS" */
export function formatAccuracy(m: number | null | undefined, units: Units): string {
  if (m == null || !Number.isFinite(m)) return 'manual';
  if (units === 'metric') return `± ${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
  const ft = metersToFeet(m);
  return `± ${ft < 10 ? ft.toFixed(1) : Math.round(ft)} ft`;
}

/** Green under 5 m, amber under 15 m, red otherwise. */
export function accuracyColor(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return colors.textMuted;
  if (m < 5) return colors.success;
  if (m < 15) return colors.warning;
  return colors.danger;
}

export function formatMoney(v: number): string {
  const cents = Math.round(v * 100) / 100;
  if (Math.abs(cents) >= 1000) return `$${groupThousands(cents)}`;
  return `$${cents.toFixed(2)}`;
}

export function formatLatLng(v: number): string {
  return Number.isFinite(v) ? v.toFixed(6) : '--';
}

/**
 * How a position was obtained. Pass the fix itself so external receivers show their name
 * ("Emlid Reach RS3"); a bare source string is still accepted.
 */
export function sourceLabel(fix: GeoFix['source'] | Pick<GeoFix, 'source' | 'receiver' | 'fixQuality'>): string {
  const src = typeof fix === 'string' ? fix : fix.source;
  switch (src) {
    case 'gps':
      return 'GPS (single reading)';
    case 'gps_avg':
      return 'GPS (averaged)';
    case 'manual':
      return 'Placed by hand';
    case 'external': {
      if (typeof fix === 'string') return 'External receiver';
      const receiver = fix.receiver?.trim();
      if (receiver) return receiver;
      // Receiver fixes always carry a fix quality; a photo's EXIF position does not.
      return fix.fixQuality != null ? 'External receiver' : 'Photo location (EXIF)';
    }
    default:
      return String(src);
  }
}

export function typeLabel(t: NodeType): string {
  return NODE_TYPE_META[t]?.label ?? t;
}

export function typeColor(t: NodeType): string {
  return NODE_TYPE_META[t]?.color ?? colors.textMuted;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local date/time with UTC offset and zone name when available: "2026-11-12 14:03:22 UTC-06:00 (America/Chicago)". */
export function formatDateTimeWithZone(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const offset = `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    zone = '';
  }
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${offset}`;
  return zone ? `${base} (${zone})` : base;
}
