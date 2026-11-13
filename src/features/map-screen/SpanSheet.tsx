// Selected span sheet: footage breakdown, kind, sag, slack, measured override, span fields.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Segmented, T } from '@/components/ui';
import { SPAN_FIELDS } from '@/domain/nodeSchemas';
import type { MapNode, SpanKind, SpanWithLength } from '@/domain/types';
import { confirmAsync } from '@/features/common/confirm';
import type { Units } from '@/features/common/format';
import { Stepper } from '@/features/common/Stepper';
import { FieldEditor } from '@/features/node-editor/FieldEditor';
import { BottomSheet, type SheetSnap } from '@/features/sheets/BottomSheet';
import { formatLength } from '@/geo';
import { useStore } from '@/state/store';
import { colors, font, radius, space, TOUCH } from '@/theme';

export function SpanSheet({
  span,
  nodesById,
  units,
  snap,
  onSnapChange,
  onClose,
  onSelectNode,
}: {
  span: SpanWithLength | null;
  nodesById: Map<string, MapNode>;
  units: Units;
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  onClose: () => void;
  onSelectNode: (id: string) => void;
}) {
  const updateSpan = useStore((s) => s.updateSpan);
  const deleteSpan = useStore((s) => s.deleteSpan);

  if (!span) return <BottomSheet visible={false} snap={snap} onSnapChange={onSnapChange} onClose={onClose} />;

  const from = nodesById.get(span.fromNodeId);
  const to = nodesById.get(span.toNodeId);
  const kindColor = span.kind === 'aerial' ? colors.aerial : colors.underground;

  const header = (
    <View style={{ gap: space.sm }}>
      <View style={styles.headRow}>
        <View style={[styles.kindIcon, { borderColor: kindColor }]}>
          <Ionicons name={span.kind === 'aerial' ? 'git-commit-outline' : 'remove-outline'} size={22} color={kindColor} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.fromTo}>
            <Pressable onPress={() => from && onSelectNode(from.id)} accessibilityRole="button">
              <T v="title">{from?.label ?? '?'}</T>
            </Pressable>
            <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
            <Pressable onPress={() => to && onSelectNode(to.id)} accessibilityRole="button">
              <T v="title">{to?.label ?? '?'}</T>
            </Pressable>
          </View>
          <T v="caption" color={colors.textMuted}>
            {span.kind === 'aerial' ? 'Aerial span' : 'Underground run'}
          </T>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={22} color={colors.textMuted} />
        </Pressable>
      </View>
      <View style={styles.numbers}>
        <Num label="Straight" value={formatLength(span.straightFt, units)} />
        <Num label="Cable total" value={formatLength(span.totalFt, units)} strong color={kindColor} />
        {span.lengthOverrideFt != null ? <Num label="Source" value="Measured" /> : <Num label="Source" value="GPS" />}
      </View>
    </View>
  );

  return (
    <BottomSheet visible snap={snap} onSnapChange={onSnapChange} onClose={onClose} header={header} peekHeight={176}>
      <View style={{ gap: space.md, paddingTop: space.sm }}>
        <Segmented<SpanKind>
          value={span.kind}
          onChange={(kind) => {
            if (kind === span.kind) return;
            // Underground runs have no sag; aerial gets the usual 2% unless one is already set.
            const sagPct = kind === 'underground' ? 0 : span.sagPct > 0 ? span.sagPct : 2;
            void updateSpan(span.id, { kind, sagPct });
          }}
          options={[
            { value: 'aerial', label: 'Aerial', icon: 'git-commit-outline' },
            { value: 'underground', label: 'Underground', icon: 'remove-outline' },
          ]}
        />
        <Stepper
          label="Sag allowance"
          value={span.sagPct}
          min={0}
          max={10}
          step={0.5}
          format={(v) => `${v}%`}
          onChange={(v) => void updateSpan(span.id, { sagPct: v })}
        />
        <NumberRow
          label="Slack / storage loops"
          suffix="ft"
          value={span.slackFt}
          allowEmpty={false}
          onCommit={(v) => void updateSpan(span.id, { slackFt: v ?? 0 })}
        />
        <NumberRow
          label="Measured footage (wheel / sequential)"
          suffix="ft"
          value={span.lengthOverrideFt}
          allowEmpty
          placeholder="Use GPS"
          hint="Overrides the GPS length. Clear it to go back to GPS footage."
          onCommit={(v) => void updateSpan(span.id, { lengthOverrideFt: v })}
        />

        <T v="label" color={colors.textMuted} style={{ marginTop: space.sm }}>
          SPAN DETAILS
        </T>
        {SPAN_FIELDS.map((def) => (
          <FieldEditor
            key={def.key}
            def={def}
            value={span.fields[def.key]}
            onChange={(v) => void updateSpan(span.id, { fields: { ...span.fields, [def.key]: v } })}
          />
        ))}

        <Button
          title="Delete span"
          icon="trash-outline"
          kind="ghost"
          onPress={async () => {
            const ok = await confirmAsync('Delete span?', `Removes the line between ${from?.label ?? '?'} and ${to?.label ?? '?'}.`, {
              confirmText: 'Delete',
              destructive: true,
            });
            if (ok) {
              await deleteSpan(span.id);
              onClose();
            }
          }}
        />
      </View>
    </BottomSheet>
  );
}

function Num({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <T v={strong ? 'title' : 'heading'} color={color ?? colors.text} style={font.mono} numberOfLines={1}>
        {value}
      </T>
      <T v="caption" color={colors.textMuted}>
        {label}
      </T>
    </View>
  );
}

function NumberRow({
  label,
  suffix,
  value,
  onCommit,
  allowEmpty,
  placeholder,
  hint,
}: {
  label: string;
  suffix: string;
  value: number | null;
  onCommit: (v: number | null) => void;
  allowEmpty: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value == null ? '' : String(value));
  }, [value, focused]);
  const commit = () => {
    const t = text.trim().replace(/,/g, '');
    if (t === '') {
      if (allowEmpty) onCommit(null);
      else onCommit(0);
      return;
    }
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) onCommit(n);
    else setText(value == null ? '' : String(value));
  };
  return (
    <View style={{ gap: space.xs }}>
      <T v="label" color={colors.textMuted}>
        {label}
      </T>
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onSubmitEditing={commit}
          keyboardType="decimal-pad"
          returnKeyType="done"
          placeholder={placeholder ?? '0'}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          accessibilityLabel={label}
        />
        {allowEmpty && text !== '' ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => { setText(''); onCommit(null); }} style={styles.clear}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
        <T v="label" color={colors.textMuted} style={{ paddingHorizontal: space.md }}>
          {suffix}
        </T>
      </View>
      {hint ? (
        <T v="caption" color={colors.textFaint}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  kindIcon: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  fromTo: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  numbers: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, minWidth: 0, minHeight: TOUCH - 4, paddingHorizontal: space.md, color: colors.text, fontSize: 16 },
  clear: { padding: space.sm },
});
