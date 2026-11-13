jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { mapActivity, mapOverview, mapProjectSummary, mapUsage, withPhotoUrls } from '../api';
import { createFixtureApi, FIXTURE_ORG_ID } from '../fixtures';
import { inviteLink, webPathForNative } from '../links';
import { footageFromData } from '../shaping';


describe('row mapping (RPC rows to dashboard types)', () => {
  it('coerces numeric strings and nulls', () => {
    const o = mapOverview({ footage_week_ft: '1234.5', nodes_total: 7, ai_photos_month: null, seat_limit: '10', ai_quota: 3000 });
    expect(o.footageWeekFt).toBe(1234.5);
    expect(o.aiPhotosMonth).toBeNull();
    expect(o.seatLimit).toBe(10);
    expect(o.members).toBe(0);
  });
  it('maps project summaries with editors', () => {
    const p = mapProjectSummary({ id: 'x', name: 'N', aerial_ft: '10.5', underground_ft: 2, total_ft: '12.5', editors: [{ user_id: 'u', name: null }], last_updated_at: 'T' });
    expect(p).toMatchObject({ aerialFt: 10.5, totalFt: 12.5, editors: [{ userId: 'u', name: null }], status: 'active', lastUpdatedAt: 'T' });
  });
  it('maps activity and usage', () => {
    expect(mapActivity({ id: '5', action: 'update', changed_keys: ['label'], table_name: 'nodes', actor: null }).changedKeys).toEqual(['label']);
    expect(mapUsage({ month: '2026-11-01T00:00:00Z', photo_count: '3', cost_usd_estimate: '0.05' })).toMatchObject({ month: '2026-11-01', photos: 3, costUsd: 0.05 });
  });
  it('swaps storage paths for signed urls', () => {
    const base = { id: 'p', nodeId: 'n', projectId: 'x', uri: '', watermarkedUri: null, width: 1, height: 1, takenAt: 'T', fix: null, isPrimary: true };
    const [a] = withPhotoUrls([{ ...base, storagePath: 'o/x/p.jpg', watermarkedPath: 'o/x/p_wm.jpg' }], { 'o/x/p.jpg': 'https://s/1', 'o/x/p_wm.jpg': 'https://s/2' });
    expect(a.uri).toBe('https://s/1');
    expect(a.watermarkedUri).toBe('https://s/2');
  });
});

describe('links', () => {
  it('invite link and native dashboard links never point at billing', () => {
    expect(inviteLink('ab c')).toMatch(/\/org\/join\?token=ab%20c$/);
    expect(webPathForNative('/admin/billing')).toBe('/admin');
    expect(webPathForNative('/admin/projects/123')).toBe('/admin/projects/123');
    expect(webPathForNative('/somewhere')).toBe('/admin');
  });
});

describe('fixture api', () => {
  it('serves consistent demo data', async () => {
    const api = createFixtureApi(Date.parse('2026-11-13T15:00:00Z'));
    const list = await api.projectSummaries(FIXTURE_ORG_ID);
    expect(list.length).toBeGreaterThanOrEqual(4);
    const first = await api.project(FIXTURE_ORG_ID, list[1].id);
    expect(first).not.toBeNull();
    const f = footageFromData(first!.nodes, first!.spans);
    expect(list[1].totalFt).toBeCloseTo(f.totalFt, 6);
    const ov = await api.overview(FIXTURE_ORG_ID);
    expect(ov.aiPhotosMonth).toBeGreaterThan(0);
    await expect(api.startCheckout({ orgId: FIXTURE_ORG_ID, plan: 'pro', interval: 'year', seats: 5 })).rejects.toThrow(/Fixture mode/);
  });
});
