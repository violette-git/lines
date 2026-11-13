// Compact post-shutter card: confirm or fix the label, add notes by voice, then Next / Done.
// It slides up over the camera so the user never leaves the capture loop.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, T } from '@/components/ui';
import { NODE_TYPE_META } from '@/domain/nodeSchemas';
import type { MapNode, NodeType } from '@/domain/types';
import { formatAccuracy, accuracyColor, type Units } from '@/features/common/format';
import { MicButton } from '@/features/voice/MicButton';
import { colors, font, radius, shadow, space, TOUCH } from '@/theme';

export interface CaptureDraft {
  label: string;
  notes: string;
}

export function ConfirmCard({
  node,
  photoUri,
  draft,
  onDraft,
  savedInMs,
  units,
  onNext,
  onDone,
  onRetake,
  onChangeType,
}: {
  node: MapNode;
  photoUri: string | null;
  draft: CaptureDraft;
  onDraft: (d: CaptureDraft) => void;
  savedInMs: number | null;
  units: Units;
  onNext: () => void;
  onDone: () => void;
  onRetake: () => void;
  onChangeType: (t: NodeType) => void;
}) {
  const slide = useRef(new Animated.Value(0)).current;
  const [suggestType, setSuggestType] = useState<NodeType | null>(null);
  const [showNotes, setShowNotes] = useState(draft.notes.length > 0);

  useEffect(() => {
    slide.setValue(0);
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, friction: 9, tension: 90 }).start();
    setSuggestType(null);
  }, [node.id, slide]);

  const meta = NODE_TYPE_META[node.type];
  const acc = node.position.accuracyM;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }],
        },
      ]}
    >
      <View style={styles.topRow}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="location" size={22} color={meta.color} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.metaRow}>
            <View style={[styles.typePill, { backgroundColor: meta.color }]}>
              <T v="caption" color={colors.onAccent} style={{ fontWeight: '800' }}>
                {meta.label}
              </T>
            </View>
            <T v="caption" color={accuracyColor(acc)} style={font.mono}>
              {formatAccuracy(acc, units)}
            </T>
            {node.status === 'ai_pending' ? (
              <View style={styles.aiRow}>
                <ActivityIndicator size="small" color={colors.info} />
                <T v="caption" color={colors.info}>
                  AI reading
                </T>
              </View>
            ) : node.status === 'ai_done' ? (
              <View style={styles.aiRow}>
                <Ionicons name="sparkles" size={13} color={colors.success} />
                <T v="caption" color={colors.success}>
                  AI filled
                </T>
              </View>
            ) : null}
          </View>
          {savedInMs != null ? (
            <T v="caption" color={colors.textFaint}>
              Saved in {savedInMs < 1000 ? `${savedInMs} ms` : `${(savedInMs / 1000).toFixed(1)} s`}
            </T>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retake: delete this node"
          onPress={onRetake}
          style={({ pressed }) => [styles.retake, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <T v="caption" color={colors.danger}>
            Retake
          </T>
        </Pressable>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          value={draft.label}
          onChangeText={(label) => onDraft({ ...draft, label })}
          placeholder="Label"
          placeholderTextColor={colors.textFaint}
          style={[styles.input, styles.labelInput]}
          selectTextOnFocus
          returnKeyType="done"
          autoCapitalize="characters"
          accessibilityLabel="Node label"
        />
        <MicButton
          label="Speak label"
          onResult={(_text, parsed) => {
            if (parsed.type && parsed.type !== node.type) setSuggestType(parsed.type);
            if (parsed.rest) onDraft({ ...draft, label: parsed.rest.toUpperCase() });
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add notes"
          onPress={() => setShowNotes((v) => !v)}
          style={({ pressed }) => [styles.noteToggle, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name={showNotes ? 'document-text' : 'document-text-outline'} size={20} color={colors.text} />
        </Pressable>
      </View>

      {suggestType ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onChangeType(suggestType);
            setSuggestType(null);
          }}
          style={({ pressed }) => [styles.suggest, { opacity: pressed ? 0.8 : 1 }]}
        >
          <Ionicons name="swap-horizontal" size={16} color={colors.accent} />
          <T v="label" color={colors.accent}>
            Heard "{NODE_TYPE_META[suggestType].label}". Change type?
          </T>
        </Pressable>
      ) : null}

      {showNotes ? (
        <View style={styles.inputRow}>
          <TextInput
            value={draft.notes}
            onChangeText={(notes) => onDraft({ ...draft, notes })}
            placeholder="Notes (optional)"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, { minHeight: 48 }]}
            multiline
            accessibilityLabel="Node notes"
          />
          <MicButton
            label="Speak notes"
            onResult={(text) => onDraft({ ...draft, notes: draft.notes ? `${draft.notes} ${text}` : text })}
          />
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button title="Done" kind="secondary" icon="map-outline" onPress={onDone} style={{ flex: 1 }} />
        <Button title="Next" icon="camera" onPress={onNext} style={{ flex: 1.4 }} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
    ...shadow.card,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  typePill: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  retake: { alignItems: 'center', justifyContent: 'center', minWidth: TOUCH, minHeight: TOUCH - 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: TOUCH,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    color: colors.text,
    fontSize: 16,
  },
  labelInput: { fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
  noteToggle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  actions: { flexDirection: 'row', gap: space.sm },
});
