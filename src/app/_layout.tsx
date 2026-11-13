// Root layout: dark theme, safe areas, data init with a branded loading view, and first-run onboarding.
import Ionicons from '@expo/vector-icons/Ionicons';
import { DarkTheme, router, Stack, ThemeProvider, usePathname, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { hasSeenOnboarding } from '@/components/prefs';
import { Button, T } from '@/components/ui';
import { DEMO_PROJECT_ID } from '@/data';
import { IS_PREVIEW_BUILD } from '@/map/basemaps';
import { useStore } from '@/state/store';
import { colors, font, radius, space } from '@/theme';

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
};

type Phase = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; showOnboarding: boolean };

export default function RootLayout() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const boot = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      await useStore.getState().init();
      const seen = await hasSeenOnboarding();
      // No stored flag: treat as first run only when there is no real work yet (the web preview's
      // seeded demo does not count). A failed flag read on an existing install therefore never
      // hides the user's projects behind the intro.
      const showOnboarding = seen === null ? useStore.getState().projects.every((p) => p.id === DEMO_PROJECT_ID) : !seen;
      setPhase({ kind: 'ready', showOnboarding });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <StatusBar style="light" />
        <View style={styles.root}>
          {phase.kind === 'ready' ? (
            <>
              <AppStack />
              <FirstRunRedirect enabled={phase.showOnboarding} />
              <PreviewNotice />
            </>
          ) : phase.kind === 'error' ? (
            <ErrorView message={phase.message} onRetry={boot} />
          ) : (
            <LoadingView />
          )}
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppStack() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
        animation: 'default',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Projects' }} />
      <Stack.Screen name="project/new" options={{ presentation: 'modal', title: 'New project' }} />
      <Stack.Screen name="project/[id]/index" options={{ headerShown: false, title: 'Project' }} />
      <Stack.Screen name="project/[id]/capture" options={{ presentation: 'fullScreenModal', headerShown: false, title: 'Capture' }} />
      <Stack.Screen name="project/[id]/node/[nodeId]" options={{ title: 'Node' }} />
      <Stack.Screen name="project/[id]/export" options={{ title: 'Export' }} />
      <Stack.Screen name="project/[id]/edit" options={{ title: 'Project details' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="templates/index" options={{ title: 'Client templates' }} />
      <Stack.Screen name="templates/[id]" options={{ title: 'Template' }} />
      <Stack.Screen name="help" options={{ title: 'Help and how-to' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, title: 'Welcome', animation: 'fade' }} />
    </Stack>
  );
}

/** Sends a first-time user to the intro once, after the navigator has mounted. */
function FirstRunRedirect({ enabled }: { enabled: boolean }) {
  const done = useRef(false);
  const pathname = usePathname();
  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;
    // Only hijack the home screen; deep links (web URLs, notifications) go where they asked.
    if (pathname !== '/' && pathname !== '') return;
    const t = setTimeout(() => router.replace('/onboarding'), 0);
    return () => clearTimeout(t);
  }, [enabled, pathname]);
  return null;
}

function Wordmark() {
  return (
    <View style={styles.brandRow}>
      <View style={styles.logo}>
        <Ionicons name="git-network" size={30} color={colors.onAccent} />
      </View>
      <View>
        <T v="display">
          LineMap <T v="display" color={colors.accent}>Pro</T>
        </T>
        <T v="caption" color={colors.textMuted}>
          Field mapping for cable and fiber crews
        </T>
      </View>
    </View>
  );
}

function LoadingView() {
  return (
    <View style={styles.center} accessibilityLabel="Loading LineMap Pro">
      <Wordmark />
      <View style={styles.loadingRow}>
        <ActivityIndicator color={colors.accent} />
        <T v="label" color={colors.textMuted}>
          Opening your projects...
        </T>
      </View>
    </View>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.center}>
      <Wordmark />
      <View style={styles.errorCard}>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <Ionicons name="warning" size={22} color={colors.danger} />
          <T v="heading">Could not open the project database</T>
        </View>
        <T color={colors.textMuted}>
          Your data is still on this device. Try again; if it keeps happening, restart the app or free up some storage.
        </T>
        <T v="caption" color={colors.textFaint} style={font.mono} numberOfLines={4}>
          {message}
        </T>
        <Button title="Try again" icon="refresh" onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.xl, backgroundColor: colors.bg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  errorCard: {
    width: '100%',
    maxWidth: 480,
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger + '66',
    backgroundColor: colors.surface,
  },
});

/** Shown only in browser preview builds, which run in a sandbox without camera, GPS, imagery or downloads. */
function PreviewNotice() {
  const [open, setOpen] = useState(true);
  if (!IS_PREVIEW_BUILD || !open) return null;
  return (
    <View style={previewStyles.wrap} pointerEvents="box-none">
      <View style={previewStyles.card}>
        <Ionicons name="eye-outline" size={16} color={colors.onAccent} />
        <T v="caption" color={colors.onAccent} style={{ flex: 1 }}>
          Preview: camera, GPS, satellite imagery and file downloads are off in this window. They work in the phone app.
        </T>
        <Ionicons name="close" size={18} color={colors.onAccent} onPress={() => setOpen(false)} accessibilityLabel="Dismiss preview notice" />
      </View>
    </View>
  );
}

const previewStyles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 112, alignItems: 'center', paddingHorizontal: space.md },
  card: {
    maxWidth: 560,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
});
