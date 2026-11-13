// Account deletion rules, as a pure function. The database function
// public.delete_account_prepare (supabase/migrations/0004_account.sql) enforces the same rules on
// the server; this copy lets the app explain what will happen before the user confirms.
//
// Rules, per company the user belongs to:
//   - Not the only owner: the user simply leaves. Company data stays with the company.
//   - The only owner and other people are members: BLOCKED. Make someone else an owner first
//     (an organization must always keep at least one owner).
//   - The only owner and the only member: the company can be deleted together with the account,
//     but only when the user explicitly agrees (deleteSoleOrgs). Otherwise BLOCKED.
//   - ...and the company still has a live paid subscription: BLOCKED until it is cancelled on the
//     website, so nobody keeps getting billed for a company that no longer exists.

export interface DeletionMembership {
  orgId: string;
  orgName: string;
  role: string;
  /** Owners in the company, including this user. */
  ownerCount: number;
  /** Members in the company, including this user. */
  memberCount: number;
  /** A Stripe subscription that is not cancelled yet. */
  hasSubscription: boolean;
}

export type DeletionBlockReason = 'sole_owner_with_members' | 'sole_member_needs_consent' | 'active_subscription';

export interface DeletionBlock {
  orgId: string;
  orgName: string;
  reason: DeletionBlockReason;
  /** Other members, for the message ("3 other people"). */
  otherMembers: number;
}

export interface DeletionPlan {
  /** True when the account can be deleted with the given options. */
  allowed: boolean;
  blocked: DeletionBlock[];
  /** Companies deleted along with the account (user was the only member). */
  deleteOrgs: { orgId: string; orgName: string }[];
  /** Companies the user just leaves. */
  leaveOrgs: { orgId: string; orgName: string }[];
}

/** Same decision as SQL public.account_deletion_status(). */
export type MembershipStatus = 'leave' | 'sole_owner_with_members' | 'sole_member_subscribed' | 'sole_member';

export function membershipStatus(r: Pick<DeletionMembership, 'role' | 'ownerCount' | 'memberCount' | 'hasSubscription'>): MembershipStatus {
  if (r.role !== 'owner' || r.ownerCount > 1) return 'leave';
  if (r.memberCount > 1) return 'sole_owner_with_members';
  if (r.hasSubscription) return 'sole_member_subscribed';
  return 'sole_member';
}

export function planAccountDeletion(rows: readonly DeletionMembership[], opts: { deleteSoleOrgs?: boolean } = {}): DeletionPlan {
  const blocked: DeletionBlock[] = [];
  const deleteOrgs: DeletionPlan['deleteOrgs'] = [];
  const leaveOrgs: DeletionPlan['leaveOrgs'] = [];
  for (const r of rows) {
    const status = membershipStatus(r);
    if (status === 'leave') {
      leaveOrgs.push({ orgId: r.orgId, orgName: r.orgName });
    } else if (status === 'sole_owner_with_members') {
      blocked.push({ orgId: r.orgId, orgName: r.orgName, reason: 'sole_owner_with_members', otherMembers: r.memberCount - 1 });
    } else if (status === 'sole_member_subscribed') {
      blocked.push({ orgId: r.orgId, orgName: r.orgName, reason: 'active_subscription', otherMembers: 0 });
    } else if (opts.deleteSoleOrgs) {
      deleteOrgs.push({ orgId: r.orgId, orgName: r.orgName });
    } else {
      blocked.push({ orgId: r.orgId, orgName: r.orgName, reason: 'sole_member_needs_consent', otherMembers: 0 });
    }
  }
  return { allowed: blocked.length === 0, blocked, deleteOrgs, leaveOrgs };
}

/** Companies that would be deleted if the user agrees (only member and only owner). */
export function soleMemberOrgs(rows: readonly DeletionMembership[]): DeletionMembership[] {
  return rows.filter((r) => membershipStatus(r) === 'sole_member');
}

/** Companies that block deletion until the user acts (another owner needed, or a subscription to cancel). */
export function hardBlockers(rows: readonly DeletionMembership[]): DeletionMembership[] {
  return rows.filter((r) => {
    const s = membershipStatus(r);
    return s === 'sole_owner_with_members' || s === 'sole_member_subscribed';
  });
}

/** Maps rows from the account_deletion_preview() RPC. Malformed rows are dropped. */
export function mapDeletionPreview(data: unknown): DeletionMembership[] {
  if (!Array.isArray(data)) return [];
  const out: DeletionMembership[] = [];
  for (const raw of data) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r.org_id !== 'string' || typeof r.role !== 'string') continue;
    out.push({
      orgId: r.org_id,
      orgName: typeof r.org_name === 'string' ? r.org_name : 'Unnamed company',
      role: r.role,
      ownerCount: Number(r.owner_count) || 0,
      memberCount: Number(r.member_count) || 0,
      hasSubscription: r.has_subscription === true,
    });
  }
  return out;
}

/** Plain explanation of one blocker. */
export function describeBlock(b: DeletionBlock): string {
  if (b.reason === 'sole_owner_with_members') {
    const people = `${b.otherMembers} other ${b.otherMembers === 1 ? 'person' : 'people'}`;
    return `You are the only owner of ${b.orgName}, and ${people} still use it. Make someone else an owner first (on the web dashboard, Members), then come back.`;
  }
  if (b.reason === 'active_subscription') {
    return `${b.orgName} still has a subscription. Cancel it on the website first (Manage your plan on the web), then come back to delete your account and the company.`;
  }
  return `You are the only person in ${b.orgName}. Deleting your account will also delete this company and all of its projects, photos and data.`;
}

/** Error thrown by deleteAccount when the server refuses, with the blockers it found. */
export class AccountDeletionBlockedError extends Error {
  readonly blocked: DeletionBlock[];
  constructor(blocked: DeletionBlock[], message?: string) {
    super(message ?? (blocked[0] ? describeBlock(blocked[0]) : 'Your account cannot be deleted yet.'));
    this.name = 'AccountDeletionBlockedError';
    this.blocked = blocked;
  }
}

/** Reads the server's blocked list ({ blocked: [{ org_id, org_name, reason, other_members }] }). */
export function mapServerBlocks(data: unknown): DeletionBlock[] {
  const list = (data as { blocked?: unknown } | null)?.blocked;
  if (!Array.isArray(list)) return [];
  const out: DeletionBlock[] = [];
  for (const raw of list) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r.org_id !== 'string') continue;
    const reason: DeletionBlockReason =
      r.reason === 'sole_member_needs_consent' || r.reason === 'active_subscription' ? r.reason : 'sole_owner_with_members';
    out.push({
      orgId: r.org_id,
      orgName: typeof r.org_name === 'string' ? r.org_name : 'a company',
      reason,
      otherMembers: Number(r.other_members) || 0,
    });
  }
  return out;
}

/** The word the user must type on the final step. */
export const DELETE_CONFIRM_WORD = 'DELETE';

export const isDeleteConfirmed = (typed: string) => typed.trim() === DELETE_CONFIRM_WORD;
