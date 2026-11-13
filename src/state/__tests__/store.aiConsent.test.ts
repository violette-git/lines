/// <reference types="jest" />
// No photo may reach the AI before the user agreed in the app: store.runAi is the single gate for
// capture auto-run, "Run pending AI" and the per-node buttons.
import type { GeoFix } from '@/domain/types';

jest.mock('@/data', () => {
  const { MemoryRepository } = jest.requireActual('@/data/memoryRepository');
  const repo = new MemoryRepository({ storage: null, seed: false });
  const photoStore = {
    async persist(_uri: string, id: string) {
      return `file:///photos/${id}.jpg`;
    },
    async remove() {},
    async readBase64() {
      return 'AAAA';
    },
  };
  return { getRepository: () => repo, getPhotoStore: () => photoStore };
});

let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `id-${++mockUuid}` }));

const mockAnalyze = jest.fn();
const mockCreateClient = jest.fn();
jest.mock('@/ai', () => ({
  createAiClient: (...a: unknown[]) => mockCreateClient(...a),
  applyAiResult: (n: unknown) => n,
}));

let mockConsent: { at: string } | null = null;
jest.mock('@/components/prefs', () => ({ getAiConsent: async () => mockConsent }));

// eslint-disable-next-line import/first
import { useStore } from '@/state/store';

const fix: GeoFix = { lat: 33.5, lng: -86.8, accuracyM: 3, altitudeM: null, samples: 4, capturedAt: '2026-11-12T10:00:00.000Z', source: 'gps' };

beforeEach(async () => {
  mockAnalyze.mockReset().mockResolvedValue({
    detectedType: 'pole',
    typeConfidence: 0.9,
    fields: {},
    suggestedLabel: null,
    summary: 'Wood pole',
    warnings: [],
  });
  mockCreateClient.mockReset().mockResolvedValue({ analyze: mockAnalyze });
  const st = useStore.getState();
  await st.init();
  const p = await st.createProject({ name: 'Consent' });
  await useStore.getState().openProject(p.id);
  await useStore.getState().saveSettings({ aiMode: 'proxy', aiAutoRun: true, proxyUrl: 'https://x.test/fn' });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AI consent gate in the store', () => {
  it('capture auto-run sends nothing without consent and leaves the node pending', async () => {
    mockConsent = null;
    const n = await useStore.getState().captureNode({ type: 'pole', fix, photoUri: 'file:///tmp/a.jpg', photoWidth: 10, photoHeight: 10 });
    await flush();
    await flush();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(useStore.getState().nodes.find((x) => x.id === n.id)?.status).toBe('ai_pending');

    await useStore.getState().runPendingAi();
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('runs once consent is recorded', async () => {
    mockConsent = { at: '2026-11-12T10:00:00.000Z' };
    const n = await useStore.getState().captureNode({ type: 'pole', fix, photoUri: 'file:///tmp/b.jpg', photoWidth: 10, photoHeight: 10 });
    await useStore.getState().runAi(n.id);
    expect(mockAnalyze).toHaveBeenCalled();
  });
});
