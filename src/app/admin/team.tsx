// Team: members with roles, invites by link, seats used vs seats paid for.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type HostInstance } from 'react-native';

import { CellText, DataTable, type Column } from '@/admin/components/DataTable';
import { Avatar, Badge, Btn, Dialog, EmptyState, Input, LoadError, Menu, Meter, Notice, PageHeader, Panel, Skeleton, Txt, type MenuItem } from '@/admin/components/kit';
import { useAdmin, useDocumentTitle } from '@/admin/context';
import { dateShort, relativeTime } from '@/admin/format';
import {
  canInvite,
  canRemoveMember,
  canSeeBillingActions,
  canViewMemberDetails,
  invitableRoles,
  isLastOwner,
  ROLE_META,
  roleChangeOptions,
} from '@/admin/roles';
import { displayName, initials, seatState } from '@/admin/shaping';
import type { Invite, Member } from '@/admin/types';
import { getAdminApi } from '@/admin/api';
import { useAdminData } from '@/admin/useAdminData';
import { copyText, inviteLink } from '@/admin/links';
import type { OrgRole } from '@/backend/contracts';
import { colors, radius, space } from '@/theme';

const ROLE_COLOR: Record<OrgRole, string> = {
  owner: colors.accent,
  admin: colors.info,
  manager: colors.underground,
  tech: colors.success,
  viewer: colors.textMuted,
};

export default function TeamPage() {
  const { orgId, org, role, session } = useAdmin();
  useDocumentTitle('Team');
  const params = useLocalSearchParams<{ invite?: string }>();
  const detailed = canViewMemberDetails(role);
  const members = useAdminData((api) => api.members(orgId, detailed), [orgId, detailed]);
  const invites = useAdminData(canInvite(role) ? (api) => api.invites(orgId) : null, [orgId, role]);
  const [inviteOpen, setInviteOpen] = useState(params.invite === '1' && canInvite(role));
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: string; danger?: boolean; run: () => Promise<void> } | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const list = members.data ?? [];
  const pending = invites.data ?? [];
  const seatLimit = org.seatLimit ?? list.length;
  const seats = seatState(list.length, pending.length, seatLimit);
  const owners = list.filter((m) => m.role === 'owner').length;

  const act = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      setToast({ tone: 'success', text: ok });
      members.reload();
      invites.reload();
    } catch (e) {
      setToast({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const changeRole = (m: Member, to: OrgRole) => {
    const api = getAdminApi();
    if (!api) return;
    const run = () => act(() => api.changeRole(orgId, m.userId, to), `${displayName(m.fullName, m.email)} is now ${ROLE_META[to].label}.`);
    if (to === 'owner' || m.role === 'owner') {
      setConfirm({
        title: to === 'owner' ? 'Make this person an owner?' : 'Remove owner rights?',
        body:
          to === 'owner'
            ? `${displayName(m.fullName, m.email)} will have full control, including billing and the ability to remove you.`
            : isLastOwner(m.role, owners)
              ? 'This is the only owner. Make someone else an owner first.'
              : `${displayName(m.fullName, m.email)} will become ${ROLE_META[to].label}.`,
        action: 'Change role',
        run,
      });
    } else void run();
  };

  const remove = (m: Member) => {
    const api = getAdminApi();
    if (!api) return;
    setConfirm({
      title: `Remove ${displayName(m.fullName, m.email)}?`,
      body: 'They lose access to this company on every device right away. Their field work stays in the projects. This frees one seat.',
      action: 'Remove member',
      danger: true,
      run: () => act(() => api.removeMember(orgId, m.userId), 'Member removed.'),
    });
  };

  const revoke = (inv: Invite) => {
    const api = getAdminApi();
    if (!api) return;
    void act(() => api.revokeInvite(orgId, inv.id), `Invite for ${inv.email} revoked. The link no longer works.`);
  };

  const columns: Column<Member>[] = [
    {
      key: 'name',
      title: 'Member',
      flex: 2.4,
      minWidth: 260,
      render: (m) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar label={initials(m.fullName, m.email)} seed={m.userId} size={32} />
          <CellText primary={`${displayName(m.fullName, m.email)}${m.userId === session.userId ? ' (you)' : ''}`} secondary={detailed ? m.email ?? undefined : undefined} />
        </View>
      ),
    },
    { key: 'role', title: 'Role', flex: 1.2, minWidth: 150, render: (m) => <RoleCell m={m} actor={role} isSelf={m.userId === session.userId} onChange={(r) => changeRole(m, r)} /> },
    { key: 'joined', title: 'Joined', flex: 1, minWidth: 120, render: (m) => <Txt v="small" color={colors.textMuted}>{dateShort(m.joinedAt)}</Txt> },
    ...(detailed
      ? [
          {
            key: 'active',
            title: 'Last active',
            flex: 1,
            minWidth: 120,
            render: (m: Member) => <Txt v="small" color={m.lastActiveAt ? colors.textMuted : colors.textFaint}>{m.lastActiveAt ? relativeTime(m.lastActiveAt) : 'Never'}</Txt>,
          } satisfies Column<Member>,
        ]
      : []),
    {
      key: 'actions',
      title: '',
      flex: 0.6,
      minWidth: 80,
      align: 'right',
      render: (m) =>
        canRemoveMember(role, m.role, m.userId === session.userId) ? (
          <Btn kind="ghost" size="sm" icon="person-remove-outline" accessibilityLabel={`Remove ${displayName(m.fullName, m.email)}`} onPress={() => remove(m)} />
        ) : null,
    },
  ];

  return (
    <View>
      <PageHeader
        title="Team"
        subtitle="Who can use LineMap Pro in this company, and what they can do."
        actions={canInvite(role) ? <Btn title="Invite member" kind="primary" icon="person-add-outline" onPress={() => setInviteOpen(true)} disabled={seats.full} /> : undefined}
      />

      {toast ? <Notice tone={toast.tone} style={{ marginBottom: space.lg }} action={<Btn kind="ghost" size="sm" icon="close" onPress={() => setToast(null)} accessibilityLabel="Dismiss" />}>{toast.text}</Notice> : null}

      <View style={styles.seatCard}>
        <View style={{ flex: 1, minWidth: 260, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Txt v="kpi" num>
              {list.length}
            </Txt>
            <Txt v="body" color={colors.textMuted}>
              of {seatLimit} seats used
            </Txt>
            {pending.length ? <Badge label={`${pending.length} invite${pending.length === 1 ? '' : 's'} pending`} color={colors.info} /> : null}
          </View>
          <Meter pct={seats.pct} height={8} />
          <Txt v="micro" color={colors.textFaint}>
            A seat is one person in the company, whatever their role. {seats.full ? 'All seats are taken: new invites cannot be accepted until you add seats or remove someone.' : seats.overInvited ? 'More invites are open than seats are free; the last ones to accept will be blocked.' : `${seats.free} seat${seats.free === 1 ? '' : 's'} free.`}
          </Txt>
        </View>
        {canSeeBillingActions(role) ? <Btn title="Add seats" icon="add-circle-outline" onPress={() => router.push('/admin/billing')} /> : null}
      </View>

      {members.error ? <LoadError message={members.error} onRetry={members.reload} /> : null}

      <Panel title="Members" subtitle={detailed ? undefined : 'Email addresses are visible to owners and admins.'} padded={false} style={{ marginBottom: space.lg }}>
        {!members.data && !members.error ? (
          <View style={{ padding: space.lg, gap: 14 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height={26} />
            ))}
          </View>
        ) : (
          <DataTable columns={columns} rows={list} rowKey={(m) => m.userId} maxHeight={620} empty={<EmptyState compact icon="people-outline" title="No members" />} />
        )}
      </Panel>

      {canInvite(role) ? (
        <Panel title="Pending invites" subtitle="Invite links work once and expire after 7 days." padded={false}>
          {invites.error ? (
            <View style={{ padding: space.lg }}>
              <LoadError message={invites.error} onRetry={invites.reload} />
            </View>
          ) : pending.length === 0 ? (
            <EmptyState compact icon="mail-open-outline" title="No pending invites" body="Invite techs and office staff by email. They join with the link you send them." />
          ) : (
            pending.map((inv) => <InviteRow key={inv.id} inv={inv} onRevoke={() => revoke(inv)} />)
          )}
        </Panel>
      ) : (
        <Notice tone="info">Only owners and admins can invite people or change roles.</Notice>
      )}

      <RoleGuide />

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        roles={invitableRoles(role)}
        onCreated={() => {
          invites.reload();
        }}
      />
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ''}
        footer={
          <>
            <Btn title="Cancel" onPress={() => setConfirm(null)} />
            <Btn
              title={confirm?.action ?? 'OK'}
              kind={confirm?.danger ? 'danger' : 'primary'}
              onPress={() => {
                const c = confirm;
                setConfirm(null);
                void c?.run();
              }}
            />
          </>
        }
      >
        <Txt v="body" color={colors.textMuted}>
          {confirm?.body ?? ''}
        </Txt>
      </Dialog>
    </View>
  );
}

function RoleCell({ m, actor, isSelf, onChange }: { m: Member; actor: OrgRole; isSelf: boolean; onChange: (r: OrgRole) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HostInstance>(null);
  const options = roleChangeOptions(actor, m.role, isSelf);
  const badge = <Badge label={ROLE_META[m.role].label} color={ROLE_COLOR[m.role]} />;
  if (!options.length) return badge;
  const items: MenuItem[] = [m.role, ...options].map((r) => ({
    key: r,
    label: ROLE_META[r].label,
    hint: ROLE_META[r].hint,
    selected: r === m.role,
    onPress: () => (r !== m.role ? onChange(r) : undefined),
  }));
  return (
    <View ref={anchor} style={{ alignSelf: 'flex-start' }}>
      <Pressable onPress={() => setOpen(true)} style={styles.roleBtn} accessibilityRole="button" accessibilityLabel={`Role: ${ROLE_META[m.role].label}. Change role`}>
        {badge}
        <Ionicons name="chevron-down" size={13} color={colors.textFaint} />
      </Pressable>
      <Menu open={open} onClose={() => setOpen(false)} items={items} width={280} anchor={anchor} />
    </View>
  );
}

function InviteRow({ inv, onRevoke }: { inv: Invite; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false);
  const expired = Date.parse(inv.expiresAt) < Date.now();
  return (
    <View style={styles.inviteRow}>
      <View style={styles.inviteIcon}>
        <Ionicons name="mail-outline" size={16} color={colors.textMuted} />
      </View>
      <View style={{ flex: 1, minWidth: 200 }}>
        <Txt v="small" style={{ fontWeight: '600' }} numberOfLines={1}>
          {inv.email}
        </Txt>
        <Txt v="micro" color={expired ? colors.danger : colors.textFaint}>
          Sent {relativeTime(inv.createdAt)} · {expired ? 'expired, invite again to resend' : `expires ${dateShort(inv.expiresAt)}`}
        </Txt>
      </View>
      <Badge label={ROLE_META[inv.role].label} color={ROLE_COLOR[inv.role]} />
      <Btn
        size="sm"
        icon={copied ? 'checkmark' : 'link-outline'}
        title={copied ? 'Copied' : 'Copy link'}
        onPress={() => {
          void copyText(inviteLink(inv.token)).then((ok) => {
            setCopied(ok);
            if (ok) setTimeout(() => setCopied(false), 2000);
          });
        }}
      />
      <Btn size="sm" kind="ghost" icon="trash-outline" title="Revoke" onPress={onRevoke} />
    </View>
  );
}

function InviteDialog({ open, onClose, roles, onCreated }: { open: boolean; onClose: () => void; roles: OrgRole[]; onCreated: () => void }) {
  const { orgId } = useAdmin();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('tech');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail('');
      setRole('tech');
      setError(null);
      setCreated(null);
      setCopied(false);
    }
  }, [open]);

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const submit = async () => {
    const api = getAdminApi();
    if (!api || !valid) return;
    setBusy(true);
    setError(null);
    try {
      const inv = await api.createInvite(orgId, email.trim(), role);
      setCreated(inv);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const link = created ? inviteLink(created.token) : '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={created ? 'Invite ready' : 'Invite a team member'}
      width={540}
      footer={
        created ? (
          <Btn title="Done" kind="primary" onPress={onClose} />
        ) : (
          <>
            <Btn title="Cancel" onPress={onClose} />
            <Btn title="Create invite" kind="primary" icon="send-outline" loading={busy} disabled={!valid} onPress={() => void submit()} />
          </>
        )
      }
    >
      {created ? (
        <>
          <Txt v="body" color={colors.textMuted}>
            Send this link to <Txt v="body" style={{ fontWeight: '600' }}>{created.email}</Txt>. They sign in (or create an account) with that same email address, then join as {ROLE_META[created.role].label}.
          </Txt>
          <View style={styles.linkBox}>
            <Txt v="micro" selectable numberOfLines={2} style={{ flex: 1, fontFamily: undefined }} color={colors.text}>
              {link}
            </Txt>
            <Btn
              size="sm"
              kind="primary"
              icon={copied ? 'checkmark' : 'copy-outline'}
              title={copied ? 'Copied' : 'Copy'}
              onPress={() => void copyText(link).then((ok) => setCopied(ok))}
            />
          </View>
          <Notice tone="info">
            Invite emails are not sent automatically yet. They will be once an email provider is connected to the backend. For now, paste the link into a text or email.
          </Notice>
        </>
      ) : (
        <>
          <Input label="Email address" placeholder="name@company.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoFocus error={error} onSubmitEditing={() => void submit()} />
          <View style={{ gap: 6 }}>
            <Txt v="micro" color={colors.textMuted}>
              Role
            </Txt>
            <View style={{ gap: 6 }}>
              {roles.map((r) => (
                <Pressable key={r} onPress={() => setRole(r)} style={[styles.roleOption, role === r && styles.roleOptionOn]} accessibilityRole="radio" accessibilityState={{ checked: role === r }}>
                  <Ionicons name={role === r ? 'radio-button-on' : 'radio-button-off'} size={16} color={role === r ? colors.accent : colors.textFaint} />
                  <View style={{ flex: 1 }}>
                    <Txt v="small" style={{ fontWeight: '600' }}>
                      {ROLE_META[r].label}
                    </Txt>
                    <Txt v="micro" color={colors.textFaint}>
                      {ROLE_META[r].hint}
                    </Txt>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        </>
      )}
    </Dialog>
  );
}

function RoleGuide() {
  const rows = useMemo(
    () => [
      ['See projects, nodes and photos', 'all'],
      ['Capture and edit in the field', 'tech'],
      ['Create projects and client templates', 'manager'],
      ['See usage, footage reports and activity', 'manager'],
      ['Invite people, change roles, billing', 'admin'],
      ['Manage owners', 'owner'],
    ] as const,
    [],
  );
  const order: OrgRole[] = ['viewer', 'tech', 'manager', 'admin', 'owner'];
  const allowed = (min: string, r: OrgRole) => min === 'all' || order.indexOf(r) >= order.indexOf(min as OrgRole);
  return (
    <Panel title="What each role can do" style={{ marginTop: space.lg }} padded={false}>
      <View style={[styles.guideRow, { backgroundColor: colors.surfaceAlt }]}>
        <Txt v="label" color={colors.textFaint} style={{ flex: 2.4 }}>
          Permission
        </Txt>
        {order
          .slice()
          .reverse()
          .map((r) => (
            <Txt key={r} v="label" color={colors.textFaint} style={{ flex: 1, textAlign: 'center' }}>
              {ROLE_META[r].label}
            </Txt>
          ))}
      </View>
      {rows.map(([label, min]) => (
        <View key={label} style={styles.guideRow}>
          <Txt v="small" style={{ flex: 2.4 }}>
            {label}
          </Txt>
          {order
            .slice()
            .reverse()
            .map((r) => (
              <View key={r} style={{ flex: 1, alignItems: 'center' }}>
                {allowed(min, r) ? <Ionicons name="checkmark" size={16} color={colors.success} accessibilityLabel="Yes" /> : <Txt v="small" color={colors.textFaint}>-</Txt>}
              </View>
            ))}
        </View>
      ))}
    </Panel>
  );
}

const styles = StyleSheet.create({
  seatCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    marginBottom: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  roleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', cursor: 'pointer' },
  inviteRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border + '88' },
  inviteIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  roleOption: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, cursor: 'pointer' },
  roleOptionOn: { borderColor: colors.accent, backgroundColor: colors.accent + '0F' },
  guideRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border + '88' },
});
