// Company picker: every company the user belongs to, with role and plan. Switch the active one,
// start a new company, or join one with an invite code.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { parseInviteToken, subscriptionLabel } from '@/backend/authCore';
import { useAuth, type OrgSummary } from '@/backend/authStore';
import { AccountsOff, AuthHero, Banner, goHome, RoleBadge } from '@/backend/authUi';
import { EmptyState } from '@/components/EmptyState';
import { PageScroll } from '@/components/Page';
import { Button, Card, Field, SectionTitle, T } from '@/components/ui';
import { colors, radius, space } from '@/theme';

export default function OrgSelectScreen() {
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const restored = useAuth((s) => s.restored);
  const session = useAuth((s) => s.session);
  const orgs = useAuth((s) => s.orgs);
  const activeOrgId = useAuth((s) => s.activeOrgId);
  const orgsError = useAuth((s) => s.orgsError);
  const refreshOrgs = useAuth((s) => s.refreshOrgs);
  const setActiveOrg = useAuth((s) => s.setActiveOrg);
  const [refreshing, setRefreshing] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (session) void refreshOrgs();
  }, [session, refreshOrgs]);

  if (!backendEnabled) {
    return (
      <PageScroll>
        <AuthHero icon="business-outline" title="Your companies" />
        <AccountsOff />
      </PageScroll>
    );
  }
  if (!restored) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!session) {
    return (
      <PageScroll>
        <AuthHero icon="business-outline" title="Your companies" subtitle="Sign in to see the companies you work for." />
        <Button title="Sign in" icon="log-in" onPress={() => router.push('/auth/sign-in')} />
      </PageScroll>
    );
  }

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshOrgs();
    } finally {
      setRefreshing(false);
    }
  };

  const choose = async (o: OrgSummary) => {
    await setActiveOrg(o.id);
    if (router.canGoBack()) router.back();
    else goHome();
  };

  const join = () => {
    const token = parseInviteToken(code);
    if (!token) {
      setCodeError('That code does not look right. Paste the whole link or code from the invite email.');
      return;
    }
    setCodeError(null);
    setCode('');
    router.push({ pathname: '/org/join', params: { token } });
  };

  return (
    <PageScroll>
      {orgsError ? (
        <View style={{ marginBottom: space.md }}>
          <Banner kind="warning" title="Could not refresh the list">
            {`${orgsError} Showing the companies saved on this phone.`}
          </Banner>
        </View>
      ) : null}

      {orgs.length === 0 ? (
        <EmptyState
          icon="business-outline"
          title="You are not in a company yet"
          body="Ask your office to invite you (the invite comes by email), or start a new company if you run the crew."
        />
      ) : (
        <>
          <T color={colors.textMuted} style={{ marginBottom: space.md }}>
            Tap a company to work in it. New projects you create are shared with the active company.
          </T>
          <View style={{ gap: space.md }}>
            {orgs.map((o) => (
              <OrgCard key={o.id} org={o} active={o.id === activeOrgId} onPress={() => void choose(o)} />
            ))}
          </View>
        </>
      )}
      <View style={{ alignItems: 'flex-start', marginTop: space.sm }}>
        <Button title="Refresh" kind="ghost" compact icon="refresh" onPress={() => void refresh()} loading={refreshing} />
      </View>

      <SectionTitle>Join with an invite</SectionTitle>
      <Card style={{ gap: space.md }}>
        <Field
          label="Invite link or code"
          value={code}
          onChangeText={(t) => {
            setCode(t);
            setCodeError(null);
          }}
          placeholder="Paste from the invite email"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={join}
          hint="Tapping the link in the email usually opens this screen for you."
        />
        {codeError ? <Banner kind="error">{codeError}</Banner> : null}
        <Button title="Join company" icon="enter-outline" kind="secondary" onPress={join} disabled={!code.trim()} />
      </Card>

      <SectionTitle>Start a company</SectionTitle>
      <Card style={{ gap: space.md }}>
        <T color={colors.textMuted}>For crew owners and contractors. You become the owner and can invite your techs from the web dashboard.</T>
        <Button title="Create a new company" icon="add" onPress={() => router.push('/org/new')} />
      </Card>
    </PageScroll>
  );
}

function OrgCard({ org, active, onPress }: { org: OrgSummary; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${org.name}, ${active ? 'active company' : 'tap to switch'}`}
      style={({ pressed }) => [
        styles.card,
        active && { borderColor: colors.accent, backgroundColor: colors.accent + '12' },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.icon, active && { backgroundColor: colors.accent }]}>
        <Ionicons name="business" size={22} color={active ? colors.onAccent : colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <T v="heading" numberOfLines={1}>
          {org.name}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <RoleBadge role={org.role} />
          <T v="caption" color={colors.textMuted}>
            {subscriptionLabel(org)}
          </T>
        </View>
      </View>
      <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={24} color={active ? colors.accent : colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accent + '1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
