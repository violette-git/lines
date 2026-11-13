// Dashboard frame: left sidebar (brand, organization switcher, navigation, plan card), top bar
// with the page breadcrumb and the user menu, and a scrolling content area. The sidebar collapses
// to icons on tablet widths and becomes a slide-over on narrow screens.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type HostInstance, type ScrollViewInstance } from 'react-native';

import type { IconName } from '@/components/ui';
import { colors, radius, space } from '@/theme';

import { planName } from '../plans';
import { ROLE_META, visibleSections, type AdminSection } from '../roles';
import type { AdminSession } from '../session';
import { initials } from '../shaping';
import { Avatar, Badge, Menu, Txt, type MenuItem } from './kit';

export const NAV: { key: AdminSection; label: string; icon: IconName; href: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'grid-outline', href: '/admin' },
  { key: 'projects', label: 'Projects', icon: 'map-outline', href: '/admin/projects' },
  { key: 'team', label: 'Team', icon: 'people-outline', href: '/admin/team' },
  { key: 'usage', label: 'Usage', icon: 'stats-chart-outline', href: '/admin/usage' },
  { key: 'billing', label: 'Billing', icon: 'card-outline', href: '/admin/billing' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', href: '/admin/settings' },
];

const ScrollCtx = createContext<(y?: number) => void>(() => {});
/** Scrolls the dashboard content area (e.g. back to the map after picking a row far below). */
export const useAdminScrollTo = () => useContext(ScrollCtx);

export function sectionForPath(path: string): AdminSection {
  const seg = path.replace(/^\/admin\/?/, '').split('/')[0];
  return (NAV.find((n) => n.key === seg)?.key ?? 'overview') as AdminSection;
}

export function AdminShell({ session, children }: { session: AdminSession; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const mode: 'full' | 'rail' | 'drawer' = width >= 1180 ? 'full' : width >= 760 ? 'rail' : 'drawer';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const active = sectionForPath(pathname);
  const sections = visibleSections(session.role);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollTo = useCallback((y = 0) => scrollRef.current?.scrollTo({ y, animated: true }), []);

  const sidebar = (
    <Sidebar
      session={session}
      compact={mode === 'rail'}
      active={active}
      sections={sections}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  return (
    <View style={styles.root}>
      {mode !== 'drawer' ? sidebar : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <TopBar session={session} active={active} onMenu={mode === 'drawer' ? () => setDrawerOpen(true) : undefined} />
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <ScrollCtx.Provider value={scrollTo}>
            <View style={styles.contentInner}>{children}</View>
          </ScrollCtx.Provider>
        </ScrollView>
      </View>
      {mode === 'drawer' && drawerOpen ? (
        <View style={StyleSheet.absoluteFill}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={() => setDrawerOpen(false)} accessibilityLabel="Close navigation" />
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0 }}>{sidebar}</View>
        </View>
      ) : null}
    </View>
  );
}

function Sidebar({
  session,
  compact,
  active,
  sections,
  onNavigate,
}: {
  session: AdminSession;
  compact: boolean;
  active: AdminSection;
  sections: AdminSection[];
  onNavigate: () => void;
}) {
  const org = session.activeOrg;
  return (
    <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
      <View style={[styles.brand, compact && { justifyContent: 'center', paddingHorizontal: 0 }]}>
        <View style={styles.logo}>
          <Ionicons name="git-network" size={17} color={colors.onAccent} />
        </View>
        {!compact ? (
          <Txt v="h2" style={{ fontWeight: '800' }}>
            LineMap <Txt v="h2" color={colors.accent} style={{ fontWeight: '800' }}>Pro</Txt>
          </Txt>
        ) : null}
      </View>

      <OrgSwitcher session={session} compact={compact} />

      <View style={{ gap: 2, marginTop: space.md }} accessibilityRole="menu">
        {!compact ? (
          <Txt v="label" color={colors.textFaint} style={{ paddingHorizontal: 12, marginBottom: 6 }}>
            Workspace
          </Txt>
        ) : null}
        {NAV.filter((n) => sections.includes(n.key)).map((n) => (
          <NavItem key={n.key} item={n} active={active === n.key} compact={compact} onNavigate={onNavigate} />
        ))}
      </View>

      <View style={{ flex: 1 }} />

      {!compact && org ? (
        <Pressable onPress={() => router.push('/admin/billing')} style={styles.planCard} accessibilityRole="link" accessibilityLabel="Plan and billing">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="ribbon-outline" size={14} color={colors.accent} />
            <Txt v="small" style={{ fontWeight: '600', flex: 1 }}>
              {planName(org.plan)}
            </Txt>
            <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
          </View>
          <Txt v="micro" color={colors.textFaint}>
            {org.seatLimit ?? '?'} seats, {(org.aiMonthlyPhotoQuota ?? 0).toLocaleString('en-US')} AI photos a month
          </Txt>
        </Pressable>
      ) : null}
      <Link href="/" style={[styles.backLink, compact && { alignSelf: 'center' }]} accessibilityLabel="Open the field app">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="phone-portrait-outline" size={14} color={colors.textFaint} />
          {!compact ? (
            <Txt v="micro" color={colors.textFaint}>
              Field app preview
            </Txt>
          ) : null}
        </View>
      </Link>
    </View>
  );
}

function NavItem({
  item,
  active,
  compact,
  onNavigate,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  compact: boolean;
  onNavigate: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onPress={() => {
        onNavigate();
        router.push(item.href);
      }}
      style={[
        styles.navItem,
        compact && { justifyContent: 'center', paddingHorizontal: 0 },
        (hover || active) && { backgroundColor: active ? colors.surfaceRaised : colors.surfaceAlt },
      ]}
    >
      {active ? <View style={styles.navActiveBar} /> : null}
      <Ionicons name={active ? (item.icon.replace('-outline', '') as IconName) : item.icon} size={17} color={active ? colors.accent : colors.textMuted} />
      {!compact ? (
        <Txt v="small" color={active ? colors.text : colors.textMuted} style={{ fontWeight: active ? '600' : '500' }}>
          {item.label}
        </Txt>
      ) : null}
    </Pressable>
  );
}

function OrgSwitcher({ session, compact }: { session: AdminSession; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HostInstance>(null);
  const org = session.activeOrg;
  if (!org) return null;
  const items: MenuItem[] = [
    ...session.orgs.map((o) => ({
      key: o.id,
      label: o.name,
      hint: `${ROLE_META[o.role].label}, ${planName(o.plan)}`,
      selected: o.id === org.id,
      onPress: () => void session.setActiveOrg(o.id),
    })),
    { key: '__new', label: 'Create or join a company', icon: 'add-circle-outline' as IconName, onPress: () => router.push('/org/select') },
  ];
  return (
    <View ref={anchor}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`Organization: ${org.name}. Switch organization`}
        style={[styles.orgBtn, compact && { justifyContent: 'center', paddingHorizontal: 0, borderWidth: 0 }]}
      >
        <View style={styles.orgMark}>
          <Txt v="micro" color={colors.text} style={{ fontWeight: '800' }}>
            {initials(org.name)}
          </Txt>
        </View>
        {!compact ? (
          <>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt v="small" style={{ fontWeight: '600' }} numberOfLines={1}>
                {org.name}
              </Txt>
              <Txt v="micro" color={colors.textFaint} numberOfLines={1}>
                {ROLE_META[org.role].label}
              </Txt>
            </View>
            <Ionicons name="chevron-expand" size={14} color={colors.textFaint} />
          </>
        ) : null}
      </Pressable>
      <Menu open={open} onClose={() => setOpen(false)} items={items} width={260} anchor={anchor} />
    </View>
  );
}

function TopBar({ session, active, onMenu }: { session: AdminSession; active: AdminSection; onMenu?: () => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HostInstance>(null);
  const label = NAV.find((n) => n.key === active)?.label ?? 'Overview';
  const org = session.activeOrg;
  const items: MenuItem[] = [
    { key: 'settings', label: 'Account and company settings', icon: 'settings-outline', onPress: () => router.push('/admin/settings') },
    { key: 'account', label: 'Your account', icon: 'person-circle-outline', onPress: () => router.push('/account') },
    { key: 'pricing', label: 'Plans and pricing', icon: 'pricetags-outline', onPress: () => router.push('/pricing') },
    {
      key: 'out',
      label: 'Sign out',
      icon: 'log-out-outline',
      danger: true,
      onPress: () => {
        void session.signOut().then(() => router.replace('/auth/sign-in?next=%2Fadmin'));
      },
    },
  ];
  return (
    <View style={styles.topbar}>
      {onMenu ? (
        <Pressable onPress={onMenu} accessibilityRole="button" accessibilityLabel="Open navigation" style={styles.iconHit}>
          <Ionicons name="menu" size={20} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <Txt v="small" color={colors.textFaint} numberOfLines={1}>
          {org?.name ?? ''}
        </Txt>
        <Ionicons name="chevron-forward" size={12} color={colors.textFaint} />
        <Txt v="small" style={{ fontWeight: '600' }}>
          {label}
        </Txt>
      </View>
      {org && org.subscriptionStatus && org.subscriptionStatus !== 'active' && org.subscriptionStatus !== 'trialing' ? (
        <Badge label={`Subscription ${org.subscriptionStatus.replace('_', ' ')}`} color={colors.danger} icon="alert-circle" />
      ) : null}
      <View ref={anchor}>
        <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel="Account menu" style={styles.userBtn}>
          <Avatar label={initials(session.name, session.email)} seed={session.userId ?? 'me'} size={28} />
          <View style={{ maxWidth: 180 }}>
            <Txt v="small" style={{ fontWeight: '600' }} numberOfLines={1}>
              {session.name ?? session.email ?? 'Signed in'}
            </Txt>
            {session.name && session.email ? (
              <Txt v="micro" color={colors.textFaint} numberOfLines={1}>
                {session.email}
              </Txt>
            ) : null}
          </View>
          <Ionicons name="chevron-down" size={14} color={colors.textFaint} />
        </Pressable>
        <Menu open={open} onClose={() => setOpen(false)} items={items} align="right" width={250} anchor={anchor} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  sidebar: {
    width: 248,
    height: '100%',
    paddingHorizontal: space.md,
    paddingTop: space.lg,
    paddingBottom: space.md,
    backgroundColor: '#090C10',
    borderRightWidth: 1,
    borderRightColor: colors.border,
    gap: space.sm,
  },
  sidebarCompact: { width: 68, paddingHorizontal: space.sm },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, marginBottom: space.md, height: 32 },
  logo: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  orgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    cursor: 'pointer',
  },
  orgMark: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    cursor: 'pointer',
  },
  navActiveBar: { position: 'absolute', left: -12, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: colors.accent },
  planCard: {
    gap: 4,
    padding: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accent + '40',
    backgroundColor: colors.accent + '0D',
    cursor: 'pointer',
  },
  backLink: { paddingHorizontal: 8, paddingVertical: 6 },
  topbar: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
    zIndex: 20,
  },
  iconHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  userBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm, cursor: 'pointer' },
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: 64 },
  contentInner: { width: '100%', maxWidth: 1360, alignSelf: 'center' },
});
