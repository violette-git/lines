// Web photo file access for sync. Photos live as data URLs; remote photos are shown straight from
// their signed URL (not copied into browser storage, which is small).
import { dataUrlBytes } from './base64';

export async function readPhotoBytes(uri: string): Promise<Uint8Array> {
  const inline = dataUrlBytes(uri);
  if (inline) return inline;
  if (!uri) throw new Error('Photo data is missing (it may not have survived a page reload).');
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Could not read photo (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function downloadPhotoFile(url: string, _fileName: string): Promise<string> {
  return url;
}

/** Web does not persist downloaded photos. */
export const CACHES_TO_DISK = false;
