// Data access for the web dashboard. One interface, two implementations:
//   * supabaseAdminApi: the real backend (RLS + the 0003_admin.sql functions + Edge Functions).
//   * fixtureAdminApi (./fixtures): fake data for local design work and screenshots, only when the
//     build sets EXPO_PUBLIC_ADMIN_FIXTURES=1. Never set that for a real deployment.
import type { SupabaseClient } from '@supabase/supabase-js';

import type { OrgRole } from '@/backend/contracts';
import { getSupabase } from '@/backend/supabase';
import type { ClientTemplate, PhotoRef } from '@/domain/types';
import {
  fromServerNode,
  fromServerPhoto,
  fromServerProject,
  fromServerSpan,
  fromServerTemplate,
  PHOTO_BUCKET,
  type ServerNodeRow,
  type ServerPhotoRow,
  type ServerProjectRow,
  type ServerSpanRow,
  type ServerTemplateRow,
} from '@/sync/serverMapping';

import type {
  ActivityEntry,
  CheckoutRequest,
  FootageRow,
  Invite,
  Member,
  OrgDetail,
  OverviewStats,
  ProjectData,
  ProjectSummary,
  UsageRow,
} from './types';

export interface AdminApi {
  overview(orgId: string): Promise<OverviewStats>;
  projectSummaries(orgId: string): Promise<ProjectSummary[]>;
  activity(orgId: string, limit?: number): Promise<ActivityEntry[]>;
  project(orgId: string, projectId: string): Promise<ProjectData | null>;
  /** Active projects with their nodes, spans and photo records (for the overview map and QC). */
  activeProjects(orgId: string, maxProjects?: number): Promise<ProjectData[]>;
  /** Short-lived links to view private photos, keyed by storage path. */
  signedPhotoUrls(paths: string[]): Promise<Record<string, string>>;
  members(orgId: string, detailed: boolean): Promise<Member[]>;
  invites(orgId: string): Promise<Invite[]>;
  createInvite(orgId: string, email: string, role: OrgRole): Promise<Invite>;
  revokeInvite(orgId: string, inviteId: string): Promise<void>;
  changeRole(orgId: string, userId: string, role: OrgRole): Promise<void>;
  removeMember(orgId: string, userId: string): Promise<void>;
  aiUsage(orgId: string, months: number): Promise<UsageRow[]>;
  footageByTech(orgId: string, weeks: number): Promise<FootageRow[]>;
  org(orgId: string): Promise<OrgDetail>;
  renameOrg(orgId: string, name: string): Promise<void>;
  /** Returns the Stripe Checkout URL to send the browser to. */
  startCheckout(req: CheckoutRequest): Promise<string>;
  /** Returns the Stripe Customer Portal URL. */
  openBillingPortal(orgId: string): Promise<string>;
}

/** Error with a message that is safe to show, plus an optional machine code from the server. */
export class AdminApiError extends Error {
  constructor(
    message: string,
    public code: string | null = null,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export const FIXTURES_ENABLED = process.env.EXPO_PUBLIC_ADMIN_FIXTURES === '1';

let override: AdminApi | null = null;
let fixtureApi: AdminApi | null = null;

/** For tests and fixture mode: replace the data source. */
export function __setAdminApiForTests(api: AdminApi | null) {
  override = api;
}

export function getAdminApi(): AdminApi | null {
  if (override) return override;
  if (FIXTURES_ENABLED) {
    // Lazy so the fixture data never loads in a normal build.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fixtureApi ??= (require('./fixtures') as typeof import('./fixtures')).createFixtureApi();
    return fixtureApi;
  }
  const sb = getSupabase();
  return sb ? createSupabaseAdminApi(sb) : null;
}

// ---------------------------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------------------------

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (v: unknown): number | null => (v == null ? null : num(v));
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);

type Row = Record<string, unknown>;

/** Turns a PostgREST / RPC error into a readable AdminApiError. */
function fail(error: { message?: string; code?: string } | null, fallback: string): never {
  const msg = error?.message?.trim();
  if (error?.code === '42501' || /permission denied/i.test(msg ?? '')) {
    throw new AdminApiError(msg && !/permission denied/i.test(msg) ? msg : 'Your role does not allow this.', 'forbidden');
  }
  throw new AdminApiError(msg || fallback, error?.code ?? null);
}

const PAGE = 1000;

/** Reads every row of a query in pages of 1000 (PostgREST caps a single response). */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  max = 20_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) fail(error, 'Could not load data');
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export function mapOverview(j: Row): OverviewStats {
  return {
    footageWeekFt: num(j.footage_week_ft),
    footageMonthFt: num(j.footage_month_ft),
    footageTotalFt: num(j.footage_total_ft),
    nodesTotal: num(j.nodes_total),
    nodesWeek: num(j.nodes_week),
    projectsActive: num(j.projects_active),
    activeTechs7d: num(j.active_techs_7d),
    members: num(j.members),
    seatLimit: num(j.seat_limit, 1),
    aiQuota: num(j.ai_quota),
    aiPhotosMonth: numOrNull(j.ai_photos_month),
    aiCostMonthUsd: numOrNull(j.ai_cost_month_usd),
  };
}

export function mapProjectSummary(r: Row): ProjectSummary {
  const editors = Array.isArray(r.editors) ? (r.editors as Row[]) : [];
  return {
    id: str(r.id),
    name: str(r.name),
    client: str(r.client),
    jobNumber: str(r.job_number),
    workType: (str(r.work_type) || 'aerial') as ProjectSummary['workType'],
    status: (str(r.status) || 'active') as ProjectSummary['status'],
    createdAt: str(r.created_at),
    lastUpdatedAt: str(r.last_updated_at ?? r.created_at),
    nodeCount: num(r.node_count),
    spanCount: num(r.span_count),
    aerialFt: num(r.aerial_ft),
    undergroundFt: num(r.underground_ft),
    totalFt: num(r.total_ft),
    editors: editors.map((e) => ({ userId: str(e.user_id), name: strOrNull(e.name) })),
  };
}

export function mapActivity(r: Row): ActivityEntry {
  return {
    id: num(r.id),
    at: str(r.at),
    actorId: strOrNull(r.actor),
    actorName: strOrNull(r.actor_name),
    table: str(r.table_name),
    rowId: str(r.row_id),
    action: str(r.action),
    changedKeys: Array.isArray(r.changed_keys) ? (r.changed_keys as string[]) : null,
    projectId: strOrNull(r.project_id),
    projectName: strOrNull(r.project_name),
    rowLabel: strOrNull(r.row_label),
    nodeType: strOrNull(r.node_type),
  };
}

export function mapMember(r: Row): Member {
  return {
    userId: str(r.user_id),
    email: strOrNull(r.email),
    fullName: strOrNull(r.full_name),
    role: str(r.role) as OrgRole,
    joinedAt: str(r.joined_at ?? r.created_at),
    lastActiveAt: strOrNull(r.last_active_at),
  };
}

export function mapInvite(r: Row): Invite {
  return {
    id: str(r.id),
    email: str(r.email),
    role: str(r.role) as OrgRole,
    token: str(r.token),
    createdAt: str(r.created_at),
    expiresAt: str(r.expires_at),
  };
}

export function mapUsage(r: Row): UsageRow {
  return {
    month: str(r.month).slice(0, 10),
    userId: strOrNull(r.user_id),
    name: strOrNull(r.full_name),
    photos: num(r.photo_count),
    errors: num(r.error_count),
    costUsd: num(r.cost_usd_estimate),
  };
}

export function mapFootage(r: Row): FootageRow {
  return {
    weekStart: str(r.week_start).slice(0, 10),
    userId: strOrNull(r.user_id),
    name: strOrNull(r.full_name),
    aerialFt: num(r.aerial_ft),
    undergroundFt: num(r.underground_ft),
    spans: num(r.span_count),
  };
}

export function mapOrg(r: Row): OrgDetail {
  return {
    id: str(r.id),
    name: str(r.name),
    slug: str(r.slug),
    plan: (str(r.plan) || 'trial') as OrgDetail['plan'],
    subscriptionStatus: str(r.subscription_status) || 'trialing',
    seatLimit: num(r.seat_limit, 1),
    aiMonthlyPhotoQuota: num(r.ai_monthly_photo_quota),
    trialEndsAt: strOrNull(r.trial_ends_at),
    hasStripeCustomer: !!r.stripe_customer_id,
    hasSubscription: !!r.stripe_subscription_id,
    createdAt: str(r.created_at),
  };
}

/** Reads `{ error, code }` from a failed Edge Function call. */
async function functionError(error: unknown, fallback: string): Promise<AdminApiError> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = (await (ctx as Response).clone().json()) as { error?: string; code?: string };
      if (body?.error) return new AdminApiError(body.error, body.code ?? null);
    } catch {
      // fall through
    }
  }
  const msg = (error as Error)?.message;
  return new AdminApiError(msg && !/non-2xx/i.test(msg) ? msg : fallback);
}

export function createSupabaseAdminApi(sb: SupabaseClient): AdminApi {
  async function rpc<T = unknown>(fn: string, args: Record<string, unknown>, fallback: string): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) fail(error, fallback);
    return data as T;
  }

  async function loadTemplate(orgId: string, id: string | null): Promise<ClientTemplate | null> {
    if (!id) return null;
    const { data, error } = await sb.from('client_templates').select('*').eq('org_id', orgId).eq('id', id).maybeSingle();
    if (error) fail(error, 'Could not load the template');
    return data ? fromServerTemplate(data as ServerTemplateRow) : null;
  }

  async function childRows<T>(table: string, orgId: string, projectIds: string[], order: string): Promise<T[]> {
    if (!projectIds.length) return [];
    return fetchAll<T>((from, to) =>
      sb
        .from(table)
        .select('*')
        .eq('org_id', orgId)
        .in('project_id', projectIds)
        .is('deleted_at', null)
        .order(order)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    );
  }

  async function bundles(orgId: string, projectRows: ServerProjectRow[]): Promise<ProjectData[]> {
    const ids = projectRows.map((p) => p.id);
    const [nodes, spans, photos] = await Promise.all([
      childRows<ServerNodeRow>('nodes', orgId, ids, 'seq'),
      childRows<ServerSpanRow>('spans', orgId, ids, 'created_at'),
      childRows<ServerPhotoRow>('photos', orgId, ids, 'taken_at'),
    ]);
    const templateIds = [...new Set(projectRows.map((p) => p.template_id).filter((x): x is string => !!x))];
    const templates = new Map<string, ClientTemplate>();
    if (templateIds.length) {
      const { data, error } = await sb.from('client_templates').select('*').eq('org_id', orgId).in('id', templateIds);
      if (error) fail(error, 'Could not load templates');
      for (const r of (data ?? []) as ServerTemplateRow[]) templates.set(r.id, fromServerTemplate(r));
    }
    return projectRows.map((pr) => ({
      project: fromServerProject(pr),
      nodes: nodes.filter((n) => n.project_id === pr.id).map(fromServerNode),
      spans: spans.filter((s) => s.project_id === pr.id).map(fromServerSpan),
      photos: photos.filter((p) => p.project_id === pr.id).map(fromServerPhoto),
      template: pr.template_id ? templates.get(pr.template_id) ?? null : null,
    }));
  }

  return {
    async overview(orgId) {
      return mapOverview((await rpc<Row>('admin_overview', { p_org: orgId }, 'Could not load the overview')) ?? {});
    },

    async projectSummaries(orgId) {
      const rows = await rpc<Row[]>('admin_project_summaries', { p_org: orgId }, 'Could not load projects');
      return (rows ?? []).map(mapProjectSummary);
    },

    async activity(orgId, limit = 30) {
      const rows = await rpc<Row[]>('admin_activity', { p_org: orgId, p_limit: limit }, 'Could not load activity');
      return (rows ?? []).map(mapActivity);
    },

    async project(orgId, projectId) {
      const { data, error } = await sb
        .from('projects')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) fail(error, 'Could not load the project');
      if (!data) return null;
      const [b] = await bundles(orgId, [data as ServerProjectRow]);
      if (!b.template && (data as ServerProjectRow).template_id) b.template = await loadTemplate(orgId, (data as ServerProjectRow).template_id);
      return b;
    },

    async activeProjects(orgId, maxProjects = 25) {
      const { data, error } = await sb
        .from('projects')
        .select('*')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(maxProjects);
      if (error) fail(error, 'Could not load projects');
      return bundles(orgId, (data ?? []) as ServerProjectRow[]);
    },

    async signedPhotoUrls(paths) {
      const unique = [...new Set(paths.filter(Boolean))];
      const out: Record<string, string> = {};
      for (let i = 0; i < unique.length; i += 100) {
        const chunk = unique.slice(i, i + 100);
        const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(chunk, 60 * 60);
        if (error) throw new AdminApiError('Could not load photos: ' + error.message);
        for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
      }
      return out;
    },

    async members(orgId, detailed) {
      if (detailed) {
        const rows = await rpc<Row[]>('admin_org_members', { p_org: orgId }, 'Could not load the team');
        return (rows ?? []).map(mapMember);
      }
      // Managers and below: names and roles only (no emails), straight from RLS-protected tables.
      const { data, error } = await sb.from('org_members').select('user_id, role, created_at').eq('org_id', orgId);
      if (error) fail(error, 'Could not load the team');
      const rows = (data ?? []) as Row[];
      const ids = rows.map((r) => str(r.user_id));
      const names = new Map<string, string | null>();
      if (ids.length) {
        const { data: profs } = await sb.from('profiles').select('id, full_name').in('id', ids);
        for (const p of (profs ?? []) as Row[]) names.set(str(p.id), strOrNull(p.full_name));
      }
      return rows.map((r) => mapMember({ ...r, full_name: names.get(str(r.user_id)) ?? null, joined_at: r.created_at }));
    },

    async invites(orgId) {
      const { data, error } = await sb
        .from('org_invites')
        .select('id, email, role, token, created_at, expires_at')
        .eq('org_id', orgId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false });
      if (error) fail(error, 'Could not load invites');
      return ((data ?? []) as Row[]).map(mapInvite);
    },

    async createInvite(orgId, email, role) {
      const row = await rpc<Row>('admin_create_invite', { p_org: orgId, p_email: email, p_role: role }, 'Could not create the invite');
      return mapInvite(row ?? {});
    },

    async revokeInvite(orgId, inviteId) {
      const { data, error } = await sb.from('org_invites').delete().eq('org_id', orgId).eq('id', inviteId).select('id');
      if (error) fail(error, 'Could not revoke the invite');
      if (!data?.length) throw new AdminApiError('That invite was already used or removed.');
    },

    async changeRole(orgId, userId, role) {
      const { data, error } = await sb.from('org_members').update({ role }).eq('org_id', orgId).eq('user_id', userId).select('user_id');
      if (error) fail(error, 'Could not change the role');
      if (!data?.length) throw new AdminApiError('Your role does not allow changing this member.', 'forbidden');
    },

    async removeMember(orgId, userId) {
      const { data, error } = await sb.from('org_members').delete().eq('org_id', orgId).eq('user_id', userId).select('user_id');
      if (error) fail(error, 'Could not remove the member');
      if (!data?.length) throw new AdminApiError('Your role does not allow removing this member.', 'forbidden');
    },

    async aiUsage(orgId, months) {
      const rows = await rpc<Row[]>('admin_ai_usage', { p_org: orgId, p_months: months }, 'Could not load AI usage');
      return (rows ?? []).map(mapUsage);
    },

    async footageByTech(orgId, weeks) {
      const rows = await rpc<Row[]>('admin_footage_by_tech', { p_org: orgId, p_weeks: weeks }, 'Could not load footage');
      return (rows ?? []).map(mapFootage);
    },

    async org(orgId) {
      const { data, error } = await sb.from('organizations').select('*').eq('id', orgId).single();
      if (error) fail(error, 'Could not load the organization');
      return mapOrg(data as Row);
    },

    async renameOrg(orgId, name) {
      const { data, error } = await sb.from('organizations').update({ name: name.trim() }).eq('id', orgId).select('id');
      if (error) fail(error, 'Could not rename the organization');
      if (!data?.length) throw new AdminApiError('Only owners and admins can rename the organization.', 'forbidden');
    },

    async startCheckout(req) {
      const { data, error } = await sb.functions.invoke<{ url?: string }>('create-checkout', { body: req });
      if (error) throw await functionError(error, 'Could not start checkout');
      if (!data?.url) throw new AdminApiError('Checkout did not return a link');
      return data.url;
    },

    async openBillingPortal(orgId) {
      const { data, error } = await sb.functions.invoke<{ url?: string }>('billing-portal', { body: { orgId } });
      if (error) throw await functionError(error, 'Could not open billing');
      if (!data?.url) throw new AdminApiError('Billing portal did not return a link');
      return data.url;
    },
  };
}

/** Swaps storage paths for signed URLs on photo records (original and watermarked copy). */
export function withPhotoUrls(photos: PhotoRef[], urls: Record<string, string>): PhotoRef[] {
  return photos.map((p) => ({
    ...p,
    uri: (p.storagePath && urls[p.storagePath]) || p.uri,
    watermarkedUri: (p.watermarkedPath && urls[p.watermarkedPath]) || p.watermarkedUri,
  }));
}
