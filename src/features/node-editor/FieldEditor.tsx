// Dynamic field editor driven by FieldDef (nodeSchemas). Text and numbers commit on blur/submit
// so the store is not written on every keystroke. AI-filled values show a confidence badge and a
// tap-to-accept that marks the value reviewed.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Chip, ConfidenceBadge, T } from '@/components/ui';
import type { FieldDef } from '@/domain/nodeSchemas';
import type { AiFieldMeta, FieldValue } from '@/domain/types';
import { tapHaptic } from '@/features/common/haptics';
import { colors, radius, space, TOUCH } from '@/theme';

const UNIT_SUFFIX: Record<NonNullable<FieldDef['unit']>, string> = { ft: 'ft', in: 'in', count: '', pct: '%' };

export function FieldEditor({
  def,
  value,
  meta,
  onChange,
  onAccept,
  required,
}: {
  def: FieldDef;
  value: FieldValue | undefined;
  meta?: AiFieldMeta;
  onChange: (v: FieldValue) => void;
  onAccept?: () => void;
  required?: boolean;
}) {
  const fromAi = meta?.source === 'ai';
  const missing = required && (value == null || value === '');
  return (
    <View style={[styles.wrap, fromAi && styles.aiWrap]}>
      <View style={styles.labelRow}>
        <T v="label" color={missing ? colors.warning : colors.textMuted} style={{ flexShrink: 1 }}>
          {def.label}
          {required ? ' *' : ''}
        </T>
        {fromAi && meta ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Accept AI value for ${def.label}`}
            onPress={() => {
              tapHaptic();
              onAccept?.();
            }}
            style={({ pressed }) => [styles.accept, { opacity: pressed ? 0.7 : 1 }]}
            hitSlop={8}
          >
            <ConfidenceBadge confidence={meta.confidence} estimate={meta.isEstimate} />
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
            <T v="caption" color={colors.success}>
              Accept
            </T>
          </Pressable>
        ) : meta?.source === 'manual' ? (
          <Ionicons name="checkmark-done" size={16} color={colors.success} />
        ) : null}
      </View>
      <Control def={def} value={value} onChange={onChange} />
      {fromAi && meta?.note ? (
        <T v="caption" color={colors.textFaint}>
          AI: {meta.note}
        </T>
      ) : def.help ? (
        <T v="caption" color={colors.textFaint}>
          {def.help}
        </T>
      ) : null}
    </View>
  );
}

function Control({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
}) {
  switch (def.kind) {
    case 'boolean':
      return (
        <View style={styles.chips}>
          <Chip
            label="Yes"
            icon="checkmark"
            selected={value === true}
            onPress={() => onChange(value === true ? null : true)}
          />
          <Chip
            label="No"
            icon="close"
            selected={value === false}
            color={colors.textMuted}
            onPress={() => onChange(value === false ? null : false)}
          />
        </View>
      );
    case 'select':
      return (
        <View style={styles.chips}>
          {(def.options ?? []).map((o) => (
            <Chip key={o} label={o} selected={value === o} onPress={() => onChange(value === o ? null : o)} />
          ))}
          {typeof value === 'string' && value && !(def.options ?? []).includes(value) ? (
            <Chip label={value} selected onPress={() => onChange(null)} />
          ) : null}
        </View>
      );
    case 'number':
      return <TextControl def={def} value={value} numeric onChange={onChange} />;
    default:
      return <TextControl def={def} value={value} onChange={onChange} />;
  }
}

function toText(v: FieldValue | undefined): string {
  if (v == null) return '';
  return String(v);
}

function TextControl({
  def,
  value,
  numeric,
  onChange,
}: {
  def: FieldDef;
  value: FieldValue | undefined;
  numeric?: boolean;
  onChange: (v: FieldValue) => void;
}) {
  const [text, setText] = useState(toText(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(toText(value));
  }, [value, focused]);

  const commit = () => {
    const t = text.trim();
    let next: FieldValue;
    if (numeric) {
      if (t === '') next = null;
      else {
        const n = Number(t.replace(/,/g, ''));
        next = Number.isFinite(n) ? n : value ?? null;
        if (!Number.isFinite(n)) setText(toText(value));
      }
    } else {
      next = t === '' ? null : t;
    }
    if (next !== (value ?? null)) onChange(next);
  };

  const suffix = def.unit ? UNIT_SUFFIX[def.unit] : '';
  return (
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
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        returnKeyType="done"
        placeholder={numeric ? '0' : def.label}
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        accessibilityLabel={def.label}
      />
      {suffix ? (
        <T v="label" color={colors.textMuted} style={{ paddingHorizontal: space.md }}>
          {suffix}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs, paddingVertical: space.sm },
  aiWrap: {
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
    paddingLeft: space.sm,
    marginLeft: -space.sm - 3,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, minHeight: 24 },
  accept: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, minWidth: 0, minHeight: TOUCH - 4, paddingHorizontal: space.md, color: colors.text, fontSize: 16 },
});
