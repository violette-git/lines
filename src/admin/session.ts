// The signed-in user as the dashboard sees it. Reads the shared auth store; in fixture mode
// (EXPO_PUBLIC_ADMIN_FIXTURES=1, design/screenshot builds only) returns a fake signed-in owner.
import { useEffect, useState } from 'react';

import { useAuth, useAuthStore } from '@/backend/authStore';
import type { OrgRole, OrgSummary } from '@/backend/contracts';

import { FIXTURES_ENABLED } from './api';

export interface AdminSession {
  /** False until the stored sign-in has been checked. */
  restored: boolean;
  /** False in builds without a backend configured (and not in fixture mode). */
  backendEnabled: boolean;
  signedIn: boolean;
  userId: string | null;
  email: string | null;
  name: string | null;
  orgs: OrgSummary[];
  activeOrg: OrgSummary | null;
  role: OrgRole | null;
  setActiveOrg(orgId: string): Promise<void>;
  signOut(): Promise<void>;
  refreshOrgs(): Promise<void>;
  updateProfileName(name: string): Promise<void>;
}

// ---------- Fixture session (module state so every hook instance agrees) ----------
let fixtureOrgId: string | null = null;
let fixtureRole: OrgRole = 'owner';
let fixtureName = 'Dana Whitfield';
const listeners = new Set<() => void>();
const bump = () => listeners.forEach((l) => l());

/** Fixture mode only: pretend to be another role (used by screenshots and design review). */
export function __setFixtureRole(role: OrgRole) {
  fixtureRole = role;
  bump();
}

function useFixtureSession(): AdminSession {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fx = require('./fixtures') as typeof import('./fixtures');
  const orgs = fx.fixtureOrgs(fixtureRole);
  const activeOrg = orgs.find((o) => o.id === (fixtureOrgId ?? fx.FIXTURE_ORG_ID)) ?? orgs[0];
  return {
    restored: true,
    backendEnabled: true,
    signedIn: true,
    userId: fx.FIXTURE_USER_ID,
    email: 'dana@acmefiber.example',
    name: fixtureName,
    orgs,
    activeOrg,
    role: activeOrg.role,
    async setActiveOrg(id) {
      fixtureOrgId = id;
      bump();
    },
    async signOut() {
      // Nothing to sign out of in fixture mode.
    },
    async refreshOrgs() {},
    async updateProfileName(name) {
      fixtureName = name;
      bump();
    },
  };
}

function useRealSession(): AdminSession {
  const restored = useAuth((s) => s.restored);
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const session = useAuth((s) => s.session);
  const user = useAuth((s) => s.user);
  const orgs = useAuth((s) => s.orgs);
  const activeOrgId = useAuth((s) => s.activeOrgId);
  const role = useAuth((s) => s.role);
  const profileName = useAuth((s) => s.profileName);

  useEffect(() => {
    if (!restored) void useAuthStore.getState().restore();
  }, [restored]);

  const meta = (user?.user_metadata ?? {}) as { full_name?: unknown };
  return {
    restored,
    backendEnabled,
    signedIn: session != null,
    userId: user?.id ?? null,
    email: user?.email ?? null,
    name: profileName ?? (typeof meta.full_name === 'string' ? meta.full_name : null),
    orgs,
    activeOrg: orgs.find((o) => o.id === activeOrgId) ?? null,
    role,
    setActiveOrg: (id) => useAuthStore.getState().setActiveOrg(id),
    signOut: () => useAuthStore.getState().signOut(),
    refreshOrgs: () => useAuthStore.getState().refreshOrgs(),
    updateProfileName: (name) => useAuthStore.getState().updateProfileName(name),
  };
}

/** The choice is fixed per build, so the hook order never changes between renders. */
export const useAdminSession: () => AdminSession = FIXTURES_ENABLED ? useFixtureSession : useRealSession;
