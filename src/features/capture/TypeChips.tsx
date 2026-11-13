import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NODE_TYPE_META } from '@/domain/nodeSchemas';
import { NODE_TYPES, type NodeType } from '@/domain/types';
import { tapHaptic } from '@/features/common/haptics';
import { colors, font, radius, space } from '@/theme';

/** Horizontal node type selector, colored by type. */
export function TypeChips({
  value,
  onChange,
  types = NODE_TYPES,
  dense,
}: {
  value: NodeType;
  onChange: (t: NodeType) => void;
  types?: NodeType[];
  dense?: boolean;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.md }}
      keyboardShouldPersistTaps="handled"
    >
      {types.map((t) => {
        const meta = NODE_TYPE_META[t];
        const on = t === value;
        return (
          <Pressable
            key={t}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={meta.label}
            onPress={() => {
              tapHaptic();
              onChange(t);
            }}
            style={({ pressed }) => [
              styles.chip,
              dense && { minHeight: 40 },
              {
                backgroundColor: on ? meta.color : colors.overlay,
                borderColor: on ? meta.color : colors.borderStrong,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View style={[styles.badge, { backgroundColor: on ? colors.onAccent : meta.color }]}>
              <Text style={[styles.badgeText, { color: on ? meta.color : colors.onAccent }]}>{meta.short}</Text>
            </View>
            <Text style={[font.label, { color: on ? colors.onAccent : colors.text }]}>{meta.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 46,
    paddingLeft: 6,
    paddingRight: space.md,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  badge: { minWidth: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontSize: 11, fontWeight: '900' },
});
