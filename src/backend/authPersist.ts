// Remembers the active company and a cached copy of the company list between launches, so a crew
// that opens the app with no signal still gets the right company and role. AsyncStorage on phones,
// localStorage on web. Every call is wrapped in try/catch: a failed read just means "nothing saved".
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import type { OrgSummary } from './contracts';

const KEY = 'linemap.auth.v1';

export interface PersistedAuth {
  userId: string;
  activeOrgId: string | null;
  orgs: OrgSummary[];
}

function parse(raw: string | null): PersistedAuth | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PersistedAuth> | null;
    if (!v || typeof v.userId !== 'string') return null;
    return {
      userId: v.userId,
      activeOrgId: typeof v.activeOrgId === 'string' ? v.activeOrgId : null,
      orgs: Array.isArray(v.orgs) ? (v.orgs as OrgSummary[]).filter((o) => o && typeof o.id === 'string') : [],
    };
  } catch {
    return null;
  }
}

export async function loadPersistedAuth(): Promise<PersistedAuth | null> {
  try {
    if (Platform.OS === 'web') {
      return parse(typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null);
    }
    return parse(await AsyncStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export async function savePersistedAuth(v: PersistedAuth | null): Promise<void> {
  try {
    const raw = v ? JSON.stringify(v) : null;
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return;
      if (raw == null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, raw);
      return;
    }
    if (raw == null) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, raw);
  } catch {
    // Non-critical: the list is reloaded from the server on the next launch with signal.
  }
}
