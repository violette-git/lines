import type { ExportBundle } from '@/domain/contracts';
import type { FieldValue } from '@/domain/types';
import {
  aiSummary,
  APP_NAME,
  computeTotals,
  hasPosition,
  nodeMap,
  photosByNode,
  round,
  sortedNodes,
  typeLabel,
} from './common';

type Props = Record<string, FieldValue | string[] | Record<string, unknown>>;

export interface LineMapFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'LineString'; coordinates: [number, number][] };
  properties: Props;
}

export interface LineMapFeatureCollection {
  type: 'FeatureCollection';
  /** Foreign member with project metadata and totals. */
  linemap: {
    app: string;
    schema_version: 1;
    generated_at: string;
    project: {
      id: string;
      name: string;
      client: string;
      job_number: string;
      work_type: string;
      status: string;
      notes: string;
      rate_per_foot: number | null;
      rate_per_node: number | null;
    };
    template: { id: string; name: string } | null;
    totals: {
      node_count: number;
      nodes_by_type: Record<string, number>;
      span_count: number;
      aerial_ft: number | null;
      underground_ft: number | null;
      total_ft: number | null;
      earnings: number | null;
    };
  };
  features: LineMapFeature[];
}

const RESERVED_NODE_KEYS = new Set([
  'id', 'seq', 'label', 'type', 'type_label', 'feature', 'status', 'notes', 'photo_count', 'accuracy_m', 'gps_source',
  'gps_samples', 'altitude_m', 'captured_at', 'possible_duplicate_of', 'possible_duplicate_of_label', 'created_at',
  'updated_at',
]);
const RESERVED_SPAN_KEYS = new Set([
  'id', 'feature', 'kind', 'from_id', 'to_id', 'from_label', 'to_label', 'straight_ft', 'total_ft', 'slack_ft',
  'sag_pct', 'override', 'override_ft', 'created_at', 'updated_at',
]);

function coord(lat: number, lng: number): [number, number] {
  return [round(lng, 7) ?? 0, round(lat, 7) ?? 0];
}

/** Flattens field values; keys colliding with built-in properties get a "field_" prefix. */
function flattenFields(fields: Record<string, FieldValue>, reserved: Set<string>, into: Props) {
  for (const [k, v] of Object.entries(fields ?? {})) {
    const key = reserved.has(k) ? `field_${k}` : k;
    into[key] = typeof v === 'number' && !Number.isFinite(v) ? null : v ?? null;
  }
}

export function buildGeoJSON(bundle: ExportBundle): LineMapFeatureCollection {
  const byId = nodeMap(bundle);
  const photos = photosByNode(bundle);
  const totals = computeTotals(bundle);
  const features: LineMapFeature[] = [];

  for (const n of sortedNodes(bundle)) {
    if (!hasPosition(n)) continue;
    const ai = aiSummary(n);
    const dup = n.possibleDuplicateOf ? byId.get(n.possibleDuplicateOf) : undefined;
    const properties: Props = {
      feature: 'node',
      id: n.id,
      seq: n.seq,
      label: n.label,
      type: n.type,
      type_label: typeLabel(n.type),
    };
    flattenFields(n.fields, RESERVED_NODE_KEYS, properties);
    Object.assign(properties, {
      ai_fields: ai.aiKeys.join(','),
      ai_estimates: ai.estimateKeys.join(','),
      ai_confidence_min: ai.minConfidence,
      ai_confidence_avg: ai.avgConfidence,
      accuracy_m: round(n.position.accuracyM, 1),
      gps_source: n.position.source ?? null,
      gps_samples: n.position.samples ?? null,
      altitude_m: round(n.position.altitudeM, 1),
      captured_at: n.position.capturedAt ?? null,
      possible_duplicate_of: n.possibleDuplicateOf ?? null,
      possible_duplicate_of_label: dup?.label ?? null,
      status: n.status,
      notes: n.notes ?? '',
      photo_count: photos.get(n.id)?.length ?? 0,
      created_at: n.createdAt,
      updated_at: n.updatedAt,
    });
    features.push({
      type: 'Feature',
      id: n.id,
      geometry: { type: 'Point', coordinates: coord(n.position.lat, n.position.lng) },
      properties,
    });
  }

  for (const s of bundle.spans) {
    const a = byId.get(s.fromNodeId);
    const b = byId.get(s.toNodeId);
    if (!hasPosition(a) || !hasPosition(b)) continue;
    const properties: Props = {
      feature: 'span',
      id: s.id,
      kind: s.kind,
      from_id: a.id,
      to_id: b.id,
      from_label: a.label,
      to_label: b.label,
      straight_ft: round(s.straightFt, 1),
      total_ft: round(s.totalFt, 1),
      slack_ft: round(s.slackFt, 1),
      sag_pct: round(s.sagPct, 2),
      override: s.lengthOverrideFt != null,
      override_ft: round(s.lengthOverrideFt, 1),
    };
    flattenFields(s.fields, RESERVED_SPAN_KEYS, properties);
    properties.created_at = s.createdAt;
    properties.updated_at = s.updatedAt;
    features.push({
      type: 'Feature',
      id: s.id,
      geometry: { type: 'LineString', coordinates: [coord(a.position.lat, a.position.lng), coord(b.position.lat, b.position.lng)] },
      properties,
    });
  }

  const p = bundle.project;
  const nodesByType: Record<string, number> = {};
  for (const [k, v] of Object.entries(totals.nodesByType)) nodesByType[k] = v ?? 0;
  return {
    type: 'FeatureCollection',
    linemap: {
      app: APP_NAME,
      schema_version: 1,
      generated_at: bundle.generatedAt,
      project: {
        id: p.id,
        name: p.name,
        client: p.client,
        job_number: p.jobNumber,
        work_type: p.workType,
        status: p.status,
        notes: p.notes,
        rate_per_foot: totals.ratePerFoot,
        rate_per_node: totals.ratePerNode,
      },
      template: bundle.template ? { id: bundle.template.id, name: bundle.template.name } : null,
      totals: {
        node_count: totals.nodeCount,
        nodes_by_type: nodesByType,
        span_count: totals.spanCount,
        aerial_ft: round(totals.aerialFt, 1),
        underground_ft: round(totals.undergroundFt, 1),
        total_ft: round(totals.totalFt, 1),
        earnings: round(totals.earnings, 2),
      },
    },
    features,
  };
}

/** Pretty-printed GeoJSON text for file output. */
export function buildGeoJSONString(bundle: ExportBundle): string {
  return JSON.stringify(buildGeoJSON(bundle), null, 2);
}
