// Project details: name, client, job #, work type, template, pay rates, walk mode, status.
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Chip, Field, Segmented, SectionTitle, T, ToggleRow } from '@/components/ui';
import type { Project, WorkType } from '@/domain/types';
import { errorMessage } from '@/features/common/confirm';
import { successHaptic } from '@/features/common/haptics';
import { goBackOr, ScreenHeader } from '@/features/common/ScreenHeader';
import { useToast } from '@/features/common/Toast';
import { useStore } from '@/state/store';
import { colors, space } from '@/theme';

interface Draft {
  name: string;
  client: string;
  jobNumber: string;
  workType: WorkType;
  templateId: string | null;
  ratePerFoot: string;
  ratePerNode: string;
  walkMode: boolean;
  status: Project['status'];
  notes: string;
}

const toDraft = (p: Project): Draft => ({
  name: p.name,
  client: p.client,
  jobNumber: p.jobNumber,
  workType: p.workType,
  templateId: p.templateId,
  ratePerFoot: p.ratePerFoot != null ? String(p.ratePerFoot) : '',
  ratePerNode: p.ratePerNode != null ? String(p.ratePerNode) : '',
  walkMode: p.walkMode,
  status: p.status,
  notes: p.notes,
});

function parseRate(s: string): number | null | 'invalid' {
  const t = s.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

export default function EditProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const toast = useToast({ bottom: insets.bottom + 96 });
  const project = useStore((s) => s.projects.find((p) => p.id === id) ?? null);
  const templates = useStore((s) => s.templates);
  const ready = useStore((s) => s.ready);
  const updateProject = useStore((s) => s.updateProject);

  const [draft, setDraft] = useState<Draft | null>(project ? toDraft(project) : null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready) void useStore.getState().init();
  }, [ready]);
  useEffect(() => {
    if (project && !draft) setDraft(toDraft(project));
  }, [project, draft]);

  const back = () => goBackOr(`/project/${id}`);

  if (!project || !draft) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Project details" onBack={back} />
        <View style={styles.center}>
          {ready ? <T color={colors.textMuted}>Project not found.</T> : <ActivityIndicator color={colors.accent} />}
        </View>
      </View>
    );
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const pickTemplate = (tid: string | null) => {
    const t = tid ? templates.find((x) => x.id === tid) : null;
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, templateId: tid };
      if (t) {
        if (!d.client.trim() && t.client) next.client = t.client;
        if (!d.ratePerFoot.trim() && t.ratePerFoot != null) next.ratePerFoot = String(t.ratePerFoot);
        if (!d.ratePerNode.trim() && t.ratePerNode != null) next.ratePerNode = String(t.ratePerNode);
      }
      return next;
    });
  };

  const rf = parseRate(draft.ratePerFoot);
  const rn = parseRate(draft.ratePerNode);
  const nameOk = draft.name.trim().length > 0;
  const valid = nameOk && rf !== 'invalid' && rn !== 'invalid';

  const save = async () => {
    if (!nameOk || rf === 'invalid' || rn === 'invalid') return;
    setSaving(true);
    try {
      await updateProject(project.id, {
        name: draft.name.trim(),
        client: draft.client.trim(),
        jobNumber: draft.jobNumber.trim(),
        workType: draft.workType,
        templateId: draft.templateId,
        ratePerFoot: rf,
        ratePerNode: rn,
        walkMode: draft.walkMode,
        status: draft.status,
        notes: draft.notes,
      });
      successHaptic();
      back();
    } catch (e) {
      toast.show(`Could not save: ${errorMessage(e)}`, { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Project details" subtitle={project.name} onBack={back} backIcon="close" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]} keyboardShouldPersistTaps="handled">
          <Card style={{ gap: space.md }}>
            <Field
              label="Project name"
              value={draft.name}
              onChangeText={(v) => set('name', v)}
              placeholder="e.g. Oak St fiber extension"
              hint={nameOk ? undefined : 'A name is required'}
            />
            <Field label="Client" value={draft.client} onChangeText={(v) => set('client', v)} placeholder="Who is paying for this job" />
            <Field label="Job #" value={draft.jobNumber} onChangeText={(v) => set('jobNumber', v)} placeholder="Work order or job number" autoCapitalize="characters" />
          </Card>

          <SectionTitle>Work type</SectionTitle>
          <Segmented<WorkType>
            value={draft.workType}
            onChange={(v) => set('workType', v)}
            options={[
              { value: 'aerial', label: 'Aerial' },
              { value: 'underground', label: 'UG' },
              { value: 'mixed', label: 'Mixed' },
              { value: 'qc', label: 'QC' },
            ]}
          />

          <SectionTitle>Client template</SectionTitle>
          <T v="caption" color={colors.textMuted} style={{ marginBottom: space.sm }}>
            A template sets label patterns (like P-1), required fields, default values and rates for a client.
          </T>
          <View style={styles.chips}>
            <Chip label="None" selected={draft.templateId == null} onPress={() => pickTemplate(null)} />
            {templates.map((t) => (
              <Chip key={t.id} label={t.name} selected={draft.templateId === t.id} onPress={() => pickTemplate(t.id)} />
            ))}
          </View>

          <SectionTitle>Pay rates (for the earnings tally)</SectionTitle>
          <Card style={{ gap: space.md }}>
            <Field
              label="Per foot ($)"
              value={draft.ratePerFoot}
              onChangeText={(v) => set('ratePerFoot', v)}
              keyboardType="decimal-pad"
              placeholder="e.g. 0.85"
              hint={rf === 'invalid' ? 'Enter a number like 0.85' : 'Leave blank if you are not paid by the foot'}
            />
            <Field
              label="Per node ($)"
              value={draft.ratePerNode}
              onChangeText={(v) => set('ratePerNode', v)}
              keyboardType="decimal-pad"
              placeholder="e.g. 12"
              hint={rn === 'invalid' ? 'Enter a number like 12' : 'Pay per pole or handhole fielded, if any'}
            />
          </Card>

          <SectionTitle>Capture</SectionTitle>
          <Card>
            <ToggleRow
              label="Walk mode"
              hint="Each new capture auto-connects to the previous node with a span."
              value={draft.walkMode}
              onChange={(v) => set('walkMode', v)}
            />
          </Card>

          <SectionTitle>Status</SectionTitle>
          <Segmented<Project['status']>
            value={draft.status}
            onChange={(v) => set('status', v)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'complete', label: 'Complete' },
              { value: 'archived', label: 'Archived' },
            ]}
          />

          <SectionTitle>Notes</SectionTitle>
          <Field label="Project notes" value={draft.notes} onChangeText={(v) => set('notes', v)} multiline placeholder="Access, contacts, hazards" />
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <Button title="Cancel" kind="secondary" onPress={back} style={{ flex: 1 }} />
        <Button title="Save" icon="checkmark" onPress={save} loading={saving} disabled={!valid} style={{ flex: 2 }} />
      </View>
      {toast.node}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
