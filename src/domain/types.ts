// LineMap Pro core domain model. This file is the shared contract for every module.
// All timestamps are ISO 8601 strings. All IDs are UUID v4 strings.

export type NodeType =
  | 'pole'
  | 'handhole'
  | 'vault'
  | 'pedestal'
  | 'splice_case'
  | 'riser'
  | 'anchor'
  | 'building_entry'
  | 'custom';

export const NODE_TYPES: NodeType[] = [
  'pole',
  'handhole',
  'vault',
  'pedestal',
  'splice_case',
  'riser',
  'anchor',
  'building_entry',
  'custom',
];

export type SpanKind = 'aerial' | 'underground';
export type WorkType = 'aerial' | 'underground' | 'mixed' | 'qc';

export interface LatLng {
  lat: number;
  lng: number;
}

/** A located position plus how it was obtained. */
export interface GeoFix extends LatLng {
  /** Horizontal accuracy radius in meters (1 sigma, as reported/averaged). Null if unknown (manual). */
  accuracyM: number | null;
  altitudeM: number | null;
  /** Number of GPS samples averaged into this fix (1 for single reading, 0 for manual). */
  samples: number;
  capturedAt: string;
  source: 'gps' | 'gps_avg' | 'manual' | 'external';
  /** GNSS fix quality when known (external receivers report it; phone GPS is 'gps'). */
  fixQuality?: FixQuality | null;
  /** Horizontal dilution of precision from the receiver, when known. */
  hdop?: number | null;
  satellites?: number | null;
  /** Receiver name/model for external fixes. */
  receiver?: string | null;
}

export type FixQuality = 'none' | 'gps' | 'dgps' | 'rtk_float' | 'rtk_fixed' | 'ppp' | 'estimated' | 'manual';

export type FieldValue = string | number | boolean | null;

export interface AiFieldMeta {
  /** 0..1 */
  confidence: number;
  source: 'ai' | 'manual';
  /** True when the value is a visual estimate (heights, diameters) rather than read directly. */
  isEstimate: boolean;
  note?: string;
}

export interface AiReport {
  summary: string;
  warnings: string[];
  detectedType: NodeType;
  typeConfidence: number;
  model: string;
  analyzedAt: string;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  jobNumber: string;
  workType: WorkType;
  notes: string;
  status: 'active' | 'complete' | 'archived';
  /** Pay rate per foot for the earnings tally. Null = not set. */
  ratePerFoot: number | null;
  /** Optional pay per node (e.g. per pole fielded). */
  ratePerNode: number | null;
  templateId: string | null;
  /** When true, each new captured node auto-connects with a span to the previous node. */
  walkMode: boolean;
  /** Company (organization) this project belongs to. Null/undefined = local-only project on this device. */
  orgId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NodeStatus = 'draft' | 'ai_pending' | 'ai_done' | 'ai_failed' | 'reviewed';

export interface MapNode {
  id: string;
  projectId: string;
  /** 1-based capture order within the project. */
  seq: number;
  type: NodeType;
  label: string;
  position: GeoFix;
  /** Values keyed by FieldDef.key from nodeSchemas. */
  fields: Record<string, FieldValue>;
  aiMeta: Record<string, AiFieldMeta>;
  /** Per-node icon size multiplier, 0.5..3. */
  iconScale: number;
  status: NodeStatus;
  notes: string;
  /** Set when duplicate detection flagged this node as possibly the same as another node. */
  possibleDuplicateOf: string | null;
  /** Last AI analysis summary for this node (what the model saw, warnings such as make-ready or safety notes). */
  aiReport?: AiReport | null;
  createdAt: string;
  updatedAt: string;
}

export interface Span {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: SpanKind;
  /** Extra cable for slack loops / storage coils, feet. */
  slackFt: number;
  /** Sag allowance as percent of straight-line length (aerial typically 1..3). */
  sagPct: number;
  /** If set, replaces the computed straight-line length (e.g. measured wheel footage). */
  lengthOverrideFt: number | null;
  fields: Record<string, FieldValue>;
  createdAt: string;
  updatedAt: string;
}

/** Span plus computed lengths. Produced by geo/spanLength. */
export interface SpanWithLength extends Span {
  /** Straight-line geodesic distance between the two nodes, feet. */
  straightFt: number;
  /** Billable/cable footage: override ?? straight * (1 + sag/100) + slack. */
  totalFt: number;
}

export interface PhotoRef {
  id: string;
  nodeId: string;
  projectId: string;
  /** Local file URI (native) or object/data URL (web). This is the ORIGINAL photo. */
  uri: string;
  /** Watermarked copy (GPS, time, project, node label burned in). Null until generated. */
  watermarkedUri: string | null;
  width: number;
  height: number;
  takenAt: string;
  fix: GeoFix | null;
  isPrimary: boolean;
  /** Device time of the last edit to this photo record (sync last-write-wins). Falls back to takenAt. */
  updatedAt?: string;
  /** Path of the original in the company 'photos' bucket once uploaded: <org>/<project>/<photo>.jpg. */
  storagePath?: string | null;
  /** Path of the watermarked copy in the bucket: <org>/<project>/<photo>_wm.jpg. */
  watermarkedPath?: string | null;
  /** Upload progress of a company photo. Managed by sync; the app never needs to set it. */
  uploadState?: PhotoUploadState;
}

export type PhotoUploadState = 'pending' | 'uploaded' | 'failed';

/** Client template: preset fields, required fields, label pattern and rates for a client. */
export interface ClientTemplate {
  id: string;
  name: string;
  client: string;
  /** Label pattern tokens: {seq}, {type}, {TYPE}, {job}. Example: "P-{seq}". Per node type, falls back to "*". */
  labelPatterns: Partial<Record<NodeType | '*', string>>;
  /** Field keys that must be filled before export passes QC, per node type. */
  requiredFields: Partial<Record<NodeType, string[]>>;
  /** Default field values applied to new nodes, per node type. */
  defaults: Partial<Record<NodeType, Record<string, FieldValue>>>;
  defaultSpanKind: SpanKind;
  defaultSagPct: number;
  defaultSlackFt: number;
  ratePerFoot: number | null;
  ratePerNode: number | null;
  /** Burn GPS/time watermark into photos. */
  watermarkPhotos: boolean;
  /** Company (organization) this template belongs to. Null/undefined = local template on this device. */
  orgId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  units: 'imperial' | 'metric';
  basemap: Basemap;
  globalIconScale: number;
  /** Seconds of GPS sampling to average per capture. */
  gpsAverageSeconds: number;
  /** Distance in meters under which a new node of the same type is flagged as possible duplicate. */
  duplicateRadiusM: number;
  aiMode: 'off' | 'direct' | 'proxy';
  aiModel: string;
  /** Auto-run AI on every capture when aiMode != off. */
  aiAutoRun: boolean;
  watermarkPhotos: boolean;
  proxyUrl: string | null;
  /** Sync: only upload photos on Wi-Fi (field data still syncs on cellular). */
  syncPhotosWifiOnly?: boolean;
  /** Where positions come from: phone location services (includes receivers that feed the phone) or a direct TCP NMEA stream. */
  gpsSource?: 'device' | 'external_tcp';
  receiverHost?: string | null;
  receiverPort?: number | null;
  /** Antenna height above ground in meters (subtracted from altitude for external receivers). */
  antennaHeightM?: number | null;
  /** Warn before capture when an external receiver is not in RTK fixed. */
  requireRtkFixed?: boolean;
  /** Offline map tile provider id (see src/offline). */
  offlineTileProvider?: string | null;
  /** API key for a commercial tile provider (MapTiler etc). */
  tileApiKey?: string | null;
}

export type Basemap = 'satellite' | 'streets' | 'hybrid';

export const DEFAULT_SETTINGS: AppSettings = {
  units: 'imperial',
  basemap: 'hybrid',
  globalIconScale: 1,
  gpsAverageSeconds: 4,
  duplicateRadiusM: 4,
  aiMode: 'off',
  aiModel: 'claude-sonnet-5-5',
  aiAutoRun: true,
  watermarkPhotos: true,
  proxyUrl: null,
  syncPhotosWifiOnly: true,
  gpsSource: 'device',
  receiverHost: null,
  receiverPort: null,
  antennaHeightM: null,
  requireRtkFixed: false,
  offlineTileProvider: null,
  tileApiKey: null,
};
