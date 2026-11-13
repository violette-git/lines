import * as XLSX from 'xlsx';

import type { ExportBundle, QcIssue } from '@/domain/contracts';
import { runQc } from '@/domain/qc';
import { NODE_TYPES } from '@/domain/types';
import { APP_NAME, computeTotals, fmtDateTime, round, typeLabel, WORK_TYPE_LABELS } from './common';
import { nodeTable, qcTable, spanTable, type Cell, type Table } from './tables';

type XCell = string | number | null;

function xcell(v: Cell): XCell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return v;
}

function colWidths(rows: XCell[][]): XLSX.ColInfo[] {
  const widths: number[] = [];
  for (const r of rows) {
    r.forEach((c, i) => {
      const len = c === null ? 0 : String(c).length;
      widths[i] = Math.max(widths[i] ?? 6, Math.min(len + 2, 60));
    });
  }
  return widths.map((wch) => ({ wch }));
}

function tableSheet(t: Table): XLSX.WorkSheet {
  const aoa: XCell[][] = [t.headers, ...t.rows.map((r) => r.map(xcell))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = colWidths(aoa);
  // 7 decimal display for coordinates.
  for (const c of t.coordCols) {
    for (let r = 1; r < aoa.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell && cell.t === 'n') cell.z = '0.0000000';
    }
  }
  if (t.rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: t.rows.length, c: t.headers.length - 1 } }) };
  return ws;
}

function summarySheet(bundle: ExportBundle, qc: QcIssue[]): XLSX.WorkSheet {
  const p = bundle.project;
  const t = computeTotals(bundle);
  const aoa: XCell[][] = [
    [`${APP_NAME} project export`, null],
    [null, null],
    ['Project', p.name],
    ['Client', p.client || null],
    ['Job #', p.jobNumber || null],
    ['Work type', WORK_TYPE_LABELS[p.workType] ?? p.workType],
    ['Status', p.status],
    ['Template', bundle.template?.name ?? null],
    ['Generated', fmtDateTime(bundle.generatedAt)],
    ['Notes', p.notes || null],
    [null, null],
    ['Totals', null],
    ['Nodes', t.nodeCount],
  ];
  for (const type of NODE_TYPES) {
    const c = t.nodesByType[type];
    if (c) aoa.push([`  ${typeLabel(type)}`, c]);
  }
  aoa.push(
    ['Spans', t.spanCount],
    ['Aerial (ft)', round(t.aerialFt, 1)],
    ['Underground (ft)', round(t.undergroundFt, 1)],
    ['Total (ft)', round(t.totalFt, 1)],
    ['Photos', t.photoCount],
  );
  if (t.earnings !== null) {
    aoa.push(['Rate per foot', t.ratePerFoot], ['Rate per node', t.ratePerNode], ['Earnings', round(t.earnings, 2)]);
  }
  aoa.push(
    [null, null],
    ['QC errors', qc.filter((q) => q.severity === 'error').length],
    ['QC warnings', qc.filter((q) => q.severity === 'warning').length],
  );
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 22 }, { wch: 48 }];
  // Currency formats.
  aoa.forEach((row, r) => {
    if (row[0] === 'Earnings' || row[0] === 'Rate per foot' || row[0] === 'Rate per node') {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })] as XLSX.CellObject | undefined;
      if (cell && cell.t === 'n') cell.z = '"$"#,##0.00';
    }
  });
  return ws;
}

/** Excel workbook with Summary, Nodes, Spans and QC Issues sheets. QC is computed when not passed. */
export function buildXlsx(bundle: ExportBundle, qc: QcIssue[] = runQc(bundle)): Uint8Array {
  const wb = XLSX.utils.book_new();
  const created = new Date(bundle.generatedAt);
  wb.Props = { Title: bundle.project.name, Subject: 'Field mapping export', Author: APP_NAME };
  if (!Number.isNaN(created.getTime())) wb.Props.CreatedDate = created;
  XLSX.utils.book_append_sheet(wb, summarySheet(bundle, qc), 'Summary');
  XLSX.utils.book_append_sheet(wb, tableSheet(nodeTable(bundle)), 'Nodes');
  XLSX.utils.book_append_sheet(wb, tableSheet(spanTable(bundle)), 'Spans');
  XLSX.utils.book_append_sheet(wb, tableSheet(qcTable(bundle, qc)), 'QC Issues');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  return new Uint8Array(out);
}
