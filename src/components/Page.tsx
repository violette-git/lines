// Layout helpers: a centered, max-width scroll page that respects safe areas.
// Phones get full width; tablets, landscape and web get a readable ~720 px column.
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, space } from '@/theme';

export const MAX_CONTENT_WIDTH = 720;

export function Column({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.column, style]}>{children}</View>;
}

export function PageScroll({
  children,
  footer,
  bottomPad = 0,
  topInset = false,
  contentStyle,
}: {
  children: ReactNode;
  /** Sticky footer (e.g. a primary action) pinned above the bottom safe area. */
  footer?: ReactNode;
  /** Extra bottom padding, e.g. to clear a floating button. */
  bottomPad?: number;
  /** Add the top safe-area inset (for screens without a header). */
  topInset?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.root}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: (topInset ? insets.top : 0) + space.lg,
          paddingBottom: (footer ? space.lg : insets.bottom + space.xxl) + bottomPad,
          paddingLeft: insets.left + space.lg,
          paddingRight: insets.right + space.lg,
        }}
      >
        <Column style={contentStyle}>{children}</Column>
      </ScrollView>
      {footer ? (
        <View
          style={[
            styles.footer,
            { paddingBottom: insets.bottom + space.md, paddingLeft: insets.left + space.lg, paddingRight: insets.right + space.lg },
          ]}
        >
          <Column>{footer}</Column>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  footer: {
    paddingTop: space.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
