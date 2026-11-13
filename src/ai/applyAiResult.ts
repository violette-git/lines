import type { AiAnalysisResult } from '@/domain/contracts';
import type { FieldDef } from '@/domain/nodeSchemas';
import type { AiFieldMeta, FieldValue, MapNode } from '@/domain/types';

/** AI values below this confidence are discarded. */
export const MIN_AI_CONFIDENCE = 0.35;

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'present', 'visible', 'x']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'none', 'absent', 'not present']);

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Parses "35", "35.5", "1,200", "40 ft", "18'2\"", "18 ft 2 in". */
export function parseNumberish(v: string, unit?: FieldDef['unit']): number | null {
  const s = v.trim().replace(/,/g, '');
  if (unit === 'ft') {
    const fi = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?/i);
    if (fi) {
      const ft = Number(fi[1]);
      const inch = fi[2] ? Number(fi[2]) : 0;
      return Math.round((ft + inch / 12) * 100) / 100;
    }
  }
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Coerces an AI value to the field's kind. Returns undefined when it cannot be used. */
export function coerceFieldValue(def: FieldDef, value: FieldValue): FieldValue | undefined {
  if (value === null || value === undefined) return undefined;
  switch (def.kind) {
    case 'number': {
      let n: number | null = null;
      if (typeof value === 'number') n = value;
      else if (typeof value === 'string') n = parseNumberish(value, def.unit);
      if (n === null || !Number.isFinite(n)) return undefined;
      return def.unit === 'count' ? Math.max(0, Math.round(n)) : n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined;
      const w = norm(value);
      if (TRUE_WORDS.has(w)) return true;
      if (FALSE_WORDS.has(w)) return false;
      return undefined;
    }
    case 'select': {
      if (typeof value === 'boolean') return undefined;
      const raw = String(value).trim();
      if (!raw) return undefined;
      const options = def.options ?? [];
      const exact = options.find((o) => norm(o) === norm(raw));
      if (exact) return exact;
      const fuzzy = options.find((o) => loose(o) !== '' && loose(o) === loose(raw));
      if (fuzzy) return fuzzy;
      return options.some((o) => norm(o) === 'other') ? raw : undefined;
    }
    default: {
      const s = typeof value === 'string' ? value.trim() : String(value);
      return s ? s : undefined;
    }
  }
}

const isEmpty = (v: FieldValue | undefined) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Merges an AI result into a node and returns a NEW node. Rules:
 * - Only aiFillable fields from fieldDefs are touched.
 * - A field is written only if it is empty, or was previously filled by AI (aiMeta.source 'ai').
 *   Fields marked manual, and non-empty fields without aiMeta (user typed or template default), are
 *   never overwritten.
 * - Values with confidence below 0.35 are dropped; values are coerced to the field kind.
 * - aiEstimateOnly fields are marked isEstimate unless the result reports a height stick in frame.
 * - Label, notes, type and status are left alone (labels are user controlled).
 */
export function applyAiResult(node: MapNode, result: AiAnalysisResult, fieldDefs: FieldDef[]): MapNode {
  const fields = { ...node.fields };
  const aiMeta: Record<string, AiFieldMeta> = { ...node.aiMeta };

  const stick = result.fields.height_stick_in_photo;
  const heightStickPresent = !!stick && stick.value === true && stick.confidence >= MIN_AI_CONFIDENCE;

  for (const def of fieldDefs) {
    if (!def.aiFillable) continue;
    const r = result.fields[def.key];
    if (!r || !(r.confidence >= MIN_AI_CONFIDENCE)) continue;

    const meta = node.aiMeta[def.key];
    const writable = meta ? meta.source === 'ai' : isEmpty(node.fields[def.key]);
    if (!writable) continue;

    const value = coerceFieldValue(def, r.value);
    if (value === undefined) continue;

    const isEstimate = def.aiEstimateOnly ? (heightStickPresent ? !!r.isEstimate : true) : !!r.isEstimate;
    const m: AiFieldMeta = { confidence: Math.min(1, r.confidence), source: 'ai', isEstimate };
    if (r.note) m.note = r.note;
    fields[def.key] = value;
    aiMeta[def.key] = m;
  }

  return { ...node, fields, aiMeta };
}
