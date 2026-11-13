import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';

import { applyAiResult, createAiClient } from '@/ai';
import { getPhotoStore, getRepository } from '@/data';
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

interface State {
  ready: boolean;
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

export const useStore = create<State>((set, get) => {
  const repo = getRepository();
  const photoStore = getPhotoStore();

  const activeProject = () => get().projects.find((p) => p.id === get().activeProjectId) ?? null;
  const templateFor = (p: Project | null) =>
    p?.templateId ? get().templates.find((t) => t.id === p.templateId) ?? null : null;

  async function putNode(n: MapNode) {
    await repo.upsertNode(n);
    set((s) => ({ nodes: s.nodes.some((x) => x.id === n.id) ? s.nodes.map((x) => (x.id === n.id ? n : x)) : [...s.nodes, n] }));
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
      const [settings, projects, templates] = await Promise.all([
        repo.getSettings(),
        repo.listProjects(),
        repo.listTemplates(),
      ]);
      set({ settings: { ...DEFAULT_SETTINGS, ...settings }, projects, templates, ready: true });
    },

    async saveSettings(patch) {
      const settings = { ...get().settings, ...patch };
      await repo.saveSettings(settings);
      set({ settings });
    },

    async createProject(input) {
      const t = input.templateId ? get().templates.find((x) => x.id === input.templateId) : null;
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
      await putNode(node);

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
      const n = get().nodes.find((x) => x.id === id);
      if (!n) return;
      await putNode({ ...n, ...patch, updatedAt: now() });
    },

    async setNodeField(id, key, value) {
      const n = get().nodes.find((x) => x.id === id);
      if (!n) return;
      const aiMeta = { ...n.aiMeta };
      if (aiMeta[key]) aiMeta[key] = { ...aiMeta[key], source: 'manual', confidence: 1, isEstimate: false };
      await putNode({ ...n, fields: { ...n.fields, [key]: value }, aiMeta, updatedAt: now() });
    },

    async moveNode(id, to) {
      const n = get().nodes.find((x) => x.id === id);
      if (!n) return;
      await putNode({
        ...n,
        position: { ...n.position, lat: to.lat, lng: to.lng, source: 'manual', capturedAt: now() },
        updatedAt: now(),
      });
    },

    async recalibrateNode(id, fix) {
      const n = get().nodes.find((x) => x.id === id);
      if (!n) return;
      const others = get().nodes.filter((x) => x.id !== id);
      const dup = findPossibleDuplicate({ ...n, position: fix }, others, get().settings.duplicateRadiusM);
      await putNode({ ...n, position: fix, possibleDuplicateOf: dup?.id ?? null, updatedAt: now() });
    },

    async shiftAllNodes(dLat, dLng) {
      for (const n of get().nodes) {
        const p = offsetPosition(n.position, dLat, dLng);
        await putNode({ ...n, position: { ...n.position, ...p, source: 'manual' }, updatedAt: now() });
      }
    },

    async deleteNode(id) {
      await repo.deleteNode(id);
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
      const np = { ...p, watermarkedUri };
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
        const imageBase64 = await photoStore.readBase64(photo.uri);
        const fieldDefs = NODE_SCHEMAS[node.type].filter((f) => f.aiFillable);
        const prev = get().nodes.find((n) => n.seq === node.seq - 1);
        const result = await client.analyze({
          nodeType: node.type,
          imageBase64,
          // Photos are normally re-encoded to JPEG, but an import that could not be processed keeps its PNG.
          mediaType: /\.png($|\?)/i.test(photo.uri) || photo.uri.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
          fieldDefs,
          context: { workType: project?.workType, client: project?.client, previousLabel: prev?.label },
        });
        const fresh = get().nodes.find((n) => n.id === nodeId);
        if (!fresh) return;
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
        await putNode({
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
        });
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
