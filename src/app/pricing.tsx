// Public pricing page (website). Plans, prices and features come from src/admin/plans.ts.
// In the phone app this route shows no prices and no purchase links (app store rules).
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Badge, Btn, Txt } from '@/admin/components/kit';
import { useDocumentTitle, useHideStackHeader } from '@/admin/context';
import {
  bestAnnualSavingsPct,
  formatUsd,
  perSeatMonthly,
  PLANS,
  PRICES_ARE_PLACEHOLDERS,
  SALES_EMAIL,
  TRIAL,
  type BillingInterval,
  type PlanDef,
} from '@/admin/plans';
import type { IconName } from '@/components/ui';
import { Button, T } from '@/components/ui';
import { colors, radius, space } from '@/theme';

export default function PricingRoute() {
  useHideStackHeader('Pricing');
  useDocumentTitle('Pricing');
  if (Platform.OS !== 'web') return <NativePricing />;
  return <PricingPage />;
}

/** Phone app: no prices or purchase links. */
function NativePricing() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md, backgroundColor: colors.bg }}>
      <Ionicons name="business-outline" size={36} color={colors.accent} />
      <T v="title" style={{ textAlign: 'center' }}>
        Plans are managed by your company
      </T>
      <T color={colors.textMuted} style={{ textAlign: 'center', maxWidth: 420 }}>
        Your company administrator manages the LineMap Pro subscription. Ask them if you need more seats or AI photo reads.
      </T>
      <Button title="Back" kind="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </View>
  );
}

function signUpHref(plan: PlanDef, interval: BillingInterval) {
  const next = `/admin/billing?plan=${plan.id}&interval=${interval}`;
  return `/auth/sign-up?next=${encodeURIComponent(next)}`;
}

function PricingPage() {
  const { width } = useWindowDimensions();
  const [interval, setInterval_] = useState<BillingInterval>('year');
  const wide = width >= 1040;
  const pad = width >= 760 ? 48 : 20;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 80 }}>
      {/* Nav */}
      <View style={[styles.nav, { paddingHorizontal: pad }]}>
        <Pressable onPress={() => router.push('/')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="link" accessibilityLabel="LineMap Pro home">
          <View style={styles.logo}>
            <Ionicons name="git-network" size={17} color={colors.onAccent} />
          </View>
          <Txt v="h2" style={{ fontWeight: '800' }}>
            LineMap <Txt v="h2" color={colors.accent} style={{ fontWeight: '800' }}>Pro</Txt>
          </Txt>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Btn title="Sign in" kind="ghost" onPress={() => router.push('/auth/sign-in?next=%2Fadmin')} />
        <Btn title="Start free trial" kind="primary" onPress={() => router.push(signUpHref(PLANS[1], interval))} />
      </View>

      <View style={[styles.wrap, { paddingHorizontal: pad }]}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={{ alignItems: 'center' }}>
            <Badge label="Pricing" color={colors.accent} />
          </View>
          <Txt v="hero" style={[{ textAlign: 'center', maxWidth: 820 }, width < 640 && { fontSize: 30, lineHeight: 36 }]}>
            Map the plant. <Txt v="hero" color={colors.accent} style={width < 640 ? { fontSize: 30, lineHeight: 36 } : undefined}>Skip the paperwork.</Txt>
          </Txt>
          <Txt v="body" color={colors.textMuted} style={{ textAlign: 'center', maxWidth: 620, fontSize: 17, lineHeight: 26 }}>
            Simple per-seat pricing for cable and fiber crews. Every plan includes offline capture, automatic footage, every export format and the office dashboard. Start with a {TRIAL.days}-day free trial, no card needed.
          </Txt>
          <IntervalToggle value={interval} onChange={setInterval_} />
          {PRICES_ARE_PLACEHOLDERS ? (
            <View style={styles.placeholder}>
              <Ionicons name="construct-outline" size={14} color={colors.warning} />
              <Txt v="micro" color={colors.warning}>
                Placeholder prices for testing; final pricing is coming soon.
              </Txt>
            </View>
          ) : null}
        </View>

        {/* Plans */}
        <View style={[styles.cards, { flexDirection: wide ? 'row' : 'column' }]}>
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} interval={interval} wide={wide} />
          ))}
        </View>

        <View style={styles.trust}>
          <TrustItem icon="cloud-offline-outline" title="Works with no signal" body="Capture all day offline. Data syncs when the phone is back in coverage." />
          <TrustItem icon="shield-checkmark-outline" title="Your data stays yours" body="Each company's data is walled off from every other. Export everything any time." />
          <TrustItem icon="refresh-circle-outline" title="Cancel anytime" body="Monthly plans stop at the end of the month. No setup fees, no contracts." />
        </View>

        {/* Comparison */}
        <View style={{ marginTop: 72, gap: space.lg }}>
          <Txt v="h1" style={{ textAlign: 'center' }}>
            Compare plans
          </Txt>
          <Compare />
        </View>

        {/* FAQ */}
        <View style={{ marginTop: 72, gap: space.lg, maxWidth: 820, width: '100%', alignSelf: 'center' }}>
          <Txt v="h1" style={{ textAlign: 'center' }}>
            Questions, answered
          </Txt>
          <View style={styles.faqList}>
            {FAQ.map((f, i) => (
              <FaqItem key={f.q} q={f.q} a={f.a} defaultOpen={i === 0} />
            ))}
          </View>
        </View>

        {/* CTA */}
        <View style={styles.cta}>
          <View style={{ flex: 1, minWidth: 260, gap: 6 }}>
            <Txt v="h1">Put your next job on LineMap Pro</Txt>
            <Txt v="body" color={colors.textMuted}>
              {TRIAL.days} days free for up to {TRIAL.seats} people and {TRIAL.aiPhotosPerMonth} AI photo reads. No card needed to start.
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Btn title="Talk to sales" size="lg" icon="mail-outline" onPress={() => openMail()} />
            <Btn title="Start free trial" size="lg" kind="primary" icon="arrow-forward" onPress={() => router.push(signUpHref(PLANS[1], interval))} />
          </View>
        </View>

        <View style={styles.footer}>
          <Txt v="micro" color={colors.textFaint}>
            © {new Date().getFullYear()} Spott Ventures. Prices in US dollars, before any sales tax.
          </Txt>
          <View style={{ flexDirection: 'row', gap: space.lg }}>
            <FooterLink label="Terms" href="/legal/terms" />
            <FooterLink label="Privacy" href="/legal/privacy" />
            <FooterLink label="Sign in" href="/auth/sign-in?next=%2Fadmin" />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function openMail() {
  if (typeof window !== 'undefined') window.location.assign(`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('LineMap Pro Enterprise')}`);
}

function IntervalToggle({ value, onChange }: { value: BillingInterval; onChange: (v: BillingInterval) => void }) {
  const save = bestAnnualSavingsPct();
  return (
    <View style={styles.toggle} accessibilityRole="radiogroup" accessibilityLabel="Billing period">
      {(['month', 'year'] as BillingInterval[]).map((v) => {
        const on = v === value;
        return (
          <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.toggleItem, on && styles.toggleOn]}>
            <Txt v="small" color={on ? colors.onAccent : colors.textMuted} style={{ fontWeight: '700' }}>
              {v === 'month' ? 'Monthly' : 'Yearly'}
            </Txt>
            {v === 'year' ? (
              <View style={[styles.savePill, on && { backgroundColor: colors.onAccent }]}>
                <Txt v="micro" color={on ? colors.accent : colors.success} style={{ fontWeight: '700' }}>
                  Save {save}%
                </Txt>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function PlanCard({ plan, interval, wide }: { plan: PlanDef; interval: BillingInterval; wide: boolean }) {
  const per = perSeatMonthly(plan, interval);
  const monthly = plan.monthlyPerSeat;
  const hi = plan.highlighted;
  return (
    <View style={[styles.card, hi && styles.cardHi, hi && { paddingTop: 44 }, wide && { flex: 1 }, hi && wide && { marginTop: -12 }]}>
      {hi ? (
        <View style={styles.ribbon}>
          <Ionicons name="star" size={11} color={colors.onAccent} />
          <Txt v="micro" color={colors.onAccent} style={{ fontWeight: '800', letterSpacing: 0.6 }}>
            MOST POPULAR
          </Txt>
        </View>
      ) : null}
      <View style={{ gap: 6 }}>
        <Txt v="h2" style={{ fontSize: 20 }}>
          {plan.name}
        </Txt>
        <Txt v="small" color={colors.textMuted}>
          {plan.tagline}
        </Txt>
      </View>
      <View style={{ minHeight: 74, justifyContent: 'center' }}>
        {per != null ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <Txt v="hero" num style={{ fontSize: 46, lineHeight: 50 }}>
                {formatUsd(per)}
              </Txt>
              {interval === 'year' && monthly && monthly > per ? (
                <Txt v="body" color={colors.textFaint} style={{ textDecorationLine: 'line-through', marginBottom: 8 }}>
                  {formatUsd(monthly)}
                </Txt>
              ) : null}
            </View>
            <Txt v="micro" color={colors.textMuted}>
              per seat per month{interval === 'year' ? ', billed yearly' : ''}
            </Txt>
          </>
        ) : (
          <>
            <Txt v="hero" style={{ fontSize: 40, lineHeight: 50 }}>
              Custom
            </Txt>
            <Txt v="micro" color={colors.textMuted}>
              from {plan.minSeats} seats, annual agreement
            </Txt>
          </>
        )}
      </View>
      <Btn
        title={plan.cta}
        kind={hi ? 'primary' : 'secondary'}
        size="lg"
        icon={plan.selfServe ? 'arrow-forward' : 'mail-outline'}
        onPress={() => (plan.selfServe ? router.push(signUpHref(plan, interval)) : openMail())}
      />
      <View style={styles.cardMeta}>
        <MetaPill icon="people-outline" text={plan.selfServe ? `${plan.minSeats} to ${plan.maxSeats} seats` : `${plan.minSeats}+ seats`} />
        <MetaPill icon="sparkles-outline" text={`${plan.aiPhotosPerMonth.toLocaleString('en-US')} AI photos / mo`} />
      </View>
      <View style={{ gap: 12 }}>
        {plan.features.map((f) => (
          <View key={f.label} style={{ flexDirection: 'row', gap: 10 }}>
            <Ionicons name="checkmark-circle" size={17} color={hi ? colors.accent : colors.success} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 1 }}>
              <Txt v="small">{f.label}</Txt>
              {f.hint ? (
                <Txt v="micro" color={colors.textFaint}>
                  {f.hint}
                </Txt>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function MetaPill({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.metaPill}>
      <Ionicons name={icon} size={13} color={colors.textMuted} />
      <Txt v="micro" color={colors.textMuted}>
        {text}
      </Txt>
    </View>
  );
}

function TrustItem({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={styles.trustItem}>
      <View style={styles.trustIcon}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="h3">{title}</Txt>
        <Txt v="small" color={colors.textMuted}>
          {body}
        </Txt>
      </View>
    </View>
  );
}

type Cell = boolean | string;
const COMPARE: { group: string; rows: { label: string; hint?: string; v: [Cell, Cell, Cell] }[] }[] = [
  {
    group: 'Field capture',
    rows: [
      { label: 'Offline capture with GPS averaging', v: [true, true, true] },
      { label: 'Walk mode, live footage, sag and slack', v: [true, true, true] },
      { label: 'Voice labeling and photo watermarks', v: [true, true, true] },
      { label: 'External GNSS receivers (RTK)', hint: 'Survey-grade GPS for centimeter accuracy', v: [false, true, true] },
    ],
  },
  {
    group: 'AI photo reading',
    rows: [
      { label: 'AI photo reads per month', hint: 'Shared by the whole company', v: ['500', '3,000', '20,000+'] },
      { label: 'Confidence shown on every AI value', v: [true, true, true] },
    ],
  },
  {
    group: 'Office and deliverables',
    rows: [
      { label: 'Web dashboard, map and activity', v: [true, true, true] },
      { label: 'KMZ, Excel, CSV, PDF, GeoJSON, Shapefile', v: [true, true, true] },
      { label: 'Client templates and required fields', v: [false, true, true] },
      { label: 'QC checks before export', v: [false, true, true] },
      { label: 'Usage and footage reports by tech', v: [false, true, true] },
    ],
  },
  {
    group: 'Account',
    rows: [
      { label: 'Roles: owner, admin, manager, tech, viewer', v: [true, true, true] },
      { label: 'SSO sign-in', hint: 'Single sign-on with your company login', v: [false, false, 'On request'] },
      { label: 'Support', v: ['Email', 'Priority', 'Dedicated'] },
    ],
  },
];

function Compare() {
  const { width } = useWindowDimensions();
  const narrow = width < 720;
  return (
    <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
      <View style={[styles.compare, { minWidth: narrow ? 640 : undefined, flex: 1 }]}>
        <View style={[styles.cmpRow, styles.cmpHead]}>
          <View style={{ flex: 2.2 }} />
          {PLANS.map((p) => (
            <Txt key={p.id} v="h3" color={p.highlighted ? colors.accent : colors.text} style={{ flex: 1, textAlign: 'center' }}>
              {p.name}
            </Txt>
          ))}
        </View>
        {COMPARE.map((g) => (
          <View key={g.group}>
            <View style={styles.cmpGroup}>
              <Txt v="label" color={colors.textFaint}>
                {g.group}
              </Txt>
            </View>
            {g.rows.map((r) => (
              <View key={r.label} style={styles.cmpRow}>
                <View style={{ flex: 2.2, gap: 1, paddingRight: space.md }}>
                  <Txt v="small">{r.label}</Txt>
                  {r.hint ? (
                    <Txt v="micro" color={colors.textFaint}>
                      {r.hint}
                    </Txt>
                  ) : null}
                </View>
                {r.v.map((c, i) => (
                  <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                    {c === true ? (
                      <Ionicons name="checkmark" size={18} color={colors.success} accessibilityLabel="Included" />
                    ) : c === false ? (
                      <View accessibilityLabel="Not included">
                        <Txt v="small" color={colors.textFaint}>
                          -
                        </Txt>
                      </View>
                    ) : (
                      <Txt v="small" num style={{ fontWeight: '600' }}>
                        {c}
                      </Txt>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const FAQ = [
  {
    q: 'Does it work without cell signal?',
    a: 'Yes. Everything is saved on the phone first: photos, GPS fixes, fields and spans. Crews can work a full day in a dead zone. When the phone is back in coverage it syncs to the office. Photos upload on Wi-Fi by default to save data.',
  },
  {
    q: 'How accurate is the AI?',
    a: 'The AI reads what is printed or cast on equipment (pole tags, lid castings, labels) and counts attachments, and every value it fills in carries a confidence score. Heights and sizes from a photo are marked as estimates. Nothing is final until a person reviews it, and the QC check flags AI values nobody has reviewed. If the monthly allowance runs out, capture keeps working; only the automatic reading pauses.',
  },
  {
    q: 'Who owns the data?',
    a: 'You do. Your company data is kept separate from every other company by database rules, not just by the app. You can export every project to KMZ, Excel, CSV, PDF, GeoJSON or Shapefile at any time, including after you cancel.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel from the Billing page in the dashboard. Monthly plans end at the end of the current month; yearly plans run to the end of the paid year. There are no setup fees or cancellation fees.',
  },
  {
    q: 'What counts as a seat?',
    a: 'One person in your company, whatever their role: owner, admin, manager, tech or viewer. Add or remove seats any time; changes are prorated (you pay only for the part of the period you use).',
  },
  {
    q: 'Can I pay from the phone app?',
    a: 'No. Subscriptions are handled on this website by an owner or admin. The phone app is for signing in and field work.',
  },
];

function FaqItem({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <View style={styles.faq}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.faqQ} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Txt v="h3" style={{ flex: 1, fontSize: 16 }}>
          {q}
        </Txt>
        <Ionicons name={open ? 'remove' : 'add'} size={18} color={colors.textMuted} />
      </Pressable>
      {open ? (
        <Txt v="body" color={colors.textMuted} style={{ paddingBottom: space.lg, paddingRight: space.xl, lineHeight: 22 }}>
          {a}
        </Txt>
      ) : null}
    </View>
  );
}

function FooterLink({ label, href }: { label: string; href: string }) {
  return (
    <Pressable onPress={() => router.push(href)} accessibilityRole="link">
      <Txt v="micro" color={colors.textMuted}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 72, maxWidth: 1240, width: '100%', alignSelf: 'center' },
  logo: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  wrap: { maxWidth: 1240, width: '100%', alignSelf: 'center' },
  hero: { alignItems: 'center', gap: space.lg, paddingTop: 56, paddingBottom: 48 },
  placeholder: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.warning + '55', backgroundColor: colors.warning + '12' },
  toggle: { flexDirection: 'row', padding: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: space.sm },
  toggleItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 38, borderRadius: radius.pill, cursor: 'pointer' },
  toggleOn: { backgroundColor: colors.accent },
  savePill: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colors.success + '1F' },
  cards: { gap: space.lg, alignItems: 'stretch' },
  card: {
    gap: space.lg,
    padding: 28,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardHi: {
    borderColor: colors.accent,
    backgroundColor: '#16130B',
    shadowColor: colors.accent,
    shadowOpacity: 0.18,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 10 },
  },
  ribbon: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    borderTopLeftRadius: radius.lg - 1,
    borderTopRightRadius: radius.lg - 1,
  },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  trust: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: 48 },
  trustItem: { flex: 1, flexBasis: 280, flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface + 'AA' },
  trustIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.accent + '1A', alignItems: 'center', justifyContent: 'center' },
  compare: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.surface },
  cmpHead: { backgroundColor: colors.surfaceAlt, paddingVertical: space.lg },
  cmpGroup: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, backgroundColor: colors.bg + '66' },
  cmpRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border + '88' },
  faqList: { borderTopWidth: 1, borderTopColor: colors.border },
  faq: { borderBottomWidth: 1, borderBottomColor: colors.border },
  faqQ: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg, cursor: 'pointer' },
  cta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.xl,
    marginTop: 72,
    padding: 36,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.accent + '55',
    backgroundColor: '#15120A',
  },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.md, marginTop: 48, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.border },
});
