// Map tile providers: one table that drives the live map (src/map/basemaps.ts), the native tile cache
// and the offline area downloader. Licensing rules live here so every screen enforces the same thing.
//
// LICENSING SUMMARY (read before changing allowsOfflineCaching):
//  - MapTiler Cloud: needs an API key. Its standard terms allow a temporary per-user device cache but
//    prohibit "batch or excessive bulk download of map tiles" unless MapTiler agrees in writing.
//    Offline area downloads are therefore offered only after the user confirms their company has a
//    MapTiler plan or written agreement that covers offline use (see requiresAgreement).
//  - Esri World Imagery (public endpoint): online viewing only, no bulk download, no offline storage.
//  - OpenStreetMap standard tiles: the OSM tile usage policy forbids bulk downloading ("prefetching")
//    and is not meant for heavy app traffic. Online viewing only.
//  - "Test tiles": the OSM server again, but capped at 500 tiles per area so developers can exercise
//    the offline pipeline on a few blocks. Not for production use.
import type { Basemap } from '@/domain/types';

import type { TileCoord } from './tileMath';

export type StyleKind = 'satellite' | 'streets' | 'hybrid';

export interface TileProvider {
  id: string;
  name: string;
  /** Providers in one family share a key and are swapped together per basemap (MapTiler satellite/hybrid/streets). */
  family: string;
  styleKind: StyleKind;
  /** URL templates with {z} {x} {y} and optional {key}. More than one = mirrors. */
  urlTemplates: string[];
  ext: 'jpg' | 'png' | 'webp';
  tileSize: 256 | 512;
  minZoom: number;
  /** Native max zoom of the tiles (the map overzooms past it). */
  maxZoom: number;
  attribution: string;
  /** May tiles be stored on the device for offline use (area downloads and the browsing cache). */
  allowsOfflineCaching: boolean;
  /** True when offline use additionally needs a paid plan or written permission the user must confirm. */
  requiresAgreement: boolean;
  needsKey: boolean;
  termsUrl: string;
  /** Hard cap per downloaded area (test provider only). */
  maxTilesPerArea?: number;
  /** Rough average tile size used for storage estimates before a download. */
  avgTileBytes: number;
  /** Plain-language licensing note shown in the app. */
  note: string;
  /** Development helper, hidden from the map source picker in production builds. */
  devOnly?: boolean;
}

/** Build-time MapTiler key (EXPO_PUBLIC_MAPTILER_KEY). The in-app key (settings.tileApiKey) wins. */
export const ENV_TILE_API_KEY: string = process.env.EXPO_PUBLIC_MAPTILER_KEY ?? '';

/** The key to use: the in-app setting, else the build-time key. */
export function effectiveApiKey(settingKey: string | null | undefined): string {
  return (settingKey ?? '').trim() || ENV_TILE_API_KEY.trim();
}

/** Absolute cap for one saved area, whatever the provider (60k tiles is roughly 170 km2 to zoom 19). */
export const MAX_TILES_PER_AREA = 60000;

const MAPTILER_ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a>';
const ESRI_ATTRIBUTION =
  'Powered by <a href="https://www.esri.com/">Esri</a> | Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const MAPTILER_TERMS = 'https://www.maptiler.com/terms/cloud/';
const MAPTILER_NOTE =
  'Needs a MapTiler API key. MapTiler lets the app keep a short-term cache on your phone, but saving whole areas for offline use needs a MapTiler plan or written agreement that allows it. Check your plan before downloading.';

export const PROVIDERS: TileProvider[] = [
  {
    id: 'maptiler-satellite',
    name: 'MapTiler Satellite',
    family: 'maptiler',
    styleKind: 'satellite',
    urlTemplates: ['https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}.jpg?key={key}'],
    ext: 'jpg',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 20,
    attribution: MAPTILER_ATTRIBUTION,
    allowsOfflineCaching: true,
    requiresAgreement: true,
    needsKey: true,
    termsUrl: MAPTILER_TERMS,
    avgTileBytes: 28 * 1024,
    note: MAPTILER_NOTE,
  },
  {
    id: 'maptiler-hybrid',
    name: 'MapTiler Hybrid',
    family: 'maptiler',
    styleKind: 'hybrid',
    urlTemplates: ['https://api.maptiler.com/maps/hybrid/256/{z}/{x}/{y}.jpg?key={key}'],
    ext: 'jpg',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 20,
    attribution: MAPTILER_ATTRIBUTION,
    allowsOfflineCaching: true,
    requiresAgreement: true,
    needsKey: true,
    termsUrl: MAPTILER_TERMS,
    avgTileBytes: 32 * 1024,
    note: MAPTILER_NOTE,
  },
  {
    id: 'maptiler-streets',
    name: 'MapTiler Streets',
    family: 'maptiler',
    styleKind: 'streets',
    urlTemplates: ['https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key={key}'],
    ext: 'png',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 20,
    attribution: MAPTILER_ATTRIBUTION,
    allowsOfflineCaching: true,
    requiresAgreement: true,
    needsKey: true,
    termsUrl: MAPTILER_TERMS,
    avgTileBytes: 18 * 1024,
    note: MAPTILER_NOTE,
  },
  {
    id: 'esri-imagery',
    name: 'Esri World Imagery',
    family: 'esri',
    styleKind: 'satellite',
    urlTemplates: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    ext: 'jpg',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 19,
    attribution: ESRI_ATTRIBUTION,
    allowsOfflineCaching: false,
    requiresAgreement: false,
    needsKey: false,
    termsUrl: 'https://www.esri.com/en-us/legal/terms/full-master-agreement',
    avgTileBytes: 25 * 1024,
    note: 'Free satellite photos for viewing while you have signal. Esri does not allow saving these tiles for offline use, so this source works online only.',
  },
  {
    id: 'osm-standard',
    name: 'OpenStreetMap',
    family: 'osm',
    styleKind: 'streets',
    urlTemplates: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    ext: 'png',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 19,
    attribution: OSM_ATTRIBUTION,
    allowsOfflineCaching: false,
    requiresAgreement: false,
    needsKey: false,
    termsUrl: 'https://operations.osmfoundation.org/policies/tiles/',
    avgTileBytes: 15 * 1024,
    note: 'Street map run by volunteers. Their rules forbid downloading areas in bulk, so this source works online only.',
  },
  {
    id: 'test-osm',
    name: 'Test tiles (OSM, small areas only, dev use)',
    family: 'test',
    styleKind: 'streets',
    urlTemplates: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    ext: 'png',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 19,
    attribution: OSM_ATTRIBUTION,
    allowsOfflineCaching: true,
    requiresAgreement: false,
    needsKey: false,
    termsUrl: 'https://operations.osmfoundation.org/policies/tiles/',
    maxTilesPerArea: 500,
    avgTileBytes: 15 * 1024,
    note: 'For developers testing offline maps on a few blocks. Limited to 500 tiles per area. Do not use in production.',
    devOnly: true,
  },
];

export const PROVIDER_BY_ID: Record<string, TileProvider> = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

export function getProvider(id: string | null | undefined): TileProvider | null {
  return id ? PROVIDER_BY_ID[id] ?? null : null;
}

/** Real network URL for a tile. Returns null when the provider needs a key and none is set. */
export function tileUrl(p: TileProvider, t: TileCoord, apiKey?: string | null, mirror = 0): string | null {
  const key = (apiKey ?? '').trim();
  if (p.needsKey && !key) return null;
  const tpl = p.urlTemplates[Math.abs(mirror) % p.urlTemplates.length];
  return tpl
    .replace('{z}', String(t.z))
    .replace('{x}', String(t.x))
    .replace('{y}', String(t.y))
    .replace('{key}', encodeURIComponent(key));
}

/** The custom-protocol URL template the WebView map uses for cached providers. */
export function protocolTemplate(p: TileProvider): string {
  return `lmtile://${p.id}/{z}/{x}/{y}`;
}

/** Provider family assumed when a key is set but no map source was picked (keys are MapTiler keys). */
export const DEFAULT_KEYED_PROVIDER_ID = 'maptiler-satellite';

/**
 * Which provider draws a basemap, given the user's map source setting.
 * Returns null to mean "use the built-in development endpoints" (Esri imagery + OSM streets).
 * A key with no explicit source selects MapTiler, so entering a key alone switches the live map too.
 */
export function resolveProvider(basemap: Basemap, selectedId: string | null | undefined, apiKey: string | null | undefined): TileProvider | null {
  const hasKey = !!(apiKey ?? '').trim();
  const selected = getProvider(selectedId) ?? (hasKey ? getProvider(DEFAULT_KEYED_PROVIDER_ID) : null);
  if (!selected) return null;
  if (selected.needsKey && !hasKey) return null;
  const sameFamily = PROVIDERS.find((p) => p.family === selected.family && p.styleKind === basemap);
  if (sameFamily) return sameFamily;
  return null;
}

export type DownloadGate = { ok: true } | { ok: false; reason: string; code: 'no_caching' | 'needs_key' | 'too_many' | 'needs_agreement' | 'empty' | 'unknown' };

/**
 * Whether a bulk download of tileCount tiles is allowed. Every refusal carries a plain-language reason.
 * agreementConfirmed: the user ticked "my company has a plan that allows offline downloads".
 */
export function canBulkDownload(
  p: TileProvider | null,
  opts: { apiKey?: string | null; tileCount: number; agreementConfirmed?: boolean },
): DownloadGate {
  if (!p) return { ok: false, code: 'unknown', reason: 'Pick a map source first.' };
  if (!p.allowsOfflineCaching) {
    return {
      ok: false,
      code: 'no_caching',
      reason: `${p.name} does not allow saving its map tiles on your phone, so it can only be used while you have signal. Pick a source that allows offline use, such as MapTiler with a plan that covers it.`,
    };
  }
  if (p.needsKey && !(opts.apiKey ?? '').trim()) {
    return { ok: false, code: 'needs_key', reason: `${p.name} needs an API key. Add your key under Map source first.` };
  }
  if (!(opts.tileCount > 0)) return { ok: false, code: 'empty', reason: 'This area has no map tiles. Pick a bigger area.' };
  const cap = Math.min(MAX_TILES_PER_AREA, p.maxTilesPerArea ?? MAX_TILES_PER_AREA);
  if (opts.tileCount > cap) {
    return {
      ok: false,
      code: 'too_many',
      reason: p.maxTilesPerArea
        ? `${p.name} is limited to ${cap.toLocaleString('en-US')} tiles per area and this area needs ${opts.tileCount.toLocaleString('en-US')}. Zoom in to a smaller area or lower the detail level.`
        : `That area needs ${opts.tileCount.toLocaleString('en-US')} tiles, over the ${cap.toLocaleString('en-US')} tile limit for one area. Split it into smaller areas or lower the detail level.`,
    };
  }
  if (p.requiresAgreement && !opts.agreementConfirmed) {
    return {
      ok: false,
      code: 'needs_agreement',
      reason: `${p.name} only allows saving areas for offline use if your company's plan or a written agreement covers it. Confirm that before downloading.`,
    };
  }
  return { ok: true };
}

/** Default zoom range for downloads: imagery to 19, street maps to 18, clamped to the provider. */
export function defaultZoomRange(p: TileProvider): { minZoom: number; maxZoom: number } {
  const wanted = p.styleKind === 'streets' ? 18 : 19;
  return { minZoom: Math.max(p.minZoom, 12), maxZoom: Math.min(p.maxZoom, wanted) };
}
