// Compact header for the field screens (we hide the navigator header for full control).
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, T } from '@/components/ui';
import { colors, space } from '@/theme';

export function goBackOr(fallback: string) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}

export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
  backIcon = 'chevron-back',
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack: () => void;
  backIcon?: 'chevron-back' | 'close';
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.sm }]}>
      <IconButton icon={backIcon} label="Back" onPress={onBack} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T v="title" numberOfLines={1}>
          {title}
        </T>
        {subtitle ? (
          <T v="caption" color={colors.textMuted} numberOfLines={1}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
