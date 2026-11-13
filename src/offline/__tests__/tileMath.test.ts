import {
  bboxAroundPoints,
  bboxSizeM,
  countTiles,
  estimateArea,
  exclusiveTiles,
  formatBytes,
  isValidBBox,
  iterateTiles,
  latToTileY,
  lngToTileX,
  parseTileUrl,
  rangeCount,
  tileAtIndex,
  tileInRanges,
  tileKey,
  tileRangeForBBox,
  tileRanges,
  tileRelPath,
  tileToLngLat,
  type BBox,
} from '../tileMath';

// Downtown Birmingham, AL (no antimeridian anywhere in these US cases).
const BHM = { lat: 33.5186, lng: -86.8104 };
const BHM_BOX: BBox = [-86.82, 33.51, -86.8, 33.53];

describe('lng/lat to tile', () => {
  it('matches reference XYZ tiles at several zooms', () => {
    expect([lngToTileX(BHM.lng, 0), latToTileY(BHM.lat, 0)]).toEqual([0, 0]);
    expect([lngToTileX(BHM.lng, 10), latToTileY(BHM.lat, 10)]).toEqual([265, 410]);
    expect([lngToTileX(BHM.lng, 12), latToTileY(BHM.lat, 12)]).toEqual([1060, 1642]);
    expect([lngToTileX(BHM.lng, 16), latToTileY(BHM.lat, 16)]).toEqual([16964, 26284]);
    expect([lngToTileX(BHM.lng, 19), latToTileY(BHM.lat, 19)]).toEqual([135717, 210279]);
  });

  it('the computed tile actually contains the point', () => {
    for (const z of [5, 12, 17, 19]) {
      const x = lngToTileX(BHM.lng, z);
      const y = latToTileY(BHM.lat, z);
      const nw = tileToLngLat(x, y, z);
      const se = tileToLngLat(x + 1, y + 1, z);
      expect(BHM.lng).toBeGreaterThanOrEqual(nw.lng);
      expect(BHM.lng).toBeLessThan(se.lng);
      expect(BHM.lat).toBeLessThanOrEqual(nw.lat);
      expect(BHM.lat).toBeGreaterThan(se.lat);
    }
  });

  it('clamps to the world edges', () => {
    expect(lngToTileX(-180, 5)).toBe(0);
    expect(lngToTileX(180, 5)).toBe(31);
    expect(latToTileY(89.9, 5)).toBe(0);
    expect(latToTileY(-89.9, 5)).toBe(31);
  });
});

describe('bbox ranges and counts', () => {
  it('computes per-zoom ranges and the total for a small downtown box', () => {
    const r16 = tileRangeForBBox(BHM_BOX, 16);
    expect(rangeCount(r16)).toBe(25);
    expect(r16.minY).toBeLessThanOrEqual(r16.maxY); // north edge gives the smaller y
    const per = tileRanges(BHM_BOX, 12, 19).map(rangeCount);
    expect(per).toEqual([1, 1, 4, 9, 25, 90, 304, 1080]);
    expect(countTiles(BHM_BOX, 12, 19)).toBe(1514);
  });

  it('counts roughly quadruple per extra zoom on a larger area', () => {
    const box: BBox = [-87.0, 33.4, -86.6, 33.7]; // greater Birmingham
    const a = countTiles(box, 15, 15);
    const b = countTiles(box, 16, 16);
    expect(b / a).toBeGreaterThan(3.5);
    expect(b / a).toBeLessThan(4.6);
  });

  it('handles other US cases (Seattle, Miami, Anchorage) without wrap', () => {
    const boxes: BBox[] = [
      [-122.36, 47.6, -122.32, 47.62],
      [-80.21, 25.76, -80.18, 25.79],
      [-149.92, 61.2, -149.86, 61.23],
    ];
    for (const b of boxes) {
      expect(isValidBBox(b)).toBe(true);
      for (const r of tileRanges(b, 10, 18)) {
        expect(r.maxX).toBeGreaterThanOrEqual(r.minX);
        expect(r.maxY).toBeGreaterThanOrEqual(r.minY);
      }
      expect(countTiles(b, 18, 18)).toBeGreaterThan(countTiles(b, 17, 17));
    }
  });

  it('rejects antimeridian-crossing and malformed boxes', () => {
    expect(isValidBBox([170, 50, -170, 60])).toBe(false);
    expect(isValidBBox([-86, 34, -87, 35])).toBe(false);
    expect(isValidBBox([-86, 35, -85, 34])).toBe(false);
    expect(isValidBBox([Number.NaN, 1, 2, 3])).toBe(false);
    expect(isValidBBox(null)).toBe(false);
  });
});

describe('canonical ordering', () => {
  it('tileAtIndex agrees with iterateTiles and returns null past the end', () => {
    const ranges = tileRanges(BHM_BOX, 14, 17);
    const all = Array.from(iterateTiles(ranges));
    expect(all).toHaveLength(countTiles(BHM_BOX, 14, 17));
    all.forEach((t, i) => expect(tileAtIndex(ranges, i)).toEqual(t));
    expect(tileAtIndex(ranges, all.length)).toBeNull();
    expect(tileAtIndex(ranges, -1)).toBeNull();
    expect(new Set(all.map((t) => tileKey('p', t))).size).toBe(all.length);
  });

  it('tileInRanges matches membership', () => {
    const ranges = tileRanges(BHM_BOX, 16, 16);
    const r = ranges[0];
    expect(tileInRanges(ranges, { z: 16, x: r.minX, y: r.minY })).toBe(true);
    expect(tileInRanges(ranges, { z: 16, x: r.maxX + 1, y: r.minY })).toBe(false);
    expect(tileInRanges(ranges, { z: 15, x: r.minX, y: r.minY })).toBe(false);
  });
});

describe('estimates and helpers', () => {
  it('estimates bytes from the provider average', () => {
    const e = estimateArea(BHM_BOX, 12, 19, 25 * 1024);
    expect(e.tiles).toBe(1514);
    expect(e.bytes).toBe(1514 * 25 * 1024);
    expect(e.perZoom[0]).toEqual({ z: 12, tiles: 1 });
    expect(formatBytes(e.bytes)).toBe('37.0 MB');
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB');
  });

  it('builds a buffered bbox around project nodes', () => {
    const b = bboxAroundPoints([BHM, { lat: 33.52, lng: -86.8 }, { lat: Number.NaN, lng: 0 }], 100)!;
    expect(b[0]).toBeLessThan(-86.8104);
    expect(b[2]).toBeGreaterThan(-86.8);
    const size = bboxSizeM(b);
    // span is ~960 m wide and ~155 m tall before the 100 m buffer on each side
    expect(size.widthM).toBeGreaterThan(1100);
    expect(size.widthM).toBeLessThan(1250);
    expect(size.heightM).toBeGreaterThan(330);
    expect(size.heightM).toBeLessThan(380);
    expect(bboxAroundPoints([], 100)).toBeNull();
    const single = bboxAroundPoints([BHM], 50)!;
    expect(isValidBBox(single)).toBe(true);
  });

  it('builds cache paths and keys', () => {
    const t = { z: 17, x: 33929, y: 52569 };
    expect(tileKey('maptiler-satellite', t)).toBe('maptiler-satellite/17/33929/52569');
    expect(tileRelPath('maptiler-satellite', t, 'jpg')).toEqual(['maptiler-satellite', '17', '33929', '52569.jpg']);
  });

  it('parses lmtile URLs and rejects bad ones', () => {
    expect(parseTileUrl('lmtile://test-osm/16/16964/26284')).toEqual({ providerId: 'test-osm', tile: { z: 16, x: 16964, y: 26284 } });
    expect(parseTileUrl('lmtile://maptiler-streets/3/1/2.png?x=1')).toEqual({
      providerId: 'maptiler-streets',
      tile: { z: 3, x: 1, y: 2 },
    });
    expect(parseTileUrl('lmtile://test-osm/2/4/0')).toBeNull(); // x out of range at z2
    expect(parseTileUrl('https://tile.openstreetmap.org/1/0/0.png')).toBeNull();
    expect(parseTileUrl('lmtile://../1/0/0')).toBeNull();
  });
});

describe('exclusiveTiles (reference counting for delete)', () => {
  it('keeps tiles another area covers', () => {
    const a: BBox = [-86.82, 33.51, -86.8, 33.53];
    const b: BBox = [-86.81, 33.505, -86.79, 33.52]; // overlaps a
    const ra = tileRanges(a, 15, 17);
    const rb = tileRanges(b, 15, 17);
    const excl = Array.from(exclusiveTiles(ra, [rb]));
    const all = Array.from(iterateTiles(ra));
    expect(excl.length).toBeLessThan(all.length);
    expect(excl.length).toBeGreaterThan(0);
    for (const t of excl) expect(tileInRanges(rb, t)).toBe(false);
    const shared = all.filter((t) => tileInRanges(rb, t));
    expect(shared.length + excl.length).toBe(all.length);
    // no other areas: everything is exclusive
    expect(Array.from(exclusiveTiles(ra, []))).toHaveLength(all.length);
  });
});
