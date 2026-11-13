// Web preview data layer: in-memory repository persisted to localStorage, seeded with a demo
// project; photos kept as data URLs. Same exports as ./index.ts.
import type { PhotoStore, SyncRepository } from '@/domain/contracts';

import { getBrowserStorage } from './kvStorage';
import { MemoryRepository } from './memoryRepository';
import { createWebPhotoStore } from './webPhotoStore';

let repository: SyncRepository | null = null;
let photoStore: PhotoStore | null = null;

export function getPhotoStore(): PhotoStore {
  if (!photoStore) photoStore = createWebPhotoStore();
  return photoStore;
}

export function getRepository(): SyncRepository {
  if (!repository) {
    repository = new MemoryRepository({ storage: getBrowserStorage(), seed: true, photoStore: getPhotoStore() });
  }
  return repository;
}

export { DEMO_PROJECT_ID, DEMO_TEMPLATE_ID } from './demoSeed';
