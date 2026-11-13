// Bottom action sheet built on Modal so it works the same on Android, iOS and web.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space, TOUCH } from '@/theme';

import { MAX_CONTENT_WIDTH } from './Page';
import { T, type IconName } from './ui';

export interface SheetAction {
  key: string;
  label: string;
  icon: IconName;
  onPress: () => void;
  destructive?: boolean;
  hint?: string;
}

export function ActionSheet({
  visible,
  title,
  subtitle,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        <Pressable
          // Inner Pressable swallows taps so tapping the sheet itself does not close it.
          onPress={() => undefined}
          style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}
        >
          <View style={styles.grabber} />
          {title ? (
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, gap: 2 }}>
              <T v="heading" numberOfLines={1}>
                {title}
              </T>
              {subtitle ? (
                <T v="caption" color={colors.textMuted} numberOfLines={1}>
                  {subtitle}
                </T>
              ) : null}
            </View>
          ) : null}
          {actions.map((a) => (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              onPress={() => {
                onClose();
                // iOS drops an Alert opened while a Modal is still animating out.
                setTimeout(a.onPress, Platform.OS === 'ios' ? 350 : 0);
              }}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceRaised }]}
            >
              <View style={[styles.icon, a.destructive && { backgroundColor: colors.danger + '22' }]}>
                <Ionicons name={a.icon} size={22} color={a.destructive ? colors.danger : colors.text} />
              </View>
              <View style={{ flex: 1 }}>
                <T v="heading" color={a.destructive ? colors.danger : colors.text}>
                  {a.label}
                </T>
                {a.hint ? (
                  <T v="caption" color={colors.textMuted}>
                    {a.hint}
                  </T>
                ) : null}
              </View>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.8 }]}
          >
            <T v="heading">Cancel</T>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: space.sm,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: space.md },
  row: { minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    minHeight: TOUCH,
    marginTop: space.sm,
    marginHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
