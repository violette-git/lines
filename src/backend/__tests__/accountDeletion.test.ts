/// <reference types="jest" />
import * as fs from 'fs';
import * as path from 'path';

import {
  AccountDeletionBlockedError,
  describeBlock,
  hardBlockers,
  isDeleteConfirmed,
  mapDeletionPreview,
  mapServerBlocks,
  membershipStatus,
  planAccountDeletion,
  soleMemberOrgs,
  type DeletionMembership,
} from '@/backend/accountDeletion';

const m = (orgName: string, role: string, ownerCount: number, memberCount: number, hasSubscription = false): DeletionMembership => ({
  orgId: `id-${orgName}`,
  orgName,
  role,
  ownerCount,
  memberCount,
  hasSubscription,
});

describe('membershipStatus (mirrors SQL account_deletion_status)', () => {
  test.each([
    ['tech', 1, 5, true, 'leave'],
    ['owner', 2, 2, false, 'leave'],
    ['owner', 1, 3, false, 'sole_owner_with_members'],
    ['owner', 1, 3, true, 'sole_owner_with_members'],
    ['owner', 1, 1, true, 'sole_member_subscribed'],
    ['owner', 1, 1, false, 'sole_member'],
  ])('%s owners=%i members=%i sub=%s -> %s', (role, owners, members, sub, expected) => {
    expect(membershipStatus({ role, ownerCount: owners, memberCount: members, hasSubscription: sub })).toBe(expected);
  });
});

describe('planAccountDeletion', () => {
  test('no companies: allowed', () => {
    expect(planAccountDeletion([])).toEqual({ allowed: true, blocked: [], deleteOrgs: [], leaveOrgs: [] });
  });

  test('member and co-owner just leave', () => {
    const p = planAccountDeletion([m('Crew', 'tech', 1, 4), m('Duo', 'owner', 2, 2)]);
    expect(p.allowed).toBe(true);
    expect(p.leaveOrgs.map((o) => o.orgName)).toEqual(['Crew', 'Duo']);
  });

  test('sole owner with members is blocked even with consent', () => {
    const p = planAccountDeletion([m('Team', 'owner', 1, 4)], { deleteSoleOrgs: true });
    expect(p.allowed).toBe(false);
    expect(p.blocked).toEqual([{ orgId: 'id-Team', orgName: 'Team', reason: 'sole_owner_with_members', otherMembers: 3 }]);
    expect(describeBlock(p.blocked[0])).toMatch(/3 other people/);
  });

  test('sole member needs consent, then the company is deleted', () => {
    const rows = [m('Solo', 'owner', 1, 1), m('Crew', 'tech', 1, 3)];
    expect(planAccountDeletion(rows).blocked[0].reason).toBe('sole_member_needs_consent');
    const p = planAccountDeletion(rows, { deleteSoleOrgs: true });
    expect(p.allowed).toBe(true);
    expect(p.deleteOrgs).toEqual([{ orgId: 'id-Solo', orgName: 'Solo' }]);
    expect(p.leaveOrgs).toEqual([{ orgId: 'id-Crew', orgName: 'Crew' }]);
  });

  test('a live subscription blocks deleting the company', () => {
    const p = planAccountDeletion([m('Paid', 'owner', 1, 1, true)], { deleteSoleOrgs: true });
    expect(p.blocked[0].reason).toBe('active_subscription');
    expect(describeBlock(p.blocked[0])).toMatch(/Cancel it on the website/);
  });

  test('helper lists', () => {
    const rows = [m('Solo', 'owner', 1, 1), m('Team', 'owner', 1, 2), m('Paid', 'owner', 1, 1, true), m('Crew', 'viewer', 1, 9)];
    expect(soleMemberOrgs(rows).map((r) => r.orgName)).toEqual(['Solo']);
    expect(hardBlockers(rows).map((r) => r.orgName)).toEqual(['Team', 'Paid']);
  });
});

describe('server data mapping', () => {
  test('preview rows', () => {
    expect(
      mapDeletionPreview([
        { org_id: 'o1', org_name: 'A', role: 'owner', owner_count: 1, member_count: 2, has_subscription: false, status: 'sole_owner_with_members' },
        { org_id: 5 },
        null,
      ]),
    ).toEqual([{ orgId: 'o1', orgName: 'A', role: 'owner', ownerCount: 1, memberCount: 2, hasSubscription: false }]);
    expect(mapDeletionPreview(null)).toEqual([]);
  });

  test('blocked response', () => {
    const blocks = mapServerBlocks({
      error: 'x',
      code: 'blocked',
      blocked: [
        { org_id: 'o1', org_name: 'Team', reason: 'sole_owner_with_members', other_members: 2 },
        { org_id: 'o2', org_name: 'Paid', reason: 'active_subscription', other_members: 0 },
        { org_id: 'o3', org_name: 'Solo', reason: 'sole_member_needs_consent', other_members: 0 },
      ],
    });
    expect(blocks.map((b) => b.reason)).toEqual(['sole_owner_with_members', 'active_subscription', 'sole_member_needs_consent']);
    const err = new AccountDeletionBlockedError(blocks);
    expect(err.message).toMatch(/only owner of Team/);
    expect(mapServerBlocks({ ok: true })).toEqual([]);
  });

  test('typed confirmation must be exactly DELETE', () => {
    expect(isDeleteConfirmed('DELETE')).toBe(true);
    expect(isDeleteConfirmed('  DELETE ')).toBe(true);
    expect(isDeleteConfirmed('delete')).toBe(false);
    expect(isDeleteConfirmed('DELET')).toBe(false);
  });
});

describe('SQL and Edge Function stay in step with the app', () => {
  const root = path.resolve(__dirname, '../../..');
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/0004_account.sql'), 'utf8');
  const fn = fs.readFileSync(path.join(root, 'supabase/functions/delete-account/index.ts'), 'utf8');

  test('same statuses and block reasons', () => {
    for (const s of ['leave', 'sole_owner_with_members', 'sole_member_subscribed', 'sole_member']) expect(sql).toContain(`'${s}'`);
    for (const r of ['sole_owner_with_members', 'active_subscription', 'sole_member_needs_consent']) {
      expect(sql).toContain(`'${r}'`);
      expect(fn).toContain(r);
    }
  });

  test('dangerous functions are service-role only', () => {
    expect(sql).toMatch(/revoke execute on function public\.delete_account_prepare\(uuid, boolean\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke execute on function public\.account_memberships\(uuid\) from public, anon, authenticated;/);
    expect(fn).toMatch(/auth\.admin\.deleteUser\(user\.id\)/);
  });

  test('no em-dash characters', () => {
    const EM_DASH = String.fromCharCode(0x2014);
    expect(sql.includes(EM_DASH)).toBe(false);
    expect(fn.includes(EM_DASH)).toBe(false);
  });
});
