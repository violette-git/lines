/// <reference types="jest" />
// Store capture flow on an in-memory repository: walk-mode chaining survives Retake, and a failed
// photo save does not leave an orphan node behind.
import type { GeoFix } from '@/domain/types';

jest.mock('@/data', () => {
  const { MemoryRepository } = jest.requireActual('@/data/memoryRepository');
  const repo = new MemoryRepository({ storage: null, seed: false });
  const photoStore = {
    fail: false,
    async persist(_uri: string, id: string) {
      if (photoStore.fail) throw new Error('disk full');
      return `file:///photos/${id}.jpg`;
    },
    async remove() {},
    async readBase64() {
      return '';
    },
  };
  return { getRepository: () => repo, getPhotoStore: () => photoStore };
});

let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `id-${++mockUuid}` }));
jest.mock('@/ai', () => ({ createAiClient: async () => null, applyAiResult: (n: unknown) => n }));

// eslint-disable-next-line import/first
import { getPhotoStore, getRepository } from '@/data';
import { useStore } from '@/state/store';

const mockPhotoStore = getPhotoStore() as ReturnType<typeof getPhotoStore> & { fail: boolean };

const fixAt = (lat: number): GeoFix => ({
  lat, lng: -86.8, accuracyM: 3, altitudeM: null, samples: 4, capturedAt: '2026-11-12T10:00:00.000Z', source: 'gps',
});

async function freshProject() {
  const st = useStore.getState();
  await st.init();
  const p = await st.createProject({ name: 'Walk', walkMode: true });
  await useStore.getState().openProject(p.id);
  await useStore.getState().saveSettings({ aiMode: 'off', duplicateRadiusM: 1 });
  return p;
}

describe('store capture flow', () => {
  beforeEach(() => {
    mockPhotoStore.fail = false;
  });

  it('keeps the walk chain after Retake deletes the newest node', async () => {
    await freshProject();
    const a = await useStore.getState().captureNode({ type: 'pole', fix: fixAt(33.5) });
    const b = await useStore.getState().captureNode({ type: 'pole', fix: fixAt(33.501) });
    expect(useStore.getState().spans.map((s) => [s.fromNodeId, s.toNodeId])).toEqual([[a.id, b.id]]);

    await useStore.getState().deleteNode(b.id); // Retake
    expect(useStore.getState().lastNodeId).toBe(a.id);

    const b2 = await useStore.getState().captureNode({ type: 'pole', fix: fixAt(33.5011) });
    expect(useStore.getState().spans.map((s) => [s.fromNodeId, s.toNodeId])).toEqual([[a.id, b2.id]]);
  });

  it('removes the node again when the photo cannot be saved', async () => {
    await freshProject();
    const a = await useStore.getState().captureNode({ type: 'pole', fix: fixAt(33.6) });
    mockPhotoStore.fail = true;
    await expect(
      useStore.getState().captureNode({ type: 'pole', fix: fixAt(33.601), photoUri: 'file:///cache/x.jpg', photoWidth: 10, photoHeight: 10 }),
    ).rejects.toThrow('disk full');
    const st = useStore.getState();
    expect(st.nodes.map((n) => n.id)).toEqual([a.id]);
    expect(st.spans).toHaveLength(0);
    expect(st.lastNodeId).toBe(a.id);
    expect(await getRepository().listNodes(a.projectId)).toHaveLength(1);
  });
});
