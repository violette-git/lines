// Interfaces between modules. Implementations live in src/data, src/ai, src/export, src/map, src/geo.
import type { FieldDef } from './nodeSchemas';
import type {
  AppSettings,
  Basemap,
  ClientTemplate,
  FieldValue,
  GeoFix,
  LatLng,
  MapNode,
  NodeType,
  PhotoRef,
  Project,
  Span,
  SpanWithLength,
  WorkType,
} from './types';

// ---------- Data (src/data) ----------
// getRepository() is exported from src/data/index.ts. Native uses expo-sqlite, web uses an in-memory
// store seeded with a demo project so the browser preview has something to show.
export interface Repository {
  init(): Promise<void>;

  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  upsertProject(p: Project): Promise<void>;
  /** Cascades nodes, spans, photos (and deletes photo files on native). */
  deleteProject(id: string): Promise<void>;

  listNodes(projectId: string): Promise<MapNode[]>;
  getNode(id: string): Promise<MapNode | null>;
  upsertNode(n: MapNode): Promise<void>;
  /** Cascades spans touching the node and its photos. */
  deleteNode(id: string): Promise<void>;

  listSpans(projectId: string): Promise<Span[]>;
  upsertSpan(s: Span): Promise<void>;
  deleteSpan(id: string): Promise<void>;

  listPhotos(projectId: string): Promise<PhotoRef[]>;
  upsertPhoto(p: PhotoRef): Promise<void>;
  deletePhoto(id: string): Promise<void>;

  listTemplates(): Promise<ClientTemplate[]>;
  upsertTemplate(t: ClientTemplate): Promise<void>;
  deleteTemplate(id: string): Promise<void>;

  getSettings(): Promise<AppSettings>;
  saveSettings(s: AppSettings): Promise<void>;
}

// ---------- Sync bookkeeping (src/data implements, src/sync uses) ----------
// Both repositories (SQLite and in-memory) implement SyncRepository. Rules:
//  * Every app write (the Repository methods above) bumps the row's local change generation
//    ("dirty"). Only rows that belong to a company (org) are ever pushed.
//  * Deleting a company row leaves a tombstone (hidden from every list/get) until the server
//    has it; local-only rows are deleted outright, as in Phase 1.
//  * Sync-side writes (applyServerRows, markSynced, setPhotoLocalFiles...) never mark rows dirty.
export type SyncTable = 'templates' | 'projects' | 'nodes' | 'spans' | 'photos';
/** Dependency order: parents before children. */
export const SYNC_TABLES: SyncTable[] = ['templates', 'projects', 'nodes', 'spans', 'photos'];

export interface SyncRowMeta {
  orgId: string | null;
  /** Local change generation. 0 = matches the server; any app write increments it. */
  dirty: number;
  /** Tombstone time; the row is hidden from the app. */
  deletedAt: string | null;
  serverRev: number | null;
  syncedAt: string | null;
  /** Set when the server refused the last push of this row; cleared by the next local edit or a manual retry. */
  syncError: string | null;
}

export type SyncRecord =
  | { table: 'templates'; row: ClientTemplate; meta: SyncRowMeta }
  | { table: 'projects'; row: Project; meta: SyncRowMeta }
  | { table: 'nodes'; row: MapNode; meta: SyncRowMeta }
  | { table: 'spans'; row: Span; meta: SyncRowMeta }
  | { table: 'photos'; row: PhotoRef; meta: SyncRowMeta };

export type SyncRowFor<T extends SyncTable> = Extract<SyncRecord, { table: T }>['row'];

/** Server acknowledged a pushed row. `dirty` is the generation that was pushed. */
export interface SyncAck {
  id: string;
  dirty: number;
  rev: number | null;
}

export interface SyncRejection {
  id: string;
  dirty: number;
  reason: string;
}

/** A row from the server, already converted to the domain shape. */
export interface ServerApplyRow<T> {
  row: T;
  orgId: string;
  rev: number | null;
  deletedAt: string | null;
}

export interface ApplyOptions {
  /**
   * When a live row's parent (project, or node) is not on this phone: true = stop at that row and
   * report stopped (the parent may arrive with a later page), false = skip the row.
   */
  stopAtOrphan?: boolean;
  /** Apply even if the local row has a newer unsynced edit (server said it is the winner). */
  force?: boolean;
}

export interface ApplyOutcome {
  /** Ids written or updated locally. */
  applied: string[];
  /** Ids removed locally because the server row is a tombstone. */
  deleted: string[];
  /** Ids kept as they are because the phone has a newer unsynced edit. */
  keptLocal: string[];
  /** Ids skipped because their parent is missing. */
  orphans: string[];
  /** True when stopAtOrphan stopped processing early. */
  stopped: boolean;
  /** Project ids touched (for live refresh of the open project). */
  projectIds: string[];
}

export interface PendingPhotoUpload {
  photo: PhotoRef;
  orgId: string;
  needsOriginal: boolean;
  needsWatermarked: boolean;
}

export interface PendingCounts {
  /** Rows waiting to be pushed (excluding refused ones). */
  changes: number;
  /** Photo files waiting to be uploaded. */
  photos: number;
  /** Rows the server refused. */
  rejected: number;
}

export interface LocalChangeEvent {
  table: SyncTable;
  id: string;
}

export interface SyncRepository extends Repository {
  /** Dirty, not-refused rows of an org (or of one project), parents first. Includes tombstones. */
  listDirty(scope: { orgId: string } | { projectId: string }): Promise<SyncRecord[]>;
  /** Records server acks. Clears dirty only if the row was not edited again since; purges acked tombstones. */
  markSynced(table: SyncTable, acks: SyncAck[]): Promise<void>;
  /** Remembers a server refusal so the row is not pushed again until edited or retried. */
  markRejected(table: SyncTable, items: SyncRejection[]): Promise<void>;
  /** Makes refused rows of an org pushable again. Returns how many. */
  clearRejected(orgId: string): Promise<number>;
  /** Writes server rows without marking them dirty. Tombstones delete the local row and its children. */
  applyServerRows<T extends SyncTable>(table: T, rows: ServerApplyRow<SyncRowFor<T>>[], opts?: ApplyOptions): Promise<ApplyOutcome>;
  /** Removes a row locally without creating a tombstone (server says it is gone). */
  purgeLocal(table: SyncTable, ids: string[]): Promise<void>;
  /** Company photos whose files still need uploading. */
  listPendingPhotoUploads(orgId: string): Promise<PendingPhotoUpload[]>;
  /** Records uploaded bucket paths; marks the photo row dirty so the paths are pushed. */
  markPhotoUploaded(photoId: string, paths: { storagePath?: string; watermarkedPath?: string }): Promise<void>;
  markPhotoUploadFailed(photoId: string, reason: string): Promise<void>;
  /** Stores downloaded/cached local files for a photo (no dirty). */
  setPhotoLocalFiles(photoId: string, files: { uri?: string; watermarkedUri?: string | null }): Promise<void>;
  /** Small per-org key/value store for sync cursors. */
  getSyncState(orgId: string, key: string): Promise<string | null>;
  setSyncState(orgId: string, key: string, value: string | null): Promise<void>;
  countPending(orgId: string): Promise<PendingCounts>;
  /** Moves a local-only project and all its nodes, spans and photos into a company; everything becomes dirty. */
  moveProjectToOrg(projectId: string, orgId: string): Promise<void>;
  /** Fires after every app write (not sync writes). Returns an unsubscribe function. */
  onLocalChange(listener: (e: LocalChangeEvent) => void): () => void;
}

/** Photo file storage. Native copies into the app documents dir; web keeps data URLs. */
export interface PhotoStore {
  /** Persist a captured/picked image and return a durable URI. */
  persist(tempUri: string, photoId: string): Promise<string>;
  remove(uri: string): Promise<void>;
  /** Read as base64 (no data: prefix) for AI and exports. */
  readBase64(uri: string): Promise<string>;
}

// ---------- AI (src/ai) ----------
export interface AiAnalysisRequest {
  /** 'auto' lets the model classify the node type. */
  nodeType: NodeType | 'auto';
  imageBase64: string;
  mediaType: 'image/jpeg' | 'image/png';
  /** Field definitions for the (requested or all) node type(s); only aiFillable ones are asked for. */
  fieldDefs: FieldDef[];
  context?: { workType?: WorkType; client?: string; previousLabel?: string };
}

export interface AiFieldResult {
  value: FieldValue;
  confidence: number;
  isEstimate: boolean;
  note?: string;
}

export interface AiAnalysisResult {
  detectedType: NodeType;
  typeConfidence: number;
  fields: Record<string, AiFieldResult>;
  suggestedLabel: string | null;
  summary: string;
  warnings: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AiClient {
  analyze(req: AiAnalysisRequest): Promise<AiAnalysisResult>;
}

// ---------- Exports (src/export) ----------
export interface ExportBundle {
  project: Project;
  nodes: MapNode[];
  spans: SpanWithLength[];
  photos: PhotoRef[];
  template: ClientTemplate | null;
  /** Loads photo bytes as base64 (no prefix). Returns null if missing. Prefers watermarked copy when present. */
  loadPhotoBase64?: (photo: PhotoRef) => Promise<string | null>;
  generatedAt: string;
}

export type ExportFormat = 'kmz' | 'csv' | 'xlsx' | 'pdf' | 'geojson' | 'shapefile';

// ---------- Map (src/map) ----------
export type MapEditMode = 'select' | 'move' | 'connect';

export interface LineMapViewProps {
  nodes: MapNode[];
  spans: SpanWithLength[];
  selectedNodeId: string | null;
  selectedSpanId: string | null;
  basemap: Basemap;
  globalIconScale: number;
  editMode: MapEditMode;
  units: 'imperial' | 'metric';
  userLocation: GeoFix | null;
  /** Draw GPS accuracy circles around nodes. */
  showAccuracy: boolean;
  /** Increment to fit the camera to all nodes. */
  fitToken: number;
  /** Increment to center on userLocation. */
  centerOnUserToken: number;
  onNodePress: (id: string) => void;
  /** Fired once at end of a drag in 'move' mode. */
  onNodeMoved: (id: string, to: LatLng) => void;
  onSpanPress: (id: string) => void;
  onMapPress: (at: LatLng) => void;
  onMapLongPress?: (at: LatLng) => void;
}

// ---------- QC (src/domain/qc.ts) ----------
export interface QcIssue {
  severity: 'error' | 'warning';
  nodeId?: string;
  spanId?: string;
  message: string;
}
