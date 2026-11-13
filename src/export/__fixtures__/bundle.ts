import type { ExportBundle } from '@/domain/contracts';
import type { ClientTemplate, MapNode, PhotoRef, Project, SpanWithLength } from '@/domain/types';

/** 1x1 JPEG. */
export const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const T = '2026-11-10T14:00:00.000Z';

export const project: Project = {
  id: 'proj-1',
  name: 'Main St Fiber, Phase "2"',
  client: 'Acme Telecom',
  jobNumber: 'J-1042',
  workType: 'mixed',
  notes: 'Walkout for make-ready.',
  status: 'active',
  ratePerFoot: 0.5,
  ratePerNode: 10,
  templateId: 'tpl-1',
  walkMode: true,
  createdAt: T,
  updatedAt: T,
};

export const template: ClientTemplate = {
  id: 'tpl-1',
  name: 'Acme standard',
  client: 'Acme Telecom',
  labelPatterns: { pole: 'P-{seq}' },
  requiredFields: { pole: ['pole_tag', 'owner'] },
  defaults: {},
  defaultSpanKind: 'aerial',
  defaultSagPct: 2,
  defaultSlackFt: 0,
  ratePerFoot: 0.5,
  ratePerNode: 10,
  watermarkPhotos: true,
  createdAt: T,
  updatedAt: T,
};

function node(partial: Partial<MapNode> & Pick<MapNode, 'id' | 'seq' | 'type' | 'label'>): MapNode {
  return {
    projectId: project.id,
    position: { lat: 33.5207, lng: -86.8025, accuracyM: 3, altitudeM: 180, samples: 4, capturedAt: T, source: 'gps_avg' },
    fields: {},
    aiMeta: {},
    iconScale: 1,
    status: 'draft',
    notes: '',
    possibleDuplicateOf: null,
    createdAt: T,
    updatedAt: T,
    ...partial,
  };
}

export const nodes: MapNode[] = [
  node({
    id: 'n-1',
    seq: 1,
    type: 'pole',
    label: 'P-1',
    position: { lat: 33.52071234567, lng: -86.80251234567, accuracyM: 3.2, altitudeM: 180, samples: 8, capturedAt: T, source: 'gps_avg' },
    fields: { pole_tag: 'A "12", 3', owner: 'Joint use', pole_height_ft: 40, leaning: false, transformer: true },
    aiMeta: {
      pole_tag: { confidence: 0.92, source: 'ai', isEstimate: false },
      pole_height_ft: { confidence: 0.6, source: 'ai', isEstimate: true },
      owner: { confidence: 1, source: 'manual', isEstimate: false },
    },
    status: 'ai_done',
    notes: 'Line one\nLine two, with comma & <tag>',
  }),
  node({
    id: 'n-2',
    seq: 2,
    type: 'pole',
    label: 'P-2',
    position: { lat: 33.5214, lng: -86.802, accuracyM: 14, altitudeM: null, samples: 1, capturedAt: T, source: 'gps' },
    fields: { owner: 'Telco' },
    status: 'reviewed',
  }),
  node({
    id: 'n-3',
    seq: 3,
    type: 'handhole',
    label: 'HH-3',
    position: { lat: 33.5216, lng: -86.8017, accuracyM: 2.5, altitudeM: null, samples: 4, capturedAt: T, source: 'gps_avg' },
    fields: { size: '24x36', conduit_count: 2, tracer_wire: true },
    status: 'ai_failed',
  }),
];

export const spans: SpanWithLength[] = [
  {
    id: 's-1',
    projectId: project.id,
    fromNodeId: 'n-1',
    toNodeId: 'n-2',
    kind: 'aerial',
    slackFt: 0,
    sagPct: 2,
    lengthOverrideFt: null,
    fields: { cable_type: 'Fiber', fiber_count: 144 },
    createdAt: T,
    updatedAt: T,
    straightFt: 280.4,
    totalFt: 286.008,
  },
  {
    id: 's-2',
    projectId: project.id,
    fromNodeId: 'n-2',
    toNodeId: 'n-3',
    kind: 'underground',
    slackFt: 20,
    sagPct: 0,
    lengthOverrideFt: null,
    fields: { placement: 'Bore' },
    createdAt: T,
    updatedAt: T,
    straightFt: 110,
    totalFt: 130,
  },
];

export const photos: PhotoRef[] = [
  {
    id: 'ph-1',
    nodeId: 'n-1',
    projectId: project.id,
    uri: 'file:///photos/ph-1.jpg',
    watermarkedUri: null,
    width: 1,
    height: 1,
    takenAt: T,
    fix: null,
    isPrimary: true,
  },
];

export function makeBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    project: { ...project },
    nodes: nodes.map((n) => ({ ...n, fields: { ...n.fields }, aiMeta: { ...n.aiMeta }, position: { ...n.position } })),
    spans: spans.map((s) => ({ ...s, fields: { ...s.fields } })),
    photos: photos.map((p) => ({ ...p })),
    template: { ...template },
    loadPhotoBase64: async (p) => (p.id === 'ph-1' ? TINY_JPEG_B64 : null),
    generatedAt: '2026-11-12T15:30:00.000Z',
    ...overrides,
  };
}
