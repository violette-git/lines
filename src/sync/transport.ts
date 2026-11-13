// Wire contract between the phone and the sync RPCs in supabase/migrations/0002_sync.sql, plus
// the photo bucket. The engine only talks to a SyncTransport, so tests use a fake one.
import type { AnyServerRow, ServerRowByTable, ServerTable } from './serverMapping';

/** sync_push payload: rows per server table (partial rows allowed for tombstones). */
export type PushChanges = { [K in ServerTable]?: Partial<ServerRowByTable[K]>[] };

export type PushStatus = 'ok' | 'stale' | 'deleted' | 'gone' | 'rejected';

export interface PushRowResult {
  id: string | null;
  status: PushStatus;
  rev?: number | null;
  reason?: string;
  /** Postgres SQLSTATE for rejected rows (42501 = not allowed by the caller's role). */
  code?: string;
  /** Server's current row for stale / deleted results. */
  row?: AnyServerRow | null;
}

export interface PushResponse {
  results: { [K in ServerTable]?: PushRowResult[] };
}

/** Per-table pull cursor: (transaction id, rev) of the last row received. */
export interface PullCursor {
  txid: string;
  rev: number;
}
export type PullCursors = { [K in ServerTable]?: PullCursor };

export interface PullPage {
  rows: AnyServerRow[];
  cursor: PullCursor;
  has_more: boolean;
}

export interface PullResponse {
  watermark?: string;
  /** The server cannot continue from these cursors (database restored): start over. */
  reset?: boolean;
  tables?: { [K in ServerTable]?: PullPage };
}

export interface SyncTransport {
  push(orgId: string, changes: PushChanges): Promise<PushResponse>;
  pull(orgId: string, since: PullCursors, limit: number): Promise<PullResponse>;
  /** Uploads (overwriting) a local photo file to the 'photos' bucket. */
  uploadPhoto(path: string, localUri: string, contentType: 'image/jpeg' | 'image/png'): Promise<void>;
  /** Short-lived download URL for a bucket object. */
  signedUrl(path: string, expiresInSec: number): Promise<string>;
}

/** Error from the server or network, with the Postgres / HTTP code when there is one. */
export class SyncTransportError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'SyncTransportError';
  }
}

export const contentTypeFor = (uri: string): 'image/jpeg' | 'image/png' =>
  /\.png($|\?)/i.test(uri) || uri.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
