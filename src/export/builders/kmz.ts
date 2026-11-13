import JSZip from 'jszip';

import type { ExportBundle } from '@/domain/contracts';
import { NODE_TYPES, type MapNode, type NodeType, type PhotoRef, type SpanWithLength } from '@/domain/types';
import {
  APP_NAME,
  computeTotals,
  displayValue,
  escapeHtml,
  escapeXml,
  fixed,
  fmtDateTime,
  fmtNumber,
  GPS_SOURCE_LABELS,
  hasPosition,
  imageTypeFromBase64,
  loadPhoto,
  midpoint,
  nodeFieldList,
  nodeMap,
  photosByNode,
  safeFileId,
  sortedNodes,
  SPAN_COLORS,
  spanFieldColumns,
  STATUS_LABELS,
  typeColor,
  typeLabel,
  WORK_TYPE_LABELS,
} from './common';

/** "#RRGGBB" -> KML "aabbggrr". */
export function kmlColor(hex: string, alpha = 'ff'): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return alpha + 'ffffff';
  return (alpha + m[3] + m[2] + m[1]).toLowerCase();
}

/** Standard Google Earth icon; tinted by IconStyle color. Cached by Google Earth, works offline once seen. */
const ICON_HREF = 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png';

function coordStr(lat: number, lng: number): string {
  return `${lng.toFixed(7)},${lat.toFixed(7)},0`;
}

function row(label: string, value: string): string {
  return `<tr><th align="left" style="padding:2px 8px 2px 0;color:#555;font-weight:normal">${escapeHtml(label)}</th><td style="padding:2px 0">${value}</td></tr>`;
}

interface EmbeddedPhoto {
  photo: PhotoRef;
  path: string;
}

function nodeDescription(node: MapNode, photos: EmbeddedPhoto[], dupLabel: string | null): string {
  const rows: string[] = [];
  rows.push(row('Type', escapeHtml(typeLabel(node.type))));
  rows.push(row('Seq', String(node.seq)));
  rows.push(row('Status', escapeHtml(STATUS_LABELS[node.status] ?? node.status)));
  const acc = fixed(node.position.accuracyM, 1);
  rows.push(
    row(
      'GPS',
      `${fixed(node.position.lat, 7)}, ${fixed(node.position.lng, 7)}` +
        (acc ? ` (&#177;${acc} m, ${escapeHtml(GPS_SOURCE_LABELS[node.position.source] ?? node.position.source)})` : ` (${escapeHtml(GPS_SOURCE_LABELS[node.position.source] ?? node.position.source)})`),
    ),
  );
  if (node.position.capturedAt) rows.push(row('Captured', escapeHtml(fmtDateTime(node.position.capturedAt))));
  for (const c of nodeFieldList(node)) {
    const v = displayValue(node.fields?.[c.key]);
    if (!v) continue;
    const meta = node.aiMeta?.[c.key];
    let badge = '';
    if (meta && meta.source === 'ai') {
      const pct = Number.isFinite(meta.confidence) ? Math.round(meta.confidence * 100) : null;
      badge = ` <span style="color:#a15c00;font-size:85%">(${meta.isEstimate ? 'AI est.' : 'AI'}${pct !== null ? ` ${pct}%` : ''})</span>`;
    }
    rows.push(row(c.label, escapeHtml(v) + badge));
  }
  if (dupLabel) rows.push(row('Possible duplicate of', `<b style="color:#b00020">${escapeHtml(dupLabel)}</b>`));
  if (node.notes) rows.push(row('Notes', escapeHtml(node.notes).replace(/\n/g, '<br/>')));
  const imgs = photos
    .map((p) => `<div style="margin-top:6px"><img src="${escapeHtml(p.path)}" width="360"/></div>`)
    .join('');
  return `<div style="font-family:Arial,sans-serif;font-size:13px"><table>${rows.join('')}</table>${imgs}</div>`;
}

function spanDescription(s: SpanWithLength, a: MapNode, b: MapNode): string {
  const rows: string[] = [
    row('From', escapeHtml(a.label)),
    row('To', escapeHtml(b.label)),
    row('Kind', s.kind === 'aerial' ? 'Aerial' : 'Underground'),
    row('Straight', `${fmtNumber(s.straightFt, 1)} ft`),
    row('Sag', `${fmtNumber(s.sagPct, 1)} %`),
    row('Slack', `${fmtNumber(s.slackFt, 1)} ft`),
  ];
  if (s.lengthOverrideFt != null) rows.push(row('Override', `${fmtNumber(s.lengthOverrideFt, 1)} ft`));
  rows.push(row('Total', `<b>${fmtNumber(s.totalFt, 1)} ft</b>`));
  for (const c of spanFieldColumns([s])) {
    const v = displayValue(s.fields?.[c.key]);
    if (v) rows.push(row(c.label, escapeHtml(v)));
  }
  return `<div style="font-family:Arial,sans-serif;font-size:13px"><table>${rows.join('')}</table></div>`;
}

function extendedData(pairs: [string, string][]): string {
  const items = pairs
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `<Data name="${escapeXml(k)}"><value>${escapeXml(v)}</value></Data>`)
    .join('');
  return items ? `<ExtendedData>${items}</ExtendedData>` : '';
}

function styles(types: NodeType[]): string {
  const out: string[] = [];
  for (const t of types) {
    out.push(
      `<Style id="node-${t}"><IconStyle><color>${kmlColor(typeColor(t))}</color><scale>1.1</scale><Icon><href>${ICON_HREF}</href></Icon></IconStyle>` +
        `<LabelStyle><scale>0.9</scale></LabelStyle></Style>`,
    );
  }
  out.push(
    `<Style id="span-aerial"><IconStyle><scale>0</scale></IconStyle><LabelStyle><color>${kmlColor(SPAN_COLORS.aerial)}</color><scale>0.75</scale></LabelStyle>` +
      `<LineStyle><color>${kmlColor(SPAN_COLORS.aerial)}</color><width>3</width></LineStyle></Style>`,
    `<Style id="span-underground"><IconStyle><scale>0</scale></IconStyle><LabelStyle><color>${kmlColor(SPAN_COLORS.underground)}</color><scale>0.75</scale></LabelStyle>` +
      `<LineStyle><color>${kmlColor(SPAN_COLORS.underground, 'e6')}</color><width>5</width></LineStyle></Style>`,
  );
  return out.join('\n');
}

export interface KmlBuildResult {
  kml: string;
  /** zip path -> base64 payload */
  files: Record<string, string>;
}

/** Builds doc.kml plus embedded photo payloads. Exposed separately for testing. */
export async function buildKml(bundle: ExportBundle): Promise<KmlBuildResult> {
  const byId = nodeMap(bundle);
  const photosFor = photosByNode(bundle);
  const nodes = sortedNodes(bundle).filter(hasPosition);
  const files: Record<string, string> = {};

  const embedded = new Map<string, EmbeddedPhoto[]>();
  for (const n of nodes) {
    const list: EmbeddedPhoto[] = [];
    for (const p of photosFor.get(n.id) ?? []) {
      const b64 = await loadPhoto(bundle, p);
      if (!b64) continue;
      const path = `files/${safeFileId(p.id)}.${imageTypeFromBase64(b64).ext}`;
      files[path] = b64;
      list.push({ photo: p, path });
    }
    embedded.set(n.id, list);
  }

  const types = NODE_TYPES.filter((t) => nodes.some((n) => n.type === t));
  const folders: string[] = [];
  for (const t of types) {
    const pms = nodes
      .filter((n) => n.type === t)
      .map((n) => {
        const dup = n.possibleDuplicateOf ? byId.get(n.possibleDuplicateOf)?.label ?? 'deleted node' : null;
        const ed: [string, string][] = [
          ['seq', String(n.seq)],
          ['type', typeLabel(n.type)],
          ['status', n.status],
          ['accuracy_m', fixed(n.position.accuracyM, 1)],
          ['gps_source', n.position.source ?? ''],
          ...nodeFieldList(n).map((c) => [c.key, displayValue(n.fields?.[c.key])] as [string, string]),
          ['notes', n.notes ?? ''],
        ];
        return (
          `<Placemark id="n-${escapeXml(safeFileId(n.id))}"><name>${escapeXml(n.label)}</name><styleUrl>#node-${t}</styleUrl>` +
          `<description>${escapeXml(nodeDescription(n, embedded.get(n.id) ?? [], dup))}</description>` +
          extendedData(ed) +
          `<Point><coordinates>${coordStr(n.position.lat, n.position.lng)}</coordinates></Point></Placemark>`
        );
      });
    folders.push(`<Folder><name>${escapeXml(`${typeLabel(t)} (${pms.length})`)}</name>\n${pms.join('\n')}\n</Folder>`);
  }

  const spanPms: string[] = [];
  for (const s of bundle.spans) {
    const a = byId.get(s.fromNodeId);
    const b = byId.get(s.toNodeId);
    if (!hasPosition(a) || !hasPosition(b)) continue;
    const mid = midpoint(a.position, b.position);
    const ed: [string, string][] = [
      ['kind', s.kind],
      ['from', a.label],
      ['to', b.label],
      ['straight_ft', fixed(s.straightFt, 1)],
      ['total_ft', fixed(s.totalFt, 1)],
      ['slack_ft', fixed(s.slackFt, 1)],
      ['sag_pct', fixed(s.sagPct, 2)],
      ['override_ft', fixed(s.lengthOverrideFt, 1)],
      ...spanFieldColumns([s]).map((c) => [c.key, displayValue(s.fields?.[c.key])] as [string, string]),
    ];
    spanPms.push(
      `<Placemark id="s-${escapeXml(safeFileId(s.id))}"><name>${escapeXml(`${fmtNumber(s.totalFt, 0)} ft`)}</name><styleUrl>#span-${s.kind}</styleUrl>` +
        `<description>${escapeXml(spanDescription(s, a, b))}</description>` +
        extendedData(ed) +
        `<MultiGeometry><Point><coordinates>${coordStr(mid.lat, mid.lng)}</coordinates></Point>` +
        `<LineString><tessellate>1</tessellate><coordinates>${coordStr(a.position.lat, a.position.lng)} ${coordStr(b.position.lat, b.position.lng)}</coordinates></LineString>` +
        `</MultiGeometry></Placemark>`,
    );
  }
  if (spanPms.length) folders.push(`<Folder><name>${escapeXml(`Spans (${spanPms.length})`)}</name>\n${spanPms.join('\n')}\n</Folder>`);

  const p = bundle.project;
  const t = computeTotals(bundle);
  const docDesc =
    `<div style="font-family:Arial,sans-serif;font-size:13px"><table>` +
    row('Client', escapeHtml(p.client)) +
    row('Job #', escapeHtml(p.jobNumber)) +
    row('Work type', escapeHtml(WORK_TYPE_LABELS[p.workType] ?? p.workType)) +
    row('Nodes', String(t.nodeCount)) +
    row('Aerial', `${fmtNumber(t.aerialFt, 0)} ft`) +
    row('Underground', `${fmtNumber(t.undergroundFt, 0)} ft`) +
    row('Total', `${fmtNumber(t.totalFt, 0)} ft`) +
    row('Generated', escapeHtml(`${fmtDateTime(bundle.generatedAt)} by ${APP_NAME}`)) +
    `</table></div>`;

  const kml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n` +
    `<name>${escapeXml(p.name)}</name>\n<open>1</open>\n` +
    `<description>${escapeXml(docDesc)}</description>\n` +
    styles(types) +
    '\n' +
    folders.join('\n') +
    `\n</Document>\n</kml>\n`;
  return { kml, files };
}

/** KMZ (zipped KML) with doc.kml first and photos under files/. */
export async function buildKmz(bundle: ExportBundle): Promise<Uint8Array> {
  const { kml, files } = await buildKml(bundle);
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  for (const [path, b64] of Object.entries(files)) zip.file(path, b64, { base64: true, compression: 'STORE' });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
