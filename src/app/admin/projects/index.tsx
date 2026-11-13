// Projects table: search, status filter, sortable columns, footage split and who worked on each.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { CellText, DataTable, type Column } from '@/admin/components/DataTable';
import { Avatar, Badge, EmptyState, Grid, LoadError, PageHeader, Panel, SearchBox, Skeleton, Tabs, Txt } from '@/admin/components/kit';
import { useAdmin, useDocumentTitle } from '@/admin/context';
import { STATUS_META } from '@/admin/meta';
import { count, ft, relativeTime } from '@/admin/format';
import { filterProjects, initials, sortProjects, type ProjectSortKey, type ProjectStatusFilter } from '@/admin/shaping';
import type { ProjectSummary } from '@/admin/types';
import { useAdminData } from '@/admin/useAdminData';
import { WORK_TYPE_META } from '@/components/format';
import { colors, space } from '@/theme';


export default function ProjectsPage() {
  const { orgId } = useAdmin();
  useDocumentTitle('Projects');
  const q = useAdminData((api) => api.projectSummaries(orgId), [orgId]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ProjectStatusFilter>('active');
  const [sort, setSort] = useState<{ key: ProjectSortKey; dir: 'asc' | 'desc' }>({ key: 'lastUpdatedAt', dir: 'desc' });

  const all = q.data ?? [];
  const rows = useMemo(() => sortProjects(filterProjects(all, query, status), sort.key, sort.dir), [all, query, status, sort]);
  const countBy = (s: ProjectStatusFilter) => (s === 'all' ? all.length : all.filter((p) => p.status === s).length);
  const totals = useMemo(
    () => rows.reduce((t, p) => ({ a: t.a + p.aerialFt, u: t.u + p.undergroundFt, n: t.n + p.nodeCount }), { a: 0, u: 0, n: 0 }),
    [rows],
  );

  const columns: Column<ProjectSummary>[] = [
    {
      key: 'name',
      title: 'Project',
      flex: 2.4,
      minWidth: 240,
      sortable: true,
      render: (p) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: WORK_TYPE_META[p.workType]?.color ?? colors.textFaint }} />
          <CellText primary={p.name || 'Untitled project'} secondary={WORK_TYPE_META[p.workType]?.label} />
        </View>
      ),
    },
    { key: 'client', title: 'Client / Job #', flex: 1.5, minWidth: 170, sortable: true, render: (p) => <CellText primary={p.client || '--'} secondary={p.jobNumber || undefined} /> },
    { key: 'status', title: 'Status', flex: 0.9, minWidth: 100, render: (p) => <Badge label={STATUS_META[p.status].label} color={STATUS_META[p.status].color} /> },
    { key: 'nodeCount', title: 'Nodes', flex: 0.7, minWidth: 80, align: 'right', sortable: true, render: (p) => <Txt v="small" num>{count(p.nodeCount)}</Txt> },
    {
      key: 'aerial',
      title: 'Aerial ft',
      flex: 0.9,
      minWidth: 100,
      align: 'right',
      render: (p) => (
        <Txt v="small" num color={p.aerialFt ? colors.text : colors.textFaint}>
          {ft(p.aerialFt)}
        </Txt>
      ),
    },
    {
      key: 'ug',
      title: 'UG ft',
      flex: 0.9,
      minWidth: 100,
      align: 'right',
      render: (p) => (
        <Txt v="small" num color={p.undergroundFt ? colors.text : colors.textFaint}>
          {ft(p.undergroundFt)}
        </Txt>
      ),
    },
    {
      key: 'totalFt',
      title: 'Total ft',
      flex: 0.9,
      minWidth: 100,
      align: 'right',
      sortable: true,
      render: (p) => (
        <Txt v="small" num style={{ fontWeight: '700' }}>
          {ft(p.totalFt)}
        </Txt>
      ),
    },
    {
      key: 'editors',
      title: 'Techs',
      flex: 1,
      minWidth: 120,
      render: (p) =>
        p.editors.length ? (
          <View style={{ flexDirection: 'row' }} accessibilityLabel={p.editors.map((e) => e.name ?? 'Member').join(', ')}>
            {p.editors.slice(0, 4).map((e, i) => (
              <View key={e.userId} style={{ marginLeft: i ? -8 : 0, borderRadius: 15, borderWidth: 2, borderColor: colors.surface }}>
                <Avatar label={initials(e.name)} seed={e.userId} size={26} />
              </View>
            ))}
            {p.editors.length > 4 ? (
              <Txt v="micro" color={colors.textFaint} style={{ marginLeft: 6, alignSelf: 'center' }}>
                +{p.editors.length - 4}
              </Txt>
            ) : null}
          </View>
        ) : (
          <Txt v="micro" color={colors.textFaint}>
            None yet
          </Txt>
        ),
    },
    { key: 'lastUpdatedAt', title: 'Updated', flex: 0.9, minWidth: 110, sortable: true, render: (p) => <Txt v="small" color={colors.textMuted}>{relativeTime(p.lastUpdatedAt)}</Txt> },
  ];

  return (
    <View>
      <PageHeader
        title="Projects"
        subtitle="Every job your crews have mapped. Footage = straight-line span length plus sag and slack, or the measured length when a tech entered one."
      />
      {q.error ? <LoadError message={q.error} onRetry={q.reload} /> : null}

      <Grid gap={space.md} style={{ marginBottom: space.lg }}>
        <SummaryStat label="Projects shown" value={count(rows.length)} />
        <SummaryStat label="Nodes" value={count(totals.n)} />
        <SummaryStat label="Aerial footage" value={`${ft(totals.a)} ft`} dot={colors.aerial} />
        <SummaryStat label="Underground footage" value={`${ft(totals.u)} ft`} dot={colors.underground} />
        <SummaryStat label="Total footage" value={`${ft(totals.a + totals.u)} ft`} />
      </Grid>

      <Panel
        padded={false}
        title={undefined}
        right={undefined}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, alignItems: 'center', padding: space.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Tabs
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: 'Active', count: countBy('active') },
              { value: 'complete', label: 'Complete', count: countBy('complete') },
              { value: 'archived', label: 'Archived', count: countBy('archived') },
              { value: 'all', label: 'All', count: countBy('all') },
            ]}
          />
          <View style={{ flex: 1 }} />
          <SearchBox value={query} onChange={setQuery} placeholder="Search name, client, job # or tech" style={{ width: 320 }} />
        </View>
        {!q.data && !q.error ? (
          <View style={{ padding: space.lg, gap: 16 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} width="100%" height={22} />
            ))}
          </View>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(p) => p.id}
            rowLabel={(p) => `Open ${p.name}`}
            onRowPress={(p) => router.push(`/admin/projects/${p.id}`)}
            sort={sort}
            onSort={(key) =>
              setSort((s) => ({ key: key as ProjectSortKey, dir: s.key === key && s.dir === 'desc' ? 'asc' : key === 'name' || key === 'client' ? 'asc' : 'desc' }))
            }
            maxHeight={640}
            empty={
              all.length === 0 ? (
                <EmptyState
                  icon="map-outline"
                  title="No projects yet"
                  body="Projects appear here once a tech or manager creates one in the phone app and it syncs. Managers can create projects from the phone."
                />
              ) : (
                <EmptyState icon="search-outline" title="No matching projects" body="Try another search or status filter." />
              )
            }
          />
        )}
      </Panel>
    </View>
  );
}

function SummaryStat({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 150, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {dot ? <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: dot }} /> : null}
        <Txt v="micro" color={colors.textFaint}>
          {label}
        </Txt>
      </View>
      <Txt v="h2" num>
        {value}
      </Txt>
    </View>
  );
}
