// Single Supabase client for the app (phone and web). Sessions persist in AsyncStorage on phones
// (SecureStore has a 2 KB value limit, too small for session tokens) and localStorage on web.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { isBackendConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

/** Returns the client, or null when the backend is not configured (local-only mode). */
export function getSupabase(): SupabaseClient | null {
  if (!isBackendConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
      },
    });
    if (Platform.OS !== 'web') {
      // Refresh tokens only while the app is in the foreground.
      AppState.addEventListener('change', (state) => {
        if (state === 'active') client?.auth.startAutoRefresh();
        else client?.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}

/** For tests: inject a client (or a fake). */
export function __setSupabaseForTests(c: SupabaseClient | null) {
  client = c;
}
