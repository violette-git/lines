// Sync status for the UI (zustand) plus the small control surface the rest of the app uses:
// setSyncActiveOrg (wired by the coordinator to the auth store) and syncNow (the chip).
import { create } from 'zustand';

import { canManageProjects, type OrgRole } from '@/backend/contracts';
import { useStore } from '@/state/store';

import type { EngineStatus, SyncEngine } from './engine';

export interface SyncUiState extends EngineStatus {
  /** Company being synced (set through setSyncActiveOrg). */
  activeOrgId: string | null;
  role: OrgRole | null;
  signedIn: boolean;
}

export const INITIAL_SYNC_STATUS: SyncUiState = {
  phase: 'disabled',
  lastSyncedAt: null,
  pendingChanges: 0,
  pendingPhotos: 0,
  error: null,
  rejected: 0,
  waitingForWifi: false,
  activeOrgId: null,
  role: null,
  signedIn: false,
};

export const useSyncStatus = create<SyncUiState>(() => ({ ...INITIAL_SYNC_STATUS }));

let engine: SyncEngine | null = null;

/** Used by SyncManager only. */
export function setCurrentSyncEngine(e: SyncEngine | null) {
  engine = e;
}

export function getCurrentSyncEngine(): SyncEngine | null {
  return engine;
}

/** Manual "Sync now" (also retries changes the server refused before). */
export function syncNow(): Promise<void> {
  return engine?.syncNow() ?? Promise.resolve();
}

/**
 * Tells sync (and the project list) which company is active. Call it whenever the signed-in
 * user's active company or role changes, and with null on sign-out. Viewers only download;
 * techs and viewers create new projects as local-only (the server only lets managers and up
 * create company projects).
 */
export function setSyncActiveOrg(orgId: string | null, role: OrgRole | null = null): Promise<void> {
  useSyncStatus.setState({ activeOrgId: orgId, role });
  return useStore.getState().setActiveOrg(orgId, { createProjectsInOrg: canManageProjects(role) });
}
