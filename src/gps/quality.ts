// Fix quality labels, colors, accuracy formatting and the capture gate rule. Pure (no React).
import type { FixQuality, GeoFix } from '@/domain/types';
import { qualityOf } from '@/geo/averaging';
import { colors } from '@/theme';

import { isInferredQuality, type SourceStatus } from './positionSource';

export type Units = 'imperial' | 'metric';

const FEET_PER_METER = 3.280839895;

export function fixQualityLabel(q: FixQuality | null | undefined): string {
  switch (q) {
    case 'rtk_fixed':
      return 'RTK FIX';
    case 'rtk_float':
      return 'RTK FLOAT';
    case 'ppp':
      return 'PPP';
    case 'dgps':
      return 'DGPS';
    case 'gps':
      return 'GPS';
    case 'estimated':
      return 'ESTIMATED';
    case 'manual':
      return 'MANUAL';
    default:
      return 'NO FIX';
  }
}

/** RTK FIX green, RTK FLOAT amber, DGPS/GPS/PPP gray, NO FIX red. */
export function fixQualityColor(q: FixQuality | null | undefined): string {
  switch (q) {
    case 'rtk_fixed':
      return colors.success;
    case 'rtk_float':
      return colors.warning;
    case 'none':
    case null:
    case undefined:
      return colors.danger;
    default:
      return colors.textMuted;
  }
}

/**
 * Accuracy with survey-friendly resolution: metric shows cm under 1 m ("± 1.4 cm", "± 32 cm"),
 * imperial shows hundredths of a foot under 1 ft ("± 0.05 ft").
 */
export function formatPreciseAccuracy(m: number | null | undefined, units: Units): string {
  if (m == null || !Number.isFinite(m)) return '--';
  if (units === 'metric') {
    if (m < 1) {
      const cm = m * 100;
      return `± ${cm < 10 ? cm.toFixed(1) : Math.round(cm)} cm`;
    }
    return `± ${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
  }
  const ft = m * FEET_PER_METER;
  if (ft < 1) return `± ${ft.toFixed(2)} ft`;
  return `± ${ft < 10 ? ft.toFixed(1) : Math.round(ft)} ft`;
}

/** Height for display: "1.80 m" / "5.91 ft". */
export function formatHeight(m: number | null | undefined, units: Units): string {
  if (m == null || !Number.isFinite(m)) return '--';
  return units === 'metric' ? `${m.toFixed(2)} m` : `${(m * FEET_PER_METER).toFixed(2)} ft`;
}

export function metersToDisplayHeight(m: number | null | undefined, units: Units): string {
  if (m == null || !Number.isFinite(m)) return '';
  const v = units === 'metric' ? m : m * FEET_PER_METER;
  return String(Math.round(v * 1000) / 1000);
}

/** Parses an antenna height typed in the user's units. Empty -> null. Invalid -> undefined. */
export function displayHeightToMeters(text: string, units: Units): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0 || v > 100) return undefined;
  return units === 'metric' ? v : v / FEET_PER_METER;
}

// ---------------------------------------------------------------------------------------------
// Capture gate

export interface FixGateResult {
  /** True when capture may proceed without a warning. */
  ok: boolean;
  /** Plain-language reason when not ok. */
  reason: string | null;
  /** True when settings.requireRtkFixed is on. */
  required: boolean;
}

export function evaluateFixGate(
  fix: GeoFix | null | undefined,
  requireRtkFixed: boolean | null | undefined,
  sourceStatus?: SourceStatus | null,
): FixGateResult {
  if (!requireRtkFixed) return { ok: true, reason: null, required: false };
  if (sourceStatus === 'stale') return { ok: false, reason: 'Receiver stopped sending positions.', required: true };
  if (!fix) return { ok: false, reason: 'No position yet. Waiting for RTK FIX.', required: true };
  const q = qualityOf(fix);
  if (q === 'rtk_fixed') return { ok: true, reason: null, required: true };
  if (q === 'rtk_float') return { ok: false, reason: 'RTK FLOAT, not fixed yet. Wait for RTK FIX or shoot anyway.', required: true };
  if (q === 'none') return { ok: false, reason: 'Receiver has no position fix.', required: true };
  if (fix.source !== 'external' && q === 'gps' && !isInferredQuality(fix)) {
    return { ok: false, reason: 'Phone GPS only, no RTK receiver position. Check the receiver connection or shoot anyway.', required: true };
  }
  return { ok: false, reason: `${fixQualityLabel(q)}, not RTK fixed. Wait for RTK FIX or shoot anyway.`, required: true };
}
