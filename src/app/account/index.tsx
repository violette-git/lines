// Account: profile, active company and role, sign out (with an unsynced-changes warning), switch
// company, remove company data from this phone, delete account.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native';

import { ROLE_HINT, subscriptionLabel } from '@/backend/authCore';
import { DeleteAccountPanel } from '@/backend/authDeleteAccount';
import { canManageBilling, useActiveOrg, useAuth } from '@/backend/authStore';
import { AccountsOff, AuthHero, Banner, goHome, openWeb, RoleBadge, SHOW_WEB_BILLING_LINK, useAction } from '@/backend/authUi';
import { confirmAsync, notify } from '@/components/confirm';
import { PageScroll } from '@/components/Page';
import { Button, Card, Field, SectionTitle, T } from '@/components/ui';
import { findCompanyData, removeCompanyData, syncNow, useSyncStatus, type CompanyDataFound } from '@/sync';
import { colors, font, radius, space } from '@/theme';

export default function AccountScreen() {
  const backendEnabled = useAuth((s) => s.backendEnabled);
  const restored = useAuth((s) => s.restored);
  const session = useAuth((s) => s.session);

  if (!backendEnabled) {
    return (
      <PageScroll>
        <AuthHero icon="person-circle-outline" title="Account" />
        <AccountsOff />
      </PageScroll>
    );
  }
  if (!restored) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!session) {
    return (
      <PageScroll>
        <AuthHero icon="person-circle-outline" title="Account" subtitle="You are using LineMap Pro on this phone only." />
        <Card style={{ gap: space.md }}>
          <T color={colors.textMuted}>Sign in to share projects with your company. Your projects on this phone stay where they are.</T>
          <Button title="Sign in" icon="log-in" onPress={() => router.push('/auth/sign-in')} />
          <Button title="Create an account" kind="secondary" icon="person-add-outline" onPress={() => router.push('/auth/sign-up')} />
        </Card>
        <CompanyDataCleanup keepOrgIds={NO_ORGS} />
      </PageScroll>
    );
  }
  return <SignedIn />;
}

function SignedIn() {
  const email = useAuth((s) => s.user?.email ?? '');
  const profileName = useAuth((s) => s.profileName);
  const orgCount = useAuth((s) => s.orgs.length);
  const orgsError = useAuth((s) => s.orgsError);
  const signOut = useAuth((s) => s.signOut);
  const updateProfileName = useAuth((s) => s.updateProfileName);
  const refreshOrgs = useAuth((s) => s.refreshOrgs);
  const org = useActiveOrg();
  const [name, setName] = useState(profileName ?? '');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    void refreshOrgs();
  }, [refreshOrgs]);
  useEffect(() => {
    setName(profileName ?? '');
  }, [profileName]);

  const dirty = name.trim() !== (profileName ?? '').trim();

  const saveName = () => {
    if (!dirty) return;
    setSaved(false);
    void run(async () => {
      await updateProfileName(name);
      setSaved(true);
    });
  };

  const unsynced = useSyncStatus((s) => s.pendingChanges + s.pendingPhotos);
  const [pendingDialog, setPendingDialog] = useState(false);
  const keepOrgIds = useAuth((s) => s.orgs.map((o) => o.id).join(','));

  const finishSignOut = async () => {
    setPendingDialog(false);
    await signOut();
    goHome();
  };

  const doSignOut = async () => {
    // Changes still on this phone only: offer to upload them first.
    if (useSyncStatus.getState().pendingChanges + useSyncStatus.getState().pendingPhotos > 0) {
      setPendingDialog(true);
      return;
    }
    const ok = await confirmAsync({
      title: 'Sign out?',
      message: 'Projects saved on this phone stay here. Sign in again any time to keep sharing with your company.',
      confirmLabel: 'Sign out',
    });
    if (!ok) return;
    await finishSignOut();
  };

  return (
    <PageScroll>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <T v="title" color={colors.onAccent}>
            {(profileName || email || '?').trim().charAt(0).toUpperCase()}
          </T>
        </View>
        <View style={{ flex: 1 }}>
          <T v="title" numberOfLines={1}>
            {profileName || 'Your account'}
          </T>
          <T color={colors.textMuted} style={font.mono} numberOfLines={1}>
            {email}
          </T>
        </View>
      </View>

      <SectionTitle>Profile</SectionTitle>
      <Card style={{ gap: space.md }}>
        <Field
          label="Your name"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setSaved(false);
          }}
          placeholder="First and last name"
          autoCapitalize="words"
          autoComplete="name"
          onSubmitEditing={saveName}
          hint="Shown to your company next to the nodes you map."
        />
        <Field label="Email" value={email} editable={false} hint="To change your email, contact support." />
        {error ? <Banner kind="error">{error}</Banner> : null}
        {saved && !dirty ? <Banner kind="success">Name saved.</Banner> : null}
        <Button title="Save name" icon="save-outline" kind="secondary" onPress={saveName} loading={busy} disabled={!dirty} />
      </Card>

      <SectionTitle>Company</SectionTitle>
      <Card style={{ gap: space.md }}>
        {org ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Ionicons name="business" size={24} color={colors.accent} />
              <View style={{ flex: 1, gap: 4 }}>
                <T v="heading" numberOfLines={1}>
                  {org.name}
                </T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                  <RoleBadge role={org.role} />
                  <T v="caption" color={colors.textMuted}>
                    {subscriptionLabel(org)}
                  </T>
                </View>
              </View>
            </View>
            <T v="caption" color={colors.textMuted}>
              {ROLE_HINT[org.role]}
            </T>
          </>
        ) : (
          <T color={colors.textMuted}>You are not in a company yet. Join one with an invite, or start your own.</T>
        )}
        {orgsError ? <Banner kind="warning">{orgsError}</Banner> : null}
        <Button
          title={orgCount > 1 ? 'Switch company' : org ? 'Companies and invites' : 'Join or create a company'}
          kind="secondary"
          icon="swap-horizontal"
          onPress={() => router.push('/org/select')}
        />
        {org && canManageBilling(org.role) ? (
          <>
            <T v="caption" color={colors.textFaint}>
              Plans, billing and members are managed on the LineMap Pro website.
            </T>
            {SHOW_WEB_BILLING_LINK ? (
              <Button title="Manage your plan on the web" kind="ghost" compact icon="open-outline" onPress={() => void openWeb('/admin/billing')} />
            ) : null}
          </>
        ) : null}
      </Card>

      <SectionTitle>Session</SectionTitle>
      <Button title="Sign out" kind="secondary" icon="log-out-outline" onPress={() => void doSignOut()} />
      <UnsyncedSignOutDialog
        visible={pendingDialog}
        count={unsynced}
        onCancel={() => setPendingDialog(false)}
        onSignOut={() => void finishSignOut()}
      />

      <CompanyDataCleanup keepOrgIds={keepOrgIds ? keepOrgIds.split(',') : NO_ORGS} />

      <SectionTitle>Danger zone</SectionTitle>
      <DeleteAccountPanel />

      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: space.xl }}>
        <Button title="Privacy policy" kind="ghost" compact icon="shield-checkmark-outline" onPress={() => router.push('/legal/privacy')} />
        <Button title="Terms" kind="ghost" compact icon="document-text-outline" onPress={() => router.push('/legal/terms')} />
      </View>
    </PageScroll>
  );
}

const NO_ORGS: string[] = [];

/** "N changes haven't uploaded yet": Sync now, Sign out anyway, or Cancel. */
function UnsyncedSignOutDialog({
  visible,
  count,
  onCancel,
  onSignOut,
}: {
  visible: boolean;
  count: number;
  onCancel: () => void;
  onSignOut: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!visible) setTried(false);
  }, [visible]);
  const doSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
    } catch {
      // The count below tells the user what is left.
    } finally {
      setSyncing(false);
      setTried(true);
    }
  };
  const done = tried && count === 0;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Card style={styles.dialog}>
          <Ionicons name={done ? 'cloud-done-outline' : 'cloud-upload-outline'} size={30} color={done ? colors.success : colors.warning} />
          <T v="title">{done ? 'Everything is uploaded' : `${count} change${count === 1 ? '' : 's'} haven't uploaded yet`}</T>
          <T color={colors.textMuted}>
            {done
              ? 'Your company has all your work. You can sign out now.'
              : tried
                ? 'Some changes are still waiting, usually because there is no signal. If you sign out now they stay on this phone but will not reach your company until you sign in again.'
                : 'Upload them before signing out so your company has your latest work. If you sign out now they stay on this phone until you sign in again.'}
          </T>
          {done ? null : <Button title="Sync now" icon="sync-outline" onPress={() => void doSync()} loading={syncing} />}
          <Button title={done ? 'Sign out' : 'Sign out anyway'} kind={done ? 'primary' : 'secondary'} icon="log-out-outline" onPress={onSignOut} disabled={syncing} />
          <Button title="Cancel" kind="ghost" onPress={onCancel} />
        </Card>
      </View>
    </Modal>
  );
}

/** Lists company projects for companies the user is not signed in to, and removes them from this phone. */
function CompanyDataCleanup({ keepOrgIds }: { keepOrgIds: string[] }) {
  const [found, setFound] = useState<CompanyDataFound | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const key = keepOrgIds.join(',');

  const check = useCallback(async () => {
    try {
      setFound(await findCompanyData(key ? key.split(',') : []));
    } catch {
      setFound(null);
    }
  }, [key]);

  useEffect(() => {
    void check();
  }, [check]);

  if (!found || (found.projectIds.length === 0 && found.templateIds.length === 0)) {
    return message ? <Banner kind="success">{message}</Banner> : null;
  }

  const n = found.projectIds.length;
  const remove = async () => {
    const ok = await confirmAsync({
      title: 'Remove company data from this phone?',
      message:
        `This removes ${n} company project${n === 1 ? '' : 's'}${found.templateIds.length ? ' and company templates' : ''} from this phone only. ` +
        'Nothing is deleted for your company; sign in again to download them. Your own local projects are kept.' +
        (found.unsynced > 0 ? ` ${found.unsynced} change${found.unsynced === 1 ? ' that never uploaded is' : 's that never uploaded are'} lost.` : ''),
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const done = await removeCompanyData(key ? key.split(',') : []);
      setMessage(`Removed ${done.projectIds.length} company project${done.projectIds.length === 1 ? '' : 's'} from this phone.`);
    } catch (e) {
      notify('Could not remove company data', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
    await check();
  };

  return (
    <>
      <SectionTitle>Company data on this phone</SectionTitle>
      <Card style={{ gap: space.md }}>
        <T color={colors.textMuted}>
          {n} project{n === 1 ? '' : 's'} from a company you are not signed in to {n === 1 ? 'is' : 'are'} still stored on this phone (hidden). Remove{' '}
          {n === 1 ? 'it' : 'them'} if this phone is shared or you left the company.
        </T>
        {found.unsynced > 0 ? (
          <Banner kind="warning">{`${found.unsynced} change${found.unsynced === 1 ? '' : 's'} never uploaded. Sign in to that company to upload ${found.unsynced === 1 ? 'it' : 'them'} first.`}</Banner>
        ) : null}
        <Button title="Remove company data from this phone" kind="danger" icon="trash-outline" onPress={() => void remove()} loading={busy} />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  dialog: { width: '100%', maxWidth: 440, gap: space.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
