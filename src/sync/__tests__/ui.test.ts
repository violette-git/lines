/// <reference types="jest" />
// Pure parts of the UI layer: chip states, network mapping, lazy photo download.
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn(), addEventListener: jest.fn() } }));
jest.mock('@/backend/supabase', () => ({ getSupabase: () => null }));
jest.mock('@/data', () => {
  const { MemoryRepository } = jest.requireActual('@/data/memoryRepository');
  const repo = new MemoryRepository({ storage: null, seed: false });
  return { getRepository: () => repo, getPhotoStore: () => ({ persist: async () => '', remove: async () => undefined, readBase64: async () => '' }) };
});
jest.mock('../photoFiles', () => ({
  CACHES_TO_DISK: true,
  readPhotoBytes: async () => new Uint8Array(),
  downloadPhotoFile: jest.fn(async (_url: string, name: string) => `file:///photos/${name}`),
}));

import { getRepository } from '@/data';
import type { PhotoRef } from '@/domain/types';
import { colors } from '@/theme';

import { __setPhotoCacheTransport, isRemoteOnly, resolvePhotoUri } from '../photoCache';
import { downloadPhotoFile } from '../photoFiles';
import { chipView } from '../SyncChip';
import { INITIAL_SYNC_STATUS } from '../status';
import { toNetworkState } from '../SyncManager';

const ORG = '0f000000-0000-4000-8000-000000000001';
const base = { ...INITIAL_SYNC_STATUS, activeOrgId: ORG, phase: 'idle' as const };

describe('sync chip', () => {
  test('hidden when sync is off or no company', () => {
    expect(chipView(INITIAL_SYNC_STATUS)).toBeNull();
    expect(chipView({ ...base, activeOrgId: null })).toBeNull();
  });
  test('states', () => {
    expect(chipView(base)).toMatchObject({ icon: 'cloud-done-outline', text: 'Synced', color: colors.success });
    expect(chipView({ ...base, pendingChanges: 2, pendingPhotos: 1 })).toMatchObject({ text: '3 pending', icon: 'cloud-upload-outline' });
    expect(chipView({ ...base, phase: 'pushing' })?.text).toBe('Syncing...');
    expect(chipView({ ...base, phase: 'uploading_photos', pendingPhotos: 4 })?.text).toBe('Photos 4');
    expect(chipView({ ...base, phase: 'offline', pendingChanges: 5 })).toMatchObject({ icon: 'cloud-offline-outline', text: 'Offline, 5 waiting' });
    const err = chipView({ ...base, phase: 'error', error: "Can't reach the server right now. Will retry." })!;
    expect(err).toMatchObject({ icon: 'alert-circle-outline', text: 'Tap to retry', color: colors.danger });
    expect(err.label).toMatch(/reach the server.*Tap to try again/);
    expect(chipView({ ...base, rejected: 1 })?.text).toBe('1 not saved');
    expect(chipView({ ...base, waitingForWifi: true, pendingPhotos: 2 })?.label).toMatch(/2 photos will upload on Wi-Fi/);
  });
  test('no em-dash characters in any chip copy', () => {
    const states = [base, { ...base, phase: 'offline' as const }, { ...base, phase: 'error' as const }, { ...base, rejected: 2 }];
    const emDash = String.fromCharCode(0x2014);
    for (const s of states) expect(JSON.stringify(chipView(s))).not.toContain(emDash);
  });
});

describe('network mapping', () => {
  test('wifi and ethernet are unmetered; unreachable is offline', () => {
    expect(toNetworkState({ type: 'wifi', isConnected: true, isInternetReachable: true } as never)).toEqual({ online: true, wifi: true });
    expect(toNetworkState({ type: 'cellular', isConnected: true, isInternetReachable: null } as never)).toEqual({ online: true, wifi: false });
    expect(toNetworkState({ type: 'ethernet', isConnected: true, isInternetReachable: true } as never).wifi).toBe(true);
    expect(toNetworkState({ type: 'wifi', isConnected: true, isInternetReachable: false } as never)).toEqual({ online: false, wifi: false });
    expect(toNetworkState({ type: 'none', isConnected: false, isInternetReachable: false } as never).online).toBe(false);
  });
});

describe('lazy company photos', () => {
  const remote: PhotoRef = {
    id: 'rp', nodeId: 'n', projectId: 'p', uri: '', watermarkedUri: null, width: 1, height: 1, takenAt: '2026-11-12T10:00:00.000Z',
    fix: null, isPrimary: true, storagePath: `${ORG}/p/rp.jpg`,
  };

  test('downloads once (concurrent calls share it) and remembers the file', async () => {
    const repo = getRepository();
    await repo.applyServerRows('projects', [{ row: { id: 'p', name: 'p', client: '', jobNumber: '', workType: 'aerial', notes: '', status: 'active', ratePerFoot: null, ratePerNode: null, templateId: null, walkMode: true, createdAt: remote.takenAt, updatedAt: remote.takenAt }, orgId: ORG, rev: 1, deletedAt: null }]);
    await repo.applyServerRows('nodes', [{ row: { id: 'n', projectId: 'p', seq: 1, type: 'pole', label: 'n', position: { lat: 1, lng: 1, accuracyM: null, altitudeM: null, samples: 0, capturedAt: remote.takenAt, source: 'manual' }, fields: {}, aiMeta: {}, iconScale: 1, status: 'draft', notes: '', possibleDuplicateOf: null, createdAt: remote.takenAt, updatedAt: remote.takenAt }, orgId: ORG, rev: 2, deletedAt: null }]);
    await repo.applyServerRows('photos', [{ row: remote, orgId: ORG, rev: 3, deletedAt: null }]);

    const signedUrl = jest.fn(async (path: string) => `https://signed.test/${path}`);
    __setPhotoCacheTransport({ push: jest.fn(), pull: jest.fn(), uploadPhoto: jest.fn(), signedUrl });
    expect(isRemoteOnly(remote)).toBe(true);
    const [u1, u2] = await Promise.all([resolvePhotoUri(remote), resolvePhotoUri(remote)]);
    expect(u1).toBe('file:///photos/rp.jpg');
    expect(u2).toBe(u1);
    expect(signedUrl).toHaveBeenCalledTimes(1);
    expect(downloadPhotoFile).toHaveBeenCalledWith(`https://signed.test/${ORG}/p/rp.jpg`, 'rp.jpg');
    expect((await repo.listPhotos('p'))[0].uri).toBe('file:///photos/rp.jpg');
    expect(await repo.listDirty({ orgId: ORG })).toEqual([]);

    expect(await resolvePhotoUri({ ...remote, uri: 'file:///mine.jpg' })).toBe('file:///mine.jpg');
    expect(await resolvePhotoUri({ ...remote, storagePath: null })).toBeNull();
    __setPhotoCacheTransport(null);
  });
});
