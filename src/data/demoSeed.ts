// Demo data for the web preview: an aerial fiber route along Morris Ave in downtown Birmingham, AL,
// transitioning underground at a riser pole. Morris Ave runs ENE (about 60 degrees true) between
// 1st Ave N and the Railroad Reservation; the route starts near 20th St N.
import { makeLabel } from '@/domain/labels';
import {
  DEFAULT_SETTINGS,
  type AiFieldMeta,
  type AppSettings,
  type ClientTemplate,
  type FieldValue,
  type GeoFix,
  type LatLng,
  type MapNode,
  type NodeType,
  type PhotoRef,
  type Project,
  type Span,
} from '@/domain/types';
import { destinationPoint } from '@/geo/distance';

// Fixed, valid UUID v4 strings so the demo is stable across reloads.
export const DEMO_PROJECT_ID = 'de30a000-0000-4000-8000-000000000001';
export const DEMO_TEMPLATE_ID = 'de30a000-0000-4000-8000-0000000000f1';

export interface SeedData {
  projects: Project[];
  nodes: MapNode[];
  spans: Span[];
  photos: PhotoRef[];
  templates: ClientTemplate[];
  settings: AppSettings;
}

const nodeId = (n: number) => `de30a000-0000-4000-8000-1000000000${String(n).padStart(2, '0')}`;
const spanId = (n: number) => `de30a000-0000-4000-8000-2000000000${String(n).padStart(2, '0')}`;

/** Morris Ave at 20th St N, Birmingham AL (approximate). */
export const DEMO_ORIGIN: LatLng = { lat: 33.5136, lng: -86.8064 };
const ROUTE_BEARING = 60;

export function buildDemoSeed(baseTime = Date.parse('2026-11-10T14:05:00.000Z')): SeedData {
  const at = (minutes: number) => new Date(baseTime + minutes * 60_000).toISOString();

  const template: ClientTemplate = {
    id: DEMO_TEMPLATE_ID,
    name: 'Demo Telecom Co',
    client: 'Demo Telecom Co',
    labelPatterns: { pole: 'P-{seq3}', handhole: 'HH-{seq3}', pedestal: 'PED-{seq3}', '*': '{TYPE}-{seq3}' },
    requiredFields: {
      pole: ['pole_tag', 'owner', 'pole_height_ft', 'comm_attachment_count'],
      handhole: ['size', 'lid_label'],
      pedestal: ['pedestal_label'],
    },
    defaults: {
      handhole: { owner: 'Telco', material: 'Polymer concrete' },
      pedestal: { owner: 'Telco' },
    },
    defaultSpanKind: 'aerial',
    defaultSagPct: 2,
    defaultSlackFt: 0,
    ratePerFoot: 0.35,
    ratePerNode: 2,
    watermarkPhotos: true,
    createdAt: at(-60 * 24 * 7),
    updatedAt: at(-60 * 24 * 7),
  };

  const project: Project = {
    id: DEMO_PROJECT_ID,
    name: 'Demo: Morris Ave fiber route',
    client: 'Demo Telecom Co',
    jobNumber: 'DTC-2611-042',
    workType: 'mixed',
    notes: 'Aerial 144F along Morris Ave from 20th St N, riser at P-009, underground east toward 24th St N.',
    status: 'active',
    ratePerFoot: 0.35,
    ratePerNode: 2,
    templateId: DEMO_TEMPLATE_ID,
    walkMode: true,
    createdAt: at(-5),
    updatedAt: at(60),
  };

  const fixAt = (p: LatLng, acc: number, minute: number, samples = 5): GeoFix => ({
    lat: Math.round(p.lat * 1e7) / 1e7,
    lng: Math.round(p.lng * 1e7) / 1e7,
    accuracyM: acc,
    altitudeM: 182,
    samples,
    capturedAt: at(minute),
    source: 'gps_avg',
  });

  const along = (m: number, sideM = 0) => destinationPoint(destinationPoint(DEMO_ORIGIN, ROUTE_BEARING, m), ROUTE_BEARING + 90, sideM);

  const nodes: MapNode[] = [];
  const addNode = (
    seq: number,
    type: NodeType,
    pos: LatLng,
    fields: Record<string, FieldValue>,
    extra: Partial<MapNode> = {},
  ) => {
    const minute = seq * 3;
    nodes.push({
      id: nodeId(seq),
      projectId: project.id,
      seq,
      type,
      label: makeLabel(type, seq, { template, jobNumber: project.jobNumber }),
      position: fixAt(pos, 2.4 + (seq % 4) * 0.6, minute),
      fields,
      aiMeta: {},
      iconScale: 1,
      status: 'reviewed',
      notes: '',
      possibleDuplicateOf: null,
      createdAt: at(minute),
      updatedAt: at(minute + 1),
      ...extra,
    });
  };

  // ---- Aerial poles, about 170 ft apart on the north side of Morris Ave ----
  const poleSpecs: { d: number; side: number; f: Record<string, FieldValue> }[] = [
    { d: 0, side: 6, f: { pole_tag: 'AP 40217', owner: 'Power utility', material: 'Wood', pole_height_ft: 40, pole_class: '3', condition: 'Good', leaning: false, comm_attachment_count: 2, comm_attachment_heights: `18'2", 19'4"`, lowest_power_ft: 27.5, transformer: false, streetlight: true, guy_count: 1, location_note: 'Morris Ave at 20th St N, NE corner' } },
    { d: 52, side: 6.3, f: { pole_tag: 'AP 40218', owner: 'Power utility', material: 'Wood', pole_height_ft: 40, pole_class: '4', condition: 'Good', leaning: false, comm_attachment_count: 2, comm_attachment_heights: `18'0", 19'1"`, transformer: false, streetlight: false, guy_count: 0 } },
    { d: 104, side: 5.8, f: { pole_tag: 'AP 40219', owner: 'Joint use', material: 'Wood', pole_height_ft: 45, pole_class: '3', condition: 'Fair', leaning: false, comm_attachment_count: 3, comm_attachment_heights: `17'10", 18'9", 19'8"`, lowest_power_ft: 29, transformer: true, streetlight: false, guy_count: 0, height_stick_in_photo: false } },
    { d: 157, side: 6.1, f: { pole_tag: 'AP 40220', owner: 'Power utility', material: 'Wood', pole_height_ft: 40, pole_class: '4', condition: 'Good', comm_attachment_count: 2, streetlight: true, location_note: 'Morris Ave at 21st St N' } },
    { d: 210, side: 6, f: { pole_tag: 'AP 40221', owner: 'Power utility', material: 'Wood', pole_height_ft: 35, pole_class: '5', condition: 'Poor', leaning: true, comm_attachment_count: 2, comm_attachment_heights: `17'6", 18'7"`, guy_count: 1, make_ready: true } },
    { d: 262, side: 6.4, f: { pole_tag: 'BTI 8812', owner: 'Telco', material: 'Wood', pole_height_ft: 40, pole_class: '4', condition: 'Good', comm_attachment_count: 1, equipment: 'Aerial splice case on strand' } },
    { d: 315, side: 5.9, f: { pole_tag: 'AP 40223', owner: 'Power utility', material: 'Wood', pole_height_ft: 40, pole_class: '3', condition: 'Good', comm_attachment_count: 2, location_note: 'Morris Ave at 22nd St N' } },
    { d: 367, side: 6.2, f: { pole_tag: 'AP 40224', owner: 'Joint use', material: 'Wood', pole_height_ft: 45, pole_class: '2', condition: 'Good', comm_attachment_count: 3, transformer: true, guy_count: 2 } },
    { d: 420, side: 6, f: { pole_tag: 'AP 40225', owner: 'Power utility', material: 'Wood', pole_height_ft: 40, pole_class: '3', condition: 'Good', comm_attachment_count: 2, riser_present: true, equipment: 'Fiber riser, 2" U-guard', guy_count: 1, location_note: 'Riser pole, transition to underground' } },
  ];
  poleSpecs.forEach((p, i) => addNode(i + 1, 'pole', along(p.d, p.side), p.f));

  // AI-filled example on P-003
  const p3 = nodes[2];
  p3.status = 'ai_done';
  p3.aiMeta = {
    pole_tag: meta(0.93, false, 'Read from tag plate at about 6 ft'),
    owner: meta(0.71, false),
    material: meta(0.97, false),
    pole_height_ft: meta(0.55, true, 'Estimated from comm attachment spacing, no height stick'),
    comm_attachment_count: meta(0.88, false),
    comm_attachment_heights: meta(0.48, true),
    lowest_power_ft: meta(0.52, true),
    transformer: meta(0.95, false),
    height_stick_in_photo: meta(0.9, false),
  };
  p3.notes = 'AI: transformer on pole, check clearance to lowest comm.';

  // ---- Underground: handholes and a pedestal continuing east along Morris Ave ----
  addNode(10, 'handhole', along(423, 8), { size: '17x30', lid_label: 'FIBER', material: 'Polymer concrete', owner: 'Telco', condition: 'Good', conduit_count: 2, tracer_wire: true, location_note: 'At base of riser pole P-009' });
  addNode(11, 'handhole', along(500, 8.5), { size: '24x36', lid_label: 'COMM', material: 'Polymer concrete', owner: 'Telco', condition: 'Good', conduit_count: 3, tracer_wire: true, slack_loop_ft: 50 }, { status: 'ai_done' });
  addNode(12, 'handhole', along(576, 8.2), { size: '17x30', lid_label: 'FIBER', material: 'Polymer concrete', owner: 'Telco', condition: 'Fair', conduit_count: 2, location_note: 'Morris Ave at 23rd St N' });
  addNode(13, 'pedestal', along(611, 9.5), { model: 'PED-12 fiber pedestal', pedestal_label: 'DTC-PED-0042', owner: 'Telco', condition: 'Good', powered: false });

  const hh11 = nodes.find((n) => n.seq === 11)!;
  hh11.aiMeta = {
    size: meta(0.45, true, 'Lid proportions, no scale reference'),
    lid_label: meta(0.96, false, 'Cast text on lid'),
    material: meta(0.82, false),
    condition: meta(0.77, false),
    conduit_count: meta(0.61, false),
  };

  // ---- Possible duplicate: crew re-shot P-006 later from the other side of the street ----
  addNode(
    14,
    'pole',
    along(262.9, 7.4),
    { pole_tag: 'BTI 8812', owner: 'Telco', material: 'Wood', condition: 'Good' },
    { status: 'draft', possibleDuplicateOf: nodeId(6), notes: 'Re-shot on return trip' },
  );

  // ---- Spans ----
  const spans: Span[] = [];
  const addSpan = (
    n: number,
    from: number,
    to: number,
    kind: Span['kind'],
    extra: Partial<Span> = {},
  ) => {
    spans.push({
      id: spanId(n),
      projectId: project.id,
      fromNodeId: nodeId(from),
      toNodeId: nodeId(to),
      kind,
      slackFt: 0,
      sagPct: kind === 'aerial' ? 2 : 0,
      lengthOverrideFt: null,
      fields:
        kind === 'aerial'
          ? { cable_type: 'Fiber', fiber_count: 144, strand_size: '1/4"', overlash: false, placement: 'Aerial strand' }
          : { cable_type: 'Fiber', fiber_count: 144, placement: 'Bore', conduit_size: '2"' },
      createdAt: at(to * 3),
      updatedAt: at(to * 3),
      ...extra,
    });
  };
  for (let i = 1; i <= 8; i++) addSpan(i, i, i + 1, 'aerial', i === 4 ? { slackFt: 60 } : {});
  addSpan(9, 9, 10, 'underground', { fields: { cable_type: 'Fiber', fiber_count: 144, placement: 'Existing conduit', conduit_size: '2"' } });
  addSpan(10, 10, 11, 'underground');
  addSpan(11, 11, 12, 'underground', { lengthOverrideFt: 252, slackFt: 0 });
  addSpan(12, 12, 13, 'underground', { slackFt: 30 });

  return { projects: [project], nodes, spans, photos: [], templates: [template], settings: { ...DEFAULT_SETTINGS } };
}

function meta(confidence: number, isEstimate: boolean, note?: string): AiFieldMeta {
  return note ? { confidence, source: 'ai', isEstimate, note } : { confidence, source: 'ai', isEstimate };
}
