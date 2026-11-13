/// <reference types="jest" />
import { NODE_SCHEMAS } from '@/domain/nodeSchemas';
import { NODE_TYPES } from '@/domain/types';
import {
  SYSTEM_PROMPT,
  aiFieldDefsFor,
  buildRecordNodeTool,
  buildUserPrompt,
  normalizeAiResult,
} from '@/ai/prompt';

type Obj = Record<string, any>;

describe('buildRecordNodeTool', () => {
  const poleDefs = NODE_SCHEMAS.pole;
  const tool = buildRecordNodeTool(poleDefs);
  const schema = tool.input_schema as Obj;
  const fieldProps = schema.properties.fields.properties as Obj;

  test('named record_node with top-level properties', () => {
    expect(tool.name).toBe('record_node');
    expect(schema.required).toEqual(['detected_type', 'type_confidence', 'fields', 'suggested_label', 'summary', 'warnings']);
    expect(schema.properties.detected_type.enum).toEqual(NODE_TYPES);
  });

  test('only aiFillable fields, all required', () => {
    expect(fieldProps.pole_tag).toBeDefined();
    expect(fieldProps.make_ready).toBeUndefined();
    expect(fieldProps.location_note).toBeUndefined();
    const fillable = poleDefs.filter((d) => d.aiFillable).map((d) => d.key);
    expect(Object.keys(fieldProps)).toEqual(fillable);
    expect(schema.properties.fields.required).toEqual(fillable);
  });

  test('each field has value, confidence, is_estimate, note', () => {
    const f = fieldProps.pole_tag;
    expect(Object.keys(f.properties)).toEqual(['value', 'confidence', 'is_estimate', 'note']);
    expect(f.required).toEqual(['value', 'confidence', 'is_estimate']);
    expect(f.properties.confidence).toMatchObject({ minimum: 0, maximum: 1 });
  });

  test('value types follow field kinds', () => {
    expect(fieldProps.pole_tag.properties.value.type).toEqual(['string', 'null']);
    expect(fieldProps.pole_height_ft.properties.value.type).toEqual(['number', 'null']);
    expect(fieldProps.comm_attachment_count.properties.value.type).toEqual(['integer', 'null']);
    expect(fieldProps.leaning.properties.value.type).toEqual(['boolean', 'null']);
    expect(fieldProps.material.properties.value.enum).toEqual(['Wood', 'Steel', 'Concrete', 'Fiberglass', null]);
    expect(fieldProps.pole_height_ft.description).toMatch(/estimate/i);
  });

  test("selects with an 'Other' option allow free text", () => {
    const hh = buildRecordNodeTool(NODE_SCHEMAS.handhole).input_schema as Obj;
    const size = hh.properties.fields.properties.size.properties.value;
    expect(size.enum).toBeUndefined();
    expect(size.type).toEqual(['string', 'null']);
  });
});

describe('aiFieldDefsFor', () => {
  test('specific type returns its aiFillable fields', () => {
    expect(aiFieldDefsFor('anchor').map((d) => d.key)).toEqual(['anchor_type', 'guy_count', 'guard_present']);
  });

  test('auto merges across types by key', () => {
    const defs = aiFieldDefsFor('auto');
    const keys = defs.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    const size = defs.find((d) => d.key === 'size')!;
    expect(size.kind).toBe('text'); // select (handhole) vs text (vault)
    const material = defs.find((d) => d.key === 'material')!;
    expect(material.options).toEqual(expect.arrayContaining(['Wood', 'Polymer concrete', 'PVC']));
  });
});

describe('prompts', () => {
  test('system prompt covers the key rules', () => {
    expect(SYSTEM_PROMPT).toMatch(/record_node/);
    expect(SYSTEM_PROMPT).toMatch(/Never invent/);
    expect(SYSTEM_PROMPT).toMatch(/height stick/);
    expect(SYSTEM_PROMPT).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
  });

  test('user prompt includes context', () => {
    const t = buildUserPrompt({ nodeType: 'splice_case', context: { workType: 'aerial', client: 'Acme', previousLabel: 'P-12' } });
    expect(t).toContain('splice case');
    expect(t).toContain('aerial');
    expect(t).toContain('Acme');
    expect(t).toContain('P-12');
    expect(buildUserPrompt({ nodeType: 'auto' })).toMatch(/Classify/);
  });
});

describe('normalizeAiResult', () => {
  const defs = aiFieldDefsFor('pole');

  test('parses snake_case tool input', () => {
    const r = normalizeAiResult(
      {
        detected_type: 'pole',
        type_confidence: 0.92,
        fields: {
          pole_tag: { value: 'AP 40217', confidence: 0.95, is_estimate: false, note: 'tag plate' },
          pole_height_ft: { value: 40, confidence: 1.4, is_estimate: true },
          bogus: { value: 1, confidence: 1, is_estimate: false },
        },
        suggested_label: '  ',
        summary: ' Wood pole. ',
        warnings: ['Lean toward road', '', 3],
      },
      { fieldDefs: defs, fallbackType: 'pole' },
    );
    expect(r.detectedType).toBe('pole');
    expect(r.typeConfidence).toBe(0.92);
    expect(r.fields.pole_tag).toEqual({ value: 'AP 40217', confidence: 0.95, isEstimate: false, note: 'tag plate' });
    expect(r.fields.pole_height_ft.confidence).toBe(1);
    expect(r.fields.bogus).toBeUndefined();
    expect(r.suggestedLabel).toBeNull();
    expect(r.summary).toBe('Wood pole.');
    expect(r.warnings).toEqual(['Lean toward road']);
  });

  test('accepts camelCase (proxy) shape and falls back on invalid type', () => {
    const r = normalizeAiResult(
      { detectedType: 'spaceship', typeConfidence: 0.2, fields: { owner: { value: 'Telco', confidence: 0.7, isEstimate: false } }, suggestedLabel: 'PED-1', summary: 'x', warnings: [], usage: { inputTokens: 10, outputTokens: 5 } },
      { fallbackType: 'pedestal' },
    );
    expect(r.detectedType).toBe('pedestal');
    expect(r.fields.owner.isEstimate).toBe(false);
    expect(r.suggestedLabel).toBe('PED-1');
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  test('rejects non-objects', () => {
    expect(() => normalizeAiResult(null)).toThrow();
    expect(() => normalizeAiResult('nope')).toThrow();
  });
});
