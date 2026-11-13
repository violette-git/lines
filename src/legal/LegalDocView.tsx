// Renders a legal document (privacy, terms, account deletion) with the shared UI primitives.
// Readable on phones and on the website: PageScroll keeps a ~720 px column on wide screens.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PageScroll } from '@/components/Page';
import { Card, T, type IconName } from '@/components/ui';
import { colors, radius, space } from '@/theme';

import { COMPANY, LEGAL_REVIEWED } from './config';
import type { LegalBlock, LegalDocument } from './types';

export function LegalDocView({ doc, children }: { doc: LegalDocument; children?: ReactNode }) {
  return (
    <PageScroll>
      <TemplateBanner />
      <T v="display" style={styles.title}>
        {doc.title}
      </T>
      <T v="caption" color={colors.textMuted} style={{ marginTop: space.xs }}>
        {doc.effective}
      </T>

      {doc.summary?.length ? (
        <Card style={styles.summary}>
          <View style={styles.summaryHead}>
            <Ionicons name="reader-outline" size={18} color={colors.accent} />
            <T v="heading">The short version</T>
          </View>
          {doc.summary.map((s, i) => (
            <Bullet key={i}>{s}</Bullet>
          ))}
        </Card>
      ) : null}

      {children}

      {doc.sections.map((s) => (
        <View key={s.id} style={styles.section} nativeID={s.id}>
          <View accessibilityRole="header">
            <T v="title" style={styles.h2}>
              {s.title}
            </T>
          </View>
          {s.blocks.map((b, i) => (
            <Block key={i} b={b} />
          ))}
        </View>
      ))}

      <LegalFooter />
    </PageScroll>
  );
}

/** Shown on every legal page until an attorney has reviewed the text (LEGAL_REVIEWED in config.ts). */
export function TemplateBanner() {
  if (LEGAL_REVIEWED) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="alert-circle" size={18} color={colors.warning} />
      <T v="caption" color={colors.text} style={{ flex: 1, lineHeight: 18 }}>
        Template for review. This text has not been reviewed by an attorney yet and must be checked before launch.
      </T>
    </View>
  );
}

export function Block({ b }: { b: LegalBlock }) {
  if (b.k === 'p') {
    return (
      <T color={colors.textMuted} style={styles.p}>
        {b.t}
      </T>
    );
  }
  if (b.k === 'note') {
    return (
      <View style={styles.note}>
        <Ionicons name="warning" size={18} color={colors.warning} />
        <T style={[styles.p, { flex: 1 }]}>{b.t}</T>
      </View>
    );
  }
  if (b.k === 'ul' || b.k === 'steps') {
    return (
      <View style={{ gap: space.sm }}>
        {b.items.map((item, i) =>
          b.k === 'steps' ? (
            <View key={i} style={styles.item}>
              <View style={styles.num}>
                <T v="caption" color={colors.onAccent} style={{ fontWeight: '800' }}>
                  {i + 1}
                </T>
              </View>
              <T style={[styles.p, { flex: 1 }]}>{item}</T>
            </View>
          ) : (
            <Bullet key={i}>{item}</Bullet>
          ),
        )}
      </View>
    );
  }
  return null;
}

function Bullet({ children }: { children: string }) {
  return (
    <View style={styles.item}>
      <View style={styles.bullet} />
      <T style={[styles.p, { flex: 1 }]}>{children}</T>
    </View>
  );
}

const LINKS: { href: '/legal/privacy' | '/legal/terms' | '/support' | '/legal/delete-account'; label: string; icon: IconName }[] = [
  { href: '/legal/privacy', label: 'Privacy policy', icon: 'shield-checkmark-outline' },
  { href: '/legal/terms', label: 'Terms of use', icon: 'document-text-outline' },
  { href: '/support', label: 'Support', icon: 'help-buoy-outline' },
  { href: '/legal/delete-account', label: 'Delete account', icon: 'trash-outline' },
];

/** Links between the legal pages, and the publisher line. */
export function LegalFooter() {
  const path = usePathname();
  return (
    <View style={styles.footer}>
      <View style={styles.links}>
        {LINKS.filter((l) => l.href !== path).map((l) => (
          <Pressable
            key={l.href}
            accessibilityRole="link"
            onPress={() => router.push(l.href)}
            style={({ pressed }) => [styles.link, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name={l.icon} size={16} color={colors.accent} />
            <T v="label">{l.label}</T>
          </Pressable>
        ))}
      </View>
      <T v="caption" color={colors.textFaint}>
        LineMap Pro is published by {COMPANY.name}, {COMPANY.city}.
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: space.lg },
  summary: { marginTop: space.lg, gap: space.sm },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  section: { marginTop: space.xl, gap: space.md },
  h2: { fontSize: 18 },
  p: { lineHeight: 23 },
  item: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 9, marginHorizontal: 6 },
  num: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  note: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warning + '14',
    borderWidth: 1,
    borderColor: colors.warning + '44',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning + '66',
    backgroundColor: colors.warning + '14',
  },
  footer: { marginTop: space.xxl, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.border, gap: space.md },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
});
