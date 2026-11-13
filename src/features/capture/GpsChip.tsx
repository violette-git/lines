import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { accuracyColor, formatAccuracy, type Units } from '@/features/common/format';
import { colors, font, radius, space } from '@/theme';

import type { RollingGpsStatus } from './useRollingGps';

export function GpsChip({
  status,
  accuracyM,
  samples,
  units,
}: {
  status: RollingGpsStatus;
  accuracyM: number | null | undefined;
  samples: number;
  units: Units;
}) {
  let text: string;
  let color: string;
  if (status === 'denied') {
    text = 'Location off';
    color = colors.danger;
  } else if (accuracyM == null) {
    text = status === 'unavailable' ? 'No GPS' : 'Finding GPS...';
    color = colors.textMuted;
  } else {
    text = formatAccuracy(accuracyM, units);
    color = accuracyColor(accuracyM);
  }
  return (
    <View style={[styles.chip, { borderColor: color }]} accessibilityLabel={`GPS accuracy ${text}`}>
      <Ionicons name={status === 'denied' ? 'location-outline' : 'navigate'} size={16} color={color} />
      <Text style={[font.label, font.mono, { color }]}>{text}</Text>
      {samples > 1 ? <Text style={[font.caption, { color: colors.textMuted }]}>avg {samples}</Text> : null}
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
  },
});
