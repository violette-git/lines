// Pure checkout rules (no Deno or network APIs), shared by create-checkout and billing-portal and
// unit tested from the app's Jest suite (src/admin/__tests__/billingLogic.test.ts).

export type PaidPlan = 'starter' | 'pro' | 'enterprise';
export type Interval = 'month' | 'year';

/**
 * Seats a company may buy on each plan. Must match minSeats/maxSeats in src/admin/plans.ts
 * (a unit test checks this).
 */
export const SEAT_RULES: Record<PaidPlan, { min: number; max: number }> = {
  starter: { min: 1, max: 10 },
  pro: { min: 3, max: 100 },
  enterprise: { min: 25, max: 10000 },
};

/**
 * Secret names holding the Stripe price ids for each plan. The SAME secrets the stripe-webhook
 * function reads to map a price back to a plan. Each holds a comma-separated list, normally the
 * monthly and the yearly price; checkout tells them apart by their billing interval in Stripe.
 */
export const PLAN_PRICE_ENV: Record<PaidPlan, string> = {
  starter: 'STRIPE_PRICE_STARTER',
  pro: 'STRIPE_PRICE_PRO',
  enterprise: 'STRIPE_PRICE_ENTERPRISE',
};

/** Subscription states where a second subscription must not be started (use the portal instead). */
export const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'];

/** Roles allowed to start checkout or open the billing portal. */
export const BILLING_ROLES = ['owner', 'admin'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export interface CheckoutBody {
  orgId: string;
  plan: PaidPlan;
  interval: Interval;
  seats: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseCheckoutBody(raw: unknown): Parsed<CheckoutBody> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Body must be a JSON object' };
  const b = raw as Record<string, unknown>;
  if (!isUuid(b.orgId)) return { ok: false, error: 'orgId must be the organization id' };
  if (b.plan !== 'starter' && b.plan !== 'pro' && b.plan !== 'enterprise') return { ok: false, error: 'plan must be starter, pro or enterprise' };
  if (b.interval !== 'month' && b.interval !== 'year') return { ok: false, error: 'interval must be month or year' };
  const seats = typeof b.seats === 'number' ? b.seats : Number(b.seats);
  if (!Number.isFinite(seats) || seats < 1 || Math.round(seats) !== seats) return { ok: false, error: 'seats must be a whole number of at least 1' };
  return { ok: true, value: { orgId: b.orgId, plan: b.plan, interval: b.interval, seats } };
}

export function parseOrgBody(raw: unknown): Parsed<{ orgId: string }> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Body must be a JSON object' };
  const orgId = (raw as Record<string, unknown>).orgId;
  if (!isUuid(orgId)) return { ok: false, error: 'orgId must be the organization id' };
  return { ok: true, value: { orgId } };
}

/**
 * Seats to charge for: at least the plan minimum and the current member count (so the seat limit
 * never drops below the people already in the company), at most the plan maximum.
 */
export function resolveSeats(plan: PaidPlan, requested: number, members: number): Parsed<number> {
  const rule = SEAT_RULES[plan];
  const seats = Math.max(rule.min, members, Math.round(requested));
  if (seats > rule.max) {
    return {
      ok: false,
      error:
        members > rule.max
          ? `Your company has ${members} members, more than the ${rule.max} seats this plan allows. Choose a bigger plan.`
          : `This plan allows at most ${rule.max} seats.`,
    };
  }
  return { ok: true, value: seats };
}

export function splitPriceIds(v: string | undefined | null): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface PriceInfo {
  id: string;
  active: boolean;
  /** recurring.interval, or null for one-time prices. */
  interval: string | null;
  intervalCount: number;
  /** recurring.usage_type: 'licensed' means a fixed quantity (seats). */
  usageType: string | null;
}

/** Picks the active, per-seat (licensed), every-1-interval recurring price for the interval. */
export function pickPrice(prices: PriceInfo[], interval: Interval): string | null {
  const ok = prices.filter((p) => p.active && p.interval === interval && p.intervalCount === 1 && (p.usageType ?? 'licensed') === 'licensed');
  return ok[0]?.id ?? null;
}

/** WEB_APP_URL without a trailing slash; must be https (http only for localhost testing). */
export function normalizeWebAppUrl(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim().replace(/\/+$/, '');
  if (!v) return null;
  try {
    const u = new URL(v);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export function checkoutUrls(webAppUrl: string) {
  return {
    // {CHECKOUT_SESSION_ID} is filled in by Stripe.
    success: `${webAppUrl}/admin/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel: `${webAppUrl}/admin/billing?checkout=canceled`,
    portalReturn: `${webAppUrl}/admin/billing`,
  };
}

/**
 * Keeps the rest of the free trial when a trialing company subscribes early. Stripe requires a
 * trial end at least 48 hours away, so shorter remainders start billing right away.
 * Returns Unix seconds or undefined.
 */
export function carryOverTrialEnd(status: string, trialEndsAt: string | null, nowMs: number): number | undefined {
  if (status !== 'trialing' || !trialEndsAt) return undefined;
  const end = Date.parse(trialEndsAt);
  if (!Number.isFinite(end) || end - nowMs < 49 * 3600_000) return undefined;
  return Math.floor(end / 1000);
}
