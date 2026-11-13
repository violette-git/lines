/// <reference types="jest" />
import { DEMO_PROJECT_ID, buildDemoSeed } from '@/data/demoSeed';
import { computeSpanLengths, distanceM, findPossibleDuplicate } from '@/geo';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('demo seed', () => {
  const seed = buildDemoSeed();
  const byType = (t: string) => seed.nodes.filter((n) => n.type === t);

  test('one project and one template with the requested rates', () => {
    expect(seed.projects).toHaveLength(1);
    expect(seed.projects[0].id).toBe(DEMO_PROJECT_ID);
    expect(seed.projects[0].name).toBe('Demo: Morris Ave fiber route');
    expect(seed.templates[0]).toMatchObject({ name: 'Demo Telecom Co', ratePerFoot: 0.35, ratePerNode: 2 });
    expect(seed.projects[0].templateId).toBe(seed.templates[0].id);
  });

  test('node mix: 10 poles, 3 handholes, 1 pedestal, unique seqs and UUIDs', () => {
    expect(byType('pole')).toHaveLength(10);
    expect(byType('handhole')).toHaveLength(3);
    expect(byType('pedestal')).toHaveLength(1);
    const ids = [...seed.nodes.map((n) => n.id), ...seed.spans.map((s) => s.id), DEMO_PROJECT_ID, seed.templates[0].id];
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(UUID_V4));
    expect(new Set(seed.nodes.map((n) => n.seq)).size).toBe(seed.nodes.length);
    expect(byType('pole')[0].label).toBe('P-001');
    expect(byType('pole')[0].fields.pole_tag).toBe('AP 40217');
  });

  test('located in downtown Birmingham, AL', () => {
    for (const n of seed.nodes) {
      expect(n.position.lat).toBeGreaterThan(33.50);
      expect(n.position.lat).toBeLessThan(33.53);
      expect(n.position.lng).toBeGreaterThan(-86.82);
      expect(n.position.lng).toBeLessThan(-86.79);
    }
  });

  test('spans connect existing nodes with sensible kinds and lengths', () => {
    const nodeById = new Map(seed.nodes.map((n) => [n.id, n]));
    for (const s of seed.spans) {
      const a = nodeById.get(s.fromNodeId)!;
      const b = nodeById.get(s.toNodeId)!;
      expect(a && b).toBeTruthy();
      if (a.type === 'pole' && b.type === 'pole') expect(s.kind).toBe('aerial');
      if (a.type === 'handhole' || b.type === 'handhole') expect(s.kind).toBe('underground');
    }
    const lengths = computeSpanLengths(seed.spans, seed.nodes);
    expect(lengths).toHaveLength(seed.spans.length);
    for (const s of lengths.filter((x) => x.kind === 'aerial')) {
      expect(s.straightFt).toBeGreaterThan(150);
      expect(s.straightFt).toBeLessThan(200);
    }
    expect(lengths.some((s) => s.lengthOverrideFt != null)).toBe(true);
    expect(lengths.some((s) => s.slackFt > 0)).toBe(true);
  });

  test('AI and duplicate examples are consistent', () => {
    const aiDone = seed.nodes.filter((n) => n.status === 'ai_done');
    expect(aiDone.length).toBeGreaterThanOrEqual(2);
    aiDone.forEach((n) => expect(Object.keys(n.aiMeta).length).toBeGreaterThan(0));
    const dups = seed.nodes.filter((n) => n.possibleDuplicateOf);
    expect(dups).toHaveLength(1);
    const dup = dups[0];
    const target = seed.nodes.find((n) => n.id === dup.possibleDuplicateOf)!;
    expect(distanceM(dup.position, target.position)).toBeLessThan(4);
    expect(findPossibleDuplicate(dup, seed.nodes, 4)?.id).toBe(target.id);
  });

  test('no em-dash characters in demo text', () => {
    expect(JSON.stringify(seed)).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
  });
});
