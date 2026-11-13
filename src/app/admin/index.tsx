// Dashboard overview: KPI tiles, map of active projects, recent activity, projects needing QC.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { qcFor } from '@/admin/bundle';
import { Avatar, Badge, Btn, EmptyState, Grid, Kpi, LoadError, Meter, PageHeader, Panel, Skeleton, Txt } from '@/admin/components/kit';
import { ProjectMap } from '@/admin/components/ProjectMap';
import { useAdmin, useDocumentTitle } from '@/admin/context';
import { count, ftOrMiles, relativeTime, usd } from '@/admin/format';
import { canInvite, canViewActivity, canViewUsage } from '@/admin/roles';
import { describeActivity, initials, qcCounts, quotaState } from '@/admin/shaping';
import type { ActivityEntry, ProjectData } from '@/admin/types';
import { useAdminData } from '@/admin/useAdminData';
import { colors, space } from '@/theme';

export default function OverviewPage() {
  const { orgId, org, role, session } = useAdmin();
  useDocumentTitle('Overview');
  const stats = useAdminData((api) => api.overview(orgId), [orgId]);
  const active = useAdminData((api) => api.activeProjects(orgId, 25), [orgId]);
  const feed = useAdminData(canViewActivity(role) ? (api) => api.activity(orgId, 14) : null, [orgId, role]);

  const qc = useMemo(() => {
    const list = (active.data ?? []).map((d) => ({ d, c: qcCounts(qcFor(d)) }));
    const total = list.reduce((s, x) => ({ errors: s.errors + x.c.errors, warnings: s.warnings + x.c.warnings }), { errors: 0, warnings: 0 });
    return { list: list.sort((a, b) => b.c.errors - a.c.errors || b.c.warnings - a.c.warnings), total };
  }, [active.data]);

  const s = stats.data;
  const week = ftOrMiles(s?.footageWeekFt ?? 0);
  const month = ftOrMiles(s?.footageMonthFt ?? 0);
  const quota = quotaState(s?.aiPhotosMonth ?? 0, s?.aiQuota ?? org.aiMonthlyPhotoQuota ?? 0);
  const firstName = (session.name ?? '').split(' ')[0];

  return (
    <View>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Overview'}
        subtitle={`${org.name} at a glance. Numbers update as crews sync from the field.`}
        actions={
          <>
            {canInvite(role) ? <Btn title="Invite member" icon="person-add-outline" onPress={() => router.push('/admin/team?invite=1')} /> : null}
            <Btn title="All projects" kind="primary" icon="map-outline" onPress={() => router.push('/admin/projects')} />
          </>
        }
      />

      {stats.error ? <LoadError message={stats.error} onRetry={stats.reload} /> : null}

      <Grid gap={space.md} style={{ marginBottom: space.lg }}>
        <Kpi
          loading={!s}
          icon="trending-up"
          label="Footage this week"
          value={week.value}
          unit={week.unit}
          hint="Mapped since Monday (UTC)."
          accent={colors.aerial}
        />
        <Kpi loading={!s} icon="calendar-outline" label="Footage this month" value={month.value} unit={month.unit} hint={s ? `${ftOrMiles(s.footageTotalFt).value} ${ftOrMiles(s.footageTotalFt).unit} all time` : undefined} accent={colors.underground} />
        <Kpi
          loading={!s}
          icon="location-outline"
          label="Nodes mapped"
          value={count(s?.nodesTotal ?? 0)}
          hint={s ? `+${count(s.nodesWeek)} this week across ${s.projectsActive} active project${s.projectsActive === 1 ? '' : 's'}` : undefined}
          accent={colors.info}
        />
        <Kpi
          loading={!s}
          icon="people-outline"
          label="Active techs (7 days)"
          value={count(s?.activeTechs7d ?? 0)}
          hint={s ? `of ${s.members} member${s.members === 1 ? '' : 's'}, ${s.seatLimit} seats` : undefined}
          accent={colors.success}
        />
        <Kpi
          loading={!s}
          icon="sparkles-outline"
          label="AI photos this month"
          value={s?.aiPhotosMonth != null ? count(s.aiPhotosMonth) : '--'}
          unit={s?.aiPhotosMonth != null ? `/ ${count(s.aiQuota)}` : undefined}
          accent={colors.accent}
          footer={
            s?.aiPhotosMonth != null ? (
              <View style={{ gap: 6 }}>
                <Meter pct={quota.pct} />
                <Txt v="micro" color={colors.textFaint}>
                  {quota.level === 'full' ? 'Allowance used up: AI pauses until the 1st.' : `${count(quota.remaining)} left${s.aiCostMonthUsd != null ? `, about ${usd(s.aiCostMonthUsd)} AI cost so far` : ''}`}
                </Txt>
              </View>
            ) : (
              <Txt v="micro" color={colors.textFaint}>
                {canViewUsage(role) ? 'Loading...' : 'Visible to managers and up.'}
              </Txt>
            )
          }
        />
        <Kpi
          loading={!active.data}
          icon="shield-checkmark-outline"
          label="Open QC issues"
          value={count(qc.total.errors + qc.total.warnings)}
          accent={qc.total.errors ? colors.danger : colors.warning}
          footer={
            <Txt v="micro" color={colors.textFaint}>
              {qc.total.errors} must fix, {qc.total.warnings} to review. QC = quality checks run before export.
            </Txt>
          }
        />
      </Grid>

      <View style={styles.split}>
        <ActiveMap data={active.data} error={active.error} onRetry={active.reload} />
        <Panel
          title="Recent activity"
          subtitle="Edits synced from the field"
          style={{ flex: 1, flexBasis: 340, minWidth: 300 }}
          padded={false}
        >
          {!canViewActivity(role) ? (
            <EmptyState compact icon="lock-closed-outline" title="Managers and up" body="The activity log is visible to managers, admins and owners." />
          ) : feed.error ? (
            <View style={{ padding: space.lg }}>
              <LoadError message={feed.error} onRetry={feed.reload} />
            </View>
          ) : !feed.data ? (
            <View style={{ padding: space.lg, gap: 14 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} width="90%" height={16} />
              ))}
            </View>
          ) : feed.data.length === 0 ? (
            <EmptyState compact icon="pulse-outline" title="No activity yet" body="When techs capture nodes and sync, their work shows up here." />
          ) : (
            <View>
              {feed.data.map((e) => (
                <ActivityRow key={e.id} e={e} />
              ))}
            </View>
          )}
        </Panel>
      </View>

      <Panel title="Projects to review" subtitle="Active projects with the most open QC issues" style={{ marginTop: space.lg }} padded={false}>
        {!active.data ? (
          <View style={{ padding: space.lg }}>
            <Skeleton width="60%" />
          </View>
        ) : qc.list.length === 0 ? (
          <EmptyState compact icon="checkmark-done-outline" title="No active projects" body="Create a project in the phone app or mark one active to see it here." />
        ) : (
          qc.list.slice(0, 5).map(({ d, c }) => <QcRow key={d.project.id} d={d} errors={c.errors} warnings={c.warnings} />)
        )}
      </Panel>
    </View>
  );
}

function ActiveMap({ data, error, onRetry }: { data: ProjectData[] | null; error: string | null; onRetry: () => void }) {
  const [pick, setPick] = useState<string>('all');
  const list = data ?? [];
  const shown = pick === 'all' ? list : list.filter((d) => d.project.id === pick);
  const nodes = useMemo(() => shown.flatMap((d) => d.nodes), [shown]);
  const spans = useMemo(() => shown.flatMap((d) => d.spans), [shown]);
  const [selected, setSelected] = useState<string | null>(null);
  const selNode = selected ? nodes.find((n) => n.id === selected) : null;
  const selProject = selNode ? list.find((d) => d.project.id === selNode.projectId) : null;

  return (
    <Panel
      title="Active projects map"
      subtitle={data ? `${list.length} active project${list.length === 1 ? '' : 's'}, ${count(nodes.length)} nodes` : 'Loading...'}
      style={{ flex: 2, flexBasis: 560, minWidth: 340 }}
      padded={false}
    >
      {error ? (
        <View style={{ padding: space.lg }}>
          <LoadError message={error} onRetry={onRetry} />
        </View>
      ) : (
        <>
          <View style={styles.pickRow}>
            <PickChip label="All active" on={pick === 'all'} onPress={() => setPick('all')} />
            {list.map((d) => (
              <PickChip key={d.project.id} label={d.project.name} on={pick === d.project.id} onPress={() => setPick(d.project.id)} />
            ))}
          </View>
          <ProjectMap nodes={nodes} spans={spans} height={440} fitKey={pick} selectedNodeId={selected} onNodePress={setSelected} onBackgroundPress={() => setSelected(null)} />
          {selNode && selProject ? (
            <Pressable style={styles.mapCard} onPress={() => router.push(`/admin/projects/${selProject.project.id}?node=${selNode.id}`)} accessibilityRole="link">
              <View style={{ flex: 1 }}>
                <Txt v="h3">
                  {selNode.label || `#${selNode.seq}`} <Txt v="micro" color={colors.textMuted}>{selNode.type.replace('_', ' ')}</Txt>
                </Txt>
                <Txt v="micro" color={colors.textFaint}>
                  {selProject.project.name}. Open project details
                </Txt>
              </View>
              <Ionicons name="arrow-forward" size={16} color={colors.accent} />
            </Pressable>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function PickChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.pick, on && styles.pickOn]}>
      <Txt v="micro" color={on ? colors.onAccent : colors.textMuted} style={{ fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

function ActivityRow({ e }: { e: ActivityEntry }) {
  const d = describeActivity(e);
  const color = e.action === 'soft_delete' || e.action === 'delete' ? colors.danger : e.action === 'insert' ? colors.success : colors.info;
  return (
    <Pressable
      onPress={() => (e.projectId ? router.push(`/admin/projects/${e.projectId}`) : undefined)}
      style={styles.feedRow}
      accessibilityRole={e.projectId ? 'link' : undefined}
    >
      <Avatar label={initials(e.actorName)} seed={e.actorId ?? 'x'} size={28} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="small" numberOfLines={2}>
          <Txt v="small" style={{ fontWeight: '600' }}>
            {d.who}
          </Txt>{' '}
          <Txt v="small" color={color}>
            {d.verb}
          </Txt>{' '}
          {d.what}
          {d.detail ? <Txt v="small" color={colors.textMuted}> ({d.detail})</Txt> : null}
        </Txt>
        <Txt v="micro" color={colors.textFaint} numberOfLines={1}>
          {e.projectName ?? 'Project'} · {relativeTime(e.at)}
        </Txt>
      </View>
    </Pressable>
  );
}

function QcRow({ d, errors, warnings }: { d: ProjectData; errors: number; warnings: number }) {
  return (
    <Pressable style={styles.qcRow} onPress={() => router.push(`/admin/projects/${d.project.id}?tab=qc`)} accessibilityRole="link">
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt v="small" style={{ fontWeight: '600' }} numberOfLines={1}>
          {d.project.name}
        </Txt>
        <Txt v="micro" color={colors.textFaint} numberOfLines={1}>
          {[d.project.client, d.project.jobNumber].filter(Boolean).join(' · ')} · {d.nodes.length} nodes
        </Txt>
      </View>
      {errors ? <Badge label={`${errors} must fix`} color={colors.danger} icon="alert-circle" /> : null}
      {warnings ? <Badge label={`${warnings} to review`} color={colors.warning} icon="eye-outline" /> : null}
      {!errors && !warnings ? <Badge label="Ready to export" color={colors.success} icon="checkmark-circle" /> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  split: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, alignItems: 'stretch' },
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  pick: { height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', maxWidth: 220, cursor: 'pointer' },
  pickOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  mapCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    cursor: 'pointer',
  },
  feedRow: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border + '88' },
  qcRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border + '88', cursor: 'pointer' },
});
