// What each role may see and do in the web dashboard. These mirror the database rules
// (supabase/migrations/0001_init.sql and 0003_admin.sql): the server enforces them regardless,
// this file only decides which buttons to show so people are not offered actions that will fail.
import { canManageBilling, ROLE_RANK, type OrgRole } from '@/backend/contracts';

export const ROLE_ORDER: OrgRole[] = ['owner', 'admin', 'manager', 'tech', 'viewer'];

export const ROLE_META: Record<OrgRole, { label: string; hint: string }> = {
  owner: { label: 'Owner', hint: 'Full control, including billing and other owners.' },
  admin: { label: 'Admin', hint: 'Manages the team and billing. Cannot change owners.' },
  manager: { label: 'Manager', hint: 'Creates projects and templates, sees usage and activity.' },
  tech: { label: 'Tech', hint: 'Captures and edits field data on the phone.' },
  viewer: { label: 'Viewer', hint: 'Read only. Good for clients and inspectors.' },
};

const atLeast = (r: OrgRole | null, min: OrgRole) => r != null && ROLE_RANK[r] >= ROLE_RANK[min];

export type AdminSection = 'overview' | 'projects' | 'team' | 'usage' | 'billing' | 'settings';

/** Sections shown in the sidebar for a role. Everyone can look; actions inside are gated separately. */
export function visibleSections(role: OrgRole | null): AdminSection[] {
  if (role == null) return [];
  const all: AdminSection[] = ['overview', 'projects', 'team', 'usage', 'billing', 'settings'];
  return all.filter((s) => (s === 'usage' ? canViewUsage(role) : true));
}

export const canViewUsage = (r: OrgRole | null) => atLeast(r, 'manager');
export const canViewActivity = (r: OrgRole | null) => atLeast(r, 'manager');
/** Emails, last active and invite links are admin-only (admin_org_members). */
export const canViewMemberDetails = (r: OrgRole | null) => atLeast(r, 'admin');
export const canInvite = (r: OrgRole | null) => atLeast(r, 'admin');
export const canRenameOrg = (r: OrgRole | null) => atLeast(r, 'admin');
export const canSeeBillingActions = (r: OrgRole | null) => canManageBilling(r);

/** Roles an actor may hand out in an invite. Only owners create owners. */
export function invitableRoles(actor: OrgRole | null): OrgRole[] {
  if (!canInvite(actor)) return [];
  return actor === 'owner' ? ROLE_ORDER : ROLE_ORDER.filter((r) => r !== 'owner');
}

/**
 * Roles the actor may move a member to. Empty means "no role menu".
 * Rules: admin and up only; only an owner may touch an owner or make someone an owner;
 * nobody changes their own role here (prevents locking yourself out; ask another owner).
 */
export function roleChangeOptions(actor: OrgRole | null, target: OrgRole, isSelf: boolean): OrgRole[] {
  if (isSelf || !canInvite(actor)) return [];
  if (target === 'owner' && actor !== 'owner') return [];
  const pool = actor === 'owner' ? ROLE_ORDER : ROLE_ORDER.filter((r) => r !== 'owner');
  return pool.filter((r) => r !== target);
}

/** Whether the actor may remove the target member. Leaving the org yourself is done elsewhere. */
export function canRemoveMember(actor: OrgRole | null, target: OrgRole, isSelf: boolean): boolean {
  if (isSelf || !canInvite(actor)) return false;
  if (target === 'owner') return actor === 'owner';
  return true;
}

/** Owners can always be the last line: warn before demoting/removing one when they are the only owner. */
export function isLastOwner(target: OrgRole, ownerCount: number): boolean {
  return target === 'owner' && ownerCount <= 1;
}
