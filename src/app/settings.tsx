// App settings: account, units, map, GPS, duplicates, photos, AI (with consent), legal, about.
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { getApiKey, setApiKey } from '@/ai/keyStore';
import { useActiveOrg, useAuth } from '@/backend/authStore';
import { RoleBadge } from '@/backend/authUi';
import { LOGO_TILE } from '@/components/brand';
import { confirmAsync, notify } from '@/components/confirm';
import { PageScroll } from '@/components/Page';
import { Button, Card, Chip, Field, IconButton, SectionTitle, Segmented, T, ToggleRow } from '@/components/ui';
import type { AppSettings, Basemap } from '@/domain/types';
import { formatDateTime } from '@/features/common/format';
import { ensureAiConsent, requestAiConsent, useAiConsent } from '@/features/consent/AiConsentDialog';
import { formatLength } from '@/geo';
import { useStore } from '@/state/store';
import { syncNow, useSyncStatus } from '@/sync';
import { colors, font, radius, space, TOUCH } from '@/theme';

const GPS_OPTIONS: { s: number; title: string; body: string }[] = [
  { s: 2, title: 'Fastest', body: 'Good in open areas with a clear view of the sky. Expect the pin to wander a few feet more.' },
  { s: 4, title: 'Balanced (recommended)', body: 'A short hold that smooths out most GPS jitter without slowing you down.' },
  { s: 8, title: 'Steadier', body: 'For trees, tall buildings or poles close to each other. Hold still for 8 seconds.' },
  { s: 15, title: 'Most accurate', body: 'For heavy tree cover, downtown canyons or when the client needs tight positions.' },
];

const DUP_RADII_M = [2, 4, 6, 10];
const ICON_SCALES: { v: number; label: string }[] = [
  { v: 0.75, label: 'S' },
  { v: 1, label: 'M' },
  { v: 1.25, label: 'L' },
  { v: 1.5, label: 'XL' },
  { v: 2, label: 'XXL' },
];

// Rough per-photo cost: one phone photo plus the field list is about 2,500 input tokens and
// about 600 output tokens. Prices are per million tokens as published in late 2026.
const MODELS: { id: string; name: string; tag: string; body: string; cost: string; icon: 'speedometer-outline' | 'flash-outline' | 'diamond-outline' }[] = [
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    tag: 'Recommended',
    body: 'Best balance of accuracy, speed and cost for reading tags, lids and equipment.',
    cost: 'About 1 cent per photo',
    icon: 'speedometer-outline',
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    tag: 'Cheapest and fastest',
    body: 'Fine for simple fields like material and owner. Misses more small text.',
    cost: 'Under a tenth of a cent per photo',
    icon: 'flash-outline',
  },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    tag: 'Most accurate',
    body: 'Best on hard photos: busy poles, faded tags, poor light. Slower and the most expensive.',
    cost: 'About 2 cents per photo',
    icon: 'diamond-outline',
  },
];

export default function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const set = (patch: Partial<AppSettings>) => {
    saveSettings(patch).catch((err: unknown) => notify('Could not save setting', err instanceof Error ? err.message : String(err)));
  };
  const imperial = settings.units === 'imperial';
  const gps = GPS_OPTIONS.find((o) => o.s === settings.gpsAverageSeconds);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const signedIn = useAuth((s) => s.session != null);

  return (
    <PageScroll>
      <AccountCard />

      <SyncSection wifiOnly={settings.syncPhotosWifiOnly !== false} onWifiOnly={(syncPhotosWifiOnly) => set({ syncPhotosWifiOnly })} />

      <SectionTitle>Units</SectionTitle>
      <Segmented
        value={settings.units}
        onChange={(units) => set({ units })}
        options={[
          { value: 'imperial', label: 'Feet (imperial)' },
          { value: 'metric', label: 'Meters (metric)' },
        ]}
      />

      <SectionTitle>Map</SectionTitle>
      <Card style={{ gap: space.lg }}>
        <View style={{ gap: space.sm }}>
          <T v="heading">Default basemap</T>
          <T v="caption" color={colors.textMuted}>
            The background imagery under your nodes. Satellite helps you line nodes up with real poles; streets loads faster on weak signal.
          </T>
          <Segmented<Basemap>
            value={settings.basemap}
            onChange={(basemap) => set({ basemap })}
            options={[
              { value: 'satellite', label: 'Satellite', icon: 'earth' },
              { value: 'hybrid', label: 'Hybrid', icon: 'layers' },
              { value: 'streets', label: 'Streets', icon: 'map' },
            ]}
          />
        </View>
        <View style={{ gap: space.sm }}>
          <T v="heading">Map icon size</T>
          <T v="caption" color={colors.textMuted}>
            Bigger icons are easier to tap with gloves. You can also resize a single node from its editor.
          </T>
          <View style={styles.iconSizes}>
            {ICON_SCALES.map((o) => {
              const on = Math.abs(settings.globalIconScale - o.v) < 0.01;
              return (
                <Pressable
                  key={o.v}
                  onPress={() => set({ globalIconScale: o.v })}
                  accessibilityRole="button"
                  accessibilityLabel={`Icon size ${o.label}`}
                  accessibilityState={{ selected: on }}
                  style={[styles.sizeBtn, on && { borderColor: colors.accent, backgroundColor: colors.accent + '1A' }]}
                >
                  <View style={[styles.sizeDot, { width: 12 * o.v + 4, height: 12 * o.v + 4, borderRadius: 12 * o.v }]} />
                  <T v="label" color={on ? colors.accent : colors.textMuted}>
                    {o.label}
                  </T>
                </Pressable>
              );
            })}
          </View>
        </View>
        <LinkRow
          icon="cloud-download-outline"
          title="Offline maps and map source"
          body="Download map areas for no-signal work, and choose where map imagery comes from."
          onPress={() => router.push('/offline-maps' as never)}
        />
      </Card>

      <SectionTitle>GPS</SectionTitle>
      <Card style={{ gap: space.md }}>
        <T v="heading">Averaging time per capture</T>
        <T v="caption" color={colors.textMuted}>
          The app takes GPS readings for a few seconds and averages them. Longer is more accurate; shorter is faster.
        </T>
        <View style={styles.chipRow}>
          {GPS_OPTIONS.map((o) => (
            <Chip key={o.s} label={`${o.s} s`} selected={settings.gpsAverageSeconds === o.s} onPress={() => set({ gpsAverageSeconds: o.s })} />
          ))}
        </View>
        {gps ? (
          <View style={styles.explain}>
            <Ionicons name="locate" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <T v="label">{gps.title}</T>
              <T v="caption" color={colors.textMuted}>
                {gps.body}
              </T>
            </View>
          </View>
        ) : null}
        <LinkRow
          icon="radio-outline"
          title="GPS receiver"
          body={
            settings.gpsSource === 'external_tcp'
              ? `Using an external receiver${settings.receiverHost ? ` at ${settings.receiverHost}` : ''}. Tap to change or check its status.`
              : 'Using phone location. Connect an RTK receiver for centimeter-level positions.'
          }
          onPress={() => router.push('/gps-receiver' as never)}
        />
      </Card>

      <SectionTitle>Duplicate check</SectionTitle>
      <Card style={{ gap: space.md }}>
        <T v="heading">Flag possible duplicates within</T>
        <T v="caption" color={colors.textMuted}>
          If you capture a node of the same type this close to an existing one, it gets flagged so you can check you did not map it twice.
        </T>
        <View style={styles.chipRow}>
          {DUP_RADII_M.map((m) => (
            <Chip
              key={m}
              label={imperial ? formatLength(m * 3.28084, 'imperial') : `${m} m`}
              selected={settings.duplicateRadiusM === m}
              onPress={() => set({ duplicateRadiusM: m })}
            />
          ))}
        </View>
      </Card>

      <SectionTitle>Photos</SectionTitle>
      <Card>
        <ToggleRow
          label="Watermark photos"
          hint="Stamps GPS position, time, project and node label onto a copy of each photo. The original is always kept. Client templates can override this."
          value={settings.watermarkPhotos}
          onChange={(watermarkPhotos) => set({ watermarkPhotos })}
        />
      </Card>

      <AiSection settings={settings} set={set} signedIn={signedIn} />

      <SectionTitle>Legal and support</SectionTitle>
      <Card style={{ gap: space.xs, paddingVertical: space.sm }}>
        <LinkRow icon="shield-checkmark-outline" title="Privacy policy" body="What we collect, why, and your choices." onPress={() => router.push('/legal/privacy')} />
        <LinkRow icon="document-text-outline" title="Terms of use" body="The rules for using LineMap Pro, including field safety." onPress={() => router.push('/legal/terms')} />
        <LinkRow icon="help-buoy-outline" title="Support" body="Common questions and how to reach us." onPress={() => router.push('/support')} />
      </Card>

      <SectionTitle>About</SectionTitle>
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Image source={LOGO_TILE} style={styles.logo} contentFit="contain" accessibilityLabel="LineMap Pro logo" />
          <View style={{ flex: 1 }}>
            <T v="heading">LineMap Pro</T>
            <T v="caption" color={colors.textMuted} style={font.mono}>
              Version {version} ({Platform.OS})
            </T>
          </View>
        </View>
        <View style={styles.chipRow}>
          <Button title="Help and how-to" kind="secondary" icon="help-circle-outline" compact onPress={() => router.push('/help')} />
          <Button title="Replay intro" kind="secondary" icon="play-circle-outline" compact onPress={() => router.push('/onboarding')} />
        </View>
        <T v="caption" color={colors.textFaint}>
          {signedIn
            ? 'Company projects sync to your company when you have signal, and a copy stays on this device for offline work. Projects you keep local stay only on this device; export them regularly to keep a copy.'
            : 'You are not signed in, so all projects and photos stay on this device. Export regularly to keep a copy, or sign in to sync projects with your company.'}
        </T>
      </Card>
    </PageScroll>
  );
}

function AiSection({ settings, set, signedIn }: { settings: AppSettings; set: (p: Partial<AppSettings>) => void; signedIn: boolean }) {
  const off = settings.aiMode === 'off';
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const consent = useAiConsent();

  // Existing installs that turned AI on before consent was asked: ask once here (decline turns AI off).
  useEffect(() => {
    if (consent === null && settings.aiMode !== 'off') void ensureAiConsent();
    // Only when the loaded consent state first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consent]);

  const changeMode = async (aiMode: AppSettings['aiMode']) => {
    if (aiMode === settings.aiMode) return;
    if (aiMode !== 'off' && !consent) {
      // Photos may only leave the device after the user agrees in the app.
      const answer = await requestAiConsent(aiMode);
      if (answer !== 'accepted') return;
    }
    set({ aiMode });
  };
  return (
    <>
      <SectionTitle>AI auto-fill</SectionTitle>
      <Card style={{ gap: space.md }}>
        <T v="caption" color={colors.textMuted}>
          AI looks at each photo and fills in fields like pole tag, owner, material and attachment count. Every value shows a confidence score, and heights are
          marked as estimates. You always have the final say.
        </T>
        <Segmented<AppSettings['aiMode']>
          value={settings.aiMode}
          onChange={(aiMode) => void changeMode(aiMode)}
          options={[
            { value: 'off', label: 'Off', icon: 'close-circle-outline' },
            { value: 'direct', label: 'My key', icon: 'key-outline' },
            { value: 'proxy', label: 'Company', icon: 'business-outline' },
          ]}
        />
        {backendEnabled && !signedIn ? (
          <View style={styles.explain}>
            <Ionicons name="business-outline" size={18} color={colors.textMuted} />
            <View style={{ flex: 1, gap: space.sm }}>
              <T v="caption" color={colors.textMuted}>
                Sign in to use company AI. Your company pays for it and keeps the AI key off crew devices.
              </T>
              <Button title="Sign in" kind="secondary" icon="log-in-outline" compact onPress={() => router.push('/auth/sign-in' as never)} style={{ alignSelf: 'flex-start' }} />
            </View>
          </View>
        ) : null}
        {settings.aiMode === 'direct' ? <ApiKeyEditor /> : null}
        {settings.aiMode === 'proxy' ? <ProxyEditor value={settings.proxyUrl} onSave={(proxyUrl) => set({ proxyUrl })} /> : null}
        {consent ? (
          <T v="caption" color={colors.textFaint}>
            You agreed to AI photo analysis on {formatDateTime(consent.at)}. Photos go to Anthropic only while AI is on.
          </T>
        ) : null}
      </Card>

      <View style={[{ gap: space.sm, marginTop: space.md }, off && { opacity: 0.45 }]} pointerEvents={off ? 'none' : 'auto'}>
        <T v="label" color={colors.textMuted}>
          Model
        </T>
        {MODELS.map((m) => {
          const on = settings.aiModel === m.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => set({ aiModel: m.id })}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={[styles.model, on && { borderColor: colors.accent, backgroundColor: colors.accent + '12' }]}
            >
              <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.accent : colors.textMuted} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                  <T v="heading">{m.name}</T>
                  <View style={[styles.tag, on && { backgroundColor: colors.accent }]}>
                    <T v="caption" color={on ? colors.onAccent : colors.textMuted}>
                      {m.tag}
                    </T>
                  </View>
                </View>
                <T v="caption" color={colors.textMuted}>
                  {m.body}
                </T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="cash-outline" size={13} color={colors.success} />
                  <T v="caption" color={colors.success}>
                    {m.cost}
                  </T>
                </View>
              </View>
            </Pressable>
          );
        })}
        <T v="caption" color={colors.textFaint}>
          Costs are rough estimates for one photo at list prices and can change. A full day of 300 photos on Sonnet is roughly 3 dollars.
        </T>
        <Card style={{ marginTop: space.sm }}>
          <ToggleRow
            label="Run AI on every capture"
            hint="Fills fields in the background while you walk to the next node. Turn off to run it only when you tap the AI button on a node."
            value={settings.aiAutoRun}
            onChange={(aiAutoRun) => set({ aiAutoRun })}
          />
        </Card>
      </View>
    </>
  );
}

function AccountCard() {
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const restored = useAuth((s) => s.restored);
  const email = useAuth((s) => s.user?.email ?? null);
  const signedIn = useAuth((s) => s.session != null);
  const role = useAuth((s) => s.role);
  const org = useActiveOrg();

  if (!backendEnabled) {
    return (
      <Card style={styles.accountCard}>
        <View style={styles.accountHead}>
          <Ionicons name="phone-portrait-outline" size={22} color={colors.textMuted} />
          <View style={{ flex: 1 }}>
            <T v="heading">On this device only</T>
            <T v="caption" color={colors.textFaint}>
              Company accounts are not set up in this build.
            </T>
          </View>
        </View>
      </Card>
    );
  }

  if (!signedIn) {
    return (
      <Card style={styles.accountCard}>
        <View style={styles.accountHead}>
          <Ionicons name="person-circle-outline" size={28} color={colors.textMuted} />
          <View style={{ flex: 1 }}>
            <T v="heading">{restored ? 'Not signed in' : 'Checking your account...'}</T>
            <T v="caption" color={colors.textMuted}>
              You are using local-only mode: projects and photos stay on this device. Sign in to share projects with your company and use company AI.
            </T>
          </View>
        </View>
        <View style={styles.chipRow}>
          <Button title="Sign in" icon="log-in-outline" compact onPress={() => router.push('/auth/sign-in' as never)} style={{ flexGrow: 1 }} />
          <Button title="Create account" kind="secondary" icon="person-add-outline" compact onPress={() => router.push('/auth/sign-up' as never)} style={{ flexGrow: 1 }} />
        </View>
      </Card>
    );
  }

  return (
    <Card style={styles.accountCard}>
      <View style={styles.accountHead}>
        <Ionicons name="person-circle" size={28} color={colors.accent} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T v="heading" numberOfLines={1}>
            {email ?? 'Signed in'}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <T v="caption" color={colors.textMuted} numberOfLines={1}>
              {org ? org.name : 'No company selected'}
            </T>
            {role ? <RoleBadge role={role} /> : null}
          </View>
        </View>
      </View>
      <View style={styles.chipRow}>
        <Button title="Account" kind="secondary" icon="person-outline" compact onPress={() => router.push('/account' as never)} style={{ flexGrow: 1 }} />
        <Button title={org ? 'Switch company' : 'Choose company'} kind="secondary" icon="business-outline" compact onPress={() => router.push('/org/select' as never)} style={{ flexGrow: 1 }} />
      </View>
    </Card>
  );
}

function SyncSection({ wifiOnly, onWifiOnly }: { wifiOnly: boolean; onWifiOnly: (v: boolean) => void }) {
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const signedIn = useAuth((s) => s.session != null);
  const sync = useSyncStatus();
  const [busy, setBusy] = useState(false);
  if (!backendEnabled) return null;

  const active = signedIn && !!sync.activeOrgId && sync.phase !== 'disabled';
  const waiting = sync.pendingChanges + sync.pendingPhotos;
  const status = !signedIn
    ? 'Sign in to sync company projects.'
    : !sync.activeOrgId
      ? 'Choose a company to sync its projects.'
      : sync.error
        ? `Problem: ${sync.error}`
        : [
            sync.lastSyncedAt ? `Last synced ${formatDateTime(sync.lastSyncedAt)}` : 'Not synced yet',
            waiting ? `${waiting} waiting to upload` : null,
          ]
            .filter(Boolean)
            .join('. ');

  return (
    <>
      <SectionTitle>Sync</SectionTitle>
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Ionicons name={sync.error ? 'alert-circle-outline' : 'cloud-done-outline'} size={22} color={sync.error ? colors.danger : colors.accent} />
          <T v="caption" color={sync.error ? colors.danger : colors.textMuted} style={{ flex: 1 }}>
            {status}
          </T>
          <Button
            title="Sync now"
            icon="sync-outline"
            kind="secondary"
            compact
            disabled={!active}
            loading={busy}
            onPress={() => {
              setBusy(true);
              syncNow()
                .catch((err: unknown) => notify('Sync did not finish', err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }}
          />
        </View>
        <ToggleRow
          label="Upload photos on Wi-Fi only"
          hint="Field data (nodes, spans, notes) still syncs on cellular. Photos wait for Wi-Fi to save your data plan."
          value={wifiOnly}
          onChange={onWifiOnly}
        />
      </Card>
    </>
  );
}

function LinkRow({ icon, title, body, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      <Ionicons name={icon} size={22} color={colors.accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="heading">{title}</T>
        {body ? (
          <T v="caption" color={colors.textMuted}>
            {body}
          </T>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
    </Pressable>
  );
}

function ApiKeyEditor() {
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getApiKey()
      .then((k) => alive && setSaved(k))
      .catch(() => alive && setSaved(null));
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    const k = draft.trim();
    if (!k) return;
    if (!k.startsWith('sk-')) {
      const ok = await confirmAsync({
        title: 'That does not look like an API key',
        message: 'Anthropic API keys usually start with "sk-". Save it anyway?',
        confirmLabel: 'Save',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await setApiKey(k);
      setSaved(k);
      setDraft('');
      setShow(false);
    } catch (err) {
      notify('Could not save the key', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirmAsync({ title: 'Remove API key?', message: 'AI auto-fill stops working until you add a key again.', confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      await setApiKey(null);
      setSaved(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.warn}>
        <Ionicons name="warning" size={20} color={colors.danger} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="label" color={colors.danger}>
            For the owner's own testing only
          </T>
          <T v="caption" color={colors.textMuted}>
            Your key is stored on this device and billed to your Anthropic account. Do not use this mode on phones or tablets you hand to other people; anyone
            with the device could run up charges. For crews, use Company server.
          </T>
        </View>
      </View>

      {saved ? (
        <View style={styles.keyRow}>
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <View style={{ flex: 1 }}>
            <T v="label">Key saved</T>
            <T v="caption" color={colors.textMuted} style={font.mono}>
              {`sk-...${saved.slice(-4)}`}
            </T>
          </View>
          <Button title="Remove" kind="ghost" icon="trash-outline" compact onPress={remove} disabled={busy} />
        </View>
      ) : saved === null ? (
        <T v="caption" color={colors.warning}>
          No key saved yet. AI will not run until you add one.
        </T>
      ) : null}

      <Field
        label={saved ? 'Replace key' : 'Anthropic API key'}
        value={draft}
        onChangeText={setDraft}
        placeholder="sk-ant-..."
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="password"
        importantForAutofill="no"
        onSubmitEditing={save}
        right={<IconButton icon={show ? 'eye-off-outline' : 'eye-outline'} label={show ? 'Hide key' : 'Show key'} size={44} onPress={() => setShow((v) => !v)} style={{ borderWidth: 0, backgroundColor: 'transparent' }} />}
        hint="Create a key in the Anthropic Console. It never leaves this device except to call the API."
      />
      <Button title="Save key" icon="key" onPress={save} loading={busy} disabled={!draft.trim()} />
    </View>
  );
}

function ProxyEditor({ value, onSave }: { value: string | null; onSave: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  const trimmed = draft.trim();
  const valid = trimmed === '' || /^https:\/\/[^\s/]+/i.test(trimmed) || /^http:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.)/i.test(trimmed);
  const dirty = trimmed !== (value ?? '');
  return (
    <View style={{ gap: space.md }}>
      <Field
        label="Company server URL"
        value={draft}
        onChangeText={setDraft}
        placeholder="https://ai.yourcompany.com/analyze"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onSubmitEditing={() => valid && onSave(trimmed || null)}
        hint={valid ? 'Your company runs this server and keeps the API key off crew devices. Ask your office for the address.' : 'Use a full address starting with https://'}
      />
      <Button title={dirty ? 'Save server' : 'Saved'} icon="cloud-done-outline" kind={dirty ? 'primary' : 'secondary'} disabled={!dirty || !valid} onPress={() => onSave(trimmed || null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  iconSizes: { flexDirection: 'row', gap: space.sm },
  sizeBtn: {
    flex: 1,
    minHeight: TOUCH + 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  sizeDot: { backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.onAccent },
  explain: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  logo: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  accountCard: { gap: space.md, marginBottom: space.sm },
  accountHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    marginHorizontal: -space.sm,
    borderRadius: radius.md,
  },
  model: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    minHeight: TOUCH,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  warn: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger + '66',
    backgroundColor: colors.danger + '14',
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
});
