// Billing: current plan, status, trial, seats. Owners and admins pick a plan (Stripe Checkout) or
// manage the subscription, invoices and card (Stripe Customer Portal). Web only by design: the
// phone app never shows prices or purchase buttons (app store rules).
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AdminApiError, getAdminApi } from '@/admin/api';
import { Badge, Btn, Grid, LoadError, Meter, Notice, PageHeader, Panel, Skeleton, Tabs, Txt } from '@/admin/components/kit';
import { useAdmin, useDocumentTitle } from '@/admin/context';
import { count, dateShort } from '@/admin/format';
import {
  bestAnnualSavingsPct,
  clampSeats,
  formatUsd,
  perSeatMonthly,
  periodTotal,
  planName,
  PLANS,
  PRICES_ARE_PLACEHOLDERS,
  SALES_EMAIL,
  type BillingInterval,
  type PaidPlanId,
  type PlanDef,
} from '@/admin/plans';
import { canSeeBillingActions } from '@/admin/roles';
import { useAdminData } from '@/admin/useAdminData';
import { colors, radius, space } from '@/theme';

const STATUS: Record<string, { label: string; color: string; hint: string }> = {
  trialing: { label: 'Free trial', color: colors.info, hint: 'Everything works during the trial. Choose a plan before it ends to keep AI photo reads on.' },
  active: { label: 'Active', color: colors.success, hint: 'Paid and in good standing.' },
  past_due: { label: 'Payment failed', color: colors.danger, hint: 'The last payment did not go through. Update the card in Manage billing; Stripe retries automatically.' },
  unpaid: { label: 'Unpaid', color: colors.danger, hint: 'Payments failed repeatedly. AI photo reads are paused until the balance is paid.' },
  canceled: { label: 'Canceled', color: colors.textMuted, hint: 'The subscription has ended. Field data stays available; choose a plan to turn AI and sync features back on.' },
  incomplete: { label: 'Incomplete', color: colors.warning, hint: 'Checkout started but the first payment is not finished.' },
  incomplete_expired: { label: 'Expired', color: colors.textMuted, hint: 'The first payment was never completed. Start checkout again.' },
  paused: { label: 'Paused', color: colors.warning, hint: 'The subscription is paused.' },
};

/** Opens a Stripe page in this tab (Stripe Checkout and the portal do not allow embedding). */
function go(url: string) {
  if (typeof window !== 'undefined') window.location.assign(url);
}

export default function BillingPage() {
  const { orgId, role, session } = useAdmin();
  useDocumentTitle('Billing');
  const params = useLocalSearchParams<{ checkout?: string; plan?: string; interval?: string }>();
  const org = useAdminData((api) => api.org(orgId), [orgId]);
  const stats = useAdminData((api) => api.overview(orgId), [orgId]);
  const canAct = canSeeBillingActions(role);

  const [interval, setBillingInterval] = useState<BillingInterval>(params.interval === 'month' ? 'month' : 'year');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refresh plan info after returning from Stripe (the webhook may land a moment later).
  useEffect(() => {
    if (params.checkout !== 'success') return;
    void session.refreshOrgs();
    const t = setTimeout(() => {
      org.reload();
      void session.refreshOrgs();
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.checkout]);

  const o = org.data;
  const members = stats.data?.members ?? null;
  const st = STATUS[o?.subscriptionStatus ?? 'trialing'] ?? STATUS.incomplete;
  const trialDaysLeft = o?.trialEndsAt ? Math.ceil((Date.parse(o.trialEndsAt) - Date.now()) / 86_400_000) : null;
  const subscribed = !!o?.hasSubscription && ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'].includes(o.subscriptionStatus);

  const portal = async () => {
    const api = getAdminApi();
    if (!api) return;
    setBusy('portal');
    setError(null);
    try {
      go(await api.openBillingPortal(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const checkout = async (plan: PaidPlanId, seats: number) => {
    const api = getAdminApi();
    if (!api) return;
    setBusy(plan);
    setError(null);
    try {
      go(await api.startCheckout({ orgId, plan, interval, seats }));
    } catch (e) {
      if (e instanceof AdminApiError && e.code === 'has_subscription') {
        setError('This company already has a subscription. Use Manage billing to change plan or seats.');
      } else setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <View>
      <PageHeader
        title="Billing"
        subtitle="Your plan, seats and AI allowance. Payments are handled by Stripe; card details never touch LineMap Pro."
        actions={
          canAct && o?.hasStripeCustomer ? (
            <Btn title="Manage billing" icon="open-outline" loading={busy === 'portal'} onPress={() => void portal()} />
          ) : undefined
        }
      />

      {params.checkout === 'success' ? (
        <Notice tone="success" title="Thanks, your payment went through" style={{ marginBottom: space.lg }}>
          Your plan updates within a minute. If it still shows the old plan, refresh this page.
        </Notice>
      ) : params.checkout === 'canceled' ? (
        <Notice tone="info" style={{ marginBottom: space.lg }}>
          Checkout was canceled. Nothing was charged.
        </Notice>
      ) : null}
      {error ? <Notice tone="danger" style={{ marginBottom: space.lg }}>{error}</Notice> : null}
      {org.error ? <LoadError message={org.error} onRetry={org.reload} /> : null}

      <Panel style={{ marginBottom: space.xl }} padded={false}>
        <View style={styles.planHero}>
          <View style={{ flex: 1, minWidth: 260, gap: 8 }}>
            <Txt v="label" color={colors.textFaint}>
              Current plan
            </Txt>
            {o ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Txt v="h1">{planName(o.plan)}</Txt>
                  <Badge label={st.label} color={st.color} solid={o.subscriptionStatus === 'active'} />
                </View>
                <Txt v="small" color={colors.textMuted} style={{ maxWidth: 560 }}>
                  {st.hint}
                  {o.subscriptionStatus === 'trialing' && trialDaysLeft != null
                    ? trialDaysLeft > 0
                      ? ` Trial ends ${dateShort(o.trialEndsAt)} (${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left).`
                      : ' The trial has ended.'
                    : ''}
                </Txt>
              </>
            ) : (
              <Skeleton width={220} height={30} />
            )}
          </View>
          <View style={styles.heroStats}>
            <HeroStat label="Seats" value={o ? `${members ?? '?'} / ${o.seatLimit}` : '--'} pct={o && members != null ? members / o.seatLimit : 0} hint="people in the company / seats paid for" />
            <HeroStat label="AI photos per month" value={o ? count(o.aiMonthlyPhotoQuota) : '--'} hint="for the whole company, resets on the 1st" />
          </View>
        </View>
        {!canAct ? (
          <View style={styles.heroFoot}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.textFaint} />
            <Txt v="micro" color={colors.textFaint}>
              Only owners and admins can change the plan or payment details.
            </Txt>
          </View>
        ) : subscribed ? (
          <View style={styles.heroFoot}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textFaint} />
            <Txt v="micro" color={colors.textFaint} style={{ flex: 1 }}>
              To change plan or number of seats, download invoices, or update the card, use Manage billing (opens Stripe).
            </Txt>
            <Btn title="Manage billing" size="sm" kind="primary" icon="open-outline" loading={busy === 'portal'} onPress={() => void portal()} />
          </View>
        ) : null}
      </Panel>

      {canAct && !subscribed ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.md, marginBottom: space.lg }}>
            <View style={{ gap: 4 }}>
              <Txt v="h2">Choose a plan</Txt>
              <Txt v="small" color={colors.textMuted}>
                Priced per seat. You can add or remove seats later.
              </Txt>
            </View>
            <Tabs
              value={interval}
              onChange={setBillingInterval}
              options={[
                { value: 'month', label: 'Monthly' },
                { value: 'year', label: `Yearly (save ${bestAnnualSavingsPct()}%)` },
              ]}
            />
          </View>
          {PRICES_ARE_PLACEHOLDERS ? (
            <Notice tone="warning" style={{ marginBottom: space.lg }}>
              Placeholder prices for testing. Real prices are set in src/admin/plans.ts and in Stripe before launch.
            </Notice>
          ) : null}
          <Grid gap={space.lg}>
            {PLANS.map((p) => (
              <PlanPicker
                key={p.id}
                plan={p}
                interval={interval}
                current={o?.plan === p.id}
                members={members ?? 1}
                busy={busy === p.id}
                disabled={busy != null}
                onCheckout={(seats) => void checkout(p.id, seats)}
              />
            ))}
          </Grid>
        </>
      ) : null}

      <Panel title="Common questions" style={{ marginTop: space.xl }}>
        <View style={{ gap: space.md }}>
          <Faq q="What is a seat?" a="One person in your company, whatever their role (owner, admin, manager, tech or viewer). Add seats any time; removing a person frees their seat." />
          <Faq q="What happens to the AI allowance?" a="Each plan includes AI photo reads for the whole company each month. When it runs out, capture and mapping keep working; only the automatic photo reading pauses until the 1st." />
          <Faq q="Can I cancel?" a="Yes, from Manage billing. The plan stays active until the end of the period you paid for, and your data stays yours to export." />
          <Faq q="Sales tax and invoices" a="Stripe emails a receipt for every payment. Invoices and tax details (if your account has tax collection turned on) are in Manage billing." />
        </View>
      </Panel>
      <Pressable onPress={() => router.push('/pricing')} style={{ marginTop: space.md, alignSelf: 'flex-start' }} accessibilityRole="link">
        <Txt v="small" color={colors.accent}>
          Compare plans in detail
        </Txt>
      </Pressable>
    </View>
  );
}

function HeroStat({ label, value, hint, pct }: { label: string; value: string; hint: string; pct?: number }) {
  return (
    <View style={styles.heroStat}>
      <Txt v="micro" color={colors.textFaint}>
        {label}
      </Txt>
      <Txt v="kpi" num>
        {value}
      </Txt>
      {pct != null ? <Meter pct={pct} /> : null}
      <Txt v="micro" color={colors.textFaint}>
        {hint}
      </Txt>
    </View>
  );
}

function PlanPicker({
  plan,
  interval,
  current,
  members,
  busy,
  disabled,
  onCheckout,
}: {
  plan: PlanDef;
  interval: BillingInterval;
  current: boolean;
  members: number;
  busy: boolean;
  disabled: boolean;
  onCheckout: (seats: number) => void;
}) {
  const [seats, setSeats] = useState(() => clampSeats(plan, members, members));
  useEffect(() => setSeats((s) => clampSeats(plan, s, members)), [plan, members]);
  const per = perSeatMonthly(plan, interval);
  const total = periodTotal(plan, interval, seats);
  const tooSmall = members > plan.maxSeats;

  return (
    <View style={[styles.planCard, plan.highlighted && styles.planCardHi]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt v="h2" style={{ flex: 1 }}>
          {plan.name}
        </Txt>
        {plan.highlighted ? <Badge label="Most popular" color={colors.accent} solid /> : null}
        {current ? <Badge label="Current" color={colors.success} /> : null}
      </View>
      <Txt v="small" color={colors.textMuted}>
        {plan.tagline}
      </Txt>
      {per != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Txt v="h1" num>
            {formatUsd(per)}
          </Txt>
          <Txt v="small" color={colors.textMuted}>
            per seat / month{interval === 'year' ? ', billed yearly' : ''}
          </Txt>
        </View>
      ) : (
        <Txt v="h1">Custom</Txt>
      )}
      <Txt v="micro" color={colors.textFaint}>
        {count(plan.aiPhotosPerMonth)} AI photos a month · {plan.minSeats} to {count(plan.maxSeats)} seats
      </Txt>

      {plan.selfServe ? (
        <>
          <View style={styles.seatRow}>
            <Txt v="small" style={{ flex: 1 }}>
              Seats
            </Txt>
            <Btn size="sm" icon="remove" accessibilityLabel="Fewer seats" disabled={seats <= Math.max(plan.minSeats, members)} onPress={() => setSeats((s) => clampSeats(plan, s - 1, members))} />
            <Txt v="h3" num style={{ minWidth: 34, textAlign: 'center' }}>
              {seats}
            </Txt>
            <Btn size="sm" icon="add" accessibilityLabel="More seats" disabled={seats >= plan.maxSeats} onPress={() => setSeats((s) => clampSeats(plan, s + 1, members))} />
          </View>
          <Txt v="micro" color={colors.textMuted}>
            {total != null ? `${formatUsd(total)} per ${interval === 'year' ? 'year' : 'month'}` : ''}
            {members > 1 ? ` · at least ${members} for your current team` : ''}
          </Txt>
          <Btn
            title={tooSmall ? `Your team is over ${plan.maxSeats} seats` : 'Continue to checkout'}
            kind={plan.highlighted ? 'primary' : 'secondary'}
            icon="lock-closed-outline"
            loading={busy}
            disabled={disabled || tooSmall}
            onPress={() => onCheckout(seats)}
            size="lg"
          />
        </>
      ) : (
        <Btn title="Talk to us" icon="mail-outline" size="lg" onPress={() => go(`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('LineMap Pro Enterprise')}`)} />
      )}
    </View>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Txt v="h3">{q}</Txt>
      <Txt v="small" color={colors.textMuted}>
        {a}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  planHero: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl, padding: space.xl, alignItems: 'center' },
  heroStats: { flexDirection: 'row', gap: space.lg, flexWrap: 'wrap' },
  heroStat: { minWidth: 200, gap: 6, padding: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xl, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  planCard: {
    flexGrow: 1,
    flexBasis: 300,
    gap: space.md,
    padding: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  planCardHi: { borderColor: colors.accent + 'AA', backgroundColor: '#15140F' },
  seatRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
});
