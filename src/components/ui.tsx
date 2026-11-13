// Shared UI primitives. Feature screens compose these so the app looks consistent.
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, font, radius, space, TOUCH } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type TextVariant = keyof typeof font;
export function T({
  v = 'body',
  color,
  style,
  children,
  numberOfLines,
}: {
  v?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[font[v], { color: color ?? colors.text }, style]}>
      {children}
    </Text>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  loading,
  style,
  compact,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const bg =
    kind === 'primary' ? colors.accent : kind === 'danger' ? colors.danger : kind === 'secondary' ? colors.surfaceRaised : 'transparent';
  const fg = kind === 'primary' ? colors.onAccent : kind === 'danger' ? '#fff' : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.btnCompact,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'secondary' && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={compact ? 16 : 20} color={fg} /> : null}
          <Text style={[font.heading, { color: fg }, compact && { fontSize: 14 }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  active,
  size = TOUCH,
  style,
  badge,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  active?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
  badge?: string | number | null;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconBtn,
        { width: size, height: size, backgroundColor: active ? colors.accent : colors.surfaceRaised, opacity: pressed ? 0.8 : 1 },
        style,
      ]}
    >
      <Ionicons name={icon} size={size * 0.44} color={active ? colors.onAccent : colors.text} />
      {badge != null && badge !== 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({
  label,
  selected,
  onPress,
  color,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: color ?? colors.accent, borderColor: color ?? colors.accent },
        { opacity: pressed ? 0.8 : 1 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={selected ? colors.onAccent : colors.textMuted} /> : null}
      <Text style={[font.label, { color: selected ? colors.onAccent : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: { value: V; label: string; icon?: IconName }[];
  onChange: (v: V) => void;
}) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.segItem, on && { backgroundColor: colors.accent }]}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={on ? colors.onAccent : colors.textMuted} /> : null}
            <Text style={[font.label, { color: on ? colors.onAccent : colors.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  hint,
  right,
  ...input
}: TextInputProps & { label: string; hint?: string; right?: ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <T v="label" color={colors.textMuted}>
        {label}
      </T>
      <View style={styles.inputRow}>
        <TextInput placeholderTextColor={colors.textFaint} style={styles.input} {...input} />
        {right}
      </View>
      {hint ? (
        <T v="caption" color={colors.textFaint}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="heading">{label}</T>
        {hint ? (
          <T v="caption" color={colors.textMuted}>
            {hint}
          </T>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={value ? '#fff' : colors.textMuted}
      />
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <T v="label" color={colors.textMuted} style={{ textTransform: 'uppercase', marginTop: space.lg, marginBottom: space.sm }}>
      {children}
    </T>
  );
}

export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <T v="heading" color={color ?? colors.text} style={font.mono}>
        {value}
      </T>
      <T v="caption" color={colors.textMuted}>
        {label}
      </T>
    </View>
  );
}

export function ConfidenceBadge({ confidence, estimate }: { confidence: number; estimate?: boolean }) {
  const c = confidence >= 0.8 ? colors.success : confidence >= 0.55 ? colors.warning : colors.danger;
  return (
    <View style={[styles.conf, { borderColor: c }]}>
      <Ionicons name="sparkles" size={11} color={c} />
      <Text style={[font.caption, { color: c }]}>
        {Math.round(confidence * 100)}%{estimate ? ' est.' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  btnCompact: { minHeight: 40, paddingHorizontal: space.md },
  iconBtn: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segItem: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: space.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingRight: space.xs,
  },
  input: { flex: 1, minHeight: TOUCH - 4, paddingHorizontal: space.md, color: colors.text, fontSize: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  conf: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
});
