// Right-side vertical tool rail: basemap, icon size, locate, fit all.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Basemap } from '@/domain/types';
import { tapHaptic } from '@/features/common/haptics';
import { colors, font, radius, space } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const BASEMAP_LABEL: Record<Basemap, string> = { satellite: 'Sat', hybrid: 'Hybrid', streets: 'Streets' };
const BASEMAP_ICON: Record<Basemap, IconName> = { satellite: 'earth', hybrid: 'layers', streets: 'map' };

export function nextBasemap(b: Basemap): Basemap {
  return b === 'satellite' ? 'hybrid' : b === 'hybrid' ? 'streets' : 'satellite';
}

export function ToolRail({
  basemap,
  onBasemap,
  iconScale,
  onIconScale,
  onLocate,
  onFit,
  locating,
}: {
  basemap: Basemap;
  onBasemap: () => void;
  iconScale: number;
  onIconScale: (v: number) => void;
  onLocate: () => void;
  onFit: () => void;
  locating?: boolean;
}) {
  const step = (d: number) => {
    const v = Math.round(Math.min(3, Math.max(0.5, iconScale + d)) * 100) / 100;
    if (v !== iconScale) onIconScale(v);
  };
  return (
    <View style={styles.rail}>
      <RailBtn icon={BASEMAP_ICON[basemap]} label={BASEMAP_LABEL[basemap]} a11y="Change basemap" onPress={onBasemap} />
      <View style={styles.group}>
        <RailBtn icon="add" a11y="Bigger icons" onPress={() => step(0.25)} flat />
        <Text style={[font.caption, font.mono, styles.scale]}>{iconScale.toFixed(2).replace(/0$/, '')}x</Text>
        <RailBtn icon="remove" a11y="Smaller icons" onPress={() => step(-0.25)} flat />
      </View>
      <RailBtn icon={locating ? 'navigate' : 'navigate-outline'} a11y="Center on my location" onPress={onLocate} />
      <RailBtn icon="scan-outline" a11y="Fit all nodes" onPress={onFit} />
    </View>
  );
}

function RailBtn({
  icon,
  label,
  a11y,
  onPress,
  flat,
}: {
  icon: IconName;
  label?: string;
  a11y: string;
  onPress: () => void;
  flat?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => [flat ? styles.flatBtn : styles.btn, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
      {label ? <Text style={[font.caption, { color: colors.textMuted, fontSize: 10 }]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { gap: space.sm, alignItems: 'center' },
  btn: {
    width: 52,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  group: {
    width: 52,
    borderRadius: radius.md,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  flatBtn: { width: 52, height: 46, alignItems: 'center', justifyContent: 'center' },
  scale: { color: colors.textMuted, fontSize: 10 },
});
