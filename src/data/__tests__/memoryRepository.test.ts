/// <reference types="jest" />
import { createMemoryStorage } from '@/data/kvStorage';
import { MEMORY_STORAGE_KEY, MemoryRepository } from '@/data/memoryRepository';
import { DEMO_PROJECT_ID } from '@/data/demoSeed';
import type { PhotoStore } from '@/domain/contracts';
import { DEFAULT_SETTINGS, type ClientTemplate, type MapNode, type PhotoRef, type Project, type Span } from '@/domain/types';

const T = '2026-11-12T10:00:00.000Z';

const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id, name: id, client: '', jobNumber: '', workType: 'aerial', notes: '', status: 'active', ratePerFoot: null,
  ratePerNode: null, templateId: null, walkMode: true, createdAt: T, updatedAt: T, ...extra,
});
const node = (id: string, projectId: string, seq: number, extra: Partial<MapNode> = {}): MapNode => ({
  id, projectId, seq, type: 'pole', label: id,
  position: { lat: 33.5, lng: -86.8, accuracyM: 3, altitudeM: null, samples: 1, capturedAt: T, source: 'gps' },
  fields: {}, aiMeta: {}, iconScale: 1, status: 'draft', notes: '', possibleDuplicateOf: null, createdAt: T, updatedAt: T, ...extra,
});
const span = (id: string, projectId: string, from: string, to: string): Span => ({
  id, projectId, fromNodeId: from, toNodeId: to, kind: 'aerial', slackFt: 0, sagPct: 2, lengthOverrideFt: null, fields: {}, createdAt: T, updatedAt: T,
});
const photo = (id: string, projectId: string, nodeId: string): PhotoRef => ({
  id, projectId, nodeId, uri: `file:///photos/${id}.jpg`, watermarkedUri: `file:///photos/${id}_wm.jpg`, width: 10, height: 10, takenAt: T, fix: null, isPrimary: true,
});
const template = (id: string): ClientTemplate => ({
  id, name: id, client: 'c', labelPatterns: {}, requiredFields: {}, defaults: {}, defaultSpanKind: 'aerial', defaultSagPct: 2,
  defaultSlackFt: 0, ratePerFoot: null, ratePerNode: null, watermarkPhotos: true, createdAt: T, updatedAt: T,
});

function fakePhotoStore(): PhotoStore & { removed: string[] } {
  const removed: string[] = [];
  return { removed, persist: async (u) => u, remove: async (u) => void removed.push(u), readBase64: async () => '' };
}

async function populated() {
  const storage = createMemoryStorage();
  const photos = fakePhotoStore();
  const repo = new MemoryRepository({ storage, seed: false, photoStore: photos });
  await repo.init();
  await repo.upsertProject(project('p1'));
  await repo.upsertProject(project('p2'));
  for (const [i, id] of ['a', 'b', 'c'].entries()) await repo.upsertNode(node(id, 'p1', i + 1));
  await repo.upsertNode(node('z', 'p2', 1));
  await repo.upsertSpan(span('ab', 'p1', 'a', 'b'));
  await repo.upsertSpan(span('bc', 'p1', 'b', 'c'));
  await repo.upsertPhoto(photo('pa', 'p1', 'a'));
  await repo.upsertPhoto(photo('pb', 'p1', 'b'));
  await repo.upsertPhoto(photo('pz', 'p2', 'z'));
  return { repo, storage, photos };
}

describe('MemoryRepository CRUD', () => {
  test('starts empty without seed', async () => {
    const repo = new MemoryRepository({ seed: false });
    await repo.init();
    expect(await repo.listProjects()).toEqual([]);
    expect(await repo.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test('upsert inserts then updates, lists are scoped and ordered', async () => {
    const { repo } = await populated();
    await repo.upsertNode(node('b', 'p1', 2, { label: 'renamed' }));
    const nodes = await repo.listNodes('p1');
    expect(nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(nodes[1].label).toBe('renamed');
    expect((await repo.getNode('b'))?.label).toBe('renamed');
    expect(await repo.getNode('nope')).toBeNull();
    expect((await repo.listSpans('p1')).map((s) => s.id)).toEqual(['ab', 'bc']);
    expect((await repo.listPhotos('p2')).map((p) => p.id)).toEqual(['pz']);
    expect((await repo.getProject('p2'))?.name).toBe('p2');
  });

  test('projects are listed most recently updated first', async () => {
    const { repo } = await populated();
    await repo.upsertProject(project('p1', { updatedAt: '2026-11-13T00:00:00.000Z' }));
    expect((await repo.listProjects()).map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  test('returned objects are copies', async () => {
    const { repo } = await populated();
    const n = (await repo.getNode('a'))!;
    n.label = 'mutated';
    n.fields.x = 1;
    expect((await repo.getNode('a'))!.label).toBe('a');
    expect((await repo.getNode('a'))!.fields).toEqual({});
  });

  test('deleteSpan and deletePhoto', async () => {
    const { repo, photos } = await populated();
    await repo.deleteSpan('ab');
    expect((await repo.listSpans('p1')).map((s) => s.id)).toEqual(['bc']);
    await repo.deletePhoto('pa');
    expect((await repo.listPhotos('p1')).map((p) => p.id)).toEqual(['pb']);
    expect(photos.removed).toEqual(['file:///photos/pa.jpg', 'file:///photos/pa_wm.jpg']);
  });

  test('settings round trip merged with defaults', async () => {
    const repo = new MemoryRepository({ seed: false });
    await repo.saveSettings({ ...DEFAULT_SETTINGS, units: 'metric', aiMode: 'proxy', proxyUrl: 'https://x' });
    expect(await repo.getSettings()).toMatchObject({ units: 'metric', aiMode: 'proxy', proxyUrl: 'https://x', gpsAverageSeconds: 4 });
  });
});

describe('MemoryRepository cascades', () => {
  test('deleteNode removes touching spans, its photos, and clears duplicate flags', async () => {
    const { repo, photos } = await populated();
    await repo.upsertNode(node('c', 'p1', 3, { possibleDuplicateOf: 'b' }));
    await repo.deleteNode('b');
    expect((await repo.listNodes('p1')).map((n) => n.id)).toEqual(['a', 'c']);
    expect(await repo.listSpans('p1')).toEqual([]);
    expect((await repo.listPhotos('p1')).map((p) => p.id)).toEqual(['pa']);
    expect((await repo.getNode('c'))!.possibleDuplicateOf).toBeNull();
    expect(photos.removed).toContain('file:///photos/pb.jpg');
  });

  test('deleteProject removes its nodes, spans and photos only', async () => {
    const { repo, photos } = await populated();
    await repo.deleteProject('p1');
    expect((await repo.listProjects()).map((p) => p.id)).toEqual(['p2']);
    expect(await repo.listNodes('p1')).toEqual([]);
    expect(await repo.listSpans('p1')).toEqual([]);
    expect(await repo.listPhotos('p1')).toEqual([]);
    expect((await repo.listNodes('p2')).map((n) => n.id)).toEqual(['z']);
    expect((await repo.listPhotos('p2')).map((p) => p.id)).toEqual(['pz']);
    expect(photos.removed.sort()).toEqual(
      ['file:///photos/pa.jpg', 'file:///photos/pa_wm.jpg', 'file:///photos/pb.jpg', 'file:///photos/pb_wm.jpg'].sort(),
    );
  });

  test('deleteTemplate unlinks projects', async () => {
    const { repo } = await populated();
    await repo.upsertTemplate(template('t1'));
    await repo.upsertProject(project('p1', { templateId: 't1' }));
    await repo.deleteTemplate('t1');
    expect(await repo.listTemplates()).toEqual([]);
    expect((await repo.getProject('p1'))!.templateId).toBeNull();
  });
});

describe('MemoryRepository persistence', () => {
  test('a new instance reloads saved data', async () => {
    const { storage } = await populated();
    const again = new MemoryRepository({ storage, seed: true });
    await again.init();
    expect((await again.listProjects()).map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(await again.listNodes('p1')).toHaveLength(3);
  });

  test('seeds the demo once; a deleted demo stays deleted', async () => {
    const storage = createMemoryStorage();
    const repo = new MemoryRepository({ storage });
    await repo.init();
    expect((await repo.listProjects()).map((p) => p.id)).toEqual([DEMO_PROJECT_ID]);
    expect((await repo.listTemplates())[0].name).toBe('Demo Telecom Co');
    await repo.deleteProject(DEMO_PROJECT_ID);
    const again = new MemoryRepository({ storage });
    expect(await again.listProjects()).toEqual([]);
  });

  test('corrupt storage is backed up and reseeded', async () => {
    const storage = createMemoryStorage({ [MEMORY_STORAGE_KEY]: '{not json' });
    const repo = new MemoryRepository({ storage });
    expect(await repo.listProjects()).toHaveLength(1);
    expect(storage.data[`${MEMORY_STORAGE_KEY}:corrupt`]).toBe('{not json');
  });

  test('works with no storage at all', async () => {
    const repo = new MemoryRepository({ storage: null });
    await repo.upsertProject(project('x'));
    expect(await repo.getProject('x')).not.toBeNull();
  });

  test('storage quota errors fall back to saving without inline photos', async () => {
    const base = createMemoryStorage();
    const storage = {
      ...base,
      setItem: (k: string, v: string) => {
        if (v.length > 4000) throw new Error('QuotaExceededError');
        base.setItem(k, v);
      },
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = new MemoryRepository({ storage, seed: false });
    await repo.upsertProject(project('p'));
    await repo.upsertNode(node('n', 'p', 1));
    await repo.upsertPhoto({ ...photo('ph', 'p', 'n'), uri: `data:image/jpeg;base64,${'A'.repeat(5000)}`, watermarkedUri: null });
    // In-memory copy keeps the photo
    expect((await repo.listPhotos('p'))[0].uri.startsWith('data:')).toBe(true);
    // Persisted copy has field data but no inline image
    const saved = JSON.parse(base.data[MEMORY_STORAGE_KEY]);
    expect(saved.nodes).toHaveLength(1);
    expect(saved.photos[0].uri).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
