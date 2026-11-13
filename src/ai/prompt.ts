// Shared prompt, tool schema and result normalization for the Claude photo analysis.
// Pure module (no platform imports) so the Supabase Edge Function can mirror it exactly.
import type { AiAnalysisRequest, AiAnalysisResult, AiFieldResult } from '@/domain/contracts';
import { NODE_SCHEMAS, type FieldDef } from '@/domain/nodeSchemas';
import { NODE_TYPES, type FieldValue, type NodeType } from '@/domain/types';

export const RECORD_NODE_TOOL = 'record_node';
export const DEFAULT_AI_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_MAX_TOKENS = 4096;

export const SYSTEM_PROMPT = `You are a senior outside plant (OSP) telecom field engineer reviewing one field photo from a fielding, make-ready or as-built job. Crews photograph poles, handholes, vaults, pedestals, splice cases, risers, anchors and building entries. Your job is to turn the photo into accurate structured data. You report what the photo supports and nothing more. Record your findings by calling the ${RECORD_NODE_TOOL} tool exactly once.

READ, DO NOT GUESS
- Pole tags and ID plates, lid castings, pedestal and cabinet labels, splice case tags and equipment labels: transcribe exactly as shown, keeping letters, spaces and dashes (for example "AP 40217", "FIBER", "COMM", "PED-0042").
- If any character of an identifier is unreadable, obscured, cut off or not in frame, set value to null and explain in the note. Never invent, complete or "correct" a tag number. A wrong tag is worse than a missing one because crews use tags to find poles.
- A legible wood pole birthmark (brand with class and length, for example "3-40") is a direct read: pole height and class from a birthmark are not estimates.

COMMUNICATION SPACE
- The communication space is the zone on the pole below the power supply space (below the neutral or lowest secondary and below streetlight brackets).
- Count distinct attachment points in that zone: each bolt or clamp that carries a strand or cable counts once. Several cables overlashed to one strand count as one attachment. Do not count power conductors, streetlight feeds, ground wires or down guys.
- Attachment heights are visual estimates unless a height stick or measuring pole is in frame.

HEIGHTS AND SIZES
- Estimate only relative to references you can actually see: a height stick (best), standard pole lengths (distribution poles are commonly 35 to 45 ft overall, set about 10 percent plus 2 ft in the ground, so a 40 ft pole stands about 34 ft above grade), the 12 in minimum spacing between communication attachments, an adult person (about 5.75 ft), a pickup truck (about 6 ft tall), a standard door (about 7 ft), or a known handhole lid size.
- Set is_estimate true for every value derived visually rather than read. If there is no usable reference, return null or give a low confidence instead of a confident guess.
- Give numbers in the unit the field asks for, as plain numbers (18 ft 2 in is 18.17). Text fields that ask for a format, such as attachment heights, use that format.

CLASSIFICATION
- detected_type is what the photo mainly shows: pole; handhole (small grade-level box with a flush lid, up to about 36 x 60 in); vault (large, often concrete, man-entry or multiple lids); pedestal (above-grade dome or cabinet); splice_case (closure on strand, on a pole or inside a box); riser (conduit or U-guard running up a pole); anchor (guy anchor rod and guys at grade); building_entry (cable entering a structure); custom (anything else).
- If the photo does not match the node type the crew selected, still report what you see and add a warning.

CONFIDENCE
- 0.9 or higher: read clearly or unmistakable. 0.6 to 0.89: visible but partly obscured, or inferred from strong cues. 0.35 to 0.59: an educated estimate. Below 0.35: do not trust; prefer value null.
- Booleans: true only when you can see the item; false only when the relevant part of the asset is clearly in frame and the item is absent; otherwise null.
- Owner: base it on tags, markings or equipment (a power company tag or a transformer suggests power utility ownership). If unclear use "Unknown" with low confidence.

WARNINGS (short, specific, one issue each)
- Safety and make-ready observations: communication attachments that look closer than 40 in to the lowest power or 12 in to each other, leaning or cracked poles, ground-line rot, woodpecker damage, broken crossarms, loose or slack down guys, missing guy guards, low cable over a roadway or driveway, tree contact, broken lashing, damaged or missing lids, exposed or broken conduit, trip hazards.
- Photo quality problems that limit the analysis (blurry, tag out of frame, backlit, night shot).
- A mismatch between the selected node type and what the photo shows.

OTHER OUTPUTS
- suggested_label: only an identifier physically printed on the asset (for example a pedestal ID). Otherwise null. Never make one up from a sequence.
- summary: one or two plain sentences describing what the photo shows.
- Every field in the tool schema must be present. Use value null when the photo does not show it.`;

// ---------- JSON schema ----------
export type JsonSchema = { [k: string]: unknown };

const UNIT_TEXT: Record<NonNullable<FieldDef['unit']>, string> = {
  ft: 'feet as a decimal number',
  in: 'inches as a number',
  count: 'a whole-number count',
  pct: 'percent as a number',
};

const hasOther = (def: FieldDef) => (def.options ?? []).some((o) => o.toLowerCase() === 'other');

function valueSchema(def: FieldDef): JsonSchema {
  switch (def.kind) {
    case 'number':
      return def.unit === 'count' ? { type: ['integer', 'null'], minimum: 0 } : { type: ['number', 'null'] };
    case 'boolean':
      return { type: ['boolean', 'null'] };
    case 'select': {
      const options = def.options ?? [];
      if (options.length === 0 || hasOther(def)) return { type: ['string', 'null'] };
      return { type: ['string', 'null'], enum: [...options, null] };
    }
    default:
      return { type: ['string', 'null'] };
  }
}

function describeField(def: FieldDef): string {
  const parts = [def.label];
  if (def.help) parts.push(def.help);
  if (def.kind === 'number' && def.unit) parts.push(`Value in ${UNIT_TEXT[def.unit]}.`);
  if (def.kind === 'select' && def.options?.length) {
    parts.push(
      hasOther(def)
        ? `One of: ${def.options.join(', ')}. If none fits, give the specific value as text.`
        : `One of: ${def.options.join(', ')}.`,
    );
  }
  if (def.kind === 'boolean') parts.push('true, false, or null if not visible.');
  if (def.aiEstimateOnly) parts.push('Visual estimate unless a height stick or other true scale reference is in frame.');
  return parts.join('. ').replace(/\.\./g, '.');
}

export function fieldSchema(def: FieldDef): JsonSchema {
  return {
    type: 'object',
    description: describeField(def),
    properties: {
      value: valueSchema(def),
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      is_estimate: { type: 'boolean' },
      note: { type: 'string', description: 'Short reason, what was read or what reference was used.' },
    },
    required: ['value', 'confidence', 'is_estimate'],
    additionalProperties: false,
  };
}

/** Only aiFillable fields, first definition wins for duplicate keys. */
export function aiFillableDefs(fieldDefs: FieldDef[]): FieldDef[] {
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const d of fieldDefs) {
    if (!d.aiFillable || seen.has(d.key)) continue;
    seen.add(d.key);
    out.push(d);
  }
  return out;
}

/**
 * aiFillable field definitions for a node type. For 'auto', the union across all types, merged by
 * key: options are unioned, and conflicting kinds fall back to text.
 */
export function aiFieldDefsFor(nodeType: NodeType | 'auto'): FieldDef[] {
  if (nodeType !== 'auto') return aiFillableDefs(NODE_SCHEMAS[nodeType]);
  const merged = new Map<string, FieldDef>();
  for (const t of NODE_TYPES) {
    for (const d of NODE_SCHEMAS[t]) {
      if (!d.aiFillable) continue;
      const prev = merged.get(d.key);
      if (!prev) {
        merged.set(d.key, { ...d, options: d.options ? [...d.options] : undefined });
        continue;
      }
      if (prev.kind !== d.kind) {
        merged.set(d.key, { ...prev, kind: 'text', options: undefined, unit: prev.unit ?? d.unit });
        continue;
      }
      if (prev.options || d.options) {
        const opts = [...(prev.options ?? [])];
        for (const o of d.options ?? []) if (!opts.includes(o)) opts.push(o);
        prev.options = opts;
      }
      prev.aiEstimateOnly = prev.aiEstimateOnly || d.aiEstimateOnly;
    }
  }
  return [...merged.values()];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export function buildRecordNodeTool(fieldDefs: FieldDef[]): ToolDefinition {
  const defs = aiFillableDefs(fieldDefs);
  const fieldProps: Record<string, JsonSchema> = {};
  for (const d of defs) fieldProps[d.key] = fieldSchema(d);
  return {
    name: RECORD_NODE_TOOL,
    description:
      'Record the structured fielding data observed in the photo. Call exactly once. Use value null for anything the photo does not show.',
    input_schema: {
      type: 'object',
      properties: {
        detected_type: { type: 'string', enum: [...NODE_TYPES], description: 'What the photo mainly shows.' },
        type_confidence: { type: 'number', minimum: 0, maximum: 1 },
        fields: {
          type: 'object',
          description: 'One entry per field.',
          properties: fieldProps,
          required: defs.map((d) => d.key),
          additionalProperties: false,
        },
        suggested_label: {
          type: ['string', 'null'],
          description: 'Identifier physically printed on the asset, else null.',
        },
        summary: { type: 'string', description: 'One or two sentences describing the photo.' },
        warnings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Safety, make-ready, type mismatch and photo quality issues. Empty array if none.',
        },
      },
      required: ['detected_type', 'type_confidence', 'fields', 'suggested_label', 'summary', 'warnings'],
      additionalProperties: false,
    },
  };
}

/** The text block that accompanies the image. */
export function buildUserPrompt(req: Pick<AiAnalysisRequest, 'nodeType' | 'context'>): string {
  const lines: string[] = [];
  if (req.nodeType === 'auto') {
    lines.push('The crew did not choose a node type. Classify the asset in detected_type and fill the fields that apply to it.');
  } else {
    lines.push(`The crew captured this photo as a ${req.nodeType.replace(/_/g, ' ')} node.`);
  }
  const c = req.context;
  if (c?.workType) lines.push(`Job work type: ${c.workType}.`);
  if (c?.client) lines.push(`Client: ${c.client}.`);
  if (c?.previousLabel) lines.push(`Previous node captured on this route: ${c.previousLabel}.`);
  lines.push(`Analyze the photo and call ${RECORD_NODE_TOOL}.`);
  return lines.join('\n');
}

// ---------- result normalization ----------
const clamp01 = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

const isNodeType = (v: unknown): v is NodeType => typeof v === 'string' && (NODE_TYPES as string[]).includes(v);

function toFieldValue(v: unknown): FieldValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return null;
}

function normalizeField(entry: unknown): AiFieldResult | null {
  if (entry === undefined) return null;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    // Lenient: a bare value instead of the {value, confidence} object.
    const value = toFieldValue(entry);
    return { value, confidence: value === null ? 0 : 0.5, isEstimate: false };
  }
  const e = entry as Record<string, unknown>;
  const out: AiFieldResult = {
    value: toFieldValue(e.value),
    confidence: clamp01(e.confidence),
    isEstimate: e.is_estimate === true || e.isEstimate === true,
  };
  if (typeof e.note === 'string' && e.note.trim()) out.note = e.note.trim();
  return out;
}

export interface NormalizeOptions {
  /** Restrict fields to these keys (unknown keys are dropped). */
  fieldDefs?: FieldDef[];
  /** Used when detected_type is missing or invalid. */
  fallbackType?: NodeType | 'auto';
}

/**
 * Turns either the tool_use input (snake_case) or an AiAnalysisResult-shaped JSON (camelCase, as the
 * proxy returns) into a validated AiAnalysisResult. Throws on non-objects.
 */
export function normalizeAiResult(raw: unknown, opts: NormalizeOptions = {}): AiAnalysisResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI returned no structured result.');
  }
  const r = raw as Record<string, unknown>;
  const typeRaw = r.detected_type ?? r.detectedType;
  const fallback = opts.fallbackType && opts.fallbackType !== 'auto' ? opts.fallbackType : 'custom';
  const detectedType = isNodeType(typeRaw) ? typeRaw : fallback;

  const allowed = opts.fieldDefs ? new Set(opts.fieldDefs.map((d) => d.key)) : null;
  const fieldsRaw = r.fields && typeof r.fields === 'object' && !Array.isArray(r.fields) ? (r.fields as Record<string, unknown>) : {};
  const fields: Record<string, AiFieldResult> = {};
  for (const [k, v] of Object.entries(fieldsRaw)) {
    if (allowed && !allowed.has(k)) continue;
    const f = normalizeField(v);
    if (f) fields[k] = f;
  }

  const labelRaw = r.suggested_label ?? r.suggestedLabel;
  const warningsRaw = r.warnings;
  const result: AiAnalysisResult = {
    detectedType,
    typeConfidence: clamp01(r.type_confidence ?? r.typeConfidence),
    fields,
    suggestedLabel: typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : null,
    summary: typeof r.summary === 'string' ? r.summary.trim() : '',
    warnings: Array.isArray(warningsRaw)
      ? warningsRaw.filter((w): w is string => typeof w === 'string' && w.trim() !== '').map((w) => w.trim())
      : [],
  };
  const usage = r.usage as Record<string, unknown> | undefined;
  if (usage && typeof usage === 'object') {
    const inputTokens = Number(usage.inputTokens ?? usage.input_tokens);
    const outputTokens = Number(usage.outputTokens ?? usage.output_tokens);
    if (Number.isFinite(inputTokens) && Number.isFinite(outputTokens)) result.usage = { inputTokens, outputTokens };
  }
  return result;
}
