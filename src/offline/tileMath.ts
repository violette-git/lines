// Pure slippy-map tile math for offline downloads (Web Mercator XYZ, the scheme every provider here uses).
// No platform imports: unit tested in src/offline/__tests__/tileMath.test.ts.

/** [west, south, east, north] in degrees. West must be less than east (no antimeridian crossing). */
export type BBox = [number, number, number, number];

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** Inclusive tile index range for one zoom level. */
export interface TileRange {
  z: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Latitude limit of the Web Mercator square. */
export const MAX_MERCATOR_LAT = 85.0511287798;
const M_PER_DEG_LAT = 111320;

export function clampLat(lat: number): number {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

export function lngToTileX(lng: number, z: number): number {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  return Math.max(0, Math.min(n - 1, x));
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const r = (clampLat(lat) * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return Math.max(0, Math.min(n - 1, y));
}

/** North-west corner of a tile in degrees (useful for tests and previews). */
export function tileToLngLat(x: number, y: number, z: number): { lng: number; lat: number } {
  const n = 2 ** z;
  const lng = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lng, lat };
}

export function isValidBBox(b: BBox | null | undefined): b is BBox {
  if (!b || b.length !== 4) return false;
  const [w, s, e, n] = b;
  if (![w, s, e, n].every(Number.isFinite)) return false;
  return w >= -180 && e <= 180 && w < e && s >= -90 && n <= 90 && s < n;
}

export function tileRangeForBBox(b: BBox, z: number): TileRange {
  const [w, s, e, n] = b;
  return { z, minX: lngToTileX(w, z), maxX: lngToTileX(e, z), minY: latToTileY(n, z), maxY: latToTileY(s, z) };
}

export function rangeCount(r: TileRange): number {
  return (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
}

export function tileRanges(b: BBox, minZoom: number, maxZoom: number): TileRange[] {
  const out: TileRange[] = [];
  for (let z = Math.max(0, Math.floor(minZoom)); z <= Math.floor(maxZoom); z++) out.push(tileRangeForBBox(b, z));
  return out;
}

export function countTiles(b: BBox, minZoom: number, maxZoom: number): number {
  return tileRanges(b, minZoom, maxZoom).reduce((sum, r) => sum + rangeCount(r), 0);
}

/**
 * The idx-th tile in the canonical download order (zoom ascending, then x, then y), or null past the end.
 * Deterministic order lets a download resume from a persisted cursor.
 */
export function tileAtIndex(ranges: TileRange[], idx: number): TileCoord | null {
  if (!(idx >= 0)) return null;
  let rest = Math.floor(idx);
  for (const r of ranges) {
    const c = rangeCount(r);
    if (rest < c) {
      const h = r.maxY - r.minY + 1;
      return { z: r.z, x: r.minX + Math.floor(rest / h), y: r.minY + (rest % h) };
    }
    rest -= c;
  }
  return null;
}

export function* iterateTiles(ranges: TileRange[]): Generator<TileCoord> {
  for (const r of ranges) {
    for (let x = r.minX; x <= r.maxX; x++) {
      for (let y = r.minY; y <= r.maxY; y++) yield { z: r.z, x, y };
    }
  }
}

export function tileInRanges(ranges: TileRange[], t: TileCoord): boolean {
  for (const r of ranges) {
    if (r.z === t.z) return t.x >= r.minX && t.x <= r.maxX && t.y >= r.minY && t.y <= r.maxY;
  }
  return false;
}

/** Stable key for reference counting and LRU caches: "<provider>/<z>/<x>/<y>". */
export function tileKey(providerId: string, t: TileCoord): string {
  return `${providerId}/${t.z}/${t.x}/${t.y}`;
}

/** Relative path of a stored tile under the tiles root: "<provider>/<z>/<x>/<y>.<ext>". */
export function tileRelPath(providerId: string, t: TileCoord, ext: string): string[] {
  return [providerId, String(t.z), String(t.x), `${t.y}.${ext}`];
}

/**
 * Bounding box around points, grown by bufferM meters on every side (also gives a single point an area).
 * Returns null when there are no valid points.
 */
export function bboxAroundPoints(points: Array<{ lat: number; lng: number }>, bufferM: number): BBox | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  if (!Number.isFinite(w)) return null;
  const buf = Math.max(0, bufferM);
  const dLat = buf / M_PER_DEG_LAT;
  const midLat = (s + n) / 2;
  const dLng = buf / (M_PER_DEG_LAT * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
  return [
    Math.max(-180, w - dLng),
    clampLat(s - dLat),
    Math.min(180, e + dLng),
    clampLat(n + dLat),
  ];
}

/** Approximate ground size of a bbox in meters (width at the middle latitude, height). */
export function bboxSizeM(b: BBox): { widthM: number; heightM: number } {
  const [w, s, e, n] = b;
  const midLat = (s + n) / 2;
  return {
    widthM: (e - w) * M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180),
    heightM: (n - s) * M_PER_DEG_LAT,
  };
}

export interface AreaEstimate {
  tiles: number;
  bytes: number;
  perZoom: Array<{ z: number; tiles: number }>;
}

/** Tile count and rough storage for an area. avgTileBytes comes from the provider config. */
export function estimateArea(b: BBox, minZoom: number, maxZoom: number, avgTileBytes: number): AreaEstimate {
  const perZoom = tileRanges(b, minZoom, maxZoom).map((r) => ({ z: r.z, tiles: rangeCount(r) }));
  const tiles = perZoom.reduce((a, p) => a + p.tiles, 0);
  return { tiles, bytes: tiles * Math.max(0, avgTileBytes), perZoom };
}

/** "820 KB", "14.2 MB", "1.31 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Parses "lmtile://<provider>/<z>/<x>/<y>" (an optional extension or query is ignored). */
export function parseTileUrl(url: string): { providerId: string; tile: TileCoord } | null {
  const m = /^lmtile:\/\/([a-z0-9-]+)\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})(?:\.\w+)?(?:\?.*)?$/i.exec(url);
  if (!m) return null;
  const z = Number(m[2]);
  const x = Number(m[3]);
  const y = Number(m[4]);
  const n = 2 ** z;
  if (z > 24 || x >= n || y >= n) return null;
  return { providerId: m[1], tile: { z, x, y } };
}

/**
 * Tiles of `area` that no other area covers (same provider assumed by the caller).
 * Used when deleting a saved area so shared tiles stay on disk.
 */
export function* exclusiveTiles(area: TileRange[], others: TileRange[][]): Generator<TileCoord> {
  for (const t of iterateTiles(area)) {
    let shared = false;
    for (const o of others) {
      if (tileInRanges(o, t)) {
        shared = true;
        break;
      }
    }
    if (!shared) yield t;
  }
}
