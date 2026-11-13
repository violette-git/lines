import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';

import { applyAiResult, createAiClient } from '@/ai';
import { getPhotoStore, getRepository } from '@/data';
import type { SyncTable } from '@/domain/contracts';
import { makeLabel } from '@/domain/labels';
import { NODE_SCHEMAS, NODE_TYPE_META } from '@/domain/nodeSchemas';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ClientTemplate,
  type GeoFix,
  type LatLng,
  type MapNode,
  type NodeType,
  type PhotoRef,
  type Project,
  type Span,
  type SpanKind,
  type SpanWithLength,
} from '@/domain/types';
import { computeSpanLengths, findPossibleDuplicate, offsetPosition } from '@/geo';

const now = () => new Date().toISOString();

export interface Tally {
  nodeCount: number;
  nodesByType: Partial<Record<NodeType, number>>;
  aerialFt: number;
  undergroundFt: number;
  totalFt: number;
  earnings: number | null;
  aiPending: number;
  duplicates: number;
}

export interface CaptureInput {
  type: NodeType;
  fix: GeoFix;
  /** Temp URI of the original photo, if any. */
  photoUri?: string | null;
  photoWidth?: number;
  photoHeight?: number;
  label?: string;
  notes?: string;
}

/** What a sync pull changed locally (ids per table), so open screens can refresh live. */
export interface RemoteChange {
  projectIds: string[];
  tables: Partial<Record<SyncTable, { upserted: string[]; deleted: string[] }>>;
}

interface State {
  ready: boolean;
  /** Company whose projects are shown next to local-only ones. Null = signed out / no company. */
  activeOrgId: string | null;
  /** New projects go into the active company (false for roles that cannot create company projects). */
  createProjectsInOrg: boolean;
  settings: AppSettings;
  projects: Project[];
  templates: ClientTemplate[];
  activeProjectId: string | null;
  nodes: MapNode[];
  spans: Span[];
  photos: PhotoRef[];
  /** Last node captured in the active project (walk mode connects from here). */
  lastNodeId: string | null;
  aiErrors: Record<string, string>;

  init(): Promise<void>;
  saveSettings(patch: Partial<AppSettings>): Promise<void>;
  /** Switches the visible company. Called by sync wiring (setSyncActiveOrg). */
  setActiveOrg(orgId: string | null, opts?: { createProjectsInOrg?: boolean }): Promise<void>;
  /** Re-reads the project and template lists (after a pull). */
  reloadLists(): Promise<void>;
  /** Applies rows a sync pull wrote to the phone to the in-memory state. */
  applyRemoteChanges(change: RemoteChange): Promise<void>;
  /** Moves a local-only project (nodes, spans, photos, and a copy of its template) into the active company. */
  moveProjectToActiveOrg(projectId: string): Promise<void>;

  createProject(p: Partial<Project> & { name: string }): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<void>;
  deleteProject(id: string): Promise<void>;
  openProject(id: string): Promise<void>;

  captureNode(input: CaptureInput): Promise<MapNode>;
  updateNode(id: string, patch: Partial<MapNode>): Promise<void>;
  setNodeField(id: string, key: string, value: MapNode['fields'][string]): Promise<void>;
  moveNode(id: string, to: LatLng): Promise<void>;
  recalibrateNode(id: string, fix: GeoFix): Promise<void>;
  shiftAllNodes(dLat: number, dLng: number): Promise<void>;
  deleteNode(id: string): Promise<void>;
  clearDuplicateFlag(id: string): Promise<void>;
  addPhotoToNode(nodeId: string, photoUri: string, w: number, h: number, fix: GeoFix | null): Promise<PhotoRef>;
  setPhotoWatermark(photoId: string, watermarkedUri: string): Promise<void>;

  addSpan(fromNodeId: string, toNodeId: string, kind?: SpanKind): Promise<Span | null>;
  updateSpan(id: string, patch: Partial<Span>): Promise<void>;
  deleteSpan(id: string): Promise<void>;

  upsertTemplate(t: Partial<ClientTemplate> & { name: string }): Promise<ClientTemplate>;
  deleteTemplate(id: string): Promise<void>;

  runAi(nodeId: string): Promise<void>;
  runPendingAi(): Promise<void>;
}

// Company photos from other phones have no local file until fetched. Sync registers a resolver
// (src/sync/photoCache.ts) so AI can still read them; the store does not import sync itself.
let remotePhotoResolver: ((p: PhotoRef) => Promise<string | null>) | null = null;
export function setRemotePhotoResolver(fn: ((p: PhotoRef) => Promise<string | null>) | null) {
  remotePhotoResolver = fn;
}

export const useStore = create<State>((set, get) => {
  const repo = getRepository();
  const photoStore = getPhotoStore();

  const activeProject = () => get().projects.find((p) => p.id === get().activeProjectId) ?? null;
  const templateFor = (p: Project | null) =>
    p?.templateId ? get().templates.find((t) => t.id === p.templateId) ?? null : null;

  // Visible = local-only, or in the active company.
  const visible = (orgId: string | null | undefined) => !orgId || orgId === get().activeOrgId;

  // ---- Per-node serialized updates ----
  // Every node write runs in a queue per node id and computes its new value from the LATEST state
  // when it runs (not when it was requested). Without this, an AI result computed from an older
  // copy could overwrite a label typed meanwhile, or a label edit could wipe an AI result.
  const nodeQueues = new Map<string, Promise<unknown>>();
  function enqueueNode<T>(id: string, task: () => Promise<T>): Promise<T> {
    const prev = nodeQueues.get(id) ?? Promise.resolve();
    const run = prev.then(task, task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    nodeQueues.set(id, tail);
    void tail.then(() => {
      if (nodeQueues.get(id) === tail) nodeQueues.delete(id);
    });
    return run;
  }

  /** Applies fn to the latest copy of the node, saves and publishes it. No-op if the node is gone. */
  function mutateNode(id: string, fn: (latest: MapNode) => MapNode | null): Promise<MapNode | null> {
    return enqueueNode(id, async () => {
      const cur = get().nodes.find((x) => x.id === id);
      if (!cur) return null;
      const next = fn(cur);
      if (!next) return cur;
      await repo.upsertNode(next);
      set((s) => ({ nodes: s.nodes.map((x) => (x.id === id ? next : x)) }));
      return next;
    });
  }

  /** Inserts a brand new node (queued under its id like every other node write). */
  function insertNode(n: MapNode): Promise<void> {
    return enqueueNode(n.id, async () => {
      await repo.upsertNode(n);
      set((s) => ({ nodes: s.nodes.some((x) => x.id === n.id) ? s.nodes.map((x) => (x.id === n.id ? n : x)) : [...s.nodes, n] }));
    });
  }

  async function loadLists() {
    const [projects, templates] = await Promise.all([repo.listProjects(), repo.listTemplates()]);
    return {
      projects: projects.filter((p) => visible(p.orgId)),
      templates: templates.filter((t) => visible(t.orgId)),
    };
  }

  /** Copies a local template into a company so a company project can reference it. */
  async function ensureOrgTemplate(templateId: string | null, orgId: string): Promise<string | null> {
    if (!templateId) return null;
    const all = await repo.listTemplates();
    const t = all.find((x) => x.id === templateId);
    if (!t) return null;
    if (t.orgId === orgId) return t.id;
    const copy: ClientTemplate = { ...t, id: randomUUID(), orgId, createdAt: now(), updatedAt: now() };
    await repo.upsertTemplate(copy);
    if (visible(orgId)) set((s) => ({ templates: [...s.templates, copy].sort((a, b) => a.name.localeCompare(b.name)) }));
    return copy.id;
  }

  async function touchProject() {
    const p = activeProject();
    if (!p) return;
    const np = { ...p, updatedAt: now() };
    await repo.upsertProject(np);
    set((s) => ({ projects: s.projects.map((x) => (x.id === np.id ? np : x)) }));
  }

  return {
    ready: false,
    activeOrgId: null,
    createProjectsInOrg: true,
    settings: DEFAULT_SETTINGS,
    projects: [],
    templates: [],
    activeProjectId: null,
    nodes: [],
    spans: [],
    photos: [],
    lastNodeId: null,
    aiErrors: {},

    async init() {
      if (get().ready) return;
      await repo.init();
      const [settings, lists] = await Promise.all([repo.getSettings(), loadLists()]);
      set({ settings: { ...DEFAULT_SETTINGS, ...settings }, ...lists, ready: true });
    },

    async setActiveOrg(orgId, opts) {
      const changed = orgId !== get().activeOrgId;
      set({ activeOrgId: orgId, createProjectsInOrg: opts?.createProjectsInOrg ?? true });
      if (!changed || !get().ready) return;
      const lists = await loadLists();
      const stillVisible = lists.projects.some((p) => p.id === get().activeProjectId);
      set({
        ...lists,
        ...(stillVisible ? {} : { activeProjectId: null, nodes: [], spans: [], photos: [], lastNodeId: null }),
      });
    },

    async reloadLists() {
      if (!get().ready) return;
      set(await loadLists());
    },

    async applyRemoteChanges(change) {
      if (!get().ready) return;
      const t = change.tables;
      if (t.projects || t.templates) await get().reloadLists();
      const pid = get().activeProjectId;
      if (!pid) return;
      if (!get().projects.some((p) => p.id === pid)) {
        // The open project was deleted on another phone or in the office.
        set({ activeProjectId: null, nodes: [], spans: [], photos: [], lastNodeId: null });
        return;
      }
      if (!change.projectIds.includes(pid)) return;

      // Nodes: refreshed one by one inside their queues so a pending local edit is never clobbered.
      const nodeIds = new Set([...(t.nodes?.upserted ?? []), ...(t.nodes?.deleted ?? [])]);
      await Promise.all(
        [...nodeIds].map((id) =>
          enqueueNode(id, async () => {
            const fresh = await repo.getNode(id);
            if (get().activeProjectId !== pid) return;
            set((s) => {
              const has = s.nodes.some((x) => x.id === id);
              if (!fresh || fresh.projectId !== pid) {
                return has ? { nodes: s.nodes.filter((x) => x.id !== id) } : {};
              }
              return { nodes: has ? s.nodes.map((x) => (x.id === id ? fresh : x)) : [...s.nodes, fresh] };
            });
          }),
        ),
      );

      // Spans and photos: replace only the rows the pull touched.
      const patchList = async <K extends 'spans' | 'photos'>(key: K, ids: Set<string>) => {
        if (!ids.size) return;
        const rows = (key === 'spans' ? await repo.listSpans(pid) : await repo.listPhotos(pid)) as State[K];
        if (get().activeProjectId !== pid) return;
        const byId = new Map(rows.map((r) => [r.id, r]));
        set((s) => {
          const cur = s[key] as State[K];
          const kept = cur.filter((r) => !ids.has(r.id) || byId.has(r.id)).map((r) => (ids.has(r.id) ? byId.get(r.id)! : r));
          const added = rows.filter((r) => ids.has(r.id) && !cur.some((c) => c.id === r.id));
          return { [key]: [...kept, ...added] } as Partial<State>;
        });
      };
      await patchList('spans', new Set([...(t.spans?.upserted ?? []), ...(t.spans?.deleted ?? [])]));
      await patchList('photos', new Set([...(t.photos?.upserted ?? []), ...(t.photos?.deleted ?? [])]));

      const { lastNodeId, nodes } = get();
      if (lastNodeId && !nodes.some((n) => n.id === lastNodeId)) {
        const newest = nodes.reduce<MapNode | null>((a, b) => (!a || b.seq > a.seq ? b : a), null);
        set({ lastNodeId: newest?.id ?? null });
      }
    },

    async moveProjectToActiveOrg(projectId) {
      const orgId = get().activeOrgId;
      if (!orgId) throw new Error('Sign in to a company first');
      const p = await repo.getProject(projectId);
      if (!p) throw new Error('Project not found');
      if (p.orgId === orgId) return;
      if (p.orgId) throw new Error('This project already belongs to another company');
      const templateId = await ensureOrgTemplate(p.templateId, orgId);
      if (templateId !== p.templateId) await repo.upsertProject({ ...p, templateId, updatedAt: now() });
      await repo.moveProjectToOrg(projectId, orgId);
      const moved = await repo.getProject(projectId);
      if (moved) set((s) => ({ projects: s.projects.map((x) => (x.id === projectId ? moved : x)) }));
    },

    async saveSettings(patch) {
      const settings = { ...get().settings, ...patch };
      await repo.saveSettings(settings);
      set({ settings });
    },

    async createProject(input) {
      const t = input.templateId ? get().templates.find((x) => x.id === input.templateId) : null;
      // New projects join the active company unless the caller says otherwise (orgId: null) or the
      // user's role cannot create company projects.
      const orgId =
        'orgId' in input ? (input.orgId ?? null) : get().createProjectsInOrg ? get().activeOrgId : null;
      const p: Project = {
        id: randomUUID(),
        client: t?.client ?? '',
        jobNumber: '',
        workType: 'mixed',
        notes: '',
        status: 'active',
        ratePerFoot: t?.ratePerFoot ?? null,
        ratePerNode: t?.ratePerNode ?? null,
        templateId: null,
        walkMode: true,
        createdAt: now(),
        updatedAt: now(),
        ...input,
      };
      if (orgId) p.orgId = orgId;
      else delete p.orgId;
      if (orgId && p.templateId) p.templateId = await ensureOrgTemplate(p.templateId, orgId);
      await repo.upsertProject(p);
      set((s) => ({ projects: [p, ...s.projects] }));
      return p;
    },

    async updateProject(id, patch) {
      const p = get().projects.find((x) => x.id === id);
      if (!p) return;
      const np = { ...p, ...patch, updatedAt: now() };
      await repo.upsertProject(np);
      set((s) => ({ projects: s.projects.map((x) => (x.id === id ? np : x)) }));
    },

    async deleteProject(id) {
      await repo.deleteProject(id);
      set((s) => ({
        projects: s.projects.filter((x) => x.id !== id),
        ...(s.activeProjectId === id ? { activeProjectId: null, nodes: [], spans: [], photos: [], lastNodeId: null } : {}),
      }));
    },

    async openProject(id) {
      const [nodes, spans, photos] = await Promise.all([repo.listNodes(id), repo.listSpans(id), repo.listPhotos(id)]);
      const last = [...nodes].sort((a, b) => b.seq - a.seq)[0];
      set({ activeProjectId: id, nodes, spans, photos, lastNodeId: last?.id ?? null, aiErrors: {} });
    },

    async captureNode(input) {
      const project = activeProject();
      if (!project) throw new Error('No active project');
      const template = templateFor(project);
      const { nodes, settings, lastNodeId } = get();
      const seq = nodes.reduce((m, n) => Math.max(m, n.seq), 0) + 1;
      const id = randomUUID();
      const aiOn = settings.aiMode !== 'off' && settings.aiAutoRun && !!input.photoUri;

      const node: MapNode = {
        id,
        projectId: project.id,
        seq,
        type: input.type,
        label: input.label?.trim() || makeLabel(input.type, seq, { template, jobNumber: project.jobNumber }),
        position: input.fix,
        fields: { ...(template?.defaults[input.type] ?? {}) },
        aiMeta: {},
        iconScale: 1,
        status: aiOn ? 'ai_pending' : 'draft',
        notes: input.notes ?? '',
        possibleDuplicateOf: null,
        createdAt: now(),
        updatedAt: now(),
      };
      const dup = findPossibleDuplicate(node, nodes, settings.duplicateRadiusM);
      node.possibleDuplicateOf = dup?.id ?? null;
      await insertNode(node);

      if (input.photoUri) {
        try {
          await get().addPhotoToNode(id, input.photoUri, input.photoWidth ?? 0, input.photoHeight ?? 0, input.fix);
        } catch (e) {
          // The caller reports the shot as failed and the user reshoots: do not leave a photo-less
          // node behind (it would become a duplicate, stuck in ai_pending, outside the walk chain).
          await get().deleteNode(id).catch(() => undefined);
          throw e;
        }
      }

      if (project.walkMode && lastNodeId && lastNodeId !== id && get().nodes.some((n) => n.id === lastNodeId)) {
        const prev = get().nodes.find((n) => n.id === lastNodeId)!;
        const kind: SpanKind =
          prev.type === 'pole' && node.type === 'pole'
            ? 'aerial'
            : template?.defaultSpanKind ?? NODE_TYPE_META[node.type].defaultSpan;
        await get().addSpan(lastNodeId, id, kind);
      }
      set({ lastNodeId: id });
      await touchProject();

      if (aiOn) void get().runAi(id);
      return get().nodes.find((n) => n.id === id)!;
    },

    async updateNode(id, patch) {
      await mutateNode(id, (n) => ({ ...n, ...patch, id: n.id, updatedAt: now() }));
    },

    async setNodeField(id, key, value) {
      await mutateNode(id, (n) => {
        const aiMeta = { ...n.aiMeta };
        if (aiMeta[key]) aiMeta[key] = { ...aiMeta[key], source: 'manual', confidence: 1, isEstimate: false };
        return { ...n, fields: { ...n.fields, [key]: value }, aiMeta, updatedAt: now() };
      });
    },

    async moveNode(id, to) {
      await mutateNode(id, (n) => ({
        ...n,
        position: { ...n.position, lat: to.lat, lng: to.lng, source: 'manual', capturedAt: now() },
        updatedAt: now(),
      }));
    },

    async recalibrateNode(id, fix) {
      await mutateNode(id, (n) => {
        const others = get().nodes.filter((x) => x.id !== id);
        const dup = findPossibleDuplicate({ ...n, position: fix }, others, get().settings.duplicateRadiusM);
        return { ...n, position: fix, possibleDuplicateOf: dup?.id ?? null, updatedAt: now() };
      });
    },

    async shiftAllNodes(dLat, dLng) {
      for (const { id } of get().nodes) {
        await mutateNode(id, (n) => {
          const p = offsetPosition(n.position, dLat, dLng);
          return { ...n, position: { ...n.position, ...p, source: 'manual' }, updatedAt: now() };
        });
      }
    },

    async deleteNode(id) {
      // Queued behind any in-flight update of this node, so that update cannot resurrect it.
      await enqueueNode(id, () => repo.deleteNode(id));
      set((s) => {
        const nodes = s.nodes.filter((n) => n.id !== id).map((n) => (n.possibleDuplicateOf === id ? { ...n, possibleDuplicateOf: null } : n));
        let lastNodeId = s.lastNodeId;
        if (lastNodeId === id) {
          // Keep the walk chain going (Retake deletes the newest node): fall back to the node that
          // fed into it, else the newest remaining node (same rule as openProject).
          const into = s.spans.find((sp) => sp.toNodeId === id && nodes.some((n) => n.id === sp.fromNodeId));
          const newest = nodes.reduce<MapNode | null>((a, b) => (!a || b.seq > a.seq ? b : a), null);
          lastNodeId = into?.fromNodeId ?? newest?.id ?? null;
        }
        return {
          nodes,
          spans: s.spans.filter((sp) => sp.fromNodeId !== id && sp.toNodeId !== id),
          photos: s.photos.filter((p) => p.nodeId !== id),
          lastNodeId,
        };
      });
    },

    async clearDuplicateFlag(id) {
      await get().updateNode(id, { possibleDuplicateOf: null });
    },

    async addPhotoToNode(nodeId, photoUri, w, h, fix) {
      const node = get().nodes.find((n) => n.id === nodeId);
      if (!node) throw new Error('Node not found');
      const photoId = randomUUID();
      const uri = await photoStore.persist(photoUri, photoId);
      const isPrimary = !get().photos.some((p) => p.nodeId === nodeId);
      const photo: PhotoRef = {
        id: photoId,
        nodeId,
        projectId: node.projectId,
        uri,
        watermarkedUri: null,
        width: w,
        height: h,
        takenAt: now(),
        fix,
        isPrimary,
      };
      await repo.upsertPhoto(photo);
      set((s) => ({ photos: [...s.photos, photo] }));
      return photo;
    },

    async setPhotoWatermark(photoId, watermarkedUri) {
      const p = get().photos.find((x) => x.id === photoId);
      if (!p) return;
      const np = { ...p, watermarkedUri, updatedAt: now() };
      await repo.upsertPhoto(np);
      set((s) => ({ photos: s.photos.map((x) => (x.id === photoId ? np : x)) }));
    },

    async addSpan(fromNodeId, toNodeId, kind) {
      if (fromNodeId === toNodeId) return null;
      const exists = get().spans.some(
        (s) =>
          (s.fromNodeId === fromNodeId && s.toNodeId === toNodeId) ||
          (s.fromNodeId === toNodeId && s.toNodeId === fromNodeId),
      );
      if (exists) return null;
      const project = activeProject();
      const template = templateFor(project);
      const from = get().nodes.find((n) => n.id === fromNodeId);
      const k: SpanKind = kind ?? template?.defaultSpanKind ?? (from ? NODE_TYPE_META[from.type].defaultSpan : 'aerial');
      const span: Span = {
        id: randomUUID(),
        projectId: project?.id ?? from?.projectId ?? '',
        fromNodeId,
        toNodeId,
        kind: k,
        slackFt: template?.defaultSlackFt ?? 0,
        sagPct: template?.defaultSagPct ?? (k === 'aerial' ? 2 : 0),
        lengthOverrideFt: null,
        fields: {},
        createdAt: now(),
        updatedAt: now(),
      };
      await repo.upsertSpan(span);
      set((s) => ({ spans: [...s.spans, span] }));
      return span;
    },

    async updateSpan(id, patch) {
      const sp = get().spans.find((x) => x.id === id);
      if (!sp) return;
      const ns = { ...sp, ...patch, updatedAt: now() };
      await repo.upsertSpan(ns);
      set((s) => ({ spans: s.spans.map((x) => (x.id === id ? ns : x)) }));
    },

    async deleteSpan(id) {
      await repo.deleteSpan(id);
      set((s) => ({ spans: s.spans.filter((x) => x.id !== id) }));
    },

    async upsertTemplate(input) {
      const existing = input.id ? get().templates.find((t) => t.id === input.id) : undefined;
      const t: ClientTemplate = {
        id: randomUUID(),
        client: '',
        labelPatterns: {},
        requiredFields: {},
        defaults: {},
        defaultSpanKind: 'aerial',
        defaultSagPct: 2,
        defaultSlackFt: 0,
        ratePerFoot: null,
        ratePerNode: null,
        watermarkPhotos: true,
        createdAt: now(),
        ...existing,
        ...input,
        updatedAt: now(),
      };
      await repo.upsertTemplate(t);
      set((s) => ({ templates: existing ? s.templates.map((x) => (x.id === t.id ? t : x)) : [...s.templates, t] }));
      return t;
    },

    async deleteTemplate(id) {
      await repo.deleteTemplate(id);
      set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
    },

    async runAi(nodeId) {
      const node = get().nodes.find((n) => n.id === nodeId);
      const photo = get().photos.find((p) => p.nodeId === nodeId && p.isPrimary) ?? get().photos.find((p) => p.nodeId === nodeId);
      if (!node || !photo) return;
      const client = await createAiClient(get().settings);
      if (!client) return;
      await get().updateNode(nodeId, { status: 'ai_pending' });
      try {
        const project = activeProject();
        const photoUri = photo.uri || (remotePhotoResolver ? await remotePhotoResolver(photo) : null);
        if (!photoUri) throw new Error('This photo is not on the phone yet. Connect to download it.');
        const imageBase64 = await photoStore.readBase64(photoUri);
        const fieldDefs = NODE_SCHEMAS[node.type].filter((f) => f.aiFillable);
        const prev = get().nodes.find((n) => n.seq === node.seq - 1);
        const result = await client.analyze({
          nodeType: node.type,
          imageBase64,
          // Photos are normally re-encoded to JPEG, but an import that could not be processed keeps its PNG.
          mediaType: /\.png($|\?)/i.test(photoUri) || photoUri.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
          fieldDefs,
          context: { workType: project?.workType, client: project?.client, previousLabel: prev?.label },
        });
        // Merged against the node as it is when the write runs (the user may have edited it while
        // the AI was thinking): see mutateNode.
        const saved = await mutateNode(nodeId, (fresh) => {
          const updated = applyAiResult(fresh, result, fieldDefs);
          // AI may read a pole tag, which strengthens duplicate detection.
          const tag = updated.fields.pole_tag;
          let dupId = updated.possibleDuplicateOf;
          if (!dupId && typeof tag === 'string' && tag.trim()) {
            const same = get().nodes.find(
              (n) => n.id !== nodeId && typeof n.fields.pole_tag === 'string' && n.fields.pole_tag.trim() === tag.trim(),
            );
            dupId = same?.id ?? null;
          }
          return {
            ...updated,
            possibleDuplicateOf: dupId,
            status: 'ai_done',
            aiReport: {
              summary: result.summary,
              warnings: result.warnings,
              detectedType: result.detectedType,
              typeConfidence: result.typeConfidence,
              model: get().settings.aiModel,
              analyzedAt: now(),
            },
            updatedAt: now(),
          };
        });
        if (!saved) return;
        set((s) => {
          const e = { ...s.aiErrors };
          delete e[nodeId];
          return { aiErrors: e };
        });
      } catch (err) {
        await get().updateNode(nodeId, { status: 'ai_failed' });
        set((s) => ({ aiErrors: { ...s.aiErrors, [nodeId]: err instanceof Error ? err.message : String(err) } }));
      }
    },

    async runPendingAi() {
      const pending = get().nodes.filter((n) => n.status === 'ai_pending' || n.status === 'ai_failed');
      for (const n of pending) await get().runAi(n.id);
    },
  };
});

// ---------- Selectors ----------
export function selectSpansWithLength(s: Pick<State, 'spans' | 'nodes'>): SpanWithLength[] {
  return computeSpanLengths(s.spans, s.nodes);
}

export function computeTally(nodes: MapNode[], spans: SpanWithLength[], project: Project | null): Tally {
  const nodesByType: Partial<Record<NodeType, number>> = {};
  for (const n of nodes) nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1;
  let aerialFt = 0;
  let undergroundFt = 0;
  for (const s of spans) {
    if (s.kind === 'aerial') aerialFt += s.totalFt;
    else undergroundFt += s.totalFt;
  }
  const totalFt = aerialFt + undergroundFt;
  const hasRate = project && (project.ratePerFoot != null || project.ratePerNode != null);
  const earnings = hasRate
    ? (project!.ratePerFoot ?? 0) * totalFt + (project!.ratePerNode ?? 0) * nodes.length
    : null;
  return {
    nodeCount: nodes.length,
    nodesByType,
    aerialFt,
    undergroundFt,
    totalFt,
    earnings,
    aiPending: nodes.filter((n) => n.status === 'ai_pending').length,
    duplicates: nodes.filter((n) => n.possibleDuplicateOf).length,
  };
}
