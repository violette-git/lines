// Pure data shaping for the dashboard: footage totals, weekly and monthly rollups, quota and seat
// meters, project filtering and activity sentences. No React, no network, fully unit tested.
import type { QcIssue } from '@/domain/contracts';
import type { MapNode, Span, SpanWithLength } from '@/domain/types';
import { computeSpanLengths } from '@/geo';

import type { ActivityEntry, FootageRow, ProjectSummary, UsageRow } from './types';

// ---------- Footage ----------

export interface FootageTotals {
  aerialFt: number;
  undergroundFt: number;
  totalFt: number;
  spanCount: number;
}

export function footageOf(spans: SpanWithLength[]): FootageTotals {
  let aerialFt = 0;
  let undergroundFt = 0;
  for (const s of spans) {
    const ft = Number.isFinite(s.totalFt) ? s.totalFt : 0;
    if (s.kind === 'underground') undergroundFt += ft;
    else aerialFt += ft;
  }
  return { aerialFt, undergroundFt, totalFt: aerialFt + undergroundFt, spanCount: spans.length };
}

/** Footage for raw spans + nodes, using the same math as the phone (geo/computeSpanLengths). */
export function footageFromData(nodes: MapNode[], spans: Span[]): FootageTotals {
  return footageOf(computeSpanLengths(spans, nodes));
}

// ---------- Calendar keys (UTC, weeks start Monday like Postgres date_trunc('week')) ----------

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function weekKey(input: Date | string | number): string {
  const d = new Date(input);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return ymd(monday);
}

export function monthKey(input: Date | string | number): string {
  const d = new Date(input);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}

/** The last n week keys, oldest first, ending with the current week. */
export function lastWeeks(n: number, now: number = Date.now()): string[] {
  const cur = new Date(`${weekKey(now)}T00:00:00Z`).getTime();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(ymd(new Date(cur - i * 7 * 86_400_000)));
  return out;
}

/** The last n month keys, oldest first, ending with the current month. */
export function lastMonths(n: number, now: number = Date.now()): string[] {
  const d = new Date(now);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(ymd(m));
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}
export function weekLabel(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

// ---------- Footage per tech per week ----------

export interface TechWeekly {
  userId: string | null;
  name: string;
  totalFt: number;
  perWeek: { aerialFt: number; undergroundFt: number }[];
}

export interface FootageMatrix {
  weeks: string[];
  techs: TechWeekly[];
  weekTotals: { aerialFt: number; undergroundFt: number }[];
  maxWeekFt: number;
  grandTotalFt: number;
}

export function footageByTechWeek(rows: FootageRow[], weeks: string[]): FootageMatrix {
  const idx = new Map(weeks.map((w, i) => [w, i]));
  const techs = new Map<string, TechWeekly>();
  const weekTotals = weeks.map(() => ({ aerialFt: 0, undergroundFt: 0 }));
  for (const r of rows) {
    const i = idx.get(r.weekStart);
    if (i === undefined) continue;
    const key = r.userId ?? 'unknown';
    let t = techs.get(key);
    if (!t) {
      t = { userId: r.userId, name: r.name || 'Former member', totalFt: 0, perWeek: weeks.map(() => ({ aerialFt: 0, undergroundFt: 0 })) };
      techs.set(key, t);
    }
    const a = Number(r.aerialFt) || 0;
    const u = Number(r.undergroundFt) || 0;
    t.perWeek[i].aerialFt += a;
    t.perWeek[i].undergroundFt += u;
    t.totalFt += a + u;
    weekTotals[i].aerialFt += a;
    weekTotals[i].undergroundFt += u;
  }
  const list = [...techs.values()].sort((x, y) => y.totalFt - x.totalFt || x.name.localeCompare(y.name));
  const maxWeekFt = Math.max(0, ...weekTotals.map((w) => w.aerialFt + w.undergroundFt));
  const grandTotalFt = weekTotals.reduce((s, w) => s + w.aerialFt + w.undergroundFt, 0);
  return { weeks, techs: list, weekTotals, maxWeekFt, grandTotalFt };
}

// ---------- AI usage per tech per month ----------

export interface TechMonthly {
  userId: string | null;
  name: string;
  perMonth: number[];
  photos: number;
  errors: number;
  costUsd: number;
}

export interface UsageRollup {
  months: string[];
  monthTotals: { photos: number; errors: number; costUsd: number }[];
  techs: TechMonthly[];
  /** Totals for the last (current) month. */
  current: { photos: number; errors: number; costUsd: number };
  /** Average cost per successful photo across the range, or null with no photos. */
  avgCostPerPhoto: number | null;
}

export function usageRollup(rows: UsageRow[], months: string[]): UsageRollup {
  const idx = new Map(months.map((m, i) => [m, i]));
  const monthTotals = months.map(() => ({ photos: 0, errors: 0, costUsd: 0 }));
  const techs = new Map<string, TechMonthly>();
  for (const r of rows) {
    const i = idx.get(r.month);
    if (i === undefined) continue;
    const key = r.userId ?? 'unknown';
    let t = techs.get(key);
    if (!t) {
      t = { userId: r.userId, name: r.name || 'Former member', perMonth: months.map(() => 0), photos: 0, errors: 0, costUsd: 0 };
      techs.set(key, t);
    }
    const photos = Number(r.photos) || 0;
    const errors = Number(r.errors) || 0;
    const cost = Number(r.costUsd) || 0;
    t.perMonth[i] += photos;
    t.photos += photos;
    t.errors += errors;
    t.costUsd += cost;
    monthTotals[i].photos += photos;
    monthTotals[i].errors += errors;
    monthTotals[i].costUsd += cost;
  }
  const list = [...techs.values()].sort((a, b) => b.photos - a.photos || a.name.localeCompare(b.name));
  const totalPhotos = monthTotals.reduce((s, m) => s + m.photos, 0);
  const totalCost = monthTotals.reduce((s, m) => s + m.costUsd, 0);
  return {
    months,
    monthTotals,
    techs: list,
    current: monthTotals[monthTotals.length - 1] ?? { photos: 0, errors: 0, costUsd: 0 },
    avgCostPerPhoto: totalPhotos > 0 ? totalCost / totalPhotos : null,
  };
}

// ---------- Meters ----------

export type MeterLevel = 'ok' | 'warn' | 'full';

export function quotaState(used: number, quota: number): { pct: number; level: MeterLevel; remaining: number } {
  const q = Math.max(0, quota || 0);
  const u = Math.max(0, used || 0);
  const pct = q === 0 ? (u > 0 ? 1 : 0) : u / q;
  const level: MeterLevel = pct >= 1 ? 'full' : pct >= 0.8 ? 'warn' : 'ok';
  return { pct, level, remaining: Math.max(0, q - u) };
}

export function seatState(members: number, pendingInvites: number, seatLimit: number) {
  const free = Math.max(0, seatLimit - members);
  return {
    used: members,
    pending: pendingInvites,
    free,
    full: members >= seatLimit,
    /** More open invites than free seats: some invites will fail when accepted. */
    overInvited: pendingInvites > free,
    pct: seatLimit > 0 ? Math.min(1, members / seatLimit) : 1,
  };
}

/** Linear forecast of this month's AI photos at the current pace. */
export function projectMonthEnd(usedSoFar: number, now: number = Date.now()): number {
  const d = new Date(now);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = (d.getUTCDate() - 1) + (d.getUTCHours() * 60 + d.getUTCMinutes()) / 1440;
  if (elapsed < 1) return usedSoFar;
  return Math.round((usedSoFar / elapsed) * daysInMonth);
}

// ---------- QC ----------

export function qcCounts(issues: QcIssue[]): { errors: number; warnings: number; total: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of issues) {
    if (i.severity === 'error') errors++;
    else warnings++;
  }
  return { errors, warnings, total: errors + warnings };
}

// ---------- Projects table ----------

export type ProjectStatusFilter = 'all' | 'active' | 'complete' | 'archived';
export type ProjectSortKey = 'name' | 'client' | 'nodeCount' | 'totalFt' | 'lastUpdatedAt';

export function filterProjects(list: ProjectSummary[], query: string, status: ProjectStatusFilter): ProjectSummary[] {
  const q = query.trim().toLowerCase();
  return list.filter((p) => {
    if (status !== 'all' && p.status !== status) return false;
    if (!q) return true;
    return [p.name, p.client, p.jobNumber, ...p.editors.map((e) => e.name ?? '')].some((s) => s.toLowerCase().includes(q));
  });
}

export function sortProjects(list: ProjectSummary[], key: ProjectSortKey, dir: 'asc' | 'desc'): ProjectSummary[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return c * sign || a.name.localeCompare(b.name);
  });
}

// ---------- Activity ----------

const TABLE_NOUN: Record<string, string> = { projects: 'project', nodes: 'node', spans: 'span' };
const ACTION_VERB: Record<string, string> = {
  insert: 'added',
  update: 'edited',
  delete: 'permanently deleted',
  soft_delete: 'deleted',
  restore: 'restored',
};
const HIDDEN_KEYS = new Set(['client_updated_at', 'updated_at', 'rev', 'created_by', 'created_at', 'geom']);
const KEY_LABEL: Record<string, string> = {
  lat: 'position',
  lng: 'position',
  fields: 'fields',
  ai_meta: 'AI values',
  label: 'label',
  status: 'status',
  type: 'type',
  notes: 'notes',
  length_override_ft: 'measured length',
  slack_ft: 'slack',
  sag_pct: 'sag',
  kind: 'span type',
  name: 'name',
  job_number: 'job number',
  client: 'client',
  deleted_at: 'deleted',
};

/** "Tess Tech edited pole P-12 (position, fields)" style parts. */
export function describeActivity(e: ActivityEntry): { who: string; verb: string; what: string; detail: string | null } {
  const who = e.actorName || (e.actorId ? 'A former member' : 'System');
  const verb = ACTION_VERB[e.action] ?? e.action;
  const noun = e.table === 'nodes' && e.nodeType ? e.nodeType.replace('_', ' ') : TABLE_NOUN[e.table] ?? e.table;
  const what = e.rowLabel ? `${noun} ${e.rowLabel}` : `a ${noun}`;
  let detail: string | null = null;
  if (e.action === 'update' && e.changedKeys?.length) {
    const labels = [...new Set(e.changedKeys.filter((k) => !HIDDEN_KEYS.has(k)).map((k) => KEY_LABEL[k] ?? k.replace(/_/g, ' ')))];
    detail = labels.length ? labels.slice(0, 4).join(', ') + (labels.length > 4 ? ` +${labels.length - 4}` : '') : null;
  }
  return { who, verb, what, detail };
}

// ---------- Names ----------

export function initials(name: string | null | undefined, email?: string | null): string {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return s.toUpperCase();
}

export function displayName(name: string | null | undefined, email?: string | null): string {
  return (name && name.trim()) || email || 'Unnamed member';
}
