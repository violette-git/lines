// Project detail: full map (select only), node inspector and table, photo gallery, QC issues and
// exports built with the same builders as the phone app (downloaded in the browser).
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { withPhotoUrls } from '@/admin/api';
import { qcFor, toExportBundle } from '@/admin/bundle';
import { CellText, DataTable, type Column } from '@/admin/components/DataTable';
import { Badge, Btn, Dialog, EmptyState, Grid, LoadError, Notice, Panel, Skeleton, Tabs, Txt } from '@/admin/components/kit';
import { ProjectMap } from '@/admin/components/ProjectMap';
import { useAdminScrollTo } from '@/admin/components/Shell';
import { useAdmin, useDocumentTitle } from '@/admin/context';
import { count, dateShort, ft, relativeTime } from '@/admin/format';
import { STATUS_META } from '@/admin/meta';
import { footageFromData, qcCounts } from '@/admin/shaping';
import type { ProjectData } from '@/admin/types';
import { useAdminData } from '@/admin/useAdminData';
import { WORK_TYPE_META } from '@/components/format';
import type { ExportFormat, QcIssue } from '@/domain/contracts';
import { NODE_SCHEMAS, NODE_TYPE_META } from '@/domain/nodeSchemas';
import type { FieldValue, MapNode, PhotoRef } from '@/domain/types';
import { EXPORT_FORMAT_LABELS, exportProject } from '@/export';
import { colors, radius, space } from '@/theme';

type Tab = 'map' | 'photos' | 'qc' | 'export';

export default function ProjectDetailPage() {
  const { orgId } = useAdmin();
  const params = useLocalSearchParams<{ id: string; tab?: string; node?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const [tab, setTab] = useState<Tab>((['map', 'photos', 'qc', 'export'] as Tab[]).includes(params.tab as Tab) ? (params.tab as Tab) : 'map');
  const [selected, setSelected] = useState<string | null>(typeof params.node === 'string' ? params.node : null);

  const q = useAdminData(
    async (api) => {
      const d = await api.project(orgId, id);
      if (!d) return null;
      const paths = d.photos.flatMap((p) => [p.storagePath, p.watermarkedPath]).filter((x): x is string => !!x);
      const urls = paths.length ? await api.signedPhotoUrls(paths).catch(() => ({})) : {};
      return { ...d, photos: withPhotoUrls(d.photos, urls) } satisfies ProjectData;
    },
    [orgId, id],
  );
  const d = q.data;
  useDocumentTitle(d?.project.name ?? 'Project');

  const qc = useMemo(() => (d ? qcFor(d) : []), [d]);
  const qcc = qcCounts(qc);
  const foot = useMemo(() => (d ? footageFromData(d.nodes, d.spans) : null), [d]);
  const photosByNode = useMemo(() => {
    const m = new Map<string, PhotoRef[]>();
    for (const p of d?.photos ?? []) m.set(p.nodeId, [...(m.get(p.nodeId) ?? []), p]);
    return m;
  }, [d]);

  if (q.error) {
    return (
      <View style={{ gap: space.lg }}>
        <BackLink />
        <LoadError message={q.error} onRetry={q.reload} />
      </View>
    );
  }
  if (q.loading && !d) {
    return (
      <View style={{ gap: space.lg }}>
        <BackLink />
        <Skeleton width={320} height={30} />
        <Skeleton width="100%" height={420} />
      </View>
    );
  }
  if (!d) {
    return (
      <View style={{ gap: space.lg }}>
        <BackLink />
        <EmptyState icon="help-circle-outline" title="Project not found" body="It may have been deleted, or it belongs to another company." />
      </View>
    );
  }

  const p = d.project;
  const wt = WORK_TYPE_META[p.workType];
  const selectNode = (nid: string) => {
    setSelected(nid);
    setTab('map');
  };

  return (
    <View>
      <BackLink />
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 280, gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge label={STATUS_META[p.status].label} color={STATUS_META[p.status].color} />
            {wt ? <Badge label={wt.label} color={wt.color} icon={wt.icon} /> : null}
            {d.template ? <Badge label={`Template: ${d.template.name}`} color={colors.textMuted} icon="document-text-outline" /> : null}
          </View>
          <Txt v="h1">{p.name || 'Untitled project'}</Txt>
          <Txt v="small" color={colors.textMuted}>
            {[p.client, p.jobNumber ? `Job ${p.jobNumber}` : null, `Created ${dateShort(p.createdAt)}`, `Updated ${relativeTime(p.updatedAt)}`].filter(Boolean).join('  ·  ')}
          </Txt>
        </View>
        <ExportButtons data={d} compact />
      </View>

      <Grid gap={space.md} style={{ marginBottom: space.lg }}>
        <Stat label="Nodes" value={count(d.nodes.length)} />
        <Stat label="Aerial" value={`${ft(foot?.aerialFt ?? 0)} ft`} dot={colors.aerial} />
        <Stat label="Underground" value={`${ft(foot?.undergroundFt ?? 0)} ft`} dot={colors.underground} />
        <Stat label="Total footage" value={`${ft(foot?.totalFt ?? 0)} ft`} />
        <Stat label="Photos" value={count(d.photos.length)} />
        <Stat label="QC" value={qcc.total ? `${qcc.errors} fix, ${qcc.warnings} review` : 'All clear'} tone={qcc.errors ? colors.danger : qcc.warnings ? colors.warning : colors.success} />
      </Grid>

      <Tabs
        value={tab}
        onChange={setTab}
        style={{ marginBottom: space.lg }}
        options={[
          { value: 'map', label: 'Map and nodes', count: d.nodes.length },
          { value: 'photos', label: 'Photos', count: d.photos.length },
          { value: 'qc', label: 'QC issues', count: qcc.total },
          { value: 'export', label: 'Export' },
        ]}
      />

      {tab === 'map' ? <MapTab d={d} selected={selected} onSelect={setSelected} photosByNode={photosByNode} /> : null}
      {tab === 'photos' ? <PhotosTab d={d} onOpenNode={selectNode} /> : null}
      {tab === 'qc' ? <QcTab issues={qc} d={d} onOpenNode={selectNode} /> : null}
      {tab === 'export' ? <ExportTab d={d} issues={qc} /> : null}
    </View>
  );
}

function BackLink() {
  return (
    <Pressable onPress={() => router.push('/admin/projects')} style={styles.back} accessibilityRole="link">
      <Ionicons name="arrow-back" size={14} color={colors.textMuted} />
      <Txt v="small" color={colors.textMuted}>
        Projects
      </Txt>
    </Pressable>
  );
}

function Stat({ label, value, dot, tone }: { label: string; value: string; dot?: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {dot ? <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: dot }} /> : null}
        {tone ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }} /> : null}
        <Txt v="micro" color={colors.textFaint}>
          {label}
        </Txt>
      </View>
      <Txt v="h2" num numberOfLines={1}>
        {value}
      </Txt>
    </View>
  );
}

// ---------- Map + nodes ----------

function fieldText(v: FieldValue | undefined): string {
  if (v === null || v === undefined || v === '') return '--';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

function keyFields(n: MapNode): string {
  const defs = NODE_SCHEMAS[n.type] ?? [];
  return defs
    .filter((f) => n.fields[f.key] !== undefined && n.fields[f.key] !== null && n.fields[f.key] !== '')
    .slice(0, 3)
    .map((f) => `${f.label}: ${fieldText(n.fields[f.key])}${f.unit === 'ft' ? ' ft' : ''}`)
    .join('  ·  ');
}

const NODE_STATUS: Record<MapNode['status'], { label: string; color: string }> = {
  draft: { label: 'Draft', color: colors.textMuted },
  ai_pending: { label: 'AI running', color: colors.info },
  ai_done: { label: 'AI filled, review', color: colors.warning },
  ai_failed: { label: 'AI failed', color: colors.danger },
  reviewed: { label: 'Reviewed', color: colors.success },
};

function MapTab({
  d,
  selected,
  onSelect,
  photosByNode,
}: {
  d: ProjectData;
  selected: string | null;
  onSelect: (id: string | null) => void;
  photosByNode: Map<string, PhotoRef[]>;
}) {
  const scrollTo = useAdminScrollTo();
  const node = selected ? d.nodes.find((n) => n.id === selected) ?? null : null;
  const nodes = useMemo(() => [...d.nodes].sort((a, b) => a.seq - b.seq), [d.nodes]);
  const columns: Column<MapNode>[] = [
    { key: 'seq', title: '#', flex: 0.4, minWidth: 50, render: (n) => <Txt v="small" num color={colors.textMuted}>{n.seq}</Txt> },
    {
      key: 'label',
      title: 'Label',
      flex: 1.2,
      minWidth: 140,
      render: (n) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: NODE_TYPE_META[n.type].color }} />
          <CellText primary={n.label || `#${n.seq}`} secondary={NODE_TYPE_META[n.type].label} />
        </View>
      ),
    },
    { key: 'fields', title: 'Key fields', flex: 3, minWidth: 280, render: (n) => <Txt v="micro" color={colors.textMuted} numberOfLines={2}>{keyFields(n) || 'No fields filled yet'}</Txt> },
    {
      key: 'gps',
      title: 'GPS',
      flex: 0.8,
      minWidth: 90,
      align: 'right',
      render: (n) => (
        <Txt v="small" num color={n.position.accuracyM != null && n.position.accuracyM > 10 ? colors.warning : colors.textMuted}>
          {n.position.accuracyM != null ? `±${n.position.accuracyM.toFixed(1)} m` : 'manual'}
        </Txt>
      ),
    },
    { key: 'photos', title: 'Photos', flex: 0.6, minWidth: 70, align: 'right', render: (n) => <Txt v="small" num>{photosByNode.get(n.id)?.length ?? 0}</Txt> },
    { key: 'status', title: 'Status', flex: 1, minWidth: 130, render: (n) => <Badge label={NODE_STATUS[n.status].label} color={NODE_STATUS[n.status].color} /> },
  ];

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, alignItems: 'flex-start' }}>
        <Panel padded={false} style={{ flex: 2, flexBasis: 560, minWidth: 340 }}>
          <ProjectMap nodes={d.nodes} spans={d.spans} height={520} selectedNodeId={selected} onNodePress={onSelect} onBackgroundPress={() => onSelect(null)} fitKey={d.project.id} />
        </Panel>
        <Panel
          title={node ? node.label || `Node #${node.seq}` : 'Node details'}
          subtitle={node ? NODE_TYPE_META[node.type].label : 'Click a node on the map or in the table'}
          style={{ flex: 1, flexBasis: 320, minWidth: 280 }}
          padded={false}
        >
          <ScrollView style={{ height: 467 }} contentContainerStyle={{ padding: space.lg }}>
            {node ? <NodeInspector node={node} photos={photosByNode.get(node.id) ?? []} /> : <EmptyState compact icon="hand-left-outline" title="Nothing selected" body="Select a node to see its fields, GPS fix and photos." />}
          </ScrollView>
        </Panel>
      </View>
      <Panel title="Nodes" subtitle="In capture order" padded={false}>
        <DataTable
          columns={columns}
          rows={nodes}
          rowKey={(n) => n.id}
          rowLabel={(n) => `Select ${n.label || n.seq}`}
          onRowPress={(n) => {
            onSelect(n.id);
            scrollTo(0);
          }}
          maxHeight={480}
          empty={<EmptyState compact icon="location-outline" title="No nodes yet" body="Nodes appear here as techs capture them in the field." />}
        />
      </Panel>
    </View>
  );
}

function NodeInspector({ node, photos }: { node: MapNode; photos: PhotoRef[] }) {
  const defs = NODE_SCHEMAS[node.type] ?? [];
  const extra = Object.keys(node.fields).filter((k) => !defs.some((f) => f.key === k));
  const primary = photos.find((p) => p.isPrimary) ?? photos[0];
  return (
    <View style={{ gap: space.md }}>
      {primary ? <Image source={{ uri: primary.watermarkedUri || primary.uri }} style={styles.inspectorPhoto} contentFit="cover" accessibilityLabel={`Photo of ${node.label}`} /> : null}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Badge label={NODE_STATUS[node.status].label} color={NODE_STATUS[node.status].color} />
        {node.possibleDuplicateOf ? <Badge label="Possible duplicate" color={colors.warning} icon="copy-outline" /> : null}
      </View>
      <View style={styles.kv}>
        <KV k="Position" v={`${node.position.lat.toFixed(6)}, ${node.position.lng.toFixed(6)}`} mono />
        <KV k="GPS accuracy" v={node.position.accuracyM != null ? `±${node.position.accuracyM.toFixed(1)} m (${node.position.samples} samples)` : 'Placed by hand'} />
        <KV k="Captured" v={dateShort(node.position.capturedAt)} />
      </View>
      <View style={styles.kv}>
        {defs.map((f) => {
          const meta = node.aiMeta?.[f.key];
          return (
            <KV
              key={f.key}
              k={f.label}
              v={`${fieldText(node.fields[f.key])}${f.unit === 'ft' && node.fields[f.key] != null ? ' ft' : ''}`}
              tag={meta?.source === 'ai' ? `AI ${Math.round(meta.confidence * 100)}%${meta.isEstimate ? ' est.' : ''}` : undefined}
            />
          );
        })}
        {extra.map((k) => (
          <KV key={k} k={k.replace(/_/g, ' ')} v={fieldText(node.fields[k])} />
        ))}
      </View>
      {node.notes ? (
        <Txt v="small" color={colors.textMuted}>
          {node.notes}
        </Txt>
      ) : null}
      {node.aiReport?.summary ? <Notice tone="info" title="AI summary">{node.aiReport.summary}</Notice> : null}
    </View>
  );
}

function KV({ k, v, mono, tag }: { k: string; v: string; mono?: boolean; tag?: string }) {
  return (
    <View style={styles.kvRow}>
      <Txt v="micro" color={colors.textFaint} style={{ width: 120 }} numberOfLines={2}>
        {k}
      </Txt>
      <Txt v="small" num={mono} style={{ flex: 1 }} color={v === '--' ? colors.textFaint : colors.text} selectable>
        {v}
      </Txt>
      {tag ? <Badge label={tag} color={colors.accent} icon="sparkles" /> : null}
    </View>
  );
}

// ---------- Photos ----------

function PhotosTab({ d, onOpenNode }: { d: ProjectData; onOpenNode: (id: string) => void }) {
  const [open, setOpen] = useState<PhotoRef | null>(null);
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const photos = [...d.photos].sort((a, b) => (byId.get(a.nodeId)?.seq ?? 0) - (byId.get(b.nodeId)?.seq ?? 0));
  if (!photos.length) {
    return (
      <Panel>
        <EmptyState icon="images-outline" title="No photos yet" body="Photos appear once the phone uploads them (on Wi-Fi by default)." />
      </Panel>
    );
  }
  const missing = photos.filter((p) => !p.uri && !p.watermarkedUri).length;
  return (
    <View style={{ gap: space.md }}>
      {missing ? <Notice tone="info">{`${missing} photo${missing === 1 ? ' is' : 's are'} still uploading from the field.`}</Notice> : null}
      <View style={styles.gallery}>
        {photos.map((p) => {
          const n = byId.get(p.nodeId);
          const uri = p.watermarkedUri || p.uri;
          return (
            <Pressable key={p.id} style={styles.thumb} onPress={() => setOpen(p)} accessibilityRole="button" accessibilityLabel={`Open photo of ${n?.label ?? 'node'}`}>
              {uri ? (
                <Image source={{ uri }} style={styles.thumbImg} contentFit="cover" />
              ) : (
                <View style={[styles.thumbImg, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="cloud-upload-outline" size={22} color={colors.textFaint} />
                </View>
              )}
              <View style={styles.thumbCap}>
                <Txt v="micro" style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>
                  {n?.label || `#${n?.seq ?? '?'}`}
                </Txt>
                <Txt v="micro" color={colors.textFaint}>
                  {dateShort(p.takenAt)}
                </Txt>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `${byId.get(open.nodeId)?.label ?? 'Photo'}` : ''}
        width={920}
        footer={
          open ? (
            <>
              <Btn title="Show on map" icon="map-outline" onPress={() => {
                const nid = open.nodeId;
                setOpen(null);
                onOpenNode(nid);
              }} />
              <Btn title="Close" kind="primary" onPress={() => setOpen(null)} />
            </>
          ) : null
        }
      >
        {open ? (
          <>
            <Image source={{ uri: open.watermarkedUri || open.uri }} style={{ width: '100%', aspectRatio: open.width && open.height ? open.width / open.height : 4 / 3, borderRadius: radius.sm, backgroundColor: colors.bg }} contentFit="contain" />
            <Txt v="micro" color={colors.textFaint}>
              Taken {dateShort(open.takenAt)}
              {open.fix ? `  ·  ${open.fix.lat.toFixed(6)}, ${open.fix.lng.toFixed(6)}` : ''}
            </Txt>
          </>
        ) : null}
      </Dialog>
    </View>
  );
}

// ---------- QC ----------

function QcTab({ issues, d, onOpenNode }: { issues: QcIssue[]; d: ProjectData; onOpenNode: (id: string) => void }) {
  if (!issues.length) {
    return (
      <Panel>
        <EmptyState icon="checkmark-done-circle-outline" title="No QC issues" body="Every node passes the quality checks. This project is ready to export." />
      </Panel>
    );
  }
  const spanNode = (spanId?: string) => d.spans.find((s) => s.id === spanId)?.fromNodeId;
  return (
    <Panel title="Quality checks" subtitle="Must fix: blocks a clean deliverable. To review: worth a look before sending to the client." padded={false}>
      {issues.map((i, k) => {
        const nid = i.nodeId ?? spanNode(i.spanId);
        return (
          <Pressable key={k} style={styles.qcRow} onPress={() => (nid ? onOpenNode(nid) : undefined)} accessibilityRole={nid ? 'button' : undefined}>
            <Ionicons name={i.severity === 'error' ? 'alert-circle' : 'eye-outline'} size={16} color={i.severity === 'error' ? colors.danger : colors.warning} />
            <Txt v="small" style={{ flex: 1 }}>
              {i.message}
            </Txt>
            <Badge label={i.severity === 'error' ? 'Must fix' : 'Review'} color={i.severity === 'error' ? colors.danger : colors.warning} />
            {nid ? <Ionicons name="locate-outline" size={15} color={colors.textFaint} /> : null}
          </Pressable>
        );
      })}
    </Panel>
  );
}

// ---------- Export ----------

const FORMATS: { f: ExportFormat; hint: string; icon: 'document-text-outline' | 'earth-outline' | 'grid-outline' | 'list-outline' | 'code-slash-outline' | 'layers-outline' }[] = [
  { f: 'pdf', hint: 'Printable report with map, tables and photos. Opens the print dialog; choose "Save as PDF".', icon: 'document-text-outline' },
  { f: 'kmz', hint: 'Opens in Google Earth with photos embedded.', icon: 'earth-outline' },
  { f: 'xlsx', hint: 'Nodes and spans as spreadsheet tabs.', icon: 'grid-outline' },
  { f: 'csv', hint: 'Plain tables (zip with nodes and spans).', icon: 'list-outline' },
  { f: 'geojson', hint: 'For GIS and web maps.', icon: 'code-slash-outline' },
  { f: 'shapefile', hint: 'For ArcGIS and QGIS (zip).', icon: 'layers-outline' },
];

function useExporter(d: ProjectData) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const run = async (f: ExportFormat) => {
    setBusy(f);
    setMsg(null);
    try {
      const res = await exportProject(toExportBundle(d), f);
      setMsg({ tone: 'success', text: `Downloaded ${res.fileName}` });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  return { busy, msg, run };
}

function ExportButtons({ data, compact }: { data: ProjectData; compact?: boolean }) {
  const { busy, run } = useExporter(data);
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
      <Btn title="KMZ" icon="earth-outline" loading={busy === 'kmz'} onPress={() => void run('kmz')} size={compact ? 'md' : 'lg'} />
      <Btn title="Excel" icon="grid-outline" loading={busy === 'xlsx'} onPress={() => void run('xlsx')} size={compact ? 'md' : 'lg'} />
      <Btn title="PDF report" kind="primary" icon="document-text-outline" loading={busy === 'pdf'} onPress={() => void run('pdf')} size={compact ? 'md' : 'lg'} />
    </View>
  );
}

function ExportTab({ d, issues }: { d: ProjectData; issues: QcIssue[] }) {
  const { busy, msg, run } = useExporter(d);
  const c = qcCounts(issues);
  return (
    <View style={{ gap: space.lg }}>
      {c.errors ? (
        <Notice tone="warning" title={`${c.errors} QC issue${c.errors === 1 ? '' : 's'} must be fixed`}>
          You can still export, but the deliverable will have gaps. Fix them in the phone app, then export again.
        </Notice>
      ) : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Grid gap={space.md}>
        {FORMATS.map(({ f, hint, icon }) => (
          <View key={f} style={styles.exportCard}>
            <View style={styles.exportIcon}>
              <Ionicons name={icon} size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt v="h3">{EXPORT_FORMAT_LABELS[f]}</Txt>
              <Txt v="micro" color={colors.textMuted}>
                {hint}
              </Txt>
            </View>
            <Btn title="Download" icon="download-outline" loading={busy === f} disabled={busy != null && busy !== f} onPress={() => void run(f)} />
          </View>
        ))}
      </Grid>
      <Txt v="micro" color={colors.textFaint}>
        Exports are built in your browser from the synced data. Photos still uploading from the field are left out.
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: space.md, cursor: 'pointer' },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: space.lg, marginBottom: space.lg },
  stat: { flexGrow: 1, flexBasis: 140, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 },
  kv: { gap: 0, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  kvRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border + '88' },
  inspectorPhoto: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm, backgroundColor: colors.bg },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  thumb: { width: 200, flexGrow: 1, maxWidth: 260, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, cursor: 'pointer' },
  thumbImg: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.bg },
  thumbCap: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  qcRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border + '88' },
  exportCard: {
    flexGrow: 1,
    flexBasis: 360,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  exportIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.accent + '1A', alignItems: 'center', justifyContent: 'center' },
});
