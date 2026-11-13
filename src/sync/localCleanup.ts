// "Remove company data from this phone": after signing out (or leaving a company), the company's
// projects stay in the local database, hidden. This removes them without telling the server
// (purgeLocal, no tombstones), so nothing is deleted for the rest of the company. Local-only
// projects and templates (no orgId) are never touched.
import { getRepository } from '@/data';
import type { SyncRepository } from '@/domain/contracts';
import { useStore } from '@/state/store';

import { cursorKey } from './engine';
import { SERVER_TABLES } from './serverMapping';

export interface CompanyDataFound {
  orgIds: string[];
  projectIds: string[];
  templateIds: string[];
  /** Changes and photo files that never reached the server (lost on removal). */
  unsynced: number;
}

/** Company rows on this phone that belong to companies not in keepOrgIds. */
export async function findCompanyData(keepOrgIds: string[], repo: SyncRepository = getRepository()): Promise<CompanyDataFound> {
  const keep = new Set(keepOrgIds);
  const [projects, templates] = await Promise.all([repo.listProjects(), repo.listTemplates()]);
  const stale = (orgId: string | null | undefined): orgId is string => !!orgId && !keep.has(orgId);
  const projectIds = projects.filter((p) => stale(p.orgId)).map((p) => p.id);
  const templateIds = templates.filter((t) => stale(t.orgId)).map((t) => t.id);
  const orgIds = [...new Set([...projects, ...templates].map((r) => r.orgId).filter(stale))];
  let unsynced = 0;
  for (const orgId of orgIds) {
    try {
      const c = await repo.countPending(orgId);
      unsynced += c.changes + c.photos;
    } catch {
      // Count is informational only.
    }
  }
  return { orgIds, projectIds, templateIds, unsynced };
}

/**
 * Deletes those rows (and their nodes, spans and photo files) from this phone only, and resets the
 * companies' download cursors so signing in again downloads everything fresh.
 */
export async function removeCompanyData(keepOrgIds: string[], repo: SyncRepository = getRepository()): Promise<CompanyDataFound> {
  const found = await findCompanyData(keepOrgIds, repo);
  // Projects first (cascades nodes, spans, photos), then templates.
  await repo.purgeLocal('projects', found.projectIds);
  await repo.purgeLocal('templates', found.templateIds);
  for (const orgId of found.orgIds) {
    for (const t of SERVER_TABLES) await repo.setSyncState(orgId, cursorKey(t), null);
  }
  const app = useStore.getState();
  if (app.activeProjectId && found.projectIds.includes(app.activeProjectId)) {
    useStore.setState({ activeProjectId: null, nodes: [], spans: [], photos: [], lastNodeId: null });
  }
  await useStore.getState().reloadLists();
  return found;
}
