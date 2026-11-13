/// <reference types="jest" />
import {
  buildInviteLinks,
  friendlyAuthError,
  isInviteUrl,
  isSubscriptionUsable,
  isValidEmail,
  mapOrgRows,
  parseInviteToken,
  passwordStrength,
  pickActiveOrg,
  roleForOrg,
  safeNextPath,
  subscriptionLabel,
  type OrgMemberRow,
} from '@/backend/authCore';
import { canEditField, canManageBilling, canManageMembers, canManageProjects } from '@/backend/contracts';

const TOKEN = 'a3f9c2e1b4d5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3';

const org = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  slug: name.toLowerCase(),
  plan: 'pro',
  subscription_status: 'active',
  seat_limit: 25,
  ai_monthly_photo_quota: 3000,
  trial_ends_at: null,
  ...extra,
});

describe('mapOrgRows', () => {
  test('maps the embedded organization (object or array), sorts by name, drops bad rows', () => {
    const rows: OrgMemberRow[] = [
      { role: 'tech', organizations: org('o2', 'Zulu Fiber') },
      { role: 'owner', organizations: [org('o1', 'Alpha Aerial', { plan: 'trial', subscription_status: 'trialing', trial_ends_at: '2030-01-01T00:00:00Z' })] },
      { role: 'janitor', organizations: org('o3', 'Bad Role') },
      { role: 'admin', organizations: null },
      { role: 'viewer', organizations: org('o2', 'Duplicate') },
      { role: 'manager', organizations: org('o4', 'Mid Co', { plan: 'gold', seat_limit: 'x' }) },
    ];
    const out = mapOrgRows(rows);
    expect(out.map((o) => o.id)).toEqual(['o1', 'o4', 'o2']);
    expect(out[0]).toEqual({
      id: 'o1',
      name: 'Alpha Aerial',
      slug: 'alpha aerial',
      role: 'owner',
      plan: 'trial',
      subscriptionStatus: 'trialing',
      seatLimit: 25,
      aiMonthlyPhotoQuota: 3000,
      trialEndsAt: '2030-01-01T00:00:00Z',
    });
    expect(out[1].plan).toBe('trial'); // unknown plan falls back
    expect(out[1].seatLimit).toBeNull();
    expect(mapOrgRows(null)).toEqual([]);
  });

  test('active org choice and role lookup', () => {
    const orgs = mapOrgRows([
      { role: 'tech', organizations: org('o2', 'B') },
      { role: 'owner', organizations: org('o1', 'A') },
    ]);
    expect(pickActiveOrg(orgs, 'o2')).toBe('o2');
    expect(pickActiveOrg(orgs, 'gone')).toBe('o1');
    expect(pickActiveOrg(orgs, null)).toBe('o1');
    expect(pickActiveOrg([], 'o1')).toBeNull();
    expect(roleForOrg(orgs, 'o2')).toBe('tech');
    expect(roleForOrg(orgs, 'nope')).toBeNull();
    expect(roleForOrg(orgs, null)).toBeNull();
  });
});

describe('role helpers', () => {
  test('editing: local-only (null) and tech and up', () => {
    expect(canEditField(null)).toBe(true);
    expect(canEditField('viewer')).toBe(false);
    expect(canEditField('tech')).toBe(true);
    expect(canEditField('owner')).toBe(true);
  });
  test('projects, members, billing', () => {
    expect(canManageProjects('tech')).toBe(false);
    expect(canManageProjects('manager')).toBe(true);
    expect(canManageMembers(null)).toBe(false);
    expect(canManageMembers('manager')).toBe(false);
    expect(canManageMembers('admin')).toBe(true);
    expect(canManageBilling('admin')).toBe(true);
    expect(canManageBilling('manager')).toBe(false);
  });
});

describe('invite tokens', () => {
  test.each([
    [TOKEN, TOKEN],
    [`  ${TOKEN}\n`, TOKEN],
    [`linemappro://org/join?token=${TOKEN}`, TOKEN],
    [`https://linemap.pro/org/join?token=${TOKEN}`, TOKEN],
    [`https://linemap.pro/org/join?utm=x&token=${TOKEN}#top`, TOKEN],
    [`https://linemap.pro/invite/${TOKEN}`, TOKEN],
    [`https://linemap.pro/?invite=${TOKEN}`, TOKEN],
    [`exp://192.168.1.5:8081/--/org/join?token=${TOKEN}`, TOKEN],
    [`linemappro://org/join?token=${encodeURIComponent(TOKEN)}`, TOKEN],
  ])('parses %s', (input, expected) => {
    expect(parseInviteToken(input)).toBe(expected);
  });

  test.each([[''], [null], ['hello'], ['https://linemap.pro/org/join'], ['https://linemap.pro/org/join?token=short'], ['https://x/org/join?token=<script>']])(
    'rejects %s',
    (input) => {
      expect(parseInviteToken(input as string | null)).toBeNull();
    },
  );

  test('recognizes invite URLs', () => {
    expect(isInviteUrl(`linemappro://org/join?token=${TOKEN}`)).toBe(true);
    expect(isInviteUrl(`https://linemap.pro/org/join?token=${TOKEN}`)).toBe(true);
    expect(isInviteUrl('/org/join')).toBe(true);
    expect(isInviteUrl('linemappro://project/1')).toBe(false);
    expect(isInviteUrl(null)).toBe(false);
    expect(isInviteUrl(`exp://192.168.1.5:8081/--/org/join?token=${TOKEN}`)).toBe(true);
    expect(isInviteUrl('https://linemap.pro/org/joinery')).toBe(false);
  });

  test('builds links that parse back', () => {
    const links = buildInviteLinks(TOKEN, 'https://example.test/');
    expect(links.web).toBe(`https://example.test/org/join?token=${TOKEN}`);
    expect(links.app).toBe(`linemappro://org/join?token=${TOKEN}`);
    expect(parseInviteToken(links.web)).toBe(TOKEN);
    expect(parseInviteToken(links.app)).toBe(TOKEN);
  });
});

describe('sign-up helpers', () => {
  test('email', () => {
    expect(isValidEmail('tech@crew.com')).toBe(true);
    expect(isValidEmail(' tech@crew.co ')).toBe(true);
    expect(isValidEmail('tech@crew')).toBe(false);
    expect(isValidEmail('tech crew@x.com')).toBe(false);
  });
  test('password strength', () => {
    expect(passwordStrength('').ok).toBe(false);
    expect(passwordStrength('short1').label).toBe('Too short');
    expect(passwordStrength('password123').ok).toBe(false);
    expect(passwordStrength('aaaaaaaaaa').ok).toBe(false);
    expect(passwordStrength('bucket-truck').ok).toBe(true);
    expect(passwordStrength('Bucket-Truck-42-span').score).toBe(4);
  });
});

describe('friendlyAuthError', () => {
  test('maps codes, messages and network failures', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials', message: 'x' })).toMatch(/do not match/);
    expect(friendlyAuthError({ message: 'Invalid login credentials' })).toMatch(/do not match/);
    expect(friendlyAuthError(new TypeError('Network request failed'))).toMatch(/signal/);
    expect(friendlyAuthError({ code: '28000', message: 'Not signed in' })).toMatch(/Sign in again/);
    expect(friendlyAuthError({ code: 'P0001', message: 'You already own the maximum number of organizations' })).toBe(
      'You already own the maximum number of organizations',
    );
    expect(friendlyAuthError(null)).toMatch(/Something went wrong/);
  });
});

describe('subscription labels (no prices)', () => {
  const now = Date.parse('2026-11-13T00:00:00Z');
  test('trial and statuses', () => {
    expect(subscriptionLabel({ plan: 'trial', subscriptionStatus: 'trialing', trialEndsAt: '2026-11-20T00:00:00Z' }, now)).toBe('Free trial, 7 days left');
    expect(subscriptionLabel({ plan: 'trial', subscriptionStatus: 'trialing', trialEndsAt: '2026-11-01T00:00:00Z' }, now)).toBe('Trial ended');
    expect(subscriptionLabel({ plan: 'pro', subscriptionStatus: 'active', trialEndsAt: null }, now)).toBe('Pro plan, active');
    expect(subscriptionLabel({ plan: 'pro', subscriptionStatus: 'past_due', trialEndsAt: null }, now)).toBe('Payment problem');
    expect(subscriptionLabel({ plan: 'pro', subscriptionStatus: 'active', trialEndsAt: null }, now)).not.toMatch(/\$/);
  });
  test('usable', () => {
    expect(isSubscriptionUsable({ subscriptionStatus: 'active', trialEndsAt: null }, now)).toBe(true);
    expect(isSubscriptionUsable({ subscriptionStatus: 'trialing', trialEndsAt: '2026-11-01T00:00:00Z' }, now)).toBe(false);
    expect(isSubscriptionUsable({ subscriptionStatus: 'canceled', trialEndsAt: null }, now)).toBe(false);
  });
});

describe('safeNextPath', () => {
  test.each([
    ['/admin', '/admin'],
    ['/project/abc?tab=1', '/project/abc?tab=1'],
    ['  /admin/billing ', '/admin/billing'],
    [['/admin', '/x'], '/admin'],
  ])('allows app path %p', (raw, want) => {
    expect(safeNextPath(raw)).toBe(want);
  });
  test.each([
    'https://evil.example',
    '//evil.example/x',
    '/\\evil.example',
    'javascript:alert(1)',
    'admin',
    '/auth/sign-in',
    '/auth',
    '/ok\nnope',
    '',
    undefined,
    null,
    42,
  ])('rejects %p', (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });
});
