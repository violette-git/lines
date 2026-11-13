/// <reference types="jest" />
// SyncEngine against a fake server: two phones in one company, conflicts, tombstones, retries
// with backoff, photo Wi-Fi gating, viewers, refused rows, paging with orphans, cursor reset.
import { MemoryRepository } from '@/data/memoryRepository';
import type { SyncRepository } from '@/domain/contracts';
import type { MapNode, PhotoRef, Project, Span } from '@/domain/types';
import type { RemoteChange } from '@/state/store';

import { FakeServer, ManualTimers } from '../__testutils__/fakeServer';
import { SyncEngine, friendlySyncError, type EngineStatus, type NetworkState } from '../engine';
import { SyncTransportError } from '../transport';

const ORG = '0f000000-0000-4000-8000-000000000001';
const T0 = '2026-11-12T10:00:00.000Z';
const T1 = '2026-11-12T11:00:00.000Z';
const T2 = '2026-11-12T12:00:00.000Z';

const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id, name: id, client: '', jobNumber: '', workType: 'aerial', notes: '', status: 'active', ratePerFoot: null,
  ratePerNode: null, templateId: null, walkMode: true, orgId: ORG, createdAt: T0, updatedAt: T0, ...extra,
});
const node = (id: string, projectId: string, seq: number, extra: Partial<MapNode> = {}): MapNode => ({
  id, projectId, seq, type: 'pole', label: id,
  position: { lat: 33.5, lng: -86.8, accuracyM: 3, altitudeM: null, samples: 1, capturedAt: T0, source: 'gps' },
  fields: {}, aiMeta: {}, iconScale: 1, status: 'draft', notes: '', possibleDuplicateOf: null, createdAt: T0, updatedAt: T0, ...extra,
});
const span = (id: string, projectId: string, from: string, to: string): Span => ({
  id, projectId, fromNodeId: from, toNodeId: to, kind: 'aerial', slackFt: 0, sagPct: 2, lengthOverrideFt: null, fields: {},
  createdAt: T0, updatedAt: T0,
});
const photo = (id: string, projectId: string, nodeId: string): PhotoRef => ({
  id, projectId, nodeId, uri: `file:///photos/${id}.jpg`, watermarkedUri: null, width: 10, height: 10, takenAt: T0, fix: null,
  isPrimary: true,
});

interface Phone {
  repo: SyncRepository;
  engine: SyncEngine;
  timers: ManualTimers;
  net: NetworkState;
  settings: { syncPhotosWifiOnly?: boolean };
  statuses: EngineStatus[];
  changes: RemoteChange[];
  last(): EngineStatus;
}

function phone(server: FakeServer, opts: { canPush?: boolean; pullLimit?: number } = {}): Phone {
  const repo = new MemoryRepository({ storage: null, seed: false });
  const timers = new ManualTimers();
  const p = {
    repo,
    timers,
    net: { online: true, wifi: true },
    settings: { syncPhotosWifiOnly: true },
    statuses: [] as EngineStatus[],
    changes: [] as RemoteChange[],
  } as unknown as Phone;
  p.engine = new SyncEngine({
    orgId: ORG,
    repo,
    transport: server.transport(),
    getNetwork: async () => p.net,
    getSettings: () => p.settings,
    canPush: opts.canPush,
    onStatus: (s) => p.statuses.push(s),
    onRemoteChange: (c) => p.changes.push(c),
    timers,
    random: () => 0.5, // no jitter
    pullLimit: opts.pullLimit,
  });
  p.last = () => p.statuses[p.statuses.length - 1];
  return p;
}

async function seedAndSync(a: Phone) {
  await a.repo.upsertProject(project('p'));
  await a.repo.upsertNode(node('n1', 'p', 1));
  await a.repo.upsertNode(node('n2', 'p', 2));
  await a.repo.upsertSpan(span('s12', 'p', 'n1', 'n2'));
  await a.repo.upsertPhoto(photo('ph1', 'p', 'n1'));
  await a.engine.start();
}

describe('SyncEngine', () => {
  test('phone A pushes everything (photo uploaded first), phone B pulls it', async () => {
    const server = new FakeServer();
    const a = phone(server);
    const b = phone(server);
    await seedAndSync(a);

    expect(a.last()).toMatchObject({ phase: 'idle', pendingChanges: 0, pendingPhotos: 0, error: null });
    expect(a.last().lastSyncedAt).toBeTruthy();
    expect([...server.objects.keys()]).toEqual([`${ORG}/p/ph1.jpg`]);
    expect(server.tables.photos.get('ph1')?.storage_path).toBe(`${ORG}/p/ph1.jpg`);
    expect(server.tables.nodes.size).toBe(2);
    expect(a.statuses.map((s) => s.phase)).toEqual(expect.arrayContaining(['pushing', 'uploading_photos', 'pulling', 'idle']));

    await b.engine.start();
    expect((await b.repo.listNodes('p')).map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(await b.repo.listSpans('p')).toHaveLength(1);
    const [bp] = await b.repo.listPhotos('p');
    expect(bp).toMatchObject({ id: 'ph1', uri: '', storagePath: `${ORG}/p/ph1.jpg` });
    expect(await b.repo.listDirty({ orgId: ORG })).toEqual([]);
    const tablesTouched = new Set(b.changes.flatMap((c) => Object.keys(c.tables)));
    expect([...tablesTouched].sort()).toEqual(['nodes', 'photos', 'projects', 'spans']);
    expect(b.changes.some((c) => c.projectIds.includes('p'))).toBe(true);

    // Nothing new: another round trip pushes nothing and applies nothing.
    const pushesBefore = server.calls.push;
    b.changes.length = 0;
    await b.engine.requestSync();
    expect(server.calls.push).toBe(pushesBefore);
    expect(b.changes).toEqual([]);
  });

  test('conflicting edits: the later device edit wins on both phones', async () => {
    const server = new FakeServer();
    const a = phone(server);
    const b = phone(server);
    await seedAndSync(a);
    await b.engine.start();

    await a.repo.upsertNode(node('n1', 'p', 1, { label: 'A-later', updatedAt: T2 }));
    await b.repo.upsertNode(node('n1', 'p', 1, { label: 'B-earlier', updatedAt: T1 }));
    await a.engine.requestSync();
    await b.engine.requestSync(); // B's older edit is stale: B takes A's row
    expect((await b.repo.getNode('n1'))?.label).toBe('A-later');
    expect(await b.repo.listDirty({ orgId: ORG })).toEqual([]);
    expect(b.changes.some((c) => c.tables.nodes?.upserted.includes('n1'))).toBe(true);

    await b.repo.upsertNode(node('n1', 'p', 1, { label: 'B-newest', updatedAt: '2026-11-12T13:00:00.000Z' }));
    await b.engine.requestSync();
    await a.engine.requestSync();
    expect((await a.repo.getNode('n1'))?.label).toBe('B-newest');
  });

  test('a phone with a slow clock converges on the server row even when it already pulled it', async () => {
    const server = new FakeServer();
    const a = phone(server);
    const b = phone(server);
    await seedAndSync(a);
    await a.repo.upsertNode(node('n1', 'p', 1, { label: 'A', updatedAt: T2 }));
    await a.engine.requestSync();
    await b.engine.start(); // B already has A's row; its cursor is past it
    await b.repo.upsertNode(node('n1', 'p', 1, { label: 'B slow clock', updatedAt: T1 }));
    await b.engine.requestSync();
    expect((await b.repo.getNode('n1'))?.label).toBe('A');
    expect(await b.repo.listDirty({ orgId: ORG })).toEqual([]);
    expect(server.tables.nodes.get('n1')?.label).toBe('A');
  });

  test('tombstones travel: a node deleted on A disappears (with its span and photo) on B', async () => {
    const server = new FakeServer();
    const a = phone(server);
    const b = phone(server);
    await seedAndSync(a);
    await b.engine.start();

    await a.repo.deleteNode('n1');
    await a.engine.requestSync();
    expect(server.tables.nodes.get('n1')?.deleted_at).toBeTruthy();
    expect(server.tables.spans.get('s12')?.deleted_at).toBeTruthy();
    expect(await a.repo.listDirty({ orgId: ORG })).toEqual([]);

    await b.engine.requestSync();
    expect((await b.repo.listNodes('p')).map((n) => n.id)).toEqual(['n2']);
    expect(await b.repo.listSpans('p')).toEqual([]);
    expect(await b.repo.listPhotos('p')).toEqual([]);
    expect(b.changes.some((c) => c.tables.nodes?.deleted.includes('n1'))).toBe(true);
  });

  test('deletes win: an offline edit of a node deleted elsewhere is dropped locally', async () => {
    const server = new FakeServer();
    const a = phone(server);
    const b = phone(server);
    await seedAndSync(a);
    await b.engine.start();
    server.edit('nodes', 'n2', { deleted_at: T1, client_updated_at: T1 });
    await b.repo.upsertNode(node('n2', 'p', 2, { label: 'edited offline', updatedAt: T2 }));
    await b.engine.requestSync();
    expect(await b.repo.getNode('n2')).toBeNull();
    expect(server.tables.nodes.get('n2')?.label).toBe('n2');
    expect(await b.repo.listDirty({ orgId: ORG })).toEqual([]);
  });

  test('failures back off exponentially, then recover', async () => {
    const server = new FakeServer();
    const a = phone(server);
    await a.repo.upsertProject(project('p'));
    server.failPushes = 3;

    await a.engine.start();
    expect(a.last()).toMatchObject({ phase: 'error', pendingChanges: 1 });
    expect(a.last().error).toMatch(/reach the server/);
    expect(a.engine.nextRetryDelay).toBe(2000);

    a.timers.advance(1999);
    await a.engine.whenIdle();
    expect(server.calls.push).toBe(1);
    a.timers.advance(1);
    await a.engine.whenIdle();
    expect(server.calls.push).toBe(2);
    expect(a.engine.nextRetryDelay).toBe(4000);

    a.timers.advance(4000);
    await a.engine.whenIdle();
    expect(a.engine.nextRetryDelay).toBe(8000);
    a.timers.advance(8000);
    await a.engine.whenIdle();
    expect(a.last()).toMatchObject({ phase: 'idle', pendingChanges: 0, error: null });
    expect(a.engine.failureCount).toBe(0);
    expect(server.tables.projects.has('p')).toBe(true);
  });

  test('backoff is capped', async () => {
    const server = new FakeServer();
    const a = phone(server);
    await a.repo.upsertProject(project('p'));
    server.failPushes = 100;
    await a.engine.start();
    for (let i = 0; i < 12; i++) {
      a.timers.advance(a.engine.nextRetryDelay!);
      await a.engine.whenIdle();
    }
    expect(a.engine.nextRetryDelay).toBe(300_000);
  });

  test('connectivity regained retries immediately; offline makes no calls', async () => {
    const server = new FakeServer();
    const a = phone(server);
    await a.repo.upsertProject(project('p'));
    a.net = { online: false, wifi: false };
    await a.engine.start();
    expect(a.last().phase).toBe('offline');
    expect(server.calls.push + server.calls.pull).toBe(0);

    a.net = { online: true, wifi: true };
    a.engine.setNetwork({ online: false, wifi: false });
    a.engine.setNetwork({ online: true, wifi: true });
    await a.engine.whenIdle();
    expect(server.tables.projects.has('p')).toBe(true);
    expect(a.last().phase).toBe('idle');
  });

  test('photos wait for Wi-Fi when the setting is on; field data still syncs', async () => {
    const server = new FakeServer();
    const a = phone(server);
    a.net = { online: true, wifi: false };
    await seedAndSync(a);

    expect(server.calls.upload).toBe(0);
    expect(server.tables.nodes.size).toBe(2);
    expect(server.tables.photos.size).toBe(0); // row waits for its file
    expect(a.last()).toMatchObject({ phase: 'idle', waitingForWifi: true, pendingPhotos: 1 });

    a.net = { online: true, wifi: true };
    await a.engine.requestSync();
    expect(server.calls.upload).toBe(1);
    expect(server.tables.photos.get('ph1')?.storage_path).toBe(`${ORG}/p/ph1.jpg`);
    expect(a.last()).toMatchObject({ waitingForWifi: false, pendingPhotos: 0, pendingChanges: 0 });
  });

  test('with the Wi-Fi setting off, photos upload on cellular; the watermarked copy goes up too', async () => {
    const server = new FakeServer();
    const a = phone(server);
    a.net = { online: true, wifi: false };
    a.settings.syncPhotosWifiOnly = false;
    await a.repo.upsertProject(project('p'));
    await a.repo.upsertNode(node('n1', 'p', 1));
    await a.repo.upsertPhoto({ ...photo('ph1', 'p', 'n1'), watermarkedUri: 'file:///photos/ph1_wm.jpg' });
    await a.engine.start();
    expect([...server.objects.keys()].sort()).toEqual([`${ORG}/p/ph1.jpg`, `${ORG}/p/ph1_wm.jpg`]);
    expect(server.tables.photos.get('ph1')).toMatchObject({ watermarked_path: `${ORG}/p/ph1_wm.jpg` });
  });

  test('a failed photo upload is retried with backoff while everything else syncs', async () => {
    const server = new FakeServer();
    const a = phone(server);
    server.failUploads = 1;
    await seedAndSync(a);
    expect(server.tables.nodes.size).toBe(2);
    expect(a.last()).toMatchObject({ phase: 'error', pendingPhotos: 1 });
    expect(a.last().error).toMatch(/1 photo could not upload/);
    a.timers.advance(a.engine.nextRetryDelay!);
    await a.engine.whenIdle();
    expect(a.last()).toMatchObject({ phase: 'idle', pendingPhotos: 0 });
    expect(server.tables.photos.has('ph1')).toBe(true);
  });

  test('viewers only pull', async () => {
    const server = new FakeServer();
    const a = phone(server);
    await seedAndSync(a);
    const v = phone(server, { canPush: false });
    await v.engine.start();
    await v.repo.upsertNode(node('n1', 'p', 1, { label: 'viewer edit', updatedAt: T2 }));
    const pushes = server.calls.push;
    await v.engine.requestSync();
    expect(server.calls.push).toBe(pushes);
    expect(server.tables.nodes.get('n1')?.label).toBe('n1');
  });

  test('refused rows are reported and not retried until "Sync now"', async () => {
    const server = new FakeServer();
    const a = phone(server);
    server.refuse.add('projects');
    await a.repo.upsertProject(project('p'));
    await a.engine.start();
    expect(a.last()).toMatchObject({ phase: 'idle', rejected: 1, pendingChanges: 0 });
    const pushes = server.calls.push;
    await a.engine.requestSync();
    expect(server.calls.push).toBe(pushes); // nothing to push

    server.refuse.clear();
    await a.engine.syncNow();
    expect(server.tables.projects.has('p')).toBe(true);
    expect(a.last()).toMatchObject({ rejected: 0, pendingChanges: 0 });
  });

  test('local edits sync 5 seconds after the last one; the 2-minute timer keeps pulling', async () => {
    const server = new FakeServer();
    const a = phone(server);
    await a.engine.start();
    await a.repo.upsertProject(project('p'));
    a.engine.notifyLocalChange();
    a.timers.advance(3000);
    a.engine.notifyLocalChange(); // restarts the debounce
    a.timers.advance(4999);
    await a.engine.whenIdle();
    expect(server.tables.projects.has('p')).toBe(false);
    a.timers.advance(1);
    await a.engine.whenIdle();
    expect(server.tables.projects.has('p')).toBe(true);

    const pulls = server.calls.pull;
    a.timers.advance(120_000);
    await a.engine.whenIdle();
    expect(server.calls.pull).toBeGreaterThan(pulls);

    // In the background the interval stops.
    a.engine.setForeground(false);
    await a.engine.whenIdle();
    const pulls2 = server.calls.pull;
    a.timers.advance(600_000);
    await a.engine.whenIdle();
    expect(server.calls.pull).toBe(pulls2);
    a.engine.stop();
    expect(a.timers.pending()).toEqual([]);
  });

  test('paging: children whose parent is on a later page wait for it instead of being lost', async () => {
    const server = new FakeServer();
    const a = phone(server);
    // Create nodes first, then update the projects so their rev is newer than the nodes'.
    for (const pid of ['p1', 'p2', 'p3']) await a.repo.upsertProject(project(pid));
    await a.engine.start();
    for (const [i, pid] of ['p1', 'p2', 'p3'].entries()) await a.repo.upsertNode(node(`n${i}`, pid, 1));
    await a.engine.requestSync();
    // Reverse order: the first node's project is now the LAST project page.
    for (const pid of ['p3', 'p2', 'p1']) server.edit('projects', pid, { name: `${pid}!`, client_updated_at: T1 });

    const b = phone(server, { pullLimit: 1 });
    await b.engine.start();
    for (const [i, pid] of ['p1', 'p2', 'p3'].entries()) {
      expect((await b.repo.getProject(pid))?.name).toBe(`${pid}!`);
      expect((await b.repo.listNodes(pid)).map((n) => n.id)).toEqual([`n${i}`]);
    }
    expect(b.last().phase).toBe('idle');
  });

  test('server asks for a reset: cursors are cleared and everything is pulled again', async () => {
    const server = new FakeServer();
    const a = phone(server);
    await seedAndSync(a);
    const b = phone(server);
    await b.engine.start();
    await b.repo.purgeLocal('nodes', ['n2']); // simulate a lost local row
    server.resetOnce = true;
    await b.engine.requestSync();
    expect((await b.repo.listNodes('p')).map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(b.last().phase).toBe('idle');
  });

  test('a local-only project never leaves the phone; moving it into the company sends it all', async () => {
    const server = new FakeServer();
    const a = phone(server);
    await a.repo.upsertProject(project('lp', { orgId: null }));
    await a.repo.upsertNode(node('ln', 'lp', 1));
    await a.engine.start();
    expect(server.tables.projects.size).toBe(0);
    await a.repo.moveProjectToOrg('lp', ORG);
    await a.engine.requestSync();
    expect(server.tables.projects.get('lp')?.org_id).toBe(ORG);
    expect(server.tables.nodes.get('ln')?.project_id).toBe('lp');
  });

  test('friendly error messages', () => {
    expect(friendlySyncError(new SyncTransportError('denied', '42501'))).toMatch(/access/);
    expect(friendlySyncError(new Error('JWT expired'))).toMatch(/sign-in expired/);
    expect(friendlySyncError(new TypeError('Network request failed'))).toMatch(/reach the server/);
    expect(friendlySyncError('weird')).toMatch(/^Sync problem: weird/);
  });
});
