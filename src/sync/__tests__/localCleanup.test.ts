/// <reference types="jest" />
// "Remove company data from this phone": company rows of other companies go, local-only rows and
// kept companies stay, nothing is tombstoned (so nothing is deleted on the server), cursors reset.
import { MemoryRepository } from '@/data/memoryRepository';
import type { ClientTemplate, MapNode, Project } from '@/domain/types';

import { cursorKey } from '../engine';
import { findCompanyData, removeCompanyData } from '../localCleanup';

interface MockApp {
  state: { activeProjectId: string | null; reloadLists: jest.Mock<Promise<void>, []> };
  setState: jest.Mock<void, [Record<string, unknown>]>;
}
const mockApp: MockApp = {
  state: { activeProjectId: null, reloadLists: jest.fn(async () => undefined) },
  setState: jest.fn((patch: Record<string, unknown>): void => {
    Object.assign(mockApp.state, patch);
  }),
};
jest.mock('@/state/store', () => ({
  useStore: { getState: () => mockApp.state, setState: (p: Record<string, unknown>) => mockApp.setState(p) },
}));
jest.mock('@/data', () => ({
  getRepository: () => {
    throw new Error('tests pass a repository');
  },
}));

const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const T0 = '2026-11-12T10:00:00.000Z';

const project = (id: string, orgId: string | null): Project => ({
  id, name: id, client: '', jobNumber: '', workType: 'aerial', notes: '', status: 'active', ratePerFoot: null,
  ratePerNode: null, templateId: null, walkMode: false, ...(orgId ? { orgId } : {}), createdAt: T0, updatedAt: T0,
});
const node = (id: string, projectId: string): MapNode => ({
  id, projectId, seq: 1, type: 'pole', label: id,
  position: { lat: 33.5, lng: -86.8, accuracyM: 3, altitudeM: null, samples: 1, capturedAt: T0, source: 'gps' },
  fields: {}, aiMeta: {}, iconScale: 1, status: 'draft', notes: '', possibleDuplicateOf: null, createdAt: T0, updatedAt: T0,
});
const template = (id: string, orgId: string | null): ClientTemplate => ({
  id, name: id, client: '', labelPatterns: {}, requiredFields: {}, defaults: {}, defaultSpanKind: 'aerial', defaultSagPct: 2,
  defaultSlackFt: 0, ratePerFoot: null, ratePerNode: null, watermarkPhotos: true, ...(orgId ? { orgId } : {}), createdAt: T0, updatedAt: T0,
});

async function seed() {
  const repo = new MemoryRepository({ storage: null, seed: false });
  await repo.upsertProject(project('local', null));
  await repo.upsertProject(project('a1', ORG_A));
  await repo.upsertProject(project('b1', ORG_B));
  await repo.upsertNode(node('a1-n1', 'a1'));
  await repo.upsertTemplate(template('t-local', null));
  await repo.upsertTemplate(template('t-a', ORG_A));
  await repo.setSyncState(ORG_A, cursorKey('projects'), '{"rev":5}');
  return repo;
}

beforeEach(() => {
  mockApp.state.activeProjectId = null;
  mockApp.state.reloadLists.mockClear();
  mockApp.setState.mockClear();
});

test('finds rows of companies the user is not signed in to, never local ones', async () => {
  const repo = await seed();
  const found = await findCompanyData([ORG_B], repo);
  expect(found.projectIds).toEqual(['a1']);
  expect(found.templateIds).toEqual(['t-a']);
  expect(found.orgIds).toEqual([ORG_A]);
  expect(found.unsynced).toBeGreaterThan(0); // seeded rows were never pushed
});

test('signed out: removes every company row locally without tombstones, keeps local data', async () => {
  const repo = await seed();
  mockApp.state.activeProjectId = 'a1';
  await removeCompanyData([], repo);
  expect((await repo.listProjects()).map((p) => p.id)).toEqual(['local']);
  expect((await repo.listTemplates()).map((t) => t.id)).toEqual(['t-local']);
  expect(await repo.listNodes('a1')).toEqual([]);
  // Purged, not deleted: nothing is waiting to be pushed to the server.
  expect(await repo.listDirty({ orgId: ORG_A })).toEqual([]);
  expect(await repo.getSyncState(ORG_A, cursorKey('projects'))).toBeNull();
  expect(mockApp.setState).toHaveBeenCalledWith(expect.objectContaining({ activeProjectId: null }));
  expect(mockApp.state.reloadLists).toHaveBeenCalled();
});

test('keeps companies the user still belongs to', async () => {
  const repo = await seed();
  await removeCompanyData([ORG_A], repo);
  expect((await repo.listProjects()).map((p) => p.id).sort()).toEqual(['a1', 'local']);
});
