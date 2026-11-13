// Cache layout and tile verification, with expo-file-system replaced by a tiny path-joining fake.
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
      .map((s, i) => (i === 0 ? s.replace(/\/+$/, '') : s.replace(/^\/+|\/+$/g, '')))
      .join('/');
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
  }
  return {
    Directory,
    File,
    FileMode: { ReadOnly: 'r' },
    Paths: { document: new Directory('file:///data/docs/'), cache: new Directory('file:///data/cache/') },
  };
});

import { looksLikeImage, tileFile } from '../fileCache';
import { getProvider } from '../providers';

describe('tile cache layout', () => {
  it('stores saved-area tiles under documents and browsing tiles under cache', () => {
    const t = { z: 18, x: 67858, y: 105139 };
    expect(tileFile('area', getProvider('maptiler-satellite')!, t).uri).toBe(
      'file:///data/docs/tiles/maptiler-satellite/18/67858/105139.jpg',
    );
    expect(tileFile('browse', getProvider('test-osm')!, t).uri).toBe('file:///data/cache/tiles/test-osm/18/67858/105139.png');
  });

  it('recognizes PNG, JPEG and WebP signatures and rejects HTML error pages', () => {
    expect(looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(true);
    expect(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLikeImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe(true);
    expect(looksLikeImage(new TextEncoder().encode('<html><body>403</body>'))).toBe(false);
    expect(looksLikeImage(new Uint8Array([]))).toBe(false);
  });
});
