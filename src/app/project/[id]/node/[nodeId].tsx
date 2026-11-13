// Node editor: photos, type, label (voice), schema-driven fields with AI confidence, AI status,
// GPS details and recalibration, notes (voice), mark reviewed, delete.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCanEdit } from '@/backend/authStore';
import { Button, Card, SectionTitle, T } from '@/components/ui';
import { NODE_SCHEMAS, NODE_TYPE_META } from '@/domain/nodeSchemas';
import type { NodeType } from '@/domain/types';
import { pickFromLibrary, takeWithSystemCamera, type PickedPhoto } from '@/features/capture/pickPhoto';
import { TypeChips } from '@/features/capture/TypeChips';
import { confirmAsync, errorMessage } from '@/features/common/confirm';
import {
  accuracyColor,
  formatAccuracy,
  formatDateTime,
  formatLatLng,
  sourceLabel,
  typeLabel,
} from '@/features/common/format';
import { successHaptic } from '@/features/common/haptics';
import { goBackOr, ScreenHeader } from '@/features/common/ScreenHeader';
import { useToast } from '@/features/common/Toast';
import { ensureAiConsent } from '@/features/consent/AiConsentDialog';
import { RecalibratePanel } from '@/features/gps/RecalibratePanel';
import { useRecalibrate } from '@/features/gps/useRecalibrate';
import { aiSummary, friendlyAiError } from '@/features/map-screen/aiStatus';
import { changeTypePatch } from '@/features/node-editor/changeType';
import { FieldEditor } from '@/features/node-editor/FieldEditor';
import { PhotoStrip } from '@/features/node-editor/PhotoStrip';
import { setPrimaryPhoto } from '@/features/node-editor/photoActions';
import { MicButton } from '@/features/voice/MicButton';
import { WatermarkQueue } from '@/features/watermark/WatermarkQueue';
import { getQuickFix } from '@/geo/gpsSampler';
import { useStore } from '@/state/store';
import { colors, font, radius, space, TOUCH } from '@/theme';

export default function NodeEditorScreen() {
  const { id, nodeId } = useLocalSearchParams<{ id: string; nodeId: string }>();
  const insets = useSafeAreaInsets();
  const toast = useToast({ bottom: insets.bottom + 40 });

  const node = useStore((s) => s.nodes.find((n) => n.id === nodeId) ?? null);
  const allPhotos = useStore((s) => s.photos);
  const photos = useMemo(() => allPhotos.filter((p) => p.nodeId === nodeId), [allPhotos, nodeId]);
  const project = useStore((s) => s.projects.find((p) => p.id === id) ?? null);
  const templates = useStore((s) => s.templates);
  const settings = useStore((s) => s.settings);
  const aiError = useStore((s) => (nodeId ? s.aiErrors[nodeId] : undefined));
  const activeProjectId = useStore((s) => s.activeProjectId);
  const { updateNode, setNodeField, deleteNode, runAi, addPhotoToNode } = useStore.getState();
  const template = project?.templateId ? templates.find((t) => t.id === project.templateId) ?? null : null;
  const recal = useRecalibrate();
  const units = settings.units;
  // Viewers see every value but cannot change anything. Local projects (no orgId) are always editable.
  const canEdit = useCanEdit(project ? project.orgId ?? null : null);
  const readOnly = !canEdit;

  // Deep link support: open the project if needed.
  const [opening, setOpening] = useState(activeProjectId !== id);
  useEffect(() => {
    if (!id || useStore.getState().activeProjectId === id) {
      setOpening(false);
      return;
    }
    (async () => {
      const st = useStore.getState();
      if (!st.ready) await st.init();
      await useStore.getState().openProject(id);
    })()
      .catch(() => {})
      .finally(() => setOpening(false));
  }, [id]);

  const [label, setLabel] = useState(node?.label ?? '');
  const [notes, setNotes] = useState(node?.notes ?? '');
  const [labelFocused, setLabelFocused] = useState(false);
  const [notesFocused, setNotesFocused] = useState(false);
  const [suggestType, setSuggestType] = useState<NodeType | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (node && !labelFocused) setLabel(node.label);
  }, [node?.label, labelFocused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (node && !notesFocused) setNotes(node.notes);
  }, [node?.notes, notesFocused]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = () => goBackOr(`/project/${id}`);

  if (!node) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Node" onBack={back} />
        <View style={styles.center}>
          {opening ? <ActivityIndicator color={colors.accent} /> : <T color={colors.textMuted}>This node no longer exists.</T>}
        </View>
      </View>
    );
  }

  const schema = NODE_SCHEMAS[node.type];
  const required = new Set(template?.requiredFields[node.type] ?? []);
  const ai = aiSummary(node);
  const hasPhoto = photos.length > 0;

  const commitLabel = (v = label) => {
    const t = v.trim();
    if (t && t !== node.label) void updateNode(node.id, { label: t });
    else if (!t) setLabel(node.label);
  };
  const commitNotes = (v = notes) => {
    if (v !== node.notes) void updateNode(node.id, { notes: v });
  };

  const changeType = (t: NodeType) => {
    if (t === node.type) return;
    void updateNode(node.id, changeTypePatch(node, t, template, project?.jobNumber ?? ''));
    setSuggestType(null);
  };

  const addPhoto = async (source: 'camera' | 'library') => {
    setAdding(true);
    try {
      const picked: PickedPhoto | null = source === 'camera' ? await takeWithSystemCamera() : await pickFromLibrary();
      if (!picked) return;
      const fix = picked.exifFix ?? (await getQuickFix());
      await addPhotoToNode(node.id, picked.uri, picked.width, picked.height, fix);
      successHaptic();
      toast.show('Photo added.', { kind: 'success' });
    } catch (e) {
      toast.show(`Could not add photo: ${errorMessage(e)}`, { kind: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const runAiNow = async () => {
    // Asks for AI consent first on installs that turned AI on before consent existed.
    if (!(await ensureAiConsent())) return;
    void runAi(node.id);
  };

  const remove = async () => {
    const ok = await confirmAsync(`Delete ${node.label}?`, 'The node, its photos and any connected spans will be removed.', {
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteNode(node.id);
    back();
  };

  const p = node.position;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <WatermarkQueue />
      <ScreenHeader
        title={node.label}
        subtitle={`${typeLabel(node.type)}  |  #${node.seq}${project ? `  |  ${project.name}` : ''}`}
        onBack={back}
        right={
          readOnly ? (
            <View style={styles.reviewedTag}>
              <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
              <T v="caption" color={colors.textMuted}>
                View only
              </T>
            </View>
          ) : node.status === 'reviewed' ? (
            <View style={styles.reviewedTag}>
              <Ionicons name="checkmark-done" size={16} color={colors.success} />
              <T v="caption" color={colors.success}>
                Reviewed
              </T>
            </View>
          ) : null
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
          keyboardShouldPersistTaps="handled"
        >
          <PhotoStrip
            photos={photos}
            adding={adding}
            readOnly={readOnly}
            onAddCamera={() => void addPhoto('camera')}
            onAddLibrary={() => void addPhoto('library')}
            onSetPrimary={(photoId) => void setPrimaryPhoto(node.id, photoId).catch((e) => toast.show(errorMessage(e), { kind: 'error' }))}
          />

          <SectionTitle>Type</SectionTitle>
          {readOnly ? (
            <T v="heading">{NODE_TYPE_META[node.type].label}</T>
          ) : (
            <View style={{ marginHorizontal: -space.md }}>
              <TypeChips value={node.type} onChange={changeType} dense />
            </View>
          )}

          <SectionTitle>Label</SectionTitle>
          <View style={styles.inputRow}>
            <TextInput
              value={label}
              onChangeText={setLabel}
              onFocus={() => setLabelFocused(true)}
              onBlur={() => {
                setLabelFocused(false);
                commitLabel();
              }}
              onSubmitEditing={() => commitLabel()}
              editable={!readOnly}
              style={[styles.input, styles.labelInput]}
              placeholder="Label"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
              returnKeyType="done"
              accessibilityLabel="Label"
            />
            {readOnly ? null : (
              <MicButton
                label="Speak label"
                onResult={(_t, parsed) => {
                  if (parsed.type && parsed.type !== node.type) setSuggestType(parsed.type);
                  if (parsed.rest) {
                    const v = parsed.rest.toUpperCase();
                    setLabel(v);
                    commitLabel(v);
                  }
                }}
              />
            )}
          </View>
          {suggestType ? (
            <View style={styles.suggest}>
              <T v="label" style={{ flex: 1 }}>
                Heard "{NODE_TYPE_META[suggestType].label}". Change type?
              </T>
              <Button title="Change" compact onPress={() => changeType(suggestType)} />
              <Button title="No" compact kind="ghost" onPress={() => setSuggestType(null)} />
            </View>
          ) : null}

          {hasPhoto ? (
            <>
              <SectionTitle>AI</SectionTitle>
              <Card style={{ gap: space.sm }}>
                {node.status === 'ai_pending' ? (
                  <View style={styles.row}>
                    <ActivityIndicator color={colors.info} />
                    <T>AI is reading the photo...</T>
                  </View>
                ) : node.status === 'ai_failed' ? (
                  <View style={styles.row}>
                    <Ionicons name="cloud-offline-outline" size={20} color={colors.warning} />
                    <T style={{ flex: 1 }}>{friendlyAiError(aiError)}</T>
                  </View>
                ) : ai.filled > 0 ? (
                  <>
                    <View style={styles.row}>
                      <Ionicons name="sparkles" size={20} color={colors.success} />
                      <T v="heading" style={{ flex: 1 }}>
                        Filled {ai.filled} field{ai.filled === 1 ? '' : 's'}
                        {ai.avgConfidence != null ? `, avg ${Math.round(ai.avgConfidence * 100)}% confidence` : ''}
                      </T>
                    </View>
                    {ai.estimates > 0 ? (
                      <T v="caption" color={colors.warning}>
                        {ai.estimates} value{ai.estimates === 1 ? ' is a visual estimate' : 's are visual estimates'} (marked "est."). A height stick in frame
                        improves heights.
                      </T>
                    ) : null}
                    {ai.lowConfidence.length > 0 ? (
                      <T v="caption" color={colors.warning}>
                        Low confidence: {ai.lowConfidence.map((k) => schema.find((f) => f.key === k)?.label ?? k).join(', ')}
                      </T>
                    ) : null}
                    {readOnly ? null : (
                      <T v="caption" color={colors.textMuted}>
                        Tap Accept on a field to confirm it, or edit it to override.
                      </T>
                    )}
                  </>
                ) : null}
                {node.aiReport && !aiError ? (
                  <View style={{ gap: 6 }}>
                    {node.aiReport.summary ? <T>{node.aiReport.summary}</T> : null}
                    {node.aiReport.detectedType !== node.type && node.aiReport.typeConfidence >= 0.6 ? (
                      <T v="caption" color={colors.warning}>
                        AI thinks this looks like a {node.aiReport.detectedType.replace('_', ' ')} (
                        {Math.round(node.aiReport.typeConfidence * 100)}%). Change the type above if that is right.
                      </T>
                    ) : null}
                    {node.aiReport.warnings.map((w, i) => (
                      <View key={i} style={styles.row}>
                        <Ionicons name="warning-outline" size={16} color={colors.warning} />
                        <T v="caption" color={colors.warning} style={{ flex: 1 }}>
                          {w}
                        </T>
                      </View>
                    ))}
                  </View>
                ) : null}
                {!aiError && ai.filled === 0 && !node.aiReport ? (
                  <T v="caption" color={colors.textMuted}>
                    {settings.aiMode === 'off'
                      ? 'AI field fill is off. Turn it on in Settings.'
                      : node.status === 'ai_done'
                        ? 'AI found nothing it could fill confidently.'
                        : 'Not analyzed yet.'}
                  </T>
                ) : null}
                {!readOnly && settings.aiMode !== 'off' && node.status !== 'ai_pending' ? (
                  <Button
                    title={node.status === 'ai_failed' ? 'Retry AI' : ai.filled > 0 ? 'Run AI again' : 'Run AI'}
                    icon="sparkles"
                    kind="secondary"
                    compact
                    onPress={() => void runAiNow()}
                  />
                ) : null}
              </Card>
            </>
          ) : null}

          <SectionTitle>{NODE_TYPE_META[node.type].label} details</SectionTitle>
          <Card style={{ paddingVertical: space.sm }}>
            {schema.map((def) => (
              <FieldEditor
                key={def.key}
                def={def}
                value={node.fields[def.key]}
                meta={node.aiMeta[def.key]}
                required={required.has(def.key)}
                readOnly={readOnly}
                onChange={(v) => void setNodeField(node.id, def.key, v)}
                onAccept={() => void setNodeField(node.id, def.key, node.fields[def.key] ?? null)}
              />
            ))}
          </Card>

          <SectionTitle>Notes</SectionTitle>
          <View style={[styles.inputRow, { alignItems: 'flex-start' }]}>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              onFocus={() => setNotesFocused(true)}
              onBlur={() => {
                setNotesFocused(false);
                commitNotes();
              }}
              multiline
              editable={!readOnly}
              style={[styles.input, { minHeight: 96, paddingTop: space.md, textAlignVertical: 'top' }]}
              placeholder={readOnly ? 'No notes' : 'Anything the office should know'}
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="Notes"
            />
            {readOnly ? null : (
              <MicButton
                label="Speak notes"
                onResult={(text) => {
                  const v = notes ? `${notes} ${text}` : text;
                  setNotes(v);
                  commitNotes(v);
                }}
              />
            )}
          </View>

          <SectionTitle>GPS</SectionTitle>
          <Card style={{ gap: space.sm }}>
            <View style={styles.gpsGrid}>
              <Kv k="Latitude" v={formatLatLng(p.lat)} mono />
              <Kv k="Longitude" v={formatLatLng(p.lng)} mono />
              <Kv k="Accuracy" v={formatAccuracy(p.accuracyM, units)} color={accuracyColor(p.accuracyM)} mono />
              <Kv k="Samples" v={String(p.samples)} mono />
              <Kv k="Source" v={sourceLabel(p)} />
              <Kv k="Captured" v={formatDateTime(p.capturedAt)} />
              {p.altitudeM != null ? <Kv k="Altitude" v={units === 'metric' ? `${p.altitudeM.toFixed(1)} m` : `${Math.round(p.altitudeM / 0.3048)} ft`} mono /> : null}
            </View>
            {readOnly ? null : (
              <RecalibratePanel
                nodeId={node.id}
                recal={recal}
                units={units}
                onDone={(ok) => ok && toast.show('Position updated.', { kind: 'success' })}
              />
            )}
          </Card>

          <View style={{ gap: space.sm, marginTop: space.xl }}>
            {!readOnly && node.status !== 'reviewed' ? (
              <Button
                title="Mark reviewed"
                icon="checkmark-done"
                onPress={async () => {
                  await updateNode(node.id, { status: 'reviewed' });
                  successHaptic();
                  toast.show(`${node.label} marked reviewed.`, { kind: 'success' });
                }}
              />
            ) : null}
            <Button title="Back to map" icon="map-outline" kind="secondary" onPress={() => router.navigate(`/project/${id}` as never)} />
            {readOnly ? null : <Button title="Delete node" icon="trash-outline" kind="ghost" onPress={remove} />}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {toast.node}
    </View>
  );
}

function Kv({ k, v, mono, color }: { k: string; v: string; mono?: boolean; color?: string }) {
  return (
    <View style={styles.kv}>
      <T v="caption" color={colors.textMuted}>
        {k}
      </T>
      <T v="body" color={color ?? colors.text} style={mono ? font.mono : undefined}>
        {v}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.md, maxWidth: 760, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
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
  labelInput: { fontSize: 20, fontWeight: '800' },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  reviewedTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gpsGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm },
  kv: { width: '50%', gap: 2 },
});
