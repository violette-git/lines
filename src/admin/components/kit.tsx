// Dashboard building blocks: denser desktop typography on the app's dark hi-vis theme.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type HostInstance,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { IconName } from '@/components/ui';
import { colors, radius, space } from '@/theme';

export const FONT_FAMILY =
  Platform.OS === 'web' ? 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' : undefined;
export const MONO_FAMILY = Platform.OS === 'web' ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : undefined;

const variants = {
  hero: { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, lineHeight: 46 },
  h1: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4, lineHeight: 30 },
  h2: { fontSize: 16, fontWeight: '600', letterSpacing: -0.1, lineHeight: 22 },
  h3: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  body: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  small: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  micro: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.7, textTransform: 'uppercase', lineHeight: 14 },
  kpi: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6, lineHeight: 34 },
} satisfies Record<string, TextStyle>;
export type TxtVariant = keyof typeof variants;

export function Txt({
  v = 'body',
  color,
  style,
  children,
  numberOfLines,
  num,
  selectable,
}: {
  v?: TxtVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  /** Tabular figures so columns of numbers line up. */
  num?: boolean;
  selectable?: boolean;
}) {
  return (
    <Text
      selectable={selectable}
      numberOfLines={numberOfLines}
      style={[
        { fontFamily: FONT_FAMILY, color: color ?? colors.text },
        variants[v],
        num && { fontVariant: ['tabular-nums'] },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// ---------- Buttons ----------

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Btn({
  title,
  onPress,
  kind = 'secondary',
  icon,
  disabled,
  loading,
  size = 'md',
  style,
  accessibilityLabel,
}: {
  title?: string;
  onPress: () => void;
  kind?: Kind;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const [hover, setHover] = useState(false);
  const bg =
    kind === 'primary'
      ? hover
        ? colors.accentPressed
        : colors.accent
      : kind === 'danger'
        ? hover
          ? '#e44c4c'
          : colors.danger
        : kind === 'secondary'
          ? hover
            ? colors.surfaceRaised
            : colors.surfaceAlt
          : hover
            ? colors.surfaceAlt
            : 'transparent';
  const fg = kind === 'primary' ? colors.onAccent : kind === 'danger' ? '#fff' : colors.text;
  const h = size === 'sm' ? 30 : size === 'lg' ? 46 : 36;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={disabled || loading}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={({ pressed }) => [
        styles.btn,
        {
          height: h,
          paddingHorizontal: title ? (size === 'sm' ? 10 : size === 'lg' ? 20 : 14) : 0,
          width: title ? undefined : h,
          backgroundColor: bg,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          borderColor: kind === 'secondary' ? colors.border : 'transparent',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 14 : 16} color={fg} /> : null}
          {title ? (
            <Txt v={size === 'lg' ? 'h3' : 'small'} color={fg} style={{ fontWeight: '600' }}>
              {title}
            </Txt>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

// ---------- Layout ----------

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <View style={styles.pageHeader}>
      <View style={{ flex: 1, minWidth: 260, gap: 4 }}>
        {eyebrow}
        <Txt v="h1">{title}</Txt>
        {subtitle ? (
          typeof subtitle === 'string' ? (
            <Txt v="body" color={colors.textMuted}>
              {subtitle}
            </Txt>
          ) : (
            subtitle
          )
        ) : null}
      </View>
      {actions ? <View style={styles.headerActions}>{actions}</View> : null}
    </View>
  );
}

export function Panel({
  title,
  subtitle,
  right,
  children,
  style,
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  return (
    <View style={[styles.panel, style]}>
      {title || right ? (
        <View style={styles.panelHead}>
          <View style={{ flex: 1, gap: 2 }}>
            {title ? <Txt v="h2">{title}</Txt> : null}
            {subtitle ? (
              <Txt v="micro" color={colors.textFaint}>
                {subtitle}
              </Txt>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      <View style={padded ? styles.panelBody : undefined}>{children}</View>
    </View>
  );
}

/** Responsive row: children wrap onto new lines below their minimum width. */
export function Grid({ children, gap = space.lg, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}>{children}</View>;
}

// ---------- KPI tile ----------

export function Kpi({
  label,
  value,
  unit,
  hint,
  icon,
  accent = colors.accent,
  footer,
  loading,
  style,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  icon: IconName;
  accent?: string;
  footer?: ReactNode;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.kpi, style]} accessibilityLabel={`${label}: ${value}${unit ? ' ' + unit : ''}`}>
      <View style={styles.kpiTop}>
        <View style={[styles.kpiIcon, { backgroundColor: accent + '1F' }]}>
          <Ionicons name={icon} size={15} color={accent} />
        </View>
        <Txt v="micro" color={colors.textMuted} numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Txt>
      </View>
      {loading ? (
        <Skeleton width={110} height={30} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Txt v="kpi" num>
            {value}
          </Txt>
          {unit ? (
            <Txt v="small" color={colors.textMuted}>
              {unit}
            </Txt>
          ) : null}
        </View>
      )}
      {footer ?? (hint ? (
        <Txt v="micro" color={colors.textFaint} numberOfLines={2}>
          {hint}
        </Txt>
      ) : null)}
    </View>
  );
}

// ---------- Meter ----------

export function Meter({ pct, color, height = 6, track = colors.surfaceRaised }: { pct: number; color?: string; height?: number; track?: string }) {
  const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
  const c = color ?? (pct >= 1 ? colors.danger : pct >= 0.8 ? colors.warning : colors.accent);
  return (
    <View style={{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(p * 100) }}>
      <View style={{ width: `${p * 100}%`, height, borderRadius: height, backgroundColor: c }} />
    </View>
  );
}

// ---------- Badge / avatar ----------

export function Badge({ label, color = colors.textMuted, icon, solid }: { label: string; color?: string; icon?: IconName; solid?: boolean }) {
  return (
    <View style={[styles.badge, { borderColor: color + '55', backgroundColor: solid ? color : color + '14' }]}>
      {icon ? <Ionicons name={icon} size={11} color={solid ? colors.onAccent : color} /> : null}
      <Txt v="micro" color={solid ? colors.onAccent : color} style={{ fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

const AVATAR_HUES = ['#FFB020', '#3CC8F0', '#3DDC97', '#5AA9FF', '#F48FB1', '#B39DDB', '#FFCC4D'];
export function Avatar({ label, seed, size = 28 }: { label: string; seed: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const c = AVATAR_HUES[h % AVATAR_HUES.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c + '26', borderWidth: 1, borderColor: c + '66', alignItems: 'center', justifyContent: 'center' }}>
      <Txt v="micro" color={c} style={{ fontSize: size * 0.4, fontWeight: '700' }}>
        {label}
      </Txt>
    </View>
  );
}

// ---------- States ----------

export function Skeleton({ width, height = 14, style }: { width: number | `${number}%`; height?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width, height, borderRadius: 6, backgroundColor: colors.surfaceRaised, opacity: 0.7 }, style]} />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  compact,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <View style={[styles.empty, compact && { paddingVertical: space.xl }]}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={22} color={colors.textMuted} />
      </View>
      <Txt v="h3" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {body ? (
        <Txt v="small" color={colors.textMuted} style={{ textAlign: 'center', maxWidth: 420 }}>
          {body}
        </Txt>
      ) : null}
      {action}
    </View>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
  action,
  style,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.info;
  const icon: IconName = tone === 'danger' ? 'alert-circle' : tone === 'warning' ? 'warning' : tone === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <View style={[styles.notice, { borderColor: c + '55', backgroundColor: c + '12' }, style]} accessibilityRole="alert">
      <Ionicons name={icon} size={18} color={c} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Txt v="h3">{title}</Txt> : null}
        {typeof children === 'string' ? (
          <Txt v="small" color={colors.textMuted}>
            {children}
          </Txt>
        ) : (
          children
        )}
      </View>
      {action}
    </View>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Notice tone="danger" title="Could not load this page" action={onRetry ? <Btn title="Retry" icon="refresh" size="sm" onPress={onRetry} /> : undefined}>
      {message}
    </Notice>
  );
}

// ---------- Inputs ----------

export function SearchBox({ value, onChange, placeholder, style }: { value: string; onChange: (v: string) => void; placeholder: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.search, style]}>
      <Ionicons name="search" size={15} color={colors.textFaint} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={[styles.searchInput, { fontFamily: FONT_FAMILY }]}
        accessibilityLabel={placeholder}
      />
      {value ? <Ionicons name="close-circle" size={15} color={colors.textFaint} onPress={() => onChange('')} accessibilityLabel="Clear search" /> : null}
    </View>
  );
}

export function Input({ label, hint, error, style, ...rest }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt v="micro" color={colors.textMuted}>
        {label}
      </Txt>
      <TextInput
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={label}
        style={[styles.input, { fontFamily: FONT_FAMILY }, error ? { borderColor: colors.danger } : null, style]}
        {...rest}
      />
      {error ? (
        <Txt v="micro" color={colors.danger}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt v="micro" color={colors.textFaint}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

/** Pill-style option group (status filters, intervals). */
export function Tabs<V extends string>({
  value,
  options,
  onChange,
  style,
}: {
  value: V;
  options: { value: V; label: string; count?: number }[];
  onChange: (v: V) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.tabs, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.tab, on && styles.tabOn]}
          >
            <Txt v="small" color={on ? colors.text : colors.textMuted} style={{ fontWeight: on ? '600' : '500' }}>
              {o.label}
            </Txt>
            {o.count != null ? (
              <Txt v="micro" color={on ? colors.accent : colors.textFaint} num>
                {o.count}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Menu (popover list) ----------

export interface MenuItem {
  key: string;
  label: string;
  hint?: string;
  icon?: IconName;
  danger?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/**
 * Popover menu anchored under a trigger. Rendered in a transparent modal layer so it is never
 * clipped by scrolling tables or covered by later rows. Click outside or press Escape to close.
 */
export function Menu({
  open,
  onClose,
  items,
  anchor,
  align = 'left',
  width = 240,
}: {
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
  anchor: RefObject<HostInstance | null>;
  align?: 'left' | 'right';
  width?: number;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const { width: winW, height: winH } = useWindowDimensions();
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = anchor.current;
    if (!el) return;
    el.measureInWindow((x, y, w, h) => {
      const estH = items.length * 52 + 12;
      const below = y + h + 4;
      const top = below + estH > winH && y - estH - 4 > 0 ? y - estH - 4 : below;
      const leftRaw = align === 'right' ? x + w - width : x;
      setPos({ top, left: Math.max(8, Math.min(leftRaw, winW - width - 8)) });
    });
  }, [open, anchor, align, width, items.length, winW, winH]);
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close menu" onPress={onClose} style={StyleSheet.absoluteFill} />
      {pos ? (
        <View style={[styles.menu, { width, top: pos.top, left: pos.left }]} accessibilityRole="menu">
          {items.map((it) => (
            <MenuRow key={it.key} item={it} onClose={onClose} />
          ))}
        </View>
      ) : null}
    </Modal>
  );
}

function MenuRow({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [hover, setHover] = useState(false);
  const fg = item.danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="menuitem"
      disabled={item.disabled}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onPress={() => {
        onClose();
        item.onPress();
      }}
      style={[styles.menuRow, hover && { backgroundColor: colors.surfaceRaised }, item.disabled && { opacity: 0.4 }]}
    >
      {item.icon ? <Ionicons name={item.icon} size={15} color={item.danger ? colors.danger : colors.textMuted} /> : null}
      <View style={{ flex: 1 }}>
        <Txt v="small" color={fg} style={{ fontWeight: '500' }} numberOfLines={1}>
          {item.label}
        </Txt>
        {item.hint ? (
          <Txt v="micro" color={colors.textFaint} numberOfLines={2}>
            {item.hint}
          </Txt>
        ) : null}
      </View>
      {item.selected ? <Ionicons name="checkmark" size={15} color={colors.accent} /> : null}
    </Pressable>
  );
}

// ---------- Dialog ----------

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close dialog" />
        <View style={[styles.dialog, { maxWidth: width }]} accessibilityViewIsModal>
          <View style={styles.dialogHead}>
            <Txt v="h2" style={{ flex: 1 }}>
              {title}
            </Txt>
            <Btn kind="ghost" icon="close" size="sm" onPress={onClose} accessibilityLabel="Close" />
          </View>
          <View style={{ padding: space.lg, gap: space.md }}>{children}</View>
          {footer ? <View style={styles.dialogFoot}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export const adminStyles = StyleSheet.create({
  divider: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    cursor: 'pointer',
  },
  pageHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.lg,
    marginBottom: space.xl,
  },
  headerActions: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 52,
  },
  panelBody: { padding: space.lg },
  kpi: {
    flexGrow: 1,
    flexBasis: 160,
    minWidth: 160,
    gap: 10,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpiTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kpiIcon: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  empty: { alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: 48, paddingHorizontal: space.lg },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 4,
  },
  notice: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.md, borderRadius: radius.sm, borderWidth: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    minWidth: 220,
  },
  // outlineStyle is web only (removes the browser focus ring inside the already-outlined box).
  searchInput: { flex: 1, color: colors.text, fontSize: 14, height: 34, ...({ outlineStyle: 'none' } as unknown as TextStyle) },
  input: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    fontSize: 14,
  },
  tabs: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
  },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 28, borderRadius: 6, cursor: 'pointer' },
  tabOn: { backgroundColor: colors.surfaceRaised },
  menu: {
    position: 'absolute',
    zIndex: 50,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceAlt,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, cursor: 'pointer' },
  scrim: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  dialog: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  dialogHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dialogFoot: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
