// Native photo file access for sync: read bytes to upload, download a bucket object into the app's
// documents folder (same folder as captured photos). Uses the SDK 58 expo-file-system object API.
import { Directory, File, Paths } from 'expo-file-system';

import { PHOTO_DIR_NAME } from '@/data/nativePhotoStore';

import { dataUrlBytes } from './base64';

export async function readPhotoBytes(uri: string): Promise<Uint8Array> {
  const inline = dataUrlBytes(uri);
  if (inline) return inline;
  const f = new File(uri);
  if (!f.exists) throw new Error('The photo file is missing on this phone');
  return f.bytes();
}

/** Downloads url to <documents>/photos/<fileName> and returns the local uri. */
export async function downloadPhotoFile(url: string, fileName: string): Promise<string> {
  const dir = new Directory(Paths.document, PHOTO_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, fileName);
  const file = await File.downloadFileAsync(url, dest, { idempotent: true });
  return file.uri;
}

/** Native keeps downloaded photos on disk. */
export const CACHES_TO_DISK = true;
