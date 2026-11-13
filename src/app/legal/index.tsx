// Index of legal and support pages (/legal).
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { PageScroll } from '@/components/Page';
import { T, type IconName } from '@/components/ui';
import { TemplateBanner } from '@/legal/LegalDocView';
import { COMPANY } from '@/legal/config';
import { colors, radius, space, TOUCH } from '@/theme';

const ITEMS: { href: '/legal/privacy' | '/legal/terms' | '/support' | '/legal/delete-account'; title: string; body: string; icon: IconName }[] = [
  { href: '/legal/privacy', title: 'Privacy policy', body: 'What we collect, why, and your choices.', icon: 'shield-checkmark-outline' },
  { href: '/legal/terms', title: 'Terms of use', body: 'The rules for using LineMap Pro, including field safety.', icon: 'document-text-outline' },
  { href: '/support', title: 'Support', body: 'Answers to common questions and how to reach us.', icon: 'help-buoy-outline' },
  { href: '/legal/delete-account', title: 'Delete your account', body: 'How to delete your account and what happens to your data.', icon: 'trash-outline' },
];

export default function LegalIndexScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Legal' }} />
      <PageScroll>
        <TemplateBanner />
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          {ITEMS.map((it) => (
            <Pressable
              key={it.href}
              accessibilityRole="link"
              onPress={() => router.push(it.href)}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.8 : 1 }]}
            >
              <View style={styles.icon}>
                <Ionicons name={it.icon} size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="heading">{it.title}</T>
                <T v="caption" color={colors.textMuted}>
                  {it.body}
                </T>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
        <T v="caption" color={colors.textFaint} style={{ marginTop: space.xl }}>
          LineMap Pro is published by {COMPANY.name}, {COMPANY.city}.
        </T>
      </PageScroll>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH + 12,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  icon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.accent + '1A', alignItems: 'center', justifyContent: 'center' },
});
