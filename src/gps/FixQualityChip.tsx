// Fix quality chip for capture and the map: RTK FIX (green), RTK FLOAT (amber), DGPS/GPS (gray),
// NO FIX (red), plus accuracy (cm or hundredths of a foot) and satellites.
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { GeoFix } from '@/domain/types';
import { qualityOf } from '@/geo/averaging';
import { colors, font, radius, space } from '@/theme';

import { isInferredQuality, type SourceStatus } from './positionSource';
import { fixQualityColor, fixQualityLabel, formatPreciseAccuracy, type Units } from './quality';

export function FixQualityChip({
  fix,
  units,
  sourceStatus,
  compact,
  style,
}: {
  fix: GeoFix | null | undefined;
  units: Units;
  /** Pass gps.sourceStatus so a silent receiver shows as stale. */
  sourceStatus?: SourceStatus | null;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const stale = sourceStatus === 'stale';
  const q = fix ? qualityOf(fix) : 'none';
  const label = fixQualityLabel(q);
  const color = stale ? colors.danger : fixQualityColor(q);
  const inferred = isInferredQuality(fix);
  const acc = fix ? formatPreciseAccuracy(fix.accuracyM, units) : null;
  const sats = fix?.satellites;
  const a11y = [label, inferred ? 'estimated from phone accuracy' : null, acc, sats != null ? `${sats} satellites` : null, stale ? 'no recent data' : null]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={[styles.chip, compact && styles.compact, { borderColor: color }, style]} accessibilityLabel={`Fix quality ${a11y}`}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[font.label, { color, fontWeight: '800' }]}>
        {label}
        {inferred ? '*' : ''}
      </Text>
      {acc && q !== 'none' ? <Text style={[font.label, font.mono, { color: colors.text }]}>{acc}</Text> : null}
      {!compact && sats != null ? (
        <View style={styles.sats}>
          <Ionicons name="planet-outline" size={13} color={colors.textMuted} />
          <Text style={[font.caption, { color: colors.textMuted }]}>{sats}</Text>
        </View>
      ) : null}
      {stale ? <Text style={[font.caption, { color: colors.danger }]}>no data</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 40,
    borderRadius: radius.pill,
    borderWidth: 2,
    backgroundColor: colors.overlay,
    alignSelf: 'flex-start',
  },
  compact: { minHeight: 32, paddingHorizontal: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sats: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
