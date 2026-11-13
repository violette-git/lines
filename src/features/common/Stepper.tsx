// Big-target numeric stepper (- value +). Glove friendly alternative to a slider.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { tapHaptic } from '@/features/common/haptics';
import { colors, font, radius, space, TOUCH } from '@/theme';

export function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  format,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  label?: string;
}) {
  const round = (v: number) => Math.round(v / step) * step;
  const set = (v: number) => {
    const nv = Math.min(max, Math.max(min, round(v)));
    if (nv !== value) {
      tapHaptic();
      onChange(Number(nv.toFixed(4)));
    }
  };
  return (
    <View style={styles.row}>
      {label ? <Text style={[font.label, styles.label]}>{label}</Text> : null}
      <View style={styles.ctrl}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label ?? ''}`}
          disabled={value <= min}
          onPress={() => set(value - step)}
          style={({ pressed }) => [styles.btn, { opacity: value <= min ? 0.35 : pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="remove" size={22} color={colors.text} />
        </Pressable>
        <Text style={[font.heading, font.mono, styles.value]}>{format ? format(value) : String(value)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label ?? ''}`}
          disabled={value >= max}
          onPress={() => set(value + step)}
          style={({ pressed }) => [styles.btn, { opacity: value >= max ? 0.35 : pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="add" size={22} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  label: { color: colors.textMuted, flex: 1 },
  ctrl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btn: { width: TOUCH, height: TOUCH - 4, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 64, textAlign: 'center', color: colors.text },
});
