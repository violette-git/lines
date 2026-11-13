// Create an account: name, email, password (with a strength hint) and terms acceptance.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { isValidEmail, passwordStrength, safeNextPath } from '@/backend/authCore';
import { useAuth } from '@/backend/authStore';
import { AccountsOff, AuthHero, Banner, continueAfterSignIn, goHome, PasswordField, useAction } from '@/backend/authUi';
import { PageScroll } from '@/components/Page';
import { Button, Card, Field, T } from '@/components/ui';
import { colors, radius, space } from '@/theme';

const STRENGTH_COLORS = [colors.border, colors.danger, colors.warning, colors.success, colors.success];

export default function SignUpScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  // Only app paths are honored (no open redirects); see safeNextPath.
  const next = safeNextPath(params.next);
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const signUp = useAuth((s) => s.signUp);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();
  const strength = passwordStrength(password);

  if (!backendEnabled) {
    return (
      <PageScroll>
        <AuthHero icon="person-add-outline" title="Create an account" />
        <AccountsOff />
      </PageScroll>
    );
  }

  if (sentTo) {
    return (
      <PageScroll>
        <AuthHero icon="mail-unread-outline" title="Check your email" subtitle={`We sent a confirmation link to ${sentTo}.`} />
        <Card style={{ gap: space.md }}>
          <T color={colors.textMuted}>
            Open the link in that email to confirm your address, then come back and sign in. The email can take a minute or two; check your spam or junk
            folder if you do not see it.
          </T>
          <Button
            title="I confirmed, sign in"
            icon="log-in"
            onPress={() => router.replace({ pathname: '/auth/sign-in', params: next ? { email: sentTo, next } : { email: sentTo } })}
          />
          <Button title="Use a different email" kind="ghost" compact onPress={() => setSentTo(null)} />
        </Card>
      </PageScroll>
    );
  }

  const submit = () => {
    if (!name.trim()) return setError('Enter your name so your crew knows who mapped what.');
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    if (!strength.ok) return setError(strength.hint);
    if (!accepted) return setError('Please accept the Terms of Service and Privacy Policy to continue.');
    void run(async () => {
      const { needsEmailConfirm } = await signUp(email, password, name);
      setPassword('');
      if (needsEmailConfirm) setSentTo(email.trim());
      else continueAfterSignIn(next);
    });
  };

  return (
    <PageScroll>
      <AuthHero icon="person-add-outline" title="Create an account" subtitle="Free to sign up. Join your company with an invite, or start a new company." />
      <Card style={{ gap: space.lg }}>
        <Field
          label="Your name"
          value={name}
          onChangeText={setName}
          placeholder="First and last name"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
        />
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
          hint="Use the address your company invited, if you have an invite."
        />
        <View style={{ gap: space.sm }}>
          <PasswordField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <View style={styles.meter} accessibilityLabel={strength.label ? `Password strength: ${strength.label}` : undefined}>
            {[1, 2, 3, 4].map((i) => (
              <View key={i} style={[styles.meterBar, { backgroundColor: strength.score >= i ? STRENGTH_COLORS[strength.score] : colors.border }]} />
            ))}
          </View>
          <T v="caption" color={strength.score === 0 ? colors.textFaint : STRENGTH_COLORS[strength.score]}>
            {strength.label ? `${strength.label}. ${strength.hint}` : strength.hint}
          </T>
        </View>

        <Pressable
          onPress={() => setAccepted((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
          style={styles.check}
        >
          <Ionicons name={accepted ? 'checkbox' : 'square-outline'} size={26} color={accepted ? colors.accent : colors.textMuted} />
          <T style={{ flex: 1 }}>
            I agree to the{' '}
            <T color={colors.accent} style={styles.link}>
              Terms of Service
            </T>{' '}
            and the{' '}
            <T color={colors.accent} style={styles.link}>
              Privacy Policy
            </T>
            .
          </T>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <Button title="Read the terms" kind="secondary" compact icon="document-text-outline" onPress={() => router.push('/legal/terms')} />
          <Button title="Read the privacy policy" kind="secondary" compact icon="shield-checkmark-outline" onPress={() => router.push('/legal/privacy')} />
        </View>

        {error ? <Banner kind="error">{error}</Banner> : null}
        <Button title="Create account" icon="person-add" onPress={submit} loading={busy} />
      </Card>

      <View style={{ gap: space.md, marginTop: space.xl }}>
        <Button title="I already have an account" kind="secondary" icon="log-in-outline" onPress={() => router.replace((next ? `/auth/sign-in?next=${encodeURIComponent(next)}` : '/auth/sign-in') as never)} />
        <Button title="Continue without an account (this phone only)" kind="ghost" icon="phone-portrait-outline" onPress={goHome} />
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  meter: { flexDirection: 'row', gap: 4 },
  meterBar: { flex: 1, height: 6, borderRadius: radius.pill },
  check: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  link: { textDecorationLine: 'underline' },
});
