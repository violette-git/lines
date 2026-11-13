// Usage: AI photo analyses per month and per tech (with estimated cost and the monthly allowance),
// and footage per tech per week.
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { BarList, Columns, StackedColumns } from '@/admin/components/Charts';
import { CellText, DataTable, type Column } from '@/admin/components/DataTable';
import { Avatar, EmptyState, Grid, Kpi, LoadError, Meter, Notice, PageHeader, Panel, Skeleton, Tabs, Txt } from '@/admin/components/kit';
import { useAdmin, useDocumentTitle } from '@/admin/context';
import { count, ft, ftOrMiles, usd } from '@/admin/format';
import { canViewUsage } from '@/admin/roles';
import {
  footageByTechWeek,
  initials,
  lastMonths,
  lastWeeks,
  monthLabel,
  projectMonthEnd,
  quotaState,
  usageRollup,
  weekLabel,
  type TechMonthly,
  type TechWeekly,
} from '@/admin/shaping';
import { useAdminData } from '@/admin/useAdminData';
import { colors, space } from '@/theme';

const MONTHS = 6;
const WEEKS = 8;

export default function UsagePage() {
  const { orgId, org, role } = useAdmin();
  useDocumentTitle('Usage');
  const allowed = canViewUsage(role);
  const usage = useAdminData(allowed ? (api) => api.aiUsage(orgId, MONTHS) : null, [orgId, allowed]);
  const foot = useAdminData(allowed ? (api) => api.footageByTech(orgId, WEEKS) : null, [orgId, allowed]);
  const [techMonth, setTechMonth] = useState<'current' | 'range'>('current');

  const months = useMemo(() => lastMonths(MONTHS), []);
  const weeks = useMemo(() => lastWeeks(WEEKS), []);
  const roll = useMemo(() => usageRollup(usage.data ?? [], months), [usage.data, months]);
  const matrix = useMemo(() => footageByTechWeek(foot.data ?? [], weeks), [foot.data, weeks]);

  if (!allowed) {
    return (
      <View>
        <PageHeader title="Usage" />
        <Notice tone="info" title="Managers and up">
          Team usage and footage reports are visible to managers, admins and owners.
        </Notice>
      </View>
    );
  }

  const quota = org.aiMonthlyPhotoQuota ?? 0;
  const q = quotaState(roll.current.photos, quota);
  const forecast = projectMonthEnd(roll.current.photos);
  const footTotal = ftOrMiles(matrix.grandTotalFt);
  const loading = !usage.data && !usage.error;
  const lastIdx = months.length - 1;

  const techRows = [...roll.techs].sort((a, b) =>
    techMonth === 'current' ? b.perMonth[lastIdx] - a.perMonth[lastIdx] : b.photos - a.photos,
  );

  const usageCols: Column<TechMonthly>[] = [
    {
      key: 'name',
      title: 'Tech',
      flex: 1.8,
      minWidth: 200,
      render: (t) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Avatar label={initials(t.name)} seed={t.userId ?? t.name} size={26} />
          <CellText primary={t.name} />
        </View>
      ),
    },
    ...months.map(
      (m, i): Column<TechMonthly> => ({
        key: m,
        title: monthLabel(m).slice(0, 3),
        flex: 0.7,
        minWidth: 70,
        align: 'right',
        render: (t) => (
          <Txt v="small" num color={t.perMonth[i] ? (i === lastIdx ? colors.text : colors.textMuted) : colors.textFaint} style={i === lastIdx ? { fontWeight: '700' } : undefined}>
            {count(t.perMonth[i])}
          </Txt>
        ),
      }),
    ),
    { key: 'errors', title: 'Failed', flex: 0.7, minWidth: 70, align: 'right', render: (t) => <Txt v="small" num color={t.errors ? colors.warning : colors.textFaint}>{count(t.errors)}</Txt> },
    { key: 'cost', title: 'Est. cost', flex: 0.9, minWidth: 90, align: 'right', render: (t) => <Txt v="small" num>{usd(t.costUsd)}</Txt> },
  ];

  const footCols: Column<TechWeekly>[] = [
    {
      key: 'name',
      title: 'Tech',
      flex: 1.8,
      minWidth: 200,
      render: (t) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Avatar label={initials(t.name)} seed={t.userId ?? t.name} size={26} />
          <CellText primary={t.name} />
        </View>
      ),
    },
    ...weeks.map(
      (w, i): Column<TechWeekly> => ({
        key: w,
        title: weekLabel(w),
        flex: 0.75,
        minWidth: 74,
        align: 'right',
        render: (t) => {
          const v = t.perWeek[i].aerialFt + t.perWeek[i].undergroundFt;
          return (
            <Txt v="small" num color={v ? colors.text : colors.textFaint}>
              {v ? ft(v) : '-'}
            </Txt>
          );
        },
      }),
    ),
    { key: 'total', title: 'Total ft', flex: 0.9, minWidth: 90, align: 'right', render: (t) => <Txt v="small" num style={{ fontWeight: '700' }}>{ft(t.totalFt)}</Txt> },
  ];

  return (
    <View>
      <PageHeader title="Usage" subtitle="AI photo analysis against your monthly allowance, and how much footage each tech maps." />
      {usage.error ? <LoadError message={usage.error} onRetry={usage.reload} /> : null}

      <Grid gap={space.md} style={{ marginBottom: space.lg }}>
        <Kpi
          loading={loading}
          icon="sparkles-outline"
          label="AI photos this month"
          value={count(roll.current.photos)}
          unit={`/ ${count(quota)}`}
          footer={
            <View style={{ gap: 6 }}>
              <Meter pct={q.pct} />
              <Txt v="micro" color={q.level === 'ok' ? colors.textFaint : q.level === 'warn' ? colors.warning : colors.danger}>
                {q.level === 'full' ? 'Allowance used up. AI pauses until the 1st (UTC).' : `At this pace about ${count(forecast)} by month end.`}
              </Txt>
            </View>
          }
        />
        <Kpi loading={loading} icon="cash-outline" label="Estimated AI cost this month" value={usd(roll.current.costUsd)} hint="Estimated from the size of each AI request at list prices." accent={colors.success} />
        <Kpi loading={loading} icon="calculator-outline" label="Average cost per photo" value={roll.avgCostPerPhoto != null ? usd(roll.avgCostPerPhoto, 3) : '--'} hint={`Over the last ${MONTHS} months.`} accent={colors.info} />
        <Kpi loading={!foot.data && !foot.error} icon="trending-up" label={`Footage, last ${WEEKS} weeks`} value={footTotal.value} unit={footTotal.unit} hint={`${matrix.techs.length} tech${matrix.techs.length === 1 ? '' : 's'} mapped cable.`} accent={colors.aerial} />
      </Grid>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginBottom: space.lg }}>
        <Panel title="AI photos per month" subtitle="Dashed line: monthly allowance on your plan" style={{ flex: 3, flexBasis: 460, minWidth: 320 }}>
          {loading ? (
            <Skeleton width="100%" height={200} />
          ) : (
            <Columns
              data={months.map((m, i) => ({ label: monthLabel(m).slice(0, 3), value: roll.monthTotals[i].photos, highlight: i === lastIdx }))}
              reference={quota ? { value: quota, label: `Allowance ${count(quota)}` } : undefined}
              tooltip={(d) => `${d.label}: ${count(d.value)} photos`}
            />
          )}
        </Panel>
        <Panel
          title="By tech"
          right={<Tabs value={techMonth} onChange={setTechMonth} options={[{ value: 'current', label: 'This month' }, { value: 'range', label: `${MONTHS} months` }]} />}
          style={{ flex: 2, flexBasis: 340, minWidth: 300 }}
        >
          {loading ? (
            <Skeleton width="100%" height={200} />
          ) : roll.techs.length === 0 ? (
            <EmptyState compact icon="sparkles-outline" title="No AI photos yet" body="When techs use AI auto-fill with the company account, each photo shows up here." />
          ) : (
            <BarList
              items={techRows.slice(0, 8).map((t) => ({
                key: t.userId ?? t.name,
                label: t.name,
                value: techMonth === 'current' ? t.perMonth[lastIdx] : t.photos,
                leading: <Avatar label={initials(t.name)} seed={t.userId ?? t.name} size={22} />,
              }))}
              format={count}
            />
          )}
        </Panel>
      </View>

      <Panel title="AI photos per tech per month" padded={false} style={{ marginBottom: space.lg }}>
        <DataTable columns={usageCols} rows={techRows} rowKey={(t) => t.userId ?? t.name} maxHeight={420} empty={<EmptyState compact icon="sparkles-outline" title="No AI usage in this period" />} />
      </Panel>

      {foot.error ? <LoadError message={foot.error} onRetry={foot.reload} /> : null}
      <Panel title="Footage per week" subtitle="Billable footage of spans added that week, by who added them" style={{ marginBottom: space.lg }}>
        {!foot.data && !foot.error ? (
          <Skeleton width="100%" height={220} />
        ) : matrix.grandTotalFt === 0 ? (
          <EmptyState compact icon="trending-up" title="No footage in the last 8 weeks" body="Footage appears as techs connect nodes with spans and sync." />
        ) : (
          <StackedColumns
            data={weeks.map((w, i) => ({ label: weekLabel(w), values: [matrix.weekTotals[i].aerialFt, matrix.weekTotals[i].undergroundFt] }))}
            series={[
              { label: 'Aerial', color: colors.aerial },
              { label: 'Underground', color: colors.underground },
            ]}
            tooltipFormat={(n) => ft(n)}
            unit=" ft"
            height={220}
          />
        )}
      </Panel>
      <Panel title="Footage per tech per week (ft)" padded={false}>
        <DataTable columns={footCols} rows={matrix.techs} rowKey={(t) => t.userId ?? t.name} maxHeight={420} empty={<EmptyState compact icon="people-outline" title="No footage yet" />} />
      </Panel>
      <Txt v="micro" color={colors.textFaint} style={{ marginTop: space.md }}>
        Weeks start Monday and months start on the 1st, both in UTC (Coordinated Universal Time), the same clock the AI allowance resets on.
      </Txt>
    </View>
  );
}
