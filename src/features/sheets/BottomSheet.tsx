// Reusable bottom sheet built on Animated + PanResponder (no extra native deps, works on web).
// Snap points: 'peek' (header plus a little content) and 'expanded'. Drag the header to move it;
// drag down past peek to close.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadow, space } from '@/theme';

export type SheetSnap = 'peek' | 'expanded';

export interface BottomSheetProps {
  visible: boolean;
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  onClose: () => void;
  /** Visible height in peek state (excluding the bottom safe-area inset). */
  peekHeight?: number;
  /** Fraction of the window height used when expanded. */
  expandedRatio?: number;
  /** Draggable header area (title row, primary actions). */
  header?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function BottomSheet({
  visible,
  snap,
  onSnapChange,
  onClose,
  peekHeight = 220,
  expandedRatio = 0.82,
  header,
  children,
  style,
}: BottomSheetProps) {
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetH = Math.round(winH * expandedRatio);
  const peekVisible = Math.min(peekHeight + insets.bottom, sheetH);
  const offsets = useMemo(
    () => ({ expanded: 0, peek: sheetH - peekVisible, hidden: sheetH + 24 }),
    [sheetH, peekVisible],
  );

  const y = useRef(new Animated.Value(offsets.hidden)).current;
  const current = useRef(offsets.hidden);
  const [mounted, setMounted] = useState(visible);

  // Keep latest values for the pan responder (created once).
  const live = useRef({ offsets, snap, onSnapChange, onClose });
  live.current = { offsets, snap, onSnapChange, onClose };

  const animateTo = (to: number, after?: () => void) => {
    current.current = to;
    Animated.spring(y, { toValue: to, useNativeDriver: true, friction: 10, tension: 80 }).start(({ finished }) => {
      if (finished) after?.();
    });
  };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      animateTo(snap === 'expanded' ? offsets.expanded : offsets.peek);
    } else if (mounted) {
      animateTo(offsets.hidden, () => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, snap, offsets.expanded, offsets.peek, offsets.hidden]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {
          y.stopAnimation((v) => {
            current.current = v;
          });
        },
        onPanResponderMove: (_e, g) => {
          const o = live.current.offsets;
          const next = Math.max(o.expanded - 30, Math.min(o.hidden, current.current + g.dy));
          y.setValue(next);
        },
        onPanResponderRelease: (_e, g) => {
          const o = live.current.offsets;
          const pos = current.current + g.dy;
          const fling = g.vy;
          let target: 'expanded' | 'peek' | 'close';
          if (fling < -0.6) target = 'expanded';
          else if (fling > 0.8 && pos > o.peek - 20) target = 'close';
          else if (fling > 0.6) target = 'peek';
          else if (pos > o.peek + (o.hidden - o.peek) * 0.45) target = 'close';
          else if (pos < o.peek / 2) target = 'expanded';
          else target = 'peek';

          if (target === 'close') {
            animateTo(o.hidden, () => live.current.onClose());
          } else {
            animateTo(target === 'expanded' ? o.expanded : o.peek);
            if (target !== live.current.snap) live.current.onSnapChange(target);
          }
        },
        onPanResponderTerminate: () => {
          const o = live.current.offsets;
          animateTo(live.current.snap === 'expanded' ? o.expanded : o.peek);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!mounted) return null;

  return (
    <Animated.View
      style={[
        styles.sheet,
        { height: sheetH, transform: [{ translateY: y }] },
        style,
      ]}
    >
      <View {...pan.panHandlers}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={snap === 'expanded' ? 'Collapse details' : 'Expand details'}
          onPress={() => onSnapChange(snap === 'expanded' ? 'peek' : 'expanded')}
          style={styles.handleHit}
        >
          <View style={styles.handle} />
        </Pressable>
        {header ? <View style={styles.header}>{header}</View> : null}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    zIndex: 40,
  },
  handleHit: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.sm },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
  header: { paddingHorizontal: space.lg, paddingBottom: space.sm },
});
