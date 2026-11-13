// create-checkout: starts a Stripe Checkout session for a company's subscription (Supabase Edge
// Function, Deno). Called by the web dashboard's Billing page; the browser is then sent to the
// returned Stripe URL. Only an owner or admin of the company may call it.
//
// Request:  POST, Authorization: Bearer <user JWT>, JSON { orgId, plan, interval, seats }
//           plan: starter | pro | enterprise, interval: month | year, seats: whole number
// Response: 200 { url }  or  non-2xx { error, code }
//   400 bad_request       malformed body, or seats outside the plan's range
//   401 unauthorized      not signed in / session expired
//   403 forbidden         not an owner or admin of that company
//   409 has_subscription  the company already has a live subscription: use billing-portal instead
//   500 server_config     missing secrets or no Stripe price configured for that plan + interval
//   502 stripe            Stripe refused or could not be reached
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_STARTER / _PRO / _ENTERPRISE (same as stripe-webhook;
// comma-separated monthly and yearly price ids), WEB_APP_URL (https://your-site, used for the
// return links). Optional: STRIPE_AUTOMATIC_TAX=1 to let Stripe Tax calculate sales tax.
//
// What the stripe-webhook function relies on (keep these):
//   client_reference_id = org id, subscription_data.metadata.org_id = org id,
//   the price id must be listed in STRIPE_PRICE_<PLAN>, quantity = seats.

import Stripe from 'npm:stripe@17';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { errorJson, handleCors, json } from '../_shared/cors.ts';
import {
  BILLING_ROLES,
  carryOverTrialEnd,
  checkoutUrls,
  LIVE_SUBSCRIPTION_STATUSES,
  normalizeWebAppUrl,
  parseCheckoutBody,
  PLAN_PRICE_ENV,
  pickPrice,
  resolveSeats,
  splitPriceIds,
  type Interval,
  type PaidPlan,
  type PriceInfo,
} from './logic.ts';

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface OrgRow {
  id: string;
  name: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  trial_ends_at: string | null;
}

/** Price lookups are cached for the life of the function instance (prices rarely change). */
const priceCache = new Map<string, PriceInfo>();

async function priceFor(stripe: Stripe, plan: PaidPlan, interval: Interval): Promise<string> {
  const ids = splitPriceIds(Deno.env.get(PLAN_PRICE_ENV[plan]));
  const infos: PriceInfo[] = [];
  for (const id of ids) {
    let info = priceCache.get(id);
    if (!info) {
      const p = await stripe.prices.retrieve(id);
      info = {
        id: p.id,
        active: p.active,
        interval: p.recurring?.interval ?? null,
        intervalCount: p.recurring?.interval_count ?? 0,
        usageType: p.recurring?.usage_type ?? null,
      };
      priceCache.set(id, info);
    }
    infos.push(info);
  }
  const picked = pickPrice(infos, interval);
  if (!picked) {
    throw new HttpError(
      500,
      'server_config',
      `No ${interval === 'year' ? 'yearly' : 'monthly'} price is set up for the ${plan} plan yet. Contact support.`,
    );
  }
  return picked;
}

/** Signed-in user, and their role in the org (owner/admin required). */
async function authorize(req: Request, url: string, anonKey: string, admin: SupabaseClient, orgId: string) {
  const token = (req.headers.get('Authorization') ?? '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'unauthorized', 'Sign in required');
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'unauthorized', 'Session expired. Sign in again.');
  const user = data.user;

  const { data: m, error: mErr } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (mErr) throw new HttpError(500, 'server_error', 'Could not check your role');
  const role = (m as { role: string } | null)?.role;
  if (!role || !BILLING_ROLES.includes(role)) {
    throw new HttpError(403, 'forbidden', 'Only an owner or admin of this company can manage billing.');
  }
  return user;
}

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
    console.error('create-checkout: missing secrets (SUPABASE_*, STRIPE_SECRET_KEY or a valid https WEB_APP_URL)');
    return errorJson(500, 'Billing is not configured yet', { code: 'server_config' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new HttpError(400, 'bad_request', 'Body must be valid JSON');
    }
    const parsed = parseCheckoutBody(raw);
    if (!parsed.ok) throw new HttpError(400, 'bad_request', parsed.error);
    const { orgId, plan, interval } = parsed.value;

    const user = await authorize(req, SUPABASE_URL, ANON_KEY, admin, orgId);

    const { data: orgData, error: orgErr } = await admin
      .from('organizations')
      .select('id, name, stripe_customer_id, stripe_subscription_id, subscription_status, trial_ends_at')
      .eq('id', orgId)
      .single();
    if (orgErr || !orgData) throw new HttpError(403, 'forbidden', 'Organization not found');
    const org = orgData as OrgRow;

    if (org.stripe_subscription_id && LIVE_SUBSCRIPTION_STATUSES.includes(org.subscription_status)) {
      throw new HttpError(409, 'has_subscription', 'This company already has a subscription. Use Manage billing to change plan or seats.');
    }

    const { count, error: cErr } = await admin
      .from('org_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', orgId);
    if (cErr) throw new HttpError(500, 'server_error', 'Could not count members');
    const seats = resolveSeats(plan, parsed.value.seats, count ?? 1);
    if (!seats.ok) throw new HttpError(400, 'bad_request', seats.error);

    const price = await priceFor(stripe, plan, interval);

    // Reuse the company's Stripe customer, or create one and remember it. The idempotency key
    // makes two quick clicks create one customer, not two.
    let customerId = org.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create(
        { name: org.name, email: user.email ?? undefined, metadata: { org_id: org.id, created_by_user: user.id } },
        { idempotencyKey: `linemap-org-customer-${org.id}` },
      );
      const { data: saved, error: saveErr } = await admin
        .from('organizations')
        .update({ stripe_customer_id: customer.id })
        .eq('id', org.id)
        .is('stripe_customer_id', null)
        .select('stripe_customer_id');
      if (saveErr) throw new HttpError(500, 'server_error', 'Could not save the billing customer');
      if (saved && saved.length) {
        customerId = customer.id;
      } else {
        // Another request linked a customer first: use that one.
        const { data: again } = await admin.from('organizations').select('stripe_customer_id').eq('id', org.id).single();
        customerId = (again as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? customer.id;
      }
    }

    const urls = checkoutUrls(WEB_APP_URL);
    const automaticTax = Deno.env.get('STRIPE_AUTOMATIC_TAX') === '1';
    const trialEnd = carryOverTrialEnd(org.subscription_status, org.trial_ends_at, Date.now());

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: org.id,
      line_items: [{ price, quantity: seats.value }],
      subscription_data: {
        metadata: { org_id: org.id, plan },
        ...(trialEnd ? { trial_end: trialEnd } : {}),
      },
      metadata: { org_id: org.id, plan, interval },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      ...(automaticTax ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' as const, name: 'auto' as const } } : {}),
      success_url: urls.success,
      cancel_url: urls.cancel,
    });
    if (!session.url) throw new HttpError(502, 'stripe', 'Stripe did not return a checkout link');
    return json(200, { url: session.url });
  } catch (e) {
    if (e instanceof HttpError) return errorJson(e.status, e.message, { code: e.code });
    const se = e as { type?: string; message?: string };
    if (se?.type && String(se.type).startsWith('Stripe')) {
      console.error('create-checkout: stripe error', se.type, se.message);
      return errorJson(502, 'Stripe could not start checkout. Try again in a minute.', { code: 'stripe' });
    }
    console.error('create-checkout: failed', (e as Error)?.message);
    return errorJson(500, 'Could not start checkout', { code: 'server_error' });
  }
});
