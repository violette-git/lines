// Accounts, companies (organizations) and roles. Implements AuthState from ./contracts.
//
// Local-only mode: when the backend is not configured (getSupabase() returns null) the store
// reports restored=true with no session, every role check allows editing, and nothing throws
// except the explicit account actions (sign in, sign up...), which explain that accounts are off.
//
// Offline: the company list and the chosen company are cached on the device, so a crew that opens
// the app with no signal keeps the right company and role until the next refresh.
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { setProxyAuthTokenProvider, setProxyOrgIdProvider } from '@/ai/claudeProxy';
import { useStore } from '@/state/store';
// Direct import (not '@/sync'): keeps the sync engine and NetInfo out of this module's graph.
import { setSyncActiveOrg } from '@/sync/status';

import {
  AccountDeletionBlockedError,
  mapDeletionPreview,
  mapServerBlocks,
  type DeletionMembership,
} from './accountDeletion';
import {
  AuthUnavailableError,
  friendlyAuthError,
  mapOrgRows,
  ORG_MEMBER_SELECT,
  parseInviteToken,
  pickActiveOrg,
  roleForOrg,
  type OrgMemberRow,
} from './authCore';
import { loadPersistedAuth, savePersistedAuth, type PersistedAuth } from './authPersist';
import { aiProxyUrl, isBackendConfigured, WEB_APP_URL } from './config';
import { canEditField, canManageProjects, type AuthState, type OrgRole, type OrgSummary } from './contracts';
import { getSupabase } from './supabase';

export interface AuthStore extends AuthState {
  /** False when this build has no backend (local-only mode). */
  backendEnabled: boolean;
  profileName: string | null;
  /** Last problem loading the company list (offline etc.), shown on the company screen. */
  orgsError: string | null;
  /** True while the user arrived from a password reset email and should choose a new password. */
  passwordRecovery: boolean;
  /** Invite link opened while signed out; the sign-in screens continue to it afterwards. */
  pendingInviteToken: string | null;

  setPendingInvite(token: string | null): void;
  updatePassword(password: string): Promise<void>;
  updateProfileName(name: string): Promise<void>;
  /** Companies the user belongs to, with owner and member counts, for the delete-account screen. */
  loadDeletionPreview(): Promise<DeletionMembership[]>;
  /**
   * Deletes the account through the delete-account Edge Function. deleteSoleOrgs also deletes
   * companies where the user is the only member. Throws AccountDeletionBlockedError when a company
   * still needs another owner.
   */
  deleteAccount(opts?: { deleteSoleOrgs?: boolean }): Promise<void>;
}

const SIGNED_OUT = { session: null, user: null, orgs: [] as OrgSummary[], activeOrgId: null, role: null as OrgRole | null, profileName: null };

let restoring: Promise<void> | null = null;
let refreshing: Promise<void> | null = null;
let authSubscription: { unsubscribe(): void } | null = null;
let persisted: PersistedAuth | null = null;

function requireClient(): SupabaseClient {
  const sb = getSupabase();
  if (!sb) throw new AuthUnavailableError();
  return sb;
}

function fail(err: unknown): never {
  if (err instanceof AuthUnavailableError || err instanceof AccountDeletionBlockedError) throw err;
  throw new Error(friendlyAuthError(err));
}

/** Where links in confirmation and reset emails land. The web build of this app serves these routes. */
function webRedirect(path: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) return `${window.location.origin}${path}`;
  return `${WEB_APP_URL.replace(/\/+$/, '')}${path}`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function persist(): void {
  const s = useAuthStore.getState();
  const uid = s.user?.id;
  persisted = uid ? { userId: uid, activeOrgId: s.activeOrgId, orgs: s.orgs } : null;
  void savePersistedAuth(persisted);
}

/**
 * Company AI mode needs the analyze-photo URL. Fill it in once the user is signed in to a company,
 * but only if the field is empty (never overwrite a custom server) and never switch AI mode.
 * Waits for the app store to finish loading so saved settings are not overwritten by defaults.
 */
function ensureProxyUrl(): void {
  const { session, activeOrgId } = useAuthStore.getState();
  const url = aiProxyUrl();
  if (!session || !activeOrgId || !url || !isBackendConfigured()) return;
  const apply = () => {
    const app = useStore.getState();
    if (app.settings.proxyUrl?.trim()) return;
    app.saveSettings({ proxyUrl: url }).catch(() => {
      // Non-critical: the user can still type the URL in Settings.
    });
  };
  if (useStore.getState().ready) {
    apply();
    return;
  }
  const unsubscribe = useStore.subscribe((s) => {
    if (!s.ready) return;
    unsubscribe();
    apply();
  });
}

let proxyWired = false;
function wireProxy(): void {
  if (proxyWired) return;
  proxyWired = true;
  setProxyAuthTokenProvider(async () => {
    const sb = getSupabase();
    if (!sb || !useAuthStore.getState().session) return null;
    try {
      // getSession refreshes an expired token when it can.
      const { data } = await sb.auth.getSession();
      return data.session?.access_token ?? null;
    } catch {
      return useAuthStore.getState().session?.access_token ?? null;
    }
  });
  setProxyOrgIdProvider(() => (useAuthStore.getState().session ? useAuthStore.getState().activeOrgId : null));
}

/** Applies a session. A new user gets their cached companies right away, then a background refresh. */
function applySession(session: Session | null, opts: { refresh: boolean }): void {
  const prevUserId = useAuthStore.getState().user?.id ?? null;
  const user = session?.user ?? null;
  if (!session || !user) {
    useAuthStore.setState({ ...SIGNED_OUT });
    return;
  }
  if (user.id === prevUserId) {
    useAuthStore.setState({ session, user });
    return;
  }
  const cached = persisted && persisted.userId === user.id ? persisted : null;
  const orgs = cached?.orgs ?? [];
  const activeOrgId = pickActiveOrg(orgs, cached?.activeOrgId);
  const meta = user.user_metadata as { full_name?: unknown } | undefined;
  useAuthStore.setState({
    session,
    user,
    orgs,
    activeOrgId,
    role: roleForOrg(orgs, activeOrgId),
    profileName: typeof meta?.full_name === 'string' ? meta.full_name : null,
    orgsError: null,
  });
  if (opts.refresh) {
    // Deferred: Supabase calls made inside an auth callback can deadlock.
    setTimeout(() => {
      void useAuthStore.getState().refreshOrgs();
    }, 0);
  }
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  restored: false,
  backendEnabled: isBackendConfigured(),
  ...SIGNED_OUT,
  orgsError: null,
  passwordRecovery: false,
  pendingInviteToken: null,

  restore() {
    if (restoring) return restoring;
    restoring = (async () => {
      const sb = getSupabase();
      if (!sb) {
        set({ ...SIGNED_OUT, backendEnabled: false, restored: true });
        return;
      }
      try {
        wireProxy();
        persisted = await loadPersistedAuth();
        if (!authSubscription) {
          authSubscription = sb.auth.onAuthStateChange((event, session) => {
            if (event === 'INITIAL_SESSION') return; // handled by getSession below
            if (event === 'PASSWORD_RECOVERY') set({ passwordRecovery: true });
            if (event === 'SIGNED_OUT') {
              set({ ...SIGNED_OUT });
              return;
            }
            applySession(session, { refresh: true });
            if (session) ensureProxyUrl();
          }).data.subscription;
        }
        let session: Session | null = null;
        try {
          const { data } = await withTimeout(sb.auth.getSession(), 10_000);
          session = data.session;
        } catch {
          session = null;
        }
        applySession(session, { refresh: false });
        if (session) {
          // Do not hold up the app on a slow network: cached companies are already in place.
          await withTimeout(get().refreshOrgs(), 6_000).catch(() => undefined);
          ensureProxyUrl();
        }
      } catch {
        // Never block the app on account problems; worst case the user signs in again.
      } finally {
        set({ restored: true });
      }
    })();
    return restoring;
  },

  async signIn(email, password) {
    const sb = requireClient();
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.session) fail(error ?? new Error('Sign in failed. Please try again.'));
    applySession(data.session, { refresh: false });
    await get().refreshOrgs();
    ensureProxyUrl();
  },

  async signUp(email, password, fullName) {
    const sb = requireClient();
    const name = fullName.trim();
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name }, emailRedirectTo: webRedirect('/auth/sign-in') },
    });
    if (error) fail(error);
    // With email confirmation on, Supabase answers an existing email with a user that has no
    // identities (instead of an error) so strangers cannot probe which emails have accounts.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      fail({ code: 'user_already_exists' });
    }
    if (data.session) {
      applySession(data.session, { refresh: false });
      await get().refreshOrgs();
      ensureProxyUrl();
      return { needsEmailConfirm: false };
    }
    return { needsEmailConfirm: true };
  },

  async sendPasswordReset(email) {
    const sb = requireClient();
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: webRedirect('/auth/reset') });
    if (error) fail(error);
  },

  async updatePassword(password) {
    const sb = requireClient();
    const { error } = await sb.auth.updateUser({ password });
    if (error) fail(error);
    set({ passwordRecovery: false });
  },

  async signOut() {
    const sb = getSupabase();
    if (sb) {
      try {
        // Only this device: a crew lead signing out of a shared tablet should not sign out their phone.
        await sb.auth.signOut({ scope: 'local' });
      } catch {
        // Signed out locally either way.
      }
    }
    set({ ...SIGNED_OUT, passwordRecovery: false, orgsError: null });
    persisted = null;
    void savePersistedAuth(null);
  },

  refreshOrgs() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const sb = getSupabase();
      const uid = get().user?.id;
      if (!sb || !uid) return;
      try {
        const [members, profile] = await Promise.all([
          sb.from('org_members').select(ORG_MEMBER_SELECT).eq('user_id', uid),
          sb.from('profiles').select('full_name').eq('id', uid).maybeSingle(),
        ]);
        if (members.error) throw members.error;
        if (get().user?.id !== uid) return; // signed out or switched while loading
        const orgs = mapOrgRows(members.data as unknown as OrgMemberRow[]);
        const activeOrgId = pickActiveOrg(orgs, get().activeOrgId ?? persisted?.activeOrgId);
        const fullName = (profile.data as { full_name?: unknown } | null)?.full_name;
        set({
          orgs,
          activeOrgId,
          role: roleForOrg(orgs, activeOrgId),
          orgsError: null,
          ...(typeof fullName === 'string' ? { profileName: fullName } : {}),
        });
        persist();
      } catch (err) {
        // Keep the cached list; the screen shows the problem.
        set({ orgsError: friendlyAuthError(err) });
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  },

  async setActiveOrg(orgId) {
    const { orgs } = get();
    const next = orgId && orgs.some((o) => o.id === orgId) ? orgId : null;
    set({ activeOrgId: next, role: roleForOrg(orgs, next) });
    persist();
    ensureProxyUrl();
  },

  async createOrganization(name) {
    const sb = requireClient();
    const { data, error } = await sb.rpc('create_organization', { name: name.trim() });
    if (error) fail(error);
    const id = typeof data === 'string' ? data : null;
    if (!id) fail(new Error('The company was not created. Please try again.'));
    await get().refreshOrgs();
    let org = get().orgs.find((o) => o.id === id);
    if (!org) {
      // The list did not reload (weak signal): add it locally so the user can carry on.
      org = {
        id,
        name: name.trim(),
        slug: '',
        role: 'owner',
        plan: 'trial',
        subscriptionStatus: 'trialing',
        seatLimit: null,
        aiMonthlyPhotoQuota: null,
        trialEndsAt: null,
      };
      set({ orgs: [...get().orgs, org] });
    }
    await get().setActiveOrg(id);
    return org;
  },

  async acceptInvite(tokenOrUrl) {
    const sb = requireClient();
    const token = parseInviteToken(tokenOrUrl);
    if (!token) fail(new Error('That invite code does not look right. Copy the whole link or code from the email.'));
    const { data, error } = await sb.rpc('accept_invite', { token });
    if (error) fail(error);
    set({ pendingInviteToken: null });
    await get().refreshOrgs();
    if (typeof data === 'string') await get().setActiveOrg(data);
  },

  setPendingInvite(token) {
    set({ pendingInviteToken: token ? parseInviteToken(token) : null });
  },

  async updateProfileName(name) {
    const sb = requireClient();
    const uid = get().user?.id;
    if (!uid) fail(new Error('Sign in first.'));
    const full = name.trim();
    const { error } = await sb.from('profiles').update({ full_name: full || null }).eq('id', uid);
    if (error) fail(error);
    // Keep the login record in step (used for the profile row of brand-new accounts).
    await sb.auth.updateUser({ data: { full_name: full } }).catch(() => undefined);
    set({ profileName: full || null });
  },

  async loadDeletionPreview() {
    const sb = requireClient();
    const { data, error } = await sb.rpc('account_deletion_preview');
    if (error) fail(error);
    return mapDeletionPreview(data);
  },

  async deleteAccount(opts) {
    const sb = requireClient();
    if (!get().session) fail(new Error('Sign in first.'));
    const { error } = await sb.functions.invoke('delete-account', { body: { deleteSoleOrgs: !!opts?.deleteSoleOrgs } });
    if (error) {
      let body: unknown = null;
      const ctx = (error as { context?: unknown }).context as { json?: () => Promise<unknown>; clone?: () => { json(): Promise<unknown> } } | undefined;
      try {
        if (ctx?.clone) body = await ctx.clone().json();
        else if (ctx?.json) body = await ctx.json();
      } catch {
        body = null;
      }
      const msg = (body as { error?: unknown } | null)?.error;
      const blocks = mapServerBlocks(body);
      if (blocks.length) throw new AccountDeletionBlockedError(blocks, typeof msg === 'string' ? msg : undefined);
      fail(typeof msg === 'string' ? new Error(msg) : error);
    }
    // The account is gone on the server; clear this device.
    await get().signOut();
  },
}));

// ------------------------------------------------------------------------------------------------
// Sync wiring: tell sync (and the project list) the active company and role whenever they change,
// including after restore, refreshOrgs, company switches and sign-out (null).
// ------------------------------------------------------------------------------------------------

let lastSyncKey: string | null = null;
function pushSyncOrg(s: AuthStore): void {
  const orgId = s.session ? s.activeOrgId : null;
  const role = s.session && orgId ? s.role : null;
  const key = `${orgId ?? ''}|${role ?? ''}`;
  if (key === lastSyncKey) return;
  lastSyncKey = key;
  try {
    void setSyncActiveOrg(orgId, role).catch(() => undefined);
  } catch {
    // The project store is not available (tests); nothing to switch.
  }
}
useAuthStore.subscribe((s) => pushSyncOrg(s));

// ------------------------------------------------------------------------------------------------
// Hooks and helpers for screens
// ------------------------------------------------------------------------------------------------

export function useAuth<T>(selector: (s: AuthStore) => T): T {
  return useAuthStore(selector);
}

/** Role in the active company; null when signed out, local-only, or no company. */
export function useRole(): OrgRole | null {
  return useAuthStore((s) => s.role);
}

export function useActiveOrg(): OrgSummary | null {
  return useAuthStore((s) => s.orgs.find((o) => o.id === s.activeOrgId) ?? null);
}

export function useIsSignedIn(): boolean {
  return useAuthStore((s) => s.session != null);
}

type RoleCheck = (r: OrgRole | null) => boolean;

function check(s: AuthStore, orgId: string | null | undefined, can: RoleCheck): boolean {
  if (orgId === null) return true; // project that lives only on this phone
  if (!s.restored || !s.session) return true; // local-only mode, or still restoring
  if (orgId === undefined) return can(s.role);
  const role = roleForOrg(s.orgs, orgId);
  return role != null && can(role);
}

/**
 * True when the user may capture and edit field data: always in local-only mode and for projects
 * that are not shared with a company; otherwise tech, manager, admin or owner.
 * Pass a project's orgId to check that company; omit it to check the active company.
 */
export function useCanEdit(orgId?: string | null): boolean {
  return useAuthStore((s) => check(s, orgId, canEditField));
}

/** True when the user may create, rename and delete projects and templates (manager and up). */
export function useCanManageProjects(orgId?: string | null): boolean {
  return useAuthStore((s) => check(s, orgId, canManageProjects));
}

/** Non-hook versions for store actions and event handlers. */
export const canEditNow = (orgId?: string | null) => check(useAuthStore.getState(), orgId, canEditField);
export const canManageProjectsNow = (orgId?: string | null) => check(useAuthStore.getState(), orgId, canManageProjects);

/** For tests: forget module state so restore() runs again. */
export function __resetAuthForTests(): void {
  authSubscription?.unsubscribe();
  authSubscription = null;
  restoring = null;
  refreshing = null;
  persisted = null;
  proxyWired = false;
  lastSyncKey = null;
  useAuthStore.setState({
    restored: false,
    backendEnabled: isBackendConfigured(),
    ...SIGNED_OUT,
    orgsError: null,
    passwordRecovery: false,
    pendingInviteToken: null,
  });
}

export { canEditField, canManageBilling, canManageMembers, canManageProjects, ROLE_RANK } from './contracts';
export type { OrgRole, OrgSummary } from './contracts';
