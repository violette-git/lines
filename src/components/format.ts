// Small display helpers shared by the management screens.
import type { WorkType } from '@/domain/types';
import { colors } from '@/theme';

import type { IconName } from './ui';

export function formatMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '--';
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : 2;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago", or a short date. */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, nowMs - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
}

/** Start of the current week (Monday 00:00 local time) in ms. */
export function startOfWeekMs(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export const WORK_TYPE_META: Record<WorkType, { label: string; icon: IconName; color: string; hint: string }> = {
  aerial: { label: 'Aerial', icon: 'git-commit-outline', color: colors.aerial, hint: 'Cable on poles' },
  underground: { label: 'Underground', icon: 'layers-outline', color: colors.underground, hint: 'Buried conduit, handholes, vaults' },
  mixed: { label: 'Mixed', icon: 'git-merge-outline', color: colors.success, hint: 'Aerial and underground' },
  qc: { label: 'QC audit', icon: 'shield-checkmark-outline', color: colors.info, hint: 'Checking existing plant' },
};

/** Parses a user-typed decimal ("1.25", "$0.80", ""), returning null for empty and NaN for junk. */
export function parseOptionalNumber(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
