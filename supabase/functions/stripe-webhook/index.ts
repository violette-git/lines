// stripe-webhook: keeps organizations.plan / subscription_status / seat_limit / AI quota in sync
// with Stripe (Supabase Edge Function, Deno). Deployed with JWT verification OFF because Stripe
// cannot send a Supabase login; instead every request must carry a valid Stripe signature.
//
// Checkout setup expected on the web billing page (Phase 2):
//   stripe.checkout.sessions.create({
//     mode: 'subscription',
//     client_reference_id: <org uuid>,
//     subscription_data: { metadata: { org_id: <org uuid> } },
//     line_items: [{ price: <one of the price ids below>, quantity: <seats> }],
//     ...
//   })
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO,
// STRIPE_PRICE_ENTERPRISE (each may be a comma-separated list, e.g. monthly and yearly prices).

import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

type Plan = 'trial' | 'starter' | 'pro' | 'enterprise';

/** Included seats and monthly AI photos per plan. Keep in sync with supabase/seed.sql comments and docs/BACKEND.md. */
export const PLAN_LIMITS: Record<Plan, { seats: number; aiPhotos: number }> = {
  trial: { seats: 3, aiPhotos: 50 },
  starter: { seats: 5, aiPhotos: 500 },
  pro: { seats: 25, aiPhotos: 3000 },
  enterprise: { seats: 100, aiPhotos: 20000 },
};

const STATUSES = ['trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'];

function priceToPlan(): Map<string, Plan> {
  const map = new Map<string, Plan>();
  const add = (env: string, plan: Plan) => {
    for (const id of (Deno.env.get(env) ?? '').split(',').map((s) => s.trim()).filter(Boolean)) map.set(id, plan);
  };
  add('STRIPE_PRICE_STARTER', 'starter');
  add('STRIPE_PRICE_PRO', 'pro');
  add('STRIPE_PRICE_ENTERPRISE', 'enterprise');
  return map;
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

/** Finds the org for a subscription: metadata.org_id first, then the stored Stripe customer id. */
async function findOrgId(sub: Stripe.Subscription, fallbackOrgId: string | null): Promise<string | null> {
  const metaOrg = sub.metadata?.org_id;
  if (metaOrg && UUID_RE.test(metaOrg)) return metaOrg;
  if (fallbackOrgId && UUID_RE.test(fallbackOrgId)) return fallbackOrgId;
  const customerId = idOf(sub.customer as string | { id: string });
  if (!customerId) return null;
  const { data } = await admin.from('organizations').select('id').eq('stripe_customer_id', customerId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Applies a subscription's state to its org. Ignores events older than the last one applied. */
async function applySubscription(sub: Stripe.Subscription, eventCreated: number, fallbackOrgId: string | null): Promise<string | null> {
  const orgId = await findOrgId(sub, fallbackOrgId);
  if (!orgId) {
    console.warn('stripe-webhook: no org for subscription', sub.id);
    return null;
  }

  const prices = priceToPlan();
  let plan: Plan | null = null;
  let quantity = 1;
  for (const item of sub.items?.data ?? []) {
    const p = prices.get(item.price?.id ?? '');
    if (p) {
      plan = p;
      quantity = Math.max(1, item.quantity ?? 1);
      break;
    }
  }
  if (!plan) {
    console.warn('stripe-webhook: subscription has no known price id', sub.id);
  }

  const status = STATUSES.includes(sub.status) ? sub.status : 'incomplete';
  const eventAt = new Date(eventCreated * 1000).toISOString();
  const customerId = idOf(sub.customer as string | { id: string });

  // Cross-checks before touching the org (metadata is only a hint):
  //  * an org already linked to a Stripe customer only accepts subscriptions of that customer, so
  //    a subscription can never upgrade (or cancel) some other company;
  //  * an event about an ended subscription must not overwrite a newer, different subscription.
  const { data: current, error: curErr } = await admin
    .from('organizations')
    .select('id, stripe_customer_id, stripe_subscription_id')
    .eq('id', orgId)
    .maybeSingle();
  if (curErr) throw new Error(`org lookup failed: ${curErr.message}`);
  const cur = current as { id: string; stripe_customer_id: string | null; stripe_subscription_id: string | null } | null;
  if (!cur) {
    console.warn('stripe-webhook: unknown org for subscription', orgId, sub.id);
    return null;
  }
  if (cur.stripe_customer_id && customerId && cur.stripe_customer_id !== customerId) {
    console.error('stripe-webhook: subscription customer does not match the org, ignored', orgId, sub.id);
    return null;
  }
  if (
    cur.stripe_subscription_id &&
    cur.stripe_subscription_id !== sub.id &&
    (status === 'canceled' || status === 'incomplete_expired')
  ) {
    console.log('stripe-webhook: event for a replaced subscription, ignored', orgId, sub.id);
    return orgId;
  }

  const update: Record<string, unknown> = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    subscription_status: status,
    stripe_event_at: eventAt,
  };
  if (plan) {
    const limits = PLAN_LIMITS[plan];
    update.plan = plan;
    // Per-seat pricing: buying more seats than the plan includes raises the limit.
    update.seat_limit = Math.max(limits.seats, quantity);
    update.ai_monthly_photo_quota = limits.aiPhotos;
  }
  if (status !== 'trialing') update.trial_ends_at = null;

  // Only apply if this event is newer than the last one applied (out-of-order delivery).
  const { data, error } = await admin
    .from('organizations')
    .update(update)
    .eq('id', orgId)
    .or(`stripe_event_at.is.null,stripe_event_at.lte."${eventAt}"`)
    .select('id');
  if (error) throw new Error(`org update failed: ${error.message}`);
  if (!data || data.length === 0) console.log('stripe-webhook: stale or unknown org, skipped', orgId, sub.id);
  return orgId;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return text(405, 'Use POST');
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('stripe-webhook: missing secrets');
    return text(500, 'Server is not configured');
  }

  const signature = request.headers.get('Stripe-Signature');
  if (!signature) return text(400, 'Missing Stripe-Signature');

  // The signature covers the exact raw bytes, so read the body as text before any parsing.
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (e) {
    console.warn('stripe-webhook: bad signature', (e as Error).message);
    return text(400, 'Invalid signature');
  }

  // Idempotency: Stripe may deliver the same event more than once.
  const { data: seen } = await admin.from('billing_events').select('id').eq('id', event.id).maybeSingle();
  if (seen) return text(200, 'duplicate');

  let orgId: string | null = null;
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const refOrg = session.client_reference_id && UUID_RE.test(session.client_reference_id)
          ? session.client_reference_id
          : null;
        const customerId = idOf(session.customer as string | { id: string } | null);
        if (refOrg && customerId) {
          // Link only an org that has no customer yet; an org already linked keeps its customer
          // (applySubscription then refuses a subscription of a different customer).
          const { error } = await admin
            .from('organizations')
            .update({ stripe_customer_id: customerId })
            .eq('id', refOrg)
            .is('stripe_customer_id', null);
          if (error) throw new Error(`customer link failed: ${error.message}`);
        }
        const subId = idOf(session.subscription as string | { id: string } | null);
        if (subId) {
          // Fetch the current subscription so plan/status are right even if the
          // customer.subscription.* events arrive later or out of order.
          const sub = await stripe.subscriptions.retrieve(subId);
          orgId = await applySubscription(sub, event.created, refOrg);
        } else {
          orgId = refOrg;
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        orgId = await applySubscription(sub, event.created, null);
        break;
      }
      default:
        // Not subscribed to anything else; acknowledge so Stripe stops retrying.
        break;
    }
  } catch (e) {
    console.error('stripe-webhook: processing failed', event.type, event.id, (e as Error).message);
    // 500 makes Stripe retry later. The event is not marked as seen.
    return text(500, 'Processing failed');
  }

  const { error: logErr } = await admin.from('billing_events').insert({ id: event.id, type: event.type, org_id: orgId });
  if (logErr && !logErr.message.includes('duplicate')) console.warn('billing_events insert failed', logErr.message);
  return text(200, 'ok');
});
