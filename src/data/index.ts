// Native (Android/iOS) data layer: expo-sqlite repository + documents-dir photo store.
// Metro picks ./index.web.ts for web builds; both files export the same API.
import type { PhotoStore, SyncRepository } from '@/domain/contracts';

import { createNativePhotoStore } from './nativePhotoStore';
import { SqliteRepository } from './sqliteRepository';

let repository: SyncRepository | null = null;
let photoStore: PhotoStore | null = null;

export function getPhotoStore(): PhotoStore {
  if (!photoStore) photoStore = createNativePhotoStore();
  return photoStore;
}

export function getRepository(): SyncRepository {
  if (!repository) repository = new SqliteRepository(getPhotoStore());
  return repository;
}

export { DEMO_PROJECT_ID, DEMO_TEMPLATE_ID } from './demoSeed';
