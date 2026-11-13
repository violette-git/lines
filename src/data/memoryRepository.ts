// In-memory Repository used by the web preview. Persists the whole dataset as one JSON blob in
// localStorage (best effort; every storage call is wrapped in try/catch). Seeds a demo project on
// first run only: if the user deletes it, it stays deleted.
import type { PhotoStore, Repository } from '@/domain/contracts';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ClientTemplate,
  type MapNode,
  type PhotoRef,
  type Project,
  type Span,
} from '@/domain/types';

import { buildDemoSeed, type SeedData } from './demoSeed';
import type { KeyValueStorage } from './kvStorage';

export const MEMORY_STORAGE_KEY = 'linemap-pro:db:v1';
const STATE_VERSION = 1;

interface MemoryState {
  version: number;
  projects: Project[];
  nodes: MapNode[];
  spans: Span[];
  photos: PhotoRef[];
  templates: ClientTemplate[];
  settings: AppSettings | null;
}

export interface MemoryRepositoryOptions {
  storage?: KeyValueStorage | null;
  storageKey?: string;
  /** true = seed demo data on first run (default), false = start empty, function = custom seed. */
  seed?: boolean | (() => SeedData);
  /** Used to release photo data (object URLs) on delete. */
  photoStore?: PhotoStore | null;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

const emptyState = (): MemoryState => ({
  version: STATE_VERSION,
  projects: [],
  nodes: [],
  spans: [],
  photos: [],
  templates: [],
  settings: null,
});

export class MemoryRepository implements Repository {
  private state: MemoryState | null = null;
  private readonly storage: KeyValueStorage | null;
  private readonly key: string;
  private readonly seed: boolean | (() => SeedData);
  private readonly photoStore: PhotoStore | null;
  private warnedQuota = false;

  constructor(opts: MemoryRepositoryOptions = {}) {
    this.storage = opts.storage ?? null;
    this.key = opts.storageKey ?? MEMORY_STORAGE_KEY;
    this.seed = opts.seed ?? true;
    this.photoStore = opts.photoStore ?? null;
  }

  // ---------- persistence ----------
  private load(): MemoryState {
    if (this.state) return this.state;
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(this.key) ?? null;
    } catch {
      raw = null;
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<MemoryState>;
        this.state = { ...emptyState(), ...parsed, version: STATE_VERSION };
        return this.state;
      } catch {
        // Corrupt blob: keep a copy for debugging and start over.
        try {
          this.storage?.setItem(`${this.key}:corrupt`, raw);
        } catch {
          /* ignore */
        }
      }
    }
    const st = emptyState();
    if (this.seed) {
      const s = typeof this.seed === 'function' ? this.seed() : buildDemoSeed();
      Object.assign(st, clone(s));
    }
    this.state = st;
    this.persist();
    return st;
  }

  private persist() {
    if (!this.storage || !this.state) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.state));
      return;
    } catch {
      // Most likely quota exceeded because of inline photo data URLs. Save without them so at least
      // the field data survives a reload.
    }
    try {
      const slim: MemoryState = {
        ...this.state,
        photos: this.state.photos.map((p) => ({
          ...p,
          uri: p.uri.startsWith('data:') ? '' : p.uri,
          watermarkedUri: p.watermarkedUri?.startsWith('data:') ? null : p.watermarkedUri,
        })),
      };
      this.storage.setItem(this.key, JSON.stringify(slim));
      if (!this.warnedQuota) {
        this.warnedQuota = true;
        console.warn('LineMap: browser storage is full, photos will not survive a page reload.');
      }
    } catch {
      /* storage unavailable, keep running in memory */
    }
  }

  private mutate(fn: (s: MemoryState) => void) {
    fn(this.load());
    this.persist();
  }

  private async releasePhotos(photos: PhotoRef[]) {
    if (!this.photoStore) return;
    for (const p of photos) {
      await this.photoStore.remove(p.uri).catch(() => undefined);
      if (p.watermarkedUri) await this.photoStore.remove(p.watermarkedUri).catch(() => undefined);
    }
  }

  async init(): Promise<void> {
    this.load();
  }

  // ---------- projects ----------
  async listProjects() {
    return clone([...this.load().projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  async getProject(id: string) {
    return clone(this.load().projects.find((p) => p.id === id) ?? null);
  }

  async upsertProject(p: Project) {
    this.mutate((s) => {
      s.projects = upsertById(s.projects, clone(p));
    });
  }

  async deleteProject(id: string) {
    const removed = this.load().photos.filter((p) => p.projectId === id);
    this.mutate((s) => {
      s.photos = s.photos.filter((p) => p.projectId !== id);
      s.spans = s.spans.filter((x) => x.projectId !== id);
      s.nodes = s.nodes.filter((n) => n.projectId !== id);
      s.projects = s.projects.filter((p) => p.id !== id);
    });
    await this.releasePhotos(removed);
  }

  // ---------- nodes ----------
  async listNodes(projectId: string) {
    return clone(this.load().nodes.filter((n) => n.projectId === projectId).sort((a, b) => a.seq - b.seq));
  }

  async getNode(id: string) {
    return clone(this.load().nodes.find((n) => n.id === id) ?? null);
  }

  async upsertNode(n: MapNode) {
    this.mutate((s) => {
      s.nodes = upsertById(s.nodes, clone(n));
    });
  }

  async deleteNode(id: string) {
    const removed = this.load().photos.filter((p) => p.nodeId === id);
    this.mutate((s) => {
      s.photos = s.photos.filter((p) => p.nodeId !== id);
      s.spans = s.spans.filter((x) => x.fromNodeId !== id && x.toNodeId !== id);
      s.nodes = s.nodes
        .filter((n) => n.id !== id)
        .map((n) => (n.possibleDuplicateOf === id ? { ...n, possibleDuplicateOf: null } : n));
    });
    await this.releasePhotos(removed);
  }

  // ---------- spans ----------
  async listSpans(projectId: string) {
    return clone(
      this.load()
        .spans.filter((x) => x.projectId === projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async upsertSpan(sp: Span) {
    this.mutate((s) => {
      s.spans = upsertById(s.spans, clone(sp));
    });
  }

  async deleteSpan(id: string) {
    this.mutate((s) => {
      s.spans = s.spans.filter((x) => x.id !== id);
    });
  }

  // ---------- photos ----------
  async listPhotos(projectId: string) {
    return clone(
      this.load()
        .photos.filter((p) => p.projectId === projectId)
        .sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    );
  }

  async upsertPhoto(p: PhotoRef) {
    this.mutate((s) => {
      s.photos = upsertById(s.photos, clone(p));
    });
  }

  async deletePhoto(id: string) {
    const removed = this.load().photos.filter((p) => p.id === id);
    this.mutate((s) => {
      s.photos = s.photos.filter((p) => p.id !== id);
    });
    await this.releasePhotos(removed);
  }

  // ---------- templates ----------
  async listTemplates() {
    return clone([...this.load().templates].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async upsertTemplate(t: ClientTemplate) {
    this.mutate((s) => {
      s.templates = upsertById(s.templates, clone(t));
    });
  }

  async deleteTemplate(id: string) {
    this.mutate((s) => {
      s.templates = s.templates.filter((t) => t.id !== id);
      s.projects = s.projects.map((p) => (p.templateId === id ? { ...p, templateId: null } : p));
    });
  }

  // ---------- settings ----------
  async getSettings(): Promise<AppSettings> {
    return { ...DEFAULT_SETTINGS, ...clone(this.load().settings ?? {}) };
  }

  async saveSettings(settings: AppSettings) {
    this.mutate((s) => {
      s.settings = clone(settings);
    });
  }
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = [...list];
  next[i] = item;
  return next;
}
