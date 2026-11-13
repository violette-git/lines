// Web admin dashboard frame. Web only: inside the phone app these routes show a short "open on a
// computer" screen. Requires sign-in (sends to /auth/sign-in?next=<path>) and an organization.
import { Redirect, router, Slot, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { FIXTURES_ENABLED } from '@/admin/api';
import { FIXTURE_ORG_2_ID } from '@/admin/fixtures';
import { AdminShell } from '@/admin/components/Shell';
import { Btn, EmptyState, Notice, Txt } from '@/admin/components/kit';
import { NativeNotice } from '@/admin/components/NativeNotice';
import { AdminProvider, useHideStackHeader } from '@/admin/context';
import { __setFixtureRole, useAdminSession } from '@/admin/session';
import type { OrgRole } from '@/backend/contracts';
import { colors, space } from '@/theme';

export default function AdminLayout() {
  useHideStackHeader('Dashboard');
  if (Platform.OS !== 'web') return <NativeNotice />;
  return <AdminGate />;
}

function AdminGate() {
  const session = useAdminSession();
  const pathname = usePathname();

  // Fixture builds only: ?as=admin|manager|tech|viewer previews other roles.
  useEffect(() => {
    if (!FIXTURES_ENABLED || typeof window === 'undefined') return;
    const as = new URLSearchParams(window.location.search).get('as');
    if (as && ['owner', 'admin', 'manager', 'tech', 'viewer'].includes(as)) __setFixtureRole(as as OrgRole);
    const org = new URLSearchParams(window.location.search).get('org');
    if (org === '2') void session.setActiveOrg(FIXTURE_ORG_2_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsOrgPick = session.signedIn && !session.activeOrg && session.orgs.length > 0;
  useEffect(() => {
    if (needsOrgPick) void session.setActiveOrg(session.orgs[0].id);
  }, [needsOrgPick, session]);

  if (!session.restored || needsOrgPick) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!session.backendEnabled) {
    return (
      <View style={styles.center}>
        <View style={{ maxWidth: 520, width: '100%' }}>
          <Notice tone="warning" title="Company accounts are not set up for this website">
            This build has no backend configured (EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY). See docs/BACKEND.md.
          </Notice>
        </View>
      </View>
    );
  }

  if (!session.signedIn) {
    return <Redirect href={`/auth/sign-in?next=${encodeURIComponent(pathname || '/admin')}`} />;
  }

  if (!session.activeOrg || !session.role) {
    return (
      <View style={styles.center}>
        <View style={styles.card}>
          <EmptyState
            icon="business-outline"
            title="You are not part of a company yet"
            body="The dashboard shows a company's projects, team and billing. Create a company, or ask your administrator for an invite link."
            action={
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                <Btn title="Create a company" kind="primary" icon="add" onPress={() => router.push('/org/new')} />
                <Btn title="I have an invite" onPress={() => router.push('/org/select')} />
              </View>
            }
          />
          <Txt v="micro" color={colors.textFaint} style={{ textAlign: 'center' }}>
            Signed in as {session.email}
          </Txt>
        </View>
      </View>
    );
  }

  return (
    <AdminProvider value={{ session, org: session.activeOrg, orgId: session.activeOrg.id, role: session.role }}>
      <AdminShell session={session}>
        <Slot />
      </AdminShell>
    </AdminProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.bg },
  card: {
    maxWidth: 520,
    width: '100%',
    padding: space.lg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
