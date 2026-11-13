import { readFileSync } from 'fs';
import { join } from 'path';

import {
  annualSavingsPct,
  bestAnnualSavingsPct,
  clampSeats,
  getPlan,
  perSeatMonthly,
  periodTotal,
  planName,
  PLANS,
  PRICES_ARE_PLACEHOLDERS,
} from '../plans';
import { SEAT_RULES } from '../../../supabase/functions/create-checkout/logic';

const ROOT = join(__dirname, '..', '..', '..');

/** Reads PLAN_LIMITS out of the webhook source so a drift between the two files fails here. */
function webhookLimits(): Record<string, { seats: number; aiPhotos: number }> {
  const src = readFileSync(join(ROOT, 'supabase/functions/stripe-webhook/index.ts'), 'utf8');
  const out: Record<string, { seats: number; aiPhotos: number }> = {};
  for (const m of src.matchAll(/(\w+):\s*\{\s*seats:\s*(\d+),\s*aiPhotos:\s*(\d+)\s*\}/g)) {
    out[m[1]] = { seats: Number(m[2]), aiPhotos: Number(m[3]) };
  }
  return out;
}

describe('plan catalog', () => {
  it('has the three tiers in order with unique ids', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['starter', 'pro', 'enterprise']);
    expect(PLANS.filter((p) => p.highlighted)).toHaveLength(1);
  });

  it('is clearly marked as placeholder pricing until real prices are set', () => {
    expect(PRICES_ARE_PLACEHOLDERS).toBe(true);
  });

  it('has sane prices and seat ranges', () => {
    for (const p of PLANS) {
      expect(p.minSeats).toBeGreaterThanOrEqual(1);
      expect(p.maxSeats).toBeGreaterThanOrEqual(p.minSeats);
      expect(p.features.length).toBeGreaterThan(2);
      if (p.selfServe) {
        expect(p.monthlyPerSeat).toBeGreaterThan(0);
        expect(p.annualPerSeatPerMonth).toBeGreaterThan(0);
        expect(p.annualPerSeatPerMonth!).toBeLessThanOrEqual(p.monthlyPerSeat!);
      } else {
        expect(p.monthlyPerSeat).toBeNull();
      }
    }
    // Higher tiers cost more per seat and include more AI.
    expect(getPlan('pro').monthlyPerSeat!).toBeGreaterThan(getPlan('starter').monthlyPerSeat!);
    expect(getPlan('pro').aiPhotosPerMonth).toBeGreaterThan(getPlan('starter').aiPhotosPerMonth);
    expect(getPlan('enterprise').aiPhotosPerMonth).toBeGreaterThan(getPlan('pro').aiPhotosPerMonth);
  });

  it('AI quotas match the PLAN_LIMITS the Stripe webhook applies', () => {
    const limits = webhookLimits();
    for (const p of PLANS) expect(limits[p.id]?.aiPhotos).toBe(p.aiPhotosPerMonth);
  });

  it('seat ranges match the checkout function rules', () => {
    for (const p of PLANS) expect(SEAT_RULES[p.id]).toEqual({ min: p.minSeats, max: p.maxSeats });
  });

  it('computes savings, clamps seats and totals', () => {
    const pro = getPlan('pro');
    expect(annualSavingsPct(pro)).toBe(Math.round((1 - 57 / 69) * 100));
    expect(bestAnnualSavingsPct()).toBeGreaterThan(0);
    expect(clampSeats(pro, 1)).toBe(3); // plan minimum
    expect(clampSeats(pro, 2, 7)).toBe(7); // never below current members
    expect(clampSeats(pro, 500)).toBe(100); // plan maximum
    expect(clampSeats(pro, NaN)).toBe(3);
    expect(perSeatMonthly(pro, 'year')).toBe(57);
    expect(periodTotal(pro, 'month', 4)).toBe(276);
    expect(periodTotal(pro, 'year', 4)).toBe(57 * 4 * 12);
    expect(periodTotal(getPlan('enterprise'), 'month', 30)).toBeNull();
    expect(planName('trial')).toBe('Free trial');
    expect(planName('pro')).toBe('Pro');
  });
});
