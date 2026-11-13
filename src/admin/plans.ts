// Plan catalog for the pricing page and the billing page. This is the ONE place to change prices,
// seat rules, AI photo allowances and feature lists shown to customers.
//
// PLACEHOLDERS: every price below is a placeholder until the business sets real prices. The
// pricing page shows a "placeholder prices" notice while PRICES_ARE_PLACEHOLDERS is true.
//
// Must stay in step with the server:
//   - aiPhotosPerMonth must equal PLAN_LIMITS[plan].aiPhotos in supabase/functions/stripe-webhook/index.ts
//     (the webhook sets the real quota; a unit test checks the two match).
//   - minSeats / maxSeats must equal SEAT_RULES in supabase/functions/create-checkout/index.ts
//     (the checkout function enforces them; a unit test checks the two match).
//   - Real Stripe prices: one monthly and one yearly recurring price per plan, "per unit" (per seat).
//     See docs/BILLING.md.

export type PaidPlanId = 'starter' | 'pro' | 'enterprise';
export type PlanId = 'trial' | PaidPlanId;
export type BillingInterval = 'month' | 'year';

export const PRICES_ARE_PLACEHOLDERS = true;
export const CURRENCY = 'USD';

export interface PlanFeature {
  label: string;
  /** Short plain-language explanation shown as secondary text. */
  hint?: string;
}

export interface PlanDef {
  id: PaidPlanId;
  name: string;
  tagline: string;
  /** Price per seat per month when billed monthly, in whole dollars. Null = custom quote. */
  monthlyPerSeat: number | null;
  /** Price per seat per month when billed yearly (charged once a year), in whole dollars. */
  annualPerSeatPerMonth: number | null;
  /** Smallest number of seats that can be bought. */
  minSeats: number;
  /** Largest number of seats this plan allows; above it, move up a plan. */
  maxSeats: number;
  /** AI photo analyses included per month for the whole company (not per seat). */
  aiPhotosPerMonth: number;
  /** Bought through Stripe Checkout on the website. Enterprise is sold by talking to us. */
  selfServe: boolean;
  highlighted: boolean;
  cta: string;
  features: PlanFeature[];
}

export const PLANS: readonly PlanDef[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For a single crew getting off paper.',
    monthlyPerSeat: 39,
    annualPerSeatPerMonth: 32,
    minSeats: 1,
    maxSeats: 10,
    aiPhotosPerMonth: 500,
    selfServe: true,
    highlighted: false,
    cta: 'Start free trial',
    features: [
      { label: 'Unlimited projects, nodes and spans' },
      { label: 'Offline capture with GPS averaging', hint: 'Works with no signal; syncs when you are back online.' },
      { label: 'KMZ, Excel, CSV, PDF, GeoJSON and Shapefile exports' },
      { label: '500 AI photo reads per month', hint: 'Pole tags, lid castings and labels filled in for you.' },
      { label: 'Web dashboard for the office' },
      { label: 'Email support' },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For contractors running several crews.',
    monthlyPerSeat: 69,
    annualPerSeatPerMonth: 57,
    minSeats: 3,
    maxSeats: 100,
    aiPhotosPerMonth: 3000,
    selfServe: true,
    highlighted: true,
    cta: 'Start free trial',
    features: [
      { label: 'Everything in Starter' },
      { label: '3,000 AI photo reads per month' },
      { label: 'Client templates with required fields and rates', hint: 'Each utility client gets its own rules and labels.' },
      { label: 'QC checks before every export', hint: 'QC means quality control: missing fields, long spans, weak GPS.' },
      { label: 'External GNSS receivers (RTK)', hint: 'Survey-grade GPS units for centimeter accuracy.' },
      { label: 'Usage and footage reports by tech' },
      { label: 'Priority support' },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For utilities and large engineering firms.',
    monthlyPerSeat: null,
    annualPerSeatPerMonth: null,
    minSeats: 25,
    maxSeats: 10000,
    aiPhotosPerMonth: 20000,
    selfServe: false,
    highlighted: false,
    cta: 'Talk to us',
    features: [
      { label: 'Everything in Pro' },
      { label: '20,000+ AI photo reads per month' },
      { label: 'Custom seat counts and annual invoicing' },
      { label: 'SSO sign-in on request', hint: 'SSO (single sign-on) lets staff sign in with the company login.' },
      { label: 'Data export and retention agreements' },
      { label: 'Onboarding for crews and office staff' },
    ],
  },
] as const;

export const TRIAL = { days: 14, seats: 3, aiPhotosPerMonth: 50 } as const;

export const SALES_EMAIL = 'sales@linemap.pro';

export function getPlan(id: PaidPlanId): PlanDef {
  const p = PLANS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown plan ${id}`);
  return p;
}

export function planName(id: PlanId | string | null | undefined): string {
  if (id === 'trial') return 'Free trial';
  return PLANS.find((p) => p.id === id)?.name ?? 'Unknown plan';
}

/** Per seat per month for the chosen interval, or null for a custom quote. */
export function perSeatMonthly(plan: PlanDef, interval: BillingInterval): number | null {
  return interval === 'year' ? plan.annualPerSeatPerMonth : plan.monthlyPerSeat;
}

/** Whole-number percentage saved by paying yearly, or 0. */
export function annualSavingsPct(plan: PlanDef): number {
  if (!plan.monthlyPerSeat || !plan.annualPerSeatPerMonth) return 0;
  return Math.round((1 - plan.annualPerSeatPerMonth / plan.monthlyPerSeat) * 100);
}

/** Largest yearly saving across self-serve plans, for the toggle label. */
export function bestAnnualSavingsPct(): number {
  return Math.max(0, ...PLANS.map(annualSavingsPct));
}

/** Clamp a requested seat count to what the plan allows and what the company already uses. */
export function clampSeats(plan: PlanDef, requested: number, membersNow = 0): number {
  const want = Number.isFinite(requested) ? Math.round(requested) : plan.minSeats;
  return Math.min(plan.maxSeats, Math.max(plan.minSeats, membersNow, want));
}

/** Total charge per billing period for a seat count (month or year), or null for custom. */
export function periodTotal(plan: PlanDef, interval: BillingInterval, seats: number): number | null {
  const per = perSeatMonthly(plan, interval);
  if (per == null) return null;
  return per * seats * (interval === 'year' ? 12 : 1);
}

export function formatUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
