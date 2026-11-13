// Tabular views of a bundle, shared by the CSV and XLSX builders.
import type { ExportBundle, QcIssue } from '@/domain/contracts';
import type { FieldValue } from '@/domain/types';
import {
  aiSummary,
  GPS_SOURCE_LABELS,
  nodeFieldColumns,
  nodeMap,
  photosByNode,
  round,
  sortedNodes,
  spanFieldColumns,
  STATUS_LABELS,
  typeLabel,
} from './common';

/** Cell kinds. Lat/lng are pre-formatted to 7 decimals as strings in CSV; XLSX keeps numbers. */
export type Cell = string | number | boolean | null;

export interface Table {
  headers: string[];
  rows: Cell[][];
  /** Indexes of columns that hold coordinates (formatted with 7 decimals in CSV). */
  coordCols: number[];
}

function fieldCell(v: FieldValue | undefined): Cell {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}

export function nodeTable(bundle: ExportBundle): Table {
  const byId = nodeMap(bundle);
  const photos = photosByNode(bundle);
  const fieldCols = nodeFieldColumns(bundle.nodes);
  const headers = [
    'Seq',
    'Label',
    'Type',
    'Latitude',
    'Longitude',
    'GPS accuracy (m)',
    'GPS source',
    'GPS samples',
    'Altitude (m)',
    'Position captured at',
    'Status',
    'Possible duplicate of',
    'Photos',
    'Notes',
    'AI-filled fields',
    'AI estimated fields',
    'AI min confidence (%)',
    ...fieldCols.map((c) => c.label),
    'Created at',
    'Updated at',
    'Node ID',
  ];
  const rows = sortedNodes(bundle).map((n) => {
    const ai = aiSummary(n);
    const dup = n.possibleDuplicateOf ? byId.get(n.possibleDuplicateOf) : undefined;
    const labelFor = (k: string) => fieldCols.find((c) => c.key === k)?.def?.label ?? k;
    return [
      n.seq,
      n.label,
      typeLabel(n.type),
      round(n.position?.lat, 7),
      round(n.position?.lng, 7),
      round(n.position?.accuracyM, 1),
      GPS_SOURCE_LABELS[n.position?.source] ?? n.position?.source ?? null,
      n.position?.samples ?? null,
      round(n.position?.altitudeM, 1),
      n.position?.capturedAt ?? null,
      STATUS_LABELS[n.status] ?? n.status,
      n.possibleDuplicateOf ? dup?.label ?? n.possibleDuplicateOf : null,
      photos.get(n.id)?.length ?? 0,
      n.notes || null,
      ai.aiKeys.map(labelFor).join('; ') || null,
      ai.estimateKeys.map(labelFor).join('; ') || null,
      ai.minConfidence === null ? null : Math.round(ai.minConfidence * 100),
      ...fieldCols.map((c) => fieldCell(n.fields?.[c.key])),
      n.createdAt,
      n.updatedAt,
      n.id,
    ] as Cell[];
  });
  return { headers, rows, coordCols: [3, 4] };
}

export function spanTable(bundle: ExportBundle): Table {
  const byId = nodeMap(bundle);
  const fieldCols = spanFieldColumns(bundle.spans);
  const headers = [
    'From',
    'To',
    'Kind',
    'Straight (ft)',
    'Sag (%)',
    'Slack (ft)',
    'Override (ft)',
    'Total (ft)',
    ...fieldCols.map((c) => c.label),
    'From latitude',
    'From longitude',
    'To latitude',
    'To longitude',
    'Created at',
    'Updated at',
    'Span ID',
  ];
  const order = new Map(sortedNodes(bundle).map((n, i) => [n.id, i]));
  const spans = [...bundle.spans].sort(
    (a, b) => (order.get(a.fromNodeId) ?? 1e9) - (order.get(b.fromNodeId) ?? 1e9) || (order.get(a.toNodeId) ?? 1e9) - (order.get(b.toNodeId) ?? 1e9),
  );
  const rows = spans.map((s) => {
    const a = byId.get(s.fromNodeId);
    const b = byId.get(s.toNodeId);
    return [
      a?.label ?? '(missing node)',
      b?.label ?? '(missing node)',
      s.kind === 'aerial' ? 'Aerial' : 'Underground',
      round(s.straightFt, 1),
      round(s.sagPct, 2),
      round(s.slackFt, 1),
      round(s.lengthOverrideFt, 1),
      round(s.totalFt, 1),
      ...fieldCols.map((c) => fieldCell(s.fields?.[c.key])),
      round(a?.position?.lat, 7),
      round(a?.position?.lng, 7),
      round(b?.position?.lat, 7),
      round(b?.position?.lng, 7),
      s.createdAt,
      s.updatedAt,
      s.id,
    ] as Cell[];
  });
  const base = 8 + fieldCols.length;
  return { headers, rows, coordCols: [base, base + 1, base + 2, base + 3] };
}

export interface QcRow {
  severity: QcIssue['severity'];
  /** Node label or "A to B" for spans; '' when unknown. */
  item: string;
  /** Message without the redundant "<item>: " prefix that runQc adds for standalone display. */
  text: string;
}

export function qcRows(bundle: ExportBundle, qc: QcIssue[]): QcRow[] {
  const nodes = nodeMap(bundle);
  const spans = new Map(bundle.spans.map((s) => [s.id, s]));
  return qc.map((q) => {
    let item = '';
    let prefix = '';
    if (q.nodeId) {
      const n = nodes.get(q.nodeId);
      item = n?.label ?? '';
      prefix = `${n?.label || `#${n?.seq ?? ''}`}: `;
    } else if (q.spanId) {
      const s = spans.get(q.spanId);
      const a = s ? nodes.get(s.fromNodeId) : undefined;
      const b = s ? nodes.get(s.toNodeId) : undefined;
      item = s ? `${a?.label ?? '?'} to ${b?.label ?? '?'}` : '';
      prefix = `Span ${a ? a.label || `#${a.seq}` : '?'} to ${b ? b.label || `#${b.seq}` : '?'}: `;
    }
    const text = prefix && q.message.startsWith(prefix) ? q.message.slice(prefix.length) : q.message;
    return { severity: q.severity, item, text: text.charAt(0).toUpperCase() + text.slice(1) };
  });
}

export function qcTable(bundle: ExportBundle, qc: QcIssue[]): Table {
  const rows = qcRows(bundle, qc).map((r) => [r.severity === 'error' ? 'Error' : 'Warning', r.item || null, r.text] as Cell[]);
  return { headers: ['Severity', 'Item', 'Issue'], rows, coordCols: [] };
}
