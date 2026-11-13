// Small building blocks shared by the sign-in, company and account screens.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type TextInputProps } from 'react-native';

import { Button, Card, Field, IconButton, T, type IconName } from '@/components/ui';
import { colors, radius, space } from '@/theme';

import { ROLE_LABEL, safeNextPath } from './authCore';
import { WEB_APP_URL } from './config';
import { useAuthStore } from './authStore';
import type { OrgRole } from './contracts';

export function AuthHero({ icon, title, subtitle }: { icon: IconName; title: string; subtitle?: string }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroIcon}>
        <Ionicons name={icon} size={30} color={colors.onAccent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="title">{title}</T>
        {subtitle ? <T color={colors.textMuted}>{subtitle}</T> : null}
      </View>
    </View>
  );
}

type BannerKind = 'error' | 'info' | 'success' | 'warning';
const BANNER: Record<BannerKind, { color: string; icon: IconName }> = {
  error: { color: colors.danger, icon: 'alert-circle' },
  info: { color: colors.info, icon: 'information-circle' },
  success: { color: colors.success, icon: 'checkmark-circle' },
  warning: { color: colors.warning, icon: 'warning' },
};

export function Banner({ kind, title, children }: { kind: BannerKind; title?: string; children?: ReactNode }) {
  const b = BANNER[kind];
  return (
    <View
      style={[styles.banner, { borderColor: b.color + '66', backgroundColor: b.color + '14' }]}
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={kind === 'error' ? 'polite' : undefined}
    >
      <Ionicons name={b.icon} size={20} color={b.color} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <T v="label" color={b.color}>
            {title}
          </T>
        ) : null}
        {typeof children === 'string' ? <T v="caption" color={colors.text}>{children}</T> : children}
      </View>
    </View>
  );
}

/** Password input with a show/hide button. */
export function PasswordField(props: TextInputProps & { label: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <Field
      {...props}
      secureTextEntry={!show}
      autoCapitalize="none"
      autoCorrect={false}
      right={
        <IconButton
          icon={show ? 'eye-off-outline' : 'eye-outline'}
          label={show ? 'Hide password' : 'Show password'}
          size={44}
          onPress={() => setShow((v) => !v)}
          style={{ borderWidth: 0, backgroundColor: 'transparent' }}
        />
      }
    />
  );
}

export function RoleBadge({ role }: { role: OrgRole }) {
  const c = role === 'owner' || role === 'admin' ? colors.accent : role === 'viewer' ? colors.textMuted : colors.cyan;
  return (
    <View style={[styles.badge, { borderColor: c + '88', backgroundColor: c + '1A' }]}>
      <T v="caption" color={c}>
        {ROLE_LABEL[role]}
      </T>
    </View>
  );
}

/** Shown on account screens when this build has no backend configured. */
export function AccountsOff() {
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ionicons name="phone-portrait-outline" size={22} color={colors.accent} />
        <T v="heading">This copy works on this phone only</T>
      </View>
      <T color={colors.textMuted}>
        Accounts and company sharing are not set up in this version of the app. Everything you map is saved on this device, and you can export it any
        time.
      </T>
      <Button title="Back to projects" icon="arrow-back" kind="secondary" onPress={goHome} />
    </Card>
  );
}

/**
 * Plans and payment are handled on the website, never inside the app (App Store rule 3.1.1 and
 * Google Play payments policy). Hidden on iOS, where Apple restricts links to outside purchases;
 * Android and web keep the link. Set to false everywhere if a store reviewer objects; the screens
 * then just say to manage the plan on the web.
 */
export const SHOW_WEB_BILLING_LINK = Platform.OS !== 'ios';

export const webUrl = (path: string) => `${WEB_APP_URL.replace(/\/+$/, '')}${path}`;

/** Opens a page of the website (billing, members) in the in-app browser. */
export async function openWeb(path: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(webUrl(path));
  } catch {
    // Nothing useful to do: the button stays available to try again.
  }
}

/** Leaves the account screens and returns to the project list. */
export function goHome(): void {
  router.dismissTo('/');
}

/**
 * Where to go after signing in or signing up with an active session. An invite wins; then a safe
 * `next` path from the link that sent the user to sign in (see safeNextPath).
 */
export function continueAfterSignIn(next?: string | null): void {
  const s = useAuthStore.getState();
  if (s.pendingInviteToken) {
    router.replace({ pathname: '/org/join', params: { token: s.pendingInviteToken } });
    return;
  }
  const target = safeNextPath(next);
  if (target) {
    router.replace(target as never);
    return;
  }
  if (s.orgs.length === 0) {
    router.replace('/org/select');
    return;
  }
  goHome();
}

/** Runs an async action with a busy flag and a friendly error message. */
export function useAction(): {
  busy: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  run: (fn: () => Promise<void>) => Promise<boolean>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xl },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, alignSelf: 'flex-start' },
});
