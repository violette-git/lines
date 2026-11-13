// Types for the low-level writer of @mapbox/shp-write 0.4.x. We import this module directly
// instead of the package entry, because the entry also loads file-saver, which throws at import
// time in React Native (global.window exists but HTMLAnchorElement does not) and under Jest.
declare module '@mapbox/shp-write/src/write' {
  type Geometry = 'POINT' | 'POLYLINE' | 'POLYGON';
  function write(
    rows: Record<string, string | number | boolean | null>[],
    geometryType: Geometry,
    geometries: unknown[],
    callback: (err: unknown, files: { shp: DataView; shx: DataView; dbf: DataView; prj: string }) => void,
  ): void;
  export = write;
}
