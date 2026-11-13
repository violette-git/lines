/** Minimal synchronous key/value storage (the subset of Web Storage we use). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** window.localStorage when available and usable, else null (private mode, SSR, Jest, native). */
export function getBrowserStorage(): KeyValueStorage | null {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (!ls) return null;
    const probe = '__linemap_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/** In-memory KeyValueStorage, handy for tests. */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}
