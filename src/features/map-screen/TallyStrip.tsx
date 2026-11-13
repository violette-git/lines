// Live footage / earnings tally. Pulses when the numbers change so the crew sees each capture count.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { formatMoney, type Units } from '@/features/common/format';
import { formatLength } from '@/geo';
import type { Tally } from '@/state/store';
import { colors, font, radius, space } from '@/theme';

export function TallyStrip({ tally, units }: { tally: Tally; units: Units }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const key = `${tally.nodeCount}|${Math.round(tally.totalFt)}|${tally.earnings ?? ''}`;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pulse.setValue(1);
    Animated.timing(pulse, { toValue: 0, duration: 650, useNativeDriver: true }).start();
  }, [key, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] });

  return (
    <Animated.View style={[styles.strip, { transform: [{ scale }] }]} accessibilityLabel="Project tally">
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.glow, { opacity: glow }]} />
      <Cell label="Nodes" value={String(tally.nodeCount)} />
      <Sep />
      <Cell label="Aerial" value={formatLength(tally.aerialFt, units)} color={colors.aerial} />
      <Sep />
      <Cell label="Underground" value={formatLength(tally.undergroundFt, units)} color={colors.underground} />
      <Sep />
      <Cell label="Total" value={formatLength(tally.totalFt, units)} strong />
      {tally.earnings != null ? (
        <>
          <Sep />
          <Cell label="Est. pay" value={formatMoney(tally.earnings)} color={colors.success} strong />
        </>
      ) : null}
    </Animated.View>
  );
}

function Cell({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <View style={styles.cell}>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[font.mono, { color: color ?? colors.text, fontSize: strong ? 15 : 14, fontWeight: strong ? '800' : '700' }]}
      >
        {value}
      </Text>
      <Text numberOfLines={1} style={[font.caption, { color: colors.textMuted, fontSize: 10 }]}>
        {label}
      </Text>
    </View>
  );
}

function Sep() {
  return <View style={styles.sep} />;
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: space.sm,
    overflow: 'hidden',
  },
  glow: { backgroundColor: colors.accent, borderRadius: radius.md },
  cell: { flex: 1, alignItems: 'center', minWidth: 0 },
  sep: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginHorizontal: 2 },
});
