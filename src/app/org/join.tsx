// Accept an invite. Opened by linemappro://org/join?token=... (app link), by
// https://<website>/org/join?token=... (web link), or from the company screen with a pasted code.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { parseInviteToken, ROLE_HINT } from '@/backend/authCore';
import { useAuth, useAuthStore } from '@/backend/authStore';
import { AccountsOff, AuthHero, Banner, goHome, RoleBadge, useAction } from '@/backend/authUi';
import { PageScroll } from '@/components/Page';
import { Button, Card, Field, T } from '@/components/ui';
import { colors, space } from '@/theme';

function friendlyInviteError(message: string): string {
  if (/seat limit/i.test(message)) return 'This company has no free seats right now. Ask your admin to make room, then try again.';
  if (/different email/i.test(message)) {
    return 'This invite was sent to a different email address. Sign out and sign in (or create an account) with the address the invite was sent to.';
  }
  if (/invalid|already used|expired/i.test(message)) {
    return 'This invite is no longer valid. It may have been used already or be more than 7 days old. Ask your admin to send a new one.';
  }
  return message;
}

export default function JoinOrgScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const linkToken = parseInviteToken(rawToken ?? null);

  const backendEnabled = useAuth((s) => s.backendEnabled);
  const restored = useAuth((s) => s.restored);
  const session = useAuth((s) => s.session);
  const pendingInvite = useAuth((s) => s.pendingInviteToken);
  const setPendingInvite = useAuth((s) => s.setPendingInvite);
  const acceptInvite = useAuth((s) => s.acceptInvite);
  const [code, setCode] = useState('');
  const [joinedOrgId, setJoinedOrgId] = useState<string | null>(null);
  const joined = useAuth((s) => (joinedOrgId ? s.orgs.find((o) => o.id === joinedOrgId) ?? null : null));
  const { busy, error, setError, run } = useAction();

  const token = linkToken ?? pendingInvite ?? parseInviteToken(code);

  // Remember the invite while the user signs in or creates an account.
  useEffect(() => {
    if (linkToken && !session) setPendingInvite(linkToken);
  }, [linkToken, session, setPendingInvite]);

  if (!backendEnabled) {
    return (
      <PageScroll>
        <AuthHero icon="enter-outline" title="Join a company" />
        <AccountsOff />
      </PageScroll>
    );
  }
  if (!restored) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (joinedOrgId) {
    return (
      <PageScroll>
        <AuthHero icon="people-outline" title={joined ? `Welcome to ${joined.name}` : 'You joined the company'} subtitle="It is now your active company." />
        {joined ? (
          <Card style={{ gap: space.sm, marginBottom: space.lg }}>
            <RoleBadge role={joined.role} />
            <T color={colors.textMuted}>{ROLE_HINT[joined.role]}</T>
          </Card>
        ) : null}
        <Button title="Start mapping" icon="arrow-forward" onPress={goHome} />
      </PageScroll>
    );
  }

  if (!session) {
    return (
      <PageScroll>
        <AuthHero icon="enter-outline" title="You are invited" subtitle="Sign in or create an account to join the company." />
        <Card style={{ gap: space.md }}>
          <T color={colors.textMuted}>Use the same email address the invite was sent to. We will bring you back here after you sign in.</T>
          <Button title="Sign in" icon="log-in" onPress={() => router.push('/auth/sign-in')} />
          <Button title="Create an account" kind="secondary" icon="person-add-outline" onPress={() => router.push('/auth/sign-up')} />
          <Button
            title="Not now"
            kind="ghost"
            compact
            onPress={() => {
              setPendingInvite(null);
              goHome();
            }}
          />
        </Card>
      </PageScroll>
    );
  }

  const accept = () => {
    if (!token) return setError('Paste the invite link or code from the email.');
    void run(async () => {
      try {
        await acceptInvite(token);
      } catch (e) {
        throw new Error(friendlyInviteError(e instanceof Error ? e.message : String(e)));
      }
      setJoinedOrgId(useAuthStore.getState().activeOrgId);
    });
  };

  return (
    <PageScroll>
      <AuthHero icon="enter-outline" title="Join a company" subtitle={session.user.email ? `Signed in as ${session.user.email}` : undefined} />
      <Card style={{ gap: space.lg }}>
        {linkToken || pendingInvite ? (
          <T color={colors.textMuted}>You opened an invite. Join to see the company's projects and map for them.</T>
        ) : (
          <Field
            label="Invite link or code"
            value={code}
            onChangeText={setCode}
            placeholder="Paste from the invite email"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={accept}
          />
        )}
        {error ? <Banner kind="error">{error}</Banner> : null}
        <Button title="Join company" icon="enter" onPress={accept} loading={busy} disabled={!token} />
        <Button
          title="Not now"
          kind="ghost"
          compact
          onPress={() => {
            setPendingInvite(null);
            goHome();
          }}
        />
      </Card>
    </PageScroll>
  );
}
