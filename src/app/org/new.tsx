// Create a company. The creator becomes its owner and it starts on a free trial. Plans are
// managed on the website only: no prices and no buy buttons in the app.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { subscriptionLabel } from '@/backend/authCore';
import { useAuth, type OrgSummary } from '@/backend/authStore';
import { AccountsOff, AuthHero, Banner, goHome, openWeb, SHOW_WEB_BILLING_LINK, useAction } from '@/backend/authUi';
import { PageScroll } from '@/components/Page';
import { Button, Card, Field, T } from '@/components/ui';
import { colors, space } from '@/theme';

export default function NewOrgScreen() {
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const session = useAuth((s) => s.session);
  const createOrganization = useAuth((s) => s.createOrganization);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<OrgSummary | null>(null);
  const { busy, error, setError, run } = useAction();

  if (!backendEnabled) {
    return (
      <PageScroll>
        <AuthHero icon="business-outline" title="New company" />
        <AccountsOff />
      </PageScroll>
    );
  }
  if (!session) {
    return (
      <PageScroll>
        <AuthHero icon="business-outline" title="New company" subtitle="Sign in first, then create your company." />
        <Button title="Sign in" icon="log-in" onPress={() => router.push('/auth/sign-in')} />
      </PageScroll>
    );
  }

  if (created) {
    const trialEnd = created.trialEndsAt ? new Date(created.trialEndsAt) : null;
    return (
      <PageScroll>
        <AuthHero icon="checkmark-circle-outline" title={`${created.name} is ready`} subtitle="You are the owner." />
        <Card style={{ gap: space.md }}>
          <T v="heading">{subscriptionLabel(created)}</T>
          <T color={colors.textMuted}>
            {`Your company starts on a free trial${trialEnd && !Number.isNaN(trialEnd.getTime()) ? ` until ${trialEnd.toLocaleDateString()}` : ''}`}
            {created.seatLimit ? `, for up to ${created.seatLimit} people` : ''}
            {created.aiMonthlyPhotoQuota ? ` and ${created.aiMonthlyPhotoQuota} AI photo reads a month` : ''}. Everything in the app works during the trial.
          </T>
          <T color={colors.textMuted}>
            Plans, billing and inviting your crew are handled on the LineMap Pro website from a computer. Sign in there with the same email and password.
          </T>
          {SHOW_WEB_BILLING_LINK ? (
            <Button title="Manage your plan on the web" kind="secondary" icon="open-outline" onPress={() => void openWeb('/admin/billing')} />
          ) : null}
        </Card>
        <View style={{ gap: space.md, marginTop: space.lg }}>
          <Button title="Start mapping" icon="arrow-forward" onPress={goHome} />
        </View>
      </PageScroll>
    );
  }

  const submit = () => {
    const n = name.trim();
    if (n.length < 2) return setError('Enter your company name (at least 2 characters).');
    if (n.length > 120) return setError('That name is too long. Keep it under 120 characters.');
    void run(async () => {
      const org = await createOrganization(n);
      setCreated(org);
    });
  };

  return (
    <PageScroll>
      <AuthHero icon="business-outline" title="New company" subtitle="Share projects, photos and footage with your whole crew and the office." />
      <Card style={{ gap: space.lg }}>
        <Field
          label="Company name"
          value={name}
          onChangeText={setName}
          placeholder="Example: Magic City Fiber LLC"
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={submit}
          maxLength={120}
          hint="Your crew sees this name. You can rename it later on the web dashboard."
        />
        {error ? <Banner kind="error">{error}</Banner> : null}
        <Button title="Create company" icon="add" onPress={submit} loading={busy} />
      </Card>
      <T v="caption" color={colors.textFaint} style={{ marginTop: space.lg }}>
        Joining an existing company? You do not need to create one. Ask your office to send you an invite.
      </T>
    </PageScroll>
  );
}
