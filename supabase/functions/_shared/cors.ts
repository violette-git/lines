// Shared CORS + JSON helpers for Edge Functions (Deno).
// The mobile app does not need CORS, but the Expo web build and browser-based admin tools do.

const ALLOWED_ORIGIN = Deno.env.get('CORS_ALLOWED_ORIGIN') ?? '*';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** Returns a response for CORS preflight (OPTIONS), or null for any other method. */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

export function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/** Error response in the shape the app expects: non-2xx with { error: string }. */
export function errorJson(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
): Response {
  return json(status, { error, ...extra }, extraHeaders);
}
