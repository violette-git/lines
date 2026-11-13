/// <reference types="jest" />
// Sync bookkeeping contract, run against BOTH repositories: the in-memory one (web) and the real
// SqliteRepository SQL on Node's built-in SQLite (skipped if this Node has no node:sqlite).
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

import { createNodeSqliteDb, nodeSqliteAvailable } from '@/data/__testutils__/nodeSqlite';
import { createMemoryStorage } from '@/data/kvStorage';
import { MemoryRepository } from '@/data/memoryRepository';
import { MIGRATIONS, runMigrations } from '@/data/migrations';
import { SqliteRepository } from '@/data/sqliteRepository';
import type { LocalChangeEvent, PhotoStore, SyncRepository } from '@/domain/contracts';
import type { ClientTemplate, MapNode, PhotoRef, Project, Span } from '@/domain/types';

const T0 = '2026-11-12T10:00:00.000Z';
const T1 = '2026-11-12T11:00:00.000Z';
const T2 = '2026-11-12T12:00:00.000Z';
const ORG = '0f000000-0000-4000-8000-000000000001';

const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id, name: id, client: '', jobNumber: '', workType: 'aerial', notes: '', status: 'active', ratePerFoot: null,
  ratePerNode: null, templateId: null, walkMode: true, createdAt: T0, updatedAt: T0, ...extra,
});
const node = (id: string, projectId: string, seq: number, extra: Partial<MapNode> = {}): MapNode => ({
  id, projectId, seq, type: 'pole', label: id,
  position: { lat: 33.5, lng: -86.8, accuracyM: 3, altitudeM: null, samples: 1, capturedAt: T0, source: 'gps' },
  fields: {}, aiMeta: {}, iconScale: 1, status: 'draft', notes: '', possibleDuplicateOf: null, createdAt: T0, updatedAt: T0, ...extra,
});
const span = (id: string, projectId: string, from: string, to: string, extra: Partial<Span> = {}): Span => ({
  id, projectId, fromNodeId: from, toNodeId: to, kind: 'aerial', slackFt: 0, sagPct: 2, lengthOverrideFt: null, fields: {},
  createdAt: T0, updatedAt: T0, ...extra,
});
const photo = (id: string, projectId: string, nodeId: string, extra: Partial<PhotoRef> = {}): PhotoRef => ({
  id, projectId, nodeId, uri: `file:///photos/${id}.jpg`, watermarkedUri: null, width: 10, height: 10, takenAt: T0, fix: null,
  isPrimary: true, ...extra,
});
const template = (id: string, extra: Partial<ClientTemplate> = {}): ClientTemplate => ({
  id, name: id, client: 'c', labelPatterns: {}, requiredFields: {}, defaults: {}, defaultSpanKind: 'aerial', defaultSagPct: 2,
  defaultSlackFt: 0, ratePerFoot: null, ratePerNode: null, watermarkPhotos: true, createdAt: T0, updatedAt: T0, ...extra,
});

function fakePhotoStore(): PhotoStore & { removed: string[] } {
  const removed: string[] = [];
  return { removed, persist: async (u) => u, remove: async (u) => void removed.push(u), readBase64: async () => '' };
}

type Factory = () => { repo: SyncRepository; files: ReturnType<typeof fakePhotoStore> };

const factories: [string, Factory][] = [
  [
    'MemoryRepository',
    () => {
      const files = fakePhotoStore();
      return { repo: new MemoryRepository({ storage: createMemoryStorage(), seed: false, photoStore: files }), files };
    },
  ],
];
if (nodeSqliteAvailable()) {
  factories.push([
    'SqliteRepository',
    () => {
      const files = fakePhotoStore();
      const db = createNodeSqliteDb();
      return { repo: new SqliteRepository(files, 'test.db', async () => db), files };
    },
  ]);
}

/** Company project with two nodes, a span and a photo, all acknowledged by the server. */
async function syncedCompanyProject(repo: SyncRepository) {
  await repo.upsertProject(project('p', { orgId: ORG }));
  await repo.upsertNode(node('a', 'p', 1));
  await repo.upsertNode(node('b', 'p', 2));
  await repo.upsertSpan(span('ab', 'p', 'a', 'b'));
  await repo.upsertPhoto(photo('pb', 'p', 'b'));
  await repo.markPhotoUploaded('pb', { storagePath: `${ORG}/p/pb.jpg` });
  for (const r of await repo.listDirty({ orgId: ORG })) {
    await repo.markSynced(r.table, [{ id: r.row.id, dirty: r.meta.dirty, rev: 10 }]);
  }
}

describe.each(factories)('%s sync contract', (_name, make) => {
  test('local-only rows are never listed for sync and delete outright', async () => {
    const { repo } = make();
    await repo.upsertProject(project('lp'));
    await repo.upsertNode(node('ln', 'lp', 1));
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);
    await repo.deleteNode('ln');
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);
    expect(await repo.getNode('ln')).toBeNull();
    expect((await repo.countPending(ORG)).changes).toBe(0);
  });

  test('company rows inherit the org, come back dirty in parent-first order, and clear on ack', async () => {
    const { repo } = make();
    await repo.upsertProject(project('p', { orgId: ORG }));
    await repo.upsertNode(node('b', 'p', 2));
    await repo.upsertNode(node('a', 'p', 1));
    await repo.upsertSpan(span('ab', 'p', 'a', 'b'));
    await repo.upsertPhoto(photo('pa', 'p', 'a'));
    const dirty = await repo.listDirty({ orgId: ORG });
    expect(dirty.map((r) => `${r.table}:${r.row.id}`)).toEqual(['projects:p', 'nodes:a', 'nodes:b', 'spans:ab', 'photos:pa']);
    expect(dirty.every((r) => r.meta.orgId === ORG && r.meta.dirty > 0 && r.meta.deletedAt === null)).toBe(true);
    expect((await repo.getProject('p'))?.orgId).toBe(ORG);
    expect(await repo.countPending(ORG)).toEqual({ changes: 5, photos: 1, rejected: 0 });

    for (const r of dirty) await repo.markSynced(r.table, [{ id: r.row.id, dirty: r.meta.dirty, rev: 7 }]);
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);
    expect(await repo.listDirty({ projectId: 'p' })).toEqual([]);
  });

  test('an edit made while a push is in flight stays dirty', async () => {
    const { repo } = make();
    await repo.upsertProject(project('p', { orgId: ORG }));
    await repo.upsertNode(node('a', 'p', 1));
    const [, pushed] = await repo.listDirty({ orgId: ORG });
    await repo.upsertNode(node('a', 'p', 1, { label: 'edited', updatedAt: T1 }));
    await repo.markSynced('nodes', [{ id: 'a', dirty: pushed.meta.dirty, rev: 3 }]);
    const again = (await repo.listDirty({ orgId: ORG })).find((r) => r.row.id === 'a');
    expect(again?.meta.serverRev).toBe(3);
    expect((again?.row as MapNode).label).toBe('edited');
  });

  test('deleting a synced node leaves hidden tombstones (with cascade) until acknowledged', async () => {
    const { repo, files } = make();
    await syncedCompanyProject(repo);
    await repo.deleteNode('b');
    expect(await repo.getNode('b')).toBeNull();
    expect((await repo.listNodes('p')).map((n) => n.id)).toEqual(['a']);
    expect(await repo.listSpans('p')).toEqual([]);
    expect(await repo.listPhotos('p')).toEqual([]);
    expect(files.removed).toContain('file:///photos/pb.jpg');

    const dirty = await repo.listDirty({ orgId: ORG });
    expect(dirty.map((r) => `${r.table}:${r.row.id}`).sort()).toEqual(['nodes:b', 'photos:pb', 'spans:ab']);
    expect(dirty.every((r) => r.meta.deletedAt)).toBe(true);
    // The tombstone carries the delete time as its edit time (last-write-wins on the server).
    expect(Date.parse((dirty.find((r) => r.row.id === 'b')!.row as MapNode).updatedAt)).toBeGreaterThan(Date.parse(T0));

    // A stale app write cannot resurrect a tombstone.
    await repo.upsertNode(node('b', 'p', 2, { label: 'ghost' }));
    expect(await repo.getNode('b')).toBeNull();

    for (const r of dirty) await repo.markSynced(r.table, [{ id: r.row.id, dirty: r.meta.dirty, rev: 11 }]);
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);
    expect(await repo.countPending(ORG)).toEqual({ changes: 0, photos: 0, rejected: 0 });
  });

  test('deleting a company project tombstones everything in it', async () => {
    const { repo } = make();
    await syncedCompanyProject(repo);
    await repo.deleteProject('p');
    expect(await repo.listProjects()).toEqual([]);
    const dirty = await repo.listDirty({ orgId: ORG });
    expect(dirty.map((r) => r.table).sort()).toEqual(['nodes', 'nodes', 'photos', 'projects', 'spans']);
  });

  test('deleting a company template tombstones it and unlinks projects', async () => {
    const { repo } = make();
    await repo.upsertTemplate(template('t', { orgId: ORG }));
    await repo.upsertProject(project('p', { orgId: ORG, templateId: 't' }));
    expect((await repo.listTemplates())[0].orgId).toBe(ORG);
    await repo.deleteTemplate('t');
    expect(await repo.listTemplates()).toEqual([]);
    expect((await repo.getProject('p'))?.templateId).toBeNull();
    expect((await repo.listDirty({ orgId: ORG })).find((r) => r.table === 'templates')?.meta.deletedAt).toBeTruthy();
  });

  test('server rows are applied without becoming dirty, and no change event fires', async () => {
    const { repo } = make();
    const events: LocalChangeEvent[] = [];
    repo.onLocalChange((e) => events.push(e));
    const out1 = await repo.applyServerRows('projects', [{ row: project('sp', { orgId: ORG }), orgId: ORG, rev: 1, deletedAt: null }]);
    const out2 = await repo.applyServerRows('nodes', [{ row: node('sn', 'sp', 1), orgId: ORG, rev: 2, deletedAt: null }]);
    expect(out1.applied).toEqual(['sp']);
    expect(out2.projectIds).toEqual(['sp']);
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);
    expect(events).toEqual([]);
    expect((await repo.getProject('sp'))?.orgId).toBe(ORG);
    expect((await repo.getNode('sn'))?.label).toBe('sn');

    // The same server revision again (our own push echoed back by a pull) is not re-applied.
    const echo = await repo.applyServerRows('nodes', [{ row: node('sn', 'sp', 1, { label: 'echo' }), orgId: ORG, rev: 2, deletedAt: null }]);
    expect(echo.applied).toEqual([]);
    expect((await repo.getNode('sn'))?.label).toBe('sn');

    await repo.upsertNode(node('sn', 'sp', 1, { label: 'mine' }));
    expect(events).toEqual([{ table: 'nodes', id: 'sn' }]);
  });

  test('a newer unsynced local edit survives an older server row; force or a newer server row wins', async () => {
    const { repo } = make();
    await repo.applyServerRows('projects', [{ row: project('p', { orgId: ORG }), orgId: ORG, rev: 1, deletedAt: null }]);
    await repo.applyServerRows('nodes', [{ row: node('n', 'p', 1), orgId: ORG, rev: 2, deletedAt: null }]);
    await repo.upsertNode(node('n', 'p', 1, { label: 'local', updatedAt: T1 }));

    const older = await repo.applyServerRows('nodes', [
      { row: node('n', 'p', 1, { label: 'server-old', updatedAt: T0 }), orgId: ORG, rev: 3, deletedAt: null },
    ]);
    expect(older.keptLocal).toEqual(['n']);
    expect((await repo.getNode('n'))?.label).toBe('local');

    const newer = await repo.applyServerRows('nodes', [
      { row: node('n', 'p', 1, { label: 'server-new', updatedAt: T2 }), orgId: ORG, rev: 4, deletedAt: null },
    ]);
    expect(newer.applied).toEqual(['n']);
    expect((await repo.getNode('n'))?.label).toBe('server-new');
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);

    await repo.upsertNode(node('n', 'p', 1, { label: 'local2', updatedAt: '2030-01-01T00:00:00.000Z' }));
    await repo.applyServerRows('nodes', [{ row: node('n', 'p', 1, { label: 'forced', updatedAt: T2 }), orgId: ORG, rev: 5, deletedAt: null }], {
      force: true,
    });
    expect((await repo.getNode('n'))?.label).toBe('forced');
  });

  test('server tombstones remove the local row and its children', async () => {
    const { repo, files } = make();
    await syncedCompanyProject(repo);
    const out = await repo.applyServerRows('nodes', [{ row: node('b', 'p', 2), orgId: ORG, rev: 20, deletedAt: T1 }]);
    expect(out.deleted).toEqual(['b']);
    expect(await repo.listSpans('p')).toEqual([]);
    expect(await repo.listPhotos('p')).toEqual([]);
    expect(files.removed).toContain('file:///photos/pb.jpg');
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);
    // Tombstone for a row this phone never had is a no-op.
    expect((await repo.applyServerRows('spans', [{ row: span('zz', 'p', 'a', 'b'), orgId: ORG, rev: 21, deletedAt: T1 }])).deleted).toEqual([]);
  });

  test('orphans: stop (parent may come later) or skip (parent is not coming)', async () => {
    const { repo } = make();
    await repo.applyServerRows('projects', [{ row: project('p', { orgId: ORG }), orgId: ORG, rev: 1, deletedAt: null }]);
    const rows = [
      { row: node('n1', 'p', 1), orgId: ORG, rev: 2, deletedAt: null },
      { row: node('n2', 'missing', 1), orgId: ORG, rev: 3, deletedAt: null },
      { row: node('n3', 'p', 3), orgId: ORG, rev: 4, deletedAt: null },
    ];
    const stopped = await repo.applyServerRows('nodes', rows, { stopAtOrphan: true });
    expect(stopped).toMatchObject({ applied: ['n1'], stopped: true });
    expect(await repo.getNode('n3')).toBeNull();
    const skipped = await repo.applyServerRows('nodes', rows);
    // n1 is already here at that revision, so only n3 is new.
    expect(skipped).toMatchObject({ applied: ['n3'], orphans: ['n2'], stopped: false });
  });

  test('photo uploads: pending list, recorded paths survive stale app writes, new watermark re-queues', async () => {
    const { repo } = make();
    await repo.upsertProject(project('p', { orgId: ORG }));
    await repo.upsertNode(node('a', 'p', 1));
    await repo.upsertPhoto(photo('ph', 'p', 'a'));
    let pending = await repo.listPendingPhotoUploads(ORG);
    expect(pending.map((x) => [x.photo.id, x.needsOriginal, x.needsWatermarked])).toEqual([['ph', true, false]]);
    const staleCopy = (await repo.listPhotos('p'))[0];

    const before = (await repo.listDirty({ orgId: ORG })).find((r) => r.row.id === 'ph')!.meta.dirty;
    await repo.markPhotoUploaded('ph', { storagePath: `${ORG}/p/ph.jpg` });
    const after = (await repo.listDirty({ orgId: ORG })).find((r) => r.row.id === 'ph')!;
    expect(after.meta.dirty).toBeGreaterThan(before);
    expect((after.row as PhotoRef).storagePath).toBe(`${ORG}/p/ph.jpg`);
    expect((after.row as PhotoRef).uploadState).toBe('uploaded');
    expect(await repo.listPendingPhotoUploads(ORG)).toEqual([]);

    // App writes the old object (no paths) back, e.g. setting it primary: paths are kept.
    await repo.upsertPhoto({ ...staleCopy, isPrimary: false });
    expect((await repo.listPhotos('p'))[0].storagePath).toBe(`${ORG}/p/ph.jpg`);
    expect(await repo.listPendingPhotoUploads(ORG)).toEqual([]);

    // Watermark generated later: only the watermarked copy is pending.
    await repo.upsertPhoto({ ...staleCopy, watermarkedUri: 'file:///photos/ph_wm.jpg' });
    pending = await repo.listPendingPhotoUploads(ORG);
    expect(pending.map((x) => [x.needsOriginal, x.needsWatermarked])).toEqual([[false, true]]);
    await repo.markPhotoUploaded('ph', { watermarkedPath: `${ORG}/p/ph_wm.jpg` });
    expect(await repo.listPendingPhotoUploads(ORG)).toEqual([]);

    await repo.markPhotoUploadFailed('ph', 'x');
    expect((await repo.listPhotos('p'))[0].uploadState).toBe('failed');
  });

  test('server photos keep local files and take bucket paths; downloaded files are stored without dirtying', async () => {
    const { repo } = make();
    await repo.applyServerRows('projects', [{ row: project('p', { orgId: ORG }), orgId: ORG, rev: 1, deletedAt: null }]);
    await repo.applyServerRows('nodes', [{ row: node('a', 'p', 1), orgId: ORG, rev: 2, deletedAt: null }]);
    const remote = photo('rp', 'p', 'a', { uri: '', storagePath: `${ORG}/p/rp.jpg`, updatedAt: T0 });
    await repo.applyServerRows('photos', [{ row: remote, orgId: ORG, rev: 3, deletedAt: null }]);
    let got = (await repo.listPhotos('p'))[0];
    expect(got).toMatchObject({ uri: '', storagePath: `${ORG}/p/rp.jpg`, uploadState: 'uploaded' });
    expect(await repo.listPendingPhotoUploads(ORG)).toEqual([]);

    await repo.setPhotoLocalFiles('rp', { uri: 'file:///cache/rp.jpg' });
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);
    await repo.applyServerRows('photos', [{ row: { ...remote, isPrimary: false, updatedAt: T1 }, orgId: ORG, rev: 4, deletedAt: null }]);
    got = (await repo.listPhotos('p'))[0];
    expect(got).toMatchObject({ uri: 'file:///cache/rp.jpg', isPrimary: false, storagePath: `${ORG}/p/rp.jpg` });
  });

  test('refused rows are held back until edited again or retried', async () => {
    const { repo } = make();
    await repo.upsertProject(project('p', { orgId: ORG }));
    const [r] = await repo.listDirty({ orgId: ORG });
    await repo.markRejected('projects', [{ id: 'p', dirty: r.meta.dirty, reason: 'No permission' }]);
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);
    expect(await repo.countPending(ORG)).toMatchObject({ changes: 0, rejected: 1 });
    expect(await repo.clearRejected(ORG)).toBe(1);
    expect(await repo.listDirty({ orgId: ORG })).toHaveLength(1);

    const [r2] = await repo.listDirty({ orgId: ORG });
    await repo.markRejected('projects', [{ id: 'p', dirty: r2.meta.dirty, reason: 'No permission' }]);
    await repo.upsertProject(project('p', { orgId: ORG, name: 'renamed' }));
    expect(await repo.listDirty({ orgId: ORG })).toHaveLength(1);
  });

  test('moveProjectToOrg brings the whole project into the company', async () => {
    const { repo } = make();
    await repo.upsertProject(project('lp'));
    await repo.upsertNode(node('a', 'lp', 1));
    await repo.upsertNode(node('b', 'lp', 2));
    await repo.upsertSpan(span('ab', 'lp', 'a', 'b'));
    await repo.upsertPhoto(photo('pa', 'lp', 'a'));
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);
    await repo.moveProjectToOrg('lp', ORG);
    const dirty = await repo.listDirty({ orgId: ORG });
    expect(dirty.map((r) => r.table)).toEqual(['projects', 'nodes', 'nodes', 'spans', 'photos']);
    expect((await repo.getProject('lp'))?.orgId).toBe(ORG);
    expect((await repo.listPendingPhotoUploads(ORG)).map((x) => x.photo.id)).toEqual(['pa']);
    // App writes cannot change the org afterwards.
    await repo.upsertProject({ ...(await repo.getProject('lp'))!, orgId: null });
    expect((await repo.getProject('lp'))?.orgId).toBe(ORG);
    await expect(repo.moveProjectToOrg('lp', '0f000000-0000-4000-8000-000000000002')).rejects.toThrow();
  });

  test('per-org sync state', async () => {
    const { repo } = make();
    expect(await repo.getSyncState(ORG, 'cursor:nodes')).toBeNull();
    await repo.setSyncState(ORG, 'cursor:nodes', '{"txid":"5","rev":2}');
    expect(await repo.getSyncState(ORG, 'cursor:nodes')).toBe('{"txid":"5","rev":2}');
    expect(await repo.getSyncState('other', 'cursor:nodes')).toBeNull();
    await repo.setSyncState(ORG, 'cursor:nodes', null);
    expect(await repo.getSyncState(ORG, 'cursor:nodes')).toBeNull();
  });
});

(nodeSqliteAvailable() ? describe : describe.skip)('SQLite migration v3 on an existing Phase 1 database', () => {
  test('upgrades in place: old rows stay, are local-only and clean', async () => {
    const db = createNodeSqliteDb();
    await runMigrations(db, MIGRATIONS.filter((m) => m.version <= 2));
    await db.runAsync(
      `INSERT INTO projects (id, name, client, job_number, work_type, notes, status, walk_mode, created_at, updated_at)
       VALUES ('old', 'Old job', '', '', 'aerial', '', 'active', 1, ?, ?)`,
      [T0, T0],
    );
    const repo = new SqliteRepository(null, 'x.db', async () => db);
    const list = await repo.listProjects();
    expect(list.map((p) => [p.id, p.orgId])).toEqual([['old', undefined]]);
    const cols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(photos)')).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['org_id', 'dirty', 'deleted_at', 'server_rev', 'synced_at', 'upload_state', 'storage_path']));
    expect(await db.getFirstAsync<{ v: number }>('SELECT MAX(version) AS v FROM schema_version')).toEqual({ v: 3 });
    const st = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_state'");
    expect(st).toHaveLength(1);
  });
});
