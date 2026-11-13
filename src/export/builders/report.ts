// Printable HTML report (fed to expo-print on native, opened + printed in a window on web).
// Self-contained: inline CSS and SVG, system fonts, images only as data:/blob: URLs.
import type { ExportBundle, QcIssue } from '@/domain/contracts';
import { NODE_TYPES, type MapNode, type SpanWithLength } from '@/domain/types';
import {
  APP_NAME,
  computeTotals,
  displayValue,
  escapeHtml,
  fixed,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  GPS_SOURCE_LABELS,
  hasPosition,
  imageTypeFromBase64,
  isBlank,
  loadPhoto,
  nodeFieldList,
  nodeMap,
  photosByNode,
  sortedNodes,
  SPAN_COLORS,
  spanFieldColumns,
  STATUS_LABELS,
  typeColor,
  typeLabel,
  WORK_TYPE_LABELS,
} from './common';
import { qcRows } from './tables';

export interface ReportOptions {
  /** photoId -> data URL. Only data:image/ and blob: URLs are used (no network). */
  photoDataUrls?: Record<string, string>;
  /** Rendered map snapshot. When absent the schematic SVG route diagram is drawn instead. */
  mapImageDataUrl?: string | null;
  qc: QcIssue[];
}

/** Above these counts the diagram drops text labels to stay legible. */
const MAX_NODE_LABELS = 60;
const MAX_SPAN_LABELS = 60;

function safeImageUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  return /^(data:image\/[a-z0-9.+-]+;base64,|blob:)/i.test(u) ? u : null;
}

/** Loads the primary photo of every node as a data URL, for buildReportHtml. */
export async function loadReportPhotos(bundle: ExportBundle, opts: { primaryOnly?: boolean } = {}): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const byNode = photosByNode(bundle);
  for (const list of byNode.values()) {
    const targets = opts.primaryOnly === false ? list : list.slice(0, 1);
    for (const p of targets) {
      const b64 = await loadPhoto(bundle, p);
      if (b64) out[p.id] = `data:${imageTypeFromBase64(b64).mime};base64,${b64}`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Route diagram
// ---------------------------------------------------------------------------------------------

export function buildRouteSvg(bundle: ExportBundle, width = 720, height = 340): string {
  const nodes = sortedNodes(bundle).filter(hasPosition);
  if (!nodes.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 80" width="100%" role="img" aria-label="No positions"><text x="${width / 2}" y="44" text-anchor="middle" font-size="13" fill="#6b7280">No located nodes to draw.</text></svg>`;
  }
  const byId = nodeMap(bundle);
  const pad = 36;
  const meanLat = nodes.reduce((a, n) => a + n.position.lat, 0) / nodes.length;
  const k = Math.cos((meanLat * Math.PI) / 180) || 1;
  const xs = nodes.map((n) => n.position.lng * k);
  const ys = nodes.map((n) => n.position.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const dx = maxX - minX;
  const dy = maxY - minY;
  const sx = dx > 0 ? (width - 2 * pad) / dx : Infinity;
  const sy = dy > 0 ? (height - 2 * pad) / dy : Infinity;
  let scale = Math.min(sx, sy);
  if (!Number.isFinite(scale)) scale = 1;
  const offX = (width - dx * scale) / 2;
  const offY = (height - dy * scale) / 2;
  const project = (lat: number, lng: number) => ({
    x: offX + (lng * k - minX) * scale,
    y: height - (offY + (lat - minY) * scale),
  });
  const f = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  const halo = 'paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"';

  const lines: string[] = [];
  const spanLabels: string[] = [];
  const showSpanLabels = bundle.spans.length <= MAX_SPAN_LABELS;
  for (const s of bundle.spans) {
    const a = byId.get(s.fromNodeId);
    const b = byId.get(s.toNodeId);
    if (!hasPosition(a) || !hasPosition(b)) continue;
    const p1 = project(a.position.lat, a.position.lng);
    const p2 = project(b.position.lat, b.position.lng);
    const dash = s.kind === 'underground' ? ' stroke-dasharray="8 5"' : '';
    lines.push(
      `<line x1="${f(p1.x)}" y1="${f(p1.y)}" x2="${f(p2.x)}" y2="${f(p2.y)}" stroke="${SPAN_COLORS[s.kind]}" stroke-width="3.2" stroke-linecap="round"${dash}/>`,
    );
    if (showSpanLabels) {
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      spanLabels.push(
        `<text x="${f(mid.x)}" y="${f(mid.y - 5)}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#374151" ${halo}>${escapeHtml(fmtNumber(s.totalFt, 0))} ft</text>`,
      );
    }
  }

  const dots: string[] = [];
  const labels: string[] = [];
  const showNodeLabels = nodes.length <= MAX_NODE_LABELS;
  for (const n of nodes) {
    const p = project(n.position.lat, n.position.lng);
    dots.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="5.5" fill="${typeColor(n.type)}" stroke="#1f2937" stroke-width="1.3"/>`);
    if (showNodeLabels) {
      labels.push(`<text x="${f(p.x + 8)}" y="${f(p.y + 4)}" font-size="10.5" font-weight="700" fill="#111827" ${halo}>${escapeHtml(n.label)}</text>`);
    }
  }

  const north =
    `<g transform="translate(${width - 22},22)"><path d="M0,-12 L6,6 L0,2 L-6,6 Z" fill="#1f2937"/>` +
    `<text x="0" y="18" text-anchor="middle" font-size="9" font-weight="700" fill="#1f2937">N</text></g>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Route diagram" font-family="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc" stroke="#e5e7eb"/>` +
    lines.join('') +
    spanLabels.join('') +
    dots.join('') +
    labels.join('') +
    north +
    `</svg>`
  );
}

function legendHtml(bundle: ExportBundle): string {
  const items: string[] = [];
  for (const t of NODE_TYPES) {
    if (!bundle.nodes.some((n) => n.type === t)) continue;
    items.push(`<span class="lg"><i class="dot" style="background:${typeColor(t)}"></i>${escapeHtml(typeLabel(t))}</span>`);
  }
  const kinds = new Set(bundle.spans.map((s) => s.kind));
  if (kinds.has('aerial')) items.push(`<span class="lg"><i class="ln" style="border-top:3px solid ${SPAN_COLORS.aerial}"></i>Aerial span</span>`);
  if (kinds.has('underground')) items.push(`<span class="lg"><i class="ln" style="border-top:3px dashed ${SPAN_COLORS.underground}"></i>Underground span</span>`);
  return `<div class="legend">${items.join('')}</div>`;
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

const CSS = `
@page { size: Letter; margin: 0.55in 0.5in; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #111827; font-size: 10pt; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 22pt; margin: 0 0 2px; letter-spacing: -0.01em; }
h2 { font-size: 13pt; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #111827; }
h3 { font-size: 12pt; margin: 0; }
.muted { color: #6b7280; }
.small { font-size: 8.5pt; }
.band { background: #111827; color: #fff; padding: 14px 18px; border-radius: 6px; margin-bottom: 14px; }
.band .kicker { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.12em; color: #fbbf24; font-weight: 700; }
.band h1 { color: #fff; }
.band .sub { color: #d1d5db; font-size: 10pt; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 0 0 12px; }
.meta div b { display: block; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; font-weight: 600; }
.tiles { display: flex; gap: 8px; margin: 8px 0 12px; }
.tile { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; }
.tile .v { font-size: 15pt; font-weight: 700; }
.tile .k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
th { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.nw { white-space: nowrap; }
tr.total td { font-weight: 700; border-top: 2px solid #111827; border-bottom: none; }
.cols { display: flex; gap: 16px; }
.cols > div { flex: 1; }
.route { page-break-inside: avoid; break-inside: avoid; }
.diagram { margin-top: 6px; border-radius: 6px; overflow: hidden; }
.diagram img { max-height: 4.6in; object-fit: contain; }
.diagram img { width: 100%; display: block; }
.legend { margin-top: 6px; font-size: 8.5pt; color: #374151; }
.lg { display: inline-block; margin-right: 14px; white-space: nowrap; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 1px solid #1f2937; vertical-align: -1px; margin-right: 4px; }
.ln { display: inline-block; width: 22px; height: 0; vertical-align: 3px; margin-right: 4px; }
.pill { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.pill.error { background: #fee2e2; color: #991b1b; }
.pill.warning { background: #fef3c7; color: #92400e; }
.pill.ok { background: #d1fae5; color: #065f46; }
.badge { display: inline-block; padding: 0 5px; border-radius: 4px; font-size: 7pt; font-weight: 700; margin-left: 4px; vertical-align: 1px; }
.badge.est { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.badge.ai { background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe; }
.conf { font-size: 7.5pt; color: #6b7280; margin-left: 3px; }
.missing { color: #b91c1c; font-weight: 600; }
.node { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; margin: 0 0 10px; page-break-inside: avoid; break-inside: avoid; }
.node .hd { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.node .sw { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid #1f2937; flex: none; }
.node .hd .right { margin-left: auto; text-align: right; }
.node .body { display: flex; gap: 12px; }
.node .photo { flex: 0 0 42%; }
.node .photo img { width: 100%; max-height: 3.4in; object-fit: contain; border-radius: 6px; background: #f3f4f6; display: block; }
.node .nophoto { height: 1.4in; border: 1px dashed #d1d5db; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 9pt; }
.node .info { flex: 1; min-width: 0; }
.node .info td { padding: 2px 6px; font-size: 9pt; }
.node .info td.k { color: #6b7280; width: 42%; }
.node .gps { font-size: 9pt; margin-bottom: 6px; }
.notes { margin-top: 6px; padding: 6px 8px; background: #f9fafb; border-left: 3px solid #9ca3af; font-size: 9pt; white-space: pre-wrap; }
.flag { margin-top: 6px; font-size: 9pt; color: #92400e; }
.pb { page-break-before: always; break-before: page; }
.foot { margin-top: 18px; font-size: 8pt; color: #9ca3af; text-align: center; }
`;

function coverHtml(bundle: ExportBundle, opts: ReportOptions): string {
  const p = bundle.project;
  const t = computeTotals(bundle);
  const errors = opts.qc.filter((q) => q.severity === 'error').length;
  const warnings = opts.qc.length - errors;
  const meta: [string, string][] = [
    ['Client', p.client],
    ['Job #', p.jobNumber],
    ['Work type', WORK_TYPE_LABELS[p.workType] ?? p.workType],
    ['Template', bundle.template?.name ?? ''],
    ['Generated', fmtDateTime(bundle.generatedAt)],
  ];
  const metaHtml = meta
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><b>${escapeHtml(k)}</b>${escapeHtml(v)}</div>`)
    .join('');

  const tiles: [string, string][] = [
    ['Nodes', fmtNumber(t.nodeCount)],
    ['Total footage', `${fmtNumber(t.totalFt)} ft`],
    ['Photos', fmtNumber(t.photoCount)],
  ];
  if (t.earnings !== null) tiles.push(['Earnings', fmtMoney(t.earnings)]);

  const typeRows = NODE_TYPES.filter((ty) => t.nodesByType[ty])
    .map(
      (ty) =>
        `<tr><td><i class="dot" style="background:${typeColor(ty)}"></i>${escapeHtml(typeLabel(ty))}</td><td class="num">${fmtNumber(t.nodesByType[ty])}</td></tr>`,
    )
    .join('');
  const footRows: string[] = [
    `<tr><td>Aerial</td><td class="num">${fmtNumber(t.aerialFt)} ft</td></tr>`,
    `<tr><td>Underground</td><td class="num">${fmtNumber(t.undergroundFt)} ft</td></tr>`,
    `<tr><td>Spans</td><td class="num">${fmtNumber(t.spanCount)}</td></tr>`,
  ];
  if (t.ratePerFoot !== null) footRows.push(`<tr><td>Rate per foot</td><td class="num">${fmtMoney(t.ratePerFoot)}</td></tr>`);
  if (t.ratePerNode !== null) footRows.push(`<tr><td>Rate per node</td><td class="num">${fmtMoney(t.ratePerNode)}</td></tr>`);

  const img = safeImageUrl(opts.mapImageDataUrl);
  const diagram = img
    ? `<div class="diagram"><img src="${escapeHtml(img)}" alt="Map"/></div>`
    : `<div class="diagram">${buildRouteSvg(bundle)}</div>${legendHtml(bundle)}<div class="small muted">Schematic drawn from GPS positions, north up. Footage labels show billable cable length per span.</div>`;

  return (
    `<section class="cover">` +
    `<div class="band"><div class="kicker">${escapeHtml(APP_NAME)} field report</div><h1>${escapeHtml(p.name)}</h1>` +
    `<div class="sub">${escapeHtml([p.client, p.jobNumber ? `Job ${p.jobNumber}` : ''].filter(Boolean).join(' | '))}</div></div>` +
    `<div class="meta">${metaHtml}<div><b>QC</b>${errors || warnings ? `${errors ? `<span class="pill error">${errors} error${errors > 1 ? 's' : ''}</span> ` : ''}${warnings ? `<span class="pill warning">${warnings} warning${warnings > 1 ? 's' : ''}</span>` : ''}` : '<span class="pill ok">Passed</span>'}</div></div>` +
    `<div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><div class="v">${escapeHtml(v)}</div><div class="k">${escapeHtml(k)}</div></div>`).join('')}</div>` +
    `<div class="cols"><div><table><tr><th>Node type</th><th class="num">Count</th></tr>${typeRows}` +
    `<tr class="total"><td>Total nodes</td><td class="num">${fmtNumber(t.nodeCount)}</td></tr></table></div>` +
    `<div><table><tr><th>Footage</th><th class="num">Value</th></tr>${footRows.join('')}` +
    `<tr class="total"><td>Total</td><td class="num">${fmtNumber(t.totalFt)} ft</td></tr>` +
    (t.earnings !== null ? `<tr class="total"><td>Earnings</td><td class="num">${fmtMoney(t.earnings)}</td></tr>` : '') +
    `</table></div></div>` +
    (p.notes ? `<div class="notes">${escapeHtml(p.notes)}</div>` : '') +
    `<div class="route"><h2>Route</h2>${diagram}</div>` +
    `</section>`
  );
}

function qcHtml(bundle: ExportBundle, qc: QcIssue[]): string {
  if (!qc.length) return `<section><h2>Quality check</h2><p><span class="pill ok">Passed</span> No issues found.</p></section>`;
  const rows = qcRows(bundle, qc)
    .map(
      (r) =>
        `<tr><td><span class="pill ${r.severity}">${r.severity}</span></td><td class="nw">${escapeHtml(r.item)}</td><td>${escapeHtml(r.text)}</td></tr>`,
    )
    .join('');
  return `<section><h2>Quality check</h2><table><tr><th style="width:14%">Severity</th><th style="width:20%">Item</th><th>Issue</th></tr>${rows}</table></section>`;
}

function nodeBlock(bundle: ExportBundle, n: MapNode, opts: ReportOptions, photoIds: string[], byId: Map<string, MapNode>): string {
  const required = new Set(bundle.template?.requiredFields?.[n.type] ?? []);
  // Filled fields plus required-but-missing ones; other blanks are summarised in one line.
  const allFields = nodeFieldList(n);
  const shown = allFields.filter((c) => !isBlank(n.fields?.[c.key]) || required.has(c.key));
  const notRecorded = allFields.length - shown.length;
  const rows = shown
    .map((c) => {
      const v = n.fields?.[c.key];
      const meta = n.aiMeta?.[c.key];
      let valueHtml: string;
      if (isBlank(v)) {
        valueHtml = '<span class="missing">Missing (required)</span>';
      } else {
        valueHtml = escapeHtml(displayValue(v));
        if (meta && meta.source === 'ai') {
          const pct = Number.isFinite(meta.confidence) ? `${Math.round(meta.confidence * 100)}%` : '';
          valueHtml += meta.isEstimate ? `<span class="badge est">est.</span>` : `<span class="badge ai">AI</span>`;
          if (pct) valueHtml += `<span class="conf">${pct}</span>`;
        }
      }
      return `<tr><td class="k">${escapeHtml(c.label)}${required.has(c.key) ? ' *' : ''}</td><td>${valueHtml}</td></tr>`;
    })
    .join('');

  const firstUrl = photoIds.map((id) => safeImageUrl(opts.photoDataUrls?.[id])).find((u) => !!u) ?? null;
  const more = photoIds.length > 1 ? `<div class="small muted">+${photoIds.length - 1} more photo${photoIds.length > 2 ? 's' : ''}</div>` : '';
  const photoHtml = firstUrl
    ? `<img src="${escapeHtml(firstUrl)}" alt="${escapeHtml(n.label)}"/>${more}`
    : `<div class="nophoto">${photoIds.length ? 'Photo not available' : 'No photo'}</div>`;

  const pos = n.position;
  const acc = fixed(pos?.accuracyM, 1);
  const src = GPS_SOURCE_LABELS[pos?.source] ?? pos?.source ?? '';
  const gps = hasPosition(n)
    ? `<b>${fixed(pos.lat, 7)}, ${fixed(pos.lng, 7)}</b>` +
      (acc ? ` <span class="muted">&#177;${acc} m</span>` : '') +
      ` <span class="muted">${escapeHtml(src)}${pos.samples > 1 ? `, ${pos.samples} samples` : ''}${pos.capturedAt ? `, ${escapeHtml(fmtDateTime(pos.capturedAt))}` : ''}</span>`
    : '<span class="missing">No position</span>';

  const dup = n.possibleDuplicateOf ? byId.get(n.possibleDuplicateOf)?.label ?? 'a deleted node' : null;
  const statusPill =
    n.status === 'reviewed'
      ? 'ok'
      : n.status === 'ai_failed'
        ? 'error'
        : n.status === 'ai_done' || n.status === 'ai_pending'
          ? 'warning'
          : '';

  return (
    `<div class="node">` +
    `<div class="hd"><span class="sw" style="background:${typeColor(n.type)}"></span><h3>${escapeHtml(n.label)}</h3>` +
    `<span class="muted">${escapeHtml(typeLabel(n.type))}</span>` +
    `<div class="right small"><span class="muted">#${n.seq}</span> ${statusPill ? `<span class="pill ${statusPill}">${escapeHtml(STATUS_LABELS[n.status] ?? n.status)}</span>` : `<span class="muted">${escapeHtml(STATUS_LABELS[n.status] ?? n.status)}</span>`}</div></div>` +
    `<div class="body"><div class="photo">${photoHtml}</div><div class="info">` +
    `<div class="gps">${gps}</div>` +
    (rows ? `<table>${rows}</table>` : '') +
    (notRecorded ? `<div class="small muted" style="margin-top:3px">${notRecorded} other field${notRecorded > 1 ? 's' : ''} not recorded</div>` : '') +
    (dup ? `<div class="flag">Possible duplicate of ${escapeHtml(dup)}</div>` : '') +
    (n.notes ? `<div class="notes">${escapeHtml(n.notes)}</div>` : '') +
    `</div></div></div>`
  );
}

function spansHtml(bundle: ExportBundle): string {
  if (!bundle.spans.length) return '';
  const byId = nodeMap(bundle);
  const order = new Map(sortedNodes(bundle).map((n, i) => [n.id, i]));
  const spans = [...bundle.spans].sort(
    (a, b) => (order.get(a.fromNodeId) ?? 1e9) - (order.get(b.fromNodeId) ?? 1e9) || (order.get(a.toNodeId) ?? 1e9) - (order.get(b.toNodeId) ?? 1e9),
  );
  const extraCols = spanFieldColumns(bundle.spans).filter((c) => bundle.spans.some((s) => !isBlank(s.fields?.[c.key])));
  let aerial = 0;
  let ug = 0;
  const rows = spans
    .map((s: SpanWithLength, i) => {
      const total = Number.isFinite(s.totalFt) ? s.totalFt : 0;
      if (s.kind === 'aerial') aerial += total;
      else ug += total;
      return (
        `<tr><td class="num">${i + 1}</td><td class="nw">${escapeHtml(byId.get(s.fromNodeId)?.label ?? '?')}</td><td class="nw">${escapeHtml(byId.get(s.toNodeId)?.label ?? '?')}</td>` +
        `<td class="nw"><i class="ln" style="border-top:3px ${s.kind === 'underground' ? 'dashed' : 'solid'} ${SPAN_COLORS[s.kind]}"></i>${s.kind === 'aerial' ? 'Aerial' : 'UG'}</td>` +
        `<td class="num">${fmtNumber(s.straightFt, 1)}</td><td class="num">${fmtNumber(s.sagPct, 1)}</td><td class="num">${fmtNumber(s.slackFt, 0)}</td>` +
        `<td class="num">${s.lengthOverrideFt != null ? fmtNumber(s.lengthOverrideFt, 1) : ''}</td><td class="num"><b>${fmtNumber(s.totalFt, 1)}</b></td>` +
        extraCols.map((c) => `<td>${escapeHtml(displayValue(s.fields?.[c.key]))}</td>`).join('') +
        `</tr>`
      );
    })
    .join('');
  const pad = extraCols.map(() => '<td></td>').join('');
  return (
    `<section class="pb"><h2>Spans</h2><table>` +
    `<tr><th class="num">#</th><th>From</th><th>To</th><th>Kind</th><th class="num">Straight ft</th><th class="num">Sag %</th><th class="num">Slack ft</th><th class="num">Override ft</th><th class="num">Total ft</th>` +
    extraCols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('') +
    `</tr>${rows}` +
    `<tr class="total"><td></td><td colspan="7">Aerial ${fmtNumber(aerial, 1)} ft, underground ${fmtNumber(ug, 1)} ft</td><td class="num">${fmtNumber(aerial + ug, 1)}</td>${pad}</tr>` +
    `</table></section>`
  );
}

export function buildReportHtml(bundle: ExportBundle, opts: ReportOptions): string {
  const byId = nodeMap(bundle);
  const photos = photosByNode(bundle);
  const nodes = sortedNodes(bundle);
  const nodeBlocks = nodes.map((n) => nodeBlock(bundle, n, opts, (photos.get(n.id) ?? []).map((p) => p.id), byId)).join('');
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${escapeHtml(bundle.project.name)} | ${escapeHtml(APP_NAME)} report</title>` +
    `<style>${CSS}</style></head><body>` +
    coverHtml(bundle, opts) +
    `<div class="pb"></div>` +
    qcHtml(bundle, opts.qc) +
    (nodes.length ? `<section><h2>Nodes (${nodes.length})</h2>${nodeBlocks}</section>` : '') +
    spansHtml(bundle) +
    `<div class="foot">Generated ${escapeHtml(fmtDateTime(bundle.generatedAt))} by ${escapeHtml(APP_NAME)}. Values marked est. are AI visual estimates; percentages are AI confidence.</div>` +
    `</body></html>`
  );
}
