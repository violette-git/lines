import type { MapNode, Span } from '@/domain/types';
import { computeSpanLengths, distanceM, metersToFeet } from '@/geo';

import {
  describeActivity,
  filterProjects,
  footageByTechWeek,
  footageFromData,
  footageOf,
  lastMonths,
  lastWeeks,
  monthKey,
  projectMonthEnd,
  qcCounts,
  quotaState,
  seatState,
  sortProjects,
  usageRollup,
  weekKey,
} from '../shaping';
import type { ActivityEntry, ProjectSummary } from '../types';

const T = '2026-11-01T00:00:00.000Z';
function node(id: string, lat: number, lng: number): MapNode {
  return {
    id,
    projectId: 'p',
    seq: 1,
    type: 'pole',
    label: id,
    position: { lat, lng, accuracyM: 2, altitudeM: null, samples: 4, capturedAt: T, source: 'gps_avg' },
    fields: {},
    aiMeta: {},
    iconScale: 1,
    status: 'reviewed',
    notes: '',
    possibleDuplicateOf: null,
    createdAt: T,
    updatedAt: T,
  };
}
function span(id: string, from: string, to: string, kind: Span['kind'], extra: Partial<Span> = {}): Span {
  return { id, projectId: 'p', fromNodeId: from, toNodeId: to, kind, slackFt: 0, sagPct: 0, lengthOverrideFt: null, fields: {}, createdAt: T, updatedAt: T, ...extra };
}

describe('footage aggregation', () => {
  const nodes = [node('a', 33.5, -86.8), node('b', 33.5009, -86.8), node('c', 33.5018, -86.8)];
  const spans = [span('s1', 'a', 'b', 'aerial', { sagPct: 2, slackFt: 10 }), span('s2', 'b', 'c', 'underground', { lengthOverrideFt: 400 }), span('orphan', 'a', 'zzz', 'aerial')];

  it('splits aerial and underground using the phone footage math', () => {
    const f = footageFromData(nodes, spans);
    const straight = metersToFeet(distanceM(nodes[0].position, nodes[1].position));
    expect(f.aerialFt).toBeCloseTo(straight * 1.02 + 10, 6);
    expect(f.undergroundFt).toBe(400);
    expect(f.totalFt).toBeCloseTo(f.aerialFt + 400, 6);
    expect(f.spanCount).toBe(2); // orphan span skipped
    // Same answer as the SQL test expects from ST_Length (342..347 ft).
    expect(f.aerialFt).toBeGreaterThan(342);
    expect(f.aerialFt).toBeLessThan(347);
  });

  it('footageOf tolerates non-finite lengths', () => {
    const w = computeSpanLengths(spans, nodes);
    w[0] = { ...w[0], totalFt: NaN };
    expect(footageOf(w).aerialFt).toBe(0);
  });
});

describe('calendar keys (UTC, Monday weeks)', () => {
  it('weekKey returns the Monday', () => {
    expect(weekKey('2026-11-13T15:00:00Z')).toBe('2026-11-09'); // Friday -> Monday
    expect(weekKey('2026-11-09T00:00:00Z')).toBe('2026-11-09');
    expect(weekKey('2026-11-08T23:59:59Z')).toBe('2026-11-02'); // Sunday belongs to prior week
  });
  it('month and ranges', () => {
    const now = Date.parse('2026-02-10T12:00:00Z');
    expect(monthKey(now)).toBe('2026-02-01');
    expect(lastMonths(3, now)).toEqual(['2025-12-01', '2026-01-01', '2026-02-01']);
    expect(lastWeeks(3, now)).toEqual(['2026-01-26', '2026-02-02', '2026-02-09']);
  });
});

describe('footage per tech per week', () => {
  it('builds a matrix, sorts techs by total and ignores weeks outside the range', () => {
    const weeks = ['2026-11-02', '2026-11-09'];
    const m = footageByTechWeek(
      [
        { weekStart: '2026-11-02', userId: 'u1', name: 'Ann', aerialFt: 100, undergroundFt: 50, spans: 2 },
        { weekStart: '2026-11-09', userId: 'u1', name: 'Ann', aerialFt: 10, undergroundFt: 0, spans: 1 },
        { weekStart: '2026-11-09', userId: 'u2', name: 'Bo', aerialFt: 500, undergroundFt: 0, spans: 3 },
        { weekStart: '2026-10-26', userId: 'u3', name: 'Old', aerialFt: 999, undergroundFt: 0, spans: 1 },
        { weekStart: '2026-11-09', userId: null, name: null, aerialFt: 0, undergroundFt: 5, spans: 1 },
      ],
      weeks,
    );
    expect(m.techs.map((t) => t.name)).toEqual(['Bo', 'Ann', 'Former member']);
    expect(m.techs[1].perWeek).toEqual([{ aerialFt: 100, undergroundFt: 50 }, { aerialFt: 10, undergroundFt: 0 }]);
    expect(m.weekTotals[1]).toEqual({ aerialFt: 510, undergroundFt: 5 });
    expect(m.maxWeekFt).toBe(515);
    expect(m.grandTotalFt).toBe(665);
  });
});

describe('AI usage rollup', () => {
  it('totals per month and tech, current month last, average cost', () => {
    const months = ['2026-10-01', '2026-11-01'];
    const r = usageRollup(
      [
        { month: '2026-10-01', userId: 'u1', name: 'Ann', photos: 10, errors: 1, costUsd: 0.2 },
        { month: '2026-11-01', userId: 'u1', name: 'Ann', photos: 5, errors: 0, costUsd: 0.1 },
        { month: '2026-11-01', userId: 'u2', name: 'Bo', photos: 20, errors: 2, costUsd: 0.4 },
        { month: '2026-01-01', userId: 'u2', name: 'Bo', photos: 999, errors: 0, costUsd: 9 },
      ],
      months,
    );
    expect(r.current).toEqual({ photos: 25, errors: 2, costUsd: expect.closeTo(0.5, 6) });
    expect(r.techs.map((t) => [t.name, t.photos, t.perMonth])).toEqual([
      ['Bo', 20, [0, 20]],
      ['Ann', 15, [10, 5]],
    ]);
    expect(r.avgCostPerPhoto).toBeCloseTo(0.7 / 35, 6);
    expect(usageRollup([], months).avgCostPerPhoto).toBeNull();
  });
});

describe('meters', () => {
  it('quota levels', () => {
    expect(quotaState(10, 100)).toEqual({ pct: 0.1, level: 'ok', remaining: 90 });
    expect(quotaState(85, 100).level).toBe('warn');
    expect(quotaState(100, 100).level).toBe('full');
    expect(quotaState(3, 0).level).toBe('full');
  });
  it('seats', () => {
    expect(seatState(4, 1, 5)).toMatchObject({ free: 1, full: false, overInvited: false });
    expect(seatState(4, 3, 5)).toMatchObject({ overInvited: true });
    expect(seatState(5, 0, 5)).toMatchObject({ full: true, pct: 1 });
  });
  it('month-end forecast', () => {
    // 10 days and 12 hours into a 30-day month with 105 used -> 300.
    expect(projectMonthEnd(105, Date.parse('2026-11-11T12:00:00Z'))).toBe(300);
    expect(projectMonthEnd(7, Date.parse('2026-11-01T05:00:00Z'))).toBe(7);
  });
  it('qc counts', () => {
    expect(qcCounts([{ severity: 'error', message: 'a' }, { severity: 'warning', message: 'b' }, { severity: 'warning', message: 'c' }])).toEqual({ errors: 1, warnings: 2, total: 3 });
  });
});

describe('projects table', () => {
  const base: ProjectSummary = {
    id: '1', name: 'Main St', client: 'Big Telco', jobNumber: 'J-1', workType: 'aerial', status: 'active', createdAt: T, lastUpdatedAt: '2026-11-02T00:00:00Z',
    nodeCount: 5, spanCount: 4, aerialFt: 100, undergroundFt: 0, totalFt: 100, editors: [{ userId: 'u', name: 'Tess Tech' }],
  };
  const list: ProjectSummary[] = [
    base,
    { ...base, id: '2', name: 'Oak Rd', client: 'City', jobNumber: 'C-9', status: 'complete', totalFt: 900, lastUpdatedAt: '2026-11-05T00:00:00Z', editors: [] },
    { ...base, id: '3', name: 'Pine', client: 'Big Telco', jobNumber: 'J-2', totalFt: 50, lastUpdatedAt: '2026-10-01T00:00:00Z', editors: [] },
  ];
  it('filters by status and searches name, client, job number and tech', () => {
    expect(filterProjects(list, '', 'active').map((p) => p.id)).toEqual(['1', '3']);
    expect(filterProjects(list, 'c-9', 'all').map((p) => p.id)).toEqual(['2']);
    expect(filterProjects(list, 'tess', 'all').map((p) => p.id)).toEqual(['1']);
    expect(filterProjects(list, 'big telco', 'all')).toHaveLength(2);
  });
  it('sorts by numbers and text both ways', () => {
    expect(sortProjects(list, 'totalFt', 'desc').map((p) => p.id)).toEqual(['2', '1', '3']);
    expect(sortProjects(list, 'name', 'asc').map((p) => p.name)).toEqual(['Main St', 'Oak Rd', 'Pine']);
    expect(sortProjects(list, 'lastUpdatedAt', 'desc')[0].id).toBe('2');
  });
});

describe('activity sentences', () => {
  const e: ActivityEntry = {
    id: 1, at: T, actorId: 'u', actorName: 'Tess Tech', table: 'nodes', rowId: 'n', action: 'update',
    changedKeys: ['lat', 'lng', 'client_updated_at', 'fields'], projectId: 'p', projectName: 'Main', rowLabel: 'P-12', nodeType: 'splice_case',
  };
  it('describes an edit with readable changed fields', () => {
    expect(describeActivity(e)).toEqual({ who: 'Tess Tech', verb: 'edited', what: 'splice case P-12', detail: 'position, fields' });
  });
  it('handles deletes, spans and former members', () => {
    expect(describeActivity({ ...e, action: 'soft_delete', table: 'spans', rowLabel: null, nodeType: null, actorName: null })).toEqual({
      who: 'A former member',
      verb: 'deleted',
      what: 'a span',
      detail: null,
    });
  });
});
