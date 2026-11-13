// Data shapes used by the web dashboard (camelCase versions of the 0003_admin.sql function rows).
import type { OrgRole } from '@/backend/contracts';
import type { ClientTemplate, MapNode, PhotoRef, Project, Span } from '@/domain/types';

import type { BillingInterval, PaidPlanId } from './plans';

export interface OverviewStats {
  footageWeekFt: number;
  footageMonthFt: number;
  footageTotalFt: number;
  nodesTotal: number;
  nodesWeek: number;
  projectsActive: number;
  activeTechs7d: number;
  members: number;
  seatLimit: number;
  aiQuota: number;
  /** Null when the viewer's role may not see team AI usage. */
  aiPhotosMonth: number | null;
  aiCostMonthUsd: number | null;
}

export interface Editor {
  userId: string;
  name: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  client: string;
  jobNumber: string;
  workType: Project['workType'];
  status: Project['status'];
  createdAt: string;
  lastUpdatedAt: string;
  nodeCount: number;
  spanCount: number;
  aerialFt: number;
  undergroundFt: number;
  totalFt: number;
  editors: Editor[];
}

export interface ActivityEntry {
  id: number;
  at: string;
  actorId: string | null;
  actorName: string | null;
  table: 'projects' | 'nodes' | 'spans' | string;
  rowId: string;
  action: 'insert' | 'update' | 'delete' | 'soft_delete' | 'restore' | string;
  changedKeys: string[] | null;
  projectId: string | null;
  projectName: string | null;
  rowLabel: string | null;
  nodeType: string | null;
}

export interface Member {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: OrgRole;
  joinedAt: string;
  lastActiveAt: string | null;
}

export interface Invite {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export interface UsageRow {
  /** First day of the month, YYYY-MM-DD. */
  month: string;
  userId: string | null;
  name: string | null;
  photos: number;
  errors: number;
  costUsd: number;
}

export interface FootageRow {
  /** Monday of the week, YYYY-MM-DD. */
  weekStart: string;
  userId: string | null;
  name: string | null;
  aerialFt: number;
  undergroundFt: number;
  spans: number;
}

export interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  plan: 'trial' | PaidPlanId;
  subscriptionStatus: string;
  seatLimit: number;
  aiMonthlyPhotoQuota: number;
  trialEndsAt: string | null;
  hasStripeCustomer: boolean;
  hasSubscription: boolean;
  createdAt: string;
}

/** Everything needed to show (and export) one project. Photo uris are signed URLs when available. */
export interface ProjectData {
  project: Project;
  nodes: MapNode[];
  spans: Span[];
  photos: PhotoRef[];
  template: ClientTemplate | null;
}

export interface CheckoutRequest {
  orgId: string;
  plan: PaidPlanId;
  interval: BillingInterval;
  seats: number;
}
