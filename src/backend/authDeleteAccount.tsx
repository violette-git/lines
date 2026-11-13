// Delete account, in two steps: review what happens (and what blocks it), then type DELETE.
// Apple and Google both require in-app account deletion for apps that create accounts.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { notify } from '@/components/confirm';
import { Button, Card, Field, T } from '@/components/ui';
import { colors, space } from '@/theme';

import {
  AccountDeletionBlockedError,
  DELETE_CONFIRM_WORD,
  describeBlock,
  hardBlockers,
  isDeleteConfirmed,
  membershipStatus,
  planAccountDeletion,
  soleMemberOrgs,
  type DeletionBlock,
  type DeletionMembership,
} from './accountDeletion';
import { ROLE_LABEL, isOrgRole } from './authCore';
import { useAuthStore } from './authStore';
import { Banner, goHome, openWeb, SHOW_WEB_BILLING_LINK } from './authUi';

type Step = 'closed' | 'loading' | 'review' | 'confirm';

export function DeleteAccountPanel() {
  const loadDeletionPreview = useAuthStore((s) => s.loadDeletionPreview);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const [step, setStep] = useState<Step>('closed');
  const [rows, setRows] = useState<DeletionMembership[]>([]);
  const [deleteSoleOrgs, setDeleteSoleOrgs] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverBlocks, setServerBlocks] = useState<DeletionBlock[]>([]);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setStep('loading');
    setError(null);
    setServerBlocks([]);
    setTyped('');
    setDeleteSoleOrgs(false);
    try {
      setRows(await loadDeletionPreview());
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('closed');
    }
  };

  const doDelete = async () => {
    if (!isDeleteConfirmed(typed) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount({ deleteSoleOrgs });
      notify('Your account was deleted', 'Your login and personal details are gone. Thank you for using LineMap Pro.');
      goHome();
    } catch (e) {
      if (e instanceof AccountDeletionBlockedError) {
        setServerBlocks(e.blocked);
        setStep('review');
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'closed' || step === 'loading') {
    return (
      <Card style={{ gap: space.md, borderColor: colors.danger + '55' }}>
        <T v="heading">Delete account</T>
        <T v="caption" color={colors.textMuted}>
          Permanently deletes your login and personal details. Work you mapped for a company stays with that company.
        </T>
        {error ? <Banner kind="error">{error}</Banner> : null}
        <Button title="Delete my account" kind="secondary" icon="trash-outline" onPress={() => void open()} loading={step === 'loading'} />
      </Card>
    );
  }

  const blockers = hardBlockers(rows);
  const soleOrgs = soleMemberOrgs(rows);
  const plan = planAccountDeletion(rows, { deleteSoleOrgs });
  const canContinue = plan.allowed && serverBlocks.every((b) => b.reason === 'sole_member_needs_consent' && deleteSoleOrgs);

  return (
    <Card style={{ gap: space.lg, borderColor: colors.danger + '88' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ionicons name="warning" size={22} color={colors.danger} />
        <T v="heading" color={colors.danger}>
          {step === 'review' ? 'Step 1 of 2: what will happen' : 'Step 2 of 2: confirm'}
        </T>
      </View>

      {step === 'review' ? (
        <>
          <View style={{ gap: space.sm }}>
            <T v="label">Deleted for good</T>
            <Bullet icon="close-circle" color={colors.danger} text="Your login (email and password)" />
            <Bullet icon="close-circle" color={colors.danger} text="Your name and profile" />
            <Bullet icon="close-circle" color={colors.danger} text="Your place in every company, and invites sent to your email" />
          </View>
          <View style={{ gap: space.sm }}>
            <T v="label">Kept</T>
            <Bullet icon="business" color={colors.success} text="Projects, nodes, spans and photos you mapped for a company belong to that company and stay with it." />
            <Bullet
              icon="phone-portrait-outline"
              color={colors.success}
              text="Projects saved only on this phone stay on this phone until you delete them or uninstall the app."
            />
          </View>

          {rows.length ? (
            <View style={{ gap: space.sm }}>
              <T v="label">Your companies</T>
              {rows.map((r) => (
                <OrgLine key={r.orgId} row={r} />
              ))}
            </View>
          ) : null}

          {blockers.map((b) => {
            const block: DeletionBlock = {
              orgId: b.orgId,
              orgName: b.orgName,
              reason: membershipStatus(b) === 'sole_member_subscribed' ? 'active_subscription' : 'sole_owner_with_members',
              otherMembers: b.memberCount - 1,
            };
            return (
              <Banner key={b.orgId} kind="error" title="Not yet">
                <T v="caption">{describeBlock(block)}</T>
                {SHOW_WEB_BILLING_LINK ? (
                  <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
                    <Button
                      compact
                      kind="secondary"
                      icon="open-outline"
                      title={block.reason === 'active_subscription' ? 'Manage your plan on the web' : 'Open members on the web'}
                      onPress={() => void openWeb(block.reason === 'active_subscription' ? '/admin/billing' : '/admin/members')}
                    />
                  </View>
                ) : null}
              </Banner>
            );
          })}

          {soleOrgs.length ? (
            <Pressable
              onPress={() => setDeleteSoleOrgs((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: deleteSoleOrgs }}
              style={styles.check}
            >
              <Ionicons name={deleteSoleOrgs ? 'checkbox' : 'square-outline'} size={26} color={deleteSoleOrgs ? colors.danger : colors.textMuted} />
              <T style={{ flex: 1 }}>
                {`Also delete ${soleOrgs.map((o) => o.orgName).join(', ')} and all of ${soleOrgs.length === 1 ? 'its' : 'their'} projects, photos and data. You are the only person in ${soleOrgs.length === 1 ? 'it' : 'them'}.`}
              </T>
            </Pressable>
          ) : null}

          {serverBlocks.length ? (
            <Banner kind="error" title="The server stopped the deletion">
              <T v="caption">{serverBlocks.map(describeBlock).join(' ')}</T>
            </Banner>
          ) : null}
          {error && !serverBlocks.length ? <Banner kind="error">{error}</Banner> : null}

          <View style={{ gap: space.sm }}>
            <Button title="Continue" kind="danger" icon="arrow-forward" onPress={() => setStep('confirm')} disabled={!canContinue} />
            <Button title="Cancel" kind="ghost" compact onPress={() => setStep('closed')} />
          </View>
        </>
      ) : (
        <>
          <T color={colors.textMuted}>
            This cannot be undone. If you want to come back later you will need a new account and a new invite.
            {plan.deleteOrgs.length ? ` ${plan.deleteOrgs.map((o) => o.orgName).join(', ')} will be deleted too.` : ''}
          </T>
          <Field
            label={`Type ${DELETE_CONFIRM_WORD} to confirm`}
            value={typed}
            onChangeText={setTyped}
            placeholder={DELETE_CONFIRM_WORD}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
          />
          {error ? <Banner kind="error">{error}</Banner> : null}
          <View style={{ gap: space.sm }}>
            <Button
              title="Delete my account for good"
              kind="danger"
              icon="trash"
              onPress={() => void doDelete()}
              loading={busy}
              disabled={!isDeleteConfirmed(typed)}
            />
            <Button title="Back" kind="ghost" compact onPress={() => setStep('review')} disabled={busy} />
          </View>
        </>
      )}
      {busy ? <ActivityIndicator color={colors.danger} /> : null}
    </Card>
  );
}

function Bullet({ icon, color, text }: { icon: 'close-circle' | 'business' | 'phone-portrait-outline'; color: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={16} color={color} style={{ marginTop: 2 }} />
      <T v="caption" color={colors.textMuted} style={{ flex: 1 }}>
        {text}
      </T>
    </View>
  );
}

function OrgLine({ row }: { row: DeletionMembership }) {
  const s = membershipStatus(row);
  const role = isOrgRole(row.role) ? ROLE_LABEL[row.role] : row.role;
  const what =
    s === 'leave'
      ? 'You leave. The company keeps its data.'
      : s === 'sole_member'
        ? 'Deleted with your account, if you tick the box below.'
        : s === 'sole_member_subscribed'
          ? 'Cancel its subscription first.'
          : 'Needs another owner first.';
  const color = s === 'leave' ? colors.success : s === 'sole_member' ? colors.warning : colors.danger;
  return (
    <View style={styles.orgLine}>
      <Ionicons name="business-outline" size={18} color={color} />
      <View style={{ flex: 1 }}>
        <T v="label">{`${row.orgName} (${role})`}</T>
        <T v="caption" color={colors.textMuted}>
          {what}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  check: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  orgLine: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
});
