import type { ExportBundle } from '@/domain/contracts';
import { nodeTable, spanTable, type Cell, type Table } from './tables';

/** UTF-8 byte order mark so Excel opens non-ASCII text correctly. Other tools ignore it. */
export const CSV_BOM = '﻿';

/**
 * RFC 4180 field: quoted when it contains a comma, quote, CR or LF (or leading/trailing space);
 * embedded quotes are doubled. Text that a spreadsheet would run as a formula (=, +, @, or "-"
 * not starting a number) is prefixed with an apostrophe to block CSV formula injection.
 */
export function csvField(v: Cell, digits?: number): string {
  let s: string;
  if (v === null || v === undefined) s = '';
  else if (typeof v === 'boolean') s = v ? 'Yes' : 'No';
  else if (typeof v === 'number') s = Number.isFinite(v) ? (digits !== undefined ? v.toFixed(digits) : String(v)) : '';
  else {
    s = v;
    if (/^[=+@\t\r]/.test(s) || /^-(?![\d.])/.test(s)) s = "'" + s;
  }
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableToCsv(t: Table): string {
  const coord = new Set(t.coordCols);
  const lines = [t.headers.map((h) => csvField(h)).join(',')];
  for (const row of t.rows) lines.push(row.map((c, i) => csvField(c, coord.has(i) ? 7 : undefined)).join(','));
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

export function buildCsv(bundle: ExportBundle): { nodesCsv: string; spansCsv: string } {
  return { nodesCsv: tableToCsv(nodeTable(bundle)), spansCsv: tableToCsv(spanTable(bundle)) };
}
