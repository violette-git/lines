// Projects home: weekly totals, search and filters, project cards, and a big "New project" button.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View, type StyleProp, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { canManageProjectsNow, useAuth, useCanManageProjects } from '@/backend/authStore';
import { ActionSheet, type SheetAction } from '@/components/ActionSheet';
import { LOGO_TILE } from '@/components/brand';
import { confirmAsync } from '@/components/confirm';
import { EmptyState } from '@/components/EmptyState';
import { formatCount, formatMoney, relativeTime, WORK_TYPE_META } from '@/components/format';
import { Column, MAX_CONTENT_WIDTH } from '@/components/Page';
import { Button, Chip, IconButton, T } from '@/components/ui';
import { useProjectStats, type ProjectStats } from '@/components/useProjectStats';
import type { Project } from '@/domain/types';
import { formatLength } from '@/geo';
import { useStore } from '@/state/store';
import { SyncChip } from '@/sync';
import { colors, font, radius, shadow, space, TOUCH } from '@/theme';

type Filter = Project['status'];
const FILTERS: { value: Filter; label: string; icon: 'flash-outline' | 'checkmark-done-outline' | 'archive-outline' }[] = [
  { value: 'active', label: 'Active', icon: 'flash-outline' },
  { value: 'complete', label: 'Complete', icon: 'checkmark-done-outline' },
  { value: 'archived', label: 'Archived', icon: 'archive-outline' },
];

export default function ProjectsHome() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // On wide screens, line the floating button up with the right edge of the centered column.
  const fabRight = Math.max(insets.right + space.lg, (width - MAX_CONTENT_WIDTH) / 2);
  const ready = useStore((s) => s.ready);
  const projects = useStore((s) => s.projects);
  const units = useStore((s) => s.settings.units);
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [menuFor, setMenuFor] = useState<Project | null>(null);

  // New projects go to the active company only when the store says so (sync wiring turns that off
  // for roles that cannot create company projects, which then create local projects instead).
  const newProjectOrgId = useStore((s) => (s.createProjectsInOrg ? s.activeOrgId : null));
  const canCreate = useCanManageProjects(newProjectOrgId ?? null);
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const signedIn = useAuth((s) => s.session != null);
  // Re-render the open menu when roles change (sign out, company switch).
  useAuth((s) => s.role);
  const narrow = width < 400;
  const iconSize = narrow ? 44 : 46;

  const sorted = useMemo(() => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [projects]);
  const { stats } = useProjectStats(sorted);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { active: 0, complete: 0, archived: 0 };
    for (const p of projects) c[p.status] += 1;
    return c;
  }, [projects]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter(
      (p) =>
        p.status === filter &&
        (!q || p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q) || p.jobNumber.toLowerCase().includes(q)),
    );
  }, [sorted, filter, query]);

  const week = useMemo(() => {
    let ft = 0;
    let nodes = 0;
    let earnings = 0;
    let hasEarnings = false;
    const active = projects.filter((p) => p.status === 'active');
    for (const p of active) {
      const s = stats[p.id];
      if (!s) continue;
      ft += s.week.totalFt;
      nodes += s.week.nodes;
      if (s.week.earnings != null) {
        hasEarnings = true;
        earnings += s.week.earnings;
      }
    }
    return { ft, nodes, earnings: hasEarnings ? earnings : null, activeCount: active.length };
  }, [projects, stats]);

  // Local projects (no orgId) are always manageable; company projects need manager or above.
  const canManageMenu = menuFor ? canManageProjectsNow(menuFor.orgId ?? null) : false;
  const openAction: SheetAction[] = menuFor
    ? [{ key: 'open', label: 'Open map', icon: 'map-outline', onPress: () => router.push(`/project/${menuFor.id}`) }]
    : [];
  const manageActions: SheetAction[] = menuFor && canManageMenu
    ? [
        {
          key: 'edit',
          label: 'Edit details',
          icon: 'create-outline',
          hint: 'Name, client, job number, rates',
          onPress: () => router.push(`/project/${menuFor.id}/edit`),
        },
        menuFor.status === 'complete'
          ? { key: 'reopen', label: 'Reopen', icon: 'refresh-outline', onPress: () => void updateProject(menuFor.id, { status: 'active' }) }
          : {
              key: 'complete',
              label: 'Mark complete',
              icon: 'checkmark-done-outline',
              hint: 'Moves it to the Complete tab',
              onPress: () => void updateProject(menuFor.id, { status: 'complete' }),
            },
        menuFor.status === 'archived'
          ? { key: 'unarchive', label: 'Unarchive', icon: 'arrow-undo-outline', onPress: () => void updateProject(menuFor.id, { status: 'active' }) }
          : {
              key: 'archive',
              label: 'Archive',
              icon: 'archive-outline',
              hint: 'Hides it from your active list. Nothing is deleted.',
              onPress: () => void updateProject(menuFor.id, { status: 'archived' }),
            },
        {
          key: 'delete',
          label: 'Delete project',
          icon: 'trash-outline',
          destructive: true,
          hint: 'Removes all nodes, spans and photos',
          onPress: () => {
            const p = menuFor;
            void (async () => {
              const ok = await confirmAsync({
                title: `Delete "${p.name}"?`,
                message: 'This removes every node, span and photo in the project from this device. It cannot be undone. Export first if you need a copy.',
                confirmLabel: 'Delete',
                destructive: true,
              });
              if (ok) await deleteProject(p.id);
            })();
          },
        },
      ]
    : [];
  const menuActions: SheetAction[] = [...openAction, ...manageActions];

  const header = (
    <Column style={{ gap: space.lg }}>
      <WeekBand ft={week.ft} nodes={week.nodes} earnings={week.earnings} activeCount={week.activeCount} units={units} narrow={narrow} />
      <View style={{ gap: space.md }}>
        <View style={styles.search}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, client or job #"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search projects"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={12} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={22} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.chips}>
          {FILTERS.map((f) => (
            <Chip
              key={f.value}
              label={`${f.label} ${counts[f.value]}`}
              icon={f.icon}
              selected={filter === f.value}
              onPress={() => setFilter(f.value)}
            />
          ))}
        </View>
      </View>
    </Column>
  );

  const empty = !ready ? null : projects.length === 0 ? (
    <EmptyState
      icon="trail-sign-outline"
      title="Map your first run"
      body="Create a project, then walk the route snapping a photo at each pole or handhole. Footage adds up as you go."
    >
      {canCreate ? <Button title="New project" icon="add" onPress={() => router.push('/project/new')} /> : null}
      <Button title="How it works" kind="secondary" icon="play-circle-outline" onPress={() => router.push('/onboarding')} />
    </EmptyState>
  ) : query.trim() ? (
    <EmptyState icon="search-outline" color={colors.info} title="No matches" body={`Nothing in ${filter} projects matches "${query.trim()}".`}>
      <Button title="Clear search" kind="secondary" onPress={() => setQuery('')} />
    </EmptyState>
  ) : (
    <EmptyState
      icon={filter === 'complete' ? 'checkmark-done-outline' : filter === 'archived' ? 'archive-outline' : 'flash-outline'}
      color={filter === 'active' ? colors.accent : colors.textMuted}
      title={filter === 'active' ? 'No active projects' : filter === 'complete' ? 'Nothing marked complete yet' : 'Archive is empty'}
      body={
        filter === 'active'
          ? 'Start a new job, or reopen one from Complete.'
          : filter === 'complete'
            ? 'When a job is turned in, use the menu on its card to mark it complete.'
            : 'Archive old jobs to keep your list short. Archived projects stay on the device.'
      }
    />
  );

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + space.sm, paddingLeft: insets.left + space.lg, paddingRight: insets.right + space.lg }]}>
        <Column style={styles.topBarInner}>
          <View style={styles.brand}>
            <Image source={LOGO_TILE} style={styles.logo} contentFit="contain" accessibilityLabel="LineMap Pro logo" />
            {/* Phones under 400 dp wide keep the mark only, so the header buttons fit. */}
            {narrow ? null : (
              <T v="title" numberOfLines={1}>
                LineMap <T v="title" color={colors.accent}>Pro</T>
              </T>
            )}
          </View>
          <View style={[styles.topActions, narrow && { gap: 6 }]}>
            <SyncChip compact />
            <IconButton icon="albums-outline" label="Client templates" size={iconSize} onPress={() => router.push('/templates')} />
            <IconButton icon="help-circle-outline" label="Help" size={iconSize} onPress={() => router.push('/help')} />
            <IconButton icon="settings-outline" label="Settings" size={iconSize} onPress={() => router.push('/settings')} />
            {backendEnabled ? (
              <IconButton
                icon="person-circle-outline"
                label={signedIn ? 'Account' : 'Sign in'}
                size={iconSize}
                onPress={() => router.push((signedIn ? '/account' : '/auth/sign-in') as never)}
              />
            ) : null}
          </View>
        </Column>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: space.lg }}
        ListEmptyComponent={empty ?? undefined}
        contentContainerStyle={{
          paddingTop: space.md,
          paddingLeft: insets.left + space.lg,
          paddingRight: insets.right + space.lg,
          paddingBottom: insets.bottom + 120,
        }}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        renderItem={({ item }) => (
          <Column>
            <ProjectCard project={item} stats={stats[item.id]} units={units} narrow={narrow} onMenu={() => setMenuFor(item)} />
          </Column>
        )}
      />

      {canCreate ? (
        <View pointerEvents="box-none" style={[styles.fabWrap, { bottom: insets.bottom + space.lg, right: fabRight }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New project"
            onPress={() => router.push('/project/new')}
            style={({ pressed }) => [styles.fab, { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
          >
            <Ionicons name="add" size={28} color={colors.onAccent} />
            <T v="heading" color={colors.onAccent} style={{ fontSize: 17 }}>
              New project
            </T>
          </Pressable>
        </View>
      ) : null}

      <ActionSheet
        visible={!!menuFor}
        title={menuFor?.name}
        subtitle={menuFor ? [menuFor.client, menuFor.jobNumber && `Job ${menuFor.jobNumber}`].filter(Boolean).join('  |  ') : undefined}
        actions={menuActions}
        onClose={() => setMenuFor(null)}
      />
    </View>
  );
}

function WeekBand({
  ft,
  nodes,
  earnings,
  activeCount,
  units,
  narrow,
}: {
  ft: number;
  nodes: number;
  earnings: number | null;
  activeCount: number;
  units: 'imperial' | 'metric';
  narrow: boolean;
}) {
  return (
    <View style={styles.band}>
      <View style={styles.bandHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="calendar-outline" size={16} color={colors.accent} />
          <T v="label" color={colors.accent} style={{ textTransform: 'uppercase' }}>
            This week
          </T>
        </View>
        <T v="caption" color={colors.textMuted}>
          {activeCount === 1 ? '1 active project' : `${activeCount} active projects`}
        </T>
      </View>
      <View style={styles.bandStats}>
        <BandStat value={formatLength(ft, units)} label="Footage" narrow={narrow} />
        <View style={styles.bandDivider} />
        <BandStat value={formatCount(nodes)} label="Nodes" narrow={narrow} />
        <View style={styles.bandDivider} />
        <BandStat
          value={earnings == null ? '--' : formatMoney(earnings)}
          label="Est. earnings"
          color={earnings == null ? colors.textFaint : colors.success}
          narrow={narrow}
        />
      </View>
    </View>
  );
}

function BandStat({ value, label, color, narrow }: { value: string; label: string; color?: string; narrow?: boolean }) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <FitText style={[font.mono, styles.bandValue, narrow && { fontSize: 17 }, { color: color ?? colors.text }]}>{value}</FitText>
      <T v="caption" color={colors.textMuted} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

function ProjectCard({
  project,
  stats,
  units,
  narrow,
  onMenu,
}: {
  project: Project;
  stats: ProjectStats | undefined;
  units: 'imperial' | 'metric';
  narrow: boolean;
  onMenu: () => void;
}) {
  const wt = WORK_TYPE_META[project.workType];
  const t = stats?.tally;
  const meta = [project.client, project.jobNumber && `Job ${project.jobNumber}`].filter(Boolean).join('  |  ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open project ${project.name}`}
      accessibilityHint="Long press for more options"
      onPress={() => router.push(`/project/${project.id}`)}
      onLongPress={onMenu}
      delayLongPress={350}
      style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surfaceAlt, borderColor: colors.borderStrong }]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.wtTile, { backgroundColor: wt.color + '22', borderColor: wt.color + '55' }]}>
          <Ionicons name={wt.icon} size={24} color={wt.color} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="heading" numberOfLines={1} style={{ fontSize: 17 }}>
            {project.name}
          </T>
          <T v="caption" color={colors.textMuted} numberOfLines={1}>
            {meta || wt.label}
          </T>
        </View>
        <Pressable
          onPress={onMenu}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${project.name}`}
          style={({ pressed }) => [styles.kebab, pressed && { backgroundColor: colors.surfaceRaised }]}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.cardStats}>
        <CardStat barColor={colors.textMuted} value={t ? formatCount(t.nodeCount) : '...'} label="Nodes" narrow={narrow} />
        <CardStat barColor={colors.aerial} value={t ? formatLength(t.aerialFt, units) : '...'} label="Aerial" narrow={narrow} />
        <CardStat barColor={colors.underground} value={t ? formatLength(t.undergroundFt, units) : '...'} label={narrow ? 'Undergr.' : 'Underground'} narrow={narrow} />
        {t?.earnings != null ? <CardStat barColor={colors.success} value={formatMoney(t.earnings)} label="Earned" color={colors.success} narrow={narrow} /> : null}
      </View>

      <View style={styles.cardFoot}>
        <View style={styles.badges}>
          {project.status !== 'active' ? (
            <Pill
              text={project.status === 'complete' ? 'Complete' : 'Archived'}
              color={project.status === 'complete' ? colors.success : colors.textMuted}
              icon={project.status === 'complete' ? 'checkmark-circle' : 'archive'}
            />
          ) : null}
          {t && t.aiPending > 0 ? <Pill text={`${t.aiPending} AI pending`} color={colors.info} icon="sparkles" /> : null}
          {t && t.duplicates > 0 ? <Pill text={`${t.duplicates} possible duplicate${t.duplicates > 1 ? 's' : ''}`} color={colors.warning} icon="copy" /> : null}
          {project.walkMode && project.status === 'active' ? <Pill text="Walk mode" color={colors.accent} icon="walk" /> : null}
        </View>
        <T v="caption" color={colors.textFaint}>
          {relativeTime(project.updatedAt)}
        </T>
      </View>
    </Pressable>
  );
}

function CardStat({ barColor, value, label, color, narrow }: { barColor: string; value: string; label: string; color?: string; narrow?: boolean }) {
  return (
    <View style={[styles.cardStat, label === 'Nodes' && { flex: 0.7 }]}>
      <View style={{ width: 18, height: 3, borderRadius: 2, backgroundColor: barColor, marginBottom: 4 }} />
      <FitText style={[font.heading, font.mono, narrow && { fontSize: 13 }, { fontWeight: '700', color: color ?? colors.text }]}>{value}</FitText>
      <T v="caption" color={colors.textMuted} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

/**
 * One line of text that shrinks to fit instead of cutting off with "...". Native shrinks the font
 * (adjustsFontSizeToFit); web has no auto-shrink, so callers pass a smaller size on narrow screens.
 */
function FitText({ style, children }: { style: StyleProp<TextStyle>; children: string }) {
  return (
    <Text
      style={style}
      numberOfLines={1}
      adjustsFontSizeToFit={Platform.OS !== 'web'}
      minimumFontScale={0.6}
      ellipsizeMode={Platform.OS === 'web' ? 'clip' : 'tail'}
    >
      {children}
    </Text>
  );
}

function Pill({ text, color, icon }: { text: string; color: string; icon: 'sparkles' | 'copy' | 'walk' | 'checkmark-circle' | 'archive' }) {
  return (
    <View style={[styles.pill, { borderColor: color + '66', backgroundColor: color + '14' }]}>
      <Ionicons name={icon} size={12} color={color} />
      <T v="caption" color={color}>
        {text}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingBottom: space.sm, backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border },
  topBarInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  logo: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  band: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accent + '44',
    backgroundColor: colors.surface,
    padding: space.lg,
    gap: space.md,
    ...shadow.card,
  },
  bandHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bandStats: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  bandDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  bandValue: { fontSize: 22, fontWeight: '800' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, minHeight: TOUCH - 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  wtTile: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  kebab: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: -space.sm },
  cardStats: {
    flexDirection: 'row',
    gap: space.sm,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  cardStat: { flex: 1, minWidth: 0, gap: 2 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  fabWrap: { position: 'absolute' },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 64,
    paddingLeft: space.lg,
    paddingRight: space.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    ...shadow.card,
  },
});
