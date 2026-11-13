// Pure conversions between the app's domain objects and the Supabase (Postgres) rows defined in
// supabase/migrations/0001_init.sql (+ 0002_sync.sql). Shared by the phone sync engine and the web
// admin dashboard, so keep the exported names and signatures stable.
//
// Conventions:
//  * Domain `updatedAt` is the device clock of the last edit and maps to `client_updated_at`
//    (the column last-write-wins compares). Server `updated_at` is the server clock and is ignored.
//  * Server-managed columns (created_by, updated_at, rev, geom, sync_txid) are never sent.
//  * Timestamps coming from the server are normalized to ISO 8601 with milliseconds ("...Z") so
//    they compare and round trip cleanly with the app's own timestamps.
//  * Numbers may arrive as strings (Postgres numeric through some clients); they are coerced.
import type {
  AiFieldMeta,
  AiReport,
  ClientTemplate,
  FieldValue,
  FixQuality,
  GeoFix,
  MapNode,
  NodeType,
  PhotoRef,
  Project,
  Span,
} from '@/domain/types';

/** Server table names, in push (dependency) order. */
export const SERVER_TABLES = ['client_templates', 'projects', 'nodes', 'spans', 'photos'] as const;
export type ServerTable = (typeof SERVER_TABLES)[number];

/** Columns every synced server table has. */
export interface ServerSyncColumns {
  org_id: string;
  /** Set by the server on insert; never sent by the app. */
  created_by?: string | null;
  created_at: string;
  /** Server clock; never sent by the app. */
  updated_at?: string;
  /** Device clock of the edit; last-write-wins compares this. */
  client_updated_at: string;
  /** Tombstone: non-null means deleted. */
  deleted_at: string | null;
  /** Server revision; never sent by the app. */
  rev?: number;
}

export interface ServerTemplateRow extends ServerSyncColumns {
  id: string;
  name: string;
  client: string;
  label_patterns: Record<string, string>;
  required_fields: Record<string, string[]>;
  defaults: Record<string, Record<string, FieldValue>>;
  default_span_kind: 'aerial' | 'underground';
  default_sag_pct: number;
  default_slack_ft: number;
  rate_per_foot: number | null;
  rate_per_node: number | null;
  watermark_photos: boolean;
}

export interface ServerProjectRow extends ServerSyncColumns {
  id: string;
  name: string;
  client: string;
  job_number: string;
  work_type: Project['workType'];
  notes: string;
  status: Project['status'];
  rate_per_foot: number | null;
  rate_per_node: number | null;
  template_id: string | null;
  walk_mode: boolean;
}

/** GeoFix fields that have no column of their own (kept in nodes.position_extra). */
export interface PositionExtra {
  fixQuality?: FixQuality | null;
  hdop?: number | null;
  satellites?: number | null;
  receiver?: string | null;
}

export interface ServerNodeRow extends ServerSyncColumns {
  id: string;
  project_id: string;
  seq: number;
  type: NodeType;
  label: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  altitude_m: number | null;
  gps_samples: number;
  position_captured_at: string | null;
  position_source: GeoFix['source'];
  position_extra: PositionExtra;
  fields: Record<string, FieldValue>;
  ai_meta: Record<string, AiFieldMeta>;
  icon_scale: number;
  status: MapNode['status'];
  notes: string;
  possible_duplicate_of: string | null;
  /** Added by 0002_sync.sql. */
  ai_report: AiReport | null;
}

export interface ServerSpanRow extends ServerSyncColumns {
  id: string;
  project_id: string;
  from_node_id: string;
  to_node_id: string;
  kind: Span['kind'];
  slack_ft: number;
  sag_pct: number;
  length_override_ft: number | null;
  fields: Record<string, FieldValue>;
}

export interface ServerPhotoRow extends ServerSyncColumns {
  id: string;
  project_id: string;
  node_id: string;
  storage_path: string | null;
  watermarked_path: string | null;
  width: number;
  height: number;
  taken_at: string;
  fix: GeoFix | null;
  is_primary: boolean;
}

export interface ServerRowByTable {
  client_templates: ServerTemplateRow;
  projects: ServerProjectRow;
  nodes: ServerNodeRow;
  spans: ServerSpanRow;
  photos: ServerPhotoRow;
}
export type AnyServerRow = ServerRowByTable[ServerTable];

export interface ToServerOptions {
  /** Tombstone time; null/undefined = live row. */
  deletedAt?: string | null;
}

// ---------- helpers ----------
export const PHOTO_BUCKET = 'photos';

/** Bucket object path for a photo: <org_id>/<project_id>/<photo_id>.jpg (or _wm.jpg for the watermarked copy). */
export function photoStoragePath(orgId: string, projectId: string, photoId: string, watermarked = false): string {
  return `${orgId}/${projectId}/${photoId}${watermarked ? '_wm' : ''}.jpg`;
}

export const isTombstone = (row: { deleted_at?: string | null }) => row.deleted_at != null;

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
const numOr = (v: unknown, d: number) => num(v) ?? d;

/** Normalizes any timestamp the server sends to ISO with milliseconds. Leaves unparseable input alone. */
export function isoTime(v: string | null | undefined): string | null {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : v;
}
const isoOr = (v: string | null | undefined, d: string) => isoTime(v) ?? d;

function obj<T>(v: unknown, d: T): T {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as T;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as T;
    } catch {
      /* fall through */
    }
  }
  return d;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function syncColumns(orgId: string, createdAt: string, updatedAt: string, opts: ToServerOptions): ServerSyncColumns {
  if (!orgId) throw new Error('A company id is required to send a record to the server');
  return { org_id: orgId, created_at: createdAt, client_updated_at: updatedAt, deleted_at: opts.deletedAt ?? null };
}

// ---------- templates ----------
export function toServerTemplate(t: ClientTemplate, orgId: string, opts: ToServerOptions = {}): ServerTemplateRow {
  return {
    id: t.id,
    ...syncColumns(orgId, t.createdAt, t.updatedAt, opts),
    name: t.name ?? '',
    client: t.client ?? '',
    label_patterns: (t.labelPatterns ?? {}) as Record<string, string>,
    required_fields: (t.requiredFields ?? {}) as Record<string, string[]>,
    defaults: (t.defaults ?? {}) as Record<string, Record<string, FieldValue>>,
    default_span_kind: t.defaultSpanKind,
    default_sag_pct: clamp(numOr(t.defaultSagPct, 0), 0, 100),
    default_slack_ft: Math.max(0, numOr(t.defaultSlackFt, 0)),
    rate_per_foot: num(t.ratePerFoot),
    rate_per_node: num(t.ratePerNode),
    watermark_photos: !!t.watermarkPhotos,
  };
}

export function fromServerTemplate(r: ServerTemplateRow): ClientTemplate {
  const createdAt = isoOr(r.created_at, new Date(0).toISOString());
  return {
    id: r.id,
    name: r.name ?? '',
    client: r.client ?? '',
    labelPatterns: obj(r.label_patterns, {}),
    requiredFields: obj(r.required_fields, {}),
    defaults: obj(r.defaults, {}),
    defaultSpanKind: r.default_span_kind === 'underground' ? 'underground' : 'aerial',
    defaultSagPct: numOr(r.default_sag_pct, 0),
    defaultSlackFt: numOr(r.default_slack_ft, 0),
    ratePerFoot: num(r.rate_per_foot),
    ratePerNode: num(r.rate_per_node),
    watermarkPhotos: r.watermark_photos !== false,
    orgId: r.org_id,
    createdAt,
    updatedAt: isoOr(r.client_updated_at ?? r.updated_at, createdAt),
  };
}

// ---------- projects ----------
export function toServerProject(p: Project, orgId: string, opts: ToServerOptions = {}): ServerProjectRow {
  return {
    id: p.id,
    ...syncColumns(orgId, p.createdAt, p.updatedAt, opts),
    name: p.name ?? '',
    client: p.client ?? '',
    job_number: p.jobNumber ?? '',
    work_type: p.workType,
    notes: p.notes ?? '',
    status: p.status,
    rate_per_foot: num(p.ratePerFoot),
    rate_per_node: num(p.ratePerNode),
    template_id: p.templateId ?? null,
    walk_mode: !!p.walkMode,
  };
}

export function fromServerProject(r: ServerProjectRow): Project {
  const createdAt = isoOr(r.created_at, new Date(0).toISOString());
  return {
    id: r.id,
    name: r.name ?? '',
    client: r.client ?? '',
    jobNumber: r.job_number ?? '',
    workType: r.work_type,
    notes: r.notes ?? '',
    status: r.status,
    ratePerFoot: num(r.rate_per_foot),
    ratePerNode: num(r.rate_per_node),
    templateId: r.template_id ?? null,
    walkMode: !!r.walk_mode,
    orgId: r.org_id,
    createdAt,
    updatedAt: isoOr(r.client_updated_at ?? r.updated_at, createdAt),
  };
}

// ---------- nodes ----------
const EXTRA_KEYS = ['fixQuality', 'hdop', 'satellites', 'receiver'] as const;

export function toServerNode(n: MapNode, orgId: string, opts: ToServerOptions = {}): ServerNodeRow {
  const pos = n.position;
  const extra: PositionExtra = {};
  for (const k of EXTRA_KEYS) if (pos[k] !== undefined) (extra as Record<string, unknown>)[k] = pos[k];
  return {
    id: n.id,
    ...syncColumns(orgId, n.createdAt, n.updatedAt, opts),
    project_id: n.projectId,
    seq: Math.round(numOr(n.seq, 0)),
    type: n.type,
    label: n.label ?? '',
    lat: pos.lat,
    lng: pos.lng,
    accuracy_m: num(pos.accuracyM),
    altitude_m: num(pos.altitudeM),
    gps_samples: Math.max(0, Math.round(numOr(pos.samples, 0))),
    position_captured_at: pos.capturedAt || null,
    position_source: pos.source,
    position_extra: extra,
    fields: n.fields ?? {},
    ai_meta: n.aiMeta ?? {},
    // numeric(4,2) with a 0.5..3 check on the server.
    icon_scale: Math.round(clamp(numOr(n.iconScale, 1), 0.5, 3) * 100) / 100,
    status: n.status,
    notes: n.notes ?? '',
    possible_duplicate_of: n.possibleDuplicateOf ?? null,
    ai_report: n.aiReport ?? null,
  };
}

export function fromServerNode(r: ServerNodeRow): MapNode {
  const createdAt = isoOr(r.created_at, new Date(0).toISOString());
  const extraIn = obj<PositionExtra>(r.position_extra, {});
  const extra: PositionExtra = {};
  for (const k of EXTRA_KEYS) if (extraIn[k] !== undefined) (extra as Record<string, unknown>)[k] = extraIn[k];
  const position: GeoFix = {
    lat: numOr(r.lat, 0),
    lng: numOr(r.lng, 0),
    accuracyM: num(r.accuracy_m),
    altitudeM: num(r.altitude_m),
    samples: numOr(r.gps_samples, 0),
    capturedAt: isoOr(r.position_captured_at, createdAt),
    source: r.position_source ?? 'manual',
    ...extra,
  };
  const aiReport = r.ai_report ? obj<AiReport | null>(r.ai_report, null) : null;
  return {
    id: r.id,
    projectId: r.project_id,
    seq: numOr(r.seq, 0),
    type: r.type,
    label: r.label ?? '',
    position,
    fields: obj(r.fields, {}),
    aiMeta: obj(r.ai_meta, {}),
    iconScale: numOr(r.icon_scale, 1),
    status: r.status,
    notes: r.notes ?? '',
    possibleDuplicateOf: r.possible_duplicate_of ?? null,
    ...(aiReport ? { aiReport } : {}),
    createdAt,
    updatedAt: isoOr(r.client_updated_at ?? r.updated_at, createdAt),
  };
}

// ---------- spans ----------
export function toServerSpan(s: Span, orgId: string, opts: ToServerOptions = {}): ServerSpanRow {
  const override = num(s.lengthOverrideFt);
  return {
    id: s.id,
    ...syncColumns(orgId, s.createdAt, s.updatedAt, opts),
    project_id: s.projectId,
    from_node_id: s.fromNodeId,
    to_node_id: s.toNodeId,
    kind: s.kind,
    slack_ft: Math.max(0, numOr(s.slackFt, 0)),
    sag_pct: clamp(numOr(s.sagPct, 0), 0, 100),
    length_override_ft: override == null ? null : Math.max(0, override),
    fields: s.fields ?? {},
  };
}

export function fromServerSpan(r: ServerSpanRow): Span {
  const createdAt = isoOr(r.created_at, new Date(0).toISOString());
  return {
    id: r.id,
    projectId: r.project_id,
    fromNodeId: r.from_node_id,
    toNodeId: r.to_node_id,
    kind: r.kind === 'underground' ? 'underground' : 'aerial',
    slackFt: numOr(r.slack_ft, 0),
    sagPct: numOr(r.sag_pct, 0),
    lengthOverrideFt: num(r.length_override_ft),
    fields: obj(r.fields, {}),
    createdAt,
    updatedAt: isoOr(r.client_updated_at ?? r.updated_at, createdAt),
  };
}

// ---------- photos ----------
export interface ToServerPhotoOptions extends ToServerOptions {
  storagePath?: string | null;
  watermarkedPath?: string | null;
}

export function toServerPhoto(p: PhotoRef, orgId: string, opts: ToServerPhotoOptions = {}): ServerPhotoRow {
  return {
    id: p.id,
    ...syncColumns(orgId, p.takenAt, p.updatedAt ?? p.takenAt, opts),
    project_id: p.projectId,
    node_id: p.nodeId,
    storage_path: opts.storagePath !== undefined ? opts.storagePath : p.storagePath ?? null,
    watermarked_path: opts.watermarkedPath !== undefined ? opts.watermarkedPath : p.watermarkedPath ?? null,
    width: Math.max(0, Math.round(numOr(p.width, 0))),
    height: Math.max(0, Math.round(numOr(p.height, 0))),
    taken_at: p.takenAt,
    fix: p.fix ?? null,
    is_primary: !!p.isPrimary,
  };
}

/**
 * Server photo row to a PhotoRef. The server has no local file, so `uri` and `watermarkedUri` are
 * empty until the photo is downloaded (see src/sync/photoCache.ts); `storagePath` says where it lives.
 */
export function fromServerPhoto(r: ServerPhotoRow): PhotoRef {
  const takenAt = isoOr(r.taken_at, isoOr(r.created_at, new Date(0).toISOString()));
  return {
    id: r.id,
    nodeId: r.node_id,
    projectId: r.project_id,
    uri: '',
    watermarkedUri: null,
    width: numOr(r.width, 0),
    height: numOr(r.height, 0),
    takenAt,
    fix: r.fix ? obj<GeoFix | null>(r.fix, null) : null,
    isPrimary: !!r.is_primary,
    updatedAt: isoOr(r.client_updated_at ?? r.updated_at, takenAt),
    storagePath: r.storage_path ?? null,
    watermarkedPath: r.watermarked_path ?? null,
    uploadState: 'uploaded',
  };
}
