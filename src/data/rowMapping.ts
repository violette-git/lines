// Pure conversions between domain objects and SQLite rows/bind parameters.
import type { ClientTemplate, GeoFix, MapNode, PhotoRef, Project, Span } from '@/domain/types';

export type BindValue = string | number | null;

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null || text === '') return fallback;
  try {
    const v = JSON.parse(text) as T;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

const bool = (v: unknown) => v === 1 || v === true || v === '1';
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** INSERT ... ON CONFLICT(id) DO UPDATE. Never use INSERT OR REPLACE: it deletes the row and fires cascades. */
export function upsertSql(table: string, columns: string[]): string {
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`;
}

// ---------- projects ----------
export const PROJECT_COLUMNS = [
  'id', 'name', 'client', 'job_number', 'work_type', 'notes', 'status', 'rate_per_foot', 'rate_per_node',
  'template_id', 'walk_mode', 'created_at', 'updated_at',
];
export interface ProjectRow {
  id: string; name: string; client: string; job_number: string; work_type: string; notes: string; status: string;
  rate_per_foot: number | null; rate_per_node: number | null; template_id: string | null; walk_mode: number;
  created_at: string; updated_at: string;
}
export function projectParams(p: Project): BindValue[] {
  return [
    p.id, p.name, p.client ?? '', p.jobNumber ?? '', p.workType, p.notes ?? '', p.status, numOrNull(p.ratePerFoot),
    numOrNull(p.ratePerNode), p.templateId ?? null, p.walkMode ? 1 : 0, p.createdAt, p.updatedAt,
  ];
}
export function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    client: r.client ?? '',
    jobNumber: r.job_number ?? '',
    workType: r.work_type as Project['workType'],
    notes: r.notes ?? '',
    status: r.status as Project['status'],
    ratePerFoot: numOrNull(r.rate_per_foot),
    ratePerNode: numOrNull(r.rate_per_node),
    templateId: r.template_id ?? null,
    walkMode: bool(r.walk_mode),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------- nodes ----------
export const NODE_COLUMNS = [
  'id', 'project_id', 'seq', 'type', 'label', 'lat', 'lng', 'position', 'fields', 'ai_meta', 'icon_scale', 'status',
  'notes', 'possible_duplicate_of', 'created_at', 'updated_at', 'ai_report',
];
export interface NodeRow {
  id: string; project_id: string; seq: number; type: string; label: string; lat: number; lng: number;
  position: string; fields: string; ai_meta: string; icon_scale: number; status: string; notes: string;
  possible_duplicate_of: string | null; created_at: string; updated_at: string; ai_report?: string | null;
}
export function nodeParams(n: MapNode): BindValue[] {
  return [
    n.id, n.projectId, n.seq, n.type, n.label ?? '', n.position.lat, n.position.lng, JSON.stringify(n.position),
    JSON.stringify(n.fields ?? {}), JSON.stringify(n.aiMeta ?? {}), n.iconScale ?? 1, n.status, n.notes ?? '',
    n.possibleDuplicateOf ?? null, n.createdAt, n.updatedAt, n.aiReport ? JSON.stringify(n.aiReport) : null,
  ];
}
export function rowToNode(r: NodeRow): MapNode {
  const fallbackPos: GeoFix = {
    lat: r.lat, lng: r.lng, accuracyM: null, altitudeM: null, samples: 0, capturedAt: r.created_at, source: 'manual',
  };
  const position = parseJson<GeoFix>(r.position, fallbackPos);
  return {
    id: r.id,
    projectId: r.project_id,
    seq: r.seq,
    type: r.type as MapNode['type'],
    label: r.label ?? '',
    // lat/lng columns are authoritative (kept in sync on every write).
    position: { ...fallbackPos, ...position, lat: r.lat, lng: r.lng },
    fields: parseJson(r.fields, {}),
    aiMeta: parseJson(r.ai_meta, {}),
    iconScale: numOrNull(r.icon_scale) ?? 1,
    status: r.status as MapNode['status'],
    notes: r.notes ?? '',
    possibleDuplicateOf: r.possible_duplicate_of ?? null,
    ...(r.ai_report ? { aiReport: parseJson(r.ai_report, null) } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------- spans ----------
export const SPAN_COLUMNS = [
  'id', 'project_id', 'from_node_id', 'to_node_id', 'kind', 'slack_ft', 'sag_pct', 'length_override_ft', 'fields',
  'created_at', 'updated_at',
];
export interface SpanRow {
  id: string; project_id: string; from_node_id: string; to_node_id: string; kind: string; slack_ft: number;
  sag_pct: number; length_override_ft: number | null; fields: string; created_at: string; updated_at: string;
}
export function spanParams(s: Span): BindValue[] {
  return [
    s.id, s.projectId, s.fromNodeId, s.toNodeId, s.kind, s.slackFt ?? 0, s.sagPct ?? 0, numOrNull(s.lengthOverrideFt),
    JSON.stringify(s.fields ?? {}), s.createdAt, s.updatedAt,
  ];
}
export function rowToSpan(r: SpanRow): Span {
  return {
    id: r.id,
    projectId: r.project_id,
    fromNodeId: r.from_node_id,
    toNodeId: r.to_node_id,
    kind: r.kind as Span['kind'],
    slackFt: numOrNull(r.slack_ft) ?? 0,
    sagPct: numOrNull(r.sag_pct) ?? 0,
    lengthOverrideFt: numOrNull(r.length_override_ft),
    fields: parseJson(r.fields, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------- photos ----------
export const PHOTO_COLUMNS = [
  'id', 'node_id', 'project_id', 'uri', 'watermarked_uri', 'width', 'height', 'taken_at', 'fix', 'is_primary',
];
export interface PhotoRow {
  id: string; node_id: string; project_id: string; uri: string; watermarked_uri: string | null; width: number;
  height: number; taken_at: string; fix: string | null; is_primary: number;
}
export function photoParams(p: PhotoRef): BindValue[] {
  return [
    p.id, p.nodeId, p.projectId, p.uri, p.watermarkedUri ?? null, p.width ?? 0, p.height ?? 0, p.takenAt,
    p.fix ? JSON.stringify(p.fix) : null, p.isPrimary ? 1 : 0,
  ];
}
export function rowToPhoto(r: PhotoRow): PhotoRef {
  return {
    id: r.id,
    nodeId: r.node_id,
    projectId: r.project_id,
    uri: r.uri,
    watermarkedUri: r.watermarked_uri ?? null,
    width: r.width ?? 0,
    height: r.height ?? 0,
    takenAt: r.taken_at,
    fix: parseJson<GeoFix | null>(r.fix, null),
    isPrimary: bool(r.is_primary),
  };
}

// ---------- templates (stored whole as JSON, with a few columns for listing) ----------
export const TEMPLATE_COLUMNS = ['id', 'name', 'client', 'data', 'created_at', 'updated_at'];
export interface TemplateRow {
  id: string; name: string; client: string; data: string; created_at: string; updated_at: string;
}
export function templateParams(t: ClientTemplate): BindValue[] {
  return [t.id, t.name, t.client ?? '', JSON.stringify(t), t.createdAt, t.updatedAt];
}
export function rowToTemplate(r: TemplateRow): ClientTemplate {
  const base: ClientTemplate = {
    id: r.id,
    name: r.name,
    client: r.client ?? '',
    labelPatterns: {},
    requiredFields: {},
    defaults: {},
    defaultSpanKind: 'aerial',
    defaultSagPct: 2,
    defaultSlackFt: 0,
    ratePerFoot: null,
    ratePerNode: null,
    watermarkPhotos: true,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  return { ...base, ...parseJson<Partial<ClientTemplate>>(r.data, {}), id: r.id, name: r.name };
}
