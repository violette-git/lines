// Native photo storage using the SDK 58 expo-file-system object API (File / Directory / Paths).
// Photos are copied to <documents>/photos/<photoId>.jpg so they survive cache clears.
import { Directory, File, Paths } from 'expo-file-system';

import type { PhotoStore } from '@/domain/contracts';

export const PHOTO_DIR_NAME = 'photos';

function stripDataUrl(uri: string): string | null {
  if (!uri.startsWith('data:')) return null;
  const comma = uri.indexOf(',');
  return comma >= 0 ? uri.slice(comma + 1) : '';
}

export function createNativePhotoStore(): PhotoStore {
  function photoDir(): Directory {
    const dir = new Directory(Paths.document, PHOTO_DIR_NAME);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return dir;
  }

  return {
    async persist(tempUri, photoId) {
      const dir = photoDir();
      const ext = /\.png($|\?)/i.test(tempUri) ? 'png' : 'jpg';
      const dest = new File(dir, `${photoId}.${ext}`);
      if (dest.uri === tempUri) return dest.uri;
      if (dest.exists) dest.delete();
      const inline = stripDataUrl(tempUri);
      if (inline != null) {
        dest.create({ intermediates: true, overwrite: true });
        // write() is async in expo-file-system 58; awaiting it ensures the file is complete before use.
        await dest.write(inline, { encoding: 'base64' });
      } else {
        const src = new File(tempUri);
        await src.copy(dest, { overwrite: true });
      }
      return dest.uri;
    },

    async remove(uri) {
      if (!uri || uri.startsWith('data:')) return;
      try {
        const f = new File(uri);
        if (f.exists) f.delete();
      } catch {
        // Best effort: a missing file is not an error for callers.
      }
    },

    async readBase64(uri) {
      const inline = stripDataUrl(uri);
      if (inline != null) return inline;
      const f = new File(uri);
      if (!f.exists) throw new Error(`Photo file not found: ${uri}`);
      return f.base64();
    },
  };
}
