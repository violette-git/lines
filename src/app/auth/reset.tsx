// Password reset. Step 1 (any device): send the reset email. Step 2 (the page the email link
// opens, usually the website): choose a new password.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { isValidEmail, passwordStrength } from '@/backend/authCore';
import { useAuth } from '@/backend/authStore';
import { AccountsOff, AuthHero, Banner, goHome, PasswordField, useAction } from '@/backend/authUi';
import { PageScroll } from '@/components/Page';
import { Button, Card, Field, T } from '@/components/ui';
import { colors, space } from '@/theme';

export default function ResetScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const recovery = useAuth((s) => s.passwordRecovery && s.session != null);

  if (!backendEnabled) {
    return (
      <PageScroll>
        <AuthHero icon="key-outline" title="Reset password" />
        <AccountsOff />
      </PageScroll>
    );
  }
  return recovery ? <NewPassword /> : <RequestReset initialEmail={typeof params.email === 'string' ? params.email : ''} />;
}

function RequestReset({ initialEmail }: { initialEmail: string }) {
  const sendPasswordReset = useAuth((s) => s.sendPasswordReset);
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const { busy, error, setError, run } = useAction();

  const submit = () => {
    if (!isValidEmail(email)) return setError('Enter the email address you signed up with.');
    void run(async () => {
      await sendPasswordReset(email);
      setSent(true);
    });
  };

  return (
    <PageScroll>
      <AuthHero icon="key-outline" title="Reset password" subtitle="We will email you a link to choose a new password." />
      <Card style={{ gap: space.lg }}>
        {sent ? (
          <>
            <Banner kind="success" title="Check your email">
              {`If an account exists for ${email.trim()}, a reset link is on its way. Open it on any device, choose a new password, then sign in here.`}
            </Banner>
            <Button title="Back to sign in" icon="log-in" onPress={() => router.replace({ pathname: '/auth/sign-in', params: { email: email.trim() } })} />
            <Button title="Send it again" kind="ghost" compact onPress={submit} loading={busy} />
          </>
        ) : (
          <>
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
              returnKeyType="send"
              onSubmitEditing={submit}
            />
            {error ? <Banner kind="error">{error}</Banner> : null}
            <Button title="Send reset link" icon="mail-outline" onPress={submit} loading={busy} />
          </>
        )}
      </Card>
      {sent && error ? (
        <View style={{ marginTop: space.md }}>
          <Banner kind="error">{error}</Banner>
        </View>
      ) : null}
    </PageScroll>
  );
}

function NewPassword() {
  const updatePassword = useAuth((s) => s.updatePassword);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();
  const strength = passwordStrength(password);

  const submit = () => {
    if (!strength.ok) return setError(strength.hint);
    if (password !== confirm) return setError('The two passwords do not match.');
    void run(async () => {
      await updatePassword(password);
      setPassword('');
      setConfirm('');
      setDone(true);
    });
  };

  if (done) {
    return (
      <PageScroll>
        <AuthHero icon="checkmark-circle-outline" title="Password changed" subtitle="Use your new password the next time you sign in on any device." />
        <Button title="Done" icon="checkmark" onPress={goHome} />
      </PageScroll>
    );
  }

  return (
    <PageScroll>
      <AuthHero icon="key-outline" title="Choose a new password" />
      <Card style={{ gap: space.lg }}>
        <PasswordField
          label="New password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          textContentType="newPassword"
          hint={strength.label ? `${strength.label}. ${strength.hint}` : strength.hint}
        />
        <PasswordField
          label="Type it again"
          value={confirm}
          onChangeText={setConfirm}
          autoComplete="new-password"
          textContentType="newPassword"
          onSubmitEditing={submit}
        />
        {error ? <Banner kind="error">{error}</Banner> : null}
        <Button title="Save new password" icon="save-outline" onPress={submit} loading={busy} />
        <T v="caption" color={colors.textFaint}>
          Other phones stay signed in. Sign out on them from the Account screen if you think someone else knows your old password.
        </T>
      </Card>
    </PageScroll>
  );
}
