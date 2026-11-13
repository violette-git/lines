// Public surface of the sync module.
export { SyncManager } from './SyncManager';
export { SyncChip, chipView } from './SyncChip';
export { setSyncActiveOrg, syncNow, useSyncStatus, type SyncUiState } from './status';
export { resolvePhotoUri, usePhotoUri, isRemoteOnly } from './photoCache';
export { findCompanyData, removeCompanyData, type CompanyDataFound } from './localCleanup';
export * from './serverMapping';
