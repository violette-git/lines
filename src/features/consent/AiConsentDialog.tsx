// In-app consent for AI photo analysis (App Store guideline 5.1.2(i): ask before personal data is
// sent to a third-party AI). Built on Modal because Alert is a no-op on web.
//
// Usage:
//  - Mount <AiConsentHost /> once (root layout). It renders the dialog for every request and, on
//    start-up, asks existing installs that already have AI on but never agreed.
//  - requestAiConsent(mode) opens the dialog and resolves 'accepted' | 'declined' | 'later'
//    ('later' = the user opened the privacy policy instead of answering).
//  - ensureAiConsent() is the guard for "Run AI" buttons: true when consent exists or was just
//    given; on decline it turns AI off.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { getAiConsent, setAiConsent, type AiConsent } from '@/components/prefs';
import { Button, T, type IconName } from '@/components/ui';
import { useStore } from '@/state/store';
import { colors, radius, space } from '@/theme';

export type AiConsentMode = 'direct' | 'proxy';
export type AiConsentAnswer = 'accepted' | 'declined' | 'later';

interface Pending {
  mode: AiConsentMode;
  resolve: (a: AiConsentAnswer) => void;
}

interface ConsentState {
  /** undefined while loading, null when the user has not agreed. */
  consent: AiConsent | null | undefined;
  pending: Pending | null;
}

const useConsentStore = create<ConsentState>(() => ({ consent: undefined, pending: null }));

let loading: Promise<AiConsent | null> | null = null;

/** Reads the stored consent (cached after the first read). */
export function loadAiConsent(): Promise<AiConsent | null> {
  const cur = useConsentStore.getState().consent;
  if (cur !== undefined) return Promise.resolve(cur);
  if (!loading) {
    loading = getAiConsent()
      .catch(() => null)
      .then((c) => {
        useConsentStore.setState({ consent: c });
        return c;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/** Current consent record for screens (undefined while loading). */
export function useAiConsent(): AiConsent | null | undefined {
  const consent = useConsentStore((s) => s.consent);
  useEffect(() => {
    if (consent === undefined) void loadAiConsent();
  }, [consent]);
  return consent;
}

/** Opens the consent dialog. Resolves when the user answers. */
export function requestAiConsent(mode: AiConsentMode): Promise<AiConsentAnswer> {
  return new Promise((resolve) => {
    const prev = useConsentStore.getState().pending;
    // Only one dialog at a time: a newer request replaces an unanswered older one.
    prev?.resolve('later');
    useConsentStore.setState({ pending: { mode, resolve } });
  });
}

function answer(a: AiConsentAnswer): void {
  const p = useConsentStore.getState().pending;
  if (!p) return;
  useConsentStore.setState({ pending: null });
  if (a === 'accepted') {
    void setAiConsent(true).then((c) => useConsentStore.setState({ consent: c }));
    // Show the new state right away; the write above confirms it.
    useConsentStore.setState({ consent: { at: new Date().toISOString() } });
  }
  p.resolve(a);
}

function modeNow(): AiConsentMode {
  return useStore.getState().settings.aiMode === 'direct' ? 'direct' : 'proxy';
}

/** Turns AI off (consent declined). Never throws. */
async function turnAiOff(): Promise<void> {
  try {
    await useStore.getState().saveSettings({ aiMode: 'off' });
  } catch {
    // The setting stays as it was; AI still asks again next time.
  }
}

/**
 * Guard before running AI. True when the user has agreed (now or earlier). On decline AI is turned
 * off; on 'later' nothing changes and AI does not run this time.
 */
export async function ensureAiConsent(): Promise<boolean> {
  if (useStore.getState().settings.aiMode === 'off') return false;
  if (await loadAiConsent()) return true;
  const a = await requestAiConsent(modeNow());
  if (a === 'accepted') return true;
  if (a === 'declined') await turnAiOff();
  return false;
}

/** For tests: forget cached state. */
export function __resetAiConsentForTests(): void {
  loading = null;
  useConsentStore.setState({ consent: undefined, pending: null });
}

// ------------------------------------------------------------------------------------------------

/** Renders pending consent requests; asks once at start-up when AI is on without consent. */
export function AiConsentHost() {
  const pending = useConsentStore((s) => s.pending);
  const ready = useStore((s) => s.ready);
  const aiMode = useStore((s) => s.settings.aiMode);

  useEffect(() => {
    if (!ready || aiMode === 'off') return;
    let alive = true;
    // Short delay so first-run redirects and deep links settle before the dialog appears.
    const t = setTimeout(() => {
      void (async () => {
        const c = await loadAiConsent();
        if (!alive || c || useConsentStore.getState().pending) return;
        if (useStore.getState().settings.aiMode === 'off') return;
        await ensureAiConsent();
      })();
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [ready, aiMode]);

  return (
    <AiConsentDialog
      visible={pending != null}
      mode={pending?.mode ?? 'proxy'}
      onAccept={() => answer('accepted')}
      onDecline={() => answer('declined')}
      onOpenPrivacy={() => {
        answer('later');
        // iOS can drop navigation started while a Modal is still closing.
        setTimeout(() => router.push('/legal/privacy'), Platform.OS === 'ios' ? 350 : 0);
      }}
    />
  );
}

export function AiConsentDialog({
  visible,
  mode,
  onAccept,
  onDecline,
  onOpenPrivacy,
}: {
  visible: boolean;
  mode: AiConsentMode;
  onAccept: () => void;
  onDecline: () => void;
  onOpenPrivacy?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const route =
    mode === 'proxy'
      ? "They go to your company's LineMap server, which checks your account and passes them to Anthropic."
      : 'They go straight from this device to Anthropic, billed to the API key you enter.';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline} statusBarTranslucent>
      <View style={[styles.backdrop, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.card} accessibilityViewIsModal accessibilityLabel="AI photo analysis consent">
          <ScrollView contentContainerStyle={styles.body} bounces={false}>
            <View style={styles.headIcon}>
              <Ionicons name="sparkles" size={26} color={colors.onAccent} />
            </View>
            <T v="title">Allow AI photo analysis?</T>
            <T color={colors.textMuted}>
              AI auto-fill uses Claude, an AI model made by Anthropic, to read photos and suggest field values. Before you turn it on, here is what happens.
            </T>

            <Point icon="cloud-upload-outline" title="What is sent">
              The photo being analyzed, the node type and the list of fields to fill, plus short project context (work type, client name and the
              previous node label). {route}
            </Point>
            <Point icon="list-outline" title="What comes back">
              Suggested values such as pole tag, owner, material and attachment count, each with a confidence score, and a short summary of what the AI saw.
              You can check, change or reject every value.
            </Point>
            <Point icon="shield-checkmark-outline" title="Training">
              Under Anthropic's commercial terms, API data is not used for model training.
            </Point>
            <Point icon="toggle-outline" title="Your choice">
              AI runs only while it is turned on. You can turn it off any time in Settings, and the app works fully without it.
            </Point>

            {onOpenPrivacy ? (
              <Pressable accessibilityRole="link" onPress={onOpenPrivacy} style={styles.link} hitSlop={6}>
                <Ionicons name="document-text-outline" size={16} color={colors.accent} />
                <T v="label" color={colors.accent} style={{ textDecorationLine: 'underline' }}>
                  Read the privacy policy (section 5)
                </T>
              </Pressable>
            ) : null}
          </ScrollView>
          <View style={styles.actions}>
            <Button title="Not now" kind="secondary" onPress={onDecline} style={{ flex: 1 }} />
            <Button title="Allow AI" icon="checkmark" onPress={onAccept} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Point({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <View style={styles.point}>
      <Ionicons name={icon} size={20} color={colors.accent} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="heading">{title}</T>
        <T v="caption" color={colors.textMuted} style={{ fontSize: 13, lineHeight: 18 }}>
          {children}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  body: { padding: space.lg, gap: space.md },
  headIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  point: { flexDirection: 'row', gap: space.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
