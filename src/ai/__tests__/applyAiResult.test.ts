/// <reference types="jest" />
import { applyAiResult, coerceFieldValue } from '@/ai/applyAiResult';
import type { AiAnalysisResult, AiFieldResult } from '@/domain/contracts';
import { NODE_SCHEMAS, type FieldDef } from '@/domain/nodeSchemas';
import type { MapNode } from '@/domain/types';

const poleDefs = NODE_SCHEMAS.pole.filter((d) => d.aiFillable);
const def = (key: string, type: keyof typeof NODE_SCHEMAS = 'pole'): FieldDef => NODE_SCHEMAS[type].find((d) => d.key === key)!;

function pole(extra: Partial<MapNode> = {}): MapNode {
  return {
    id: 'n1',
    projectId: 'p',
    seq: 3,
    type: 'pole',
    label: 'P-3',
    position: { lat: 1, lng: 2, accuracyM: 3, altitudeM: null, samples: 1, capturedAt: 't', source: 'gps' },
    fields: {},
    aiMeta: {},
    iconScale: 1,
    status: 'ai_pending',
    notes: 'keep me',
    possibleDuplicateOf: null,
    createdAt: 't',
    updatedAt: 't',
    ...extra,
  };
}

const f = (value: AiFieldResult['value'], confidence = 0.9, isEstimate = false, note?: string): AiFieldResult =>
  note ? { value, confidence, isEstimate, note } : { value, confidence, isEstimate };

function result(fields: Record<string, AiFieldResult>, extra: Partial<AiAnalysisResult> = {}): AiAnalysisResult {
  return { detectedType: 'pole', typeConfidence: 0.9, fields, suggestedLabel: null, summary: '', warnings: [], ...extra };
}

describe('coerceFieldValue', () => {
  test('numbers', () => {
    expect(coerceFieldValue(def('pole_height_ft'), '40 ft')).toBe(40);
    expect(coerceFieldValue(def('pole_height_ft'), `18'2"`)).toBe(18.17);
    expect(coerceFieldValue(def('pole_height_ft'), '1,200')).toBe(1200);
    expect(coerceFieldValue(def('comm_attachment_count'), 2.6)).toBe(3);
    expect(coerceFieldValue(def('comm_attachment_count'), 'three')).toBeUndefined();
    expect(coerceFieldValue(def('pole_height_ft'), true)).toBeUndefined();
  });

  test('booleans', () => {
    expect(coerceFieldValue(def('leaning'), 'Yes')).toBe(true);
    expect(coerceFieldValue(def('leaning'), 'none')).toBe(false);
    expect(coerceFieldValue(def('leaning'), 0)).toBe(false);
    expect(coerceFieldValue(def('leaning'), 'maybe')).toBeUndefined();
  });

  test('selects match case-insensitively, Other allows free text, otherwise skipped', () => {
    expect(coerceFieldValue(def('material'), 'wood')).toBe('Wood');
    expect(coerceFieldValue(def('owner'), 'cable/catv')).toBe('Cable/CATV');
    expect(coerceFieldValue(def('pole_class'), 4)).toBe('4');
    expect(coerceFieldValue(def('material'), 'Bamboo')).toBeUndefined();
    expect(coerceFieldValue(def('size', 'handhole'), '13X30')).toBe('13X30');
    expect(coerceFieldValue(def('size', 'handhole'), '24X36')).toBe('24x36');
  });

  test('text', () => {
    expect(coerceFieldValue(def('pole_tag'), '  AP 1  ')).toBe('AP 1');
    expect(coerceFieldValue(def('pole_tag'), '   ')).toBeUndefined();
    expect(coerceFieldValue(def('pole_tag'), 12345)).toBe('12345');
  });
});

describe('applyAiResult', () => {
  test('fills empty fields with coerced values and AI metadata', () => {
    const n = pole();
    const out = applyAiResult(n, result({ pole_tag: f('AP 40217', 0.95, false, 'tag'), material: f('wood'), leaning: f('no') }), poleDefs);
    expect(out.fields).toEqual({ pole_tag: 'AP 40217', material: 'Wood', leaning: false });
    expect(out.aiMeta.pole_tag).toEqual({ confidence: 0.95, source: 'ai', isEstimate: false, note: 'tag' });
    expect(out).not.toBe(n);
    expect(n.fields).toEqual({}); // input not mutated
    expect(out.label).toBe('P-3');
    expect(out.notes).toBe('keep me');
    expect(out.status).toBe('ai_pending');
  });

  test('never overwrites manual fields or user-set fields without aiMeta', () => {
    const n = pole({
      fields: { pole_tag: 'AP 99999', owner: 'Telco' },
      aiMeta: { pole_tag: { confidence: 1, source: 'manual', isEstimate: false } },
    });
    const out = applyAiResult(n, result({ pole_tag: f('AP 11111'), owner: f('Power utility') }), poleDefs);
    expect(out.fields.pole_tag).toBe('AP 99999');
    expect(out.fields.owner).toBe('Telco');
    expect(out.aiMeta.pole_tag.source).toBe('manual');
    expect(out.aiMeta.owner).toBeUndefined();
  });

  test('re-run replaces previously AI-filled values', () => {
    const n = pole({ fields: { owner: 'Unknown' }, aiMeta: { owner: { confidence: 0.4, source: 'ai', isEstimate: false } } });
    const out = applyAiResult(n, result({ owner: f('Joint use', 0.8) }), poleDefs);
    expect(out.fields.owner).toBe('Joint use');
    expect(out.aiMeta.owner.confidence).toBe(0.8);
  });

  test('drops low-confidence values and unknown/non-fillable fields', () => {
    const out = applyAiResult(pole(), result({ pole_tag: f('AP 1', 0.34), make_ready: f(true), condition: f('Good', 0.35) }), NODE_SCHEMAS.pole);
    expect(out.fields).toEqual({ condition: 'Good' });
  });

  test('null and uncoercible values are skipped', () => {
    const out = applyAiResult(pole(), result({ pole_tag: f(null), material: f('Bamboo'), guy_count: f('two') }), poleDefs);
    expect(out.fields).toEqual({});
    expect(out.aiMeta).toEqual({});
  });

  test('estimate-only fields are estimates unless a height stick is reported', () => {
    const noStick = applyAiResult(pole(), result({ pole_height_ft: f(40, 0.6, false) }), poleDefs);
    expect(noStick.aiMeta.pole_height_ft.isEstimate).toBe(true);

    const stick = applyAiResult(
      pole(),
      result({ pole_height_ft: f(40, 0.8, false), height_stick_in_photo: f(true, 0.9) }),
      poleDefs,
    );
    expect(stick.aiMeta.pole_height_ft.isEstimate).toBe(false);
    expect(stick.fields.height_stick_in_photo).toBe(true);

    const weakStick = applyAiResult(
      pole(),
      result({ pole_height_ft: f(40, 0.8, false), height_stick_in_photo: f(true, 0.2) }),
      poleDefs,
    );
    expect(weakStick.aiMeta.pole_height_ft.isEstimate).toBe(true);
  });

  test('suggestedLabel never replaces the label', () => {
    const out = applyAiResult(pole(), result({}, { suggestedLabel: 'POLE 7' }), poleDefs);
    expect(out.label).toBe('P-3');
  });

  test('template default without aiMeta counts as user-set', () => {
    const out = applyAiResult(pole({ fields: { material: 'Steel' } }), result({ material: f('Wood', 0.99) }), poleDefs);
    expect(out.fields.material).toBe('Steel');
  });

  test('empty string field is treated as empty', () => {
    const out = applyAiResult(pole({ fields: { pole_tag: '  ' } }), result({ pole_tag: f('AP 5') }), poleDefs);
    expect(out.fields.pole_tag).toBe('AP 5');
  });
});
