// Searchable help and how-to.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { HELP_SECTIONS, sectionText, type HelpBlock, type HelpSection } from '@/components/helpContent';
import { PageScroll } from '@/components/Page';
import { Button, T } from '@/components/ui';
import { colors, radius, space, TOUCH } from '@/theme';

export default function HelpScreen() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ 'capture-loop': true });

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return HELP_SECTIONS;
    const words = q.split(/\s+/).filter(Boolean);
    return HELP_SECTIONS.filter((s) => {
      const text = sectionText(s).toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [q]);

  return (
    <PageScroll>
      <View style={styles.search}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search help: sag, duplicate, KMZ..."
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search help"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={12} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={{ gap: space.sm, marginTop: space.lg }}>
        {results.length === 0 ? (
          <EmptyState icon="search-outline" color={colors.info} title="Nothing found" body={`No help topics mention "${query.trim()}". Try a shorter word.`}>
            <Button title="Clear search" kind="secondary" onPress={() => setQuery('')} />
          </EmptyState>
        ) : (
          results.map((s) => (
            <Section key={s.id} s={s} expanded={!!q || !!open[s.id]} onToggle={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} />
          ))
        )}
      </View>
    </PageScroll>
  );
}

function Section({ s, expanded, onToggle }: { s: HelpSection; expanded: boolean; onToggle: () => void }) {
  return (
    <View style={[styles.section, expanded && { borderColor: colors.borderStrong }]}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded }} style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name={s.icon} size={20} color={colors.accent} />
        </View>
        <T v="heading" style={{ flex: 1 }}>
          {s.title}
        </T>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          {s.blocks.map((b, i) => (
            <Block key={i} b={b} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Block({ b }: { b: HelpBlock }) {
  if (b.kind === 'p') {
    return (
      <T color={colors.textMuted} style={styles.p}>
        {b.text}
      </T>
    );
  }
  if (b.kind === 'tip') {
    return (
      <View style={styles.tip}>
        <Ionicons name="bulb" size={18} color={colors.warning} />
        <T style={[styles.p, { flex: 1 }]}>{b.text}</T>
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      {b.items.map((item, i) => (
        <View key={i} style={styles.item}>
          {b.kind === 'steps' ? (
            <View style={styles.num}>
              <T v="caption" color={colors.onAccent} style={{ fontWeight: '800' }}>
                {i + 1}
              </T>
            </View>
          ) : (
            <View style={styles.bullet} />
          )}
          <T style={[styles.p, { flex: 1 }]}>{item}</T>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
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
  section: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 8, paddingHorizontal: space.md },
  icon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.accent + '1A', alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  p: { lineHeight: 22 },
  tip: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.warning + '14', borderWidth: 1, borderColor: colors.warning + '44' },
  item: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  num: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 8, marginHorizontal: 8 },
});
