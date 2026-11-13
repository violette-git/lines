// Sign in with email and password. Accounts are optional: the app works on one phone without one.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { isValidEmail, safeNextPath } from '@/backend/authCore';
import { useAuth } from '@/backend/authStore';
import { AccountsOff, AuthHero, Banner, continueAfterSignIn, goHome, PasswordField, useAction } from '@/backend/authUi';
import { PageScroll } from '@/components/Page';
import { Button, Card, Field, T } from '@/components/ui';
import { colors, space } from '@/theme';

export default function SignInScreen() {
  const params = useLocalSearchParams<{ email?: string; next?: string }>();
  // Only app paths are honored (no open redirects); see safeNextPath.
  const next = safeNextPath(params.next);
  const withNext = (path: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const session = useAuth((s) => s.session);
  const signIn = useAuth((s) => s.signIn);
  const pendingInvite = useAuth((s) => s.pendingInviteToken);
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const { busy, error, setError, run } = useAction();

  if (!backendEnabled) {
    return (
      <PageScroll>
        <AuthHero icon="log-in-outline" title="Sign in" />
        <AccountsOff />
      </PageScroll>
    );
  }

  if (session) {
    return (
      <PageScroll>
        <AuthHero icon="checkmark-done" title="You are signed in" subtitle={session.user.email ?? undefined} />
        <View style={{ gap: space.md }}>
          <Button title="Continue" icon="arrow-forward" onPress={() => continueAfterSignIn(next)} />
          <Button title="Account and sign out" kind="secondary" icon="person-circle-outline" onPress={() => router.replace('/account')} />
        </View>
      </PageScroll>
    );
  }

  const submit = () => {
    if (!isValidEmail(email)) return setError('Enter the email address you signed up with.');
    if (!password) return setError('Enter your password.');
    void run(async () => {
      await signIn(email, password);
      setPassword('');
      continueAfterSignIn(next);
    });
  };

  return (
    <PageScroll>
      <AuthHero icon="log-in-outline" title="Sign in" subtitle="Use your company account to share projects with your crew and the office." />
      {pendingInvite ? (
        <View style={{ marginBottom: space.lg }}>
          <Banner kind="info" title="You have an invite">
            Sign in (or create an account) with the email address the invite was sent to, and we will add you to the company.
          </Banner>
        </View>
      ) : null}
      <Card style={{ gap: space.lg }}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@company.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
        />
        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {error ? <Banner kind="error">{error}</Banner> : null}
        <Button title="Sign in" icon="log-in" onPress={submit} loading={busy} />
        <Button
          title="Forgot password?"
          kind="ghost"
          compact
          onPress={() => router.push({ pathname: '/auth/reset', params: email.trim() ? { email: email.trim() } : {} })}
        />
      </Card>

      <View style={{ gap: space.md, marginTop: space.xl }}>
        <T v="label" color={colors.textMuted} style={{ textAlign: 'center' }}>
          New to LineMap Pro?
        </T>
        <Button title="Create an account" kind="secondary" icon="person-add-outline" onPress={() => router.replace(withNext('/auth/sign-up') as never)} />
        <Button title="Continue without an account (this phone only)" kind="ghost" icon="phone-portrait-outline" onPress={goHome} />
        <T v="caption" color={colors.textFaint} style={{ textAlign: 'center' }}>
          Without an account, your projects stay on this device. You can sign in later.
        </T>
      </View>
    </PageScroll>
  );
}
