import { runQc } from '@/domain/qc';
import { makeBundle } from '../__fixtures__/bundle';

const find = (issues: ReturnType<typeof runQc>, re: RegExp) => issues.filter((i) => re.test(i.message));

describe('runQc', () => {
  it('flags the fixture issues with errors first', () => {
    const issues = runQc(makeBundle());
    expect(issues[0].severity).toBe('error');
    const firstWarning = issues.findIndex((i) => i.severity === 'warning');
    expect(issues.slice(firstWarning).every((i) => i.severity === 'warning')).toBe(true);
  });

  it('required template fields missing -> error', () => {
    const issues = runQc(makeBundle());
    const req = find(issues, /missing required field/);
    expect(req).toHaveLength(1);
    expect(req[0]).toMatchObject({ severity: 'error', nodeId: 'n-2' });
    expect(req[0].message).toContain('Pole tag / number');
    // Without a template there is no requirement.
    expect(find(runQc(makeBundle({ template: null })), /required/)).toHaveLength(0);
  });

  it('nodes without photos -> warning', () => {
    const issues = find(runQc(makeBundle()), /no photo/);
    expect(issues.map((i) => i.nodeId).sort()).toEqual(['n-2', 'n-3']);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('unreviewed AI estimates -> warning; reviewed nodes pass', () => {
    const b = makeBundle();
    const ai = find(runQc(b), /AI-filled/);
    expect(ai).toHaveLength(1);
    expect(ai[0].nodeId).toBe('n-1');
    expect(ai[0].message).toContain('1 visual estimate');
    b.nodes[0].status = 'reviewed';
    expect(find(runQc(b), /AI-filled/)).toHaveLength(0);
  });

  it('possible duplicates -> warning', () => {
    const b = makeBundle();
    b.nodes[1].possibleDuplicateOf = 'n-1';
    const d = find(runQc(b), /possible duplicate/);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'warning', nodeId: 'n-2' });
    expect(d[0].message).toContain('P-1');
  });

  it('GPS accuracy worse than 10 m -> warning', () => {
    const g = find(runQc(makeBundle()), /GPS accuracy/);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ severity: 'warning', nodeId: 'n-2' });
  });

  it('zero length and over-long aerial spans -> warning', () => {
    const b = makeBundle();
    b.spans[0].straightFt = 0;
    b.spans[0].totalFt = 0;
    b.spans[1].kind = 'aerial';
    b.spans[1].straightFt = 750;
    b.spans[1].totalFt = 765;
    const issues = runQc(b);
    expect(find(issues, /zero length/)).toEqual([expect.objectContaining({ severity: 'warning', spanId: 's-1' })]);
    expect(find(issues, /exceeds the typical 600 ft/)).toEqual([expect.objectContaining({ severity: 'warning', spanId: 's-2' })]);
    // Underground spans may be long.
    b.spans[1].kind = 'underground';
    expect(find(runQc(b), /exceeds/)).toHaveLength(0);
  });

  it('orphan nodes -> warning (only when the project has more than one node)', () => {
    const b = makeBundle();
    b.spans = b.spans.slice(0, 1);
    const o = find(runQc(b), /not connected/);
    expect(o).toHaveLength(1);
    expect(o[0].nodeId).toBe('n-3');
    const single = makeBundle();
    single.nodes = single.nodes.slice(0, 1);
    single.spans = [];
    expect(find(runQc(single), /not connected/)).toHaveLength(0);
  });

  it('anchors are exempt from the orphan rule', () => {
    const b = makeBundle();
    b.nodes[2].type = 'anchor';
    b.spans = b.spans.slice(0, 1);
    expect(find(runQc(b), /not connected/)).toHaveLength(0);
  });

  it('ai_failed nodes -> warning', () => {
    const f = find(runQc(makeBundle()), /AI analysis failed/);
    expect(f).toEqual([expect.objectContaining({ severity: 'warning', nodeId: 'n-3' })]);
  });

  it('spans pointing at missing nodes -> error', () => {
    const b = makeBundle();
    b.spans[1].toNodeId = 'gone';
    expect(find(runQc(b), /no longer exists/)).toEqual([expect.objectContaining({ severity: 'error', spanId: 's-2' })]);
  });

  it('a clean project has no issues', () => {
    const b = makeBundle({ template: null });
    b.nodes.forEach((n) => {
      n.status = 'reviewed';
      n.position.accuracyM = 2;
    });
    b.photos = b.nodes.map((n, i) => ({ ...b.photos[0], id: `ph-${i}`, nodeId: n.id }));
    expect(runQc(b)).toEqual([]);
  });
});
