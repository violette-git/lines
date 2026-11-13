// Settings: company name, your display name, and account links.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { getAdminApi } from '@/admin/api';
import { Btn, Input, LoadError, Notice, PageHeader, Panel, Txt } from '@/admin/components/kit';
import { useAdmin, useDocumentTitle } from '@/admin/context';
import { dateShort } from '@/admin/format';
import { canRenameOrg, ROLE_META } from '@/admin/roles';
import { useAdminData } from '@/admin/useAdminData';
import { colors, space } from '@/theme';

export default function SettingsPage() {
  const { orgId, role, session } = useAdmin();
  useDocumentTitle('Settings');
  const org = useAdminData((api) => api.org(orgId), [orgId]);
  const [name, setName] = useState('');
  const [myName, setMyName] = useState(session.name ?? '');
  const [busy, setBusy] = useState<'org' | 'me' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    if (org.data) setName(org.data.name);
  }, [org.data]);

  const saveOrg = async () => {
    const api = getAdminApi();
    const n = name.trim();
    if (!api || !n) return;
    setBusy('org');
    setMsg(null);
    try {
      await api.renameOrg(orgId, n);
      await session.refreshOrgs();
      org.reload();
      setMsg({ tone: 'success', text: 'Company name saved.' });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const saveMe = async () => {
    const n = myName.trim();
    if (!n) return;
    setBusy('me');
    setMsg(null);
    try {
      await session.updateProfileName(n);
      setMsg({ tone: 'success', text: 'Your name was saved.' });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const o = org.data;
  const editable = canRenameOrg(role);

  return (
    <View style={{ maxWidth: 820 }}>
      <PageHeader title="Settings" subtitle="Company details and your account." />
      {msg ? <Notice tone={msg.tone} style={{ marginBottom: space.lg }}>{msg.text}</Notice> : null}
      {org.error ? <LoadError message={org.error} onRetry={org.reload} /> : null}

      <Panel title="Company" subtitle={editable ? undefined : 'Only owners and admins can rename the company.'} style={{ marginBottom: space.lg }}>
        <View style={{ gap: space.lg }}>
          <Input label="Company name" value={name} onChangeText={setName} editable={editable} maxLength={120} hint="Shown to your team in the app and on exports." />
          {editable ? (
            <View style={{ flexDirection: 'row' }}>
              <Btn title="Save name" kind="primary" loading={busy === 'org'} disabled={!name.trim() || name.trim() === o?.name} onPress={() => void saveOrg()} />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xl }}>
            <Meta label="Your role" value={ROLE_META[role].label} />
            <Meta label="Company ID" value={o?.id ?? '--'} mono />
            <Meta label="Short name" value={o?.slug ?? '--'} mono />
            <Meta label="Created" value={dateShort(o?.createdAt)} />
          </View>
          <Txt v="micro" color={colors.textFaint}>
            Need to close the company account or move it to another owner? Owners can promote another member to owner on the Team page. To delete the company and its data, contact support with the Company ID above.
          </Txt>
        </View>
      </Panel>

      <Panel title="Your account" style={{ marginBottom: space.lg }}>
        <View style={{ gap: space.lg }}>
          <Input label="Your name" value={myName} onChangeText={setMyName} maxLength={120} hint="Shown on activity, exports and the team list." />
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Btn title="Save" kind="primary" loading={busy === 'me'} disabled={!myName.trim() || myName.trim() === session.name} onPress={() => void saveMe()} />
            <Btn title="Password and account" icon="person-circle-outline" onPress={() => router.push('/account')} />
          </View>
          <Meta label="Signed in as" value={session.email ?? '--'} />
        </View>
      </Panel>

      <Panel title="Session">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
          <Txt v="small" color={colors.textMuted} style={{ flex: 1, minWidth: 240 }}>
            Sign out of the dashboard on this computer. Phones stay signed in.
          </Txt>
          <Btn
            title="Sign out"
            kind="danger"
            icon="log-out-outline"
            onPress={() => void session.signOut().then(() => router.replace('/auth/sign-in?next=%2Fadmin'))}
          />
        </View>
      </Panel>
    </View>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ gap: 2 }}>
      <Txt v="micro" color={colors.textFaint}>
        {label}
      </Txt>
      <Txt v="small" num={mono} selectable>
        {value}
      </Txt>
    </View>
  );
}
