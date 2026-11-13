// Shown instead of the dashboard inside the phone app. The dashboard is built for a computer
// screen. Billing pages are never linked from the phone app (app store rules on purchase links),
// so those paths open the dashboard home instead.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, View } from 'react-native';

import { webPathForNative } from '@/admin/links';
import { WEB_APP_URL } from '@/backend/config';
import { Button, T } from '@/components/ui';
import { colors, radius, space } from '@/theme';

export function NativeNotice() {
  const pathname = usePathname();
  const open = () => {
    void WebBrowser.openBrowserAsync(`${WEB_APP_URL.replace(/\/$/, '')}${webPathForNative(pathname)}`);
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <Ionicons name="desktop-outline" size={30} color={colors.accent} />
        </View>
        <T v="title" style={{ textAlign: 'center' }}>
          Open the dashboard on a computer
        </T>
        <T color={colors.textMuted} style={{ textAlign: 'center' }}>
          The company dashboard (projects, team, usage) is made for a bigger screen. Sign in at {WEB_APP_URL.replace(/^https?:\/\//, '')} from
          a laptop or desktop.
        </T>
        <Button title="Open in browser" icon="open-outline" onPress={open} />
        <Button title="Back to projects" kind="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.bg },
  card: {
    width: '100%',
    maxWidth: 440,
    gap: space.md,
    padding: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'stretch',
  },
  icon: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent + '1F',
  },
});
