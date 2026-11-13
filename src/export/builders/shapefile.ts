// Shapefile export. Uses @mapbox/shp-write's low-level write() per layer rather than its zip():
// zip() merges every LineString into ONE multi-part record (so DBF rows and SHP records stop
// lining up) and infers DBF column types from whichever row it saw last. Here every column gets
// one consistent type and each span is its own single-part POLYLINE record.
// Imported by deep path: the package entry pulls in file-saver, which crashes outside browsers.
import shpWrite from '@mapbox/shp-write/src/write';
import JSZip from 'jszip';

import type { ExportBundle } from '@/domain/contracts';
import type { FieldValue } from '@/domain/types';
import {
  APP_NAME,
  aiSummary,
  fixed,
  hasPosition,
  nodeFieldColumns,
  nodeMap,
  photosByNode,
  round,
  sortedNodes,
  spanFieldColumns,
  typeLabel,
} from './common';

/** ESRI WKT for WGS 84 geographic coordinates. */
export const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

/** Max characters in a DBF character field (dBase III). */
const DBF_TEXT_MAX = 254;

type Raw = string | number | boolean | null | undefined;

interface LayerColumn {
  full: string;
  short: string;
  kind: 'number' | 'text';
}

/**
 * Builds DBF-safe unique field names (max 10 chars, [A-Za-z0-9_], not starting with a digit).
 * Collisions get a numeric suffix: comm_attac, comm_atta1, ...
 */
export function shortFieldNames(full: string[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const name of full) {
    let base = name.replace(/[^A-Za-z0-9_]/g, '_');
    if (!base || /^[0-9]/.test(base)) base = 'f_' + base;
    let candidate = base.slice(0, 10);
    let i = 1;
    while (used.has(candidate.toLowerCase())) {
      const suffix = String(i++);
      candidate = base.slice(0, 10 - suffix.length) + suffix;
    }
    used.add(candidate.toLowerCase());
    out.set(name, candidate);
  }
  return out;
}

/** dbf writes one byte per UTF-16 code unit, so keep text in Latin-1 and declare it in the .cpg. */
function latin1(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function buildLayer(
  records: Record<string, Raw>[],
  fullNames: string[],
): { columns: LayerColumn[]; rows: Record<string, string | number | null>[]; truncated: Set<string> } {
  const shortMap = shortFieldNames(fullNames);
  const truncated = new Set<string>();
  const columns: LayerColumn[] = fullNames.map((full) => {
    const vals = records.map((r) => r[full]).filter((v) => v !== null && v !== undefined && v !== '');
    const allNum = vals.length > 0 && vals.every((v) => typeof v === 'number' && Number.isFinite(v));
    return { full, short: shortMap.get(full)!, kind: allNum ? 'number' : 'text' };
  });
  const rows = records.map((r) => {
    const out: Record<string, string | number | null> = {};
    for (const c of columns) {
      const v = r[c.full];
      if (c.kind === 'number') {
        // dbf declares numeric fields as N(18,3).
        out[c.short] = typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
      } else {
        let s = v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
        s = latin1(s);
        if (s.length > DBF_TEXT_MAX) {
          s = s.slice(0, DBF_TEXT_MAX);
          truncated.add(c.full);
        }
        out[c.short] = s;
      }
    }
    return out;
  });
  return { columns, rows, truncated };
}

function writeLayer(
  rows: Record<string, string | number | null>[],
  type: 'POINT' | 'POLYLINE',
  geometries: unknown[],
): Promise<{ shp: ArrayBuffer; shx: ArrayBuffer; dbf: ArrayBuffer }> {
  return new Promise((resolve, reject) => {
    try {
      shpWrite(rows, type, geometries as object[], (err, files) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve({ shp: files.shp.buffer as ArrayBuffer, shx: files.shx.buffer as ArrayBuffer, dbf: files.dbf.buffer as ArrayBuffer });
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function fieldRaw(v: FieldValue | undefined): Raw {
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}

export async function buildShapefileZip(bundle: ExportBundle): Promise<Uint8Array> {
  const byId = nodeMap(bundle);
  const photos = photosByNode(bundle);
  const zip = new JSZip();
  const readme: string[] = [
    `${APP_NAME} shapefile export`,
    `Project: ${bundle.project.name}`,
    `Generated: ${bundle.generatedAt}`,
    'Coordinate system: WGS 84 geographic (EPSG:4326), longitude/latitude in decimal degrees.',
    'Text encoding: ISO-8859-1 (see .cpg). Characters outside Latin-1 are replaced with "?".',
    `Text fields are limited to ${DBF_TEXT_MAX} characters by the DBF format.`,
    'DBF field names are limited to 10 characters. Full names are listed below.',
    '',
  ];

  // ----- Nodes (POINT) -----
  const nodes = sortedNodes(bundle).filter(hasPosition);
  const nodeFieldCols = nodeFieldColumns(bundle.nodes);
  const nodeBase = ['seq', 'label', 'type', 'type_label', 'lat', 'lng', 'accuracy_m', 'gps_source', 'status', 'possible_duplicate_of', 'photo_count', 'ai_estimates', 'ai_confidence_min', 'notes'];
  const reservedNode = new Set([...nodeBase, 'node_id']);
  const nodeFull = [...nodeBase, ...nodeFieldCols.map((c) => (reservedNode.has(c.key) ? `field_${c.key}` : c.key)), 'node_id'];
  const nodeLabels = new Map<string, string>(nodeFieldCols.map((c) => [reservedNode.has(c.key) ? `field_${c.key}` : c.key, c.label]));
  const nodeRecords = nodes.map((n) => {
    const ai = aiSummary(n);
    const rec: Record<string, Raw> = {
      seq: n.seq,
      label: n.label,
      type: n.type,
      type_label: typeLabel(n.type),
      // Text keeps all 7 decimals (numeric DBF columns here are N(18,3)).
      lat: fixed(n.position.lat, 7),
      lng: fixed(n.position.lng, 7),
      accuracy_m: round(n.position.accuracyM, 1),
      gps_source: n.position.source,
      status: n.status,
      possible_duplicate_of: n.possibleDuplicateOf ? byId.get(n.possibleDuplicateOf)?.label ?? n.possibleDuplicateOf : '',
      photo_count: photos.get(n.id)?.length ?? 0,
      ai_estimates: ai.estimateKeys.join(','),
      ai_confidence_min: ai.minConfidence,
      notes: n.notes,
      node_id: n.id,
    };
    for (const c of nodeFieldCols) rec[reservedNode.has(c.key) ? `field_${c.key}` : c.key] = fieldRaw(n.fields?.[c.key]);
    return rec;
  });

  // ----- Spans (POLYLINE) -----
  const spanFieldCols = spanFieldColumns(bundle.spans);
  const spanBase = ['from_label', 'to_label', 'kind', 'straight_ft', 'sag_pct', 'slack_ft', 'override_ft', 'total_ft'];
  const reservedSpan = new Set([...spanBase, 'span_id', 'from_id', 'to_id']);
  const spanFull = [...spanBase, ...spanFieldCols.map((c) => (reservedSpan.has(c.key) ? `field_${c.key}` : c.key)), 'from_id', 'to_id', 'span_id'];
  const spanLabels = new Map<string, string>(spanFieldCols.map((c) => [reservedSpan.has(c.key) ? `field_${c.key}` : c.key, c.label]));
  const spanGeoms: number[][][][] = [];
  const spanRecords: Record<string, Raw>[] = [];
  for (const s of bundle.spans) {
    const a = byId.get(s.fromNodeId);
    const b = byId.get(s.toNodeId);
    if (!hasPosition(a) || !hasPosition(b)) continue;
    // One record = one part = two vertices.
    spanGeoms.push([[[a.position.lng, a.position.lat], [b.position.lng, b.position.lat]]]);
    const rec: Record<string, Raw> = {
      from_label: a.label,
      to_label: b.label,
      kind: s.kind,
      straight_ft: round(s.straightFt, 1),
      sag_pct: round(s.sagPct, 2),
      slack_ft: round(s.slackFt, 1),
      override_ft: round(s.lengthOverrideFt, 1),
      total_ft: round(s.totalFt, 1),
      from_id: a.id,
      to_id: b.id,
      span_id: s.id,
    };
    for (const c of spanFieldCols) rec[reservedSpan.has(c.key) ? `field_${c.key}` : c.key] = fieldRaw(s.fields?.[c.key]);
    spanRecords.push(rec);
  }

  const addLayer = async (
    name: string,
    type: 'POINT' | 'POLYLINE',
    records: Record<string, Raw>[],
    full: string[],
    labels: Map<string, string>,
    geoms: unknown[],
  ) => {
    readme.push(`Layer "${name}" (${type}, ${records.length} feature${records.length === 1 ? '' : 's'})`);
    if (!records.length) {
      readme.push('  Not written: no features.', '');
      return;
    }
    const layer = buildLayer(records, full);
    const files = await writeLayer(layer.rows, type, geoms);
    zip.file(`${name}.shp`, files.shp, { binary: true });
    zip.file(`${name}.shx`, files.shx, { binary: true });
    zip.file(`${name}.dbf`, files.dbf, { binary: true });
    zip.file(`${name}.prj`, WGS84_PRJ);
    zip.file(`${name}.cpg`, 'ISO-8859-1');
    const w = Math.max(...layer.columns.map((c) => c.short.length));
    readme.push('  DBF name    Full name (description)');
    for (const c of layer.columns) {
      const desc = labels.get(c.full);
      readme.push(`  ${c.short.padEnd(w + 2)}${c.full}${desc ? ` (${desc})` : ''}${layer.truncated.has(c.full) ? ' [some values truncated]' : ''}`);
    }
    readme.push('');
  };

  await addLayer('nodes', 'POINT', nodeRecords, nodeFull, nodeLabels, nodes.map((n) => [n.position.lng, n.position.lat]));
  await addLayer('spans', 'POLYLINE', spanRecords, spanFull, spanLabels, spanGeoms);

  zip.file('README.txt', readme.join('\r\n'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
