// billing-portal: opens the Stripe Customer Portal for a company (Supabase Edge Function, Deno).
// The portal is Stripe's hosted page for changing plan or seats, updating the card, downloading
// invoices and canceling. Only an owner or admin of the company may call it.
//
// Request:  POST, Authorization: Bearer <user JWT>, JSON { orgId }
// Response: 200 { url }  or  non-2xx { error, code }
//   400 bad_request   malformed body
//   401 unauthorized  not signed in / session expired
//   403 forbidden     not an owner or admin of that company
//   409 no_customer   the company has never checked out, so there is nothing to manage yet
//   500 server_config missing secrets
//   502 stripe        Stripe refused or could not be reached (for example the portal is not
//                     configured in the Stripe dashboard yet)
//
// Secrets: STRIPE_SECRET_KEY, WEB_APP_URL. Optional: STRIPE_PORTAL_CONFIGURATION_ID (bpc_...) to
// use a specific portal configuration instead of the account default.
// Plan changes made in the portal reach the database through the stripe-webhook function.

import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { errorJson, handleCors, json } from '../_shared/cors.ts';
import { BILLING_ROLES, checkoutUrls, normalizeWebAppUrl, parseOrgBody } from '../create-checkout/logic.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handleCors(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorJson(405, 'Use POST', { code: 'method' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  const WEB_APP_URL = normalizeWebAppUrl(Deno.env.get('WEB_APP_URL'));
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY || !STRIPE_SECRET_KEY || !WEB_APP_URL) {
    console.error('billing-portal: missing secrets');
    return errorJson(500, 'Billing is not configured yet', { code: 'server_config' });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorJson(400, 'Body must be valid JSON', { code: 'bad_request' });
  }
  const parsed = parseOrgBody(raw);
  if (!parsed.ok) return errorJson(400, parsed.error, { code: 'bad_request' });
  const { orgId } = parsed.value;

  const token = (req.headers.get('Authorization') ?? '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return errorJson(401, 'Sign in required', { code: 'unauthorized' });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user) return errorJson(401, 'Session expired. Sign in again.', { code: 'unauthorized' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: m, error: mErr } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (mErr) return errorJson(500, 'Could not check your role', { code: 'server_error' });
  const role = (m as { role: string } | null)?.role;
  if (!role || !BILLING_ROLES.includes(role)) {
    return errorJson(403, 'Only an owner or admin of this company can manage billing.', { code: 'forbidden' });
  }

  const { data: org, error: orgErr } = await admin.from('organizations').select('stripe_customer_id').eq('id', orgId).single();
  if (orgErr || !org) return errorJson(403, 'Organization not found', { code: 'forbidden' });
  const customer = (org as { stripe_customer_id: string | null }).stripe_customer_id;
  if (!customer) {
    return errorJson(409, 'There is no billing account yet. Choose a plan first.', { code: 'no_customer' });
  }

  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
    const configuration = Deno.env.get('STRIPE_PORTAL_CONFIGURATION_ID') || undefined;
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: checkoutUrls(WEB_APP_URL).portalReturn,
      ...(configuration ? { configuration } : {}),
    });
    return json(200, { url: session.url });
  } catch (e) {
    console.error('billing-portal: stripe error', (e as Error)?.message);
    return errorJson(502, 'Could not open the billing portal. Try again in a minute.', { code: 'stripe' });
  }
});
