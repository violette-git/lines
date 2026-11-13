// Selected node bottom sheet: photo, label, type, AI status, GPS, duplicate warning, spans, actions.
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, T } from '@/components/ui';
import { NODE_TYPE_META } from '@/domain/nodeSchemas';
import type { MapNode, PhotoRef, SpanWithLength } from '@/domain/types';
import { confirmAsync } from '@/features/common/confirm';
import { accuracyColor, formatAccuracy, sourceLabel, type Units } from '@/features/common/format';
import { Stepper } from '@/features/common/Stepper';
import { ensureAiConsent } from '@/features/consent/AiConsentDialog';
import { RecalibratePanel } from '@/features/gps/RecalibratePanel';
import { useRecalibrate } from '@/features/gps/useRecalibrate';
import { BottomSheet, type SheetSnap } from '@/features/sheets/BottomSheet';
import { formatLength } from '@/geo';
import { useStore } from '@/state/store';
import { usePhotoUri } from '@/sync';
import { colors, font, radius, space } from '@/theme';

import { aiSummary, friendlyAiError } from './aiStatus';

export function NodeSheet({
  node,
  photo,
  spans,
  nodesById,
  units,
  snap,
  onSnapChange,
  onClose,
  onEdit,
  onConnectFrom,
  onSelectSpan,
  onSelectNode,
  onDeleted,
  readOnly,
}: {
  node: MapNode | null;
  photo: PhotoRef | null;
  spans: SpanWithLength[];
  nodesById: Map<string, MapNode>;
  units: Units;
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  onClose: () => void;
  onEdit: (id: string) => void;
  onConnectFrom: (id: string) => void;
  onSelectSpan: (id: string) => void;
  onSelectNode: (id: string) => void;
  onDeleted: () => void;
  /** View-only role: details only, no editing, connecting, AI runs or deleting. */
  readOnly?: boolean;
}) {
  const aiError = useStore((s) => (node ? s.aiErrors[node.id] : undefined));
  const aiMode = useStore((s) => s.settings.aiMode);
  const runAi = useStore((s) => s.runAi);
  const updateNode = useStore((s) => s.updateNode);
  const deleteNode = useStore((s) => s.deleteNode);
  const clearDuplicateFlag = useStore((s) => s.clearDuplicateFlag);
  const recal = useRecalibrate();
  // Company photos from other phones download on demand.
  const { uri: shownUri } = usePhotoUri(photo, { watermarked: true });

  if (!node) return <BottomSheet visible={false} snap={snap} onSnapChange={onSnapChange} onClose={onClose} />;

  const meta = NODE_TYPE_META[node.type];
  const dup = node.possibleDuplicateOf ? nodesById.get(node.possibleDuplicateOf) ?? null : null;
  const connected = spans.filter((s) => s.fromNodeId === node.id || s.toNodeId === node.id);
  const ai = aiSummary(node);

  const run = () => {
    void (async () => {
      if (await ensureAiConsent()) await runAi(node.id);
    })();
  };

  const remove = async () => {
    const ok = await confirmAsync(`Delete ${node.label}?`, 'The node, its photos and any spans connected to it will be removed.', {
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteNode(node.id);
    onDeleted();
  };

  const header = (
    <View style={{ gap: space.sm }}>
      <View style={styles.headRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open details" onPress={() => onEdit(node.id)}>
          {shownUri ? (
            <Image source={{ uri: shownUri }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty]}>
              <Ionicons name="camera-outline" size={22} color={colors.textFaint} />
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <T v="title" numberOfLines={1}>
            {node.label}
          </T>
          <View style={styles.pillRow}>
            <View style={[styles.pill, { backgroundColor: meta.color }]}>
              <T v="caption" color={colors.onAccent} style={{ fontWeight: '800' }}>
                {meta.label}
              </T>
            </View>
            <StatusPill node={node} avg={ai.avgConfidence} />
            <T v="caption" color={accuracyColor(node.position.accuracyM)} style={font.mono}>
              {formatAccuracy(node.position.accuracyM, units)}
            </T>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={22} color={colors.textMuted} />
        </Pressable>
      </View>
      <View style={styles.quick}>
        {readOnly ? (
          <Button title="View details" icon="document-text-outline" kind="secondary" compact onPress={() => onEdit(node.id)} style={{ flex: 1 }} />
        ) : (
          <>
            <Button title="Edit details" icon="create-outline" compact onPress={() => onEdit(node.id)} style={{ flex: 1 }} />
            <Button title="Connect" icon="git-commit-outline" kind="secondary" compact onPress={() => onConnectFrom(node.id)} style={{ flex: 1 }} />
          </>
        )}
      </View>
    </View>
  );

  return (
    <BottomSheet visible snap={snap} onSnapChange={onSnapChange} onClose={onClose} header={header} peekHeight={168}>
      <View style={{ gap: space.md, paddingTop: space.sm }}>
        {dup ? (
          <Card style={styles.warnCard}>
            <View style={styles.row}>
              <Ionicons name="copy-outline" size={20} color={colors.warning} />
              <T v="heading" style={{ flex: 1 }}>
                Looks like the same {NODE_TYPE_META[node.type].label.toLowerCase()} as{' '}
                <T v="heading" color={colors.accent} style={{ textDecorationLine: 'underline' }}>
                  {dup.label}
                </T>
              </T>
            </View>
            {readOnly ? null : (
              <View style={styles.quick}>
                <Button title="Keep both" kind="secondary" compact onPress={() => void clearDuplicateFlag(node.id)} style={{ flex: 1 }} />
                <Button title="Delete this one" kind="danger" compact onPress={remove} style={{ flex: 1 }} />
              </View>
            )}
            <Pressable onPress={() => onSelectNode(dup.id)} accessibilityRole="button">
              <T v="caption" color={colors.textMuted}>
                Show {dup.label} on the map
              </T>
            </Pressable>
          </Card>
        ) : null}

        <AiCard
          node={node}
          hasPhoto={!!photo}
          aiMode={aiMode}
          error={aiError}
          onRun={readOnly ? undefined : run}
          summary={ai}
        />

        <View style={{ gap: space.xs }}>
          <T v="label" color={colors.textMuted}>
            SPANS
          </T>
          {connected.length === 0 ? (
            <T v="caption" color={colors.textFaint}>
              {readOnly ? 'Not connected.' : 'Not connected. Tap Connect, then tap another node.'}
            </T>
          ) : (
            connected.map((s) => {
              const otherId = s.fromNodeId === node.id ? s.toNodeId : s.fromNodeId;
              const other = nodesById.get(otherId);
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  onPress={() => onSelectSpan(s.id)}
                  style={({ pressed }) => [styles.spanRow, { opacity: pressed ? 0.75 : 1 }]}
                >
                  <View style={[styles.kindDot, { backgroundColor: s.kind === 'aerial' ? colors.aerial : colors.underground }]} />
                  <T style={{ flex: 1 }} numberOfLines={1}>
                    to {other?.label ?? '?'}
                  </T>
                  <T v="heading" style={font.mono}>
                    {formatLength(s.totalFt, units)}
                  </T>
                  <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                </Pressable>
              );
            })
          )}
        </View>

        <View style={{ gap: space.xs }}>
          <T v="label" color={colors.textMuted}>
            GPS
          </T>
          <T v="caption" color={colors.textMuted}>
            {sourceLabel(node.position)}
            {node.position.samples > 1 ? `, ${node.position.samples} samples` : ''}
          </T>
          {readOnly ? null : <RecalibratePanel nodeId={node.id} recal={recal} units={units} compact />}
        </View>

        {readOnly ? null : (
          <>
            <Stepper
              label="Icon size"
              value={node.iconScale}
              min={0.5}
              max={3}
              step={0.25}
              format={(v) => `${v.toFixed(2).replace(/0$/, '')}x`}
              onChange={(v) => void updateNode(node.id, { iconScale: v })}
            />

            <Button title="Delete node" icon="trash-outline" kind="ghost" onPress={remove} />
          </>
        )}
      </View>
    </BottomSheet>
  );
}

function StatusPill({ node, avg }: { node: MapNode; avg: number | null }) {
  switch (node.status) {
    case 'ai_pending':
      return (
        <View style={styles.status}>
          <ActivityIndicator size="small" color={colors.info} />
          <T v="caption" color={colors.info}>
            AI
          </T>
        </View>
      );
    case 'ai_failed':
      return (
        <View style={styles.status}>
          <Ionicons name="alert-circle" size={14} color={colors.warning} />
          <T v="caption" color={colors.warning}>
            AI failed
          </T>
        </View>
      );
    case 'ai_done':
      return (
        <View style={styles.status}>
          <Ionicons name="sparkles" size={13} color={colors.success} />
          <T v="caption" color={colors.success}>
            {avg != null ? `${Math.round(avg * 100)}%` : 'AI done'}
          </T>
        </View>
      );
    case 'reviewed':
      return (
        <View style={styles.status}>
          <Ionicons name="checkmark-done" size={14} color={colors.success} />
          <T v="caption" color={colors.success}>
            Reviewed
          </T>
        </View>
      );
    default:
      return null;
  }
}

function AiCard({
  node,
  hasPhoto,
  aiMode,
  error,
  onRun,
  summary,
}: {
  node: MapNode;
  hasPhoto: boolean;
  aiMode: 'off' | 'direct' | 'proxy';
  error: string | undefined;
  /** Omitted for view-only roles. */
  onRun?: () => void;
  summary: ReturnType<typeof aiSummary>;
}) {
  if (!hasPhoto) return null;
  if (node.status === 'ai_pending') {
    return (
      <Card style={styles.aiCard}>
        <ActivityIndicator color={colors.info} />
        <T style={{ flex: 1 }}>AI is reading the photo...</T>
      </Card>
    );
  }
  if (node.status === 'ai_failed') {
    return (
      <Card style={[styles.aiCard, { borderColor: colors.warning }]}>
        <Ionicons name="cloud-offline-outline" size={20} color={colors.warning} />
        <T style={{ flex: 1 }} v="caption">
          {friendlyAiError(error)}
        </T>
        {onRun ? <Button title="Retry" icon="refresh" compact kind="secondary" onPress={onRun} /> : null}
      </Card>
    );
  }
  if (summary.filled > 0) {
    return (
      <Card style={styles.aiCard}>
        <Ionicons name="sparkles" size={20} color={colors.success} />
        <View style={{ flex: 1 }}>
          <T v="heading">
            AI filled {summary.filled} field{summary.filled === 1 ? '' : 's'}
            {summary.avgConfidence != null ? `, avg ${Math.round(summary.avgConfidence * 100)}%` : ''}
          </T>
          <T v="caption" color={colors.textMuted}>
            {summary.estimates > 0 ? `${summary.estimates} visual estimate${summary.estimates === 1 ? '' : 's'}. ` : ''}
            {summary.lowConfidence.length > 0 ? `${summary.lowConfidence.length} low confidence, check them. ` : ''}
            {onRun ? 'Review in Edit details.' : ''}
          </T>
        </View>
        {onRun ? <Button title="Re-run" compact kind="ghost" onPress={onRun} /> : null}
      </Card>
    );
  }
  if (aiMode === 'off') {
    return (
      <T v="caption" color={colors.textFaint}>
        AI field fill is off. Turn it on in Settings to read tags, owners and attachments from photos.
      </T>
    );
  }
  return (
    <Card style={styles.aiCard}>
      <Ionicons name="sparkles-outline" size={20} color={colors.info} />
      <T style={{ flex: 1 }} v="caption">
        {node.status === 'ai_done' ? 'AI found nothing it could fill confidently.' : 'Not analyzed yet.'}
      </T>
      {onRun ? <Button title="Run AI" icon="sparkles" compact kind="secondary" onPress={onRun} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  pill: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  quick: { flexDirection: 'row', gap: space.sm },
  warnCard: { gap: space.sm, borderColor: colors.warning, padding: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  aiCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  spanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kindDot: { width: 12, height: 12, borderRadius: 6 },
});
