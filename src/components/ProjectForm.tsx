// Project details form. Used by /project/new, and reusable for /project/[id]/edit:
//   export default function Edit() { const { id } = useLocalSearchParams<{ id: string }>(); return <ProjectForm projectId={id} />; }
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Project, WorkType } from '@/domain/types';
import { useStore } from '@/state/store';
import { colors, font, radius, space } from '@/theme';

import { notify } from './confirm';
import { parseOptionalNumber, WORK_TYPE_META } from './format';
import { PageScroll } from './Page';
import { Button, Card, Field, SectionTitle, T, ToggleRow } from './ui';

const WORK_TYPES: WorkType[] = ['aerial', 'underground', 'mixed', 'qc'];

export function ProjectForm({ projectId }: { projectId?: string }) {
  const templates = useStore((s) => s.templates);
  const existing = useStore((s) => (projectId ? s.projects.find((p) => p.id === projectId) ?? null : null));
  const createProject = useStore((s) => s.createProject);
  const updateProject = useStore((s) => s.updateProject);

  const [name, setName] = useState(existing?.name ?? '');
  const [client, setClient] = useState(existing?.client ?? '');
  const [jobNumber, setJobNumber] = useState(existing?.jobNumber ?? '');
  const [workType, setWorkType] = useState<WorkType>(existing?.workType ?? 'aerial');
  const [templateId, setTemplateId] = useState<string | null>(existing?.templateId ?? null);
  const [rateFt, setRateFt] = useState(existing?.ratePerFoot != null ? String(existing.ratePerFoot) : '');
  const [rateNode, setRateNode] = useState(existing?.ratePerNode != null ? String(existing.ratePerNode) : '');
  const [walkMode, setWalkMode] = useState(existing?.walkMode ?? true);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [touchedName, setTouchedName] = useState(false);
  const [saving, setSaving] = useState(false);

  const pFt = parseOptionalNumber(rateFt);
  const pNode = parseOptionalNumber(rateNode);
  const rateFtError = Number.isNaN(pFt) || (pFt != null && pFt < 0) ? 'Enter a number like 0.85' : undefined;
  const rateNodeError = Number.isNaN(pNode) || (pNode != null && pNode < 0) ? 'Enter a number like 12' : undefined;
  const nameError = touchedName && !name.trim() ? 'Give the project a name so you can find it later' : undefined;
  const canSave = !!name.trim() && !rateFtError && !rateNodeError && !saving;

  const applyTemplate = (id: string | null) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (t.client) setClient(t.client);
    setRateFt(t.ratePerFoot != null ? String(t.ratePerFoot) : '');
    setRateNode(t.ratePerNode != null ? String(t.ratePerNode) : '');
    // Templates carry a default span kind; use it to suggest the work type and walk mode.
    if (!existing) {
      setWorkType(t.defaultSpanKind === 'underground' ? 'underground' : 'aerial');
      setWalkMode(true);
    }
  };

  const onWorkType = (w: WorkType) => {
    setWorkType(w);
    // QC audits usually hop between existing assets, so auto-connecting spans is off by default.
    if (!existing) setWalkMode(w !== 'qc');
  };

  const earningsExample = useMemo(() => {
    if (pFt == null || Number.isNaN(pFt)) return null;
    return `At $${pFt}/ft, 1,000 ft pays $${(pFt * 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })}.`;
  }, [pFt]);

  const save = async () => {
    setTouchedName(true);
    if (!canSave) return;
    setSaving(true);
    try {
      const data: Partial<Project> & { name: string } = {
        name: name.trim(),
        client: client.trim(),
        jobNumber: jobNumber.trim(),
        workType,
        templateId,
        ratePerFoot: pFt as number | null,
        ratePerNode: pNode as number | null,
        walkMode,
        notes,
      };
      if (existing) {
        await updateProject(existing.id, data);
        router.back();
      } else {
        const p = await createProject(data);
        router.replace(`/project/${p.id}`);
      }
    } catch (err) {
      notify('Could not save the project', err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  if (projectId && !existing) {
    return (
      <PageScroll>
        <T color={colors.textMuted}>This project no longer exists on this device.</T>
      </PageScroll>
    );
  }

  return (
    <PageScroll
      footer={
        <Button
          title={existing ? 'Save changes' : 'Create project'}
          icon={existing ? 'checkmark' : 'arrow-forward'}
          onPress={save}
          loading={saving}
          disabled={!name.trim() || !!rateFtError || !!rateNodeError}
        />
      }
    >
      <View style={{ gap: space.lg }}>
        <Field
          label="Project name *"
          value={name}
          onChangeText={setName}
          onBlur={() => setTouchedName(true)}
          placeholder="e.g. Hwy 31 fiber, Segment 4"
          autoFocus={!existing}
          returnKeyType="next"
          hint={nameError}
        />
        <View style={styles.row2}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <Field label="Client" value={client} onChangeText={setClient} placeholder="Who the job is for" />
          </View>
          <View style={{ flex: 1, minWidth: 160 }}>
            <Field label="Job number" value={jobNumber} onChangeText={setJobNumber} placeholder="Work order or job #" autoCapitalize="characters" />
          </View>
        </View>
      </View>

      <SectionTitle>Work type</SectionTitle>
      <View style={styles.wtGrid}>
        {WORK_TYPES.map((w) => {
          const m = WORK_TYPE_META[w];
          const on = w === workType;
          return (
            <Pressable
              key={w}
              onPress={() => onWorkType(w)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.wtItem, on && { borderColor: m.color, backgroundColor: m.color + '1A' }]}
            >
              <Ionicons name={m.icon} size={24} color={on ? m.color : colors.textMuted} />
              <T v="heading" color={on ? colors.text : colors.textMuted}>
                {m.label}
              </T>
              <T v="caption" color={colors.textFaint} numberOfLines={2}>
                {m.hint}
              </T>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>Client template</SectionTitle>
      <T v="caption" color={colors.textMuted} style={{ marginBottom: space.sm }}>
        A template fills in the client, pay rates, label style (how nodes get named) and the fields that must be filled before export.
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}>
        <TemplateChip label="No template" icon="remove-circle-outline" selected={templateId == null} onPress={() => applyTemplate(null)} />
        {templates.map((t) => (
          <TemplateChip
            key={t.id}
            label={t.name}
            sub={t.client || undefined}
            icon="albums-outline"
            selected={templateId === t.id}
            onPress={() => applyTemplate(t.id)}
          />
        ))}
        <TemplateChip label="New template" icon="add" onPress={() => router.push('/templates/new')} dashed />
      </ScrollView>

      <SectionTitle>Pay rates (optional)</SectionTitle>
      <Card style={{ gap: space.md }}>
        <T v="caption" color={colors.textMuted}>
          Add your rates to see estimated earnings as you map. Leave blank to hide money everywhere.
        </T>
        <View style={styles.row2}>
          <View style={{ flex: 1, minWidth: 150 }}>
            <Field
              label="Per foot"
              value={rateFt}
              onChangeText={setRateFt}
              placeholder="0.00"
              keyboardType="decimal-pad"
              right={<Unit text="$/ft" />}
              hint={rateFtError ?? earningsExample ?? undefined}
            />
          </View>
          <View style={{ flex: 1, minWidth: 150 }}>
            <Field
              label="Per node"
              value={rateNode}
              onChangeText={setRateNode}
              placeholder="0.00"
              keyboardType="decimal-pad"
              right={<Unit text="$/node" />}
              hint={rateNodeError ?? 'For example, pay per pole fielded'}
            />
          </View>
        </View>
      </Card>

      <SectionTitle>Capture</SectionTitle>
      <Card>
        <ToggleRow
          label="Walk mode"
          hint="Each new photo connects to the last one with a span automatically. Great for walking a line pole to pole. Turn off when you are jumping around."
          value={walkMode}
          onChange={setWalkMode}
        />
      </Card>

      <SectionTitle>Notes</SectionTitle>
      <Field
        label="Project notes"
        value={notes}
        onChangeText={setNotes}
        placeholder="Gate codes, contacts, permit numbers..."
        multiline
        style={{ minHeight: 88, color: colors.text, fontSize: 16, padding: space.md, textAlignVertical: 'top', flex: 1 }}
      />
    </PageScroll>
  );
}

function Unit({ text }: { text: string }) {
  return (
    <T v="label" color={colors.textMuted} style={[font.mono, { paddingHorizontal: space.sm }]}>
      {text}
    </T>
  );
}

function TemplateChip({
  label,
  sub,
  icon,
  selected,
  onPress,
  dashed,
}: {
  label: string;
  sub?: string;
  icon: 'remove-circle-outline' | 'albums-outline' | 'add';
  selected?: boolean;
  onPress: () => void;
  dashed?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.tplChip,
        dashed && { borderStyle: 'dashed' },
        selected && { borderColor: colors.accent, backgroundColor: colors.accent + '1A' },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Ionicons name={selected ? 'checkmark-circle' : icon} size={20} color={selected ? colors.accent : colors.textMuted} />
      <View>
        <T v="heading" numberOfLines={1}>
          {label}
        </T>
        {sub ? (
          <T v="caption" color={colors.textMuted} numberOfLines={1}>
            {sub}
          </T>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row2: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  wtGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  wtItem: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: 96,
    padding: space.md,
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tplChip: {
    minHeight: 56,
    maxWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
