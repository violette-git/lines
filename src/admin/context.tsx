// Gives dashboard pages the signed-in session and the active organization without prop drilling.
import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useNavigation } from 'expo-router';

import type { OrgRole, OrgSummary } from '@/backend/contracts';

import type { AdminSession } from './session';

export interface AdminContextValue {
  session: AdminSession;
  org: OrgSummary;
  orgId: string;
  role: OrgRole;
}

const Ctx = createContext<AdminContextValue | null>(null);

export function AdminProvider({ value, children }: { value: AdminContextValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAdmin must be used inside the admin layout');
  return v;
}

/** Hides the root stack header for this route (the dashboard and pricing page draw their own). */
export function useHideStackHeader(title: string) {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false, title });
  }, [navigation, title]);
}

/** Browser tab title on web. */
export function useDocumentTitle(title: string) {
  useLayoutEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.title = `${title} | LineMap Pro`;
  }, [title]);
}
