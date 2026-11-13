// Shared helpers for the pure export builders. No platform APIs here: everything must run in
// Hermes, on web and under Jest.
import type { ExportBundle } from '@/domain/contracts';
import { NODE_SCHEMAS, NODE_TYPE_META, SPAN_FIELDS, type FieldDef } from '@/domain/nodeSchemas';
import {
  NODE_TYPES,
  type FieldValue,
  type MapNode,
  type NodeType,
  type PhotoRef,
  type SpanWithLength,
} from '@/domain/types';

export const APP_NAME = 'LineMap Pro';

/** Finite number or null. Guards every numeric output against NaN / Infinity / undefined. */
export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function round(v: unknown, digits: number): number | null {
  const n = num(v);
  if (n === null) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

/** Fixed decimals as string, '' when not a finite number. */
export function fixed(v: unknown, digits: number): string {
  const n = num(v);
  return n === null ? '' : n.toFixed(digits);
}

/** 12345.6 -> "12,346" (digits=0) or "12,345.6" (digits=1). Locale independent. */
export function fmtNumber(v: unknown, digits = 0): string {
  const n = num(v);
  if (n === null) return '';
  const neg = n < 0;
  const [int, frac] = Math.abs(n).toFixed(digits).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + (frac ? '.' + frac : '');
}

export function fmtMoney(v: unknown): string {
  const n = num(v);
  return n === null ? '' : '$' + fmtNumber(n, 2);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO timestamp -> "2026-11-12 14:03" in local time. '' if unparseable. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ISO timestamp -> "20261112" (local date). Falls back to today. */
export function dateStamp(iso: string | null | undefined): string {
  let d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function stripAccents(s: string): string {
  try {
    return typeof s.normalize === 'function' ? s.normalize('NFKD').replace(/[̀-ͯ]/g, '') : s;
  } catch {
    return s;
  }
}

export function slugify(name: string): string {
  const s = stripAccents(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'linemap-project';
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** XML 1.0 text/attribute escape; also strips characters that are illegal in XML 1.0. */
export function escapeXml(s: unknown): string {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Human value for display (CSV, PDF, KML). Booleans become Yes/No, null becomes ''. */
export function displayValue(v: FieldValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return v;
}

export function isBlank(v: FieldValue | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && !Number.isFinite(v));
}

export function unitSuffix(def: FieldDef): string {
  switch (def.unit) {
    case 'ft':
      return ' (ft)';
    case 'in':
      return ' (in)';
    case 'pct':
      return ' (%)';
    default:
      return '';
  }
}

export function sortedNodes(bundle: ExportBundle): MapNode[] {
  return [...bundle.nodes].sort((a, b) => a.seq - b.seq || a.label.localeCompare(b.label));
}

export function nodeMap(bundle: ExportBundle): Map<string, MapNode> {
  return new Map(bundle.nodes.map((n) => [n.id, n]));
}

/** Photos grouped by node, primary first then by takenAt. */
export function photosByNode(bundle: ExportBundle): Map<string, PhotoRef[]> {
  const m = new Map<string, PhotoRef[]>();
  for (const p of bundle.photos) {
    const list = m.get(p.nodeId) ?? [];
    list.push(p);
    m.set(p.nodeId, list);
  }
  for (const list of m.values()) {
    list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.takenAt.localeCompare(b.takenAt));
  }
  return m;
}

export function typeLabel(type: NodeType): string {
  return NODE_TYPE_META[type]?.label ?? String(type);
}

export function typeColor(type: NodeType): string {
  return NODE_TYPE_META[type]?.color ?? '#E0E0E0';
}

/** Colors used for spans everywhere (KMZ, PDF): aerial = pole color, underground = handhole color. */
export const SPAN_COLORS: Record<'aerial' | 'underground', string> = {
  aerial: NODE_TYPE_META.pole.color,
  underground: NODE_TYPE_META.handhole.color,
};

export interface ColumnDef {
  key: string;
  label: string;
  def?: FieldDef;
}

/**
 * Union of every node field key across all node types (stable column set), in schema order,
 * followed by any extra keys present on nodes but not in a schema (custom template fields).
 * When the same key has different labels across types, labels are joined with " / ".
 */
export function nodeFieldColumns(nodes: MapNode[]): ColumnDef[] {
  const order: string[] = [];
  const labels = new Map<string, string[]>();
  const defs = new Map<string, FieldDef>();
  for (const t of NODE_TYPES) {
    for (const def of NODE_SCHEMAS[t]) {
      if (!labels.has(def.key)) {
        order.push(def.key);
        labels.set(def.key, []);
        defs.set(def.key, def);
      }
      const l = labels.get(def.key)!;
      if (!l.includes(def.label)) l.push(def.label);
    }
  }
  // Keep location_note (shared by every type) at the end of the schema block.
  const loc = order.indexOf('location_note');
  if (loc >= 0) order.push(...order.splice(loc, 1));
  const extras = new Set<string>();
  for (const n of nodes) for (const k of Object.keys(n.fields ?? {})) if (!labels.has(k)) extras.add(k);
  const cols: ColumnDef[] = order.map((key) => {
    const def = defs.get(key)!;
    return { key, label: labels.get(key)!.join(' / ') + unitSuffix(def), def };
  });
  for (const k of [...extras].sort()) cols.push({ key: k, label: humanizeKey(k) });
  return cols;
}

export function spanFieldColumns(spans: SpanWithLength[]): ColumnDef[] {
  const cols: ColumnDef[] = SPAN_FIELDS.map((def) => ({ key: def.key, label: def.label + unitSuffix(def), def }));
  const known = new Set(cols.map((c) => c.key));
  const extras = new Set<string>();
  for (const s of spans) for (const k of Object.keys(s.fields ?? {})) if (!known.has(k)) extras.add(k);
  for (const k of [...extras].sort()) cols.push({ key: k, label: humanizeKey(k) });
  return cols;
}

/** Fields for one node in display order: schema fields for its type, then any extra keys. */
export function nodeFieldList(node: MapNode): ColumnDef[] {
  const defs = NODE_SCHEMAS[node.type] ?? [];
  const cols: ColumnDef[] = defs.map((def) => ({ key: def.key, label: def.label + unitSuffix(def), def }));
  const known = new Set(cols.map((c) => c.key));
  for (const k of Object.keys(node.fields ?? {}).sort()) if (!known.has(k)) cols.push({ key: k, label: humanizeKey(k) });
  return cols;
}

export function humanizeKey(k: string): string {
  const s = k.replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : k;
}

export interface AiSummary {
  /** Keys whose current value came from the AI. */
  aiKeys: string[];
  /** Subset of aiKeys that are visual estimates. */
  estimateKeys: string[];
  minConfidence: number | null;
  avgConfidence: number | null;
}

export function aiSummary(node: MapNode): AiSummary {
  const aiKeys: string[] = [];
  const estimateKeys: string[] = [];
  const confs: number[] = [];
  for (const [k, meta] of Object.entries(node.aiMeta ?? {})) {
    if (!meta || meta.source !== 'ai') continue;
    aiKeys.push(k);
    if (meta.isEstimate) estimateKeys.push(k);
    const c = num(meta.confidence);
    if (c !== null) confs.push(c);
  }
  return {
    aiKeys,
    estimateKeys,
    minConfidence: confs.length ? round(Math.min(...confs), 2) : null,
    avgConfidence: confs.length ? round(confs.reduce((a, b) => a + b, 0) / confs.length, 2) : null,
  };
}

export interface ExportTotals {
  nodeCount: number;
  nodesByType: Partial<Record<NodeType, number>>;
  spanCount: number;
  aerialFt: number;
  undergroundFt: number;
  totalFt: number;
  photoCount: number;
  ratePerFoot: number | null;
  ratePerNode: number | null;
  /** Null when no rate is set. */
  earnings: number | null;
}

/** Same math as computeTally in the store (rates from project, falling back to template). */
export function computeTotals(bundle: ExportBundle): ExportTotals {
  const nodesByType: Partial<Record<NodeType, number>> = {};
  for (const n of bundle.nodes) nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1;
  let aerialFt = 0;
  let undergroundFt = 0;
  for (const s of bundle.spans) {
    const ft = num(s.totalFt) ?? 0;
    if (s.kind === 'aerial') aerialFt += ft;
    else undergroundFt += ft;
  }
  const totalFt = aerialFt + undergroundFt;
  const ratePerFoot = num(bundle.project.ratePerFoot) ?? num(bundle.template?.ratePerFoot) ?? null;
  const ratePerNode = num(bundle.project.ratePerNode) ?? num(bundle.template?.ratePerNode) ?? null;
  const earnings =
    ratePerFoot !== null || ratePerNode !== null
      ? (ratePerFoot ?? 0) * totalFt + (ratePerNode ?? 0) * bundle.nodes.length
      : null;
  return {
    nodeCount: bundle.nodes.length,
    nodesByType,
    spanCount: bundle.spans.length,
    aerialFt,
    undergroundFt,
    totalFt,
    photoCount: bundle.photos.length,
    ratePerFoot,
    ratePerNode,
    earnings,
  };
}

export const WORK_TYPE_LABELS: Record<string, string> = {
  aerial: 'Aerial',
  underground: 'Underground',
  mixed: 'Mixed',
  qc: 'QC / audit',
};

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  ai_pending: 'AI pending',
  ai_done: 'AI filled, not reviewed',
  ai_failed: 'AI failed',
  reviewed: 'Reviewed',
};

export const GPS_SOURCE_LABELS: Record<string, string> = {
  gps: 'GPS',
  gps_avg: 'GPS (averaged)',
  manual: 'Manual',
  external: 'External receiver',
};

/** Strip an accidental data: URL prefix and whitespace from a base64 payload. */
export function cleanBase64(b64: string): string {
  return b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
}

/** Sniff image type from base64 magic bytes. */
export function imageTypeFromBase64(b64: string): { ext: 'jpg' | 'png' | 'webp' | 'gif'; mime: string } {
  if (b64.startsWith('iVBOR')) return { ext: 'png', mime: 'image/png' };
  if (b64.startsWith('UklGR')) return { ext: 'webp', mime: 'image/webp' };
  if (b64.startsWith('R0lGOD')) return { ext: 'gif', mime: 'image/gif' };
  return { ext: 'jpg', mime: 'image/jpeg' };
}

export function safeFileId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_') || 'photo';
}

/** Calls bundle.loadPhotoBase64 defensively: never throws, returns cleaned base64 or null. */
export async function loadPhoto(bundle: ExportBundle, photo: PhotoRef): Promise<string | null> {
  if (!bundle.loadPhotoBase64) return null;
  try {
    const b64 = await bundle.loadPhotoBase64(photo);
    if (!b64) return null;
    const clean = cleanBase64(b64);
    return clean.length ? clean : null;
  } catch {
    return null;
  }
}

/** Midpoint by simple averaging. Spans are short (feet to a few thousand feet) so this is fine. */
export function midpoint(a: { lat: number; lng: number }, b: { lat: number; lng: number }): { lat: number; lng: number } {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

export function hasPosition(n: MapNode | undefined): n is MapNode {
  return !!n && num(n.position?.lat) !== null && num(n.position?.lng) !== null;
}
