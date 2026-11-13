// Export: QC check first (tap an issue to fix it), then one tap per deliverable format.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, SectionTitle, Stat, T } from '@/components/ui';
import type { ExportBundle, ExportFormat, QcIssue } from '@/domain/contracts';
import type { PhotoRef } from '@/domain/types';
import { getPhotoStore } from '@/data';
import { runQc } from '@/domain/qc';
import { confirmAsync, errorMessage } from '@/features/common/confirm';
import { formatMoney } from '@/features/common/format';
import { errorHaptic, successHaptic } from '@/features/common/haptics';
import { useMapUiBus } from '@/features/common/mapUiBus';
import { goBackOr, ScreenHeader } from '@/features/common/ScreenHeader';
import { useToast } from '@/features/common/Toast';
import { exportProject } from '@/export';
import { formatLength } from '@/geo';
import { computeTally, selectSpansWithLength, useStore } from '@/state/store';
import { resolvePhotoUri } from '@/sync';
import { colors, radius, space } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Status = 'idle' | 'busy' | 'done' | 'error';

const FORMATS: { format: ExportFormat; title: string; desc: string; icon: IconName }[] = [
  { format: 'kmz', title: 'Google Earth (KMZ)', desc: 'Map of every node and line with photos inside. Opens in Google Earth.', icon: 'earth' },
  { format: 'xlsx', title: 'Excel (XLSX)', desc: 'Node and span sheets with footage totals, ready for billing.', icon: 'grid-outline' },
  { format: 'csv', title: 'CSV', desc: 'Plain node and span tables (zipped) for any spreadsheet or database.', icon: 'document-text-outline' },
  { format: 'pdf', title: 'PDF report', desc: 'Printable job report: map, tally, photos and QC results.', icon: 'document-outline' },
  { format: 'geojson', title: 'GeoJSON', desc: 'Points and lines for web maps and most GIS tools.', icon: 'code-slash-outline' },
  { format: 'shapefile', title: 'Shapefile (GIS)', desc: 'Zipped SHP layers for ArcGIS and QGIS.', icon: 'layers-outline' },
];

/**
 * Photo bytes for the export. Company photos taken on another phone have no local file yet:
 * resolvePhotoUri downloads them (native) or returns a signed link (web) first.
 */
async function loadPhotoBase64(photo: PhotoRef): Promise<string | null> {
  const store = getPhotoStore();
  const read = async (watermarked: boolean): Promise<string | null> => {
    try {
      const uri = await resolvePhotoUri(photo, { watermarked });
      return uri ? await store.readBase64(uri) : null;
    } catch {
      return null;
    }
  };
  if (photo.watermarkedUri || photo.watermarkedPath) {
    const stamped = await read(true);
    if (stamped) return stamped;
    // fall through to the original
  }
  return read(false);
}

export default function ExportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const toast = useToast({ bottom: insets.bottom + 24 });

  const project = useStore((s) => s.projects.find((p) => p.id === id) ?? null);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const nodes = useStore((s) => s.nodes);
  const rawSpans = useStore((s) => s.spans);
  const photos = useStore((s) => s.photos);
  const templates = useStore((s) => s.templates);
  const units = useStore((s) => s.settings.units);
  const snapshot = useMapUiBus((s) => (s.mapSnapshot?.projectId === id ? s.mapSnapshot.dataUrl : null));

  useEffect(() => {
    if (!id || useStore.getState().activeProjectId === id) return;
    (async () => {
      const st = useStore.getState();
      if (!st.ready) await st.init();
      await useStore.getState().openProject(id);
    })().catch(() => {});
  }, [id]);

  const ready = activeProjectId === id && project != null;
  const spans = useMemo(() => selectSpansWithLength({ spans: rawSpans, nodes }), [rawSpans, nodes]);
  const template = project?.templateId ? templates.find((t) => t.id === project.templateId) ?? null : null;
  const tally = useMemo(() => computeTally(nodes, spans, project), [nodes, spans, project]);

  const bundle = useMemo<ExportBundle | null>(() => {
    if (!ready || !project) return null;
    return {
      project,
      nodes,
      spans,
      photos,
      template,
      loadPhotoBase64,
      generatedAt: new Date().toISOString(),
    };
  }, [ready, project, nodes, spans, photos, template]);

  const issues = useMemo<QcIssue[]>(() => {
    if (!bundle) return [];
    try {
      return [...runQc(bundle)].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
    } catch {
      return [];
    }
  }, [bundle]);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  const [status, setStatus] = useState<Partial<Record<ExportFormat, Status>>>({});
  const [showAllIssues, setShowAllIssues] = useState(false);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const run = async (format: ExportFormat) => {
    if (!bundle || status[format] === 'busy') return;
    if (bundle.nodes.length === 0) {
      toast.show('Nothing to export yet. Capture some nodes first.', { kind: 'info' });
      return;
    }
    if (errors > 0) {
      const ok = await confirmAsync(
        `Export with ${errors} error${errors === 1 ? '' : 's'}?`,
        'QC found problems the client may reject (missing required fields, bad GPS). You can fix them first or export anyway.',
        { confirmText: 'Export anyway', cancelText: 'Fix first' },
      );
      if (!ok) return;
    }
    setStatus((s) => ({ ...s, [format]: 'busy' }));
    try {
      const res = await exportProject({ ...bundle, generatedAt: new Date().toISOString() }, format, {
        mapImageDataUrl: format === 'pdf' ? snapshot : undefined,
      });
      setStatus((s) => ({ ...s, [format]: 'done' }));
      successHaptic();
      toast.show(`Exported ${res.fileName}`, { kind: 'success' });
    } catch (e) {
      setStatus((s) => ({ ...s, [format]: 'error' }));
      errorHaptic();
      toast.show(`Export failed: ${errorMessage(e)}`, { kind: 'error', durationMs: 6000 });
    }
  };

  const openIssue = (i: QcIssue) => {
    if (i.nodeId) {
      router.push(`/project/${id}/node/${i.nodeId}` as never);
    } else if (i.spanId) {
      useMapUiBus.getState().requestSelect({ kind: 'span', id: i.spanId });
      goBackOr(`/project/${id}`);
    }
  };

  const shownIssues = showAllIssues ? issues : issues.slice(0, 8);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Export" subtitle={project?.name} onBack={() => goBackOr(`/project/${id}`)} />
      {!ready ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}>
          <Card style={styles.stats}>
            <Stat label="Nodes" value={String(tally.nodeCount)} />
            <Stat label="Spans" value={String(spans.length)} />
            <Stat label="Total" value={formatLength(tally.totalFt, units)} color={colors.accent} />
            {tally.earnings != null ? <Stat label="Est. pay" value={formatMoney(tally.earnings)} color={colors.success} /> : null}
          </Card>

          <SectionTitle>Quality check</SectionTitle>
          {issues.length === 0 ? (
            <Card style={styles.qcOk}>
              <Ionicons name="checkmark-circle" size={24} color={colors.success} />
              <T style={{ flex: 1 }}>All clear. No problems found.</T>
            </Card>
          ) : (
            <Card style={{ gap: space.xs, padding: space.md }}>
              <View style={styles.qcHead}>
                {errors > 0 ? (
                  <View style={[styles.count, { borderColor: colors.danger }]}>
                    <T v="label" color={colors.danger}>
                      {errors} error{errors === 1 ? '' : 's'}
                    </T>
                  </View>
                ) : null}
                {warnings > 0 ? (
                  <View style={[styles.count, { borderColor: colors.warning }]}>
                    <T v="label" color={colors.warning}>
                      {warnings} warning{warnings === 1 ? '' : 's'}
                    </T>
                  </View>
                ) : null}
                <T v="caption" color={colors.textMuted} style={{ flex: 1, textAlign: 'right' }}>
                  Tap to fix
                </T>
              </View>
              {shownIssues.map((i, idx) => {
                const c = i.severity === 'error' ? colors.danger : colors.warning;
                const nodeLabel = i.nodeId ? nodesById.get(i.nodeId)?.label : null;
                const label = nodeLabel && !i.message.startsWith(nodeLabel) ? nodeLabel : null;
                const tappable = !!(i.nodeId || i.spanId);
                return (
                  <Pressable
                    key={idx}
                    accessibilityRole={tappable ? 'button' : undefined}
                    disabled={!tappable}
                    onPress={() => openIssue(i)}
                    style={({ pressed }) => [styles.issue, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Ionicons name={i.severity === 'error' ? 'close-circle' : 'warning'} size={18} color={c} />
                    <T v="caption" style={{ flex: 1 }}>
                      {label ? <T v="caption" color={c} style={{ fontWeight: '800' }}>{`${label}: `}</T> : null}
                      {i.message}
                    </T>
                    {tappable ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null}
                  </Pressable>
                );
              })}
              {issues.length > 8 ? (
                <Pressable onPress={() => setShowAllIssues((v) => !v)} accessibilityRole="button" style={styles.more}>
                  <T v="label" color={colors.accent}>
                    {showAllIssues ? 'Show fewer' : `Show all ${issues.length}`}
                  </T>
                </Pressable>
              ) : null}
            </Card>
          )}

          <SectionTitle>Formats</SectionTitle>
          {errors > 0 ? (
            <T v="caption" color={colors.textMuted} style={{ marginBottom: space.sm }}>
              You can still export; we will ask you to confirm.
            </T>
          ) : null}
          <View style={styles.grid}>
            {FORMATS.map((f) => {
              const st = status[f.format] ?? 'idle';
              return (
                <Pressable
                  key={f.format}
                  accessibilityRole="button"
                  accessibilityLabel={`Export ${f.title}`}
                  onPress={() => void run(f.format)}
                  disabled={st === 'busy'}
                  style={({ pressed }) => [
                    styles.tile,
                    st === 'done' && { borderColor: colors.success },
                    st === 'error' && { borderColor: colors.danger },
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <View style={styles.tileHead}>
                    <View style={styles.tileIcon}>
                      <Ionicons name={f.icon} size={24} color={colors.accent} />
                    </View>
                    <View style={{ width: 28, alignItems: 'flex-end' }}>
                      {st === 'busy' ? (
                        <ActivityIndicator color={colors.accent} />
                      ) : st === 'done' ? (
                        <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                      ) : st === 'error' ? (
                        <Ionicons name="alert-circle" size={22} color={colors.danger} />
                      ) : (
                        <Ionicons name="download-outline" size={20} color={colors.textMuted} />
                      )}
                    </View>
                  </View>
                  <T v="heading">{f.title}</T>
                  <T v="caption" color={colors.textMuted}>
                    {st === 'busy' ? 'Building...' : f.desc}
                  </T>
                </Pressable>
              );
            })}
          </View>
          <T v="caption" color={colors.textFaint} style={{ marginTop: space.md }}>
            Photos use the GPS-stamped copy when one exists.{snapshot ? ' The PDF cover uses your current map view.' : ''}
          </T>
        </ScrollView>
      )}
      {toast.node}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.md, maxWidth: 860, width: '100%', alignSelf: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' },
  qcOk: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  qcHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  count: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  issue: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingVertical: space.xs },
  more: { alignItems: 'center', paddingVertical: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexGrow: 1,
    flexBasis: 240,
    minHeight: 128,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.xs,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
