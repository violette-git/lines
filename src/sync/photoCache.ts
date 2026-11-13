// Lazy access to company photos taken on other phones. Their rows arrive by sync with a bucket
// path but no local file. resolvePhotoUri() returns a displayable uri: the local file when there
// is one, otherwise it fetches a short-lived signed link and (on phones) downloads the file into
// the photos folder once, so it also works offline afterwards.
import { useEffect, useState } from 'react';

import { getSupabase } from '@/backend/supabase';
import { getRepository } from '@/data';
import type { PhotoRef } from '@/domain/types';
import { useStore } from '@/state/store';

import { CACHES_TO_DISK, downloadPhotoFile, readPhotoBytes } from './photoFiles';
import { createSupabaseTransport } from './supabaseTransport';
import type { SyncTransport } from './transport';

const inflight = new Map<string, Promise<string | null>>();
const linkCache = new Map<string, { url: string; expires: number }>();
const LINK_SECONDS = 3600;

let transportOverride: SyncTransport | null = null;
/** For tests. */
export function __setPhotoCacheTransport(t: SyncTransport | null) {
  transportOverride = t;
}

function transport(): SyncTransport | null {
  if (transportOverride) return transportOverride;
  const sb = getSupabase();
  return sb ? createSupabaseTransport(sb, readPhotoBytes) : null;
}

/** True when the photo has no local file yet but can be fetched from the company bucket. */
export const isRemoteOnly = (p: PhotoRef, watermarked = false) =>
  !(watermarked ? p.watermarkedUri || p.uri : p.uri) && !!(watermarked ? p.watermarkedPath ?? p.storagePath : p.storagePath);

export async function resolvePhotoUri(photo: PhotoRef, opts: { watermarked?: boolean } = {}): Promise<string | null> {
  const local = opts.watermarked ? photo.watermarkedUri || photo.uri : photo.uri;
  if (local) return local;
  const useWm = !!opts.watermarked && !!photo.watermarkedPath;
  const path = useWm ? photo.watermarkedPath : photo.storagePath;
  if (!path) return null;

  const cached = linkCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const running = inflight.get(path);
  if (running) return running;

  const job = (async () => {
    const t = transport();
    if (!t) return null;
    const url = await t.signedUrl(path, LINK_SECONDS);
    if (!CACHES_TO_DISK) {
      linkCache.set(path, { url, expires: Date.now() + (LINK_SECONDS - 120) * 1000 });
      return url;
    }
    const uri = await downloadPhotoFile(url, `${photo.id}${useWm ? '_wm' : ''}.jpg`);
    await getRepository().setPhotoLocalFiles(photo.id, useWm ? { watermarkedUri: uri } : { uri });
    void useStore.getState().applyRemoteChanges({
      projectIds: [photo.projectId],
      tables: { photos: { upserted: [photo.id], deleted: [] } },
    });
    return uri;
  })();
  inflight.set(path, job);
  try {
    return await job;
  } finally {
    inflight.delete(path);
  }
}

/** React hook: displayable uri for a photo (downloads company photos on demand). */
export function usePhotoUri(
  photo: PhotoRef | null | undefined,
  opts: { watermarked?: boolean } = {},
): { uri: string | null; loading: boolean; error: string | null } {
  const wm = !!opts.watermarked;
  const immediate = photo ? (wm ? photo.watermarkedUri || photo.uri : photo.uri) || null : null;
  const [state, setState] = useState<{ key: string | null; uri: string | null; error: string | null }>({
    key: null,
    uri: null,
    error: null,
  });
  const key = photo && !immediate ? `${photo.id}:${wm ? photo.watermarkedPath : photo.storagePath}` : null;

  useEffect(() => {
    if (!photo || !key) return;
    let alive = true;
    resolvePhotoUri(photo, { watermarked: wm }).then(
      (uri) => alive && setState({ key, uri, error: uri ? null : 'Photo not available' }),
      (e: unknown) => alive && setState({ key, uri: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
    // photo is identified by key; re-run only when the photo or its bucket path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, wm]);

  if (immediate) return { uri: immediate, loading: false, error: null };
  if (!key) return { uri: null, loading: false, error: null };
  const done = state.key === key;
  return { uri: done ? state.uri : null, loading: !done, error: done ? state.error : null };
}
