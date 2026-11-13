// Contracts shared by the auth, sync and admin modules (Phase 2).
import type { Session, User } from '@supabase/supabase-js';

export type OrgRole = 'owner' | 'admin' | 'manager' | 'tech' | 'viewer';

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
  plan: 'trial' | 'starter' | 'pro' | 'enterprise';
  subscriptionStatus: string | null;
  seatLimit: number | null;
  aiMonthlyPhotoQuota: number | null;
  trialEndsAt: string | null;
}

export interface AuthState {
  /** True once the stored session has been restored (or found missing). */
  restored: boolean;
  session: Session | null;
  user: User | null;
  orgs: OrgSummary[];
  activeOrgId: string | null;
  /** Role in the active org, null when signed out or no org. */
  role: OrgRole | null;

  restore(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, fullName: string): Promise<{ needsEmailConfirm: boolean }>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  refreshOrgs(): Promise<void>;
  setActiveOrg(orgId: string | null): Promise<void>;
  createOrganization(name: string): Promise<OrgSummary>;
  acceptInvite(token: string): Promise<void>;
  /** Apple and Google require in-app account deletion when accounts can be created. */
  deleteAccount(): Promise<void>;
}

/** Role helpers used by both the phone app and the admin dashboard. */
export const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, tech: 1, manager: 2, admin: 3, owner: 4 };
export const canEditField = (r: OrgRole | null) => r == null || ROLE_RANK[r] >= ROLE_RANK.tech;
export const canManageProjects = (r: OrgRole | null) => r == null || ROLE_RANK[r] >= ROLE_RANK.manager;
export const canManageMembers = (r: OrgRole | null) => r != null && ROLE_RANK[r] >= ROLE_RANK.admin;
export const canManageBilling = (r: OrgRole | null) => r === 'owner' || r === 'admin';

export type SyncPhase = 'idle' | 'offline' | 'pushing' | 'pulling' | 'uploading_photos' | 'error' | 'disabled';

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncedAt: string | null;
  pendingChanges: number;
  pendingPhotos: number;
  error: string | null;
}
