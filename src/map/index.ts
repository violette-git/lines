// Public API of the map module. Metro resolves LineMapView.web.tsx on web and LineMapView.tsx on native.
export { LineMapView } from './LineMapView';
export type { LineMapHandle } from './shared';
export {
  BASEMAP_OPTIONS,
  IMAGERY_SOURCE_MAX_ZOOM,
  MAP_MAX_ZOOM,
  TILE_API_KEY,
  getBasemap,
} from './basemaps';
export { formatSpanLength } from './core/mapCore';
