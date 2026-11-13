// Client template editor. Route id "new" creates a new template.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useCanManageProjects } from '@/backend/authStore';
import { confirmAsync, notify } from '@/components/confirm';
import { parseOptionalNumber } from '@/components/format';
import { PageScroll } from '@/components/Page';
import { Button, Card, Field, SectionTitle, Segmented, T, ToggleRow } from '@/components/ui';
import { makeLabel } from '@/domain/labels';
import { NODE_SCHEMAS, NODE_TYPE_META } from '@/domain/nodeSchemas';
import { NODE_TYPES, type ClientTemplate, type NodeType, type SpanKind } from '@/domain/types';
import { useStore } from '@/state/store';
import { colors, font, radius, space, TOUCH } from '@/theme';

type PatternKey = NodeType | '*';
const PATTERN_KEYS: PatternKey[] = [...NODE_TYPES.filter((t) => t !== 'custom'), '*'];
const TOKENS: { token: string; example: string; meaning: string }[] = [
  { token: '{seq}', example: '7', meaning: 'capture number' },
  { token: '{seq3}', example: '007', meaning: 'capture number padded to 3 digits' },
  { token: '{TYPE}', example: 'P', meaning: 'short type code' },
  { token: '{type}', example: 'Pole', meaning: 'type name' },
  { token: '{job}', example: 'J1042', meaning: 'project job number' },
];
const SAMPLE_JOB = 'J1042';

export default function TemplateEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const existing = useStore((s) => (isNew ? null : s.templates.find((t) => t.id === id) ?? null));
  const upsertTemplate = useStore((s) => s.upsertTemplate);
  const deleteTemplate = useStore((s) => s.deleteTemplate);
  // New templates are local to this device; company templates need manager or above to change.
  const canManage = useCanManageProjects(existing ? existing.orgId ?? null : null);
  const readOnly = !canManage;

  const [name, setName] = useState(existing?.name ?? '');
  const [client, setClient] = useState(existing?.client ?? '');
  const [patterns, setPatterns] = useState<Partial<Record<PatternKey, string>>>(existing?.labelPatterns ?? {});
  const [required, setRequired] = useState<Partial<Record<NodeType, string[]>>>(existing?.requiredFields ?? { pole: ['pole_tag', 'owner'] });
  const [spanKind, setSpanKind] = useState<SpanKind>(existing?.defaultSpanKind ?? 'aerial');
  const [sag, setSag] = useState(String(existing?.defaultSagPct ?? 2));
  const [slack, setSlack] = useState(String(existing?.defaultSlackFt ?? 0));
  const [rateFt, setRateFt] = useState(existing?.ratePerFoot != null ? String(existing.ratePerFoot) : '');
  const [rateNode, setRateNode] = useState(existing?.ratePerNode != null ? String(existing.ratePerNode) : '');
  const [watermark, setWatermark] = useState(existing?.watermarkPhotos ?? true);
  const [focused, setFocused] = useState<PatternKey>('pole');
  const [open, setOpen] = useState<NodeType | null>('pole');
  const [saving, setSaving] = useState(false);

  const cleanPatterns = useMemo(() => {
    const out: Partial<Record<PatternKey, string>> = {};
    for (const k of PATTERN_KEYS) {
      const v = patterns[k]?.trim();
      if (v) out[k] = v;
    }
    return out;
  }, [patterns]);

  const preview = (type: NodeType) => {
    const t = { labelPatterns: cleanPatterns } as ClientTemplate;
    return makeLabel(type, 7, { template: t, jobNumber: SAMPLE_JOB });
  };

  const nSag = parseOptionalNumber(sag);
  const nSlack = parseOptionalNumber(slack);
  const nRateFt = parseOptionalNumber(rateFt);
  const nRateNode = parseOptionalNumber(rateNode);
  const sagErr = nSag == null || Number.isNaN(nSag) || nSag < 0 || nSag > 20 ? 'Use 0 to 20 %' : undefined;
  const slackErr = nSlack == null || Number.isNaN(nSlack) || nSlack < 0 ? 'Use 0 or more feet' : undefined;
  const rateErr = Number.isNaN(nRateFt) || Number.isNaN(nRateNode) || (nRateFt ?? 0) < 0 || (nRateNode ?? 0) < 0 ? 'Rates must be numbers' : undefined;
  const canSave = !!name.trim() && !sagErr && !slackErr && !rateErr && !saving;

  const insertToken = (token: string) => {
    setPatterns((p) => ({ ...p, [focused]: (p[focused] ?? '') + token }));
  };

  const toggleRequired = (type: NodeType, key: string) => {
    setRequired((r) => {
      const cur = r[type] ?? [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { ...r, [type]: next };
    });
  };

  const save = async () => {
    if (!canSave || readOnly) return;
    setSaving(true);
    try {
      const req: Partial<Record<NodeType, string[]>> = {};
      for (const t of NODE_TYPES) if (required[t]?.length) req[t] = required[t];
      const data: Partial<ClientTemplate> & { name: string } = {
        name: name.trim(),
        client: client.trim(),
        labelPatterns: cleanPatterns,
        requiredFields: req,
        defaultSpanKind: spanKind,
        defaultSagPct: nSag as number,
        defaultSlackFt: nSlack as number,
        ratePerFoot: nRateFt as number | null,
        ratePerNode: nRateNode as number | null,
        watermarkPhotos: watermark,
      };
      // Only pass id when editing: the store generates one for new templates.
      await upsertTemplate(existing ? { ...data, id: existing.id } : data);
      router.back();
    } catch (err) {
      notify('Could not save template', err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing || readOnly) return;
    const ok = await confirmAsync({
      title: `Delete "${existing.name}"?`,
      message: 'Projects that use it keep their data and rates, but lose its label style and required-field checks.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteTemplate(existing.id);
    router.back();
  };

  if (!isNew && !existing) {
    return (
      <PageScroll>
        <Stack.Screen options={{ title: 'Template' }} />
        <T color={colors.textMuted}>This template no longer exists.</T>
      </PageScroll>
    );
  }

  return (
    <PageScroll
      footer={
        readOnly ? undefined : (
          <Button title={isNew ? 'Create template' : 'Save template'} icon="checkmark" onPress={save} loading={saving} disabled={!canSave} />
        )
      }
    >
      <Stack.Screen options={{ title: readOnly ? 'Template' : isNew ? 'New template' : 'Edit template' }} />
      {readOnly ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.lg }}>
          <Ionicons name="eye-outline" size={20} color={colors.textMuted} />
          <T v="caption" color={colors.textMuted} style={{ flex: 1 }}>
            View only. This is a company template; only a manager, admin or owner can change it.
          </T>
        </Card>
      ) : null}
      {/* View-only roles see the same layout with every control switched off. */}
      <View pointerEvents={readOnly ? 'none' : 'auto'} accessibilityState={{ disabled: readOnly }}>

        <View style={{ gap: space.lg }}>
          <Field label="Template name *" value={name} onChangeText={setName} placeholder="e.g. Acme Fiber aerial" autoFocus={isNew} />
          <Field label="Client" value={client} onChangeText={setClient} placeholder="Filled into new projects" />
        </View>

        <SectionTitle>Node labels</SectionTitle>
        <Card style={{ gap: space.md }}>
          <T v="caption" color={colors.textMuted}>
            A label pattern is how each new node gets named. Tap a token to add it to the selected row. Leave a row blank to use the "Everything else" pattern.
          </T>
          <T v="caption" color={colors.textMuted}>
            {'{seq}'} capture number, {'{seq3}'} padded to 3 digits, {'{TYPE}'} short code (P, HH), {'{type}'} full name (Pole), {'{job}'} job number.
          </T>
          <View style={styles.tokens}>
            {TOKENS.map((t) => (
              <Pressable
                key={t.token}
                onPress={() => insertToken(t.token)}
                accessibilityRole="button"
                accessibilityLabel={`Insert ${t.token}, ${t.meaning}`}
                style={({ pressed }) => [styles.token, pressed && { backgroundColor: colors.surfaceRaised }]}
              >
                <Ionicons name="add" size={14} color={colors.accent} />
                <T v="label" color={colors.accent} style={font.mono}>
                  {t.token}
                </T>
                <T v="caption" color={colors.textFaint} style={font.mono}>
                  {t.example}
                </T>
              </Pressable>
            ))}
          </View>
          {PATTERN_KEYS.map((k) => {
            const type: NodeType = k === '*' ? 'custom' : k;
            const meta = NODE_TYPE_META[type];
            const on = focused === k;
            return (
              <View key={k} style={[styles.patternRow, on && { borderColor: colors.accent }]}>
                <View style={[styles.typeDot, { backgroundColor: k === '*' ? colors.textFaint : meta.color }]} />
                <T v="label" style={{ width: 104 }} numberOfLines={1}>
                  {k === '*' ? 'Everything else' : meta.label}
                </T>
                <TextInput
                  value={patterns[k] ?? ''}
                  onChangeText={(v) => setPatterns((p) => ({ ...p, [k]: v }))}
                  onFocus={() => setFocused(k)}
                  placeholder={k === '*' ? 'N-{seq}' : `${meta.short}-{seq}`}
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.patternInput}
                  accessibilityLabel={`${k === '*' ? 'Default' : meta.label} label pattern`}
                />
                <View style={styles.previewPill}>
                  <T v="label" color={colors.text} style={font.mono} numberOfLines={1}>
                    {preview(type)}
                  </T>
                </View>
              </View>
            );
          })}
          <T v="caption" color={colors.textFaint}>
            Preview uses capture number 7 and job {SAMPLE_JOB}.
          </T>
        </Card>

        <SectionTitle>Required fields</SectionTitle>
        <T v="caption" color={colors.textMuted} style={{ marginBottom: space.sm }}>
          Export QC (quality check) warns you about any node missing these before you send files to the client.
        </T>
        <View style={{ gap: space.sm }}>
          {NODE_TYPES.map((type) => {
            const meta = NODE_TYPE_META[type];
            const fields = NODE_SCHEMAS[type];
            const sel = required[type] ?? [];
            const expanded = open === type;
            return (
              <View key={type} style={styles.acc}>
                <Pressable
                  onPress={() => setOpen(expanded ? null : type)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  style={styles.accHead}
                >
                  <View style={[styles.typeDot, { backgroundColor: meta.color }]} />
                  <T v="heading" style={{ flex: 1 }}>
                    {meta.label}
                  </T>
                  {sel.length ? (
                    <View style={styles.count}>
                      <T v="caption" color={colors.onAccent}>
                        {sel.length} required
                      </T>
                    </View>
                  ) : (
                    <T v="caption" color={colors.textFaint}>
                      None
                    </T>
                  )}
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
                </Pressable>
                {expanded ? (
                  <View style={{ paddingBottom: space.sm }}>
                    <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm }}>
                      <Button title="All" compact kind="secondary" onPress={() => setRequired((r) => ({ ...r, [type]: fields.map((f) => f.key) }))} />
                      <Button title="None" compact kind="secondary" onPress={() => setRequired((r) => ({ ...r, [type]: [] }))} />
                    </View>
                    {fields.map((f) => {
                      const checked = sel.includes(f.key);
                      return (
                        <Pressable
                          key={f.key}
                          onPress={() => toggleRequired(type, f.key)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked }}
                          style={({ pressed }) => [styles.checkRow, pressed && { backgroundColor: colors.surfaceRaised }]}
                        >
                          <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={checked ? colors.accent : colors.textMuted} />
                          <View style={{ flex: 1 }}>
                            <T>{f.label}</T>
                            {f.help ? (
                              <T v="caption" color={colors.textFaint}>
                                {f.help}
                              </T>
                            ) : null}
                          </View>
                          {f.aiFillable ? <Ionicons name="sparkles" size={14} color={colors.info} accessibilityLabel="AI can fill this" /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <SectionTitle>Span defaults</SectionTitle>
        <Card style={{ gap: space.md }}>
          <T v="caption" color={colors.textMuted}>
            A span is the cable run between two nodes. These values fill in new spans; you can change any span later.
          </T>
          <Segmented<SpanKind>
            value={spanKind}
            onChange={setSpanKind}
            options={[
              { value: 'aerial', label: 'Aerial', icon: 'git-commit-outline' },
              { value: 'underground', label: 'Underground', icon: 'layers-outline' },
            ]}
          />
          <View style={styles.row2}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Field label="Sag" value={sag} onChangeText={setSag} keyboardType="decimal-pad" right={<Unit text="%" />} hint={sagErr ?? 'Extra cable for droop on aerial spans, usually 1 to 3'} />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Field label="Slack" value={slack} onChangeText={setSlack} keyboardType="decimal-pad" right={<Unit text="ft" />} hint={slackErr ?? 'Coiled spare cable added per span'} />
            </View>
          </View>
        </Card>

        <SectionTitle>Pay rates</SectionTitle>
        <Card style={{ gap: space.md }}>
          <View style={styles.row2}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Field label="Per foot" value={rateFt} onChangeText={setRateFt} placeholder="Optional" keyboardType="decimal-pad" right={<Unit text="$/ft" />} />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Field label="Per node" value={rateNode} onChangeText={setRateNode} placeholder="Optional" keyboardType="decimal-pad" right={<Unit text="$/node" />} />
            </View>
          </View>
          {rateErr ? (
            <T v="caption" color={colors.danger}>
              {rateErr}
            </T>
          ) : null}
        </Card>

        <SectionTitle>Photos</SectionTitle>
        <Card>
          <ToggleRow label="Watermark photos" hint="Stamp GPS, time, project and node label on a copy of each photo." value={watermark} onChange={setWatermark} />
        </Card>

      </View>

      {existing && !readOnly ? (
        <View style={{ marginTop: space.xl }}>
          <Button title="Delete template" kind="ghost" icon="trash-outline" onPress={remove} style={{ borderWidth: 1, borderColor: colors.danger + '66' }} />
        </View>
      ) : null}
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

const styles = StyleSheet.create({
  tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  token: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  patternRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.md,
    paddingRight: 4,
    minHeight: TOUCH,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  typeDot: { width: 12, height: 12, borderRadius: 6 },
  patternInput: { flex: 1, minWidth: 60, minHeight: TOUCH - 6, color: colors.text, fontSize: 16, fontVariant: ['tabular-nums'] },
  previewPill: {
    maxWidth: 140,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  acc: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  accHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH + 4, paddingHorizontal: space.md },
  count: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.accent },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.md, paddingVertical: 6 },
  row2: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
});
