// Tiny persisted flags for app-shell state (first run, onboarding seen).
// Native uses expo-secure-store (always available, no extra dependency); web uses localStorage.
// Every call is wrapped in try/catch: a failed read just means "not set".
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const PREFIX = 'linemap.';

export async function getFlag(key: string): Promise<string | null> {
  const k = PREFIX + key;
  try {
    if (Platform.OS === 'web') {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
    }
    return await SecureStore.getItemAsync(k);
  } catch {
    return null;
  }
}

export async function setFlag(key: string, value: string | null): Promise<void> {
  const k = PREFIX + key;
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return;
      if (value == null) localStorage.removeItem(k);
      else localStorage.setItem(k, value);
      return;
    }
    if (value == null) await SecureStore.deleteItemAsync(k);
    else await SecureStore.setItemAsync(k, value);
  } catch {
    // Non-critical: worst case the intro shows again.
  }
}

export const ONBOARDING_KEY = 'seenOnboarding';

export async function hasSeenOnboarding(): Promise<boolean | null> {
  const v = await getFlag(ONBOARDING_KEY);
  return v == null ? null : v === '1';
}

export function markOnboardingSeen(): Promise<void> {
  return setFlag(ONBOARDING_KEY, '1');
}

// AI photo analysis consent (App Store guideline 5.1.2(i)): the user must agree before photos are
// sent to a third-party AI. Stored as the ISO time of agreement; null means not agreed.
export const AI_CONSENT_KEY = 'aiConsentAt';

export interface AiConsent {
  /** ISO 8601 time the user agreed. */
  at: string;
}

export async function getAiConsent(): Promise<AiConsent | null> {
  const v = await getFlag(AI_CONSENT_KEY);
  if (!v) return null;
  return Number.isNaN(Date.parse(v)) ? null : { at: v };
}

/** Records agreement now (or clears it with null). Returns the stored record. */
export async function setAiConsent(agreed: boolean): Promise<AiConsent | null> {
  if (!agreed) {
    await setFlag(AI_CONSENT_KEY, null);
    return null;
  }
  const at = new Date().toISOString();
  await setFlag(AI_CONSENT_KEY, at);
  return { at };
}
