// Anthropic API key storage: expo-secure-store (Keychain / Keystore) on native, localStorage on web.
// Web storage is NOT secure; the settings UI should say so and recommend proxy mode for shared machines.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'linemap.anthropic_api_key';

function webStorage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export async function getApiKey(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return webStorage()?.getItem(KEY) || null;
    return (await SecureStore.getItemAsync(KEY)) || null;
  } catch {
    return null;
  }
}

/** Saves the key, or deletes it when null/empty. */
export async function setApiKey(key: string | null): Promise<void> {
  const value = key?.trim() || null;
  if (Platform.OS === 'web') {
    try {
      const s = webStorage();
      if (value) s?.setItem(KEY, value);
      else s?.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
    return;
  }
  if (value) await SecureStore.setItemAsync(KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(KEY);
}

/** "sk-ant-...abcd" style mask for display. */
export function maskApiKey(key: string | null): string {
  if (!key) return '';
  return key.length <= 12 ? '****' : `${key.slice(0, 7)}...${key.slice(-4)}`;
}
