// Backend configuration. Values come from EXPO_PUBLIC_* environment variables at build time
// (set them in .env locally, or as GitHub/EAS secrets for builds). The anon key is public by design:
// row-level security in the database is what protects company data.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
/** Public website (pricing, billing, admin dashboard, legal pages). */
export const WEB_APP_URL = process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://linemap.pro';

export const isBackendConfigured = () => SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/** URL of the analyze-photo Edge Function for company AI mode. */
export const aiProxyUrl = () => (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/analyze-photo` : null);
