/// <reference types="jest" />
// Store behaviour added for sync: per-node serialized updates (AI result vs label edit race),
// company filtering, live refresh of the open project from pulled rows, moving a project in.
import type { MapNode, Project } from '@/domain/types';

jest.mock('@/data', () => {
  const { MemoryRepository } = jest.requireActual('@/data/memoryRepository');
  const repo = new MemoryRepository({ storage: null, seed: false });
  const photoStore = {
    persist: async (_uri: string, id: string) => `file:///photos/${id}.jpg`,
    remove: async () => undefined,
    readBase64: async (uri: string) => `b64:${uri}`,
  };
  return { getRepository: () => repo, getPhotoStore: () => photoStore };
});

let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}` }));

// The user agreed to AI photo analysis (store.runAi refuses to run without it).
jest.mock('@/components/prefs', () => ({ getAiConsent: async () => ({ at: '2026-11-01T00:00:00.000Z' }) }));

// AI client whose answer the test releases by hand.
const mockAi = { release: null as null | ((v: unknown) => void), calls: [] as string[] };
jest.mock('@/ai', () => ({
  createAiClient: async () => ({
    analyze: (req: { imageBase64: string }) => {
      mockAi.calls.push(req.imageBase64);
      return new Promise((resolve) => {
        mockAi.release = resolve;
      });
    },
  }),
  applyAiResult: (n: { fields: Record<string, unknown> }, r: { fields: Record<string, { value: unknown }> }) => ({
    ...n,
    fields: { ...n.fields, ...Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, v.value])) },
  }),
}));

// eslint-disable-next-line import/first
import { getRepository } from '@/data';
// eslint-disable-next-line import/first
import { setRemotePhotoResolver, useStore } from '@/state/store';

const ORG_A = '0a000000-0000-4000-8000-00000000000a';
const ORG_B = '0b000000-0000-4000-8000-00000000000b';
const T0 = '2026-11-12T10:00:00.000Z';
const fix = { lat: 33.5, lng: -86.8, accuracyM: 3, altitudeM: null, samples: 4, capturedAt: T0, source: 'gps' as const };
const repo = getRepository();

const aiResult = {
  detectedType: 'pole',
  typeConfidence: 0.9,
  fields: { pole_tag: { value: 'AI-TAG', confidence: 0.9, isEstimate: false } },
  suggestedLabel: null,
  summary: 'Wood pole',
  warnings: [],
};

const flush = () => new Promise((r) => setTimeout(r, 0));

async function openFresh(name: string, extra: Partial<Project> = {}) {
  const st = useStore.getState();
  await st.init();
  await st.saveSettings({ aiMode: 'direct', aiAutoRun: false, duplicateRadiusM: 0 });
  const p = await st.createProject({ name, walkMode: false, ...extra });
  await useStore.getState().openProject(p.id);
  return p;
}

const serverProject = (id: string, orgId: string): Project => ({
  id, name: id, client: '', jobNumber: '', workType: 'aerial', notes: '', status: 'active', ratePerFoot: null,
  ratePerNode: null, templateId: null, walkMode: true, orgId, createdAt: T0, updatedAt: T0,
});

describe('per-node serialized updates', () => {
  it('an AI result arriving while the user renames the node keeps both', async () => {
    await openFresh('Race');
    const n = await useStore.getState().captureNode({ type: 'pole', fix, photoUri: 'file:///tmp/a.jpg', photoWidth: 1, photoHeight: 1 });
    const ai = useStore.getState().runAi(n.id);
    await flush();
    expect(mockAi.release).toBeTruthy();
    // Release the AI answer and type a label in the same tick (the old read-modify-write lost one).
    mockAi.release!(aiResult);
    const edit = useStore.getState().updateNode(n.id, { label: 'MY LABEL' });
    await Promise.all([ai, edit]);

    const live = useStore.getState().nodes.find((x) => x.id === n.id)!;
    expect(live.label).toBe('MY LABEL');
    expect(live.fields.pole_tag).toBe('AI-TAG');
    expect(live.status).toBe('ai_done');
    const saved = await repo.getNode(n.id);
    expect(saved).toMatchObject({ label: 'MY LABEL', status: 'ai_done', fields: { pole_tag: 'AI-TAG' } });
  });

  it('concurrent field edits and moves all land', async () => {
    await openFresh('Burst');
    const n = await useStore.getState().captureNode({ type: 'pole', fix });
    const st = useStore.getState();
    await Promise.all([
      st.setNodeField(n.id, 'owner', 'Power Co'),
      st.setNodeField(n.id, 'material', 'Wood'),
      st.updateNode(n.id, { notes: 'leaning' }),
      st.moveNode(n.id, { lat: 33.6, lng: -86.9 }),
    ]);
    const saved = (await repo.getNode(n.id))!;
    expect(saved.fields).toMatchObject({ owner: 'Power Co', material: 'Wood' });
    expect(saved.notes).toBe('leaning');
    expect(saved.position.lat).toBe(33.6);
    expect(useStore.getState().nodes.find((x) => x.id === n.id)).toEqual(saved);
  });

  it('an update queued behind a delete does not bring the node back', async () => {
    await openFresh('Delete race');
    const n = await useStore.getState().captureNode({ type: 'pole', fix });
    const st = useStore.getState();
    await Promise.all([st.deleteNode(n.id), st.updateNode(n.id, { label: 'zombie' })]);
    expect(useStore.getState().nodes.some((x) => x.id === n.id)).toBe(false);
    expect(await repo.getNode(n.id)).toBeNull();
  });

  it('AI on a company photo from another phone fetches it through the sync resolver', async () => {
    await openFresh('Remote photo');
    const n = await useStore.getState().captureNode({ type: 'pole', fix });
    const remote = { id: 'remote-ph', nodeId: n.id, projectId: n.projectId, uri: '', watermarkedUri: null, width: 1, height: 1, takenAt: T0, fix: null, isPrimary: true, storagePath: 'x/y/remote-ph.jpg' };
    useStore.setState((s) => ({ photos: [...s.photos, remote] }));
    setRemotePhotoResolver(async (p) => `https://signed.test/${p.storagePath}`);
    const ai = useStore.getState().runAi(n.id);
    await flush();
    mockAi.release!(aiResult);
    await ai;
    expect(mockAi.calls[mockAi.calls.length - 1]).toBe('b64:https://signed.test/x/y/remote-ph.jpg');
    setRemotePhotoResolver(null);
  });
});

describe('company projects', () => {
  it('lists local-only projects plus the active company only', async () => {
    const st = useStore.getState();
    await st.init();
    await st.setActiveOrg(null);
    const local = await st.createProject({ name: 'Local job' });
    await repo.applyServerRows('projects', [
      { row: serverProject('a-job', ORG_A), orgId: ORG_A, rev: 1, deletedAt: null },
      { row: serverProject('b-job', ORG_B), orgId: ORG_B, rev: 2, deletedAt: null },
    ]);
    await useStore.getState().reloadLists();
    let ids = useStore.getState().projects.map((p) => p.id);
    expect(ids).toContain(local.id);
    expect(ids).not.toContain('a-job');

    await useStore.getState().setActiveOrg(ORG_A);
    ids = useStore.getState().projects.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([local.id, 'a-job']));
    expect(ids).not.toContain('b-job');

    // New projects join the active company unless the role cannot create company projects.
    const inOrg = await useStore.getState().createProject({ name: 'Company job' });
    expect(inOrg.orgId).toBe(ORG_A);
    await useStore.getState().setActiveOrg(ORG_A, { createProjectsInOrg: false });
    const techJob = await useStore.getState().createProject({ name: 'Tech job' });
    expect(techJob.orgId).toBeUndefined();
    await useStore.getState().setActiveOrg(null);
  });

  it('moving a local project into the company copies its local template into the company', async () => {
    const st = useStore.getState();
    await st.init();
    await st.setActiveOrg(null);
    const tpl = await st.upsertTemplate({ name: 'Local tpl' });
    const p = await st.createProject({ name: 'Move me', templateId: tpl.id });
    await st.openProject(p.id);
    await useStore.getState().captureNode({ type: 'pole', fix });
    await useStore.getState().setActiveOrg(ORG_A);
    await useStore.getState().moveProjectToActiveOrg(p.id);

    const moved = useStore.getState().projects.find((x) => x.id === p.id)!;
    expect(moved.orgId).toBe(ORG_A);
    expect(moved.templateId).not.toBe(tpl.id);
    const copy = useStore.getState().templates.find((t) => t.id === moved.templateId);
    expect(copy).toMatchObject({ name: 'Local tpl', orgId: ORG_A });
    const dirty = await repo.listDirty({ orgId: ORG_A });
    expect(dirty.filter((r) => r.table === 'nodes').length).toBe(1);
    expect(dirty.some((r) => r.table === 'templates' && r.row.id === copy!.id)).toBe(true);
    await useStore.getState().setActiveOrg(null);
  });
});

describe('live refresh of the open project', () => {
  it('pulled node edits, new spans and deletions show up without reopening', async () => {
    const st = useStore.getState();
    await st.init();
    await st.setActiveOrg(ORG_A);
    await repo.applyServerRows('projects', [{ row: serverProject('live', ORG_A), orgId: ORG_A, rev: 10, deletedAt: null }]);
    const mk = (id: string, seq: number, label = id): MapNode => ({
      id, projectId: 'live', seq, type: 'pole', label, position: fix, fields: {}, aiMeta: {}, iconScale: 1, status: 'draft',
      notes: '', possibleDuplicateOf: null, createdAt: T0, updatedAt: T0,
    });
    await repo.applyServerRows('nodes', [
      { row: mk('l1', 1), orgId: ORG_A, rev: 11, deletedAt: null },
      { row: mk('l2', 2), orgId: ORG_A, rev: 12, deletedAt: null },
    ]);
    await useStore.getState().reloadLists();
    await useStore.getState().openProject('live');
    expect(useStore.getState().nodes.map((n) => n.id)).toEqual(['l1', 'l2']);

    // Another phone renames l1, adds l3 and a span, deletes l2.
    const o1 = await repo.applyServerRows('nodes', [
      { row: { ...mk('l1', 1, 'renamed'), updatedAt: '2026-11-12T11:00:00.000Z' }, orgId: ORG_A, rev: 13, deletedAt: null },
      { row: mk('l3', 3), orgId: ORG_A, rev: 14, deletedAt: null },
      { row: mk('l2', 2), orgId: ORG_A, rev: 15, deletedAt: '2026-11-12T11:00:00.000Z' },
    ]);
    const o2 = await repo.applyServerRows('spans', [
      {
        row: { id: 'sp13', projectId: 'live', fromNodeId: 'l1', toNodeId: 'l3', kind: 'aerial', slackFt: 0, sagPct: 2, lengthOverrideFt: null, fields: {}, createdAt: T0, updatedAt: T0 },
        orgId: ORG_A, rev: 16, deletedAt: null,
      },
    ]);
    await useStore.getState().applyRemoteChanges({
      projectIds: ['live'],
      tables: { nodes: { upserted: o1.applied, deleted: o1.deleted }, spans: { upserted: o2.applied, deleted: [] } },
    });
    const s = useStore.getState();
    expect(s.nodes.map((n) => [n.id, n.label])).toEqual([
      ['l1', 'renamed'],
      ['l3', 'l3'],
    ]);
    expect(s.spans.map((x) => x.id)).toEqual(['sp13']);

    // The project itself is deleted elsewhere: the open project closes.
    await repo.applyServerRows('projects', [{ row: serverProject('live', ORG_A), orgId: ORG_A, rev: 20, deletedAt: '2026-11-12T12:00:00.000Z' }]);
    await useStore.getState().applyRemoteChanges({ projectIds: ['live'], tables: { projects: { upserted: [], deleted: ['live'] } } });
    expect(useStore.getState().activeProjectId).toBeNull();
    expect(useStore.getState().nodes).toEqual([]);
    await useStore.getState().setActiveOrg(null);
  });
});
