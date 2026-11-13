// Web photo storage: photos are kept as data URLs so they survive object URL revocation and can be
// persisted with the rest of the data.
import type { PhotoStore } from '@/domain/contracts';

export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return dataUrl.startsWith('data:') && comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(blob);
  });
}

async function uriToDataUrl(uri: string): Promise<string> {
  if (uri.startsWith('data:')) return uri;
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Could not load image (${res.status})`);
  return blobToDataUrl(await res.blob());
}

export function createWebPhotoStore(): PhotoStore {
  return {
    async persist(tempUri) {
      // The temp blob: URL is not revoked here; the caller may still be showing it.
      return uriToDataUrl(tempUri);
    },
    async remove(uri) {
      if (uri?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(uri);
        } catch {
          /* ignore */
        }
      }
      // data URLs live inside the repository record; nothing else to free.
    },
    async readBase64(uri) {
      if (!uri) throw new Error('Photo data is missing (it may not have survived a page reload).');
      return stripDataUrlPrefix(await uriToDataUrl(uri));
    },
  };
}
