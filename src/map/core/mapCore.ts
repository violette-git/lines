/*
 * LineMap core map engine. Shared by every platform:
 *  - web: imported directly by LineMapView.web.tsx with the npm maplibre-gl module
 *  - native: transpiled by scripts/build-map-bundle.mjs into plain JS and inlined in the WebView HTML
 *
 * RULES FOR THIS FILE (the native build depends on them):
 *  - No imports of any kind (not even type imports). Everything it needs is passed in.
 *  - Top level `export` only directly before `function`, `const`, `interface` or `type`.
 *    The build script strips those keywords to produce a plain script.
 *  - Only browser APIs that exist in Android System WebView and WKWebView.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- types

export type CoreEditMode = 'select' | 'move' | 'connect';
export type CoreUnits = 'imperial' | 'metric';

export interface CoreNode {
  id: string;
  lat: number;
  lng: number;
  /** NodeType string, selects the icon shape. */
  type: string;
  label: string;
  /** Fill color (NODE_TYPE_META color). */
  color: string;
  /** Short code drawn inside the icon (NODE_TYPE_META short). */
  short: string;
  /** Per-node icon multiplier (MapNode.iconScale). */
  scale: number;
  status: string;
  dup: boolean;
  accuracyM: number | null;
}

export interface CoreSpan {
  id: string;
  from: string;
  to: string;
  kind: 'aerial' | 'underground';
  sagPct: number;
  slackFt: number;
  overrideFt: number | null;
  /** Authoritative footage from the geo module, used when no live drag is in progress. */
  totalFt: number;
}

export interface CoreBasemap {
  id: string;
  /** maplibre raster source specs keyed by source id (ids must start with "bm-"). */
  sources: Record<string, unknown>;
  /** maplibre raster layer specs (ids must start with "bm-"). */
  layers: Array<{ id: string; [k: string]: unknown }>;
}

export interface CoreUser {
  lat: number;
  lng: number;
  accuracyM: number | null;
}

export interface CoreState {
  nodes: CoreNode[];
  spans: CoreSpan[];
  selectedNodeId: string | null;
  selectedSpanId: string | null;
  basemap: CoreBasemap;
  globalIconScale: number;
  editMode: CoreEditMode;
  units: CoreUnits;
  user: CoreUser | null;
  showAccuracy: boolean;
}

export type CoreEvent =
  | { type: 'loaded' }
  | { type: 'nodePress'; id: string }
  | { type: 'nodeMoved'; id: string; lat: number; lng: number }
  | { type: 'spanPress'; id: string }
  | { type: 'mapPress'; lat: number; lng: number }
  | { type: 'mapLongPress'; lat: number; lng: number }
  | { type: 'openUrl'; url: string }
  | { type: 'error'; message: string };

/** Visible area of the map: bounds as [west, south, east, north] plus zoom. */
export interface CoreView {
  bounds: [number, number, number, number];
  zoom: number;
  center: { lat: number; lng: number };
}

export interface LineMapController {
  setState(state: CoreState): void;
  /** Current camera view, or null before the map has a size. */
  getView(): CoreView | null;
  /** Re-request basemap tiles (for example after the network came back and earlier tiles failed). */
  reloadTiles(): void;
  /** Fit camera to all nodes (padding 60, max zoom 19). Falls back to the user location. */
  fit(animate?: boolean): void;
  centerOn(lat: number, lng: number, zoom?: number): void;
  /** JPEG data URL of the map with nodes and footage labels composited, or null on failure. */
  snapshot(): Promise<string | null>;
  resize(): void;
  destroy(): void;
}

export interface CreateLineMapOptions {
  showZoomButtons?: boolean;
}

// ---------------------------------------------------------------- constants

export const BASE_ICON_PX = 28;
export const FT_PER_M = 3.280839895;
const EARTH_R_M = 6371008.8;
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;
const FIT_PADDING = 60;
const FIT_MAX_ZOOM = 19;
const LABEL_MIN_ZOOM = 15;
const SPAN_LABEL_MIN_ZOOM = 16;
const US_CENTER: [number, number] = [-98.58, 39.83];
const US_ZOOM = 3.2;
const FIRST_OVERLAY_LAYER = 'lm-acc-fill';
const COLOR_AERIAL = '#FFB547';
const COLOR_AERIAL_SEL = '#FFE6A8';
const COLOR_UG = '#33D6E8';
const COLOR_UG_SEL = '#B8F6FF';
const COLOR_DARK = '#0B0F14';
const COLOR_USER = '#2F80FF';

// ---------------------------------------------------------------- pure helpers (unit tested)

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Same rule as geo/spanTotalFt: override ?? straight * (1 + sag/100) + slack. */
export function spanTotalFt(straightFt: number, sagPct: number, slackFt: number, overrideFt: number | null): number {
  if (overrideFt != null && Number.isFinite(overrideFt)) return overrideFt;
  const sag = Number.isFinite(sagPct) ? sagPct : 0;
  const slack = Number.isFinite(slackFt) ? slackFt : 0;
  return straightFt * (1 + sag / 100) + slack;
}

export function groupThousands(n: number): string {
  const r = Math.round(n);
  const sign = r < 0 ? '-' : '';
  return sign + String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Compact length for map pills: "245 ft", "6,600 ft", "74.7 m", "1.23 km". */
export function formatSpanLength(ft: number, units: CoreUnits): string {
  if (!Number.isFinite(ft)) return '--';
  if (units === 'metric') {
    const m = ft / FT_PER_M;
    if (Math.abs(m) >= 1000) return (m / 1000).toFixed(2) + ' km';
    return m.toFixed(1) + ' m';
  }
  return groupThousands(ft) + ' ft';
}

/** Closed polygon ring ([lng, lat] pairs) approximating a geodesic circle. */
export function circlePolygon(lat: number, lng: number, radiusM: number, steps = 48): Array<[number, number]> {
  const n = Math.max(8, Math.floor(steps));
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = lat * toRad;
  const lng1 = lng * toRad;
  const d = Math.max(0, radiusM) / EARTH_R_M;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const brg = (2 * Math.PI * i) / n;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lng2 =
      lng1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([((lng2 * toDeg + 540) % 360) - 180, lat2 * toDeg]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

export interface IdDiff {
  added: string[];
  removed: string[];
  kept: string[];
}

export function diffIds(prev: Iterable<string>, next: Iterable<string>): IdDiff {
  const prevSet = new Set<string>(prev);
  const nextSet = new Set<string>();
  const added: string[] = [];
  const kept: string[] = [];
  for (const id of next) {
    if (nextSet.has(id)) continue;
    nextSet.add(id);
    if (prevSet.has(id)) kept.push(id);
    else added.push(id);
  }
  const removed: string[] = [];
  prevSet.forEach((id) => {
    if (!nextSet.has(id)) removed.push(id);
  });
  return { added, removed, kept };
}

/** [[west, south], [east, north]] or null when empty. */
export function computeBounds(points: Array<{ lat: number; lng: number }>): [[number, number], [number, number]] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.lng < w) w = p.lng;
    if (p.lng > e) e = p.lng;
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
  }
  if (!Number.isFinite(w)) return null;
  return [
    [w, s],
    [e, n],
  ];
}

export function nodeSizePx(globalScale: number, nodeScale: number): number {
  const g = clamp(globalScale, 0.25, 4);
  const s = clamp(nodeScale, 0.5, 3);
  return Math.round(clamp(BASE_ICON_PX * g * s, 12, 120));
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Crisp SVG icon (viewBox 0 0 32 32) per node type. */
export function nodeIconSvg(type: string, color: string, short: string): string {
  const fill = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#E0E0E0';
  const st = `fill="${fill}" stroke="${COLOR_DARK}" stroke-width="2" stroke-linejoin="round"`;
  let shape = '';
  let textY = 16;
  let showText = true;
  switch (type) {
    case 'pole':
      shape =
        `<circle cx="16" cy="16" r="12.5" ${st}/>` +
        `<path d="M8.5 11.5H23.5M16 11.5V24.5" fill="none" stroke="${COLOR_DARK}" stroke-width="3.2" stroke-linecap="round"/>`;
      showText = false;
      break;
    case 'handhole':
      shape = `<rect x="3" y="5.5" width="26" height="21" rx="6.5" ${st}/>`;
      break;
    case 'vault':
      shape =
        `<rect x="2.5" y="2.5" width="27" height="27" rx="1.5" ${st}/>` +
        `<rect x="6.5" y="6.5" width="19" height="19" rx="0.5" fill="none" stroke="${COLOR_DARK}" stroke-width="1.6"/>`;
      break;
    case 'pedestal':
      shape = `<polygon points="16,2.5 29.5,12.3 24.3,28.5 7.7,28.5 2.5,12.3" ${st}/>`;
      textY = 17.5;
      break;
    case 'splice_case':
      shape = `<rect x="1.5" y="8.5" width="29" height="15" rx="7.5" ${st}/>`;
      break;
    case 'riser':
      shape = `<rect x="10" y="1.5" width="12" height="29" rx="2.5" ${st}/>`;
      break;
    case 'anchor':
      shape = `<polygon points="16,2.5 30,28.5 2,28.5" ${st}/>`;
      textY = 20.5;
      break;
    case 'building_entry':
      shape = `<path d="M16 2.5L30 14.5H26.5V29H5.5V14.5H2Z" ${st}/>`;
      textY = 20.5;
      break;
    default:
      shape = `<polygon points="16,1.5 30.5,16 16,30.5 1.5,16" ${st}/>`;
      break;
  }
  let text = '';
  const code = String(short || '').slice(0, 3);
  if (showText && code) {
    let size = code.length >= 3 ? 8.5 : code.length === 2 ? 11 : 14;
    if (type === 'riser') size = Math.min(size, 9);
    text =
      `<text x="16" y="${textY}" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif" font-weight="800" ` +
      `font-size="${size}" fill="${COLOR_DARK}">${escapeHtml(code)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">${shape}${text}</svg>`;
}

// ---------------------------------------------------------------- styles

const STYLE_ID = 'lm-core-styles';
const CORE_CSS = `
.lm-root{-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.lm-node{position:absolute;cursor:pointer;z-index:2;touch-action:none}
.lm-move .lm-node{cursor:grab}
.lm-node.lm-sel{z-index:4}
.lm-node .lm-ic{position:absolute;inset:0;filter:drop-shadow(0 0 1px rgba(255,255,255,.55)) drop-shadow(0 1px 2px rgba(0,0,0,.75))}
.lm-node .lm-ic svg{display:block;width:100%;height:100%;overflow:visible}
.lm-ring{position:absolute;inset:-7px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px 4px rgba(90,169,255,.95),inset 0 0 6px rgba(90,169,255,.8);display:none;pointer-events:none}
.lm-sel .lm-ring{display:block}
.maplibregl-ctrl-bottom-left{bottom:170px!important}
.lm-pill{position:absolute;top:100%;left:50%;transform:translate(-50%,4px);background:rgba(11,15,20,.84);color:#fff;font:600 11px/1.25 system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;padding:2px 6px;border-radius:9px;white-space:nowrap;pointer-events:none;border:1px solid rgba(255,255,255,.28)}
.lm-sel .lm-pill{background:#fff;color:#0B0F14}
.lm-zlt15 .lm-pill{display:none}
.lm-badge{position:absolute;pointer-events:none;box-sizing:border-box}
.lm-b-pending{top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:#5AA9FF;border:1.5px solid #0B0F14;animation:lm-pulse 1.1s ease-in-out infinite}
.lm-b-failed{top:-6px;right:-6px;width:15px;height:15px;border-radius:50%;background:#E5484D;color:#fff;font:800 10px/12px system-ui,-apple-system,Roboto,Arial,sans-serif;text-align:center;border:1.5px solid #0B0F14}
.lm-b-dup{top:-7px;left:-9px;background:#FFB020;color:#0B0F14;font:800 9px/1 system-ui,-apple-system,Roboto,Arial,sans-serif;padding:2px 3px;border-radius:5px;border:1.5px solid #0B0F14}
@keyframes lm-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.55);opacity:.4}}
.lm-span-label{z-index:1;background:rgba(11,15,20,.86);color:#fff;font:700 11px/1 system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;padding:3px 6px;border-radius:9px;white-space:nowrap;cursor:pointer;border:1.5px solid ${COLOR_AERIAL}}
.lm-span-label.lm-ug{border-color:${COLOR_UG}}
.lm-span-label.lm-sel{background:#fff;color:#0B0F14;z-index:3}
.lm-zlt16 .lm-span-label{display:none}
.lm-root .maplibregl-ctrl-scale{background:rgba(255,255,255,.8)}
`;

function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CORE_CSS;
  (doc.head || doc.documentElement).appendChild(el);
}

/**
 * Point maplibre at a worker built from inline source (no network, no bundler worker file).
 * Safe to call more than once; only the first call has effect.
 */
export function installInlineWorker(maplibregl: any, workerSource: string): void {
  const g = globalThis as any;
  if (g.__lmWorkerUrl || !workerSource) return;
  const blob = new Blob([workerSource], { type: 'text/javascript' });
  g.__lmWorkerUrl = URL.createObjectURL(blob);
  maplibregl.setWorkerUrl(g.__lmWorkerUrl);
}

// ---------------------------------------------------------------- tile protocol (native WebView)

/** A tile answer from the host: base64 image bytes, or null when the tile is not available. */
export interface TileReply {
  id: number;
  data: string | null;
}

/** Page to host: tiles wanted and tiles no longer wanted (map aborted the request). */
export interface TileRequestMessage {
  type: 'tileReq';
  reqs: Array<{ id: number; url: string }>;
  cancel: number[];
}

export interface TileProtocolClient {
  /** Host answers (batched). Unknown or cancelled ids are ignored. */
  receive(items: TileReply[]): void;
  /** Number of requests waiting for an answer. */
  pending(): number;
  /** Fail every waiting request (the host was reset). */
  failAll(): void;
}

export interface TileProtocolOptions {
  /** A request with no answer after this long fails (default 45 s). */
  timeoutMs?: number;
}

/** Decodes standard base64 into an ArrayBuffer. */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Registers maplibre custom protocol `scheme` ("lmtile") so raster tiles are requested from the host
 * app instead of the network. Requests are batched into one message per task; aborted requests are
 * reported so the host can drop queued work.
 */
export function installTileProtocol(
  maplibregl: any,
  scheme: string,
  post: (msg: TileRequestMessage) => void,
  opts?: TileProtocolOptions,
): TileProtocolClient {
  const timeoutMs = (opts && opts.timeoutMs) || 45000;
  let seq = 0;
  let outReqs: Array<{ id: number; url: string }> = [];
  let outCancel: number[] = [];
  let flushScheduled = false;
  const waiting = new Map<
    number,
    { resolve: (v: { data: ArrayBuffer }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  function flush() {
    flushScheduled = false;
    if (!outReqs.length && !outCancel.length) return;
    const msg: TileRequestMessage = { type: 'tileReq', reqs: outReqs, cancel: outCancel };
    outReqs = [];
    outCancel = [];
    post(msg);
  }

  function schedule() {
    if (flushScheduled) return;
    flushScheduled = true;
    setTimeout(flush, 0);
  }

  function settle(id: number): { resolve: (v: { data: ArrayBuffer }) => void; reject: (e: Error) => void } | null {
    const w = waiting.get(id);
    if (!w) return null;
    waiting.delete(id);
    clearTimeout(w.timer);
    return w;
  }

  maplibregl.addProtocol(scheme, (params: { url: string }, abortController: AbortController) => {
    return new Promise<{ data: ArrayBuffer }>((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        const w = settle(id);
        if (w) {
          outCancel.push(id);
          schedule();
          w.reject(new Error('tile timeout'));
        }
      }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      const signal = abortController && abortController.signal;
      if (signal) {
        if (signal.aborted) {
          settle(id);
          reject(new Error('aborted'));
          return;
        }
        signal.addEventListener('abort', () => {
          const w = settle(id);
          if (!w) return;
          const queued = outReqs.findIndex((r) => r.id === id);
          if (queued >= 0) outReqs.splice(queued, 1);
          else {
            outCancel.push(id);
            schedule();
          }
          w.reject(new Error('aborted'));
        });
      }
      outReqs.push({ id, url: params.url });
      schedule();
    });
  });

  return {
    receive(items: TileReply[]) {
      if (!items || !items.length) return;
      for (const it of items) {
        const w = settle(it.id);
        if (!w) continue;
        if (typeof it.data === 'string' && it.data.length > 0) {
          try {
            w.resolve({ data: base64ToArrayBuffer(it.data) });
          } catch {
            w.reject(new Error('bad tile data'));
          }
        } else {
          w.reject(new Error('tile unavailable'));
        }
      }
    },
    pending() {
      return waiting.size;
    },
    failAll() {
      const ids = Array.from(waiting.keys());
      for (const id of ids) {
        const w = settle(id);
        if (w) w.reject(new Error('tile host reset'));
      }
    },
  };
}

// ---------------------------------------------------------------- engine

interface NodeEntry {
  marker: any;
  el: HTMLDivElement;
  sig: string;
  lat: number;
  lng: number;
}

interface LabelEntry {
  marker: any;
  el: HTMLDivElement;
  sig: string;
  lat: number;
  lng: number;
}

interface LatLng {
  lat: number;
  lng: number;
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] as unknown[] };

export function createLineMap(
  container: HTMLElement,
  maplibregl: any,
  emit: (event: CoreEvent) => void,
  options?: CreateLineMapOptions,
): LineMapController {
  const doc = container.ownerDocument || document;
  ensureStyles(doc);
  container.classList.add('lm-root');

  const map: any = new maplibregl.Map({
    container,
    style: { version: 8, sources: {}, layers: [] },
    center: US_CENTER,
    zoom: US_ZOOM,
    maxZoom: 21,
    attributionControl: { compact: true },
    maplibreLogo: false,
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: 120,
  });
  map.addControl(
    new maplibregl.NavigationControl({ showCompass: true, showZoom: !!(options && options.showZoomButtons), visualizePitch: false }),
    'bottom-left',
  );
  const scaleControl = new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 110 });
  map.addControl(scaleControl, 'bottom-left');

  let destroyed = false;
  let loaded = false;
  let state: CoreState | null = null;
  let basemapId: string | null = null;
  let basemapLayerIds: string[] = [];
  let basemapSourceIds: string[] = [];
  let currentUnits: CoreUnits | null = null;
  let currentMode: CoreEditMode | null = null;
  let cameraInitialized = false;
  let userInteracted = false;
  let spansSig = '';
  let accSig = '';
  let userSig = '';
  let lastDragEndAt = 0;
  let lastErrorAt = 0;
  let rafId: number | null = null;

  const nodeEntries = new Map<string, NodeEntry>();
  const labelEntries = new Map<string, LabelEntry>();
  const dragging = new Map<string, LatLng>();
  const pendingMoves = new Map<string, LatLng & { t: number }>();
  const nodeById = new Map<string, CoreNode>();
  const svgImageCache = new Map<string, HTMLImageElement>();

  const safeEmit = (e: CoreEvent) => {
    if (destroyed) return;
    try {
      emit(e);
    } catch (err) {
      // never let a consumer error break the engine
      if (typeof console !== 'undefined') console.warn('LineMap emit failed', err);
    }
  };

  // --- positions

  function posOf(id: string): LatLng | null {
    const d = dragging.get(id);
    if (d) return d;
    const p = pendingMoves.get(id);
    if (p) return p;
    const n = nodeById.get(id);
    return n ? { lat: n.lat, lng: n.lng } : null;
  }

  function isLive(id: string): boolean {
    return dragging.has(id) || pendingMoves.has(id);
  }

  // --- layers

  function addOverlayLayers() {
    map.addSource('lm-acc', { type: 'geojson', data: EMPTY_FC });
    map.addSource('lm-spans', { type: 'geojson', data: EMPTY_FC });
    map.addSource('lm-user', { type: 'geojson', data: EMPTY_FC });

    map.addLayer({
      id: 'lm-acc-fill',
      type: 'fill',
      source: 'lm-acc',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 },
    });
    map.addLayer({
      id: 'lm-acc-line',
      type: 'line',
      source: 'lm-acc',
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.75, 'line-width': 1.2 },
    });

    const w = (base: number[], selAdd: number): unknown[] => {
      const zooms = [10, 15, 18, 21];
      const out: unknown[] = ['interpolate', ['exponential', 1.4], ['zoom']];
      zooms.forEach((z, i) => {
        out.push(z, ['case', ['get', 'sel'], base[i] + selAdd, base[i]]);
      });
      return out;
    };
    const lineBase = [1.6, 3, 4.5, 7];
    map.addLayer({
      id: 'lm-span-glow',
      type: 'line',
      source: 'lm-spans',
      filter: ['==', ['get', 'sel'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.75, 'line-blur': 3, 'line-width': w([7, 9, 12, 16], 0) },
    });
    map.addLayer({
      id: 'lm-span-casing',
      type: 'line',
      source: 'lm-spans',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': COLOR_DARK, 'line-opacity': 0.6, 'line-width': w([3.6, 5.2, 7, 10], 1.5) },
    });
    map.addLayer({
      id: 'lm-span-aerial',
      type: 'line',
      source: 'lm-spans',
      filter: ['==', ['get', 'kind'], 'aerial'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['get', 'sel'], COLOR_AERIAL_SEL, COLOR_AERIAL],
        'line-width': w(lineBase, 1.5),
      },
    });
    map.addLayer({
      id: 'lm-span-ug',
      type: 'line',
      source: 'lm-spans',
      filter: ['==', ['get', 'kind'], 'underground'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['get', 'sel'], COLOR_UG_SEL, COLOR_UG],
        'line-width': w(lineBase, 1.5),
        'line-dasharray': [2, 1.4],
      },
    });
    map.addLayer({
      id: 'lm-span-hit',
      type: 'line',
      source: 'lm-spans',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#000000', 'line-opacity': 0.01, 'line-width': 24 },
    });
    map.addLayer({
      id: 'lm-user-halo',
      type: 'fill',
      source: 'lm-user',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': COLOR_USER, 'fill-opacity': 0.15, 'fill-outline-color': COLOR_USER },
    });
    map.addLayer({
      id: 'lm-user-dot',
      type: 'circle',
      source: 'lm-user',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 7,
        'circle-color': COLOR_USER,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 2.5,
        'circle-pitch-alignment': 'map',
      },
    });
  }

  function applyBasemap(bm: CoreBasemap) {
    if (basemapId === bm.id) return;
    for (const id of basemapLayerIds) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of basemapSourceIds) if (map.getSource(id)) map.removeSource(id);
    basemapLayerIds = [];
    basemapSourceIds = [];
    for (const id of Object.keys(bm.sources)) {
      map.addSource(id, bm.sources[id]);
      basemapSourceIds.push(id);
    }
    const before = map.getLayer(FIRST_OVERLAY_LAYER) ? FIRST_OVERLAY_LAYER : undefined;
    for (const layer of bm.layers) {
      map.addLayer(layer, before);
      basemapLayerIds.push(layer.id);
    }
    basemapId = bm.id;
  }

  // --- nodes

  function nodeInnerHtml(n: CoreNode): string {
    let badges = '';
    if (n.status === 'ai_pending') badges += '<span class="lm-badge lm-b-pending"></span>';
    else if (n.status === 'ai_failed') badges += '<span class="lm-badge lm-b-failed">!</span>';
    if (n.dup) badges += '<span class="lm-badge lm-b-dup">2x</span>';
    const pill = n.label ? `<div class="lm-pill">${escapeHtml(n.label)}</div>` : '';
    return `<div class="lm-ring"></div><div class="lm-ic">${nodeIconSvg(n.type, n.color, n.short)}</div>${badges}${pill}`;
  }

  function createNodeEntry(n: CoreNode, draggable: boolean): NodeEntry {
    const el = doc.createElement('div');
    el.classList.add('lm-node');
    el.setAttribute('data-node-id', n.id);
    const id = n.id;
    const marker = new maplibregl.Marker({ element: el, anchor: 'center', draggable, clickTolerance: 4 });
    marker.setLngLat([n.lng, n.lat]).addTo(map);
    marker.on('dragstart', () => {
      const ll = marker.getLngLat();
      dragging.set(id, { lat: ll.lat, lng: ll.lng });
      cancelLongPress();
    });
    marker.on('drag', () => {
      const ll = marker.getLngLat();
      dragging.set(id, { lat: ll.lat, lng: ll.lng });
      scheduleLiveRefresh();
    });
    marker.on('dragend', () => {
      const ll = marker.getLngLat();
      dragging.delete(id);
      pendingMoves.set(id, { lat: ll.lat, lng: ll.lng, t: Date.now() });
      lastDragEndAt = Date.now();
      scheduleLiveRefresh();
      safeEmit({ type: 'nodeMoved', id, lat: ll.lat, lng: ll.lng });
    });
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (Date.now() - lastDragEndAt < 300) return;
      safeEmit({ type: 'nodePress', id });
    });
    return { marker, el, sig: '', lat: n.lat, lng: n.lng };
  }

  function refreshNodes(s: CoreState) {
    const draggable = s.editMode === 'move';
    const modeChanged = currentMode !== s.editMode;
    currentMode = s.editMode;
    container.classList.toggle('lm-move', draggable);

    const diff = diffIds(nodeEntries.keys(), s.nodes.map((n) => n.id));
    for (const id of diff.removed) {
      const e = nodeEntries.get(id);
      if (e) e.marker.remove();
      nodeEntries.delete(id);
      dragging.delete(id);
      pendingMoves.delete(id);
    }
    for (const n of s.nodes) {
      let e = nodeEntries.get(n.id);
      if (!e) {
        e = createNodeEntry(n, draggable);
        nodeEntries.set(n.id, e);
      } else if (modeChanged) {
        e.marker.setDraggable(draggable);
      }
      const size = nodeSizePx(s.globalIconScale, n.scale);
      const selected = s.selectedNodeId === n.id;
      const sig = [n.type, n.color, n.short, n.label, size, n.status, n.dup ? 1 : 0].join('|');
      if (sig !== e.sig) {
        e.el.style.width = size + 'px';
        e.el.style.height = size + 'px';
        e.el.innerHTML = nodeInnerHtml(n);
        e.sig = sig;
      }
      e.el.classList.toggle('lm-sel', selected);
      if (!dragging.has(n.id)) {
        const p = posOf(n.id);
        if (p && (p.lat !== e.lat || p.lng !== e.lng)) {
          e.marker.setLngLat([p.lng, p.lat]);
          e.lat = p.lat;
          e.lng = p.lng;
        }
      }
    }
  }

  // --- spans + labels

  function liveSpanFt(sp: CoreSpan, a: LatLng, b: LatLng): number {
    if (!isLive(sp.from) && !isLive(sp.to)) return sp.totalFt;
    const straightFt = haversineM(a.lat, a.lng, b.lat, b.lng) * FT_PER_M;
    return spanTotalFt(straightFt, sp.sagPct, sp.slackFt, sp.overrideFt);
  }

  function refreshSpans(s: CoreState) {
    const features: unknown[] = [];
    const seen: string[] = [];
    for (const sp of s.spans) {
      const a = posOf(sp.from);
      const b = posOf(sp.to);
      if (!a || !b) continue;
      const sel = s.selectedSpanId === sp.id;
      features.push({
        type: 'Feature',
        properties: { id: sp.id, kind: sp.kind === 'underground' ? 'underground' : 'aerial', sel },
        geometry: {
          type: 'LineString',
          coordinates: [
            [a.lng, a.lat],
            [b.lng, b.lat],
          ],
        },
      });
      seen.push(sp.id);

      const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
      const text = formatSpanLength(liveSpanFt(sp, a, b), s.units);
      let le = labelEntries.get(sp.id);
      if (!le) {
        const el = doc.createElement('div');
        el.classList.add('lm-span-label');
        el.setAttribute('data-span-id', sp.id);
        const spanId = sp.id;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          safeEmit({ type: 'spanPress', id: spanId });
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' });
        marker.setLngLat([mid.lng, mid.lat]).addTo(map);
        le = { marker, el, sig: '', lat: mid.lat, lng: mid.lng };
        labelEntries.set(sp.id, le);
      }
      const sig = text + '|' + sp.kind + '|' + (sel ? 1 : 0);
      if (sig !== le.sig) {
        le.el.textContent = text;
        le.el.classList.toggle('lm-ug', sp.kind === 'underground');
        le.el.classList.toggle('lm-sel', sel);
        le.sig = sig;
      }
      if (mid.lat !== le.lat || mid.lng !== le.lng) {
        le.marker.setLngLat([mid.lng, mid.lat]);
        le.lat = mid.lat;
        le.lng = mid.lng;
      }
    }
    const diff = diffIds(labelEntries.keys(), seen);
    for (const id of diff.removed) {
      const le = labelEntries.get(id);
      if (le) le.marker.remove();
      labelEntries.delete(id);
    }
    const fc = { type: 'FeatureCollection', features };
    const sig = JSON.stringify(features);
    if (sig !== spansSig) {
      const src = map.getSource('lm-spans');
      if (src) src.setData(fc);
      spansSig = sig;
    }
  }

  function refreshAccuracy(s: CoreState) {
    const features: unknown[] = [];
    if (s.showAccuracy) {
      for (const n of s.nodes) {
        if (n.accuracyM == null || !(n.accuracyM > 0)) continue;
        const p = posOf(n.id);
        if (!p) continue;
        features.push({
          type: 'Feature',
          properties: { id: n.id, color: n.color },
          geometry: { type: 'Polygon', coordinates: [circlePolygon(p.lat, p.lng, n.accuracyM, 40)] },
        });
      }
    }
    const sig = JSON.stringify(features);
    if (sig !== accSig) {
      const src = map.getSource('lm-acc');
      if (src) src.setData({ type: 'FeatureCollection', features });
      accSig = sig;
    }
  }

  function refreshUser(s: CoreState) {
    const features: unknown[] = [];
    const u = s.user;
    if (u && Number.isFinite(u.lat) && Number.isFinite(u.lng)) {
      if (u.accuracyM != null && u.accuracyM > 0) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [circlePolygon(u.lat, u.lng, u.accuracyM, 48)] },
        });
      }
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [u.lng, u.lat] } });
    }
    const sig = JSON.stringify(features);
    if (sig !== userSig) {
      const src = map.getSource('lm-user');
      if (src) src.setData({ type: 'FeatureCollection', features });
      userSig = sig;
    }
  }

  function scheduleLiveRefresh() {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!state || destroyed || !loaded) return;
      refreshSpans(state);
      refreshAccuracy(state);
    });
  }

  function updateZoomClasses() {
    const z = map.getZoom();
    container.classList.toggle('lm-zlt15', z < LABEL_MIN_ZOOM);
    container.classList.toggle('lm-zlt16', z < SPAN_LABEL_MIN_ZOOM);
  }

  // --- camera

  function fitPadding(): number {
    const w = container.clientWidth || 0;
    const h = container.clientHeight || 0;
    if (!w || !h) return 0;
    return Math.max(0, Math.min(FIT_PADDING, Math.floor(Math.min(w, h) / 4)));
  }

  function centerOn(lat: number, lng: number, zoom?: number, animate = true) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const z = Math.max(map.getZoom(), zoom != null ? zoom : 18);
    if (animate) map.easeTo({ center: [lng, lat], zoom: z, duration: 600 });
    else map.jumpTo({ center: [lng, lat], zoom: z });
  }

  function fit(animate = true) {
    const s = state;
    if (!s) return;
    const pts: LatLng[] = [];
    for (const n of s.nodes) {
      const p = posOf(n.id);
      if (p) pts.push(p);
    }
    if (pts.length === 0) {
      if (s.user) centerOn(s.user.lat, s.user.lng, 17, animate);
      return;
    }
    if (pts.length === 1) {
      const z = 18;
      if (animate) map.easeTo({ center: [pts[0].lng, pts[0].lat], zoom: z, duration: 600 });
      else map.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: z });
      return;
    }
    const b = computeBounds(pts);
    if (!b) return;
    map.fitBounds(b, { padding: fitPadding(), maxZoom: FIT_MAX_ZOOM, duration: animate ? 600 : 0 });
  }

  function maybeInitCamera(s: CoreState) {
    if (cameraInitialized || userInteracted) return;
    if (s.nodes.length > 0) {
      fit(false);
      cameraInitialized = true;
    } else if (s.user) {
      centerOn(s.user.lat, s.user.lng, 17, false);
      cameraInitialized = true;
    }
  }

  // --- apply

  function applyState(s: CoreState) {
    nodeById.clear();
    for (const n of s.nodes) nodeById.set(n.id, n);
    // settle pending (post-drag) positions once the owner has caught up, or give up after a while
    const now = Date.now();
    pendingMoves.forEach((p, id) => {
      const n = nodeById.get(id);
      if (!n || (Math.abs(n.lat - p.lat) < 1e-9 && Math.abs(n.lng - p.lng) < 1e-9) || now - p.t > 4000) {
        pendingMoves.delete(id);
      }
    });
    applyBasemap(s.basemap);
    if (currentUnits !== s.units) {
      scaleControl.setUnit(s.units === 'metric' ? 'metric' : 'imperial');
      currentUnits = s.units;
    }
    refreshNodes(s);
    refreshSpans(s);
    refreshAccuracy(s);
    refreshUser(s);
    maybeInitCamera(s);
  }

  // --- gestures

  let lpTimer: ReturnType<typeof setTimeout> | null = null;
  let lpStart: { x: number; y: number } | null = null;
  let lpFired = false;
  let lpFiredAt = 0;

  function cancelLongPress() {
    if (lpTimer != null) clearTimeout(lpTimer);
    lpTimer = null;
    lpStart = null;
  }

  function fireLongPress(lat: number, lng: number) {
    lpFired = true;
    lpFiredAt = Date.now();
    safeEmit({ type: 'mapLongPress', lat, lng });
  }

  function isOverlayTarget(t: unknown): boolean {
    const el = t as Element | null;
    if (!el || typeof el.closest !== 'function') return false;
    return !!el.closest('.lm-node, .lm-span-label, .maplibregl-ctrl');
  }

  function startLongPress(e: any) {
    cancelLongPress();
    if (isOverlayTarget(e.originalEvent && e.originalEvent.target)) return;
    lpStart = { x: e.point.x, y: e.point.y };
    const lat = e.lngLat.lat;
    const lng = e.lngLat.lng;
    lpTimer = setTimeout(() => {
      lpTimer = null;
      lpStart = null;
      fireLongPress(lat, lng);
    }, LONG_PRESS_MS);
  }

  function moveLongPress(e: any) {
    if (!lpStart) return;
    const dx = e.point.x - lpStart.x;
    const dy = e.point.y - lpStart.y;
    if (dx * dx + dy * dy > LONG_PRESS_SLOP_PX * LONG_PRESS_SLOP_PX) cancelLongPress();
  }

  map.on('touchstart', (e: any) => {
    lpFired = false;
    const touches = e.originalEvent && e.originalEvent.touches;
    if (touches && touches.length > 1) return cancelLongPress();
    startLongPress(e);
  });
  map.on('touchmove', (e: any) => {
    const touches = e.originalEvent && e.originalEvent.touches;
    if (touches && touches.length > 1) return cancelLongPress();
    moveLongPress(e);
  });
  map.on('touchend', cancelLongPress);
  map.on('touchcancel', cancelLongPress);
  map.on('mousedown', (e: any) => {
    if (e.originalEvent && e.originalEvent.button !== 0) return;
    startLongPress(e);
  });
  map.on('mousemove', moveLongPress);
  map.on('mouseup', cancelLongPress);
  map.on('dragstart', () => {
    cancelLongPress();
    lpFired = false;
  });
  map.on('zoomstart', cancelLongPress);
  map.on('rotatestart', cancelLongPress);
  map.on('contextmenu', (e: any) => {
    // Desktop right click, or the platform long-press menu event: treat as long press once.
    if (e.originalEvent && typeof e.originalEvent.preventDefault === 'function') e.originalEvent.preventDefault();
    if (Date.now() - lpFiredAt < 1500) return;
    cancelLongPress();
    if (isOverlayTarget(e.originalEvent && e.originalEvent.target)) return;
    fireLongPress(e.lngLat.lat, e.lngLat.lng);
  });

  map.on('click', (e: any) => {
    if (lpFired) {
      lpFired = false;
      return;
    }
    if (isOverlayTarget(e.originalEvent && e.originalEvent.target)) return;
    const p = e.point;
    let spanId: string | null = null;
    if (map.getLayer('lm-span-hit')) {
      const feats = map.queryRenderedFeatures(
        [
          [p.x - 4, p.y - 4],
          [p.x + 4, p.y + 4],
        ],
        { layers: ['lm-span-hit'] },
      );
      if (feats && feats.length && feats[0].properties) spanId = String(feats[0].properties.id);
    }
    if (spanId) safeEmit({ type: 'spanPress', id: spanId });
    else safeEmit({ type: 'mapPress', lat: e.lngLat.lat, lng: e.lngLat.lng });
  });

  map.on('movestart', (e: any) => {
    if (e && e.originalEvent) userInteracted = true;
  });
  map.on('zoom', updateZoomClasses);
  map.on('error', (e: any) => {
    // Tile failures are expected offline; only surface other errors, rate limited.
    if (!e || e.sourceId || e.tile) return;
    const now = Date.now();
    if (now - lastErrorAt < 5000) return;
    lastErrorAt = now;
    const err = e.error;
    safeEmit({ type: 'error', message: String((err && err.message) || err || 'map error') });
  });

  const onLinkClick = (ev: Event) => {
    const t = ev.target as Element | null;
    const a = t && typeof t.closest === 'function' ? (t.closest('a[href]') as HTMLAnchorElement | null) : null;
    if (!a) return;
    ev.preventDefault();
    safeEmit({ type: 'openUrl', url: a.href });
  };
  container.addEventListener('click', onLinkClick, true);
  const onContextMenu = (ev: Event) => ev.preventDefault();
  container.addEventListener('contextmenu', onContextMenu);

  map.on('load', () => {
    if (destroyed) return;
    addOverlayLayers();
    loaded = true;
    updateZoomClasses();
    if (state) applyState(state);
    safeEmit({ type: 'loaded' });
  });

  // --- snapshot

  function loadSvgImage(svg: string): Promise<HTMLImageElement | null> {
    const cached = svgImageCache.get(svg);
    if (cached && cached.complete) return Promise.resolve(cached);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        svgImageCache.set(svg, img);
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  function drawPill(
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    top: number,
    dpr: number,
    bg: string,
    fg: string,
    border: string | null,
  ) {
    ctx.font = `700 ${11 * dpr}px system-ui, -apple-system, Roboto, Arial, sans-serif`;
    const tw = ctx.measureText(text).width;
    const padX = 6 * dpr;
    const h = 17 * dpr;
    const w = tw + padX * 2;
    const x = cx - w / 2;
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, top);
    ctx.lineTo(x + w - r, top);
    ctx.arc(x + w - r, top + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + r, top + h);
    ctx.arc(x + r, top + r, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    if (border) {
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = border;
      ctx.stroke();
    }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, top + h / 2 + 0.5 * dpr);
  }

  async function snapshot(): Promise<string | null> {
    if (destroyed) return null;
    const canvas: HTMLCanvasElement = map.getCanvas();
    try {
      // make sure the drawing buffer holds a fresh frame
      map.triggerRepaint();
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        map.once('render', finish);
        setTimeout(finish, 250);
      });
      const out = doc.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const ctx = out.getContext('2d');
      if (!ctx) return canvas.toDataURL('image/jpeg', 0.9);
      ctx.drawImage(canvas, 0, 0);
      const dpr = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;
      const s = state;
      if (s) {
        const z = map.getZoom();
        if (z >= SPAN_LABEL_MIN_ZOOM) {
          labelEntries.forEach((le, id) => {
            const sp = s.spans.find((x) => x.id === id);
            const pt = map.project([le.lng, le.lat]);
            const ug = sp ? sp.kind === 'underground' : false;
            drawPill(ctx, le.el.textContent || '', pt.x * dpr, pt.y * dpr - 8.5 * dpr, dpr, 'rgba(11,15,20,0.86)', '#FFFFFF', ug ? COLOR_UG : COLOR_AERIAL);
          });
        }
        const images = await Promise.all(s.nodes.map((n) => loadSvgImage(nodeIconSvg(n.type, n.color, n.short))));
        s.nodes.forEach((n, i) => {
          const img = images[i];
          const p = posOf(n.id);
          if (!p) return;
          const pt = map.project([p.lng, p.lat]);
          const size = nodeSizePx(s.globalIconScale, n.scale) * dpr;
          const x = pt.x * dpr - size / 2;
          const y = pt.y * dpr - size / 2;
          if (img) ctx.drawImage(img, x, y, size, size);
          if (z >= LABEL_MIN_ZOOM && n.label) {
            drawPill(ctx, n.label, pt.x * dpr, y + size + 4 * dpr, dpr, 'rgba(11,15,20,0.84)', '#FFFFFF', null);
          }
        });
      }
      // Tile providers require attribution on exported imagery too.
      const attribEl = container.querySelector('.maplibregl-ctrl-attrib-inner');
      const attrib = attribEl ? (attribEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (attrib) {
        ctx.font = `500 ${10 * dpr}px system-ui, -apple-system, Roboto, Arial, sans-serif`;
        const tw = ctx.measureText(attrib).width;
        const pad = 4 * dpr;
        const h = 14 * dpr;
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(out.width - tw - pad * 2, out.height - h, tw + pad * 2, h);
        ctx.fillStyle = '#111111';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(attrib, out.width - pad, out.height - h / 2);
      }
      try {
        return out.toDataURL('image/jpeg', 0.9);
      } catch {
        // tainted composite (should not happen with data: SVGs); fall back to the bare map
        return canvas.toDataURL('image/jpeg', 0.9);
      }
    } catch (err) {
      try {
        return canvas.toDataURL('image/jpeg', 0.9);
      } catch {
        return null;
      }
    }
  }

  // --- controller

  return {
    setState(s: CoreState) {
      if (destroyed) return;
      state = s;
      if (loaded) applyState(s);
    },
    fit(animate?: boolean) {
      if (destroyed || !loaded) return;
      fit(animate !== false);
    },
    centerOn(lat: number, lng: number, zoom?: number) {
      if (destroyed) return;
      centerOn(lat, lng, zoom, true);
    },
    snapshot,
    getView() {
      if (destroyed) return null;
      try {
        const b = map.getBounds();
        const c = map.getCenter();
        const w = Math.max(-180, b.getWest());
        const e = Math.min(180, b.getEast());
        const s = Math.max(-85.0511287798, b.getSouth());
        const n = Math.min(85.0511287798, b.getNorth());
        if (![w, s, e, n].every(Number.isFinite) || !(w < e) || !(s < n)) return null;
        return { bounds: [w, s, e, n], zoom: map.getZoom(), center: { lat: c.lat, lng: c.lng } };
      } catch {
        return null;
      }
    },
    reloadTiles() {
      if (destroyed || !loaded) return;
      for (const id of basemapSourceIds) {
        const src = map.getSource(id);
        if (src && typeof src.setTiles === 'function' && Array.isArray(src.tiles)) src.setTiles(src.tiles.slice());
      }
    },
    resize() {
      if (!destroyed) map.resize();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelLongPress();
      if (rafId != null) cancelAnimationFrame(rafId);
      container.removeEventListener('click', onLinkClick, true);
      container.removeEventListener('contextmenu', onContextMenu);
      nodeEntries.forEach((e) => e.marker.remove());
      labelEntries.forEach((e) => e.marker.remove());
      nodeEntries.clear();
      labelEntries.clear();
      try {
        map.remove();
      } catch {
        // ignore teardown errors
      }
    },
  };
}
