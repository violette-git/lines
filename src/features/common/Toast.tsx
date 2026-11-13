// Lightweight in-screen toast with an optional action button. No native deps.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, shadow, space } from '@/theme';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  actionLabel?: string;
  onAction?: () => void;
  /** Milliseconds; default 2600, or 6000 when there is an action. */
  durationMs?: number;
}

interface ToastState extends ToastOptions {
  id: number;
  message: string;
}

const KIND_COLOR: Record<ToastKind, string> = {
  info: colors.info,
  success: colors.success,
  warning: colors.warning,
  error: colors.danger,
};
const KIND_ICON = {
  info: 'information-circle',
  success: 'checkmark-circle',
  warning: 'warning',
  error: 'alert-circle',
} as const;

export function useToast(position: { top?: number; bottom?: number } = { bottom: 140 }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const counter = useRef(0);

  const show = useCallback((message: string, opts: ToastOptions = {}) => {
    counter.current += 1;
    setToast({ id: counter.current, message, ...opts });
  }, []);
  const hide = useCallback(() => setToast(null), []);

  const node = useMemo(
    () => (toast ? <ToastView key={toast.id} toast={toast} onDone={hide} position={position} /> : null),
    // position is a style hint only; avoid re-mounting on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, hide],
  );
  return { show, hide, node };
}

function ToastView({
  toast,
  onDone,
  position,
}: {
  toast: ToastState;
  onDone: () => void;
  position: { top?: number; bottom?: number };
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const kind = toast.kind ?? 'info';
  const duration = toast.durationMs ?? (toast.actionLabel ? 6000 : 2600);

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    const t = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => onDone());
    }, duration);
    return () => clearTimeout(t);
  }, [anim, duration, onDone]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        position,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        },
      ]}
    >
      <View style={[styles.toast, { borderLeftColor: KIND_COLOR[kind] }]}>
        <Ionicons name={KIND_ICON[kind]} size={22} color={KIND_COLOR[kind]} />
        <Text style={[font.body, styles.msg]} numberOfLines={3}>
          {toast.message}
        </Text>
        {toast.actionLabel ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              toast.onAction?.();
              onDone();
            }}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[font.heading, { color: colors.accent }]}>{toast.actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, alignItems: 'center', zIndex: 100 },
  toast: {
    maxWidth: 560,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 52,
    ...shadow.card,
  },
  msg: { color: colors.text, flex: 1 },
  action: { paddingHorizontal: space.sm, paddingVertical: space.sm, minHeight: 44, justifyContent: 'center' },
});
