/// <reference types="jest" />
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createProxyClient } from '@/ai/claudeProxy';
import type { FetchLike } from '@/ai/http';
import { AccountDeletionBlockedError } from '@/backend/accountDeletion';
import { AuthUnavailableError } from '@/backend/authCore';
import { __resetAuthForTests, canEditNow, canManageProjectsNow, useAuthStore } from '@/backend/authStore';
import type { AiAnalysisRequest } from '@/domain/contracts';

// ---------- Mocks ----------
let mockConfigured = false;
let mockClient: unknown = null;

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('@/backend/config', () => ({
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  WEB_APP_URL: 'https://linemap.test',
  isBackendConfigured: () => mockConfigured,
  aiProxyUrl: () => (mockConfigured ? 'https://x.supabase.co/functions/v1/analyze-photo' : null),
}));

jest.mock('@/backend/supabase', () => ({
  getSupabase: () => (mockConfigured ? mockClient : null),
}));

interface FakeAppState {
  ready: boolean;
  settings: { proxyUrl: string | null; aiMode: string };
  saveSettings: jest.Mock;
}
const mockApp: { state: FakeAppState; listeners: ((s: FakeAppState) => void)[] } = {
  state: { ready: true, settings: { proxyUrl: null, aiMode: 'off' }, saveSettings: jest.fn(async () => undefined) },
  listeners: [],
};
jest.mock('@/state/store', () => ({
  useStore: {
    getState: () => mockApp.state,
    subscribe: (fn: (s: FakeAppState) => void) => {
      mockApp.listeners.push(fn);
      return () => {
        mockApp.listeners = mockApp.listeners.filter((l) => l !== fn);
      };
    },
  },
}));

// ---------- Fake Supabase client ----------
const USER = { id: 'u1', email: 'pat@crew.test', user_metadata: { full_name: 'Pat Meta' } };
const SESSION = { access_token: 'jwt-u1', user: USER };
const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function orgRow(id: string, name: string, role: string) {
  return {
    role,
    organizations: {
      id,
      name,
      slug: name.toLowerCase(),
      plan: 'pro',
      subscription_status: 'active',
      seat_limit: 25,
      ai_monthly_photo_quota: 3000,
      trial_ends_at: null,
    },
  };
}

function makeClient(opts: { session?: unknown; members?: unknown[]; membersError?: unknown } = {}) {
  let session: unknown = opts.session ?? null;
  const authListeners: ((e: string, s: unknown) => void)[] = [];
  const result = (table: string) => {
    if (table === 'org_members') return { data: opts.membersError ? null : opts.members ?? [], error: opts.membersError ?? null };
    if (table === 'profiles') return { data: { full_name: 'Pat Tech' }, error: null };
    return { data: null, error: null };
  };
  const from = jest.fn((table: string) => {
    const q = {
      select: () => q,
      update: () => q,
      eq: () => {
        const p = Promise.resolve(result(table));
        return Object.assign(p, { maybeSingle: () => p });
      },
    };
    return q;
  });
  return {
    authListeners,
    from,
    rpc: jest.fn(async (name: string) => {
      if (name === 'create_organization') return { data: ORG_A, error: null };
      if (name === 'accept_invite') return { data: ORG_B, error: null };
      if (name === 'account_deletion_preview') {
        return { data: [{ org_id: ORG_A, org_name: 'Alpha', role: 'owner', owner_count: 1, member_count: 3, has_subscription: false }], error: null };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    }),
    functions: { invoke: jest.fn() },
    auth: {
      getSession: jest.fn(async () => ({ data: { session }, error: null })),
      onAuthStateChange: jest.fn((cb: (e: string, s: unknown) => void) => {
        authListeners.push(cb);
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      signInWithPassword: jest.fn(async ({ password }: { email: string; password: string }) => {
        if (password !== 'right-password') {
          return { data: { session: null, user: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } };
        }
        session = SESSION;
        return { data: { session: SESSION, user: USER }, error: null };
      }),
      signUp: jest.fn(async () => ({ data: { user: { ...USER, identities: [{}] }, session: null }, error: null })),
      signOut: jest.fn(async () => {
        session = null;
        return { error: null };
      }),
      updateUser: jest.fn(async () => ({ data: {}, error: null })),
      resetPasswordForEmail: jest.fn(async () => ({ data: {}, error: null })),
    },
  };
}

const req: AiAnalysisRequest = { nodeType: 'pole', imageBase64: 'aGk=', mediaType: 'image/jpeg', fieldDefs: [] };

function okResponse(): Response {
  const text = JSON.stringify({ detectedType: 'pole', typeConfidence: 0.9, fields: {}, suggestedLabel: null, summary: '', warnings: [] });
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => text } as unknown as Response;
}

async function proxyCall() {
  const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => okResponse());
  await createProxyClient({ url: 'https://p', fetchImpl }).analyze(req);
  const init = fetchImpl.mock.calls[0][1]!;
  return { headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

beforeEach(async () => {
  mockConfigured = false;
  mockClient = null;
  mockApp.state = { ready: true, settings: { proxyUrl: null, aiMode: 'off' }, saveSettings: jest.fn(async () => undefined) };
  mockApp.listeners = [];
  await AsyncStorage.clear();
  __resetAuthForTests();
});

describe('local-only mode (no backend configured)', () => {
  test('restores to signed out without touching anything', async () => {
    await useAuthStore.getState().restore();
    const s = useAuthStore.getState();
    expect(s.restored).toBe(true);
    expect(s.backendEnabled).toBe(false);
    expect(s.session).toBeNull();
    expect(s.orgs).toEqual([]);
    expect(s.role).toBeNull();
    expect(mockApp.state.saveSettings).not.toHaveBeenCalled();
  });

  test('everyone may edit; account actions explain that accounts are off', async () => {
    await useAuthStore.getState().restore();
    expect(canEditNow()).toBe(true);
    expect(canEditNow(null)).toBe(true);
    expect(canEditNow(ORG_A)).toBe(true);
    expect(canManageProjectsNow()).toBe(true);
    await expect(useAuthStore.getState().signIn('a@b.co', 'x')).rejects.toBeInstanceOf(AuthUnavailableError);
    await expect(useAuthStore.getState().createOrganization('X')).rejects.toBeInstanceOf(AuthUnavailableError);
    await expect(useAuthStore.getState().refreshOrgs()).resolves.toBeUndefined();
    await expect(useAuthStore.getState().signOut()).resolves.toBeUndefined();
    await expect(useAuthStore.getState().setActiveOrg('whatever')).resolves.toBeUndefined();
    expect(useAuthStore.getState().activeOrgId).toBeNull();
  });

  test('AI proxy requests carry no token and no orgId', async () => {
    await useAuthStore.getState().restore();
    const { headers, body } = await proxyCall();
    expect(headers.Authorization).toBeUndefined();
    expect(body.orgId).toBeUndefined();
  });
});

describe('with a backend', () => {
  function configure(opts: Parameters<typeof makeClient>[0]) {
    const client = makeClient(opts);
    mockConfigured = true;
    mockClient = client;
    __resetAuthForTests();
    return client;
  }

  test('restores the session, loads companies, keeps the saved active company', async () => {
    await AsyncStorage.setItem('linemap.auth.v1', JSON.stringify({ userId: 'u1', activeOrgId: ORG_B, orgs: [] }));
    configure({ session: SESSION, members: [orgRow(ORG_A, 'Alpha', 'tech'), orgRow(ORG_B, 'Bravo', 'viewer')] });
    await useAuthStore.getState().restore();
    const s = useAuthStore.getState();
    expect(s.restored).toBe(true);
    expect(s.orgs.map((o) => o.name)).toEqual(['Alpha', 'Bravo']);
    expect(s.activeOrgId).toBe(ORG_B);
    expect(s.role).toBe('viewer');
    expect(s.profileName).toBe('Pat Tech');

    // Role gates: viewer in the active company, tech in Alpha.
    expect(canEditNow()).toBe(false);
    expect(canEditNow(ORG_A)).toBe(true);
    expect(canEditNow(null)).toBe(true);
    expect(canEditNow('not-my-company')).toBe(false);
    expect(canManageProjectsNow(ORG_A)).toBe(false);
  });

  test('wires the AI proxy token and active company, and fills an empty proxy URL only', async () => {
    configure({ session: SESSION, members: [orgRow(ORG_A, 'Alpha', 'tech'), orgRow(ORG_B, 'Bravo', 'owner')] });
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState().activeOrgId).toBe(ORG_A);
    expect(mockApp.state.saveSettings).toHaveBeenCalledWith({ proxyUrl: 'https://x.supabase.co/functions/v1/analyze-photo' });
    expect(mockApp.state.saveSettings.mock.calls.every(([patch]) => !('aiMode' in (patch as object)))).toBe(true);

    let call = await proxyCall();
    expect(call.headers.Authorization).toBe('Bearer jwt-u1');
    expect(call.body.orgId).toBe(ORG_A);

    await useAuthStore.getState().setActiveOrg(ORG_B);
    expect(useAuthStore.getState().role).toBe('owner');
    call = await proxyCall();
    expect(call.body.orgId).toBe(ORG_B);
    const saved = JSON.parse((await AsyncStorage.getItem('linemap.auth.v1'))!);
    expect(saved.activeOrgId).toBe(ORG_B);
    expect(saved.orgs).toHaveLength(2);

    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().orgs).toEqual([]);
    expect(await AsyncStorage.getItem('linemap.auth.v1')).toBeNull();
    call = await proxyCall();
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.body.orgId).toBeUndefined();
  });

  test('never overwrites a custom proxy URL, and waits for app settings to load', async () => {
    mockApp.state.settings.proxyUrl = 'https://my.server/analyze';
    configure({ session: SESSION, members: [orgRow(ORG_A, 'Alpha', 'tech')] });
    await useAuthStore.getState().restore();
    expect(mockApp.state.saveSettings).not.toHaveBeenCalled();

    mockApp.state = { ready: false, settings: { proxyUrl: null, aiMode: 'off' }, saveSettings: jest.fn(async () => undefined) };
    await useAuthStore.getState().setActiveOrg(ORG_A);
    expect(mockApp.state.saveSettings).not.toHaveBeenCalled();
    mockApp.state.ready = true;
    mockApp.listeners.forEach((l) => l(mockApp.state));
    expect(mockApp.state.saveSettings).toHaveBeenCalledTimes(1);
  });

  test('offline at launch keeps the cached company list', async () => {
    await AsyncStorage.setItem(
      'linemap.auth.v1',
      JSON.stringify({
        userId: 'u1',
        activeOrgId: ORG_A,
        orgs: [{ id: ORG_A, name: 'Alpha', slug: 'alpha', role: 'manager', plan: 'pro', subscriptionStatus: 'active', seatLimit: 25, aiMonthlyPhotoQuota: 3000, trialEndsAt: null }],
      }),
    );
    configure({ session: SESSION, membersError: new TypeError('Network request failed') });
    await useAuthStore.getState().restore();
    const s = useAuthStore.getState();
    expect(s.role).toBe('manager');
    expect(s.orgsError).toMatch(/signal/);
    expect(canManageProjectsNow()).toBe(true);
  });

  test('sign in: friendly errors, then success', async () => {
    configure({ members: [] });
    await useAuthStore.getState().restore();
    expect(useAuthStore.getState().session).toBeNull();
    await expect(useAuthStore.getState().signIn('pat@crew.test', 'nope')).rejects.toThrow(/do not match/);
    await useAuthStore.getState().signIn(' pat@crew.test ', 'right-password');
    expect(useAuthStore.getState().user?.id).toBe('u1');
    expect(useAuthStore.getState().orgs).toEqual([]);
    expect(canEditNow()).toBe(true); // signed in without a company: personal use
  });

  test('sign up reports when email confirmation is needed, and detects existing emails', async () => {
    const client = configure({});
    await useAuthStore.getState().restore();
    await expect(useAuthStore.getState().signUp('new@crew.test', 'Bucket-Truck-42', 'New Tech')).resolves.toEqual({ needsEmailConfirm: true });
    const args = client.auth.signUp.mock.calls[0] as unknown as [{ options: { data: { full_name: string }; emailRedirectTo: string } }];
    expect(args[0].options.data.full_name).toBe('New Tech');
    expect(args[0].options.emailRedirectTo).toBe('https://linemap.test/auth/sign-in');

    client.auth.signUp.mockResolvedValueOnce({ data: { user: { ...USER, identities: [] }, session: null }, error: null } as never);
    await expect(useAuthStore.getState().signUp('pat@crew.test', 'Bucket-Truck-42', 'Pat')).rejects.toThrow(/already exists/);
  });

  test('create company and accept invite make it active', async () => {
    const client = configure({ session: SESSION, members: [orgRow(ORG_A, 'Alpha', 'owner'), orgRow(ORG_B, 'Bravo', 'tech')] });
    await useAuthStore.getState().restore();
    const org = await useAuthStore.getState().createOrganization('  Alpha  ');
    expect(client.rpc).toHaveBeenCalledWith('create_organization', { name: 'Alpha' });
    expect(org.id).toBe(ORG_A);
    expect(useAuthStore.getState().activeOrgId).toBe(ORG_A);

    const token = 'a3f9c2e1b4d5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3';
    useAuthStore.getState().setPendingInvite(`linemappro://org/join?token=${token}`);
    expect(useAuthStore.getState().pendingInviteToken).toBe(token);
    await useAuthStore.getState().acceptInvite(`https://linemap.test/org/join?token=${token}`);
    expect(client.rpc).toHaveBeenCalledWith('accept_invite', { token });
    expect(useAuthStore.getState().activeOrgId).toBe(ORG_B);
    expect(useAuthStore.getState().pendingInviteToken).toBeNull();
    await expect(useAuthStore.getState().acceptInvite('garbage')).rejects.toThrow(/does not look right/);
  });

  test('delete account: server blocks are surfaced; success signs out', async () => {
    const client = configure({ session: SESSION, members: [orgRow(ORG_A, 'Alpha', 'owner')] });
    await useAuthStore.getState().restore();
    const preview = await useAuthStore.getState().loadDeletionPreview();
    expect(preview[0]).toMatchObject({ orgName: 'Alpha', ownerCount: 1, memberCount: 3 });

    const blockedBody = { error: 'blocked', code: 'blocked', blocked: [{ org_id: ORG_A, org_name: 'Alpha', reason: 'sole_owner_with_members', other_members: 2 }] };
    client.functions.invoke.mockResolvedValueOnce({ data: null, error: { message: 'non-2xx', context: { clone: () => ({ json: async () => blockedBody }) } } });
    const err = await useAuthStore
      .getState()
      .deleteAccount()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountDeletionBlockedError);
    expect((err as AccountDeletionBlockedError).blocked[0].otherMembers).toBe(2);
    expect(useAuthStore.getState().session).not.toBeNull();

    client.functions.invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await useAuthStore.getState().deleteAccount({ deleteSoleOrgs: true });
    expect(client.functions.invoke).toHaveBeenLastCalledWith('delete-account', { body: { deleteSoleOrgs: true } });
    expect(useAuthStore.getState().session).toBeNull();
  });

  test('auth events: password recovery and sign out from another tab', async () => {
    const client = configure({ session: SESSION, members: [orgRow(ORG_A, 'Alpha', 'tech')] });
    await useAuthStore.getState().restore();
    client.authListeners.forEach((l) => l('PASSWORD_RECOVERY', SESSION));
    expect(useAuthStore.getState().passwordRecovery).toBe(true);
    client.authListeners.forEach((l) => l('SIGNED_OUT', null));
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().role).toBeNull();
  });
});
