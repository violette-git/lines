// Native tile storage on expo-file-system 58 (File / Directory / Paths API).
//
//   <documents>/tiles/<provider>/<z>/<x>/<y>.<ext>   tiles of saved offline areas (kept until deleted)
//   <cache>/tiles/<provider>/<z>/<x>/<y>.<ext>       browsing cache (the OS may clear it when low on space)
//   <documents>/offline/areas.json                  saved-area index and download progress
//
// Only used on Android/iOS. The web build never caches tiles.
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import type { TileProvider } from './providers';
import { tileRelPath, type TileCoord } from './tileMath';

/** Identifies the app to tile servers (the OSM policy requires a real User-Agent). */
const TILE_HEADERS = { 'User-Agent': 'LineMapPro/1.0 (offline maps)' };
/** Smallest believable tile (a 1x1 PNG is 67 bytes). */
const MIN_TILE_BYTES = 67;
/** Anything larger is not a map tile. */
const MAX_TILE_BYTES = 4 * 1024 * 1024;

export type TileStoreKind = 'area' | 'browse';

function rootFor(kind: TileStoreKind): Directory {
  return new Directory(kind === 'area' ? Paths.document : Paths.cache, 'tiles');
}

export function tileFile(kind: TileStoreKind, p: TileProvider, t: TileCoord): File {
  return new File(rootFor(kind), ...tileRelPath(p.id, t, p.ext));
}

const madeDirs = new Set<string>();

function ensureParent(kind: TileStoreKind, p: TileProvider, t: TileCoord): void {
  const key = `${kind}/${p.id}/${t.z}/${t.x}`;
  if (madeDirs.has(key)) return;
  const dir = new Directory(rootFor(kind), p.id, String(t.z), String(t.x));
  dir.create({ intermediates: true, idempotent: true });
  madeDirs.add(key);
}

/** Image signature check: PNG, JPEG or WebP. */
export function looksLikeImage(head: Uint8Array): boolean {
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return true;
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  )
    return true;
  return false;
}

/** Size in bytes when the file is a plausible tile image, else 0. */
export function verifiedTileSize(f: File): number {
  if (!f.exists) return 0;
  const size = f.size;
  if (!(size >= MIN_TILE_BYTES) || size > MAX_TILE_BYTES) return 0;
  let handle: ReturnType<File['open']> | null = null;
  try {
    handle = f.open(FileMode.ReadOnly);
    const head = handle.readBytesSync(12);
    return looksLikeImage(head) ? size : 0;
  } catch {
    // File handles unavailable: trust the size check.
    return size;
  } finally {
    try {
      handle?.close();
    } catch {
      // ignore
    }
  }
}

function safeDelete(f: File): void {
  try {
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}

/**
 * Downloads one tile to <kind>/... through a ".part" file, verifies it, then moves it into place so a
 * reader never sees a half-written tile. Returns the verified size. Throws on any failure.
 */
export async function downloadTile(
  kind: TileStoreKind,
  p: TileProvider,
  t: TileCoord,
  url: string,
  signal?: AbortSignal,
): Promise<number> {
  ensureParent(kind, p, t);
  const final = tileFile(kind, p, t);
  const part = new File(final.parentDirectory, `${t.y}.${p.ext}.part`);
  safeDelete(part);
  try {
    await File.downloadFileAsync(url, part, { idempotent: true, headers: TILE_HEADERS, signal });
    const size = verifiedTileSize(part);
    if (!size) throw new Error('Downloaded tile is empty or not an image');
    await part.move(final, { overwrite: true });
    return size;
  } catch (err) {
    safeDelete(part);
    throw err;
  }
}

/** Reads a stored tile as base64: saved areas first, then the browsing cache. */
export async function readTileBase64(p: TileProvider, t: TileCoord): Promise<string | null> {
  for (const kind of ['area', 'browse'] as const) {
    const f = tileFile(kind, p, t);
    if (f.exists) {
      try {
        const b64 = await f.base64();
        if (b64) return b64;
      } catch {
        // unreadable file: fall through
      }
    }
  }
  return null;
}

/** Network fetch into the browsing cache, returning base64 (used by the live map). */
export async function fetchToBrowseCache(p: TileProvider, t: TileCoord, url: string, signal: AbortSignal): Promise<string | null> {
  try {
    await downloadTile('browse', p, t, url, signal);
    return await tileFile('browse', p, t).base64();
  } catch {
    return null;
  }
}

export function areaTileSize(p: TileProvider, t: TileCoord): number {
  try {
    return verifiedTileSize(tileFile('area', p, t));
  } catch {
    return 0;
  }
}

export function removeAreaTile(p: TileProvider, t: TileCoord): void {
  safeDelete(tileFile('area', p, t));
}

function dirSize(d: Directory): number {
  try {
    if (!d.exists) return 0;
    const s = d.size;
    return typeof s === 'number' && s > 0 ? s : 0;
  } catch {
    return 0;
  }
}

export function areaStoreBytes(): number {
  return dirSize(rootFor('area'));
}

export function browseCacheBytes(): number {
  return dirSize(rootFor('browse'));
}

export function clearBrowseCache(): void {
  try {
    const d = rootFor('browse');
    if (d.exists) d.delete();
  } catch {
    // ignore
  }
  for (const k of Array.from(madeDirs)) if (k.startsWith('browse/')) madeDirs.delete(k);
}

export function freeDiskBytes(): number | null {
  try {
    const v = Paths.availableDiskSpace;
    return typeof v === 'number' && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function indexFile(): File {
  return new File(Paths.document, 'offline', 'areas.json');
}

export async function readIndexJson(): Promise<unknown | null> {
  const f = indexFile();
  if (!f.exists) return null;
  try {
    return JSON.parse(await f.text()) as unknown;
  } catch {
    return null;
  }
}

/** Writes the index atomically (temp file + move) so a crash never leaves half a JSON file. */
export async function writeIndexJson(data: unknown): Promise<void> {
  const dir = new Directory(Paths.document, 'offline');
  dir.create({ intermediates: true, idempotent: true });
  const tmp = new File(dir, 'areas.json.tmp');
  await tmp.write(JSON.stringify(data));
  await tmp.move(indexFile(), { overwrite: true });
}
