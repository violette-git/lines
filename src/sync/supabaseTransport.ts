// SyncTransport over Supabase: the sync_push / sync_pull RPCs and the private 'photos' bucket.
import type { SupabaseClient } from '@supabase/supabase-js';

import { toArrayBuffer } from './base64';
import { PHOTO_BUCKET } from './serverMapping';
import {
  SyncTransportError,
  type PullCursors,
  type PullResponse,
  type PushChanges,
  type PushResponse,
  type SyncTransport,
} from './transport';

export function createSupabaseTransport(
  client: SupabaseClient,
  readBytes: (uri: string) => Promise<Uint8Array>,
): SyncTransport {
  return {
    async push(orgId: string, changes: PushChanges): Promise<PushResponse> {
      const { data, error } = await client.rpc('sync_push', { org: orgId, changes });
      if (error) throw new SyncTransportError(error.message, error.code ?? null);
      const res = data as PushResponse | null;
      return { results: res?.results ?? {} };
    },

    async pull(orgId: string, since: PullCursors, limit: number): Promise<PullResponse> {
      const { data, error } = await client.rpc('sync_pull', { org: orgId, since, row_limit: limit });
      if (error) throw new SyncTransportError(error.message, error.code ?? null);
      return (data as PullResponse | null) ?? {};
    },

    async uploadPhoto(path, localUri, contentType) {
      const bytes = await readBytes(localUri);
      const { error } = await client.storage
        .from(PHOTO_BUCKET)
        .upload(path, toArrayBuffer(bytes), { contentType, upsert: true, cacheControl: '31536000' });
      if (error) throw new SyncTransportError(error.message, null);
    },

    async signedUrl(path, expiresInSec) {
      const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(path, expiresInSec);
      if (error || !data) throw new SyncTransportError(error?.message ?? 'Could not get a photo link', null);
      return data.signedUrl;
    },
  };
}
