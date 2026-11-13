import { canManageBilling, type OrgRole } from '@/backend/contracts';

import {
  canInvite,
  canRemoveMember,
  canRenameOrg,
  canSeeBillingActions,
  canViewActivity,
  canViewMemberDetails,
  canViewUsage,
  invitableRoles,
  isLastOwner,
  roleChangeOptions,
  visibleSections,
} from '../roles';

const ALL: OrgRole[] = ['owner', 'admin', 'manager', 'tech', 'viewer'];

describe('role-based action visibility', () => {
  it('billing actions only for owner and admin (same rule as contracts)', () => {
    expect(ALL.filter(canSeeBillingActions)).toEqual(['owner', 'admin']);
    for (const r of ALL) expect(canSeeBillingActions(r)).toBe(canManageBilling(r));
    expect(canSeeBillingActions(null)).toBe(false);
  });

  it('member emails, invites and renaming are admin and up', () => {
    expect(ALL.filter(canViewMemberDetails)).toEqual(['owner', 'admin']);
    expect(ALL.filter(canInvite)).toEqual(['owner', 'admin']);
    expect(ALL.filter(canRenameOrg)).toEqual(['owner', 'admin']);
  });

  it('usage and activity are manager and up (matches ai_usage and audit_log RLS)', () => {
    expect(ALL.filter(canViewUsage)).toEqual(['owner', 'admin', 'manager']);
    expect(ALL.filter(canViewActivity)).toEqual(['owner', 'admin', 'manager']);
    expect(visibleSections('tech')).not.toContain('usage');
    expect(visibleSections('manager')).toContain('usage');
    expect(visibleSections(null)).toEqual([]);
  });

  it('only owners invite or create owners', () => {
    expect(invitableRoles('owner')).toContain('owner');
    expect(invitableRoles('admin')).toEqual(['admin', 'manager', 'tech', 'viewer']);
    expect(invitableRoles('manager')).toEqual([]);
  });

  it('admins cannot touch owners; nobody edits themselves', () => {
    expect(roleChangeOptions('admin', 'owner', false)).toEqual([]);
    expect(roleChangeOptions('admin', 'tech', false)).toEqual(['admin', 'manager', 'viewer']);
    expect(roleChangeOptions('owner', 'admin', false)).toEqual(['owner', 'manager', 'tech', 'viewer']);
    expect(roleChangeOptions('owner', 'owner', true)).toEqual([]);
    expect(roleChangeOptions('manager', 'tech', false)).toEqual([]);

    expect(canRemoveMember('admin', 'owner', false)).toBe(false);
    expect(canRemoveMember('owner', 'owner', false)).toBe(true);
    expect(canRemoveMember('admin', 'viewer', false)).toBe(true);
    expect(canRemoveMember('owner', 'tech', true)).toBe(false);
    expect(canRemoveMember('manager', 'tech', false)).toBe(false);
  });

  it('flags the last owner', () => {
    expect(isLastOwner('owner', 1)).toBe(true);
    expect(isLastOwner('owner', 2)).toBe(false);
    expect(isLastOwner('admin', 1)).toBe(false);
  });
});
