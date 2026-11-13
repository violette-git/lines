// Client templates list.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { formatMoney } from '@/components/format';
import { PageScroll } from '@/components/Page';
import { Button, T } from '@/components/ui';
import { makeLabel } from '@/domain/labels';
import type { ClientTemplate } from '@/domain/types';
import { useStore } from '@/state/store';
import { colors, font, radius, space } from '@/theme';

export default function TemplatesScreen() {
  const templates = useStore((s) => s.templates);
  const projects = useStore((s) => s.projects);
  const sorted = [...templates].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <PageScroll footer={templates.length ? <Button title="New template" icon="add" onPress={() => router.push('/templates/new')} /> : undefined}>
      <T color={colors.textMuted} style={{ marginBottom: space.lg }}>
        Templates hold each client's rules: how nodes are named, which fields must be filled before export, span defaults and pay rates. Pick one when you
        create a project.
      </T>
      {sorted.length === 0 ? (
        <EmptyState
          icon="albums-outline"
          title="No templates yet"
          body="Set one up per client so every project starts with the right labels, rates and required fields."
        >
          <Button title="Create a template" icon="add" onPress={() => router.push('/templates/new')} />
        </EmptyState>
      ) : (
        <View style={{ gap: space.md }}>
          {sorted.map((t) => (
            <TemplateCard key={t.id} t={t} used={projects.filter((p) => p.templateId === t.id).length} />
          ))}
        </View>
      )}
    </PageScroll>
  );
}

function TemplateCard({ t, used }: { t: ClientTemplate; used: number }) {
  const required = Object.values(t.requiredFields).reduce((n, list) => n + (list?.length ?? 0), 0);
  const sample = makeLabel('pole', 7, { template: t, jobNumber: 'J1042' });
  const rates = [t.ratePerFoot != null ? `${formatMoney(t.ratePerFoot)}/ft` : null, t.ratePerNode != null ? `${formatMoney(t.ratePerNode)}/node` : null]
    .filter(Boolean)
    .join(' + ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Edit template ${t.name}`}
      onPress={() => router.push(`/templates/${t.id}`)}
      style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surfaceAlt, borderColor: colors.borderStrong }]}
    >
      <View style={styles.icon}>
        <Ionicons name="albums" size={22} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <T v="heading" numberOfLines={1}>
          {t.name}
        </T>
        <T v="caption" color={colors.textMuted} numberOfLines={1}>
          {[t.client || 'No client set', used ? `${used} project${used > 1 ? 's' : ''}` : null].filter(Boolean).join('  |  ')}
        </T>
        <View style={styles.facts}>
          <Fact icon="pricetag-outline" text={`Poles: ${sample}`} mono />
          <Fact icon="list-outline" text={`${required} required field${required === 1 ? '' : 's'}`} />
          {rates ? <Fact icon="cash-outline" text={rates} mono color={colors.success} /> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.textFaint} />
    </Pressable>
  );
}

function Fact({ icon, text, mono, color }: { icon: 'pricetag-outline' | 'list-outline' | 'cash-outline'; text: string; mono?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name={icon} size={13} color={color ?? colors.textMuted} />
      <T v="caption" color={color ?? colors.textMuted} style={mono ? font.mono : undefined}>
        {text}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accent + '1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 4, marginTop: 2 },
});
