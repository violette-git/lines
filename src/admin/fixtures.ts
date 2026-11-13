// FAKE DATA for designing and screenshotting the dashboard without a backend. Loaded only when the
// build sets EXPO_PUBLIC_ADMIN_FIXTURES=1 (see api.ts and session.ts). Never enable in production.
import type { OrgRole, OrgSummary } from '@/backend/contracts';
import { buildDemoSeed } from '@/data/demoSeed';
import type { MapNode, NodeType, PhotoRef, Project, Span } from '@/domain/types';
import { destinationPoint } from '@/geo/distance';

import { AdminApiError, type AdminApi } from './api';
import { footageFromData, lastMonths, lastWeeks, weekKey } from './shaping';
import type { ActivityEntry, FootageRow, Invite, Member, OrgDetail, ProjectData, ProjectSummary, UsageRow } from './types';

export const FIXTURE_ORG_ID = '0f1c0000-0000-4000-8000-000000000001';
export const FIXTURE_ORG_2_ID = '0f1c0000-0000-4000-8000-000000000002';
export const FIXTURE_USER_ID = '0f1c0000-0000-4000-8000-0000000000a1';

const DAY = 86_400_000;
const hex = (n: number, len = 12) => n.toString(16).padStart(len, '0');
const uid = (prefix: number, n: number) => `0f1c${hex(prefix, 4)}-0000-4000-8000-${hex(n)}`;

const MEMBERS: Member[] = [
  { userId: FIXTURE_USER_ID, email: 'dana@acmefiber.example', fullName: 'Dana Whitfield', role: 'owner', joinedAt: '', lastActiveAt: null },
  { userId: uid(1, 2), email: 'marcus@acmefiber.example', fullName: 'Marcus Bell', role: 'admin', joinedAt: '', lastActiveAt: null },
  { userId: uid(1, 3), email: 'priya@acmefiber.example', fullName: 'Priya Natarajan', role: 'manager', joinedAt: '', lastActiveAt: null },
  { userId: uid(1, 4), email: 'jt.ramos@acmefiber.example', fullName: 'J.T. Ramos', role: 'tech', joinedAt: '', lastActiveAt: null },
  { userId: uid(1, 5), email: 'kayla.o@acmefiber.example', fullName: 'Kayla Okafor', role: 'tech', joinedAt: '', lastActiveAt: null },
  { userId: uid(1, 6), email: 'sam.h@acmefiber.example', fullName: 'Sam Holloway', role: 'tech', joinedAt: '', lastActiveAt: null },
  { userId: uid(1, 7), email: 'inspector@bigtelco.example', fullName: 'Lee Carter (Big Telco)', role: 'viewer', joinedAt: '', lastActiveAt: null },
];
const TECHS = MEMBERS.filter((m) => m.role === 'tech' || m.role === 'manager');

export function fixtureOrgs(role: OrgRole = 'owner'): OrgSummary[] {
  return [
    {
      id: FIXTURE_ORG_ID,
      name: 'Acme Fiber Contractors',
      slug: 'acme-fiber',
      role,
      plan: 'pro',
      subscriptionStatus: 'active',
      seatLimit: 10,
      aiMonthlyPhotoQuota: 3000,
      trialEndsAt: null,
    },
    {
      id: FIXTURE_ORG_2_ID,
      name: 'Southern Splice Co',
      slug: 'southern-splice',
      role: 'admin',
      plan: 'trial',
      subscriptionStatus: 'trialing',
      seatLimit: 3,
      aiMonthlyPhotoQuota: 50,
      trialEndsAt: new Date(Date.now() + 9 * DAY).toISOString(),
    },
  ];
}

/** Placeholder "photo": an SVG of a pole against the sky with the node label. */
function photoDataUrl(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${hue + 20},40%,85%)"/></linearGradient></defs>
<rect width="640" height="480" fill="url(#s)"/><rect y="380" width="640" height="100" fill="hsl(100,25%,32%)"/>
<rect x="300" y="60" width="26" height="340" fill="#5b4632"/><rect x="230" y="110" width="170" height="12" fill="#5b4632"/>
<path d="M0 150 Q 160 185 313 140 T 640 150" stroke="#222" stroke-width="3" fill="none"/>
<rect x="282" y="250" width="62" height="34" rx="4" fill="#f5d000"/><text x="313" y="273" font-family="Arial" font-size="16" font-weight="700" text-anchor="middle" fill="#111">${label}</text>
<text x="16" y="466" font-family="monospace" font-size="14" fill="#fff">SAMPLE PHOTO  ${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface RouteSpec {
  id: number;
  name: string;
  client: string;
  jobNumber: string;
  workType: Project['workType'];
  status: Project['status'];
  origin: { lat: number; lng: number };
  bearing: number;
  count: number;
  spacingM: number;
  ugFrom: number;
  daysAgo: number;
}

function buildRoute(spec: RouteSpec, now: number): ProjectData {
  const pid = uid(2, spec.id);
  const created = new Date(now - (spec.daysAgo + 20) * DAY).toISOString();
  const project: Project = {
    id: pid,
    name: spec.name,
    client: spec.client,
    jobNumber: spec.jobNumber,
    workType: spec.workType,
    notes: '',
    status: spec.status,
    ratePerFoot: 0.42,
    ratePerNode: 5,
    templateId: null,
    walkMode: true,
    orgId: FIXTURE_ORG_ID,
    createdAt: created,
    updatedAt: new Date(now - spec.daysAgo * DAY).toISOString(),
  };
  const nodes: MapNode[] = [];
  const spans: Span[] = [];
  let pos = spec.origin;
  for (let i = 1; i <= spec.count; i++) {
    const ug = i >= spec.ugFrom;
    const type: NodeType = ug ? (i % 4 === 0 ? 'vault' : 'handhole') : i % 5 === 0 ? 'riser' : 'pole';
    const at = new Date(now - spec.daysAgo * DAY - (spec.count - i) * 0.6 * DAY).toISOString();
    const jitter = (i * 37) % 11;
    nodes.push({
      id: uid(3, spec.id * 1000 + i),
      projectId: pid,
      seq: i,
      type,
      label: `${type === 'pole' || type === 'riser' ? 'P' : type === 'vault' ? 'V' : 'HH'}-${i}`,
      position: { ...pos, accuracyM: 1.5 + (jitter % 6) * (i === 7 ? 3 : 0.7), altitudeM: null, samples: 8, capturedAt: at, source: 'gps_avg' },
      fields: type === 'pole' ? { pole_tag: `${spec.jobNumber.slice(-3)}${100 + i}`, owner: i % 3 ? 'Alabama Power' : 'Joint use', material: 'Wood' } : {},
      aiMeta: i % 6 === 2 ? { pole_tag: { confidence: 0.91, source: 'ai', isEstimate: false } } : {},
      iconScale: 1,
      status: i % 6 === 2 ? 'ai_done' : 'reviewed',
      notes: '',
      possibleDuplicateOf: null,
      createdAt: at,
      updatedAt: at,
    });
    if (i > 1) {
      spans.push({
        id: uid(4, spec.id * 1000 + i),
        projectId: pid,
        fromNodeId: nodes[i - 2].id,
        toNodeId: nodes[i - 1].id,
        kind: ug ? 'underground' : 'aerial',
        slackFt: i % 7 === 0 ? 50 : 0,
        sagPct: ug ? 0 : 2,
        lengthOverrideFt: null,
        fields: {},
        createdAt: at,
        updatedAt: at,
      });
    }
    pos = destinationPoint(pos, spec.bearing + ((i * 13) % 9) - 4, spec.spacingM);
  }
  const photos: PhotoRef[] = nodes
    .filter((_, i) => i % 3 !== 2)
    .map((n, i) => ({
      id: uid(5, spec.id * 1000 + n.seq),
      nodeId: n.id,
      projectId: pid,
      uri: photoDataUrl(n.label, 195 + ((i * 17) % 30)),
      watermarkedUri: null,
      width: 640,
      height: 480,
      takenAt: n.createdAt,
      fix: n.position,
      isPrimary: true,
    }));
  return { project, nodes, spans, photos, template: null };
}

function buildData(now: number): ProjectData[] {
  const demo = buildDemoSeed(now - 1.5 * DAY);
  const demoProject = { ...demo.projects[0], orgId: FIXTURE_ORG_ID, updatedAt: new Date(now - 2 * 3600_000).toISOString() };
  const demoPhotos: PhotoRef[] = demo.nodes
    .filter((n) => n.seq % 4 !== 0)
    .map((n, i) => ({
      id: uid(6, n.seq),
      nodeId: n.id,
      projectId: demoProject.id,
      uri: photoDataUrl(n.label, 200 + i * 3),
      watermarkedUri: null,
      width: 640,
      height: 480,
      takenAt: n.createdAt,
      fix: n.position,
      isPrimary: true,
    }));
  const routes: RouteSpec[] = [
    { id: 1, name: 'Lakeview FTTH Phase 2', client: 'Spire Broadband', jobNumber: 'SB-24117', workType: 'mixed', status: 'active', origin: { lat: 33.5032, lng: -86.7905 }, bearing: 140, count: 22, spacingM: 58, ugFrom: 12, daysAgo: 0.2 },
    { id: 2, name: 'Hwy 280 make-ready', client: 'Big Telco', jobNumber: 'BT-88021', workType: 'aerial', status: 'active', origin: { lat: 33.4925, lng: -86.7705 }, bearing: 115, count: 18, spacingM: 72, ugFrom: 99, daysAgo: 1 },
    { id: 3, name: 'Avondale conduit audit', client: 'City of Birmingham', jobNumber: 'COB-311', workType: 'underground', status: 'active', origin: { lat: 33.5262, lng: -86.7745 }, bearing: 75, count: 12, spacingM: 64, ugFrom: 1, daysAgo: 3 },
    { id: 4, name: 'Southside backbone QC', client: 'Big Telco', jobNumber: 'BT-87110', workType: 'qc', status: 'complete', origin: { lat: 33.4985, lng: -86.8075 }, bearing: 30, count: 14, spacingM: 66, ugFrom: 99, daysAgo: 19 },
    { id: 5, name: 'Five Points drop survey', client: 'Spire Broadband', jobNumber: 'SB-23090', workType: 'aerial', status: 'archived', origin: { lat: 33.4995, lng: -86.7905 }, bearing: 200, count: 9, spacingM: 48, ugFrom: 99, daysAgo: 64 },
  ];
  return [
    { project: demoProject, nodes: demo.nodes, spans: demo.spans, photos: demoPhotos, template: demo.templates[0] },
    ...routes.map((r) => buildRoute(r, now)),
  ];
}

function editorsFor(i: number) {
  const pick = [TECHS[i % TECHS.length], TECHS[(i + 1) % TECHS.length]];
  return pick.map((m) => ({ userId: m.userId, name: m.fullName }));
}

function summaries(data: ProjectData[]): ProjectSummary[] {
  return data.map((d, i) => {
    const f = footageFromData(d.nodes, d.spans);
    return {
      id: d.project.id,
      name: d.project.name,
      client: d.project.client,
      jobNumber: d.project.jobNumber,
      workType: d.project.workType,
      status: d.project.status,
      createdAt: d.project.createdAt,
      lastUpdatedAt: d.project.updatedAt,
      nodeCount: d.nodes.length,
      spanCount: d.spans.length,
      aerialFt: f.aerialFt,
      undergroundFt: f.undergroundFt,
      totalFt: f.totalFt,
      editors: editorsFor(i),
    };
  });
}

function activity(data: ProjectData[], now: number): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const actions: ActivityEntry['action'][] = ['insert', 'update', 'insert', 'update', 'insert', 'soft_delete', 'update'];
  let id = 9000;
  for (let k = 0; k < 24; k++) {
    const d = data[k % 4];
    const n = d.nodes[(k * 5) % d.nodes.length];
    const actor = TECHS[k % TECHS.length];
    const action = actions[k % actions.length];
    const isSpan = k % 5 === 4;
    out.push({
      id: id--,
      at: new Date(now - (k * 47 + 6) * 60_000).toISOString(),
      actorId: actor.userId,
      actorName: actor.fullName,
      table: isSpan ? 'spans' : 'nodes',
      rowId: n.id,
      action,
      changedKeys: action === 'update' ? (k % 2 ? ['fields', 'ai_meta', 'status'] : ['lat', 'lng']) : null,
      projectId: d.project.id,
      projectName: d.project.name,
      rowLabel: isSpan ? null : n.label,
      nodeType: isSpan ? null : n.type,
    });
  }
  return out;
}

function usage(now: number): UsageRow[] {
  const months = lastMonths(6, now);
  const rows: UsageRow[] = [];
  months.forEach((m, mi) => {
    TECHS.forEach((t, ti) => {
      const base = [310, 260, 190, 70][ti % 4];
      const growth = 0.55 + mi * 0.11;
      const isCurrent = mi === months.length - 1;
      const photos = Math.round(base * growth * (isCurrent ? 0.45 : 1));
      rows.push({ month: m, userId: t.userId, name: t.fullName, photos, errors: Math.round(photos * 0.02), costUsd: photos * 0.0168 });
    });
  });
  return rows;
}

function footage(now: number): FootageRow[] {
  const weeks = lastWeeks(8, now);
  const rows: FootageRow[] = [];
  weeks.forEach((w, wi) => {
    TECHS.forEach((t, ti) => {
      const aerial = [5200, 4300, 900, 3100][ti % 4] * (0.6 + ((wi * 7 + ti * 3) % 9) / 10);
      const ug = [800, 1900, 300, 2600][ti % 4] * (0.5 + ((wi * 5 + ti) % 7) / 8);
      const partial = wi === weeks.length - 1 ? 0.4 : 1;
      rows.push({ weekStart: w, userId: t.userId, name: t.fullName, aerialFt: aerial * partial, undergroundFt: ug * partial, spans: Math.round(((aerial + ug) * partial) / 210) });
    });
  });
  return rows;
}

/** Fake API backed by in-memory data. Mutations (invites, roles) change the in-memory copy. */
export function createFixtureApi(now: number = Date.now()): AdminApi {
  const data = buildData(now);
  const members: Member[] = MEMBERS.map((m, i) => ({
    ...m,
    joinedAt: new Date(now - (200 - i * 23) * DAY).toISOString(),
    lastActiveAt: i === 6 ? new Date(now - 12 * DAY).toISOString() : new Date(now - (i * 97 + 4) * 60_000).toISOString(),
  }));
  let invites: Invite[] = [
    { id: uid(7, 1), email: 'new.tech@acmefiber.example', role: 'tech', token: 'f00dfeed'.repeat(6), createdAt: new Date(now - 2 * DAY).toISOString(), expiresAt: new Date(now + 5 * DAY).toISOString() },
  ];
  const org: OrgDetail = {
    id: FIXTURE_ORG_ID,
    name: 'Acme Fiber Contractors',
    slug: 'acme-fiber',
    plan: 'pro',
    subscriptionStatus: 'active',
    seatLimit: 10,
    aiMonthlyPhotoQuota: 3000,
    trialEndsAt: null,
    hasStripeCustomer: true,
    hasSubscription: true,
    createdAt: new Date(now - 210 * DAY).toISOString(),
  };
  const usageRows = usage(now);
  const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

  return {
    async overview() {
      const week = weekKey(now);
      const foot = footage(now).filter((r) => r.weekStart === week);
      const monthPhotos = usageRows.filter((r) => r.month === lastMonths(1, now)[0]);
      return wait({
        footageWeekFt: foot.reduce((s, r) => s + r.aerialFt + r.undergroundFt, 0),
        footageMonthFt: 61_840,
        footageTotalFt: summaries(data).reduce((s, p) => s + p.totalFt, 0) + 380_000,
        nodesTotal: data.reduce((s, d) => s + d.nodes.length, 0) + 2_400,
        nodesWeek: 143,
        projectsActive: data.filter((d) => d.project.status === 'active').length,
        activeTechs7d: 4,
        members: members.length,
        seatLimit: org.seatLimit,
        aiQuota: org.aiMonthlyPhotoQuota,
        aiPhotosMonth: monthPhotos.reduce((s, r) => s + r.photos, 0),
        aiCostMonthUsd: monthPhotos.reduce((s, r) => s + r.costUsd, 0),
      });
    },
    async projectSummaries() {
      return wait(summaries(data));
    },
    async activity(_org, limit = 30) {
      return wait(activity(data, now).slice(0, limit));
    },
    async project(_org, id) {
      return wait(data.find((d) => d.project.id === id) ?? null);
    },
    async activeProjects() {
      return wait(data.filter((d) => d.project.status === 'active'));
    },
    async signedPhotoUrls() {
      return {};
    },
    async members(_org, detailed) {
      return wait(detailed ? members : members.map((m) => ({ ...m, email: null, lastActiveAt: null })));
    },
    async invites() {
      return wait(invites);
    },
    async createInvite(_org, email, role) {
      if (members.length >= org.seatLimit) throw new AdminApiError('All seats are in use. Add seats on the Billing page before inviting.');
      const inv: Invite = { id: uid(7, invites.length + 2), email: email.trim().toLowerCase(), role, token: 'abc123'.repeat(8), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * DAY).toISOString() };
      invites = [inv, ...invites.filter((i) => i.email !== inv.email)];
      return wait(inv);
    },
    async revokeInvite(_org, id) {
      invites = invites.filter((i) => i.id !== id);
      await wait(null);
    },
    async changeRole(_org, userId, role) {
      const m = members.find((x) => x.userId === userId);
      if (m) m.role = role;
      await wait(null);
    },
    async removeMember(_org, userId) {
      const i = members.findIndex((x) => x.userId === userId);
      if (i >= 0) members.splice(i, 1);
      await wait(null);
    },
    async aiUsage() {
      return wait(usageRows);
    },
    async footageByTech() {
      return wait(footage(now));
    },
    async org(orgId) {
      if (orgId === FIXTURE_ORG_2_ID) {
        return wait({
          ...org,
          id: FIXTURE_ORG_2_ID,
          name: 'Southern Splice Co',
          slug: 'southern-splice',
          plan: 'trial',
          subscriptionStatus: 'trialing',
          seatLimit: 3,
          aiMonthlyPhotoQuota: 50,
          trialEndsAt: new Date(now + 9 * DAY).toISOString(),
          hasStripeCustomer: false,
          hasSubscription: false,
        });
      }
      return wait({ ...org });
    },
    async renameOrg(_org, name) {
      org.name = name;
      await wait(null);
    },
    async startCheckout() {
      throw new AdminApiError('Fixture mode: Stripe is not connected. In a real deployment this opens Stripe Checkout.');
    },
    async openBillingPortal() {
      throw new AdminApiError('Fixture mode: Stripe is not connected. In a real deployment this opens the Stripe billing portal.');
    },
  };
}
