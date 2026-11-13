import {
  carryOverTrialEnd,
  checkoutUrls,
  normalizeWebAppUrl,
  parseCheckoutBody,
  parseOrgBody,
  pickPrice,
  resolveSeats,
  splitPriceIds,
} from '../../../supabase/functions/create-checkout/logic';

const ORG = '0f1c0000-0000-4000-8000-000000000001';

describe('create-checkout rules', () => {
  it('validates the request body', () => {
    expect(parseCheckoutBody({ orgId: ORG, plan: 'pro', interval: 'year', seats: 5 })).toEqual({ ok: true, value: { orgId: ORG, plan: 'pro', interval: 'year', seats: 5 } });
    expect(parseCheckoutBody({ orgId: 'nope', plan: 'pro', interval: 'year', seats: 5 }).ok).toBe(false);
    expect(parseCheckoutBody({ orgId: ORG, plan: 'gold', interval: 'year', seats: 5 }).ok).toBe(false);
    expect(parseCheckoutBody({ orgId: ORG, plan: 'pro', interval: 'week', seats: 5 }).ok).toBe(false);
    expect(parseCheckoutBody({ orgId: ORG, plan: 'pro', interval: 'month', seats: 2.5 }).ok).toBe(false);
    expect(parseCheckoutBody(null).ok).toBe(false);
    expect(parseOrgBody({ orgId: ORG })).toEqual({ ok: true, value: { orgId: ORG } });
    expect(parseOrgBody({}).ok).toBe(false);
  });

  it('never sells fewer seats than members or the plan minimum, nor more than the maximum', () => {
    expect(resolveSeats('pro', 1, 1)).toEqual({ ok: true, value: 3 });
    expect(resolveSeats('pro', 4, 9)).toEqual({ ok: true, value: 9 });
    expect(resolveSeats('starter', 6, 2)).toEqual({ ok: true, value: 6 });
    expect(resolveSeats('starter', 11, 2).ok).toBe(false);
    const big = resolveSeats('starter', 3, 12);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toMatch(/12 members/);
  });

  it('picks the active per-seat price for the interval', () => {
    const prices = [
      { id: 'old', active: false, interval: 'month', intervalCount: 1, usageType: 'licensed' },
      { id: 'metered', active: true, interval: 'month', intervalCount: 1, usageType: 'metered' },
      { id: 'm', active: true, interval: 'month', intervalCount: 1, usageType: 'licensed' },
      { id: 'q', active: true, interval: 'month', intervalCount: 3, usageType: 'licensed' },
      { id: 'y', active: true, interval: 'year', intervalCount: 1, usageType: null },
    ];
    expect(pickPrice(prices, 'month')).toBe('m');
    expect(pickPrice(prices, 'year')).toBe('y');
    expect(pickPrice(prices.slice(0, 2), 'month')).toBeNull();
    expect(splitPriceIds(' price_a, ,price_b ')).toEqual(['price_a', 'price_b']);
    expect(splitPriceIds(undefined)).toEqual([]);
  });

  it('builds safe return links', () => {
    expect(normalizeWebAppUrl('https://linemap.pro/')).toBe('https://linemap.pro');
    expect(normalizeWebAppUrl('http://localhost:8081')).toBe('http://localhost:8081');
    expect(normalizeWebAppUrl('http://evil.example')).toBeNull();
    expect(normalizeWebAppUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeWebAppUrl('')).toBeNull();
    const u = checkoutUrls('https://linemap.pro');
    expect(u.success).toBe('https://linemap.pro/admin/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}');
    expect(u.cancel).toBe('https://linemap.pro/admin/billing?checkout=canceled');
  });

  it('carries over a free trial only when at least 48 hours remain', () => {
    const now = Date.parse('2026-11-13T00:00:00Z');
    expect(carryOverTrialEnd('trialing', '2026-11-20T00:00:00Z', now)).toBe(Date.parse('2026-11-20T00:00:00Z') / 1000);
    expect(carryOverTrialEnd('trialing', '2026-11-14T00:00:00Z', now)).toBeUndefined();
    expect(carryOverTrialEnd('canceled', '2026-11-20T00:00:00Z', now)).toBeUndefined();
    expect(carryOverTrialEnd('trialing', null, now)).toBeUndefined();
  });
});
