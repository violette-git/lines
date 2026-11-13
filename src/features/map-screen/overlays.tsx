// Small map overlays: connect bar, drop-pin type picker, more menu, align prompt, banners.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, T } from '@/components/ui';
import { NODE_TYPE_META } from '@/domain/nodeSchemas';
import { NODE_TYPES, type ClientTemplate, type MapNode, type NodeType, type SpanKind } from '@/domain/types';
import { colors, radius, shadow, space } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const UNDERGROUND_TYPES: NodeType[] = ['handhole', 'vault', 'pedestal'];

/** Default span kind for a connection between two nodes. */
export function defaultSpanKind(a: MapNode | undefined, b: MapNode | undefined, template: ClientTemplate | null): SpanKind {
  if (!a || !b) return template?.defaultSpanKind ?? 'aerial';
  const ka = NODE_TYPE_META[a.type].defaultSpan;
  const kb = NODE_TYPE_META[b.type].defaultSpan;
  if (a.type === 'pole' && b.type === 'pole') return 'aerial';
  if (ka === kb) return ka;
  if (UNDERGROUND_TYPES.includes(a.type) || UNDERGROUND_TYPES.includes(b.type)) return 'underground';
  return template?.defaultSpanKind ?? 'aerial';
}

/** Hint/confirm bar shown in Connect mode. */
export function ConnectBar({
  from,
  to,
  kind,
  onKind,
  onConnect,
  onCancel,
  chained,
}: {
  from: MapNode | null;
  to: MapNode | null;
  kind: SpanKind;
  onKind: (k: SpanKind) => void;
  onConnect: () => void;
  onCancel: () => void;
  chained: boolean;
}) {
  return (
    <View style={styles.bar}>
      {!from ? (
        <View style={styles.row}>
          <Ionicons name="hand-left-outline" size={20} color={colors.accent} />
          <T v="heading" style={{ flex: 1 }}>
            Tap the first node
          </T>
          <Button title="Cancel" kind="ghost" compact onPress={onCancel} />
        </View>
      ) : !to ? (
        <View style={styles.row}>
          <Ionicons name="git-commit-outline" size={20} color={colors.accent} />
          <T v="heading" style={{ flex: 1 }}>
            {chained ? `Connected. Tap the next node after ${from.label}` : `From ${from.label}: tap the second node`}
          </T>
          <Button title="Done" kind="ghost" compact onPress={onCancel} />
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <T v="heading">
            {from.label} to {to.label}
          </T>
          <View style={styles.row}>
            <KindBtn label="Aerial" on={kind === 'aerial'} color={colors.aerial} onPress={() => onKind('aerial')} />
            <KindBtn label="Underground" on={kind === 'underground'} color={colors.underground} onPress={() => onKind('underground')} />
          </View>
          <View style={styles.row}>
            <Button title="Cancel" kind="secondary" compact onPress={onCancel} style={{ flex: 1 }} />
            <Button title="Connect" icon="checkmark" onPress={onConnect} style={{ flex: 2 }} />
          </View>
        </View>
      )}
    </View>
  );
}

function KindBtn({ label, on, color, onPress }: { label: string; on: boolean; color: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.kind,
        { borderColor: color, backgroundColor: on ? color : 'transparent', opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <T v="heading" color={on ? colors.onAccent : colors.text}>
        {label}
      </T>
    </Pressable>
  );
}

/** Type picker after a long-press on the map ("drop pin here"). */
export function DropPinSheet({
  visible,
  initialType,
  onPick,
  onCancel,
}: {
  visible: boolean;
  initialType: NodeType;
  onPick: (t: NodeType) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel="Cancel drop pin" />
      <View style={[styles.dropSheet, { paddingBottom: insets.bottom + space.lg }]}>
        <T v="title">Drop a node here</T>
        <T v="caption" color={colors.textMuted}>
          No photo. Placed where you pressed. Pick the type:
        </T>
        <View style={styles.grid}>
          {NODE_TYPES.map((t) => {
            const meta = NODE_TYPE_META[t];
            const on = t === initialType;
            return (
              <Pressable
                key={t}
                accessibilityRole="button"
                onPress={() => onPick(t)}
                style={({ pressed }) => [
                  styles.typeTile,
                  { borderColor: on ? meta.color : colors.border, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <View style={[styles.typeBadge, { backgroundColor: meta.color }]}>
                  <T v="caption" color={colors.onAccent} style={{ fontWeight: '900' }}>
                    {meta.short}
                  </T>
                </View>
                <T v="label" numberOfLines={1}>
                  {meta.label}
                </T>
              </Pressable>
            );
          })}
        </View>
        <Button title="Cancel" kind="ghost" onPress={onCancel} />
      </View>
    </Modal>
  );
}

export interface MenuItem {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
}

/** Overflow menu anchored top-right. */
export function MoreMenu({ visible, items, onClose }: { visible: boolean; items: MenuItem[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrimLight} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={[styles.menu, { top: insets.top + 64 }]}>
        {items.map((it, i) => (
          <Pressable
            key={i}
            accessibilityRole="menuitem"
            onPress={() => {
              onClose();
              it.onPress();
            }}
            style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' }]}
          >
            <Ionicons name={it.icon} size={22} color={it.danger ? colors.danger : it.active ? colors.accent : colors.text} />
            <View style={{ flex: 1 }}>
              <T v="heading" color={it.danger ? colors.danger : colors.text}>
                {it.label}
              </T>
              {it.hint ? (
                <T v="caption" color={colors.textMuted}>
                  {it.hint}
                </T>
              ) : null}
            </View>
            {it.active != null ? (
              <Ionicons name={it.active ? 'toggle' : 'toggle-outline'} size={28} color={it.active ? colors.accent : colors.textFaint} />
            ) : null}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

/** Generic floating prompt card above the bottom controls. */
export function PromptCard({
  icon,
  title,
  body,
  actions,
}: {
  icon: IconName;
  title: string;
  body?: string;
  actions: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'ghost' | 'danger' }[];
}) {
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Ionicons name={icon} size={22} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <T v="heading">{title}</T>
          {body ? (
            <T v="caption" color={colors.textMuted}>
              {body}
            </T>
          ) : null}
        </View>
      </View>
      <View style={[styles.row, { marginTop: space.sm, flexWrap: 'wrap' }]}>
        {actions.map((a) => (
          <Button key={a.label} title={a.label} compact kind={a.kind ?? 'secondary'} onPress={a.onPress} style={{ flexGrow: 1 }} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: space.md,
    ...shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kind: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  scrimLight: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.25)' },
  dropSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  typeTile: {
    width: '31%',
    flexGrow: 1,
    minHeight: 72,
    borderRadius: radius.md,
    borderWidth: 2,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: space.sm,
  },
  typeBadge: { minWidth: 34, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  menu: {
    position: 'absolute',
    right: space.md,
    width: 300,
    maxWidth: '92%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.xs,
    ...shadow.card,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 56, paddingVertical: space.sm },
});
