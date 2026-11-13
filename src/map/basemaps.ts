// Basemap configuration for the live map.
//
// Tile providers are defined in src/offline/providers.ts (one table for the map, the native tile cache
// and offline downloads). This file turns the user's map source setting into maplibre raster styles:
//   - settings.offlineTileProvider + settings.tileApiKey set (for example MapTiler with a key): that
//     provider family draws every basemap it has (satellite, hybrid, streets), online and offline.
//   - nothing set, or a key missing: the public development endpoints below (Esri World Imagery and
//     OpenStreetMap). Their terms do not allow heavy production traffic or offline storage
//     (the OSM tile usage policy forbids app traffic outright), so ship with a commercial provider.
// On native, providers that allow offline caching load through the WebView "lmtile://" protocol so
// tiles come from the phone's tile cache (src/offline/tileHost.ts). The web build always uses plain URLs.
// Styles are built as plain raster sources so no glyph/sprite servers are needed.

import type { Basemap } from '@/domain/types';

import { ENV_TILE_API_KEY, effectiveApiKey, protocolTemplate, resolveProvider, type TileProvider } from '@/offline/providers';

import type { CoreBasemap } from './core/mapCore';

/**
 * Build-time fallback key (EXPO_PUBLIC_MAPTILER_KEY). The in-app setting (settings.tileApiKey) wins.
 * Empty = use the public dev endpoints unless the user entered a key.
 */
export const TILE_API_KEY = ENV_TILE_API_KEY;

/** Max zoom the camera allows; imagery overzooms past its native max. */
export const MAP_MAX_ZOOM = 21;
/** Native max zoom of the imagery source; tiles are overzoomed beyond this. */
export const IMAGERY_SOURCE_MAX_ZOOM = 19;

const ESRI_ATTRIBUTION =
  'Powered by <a href="https://www.esri.com/">Esri</a> | Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const ESRI_BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services';

interface RasterSource {
  type: 'raster';
  tiles: string[];
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  attribution: string;
}

interface RasterLayer {
  id: string;
  type: 'raster';
  source: string;
  paint?: Record<string, unknown>;
  [k: string]: unknown;
}

function raster(url: string, maxzoom: number, attribution: string): RasterSource {
  return { type: 'raster', tiles: [url], tileSize: 256, minzoom: 0, maxzoom, attribution };
}

const IMAGERY = raster(`${ESRI_BASE}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, IMAGERY_SOURCE_MAX_ZOOM, ESRI_ATTRIBUTION);
const TRANSPORTATION = raster(
  `${ESRI_BASE}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
  IMAGERY_SOURCE_MAX_ZOOM,
  ESRI_ATTRIBUTION,
);
const PLACES = raster(
  `${ESRI_BASE}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
  IMAGERY_SOURCE_MAX_ZOOM,
  ESRI_ATTRIBUTION,
);
const STREETS = raster('https://tile.openstreetmap.org/{z}/{x}/{y}.png', 19, OSM_ATTRIBUTION);

const imageryLayer: RasterLayer = {
  id: 'bm-imagery',
  type: 'raster',
  source: 'bm-imagery',
  paint: { 'raster-fade-duration': 150 },
};

const BASEMAPS: Record<Basemap, CoreBasemap> = {
  satellite: {
    id: 'satellite',
    sources: { 'bm-imagery': IMAGERY },
    layers: [imageryLayer],
  },
  hybrid: {
    id: 'hybrid',
    sources: { 'bm-imagery': IMAGERY, 'bm-transport': TRANSPORTATION, 'bm-places': PLACES },
    layers: [
      imageryLayer,
      { id: 'bm-transport', type: 'raster', source: 'bm-transport', paint: { 'raster-opacity': 0.9 } },
      { id: 'bm-places', type: 'raster', source: 'bm-places' },
    ],
  },
  streets: {
    id: 'streets',
    sources: { 'bm-streets': STREETS },
    layers: [{ id: 'bm-streets', type: 'raster', source: 'bm-streets' }],
  },
};

export const BASEMAP_OPTIONS: Array<{ id: Basemap; label: string }> = [
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'streets', label: 'Streets' },
];

/** Raster style fragment for a basemap (sources + layers, ids prefixed "bm-"). */
/**
 * Browser preview builds (EXPO_PUBLIC_PREVIEW=1) run inside a sandbox that blocks remote map tiles,
 * so they draw a plain survey grid instead of imagery. Phone builds never take this path.
 */
export const IS_PREVIEW_BUILD = process.env.EXPO_PUBLIC_PREVIEW === '1';

function previewGrid(): CoreBasemap {
  const features: unknown[] = [];
  // ~0.0005 deg grid (about 150 ft) around the demo area and a wider coarse grid.
  const add = (minLat: number, maxLat: number, minLng: number, maxLng: number, step: number, major: boolean) => {
    for (let lat = minLat; lat <= maxLat + 1e-9; lat += step)
      features.push({ type: 'Feature', properties: { major }, geometry: { type: 'LineString', coordinates: [[minLng, lat], [maxLng, lat]] } });
    for (let lng = minLng; lng <= maxLng + 1e-9; lng += step)
      features.push({ type: 'Feature', properties: { major }, geometry: { type: 'LineString', coordinates: [[lng, minLat], [lng, maxLat]] } });
  };
  add(33.49, 33.54, -86.84, -86.77, 0.0005, false);
  add(33.4, 33.6, -86.95, -86.65, 0.005, true);
  return {
    id: 'preview',
    sources: { 'bm-grid': { type: 'geojson', data: { type: 'FeatureCollection', features } } },
    layers: [
      {
        id: 'bm-grid',
        type: 'line',
        source: 'bm-grid',
        paint: {
          'line-color': ['case', ['get', 'major'], 'rgba(120,150,180,0.35)', 'rgba(120,150,180,0.14)'],
          'line-width': ['case', ['get', 'major'], 1.2, 0.7],
        },
      },
    ],
  };
}

export interface BasemapOptions {
  /** settings.offlineTileProvider */
  providerId?: string | null;
  /** settings.tileApiKey (falls back to TILE_API_KEY) */
  apiKey?: string | null;
  /** Native WebView only: route cacheable providers through the lmtile:// protocol. */
  useTileProtocol?: boolean;
}

/** Small stable string hash so a key change re-applies the basemap without putting the key in ids. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function providerBasemap(id: Basemap, p: TileProvider, key: string, useTileProtocol: boolean): CoreBasemap {
  const cached = useTileProtocol && p.allowsOfflineCaching;
  const tiles = cached
    ? [protocolTemplate(p)]
    : p.urlTemplates.map((t) => t.replace('{key}', encodeURIComponent(key)));
  const source: RasterSource = {
    type: 'raster',
    tiles,
    tileSize: p.tileSize,
    minzoom: p.minZoom,
    maxzoom: p.maxZoom,
    attribution: p.attribution,
  };
  return {
    id: `${id}:${p.id}:${cached ? 'cache' : 'net'}:${hashString(key)}`,
    sources: { 'bm-imagery': source },
    layers: [imageryLayer],
  };
}

export function getBasemap(id: Basemap, opts?: BasemapOptions): CoreBasemap {
  if (IS_PREVIEW_BUILD) return previewGrid();
  const key = effectiveApiKey(opts?.apiKey);
  const p = resolveProvider(id, opts?.providerId, key);
  if (p) return providerBasemap(id, p, key, !!opts?.useTileProtocol);
  return BASEMAPS[id] ?? BASEMAPS.hybrid;
}
