/// <reference types="jest" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { buildDemoSeed } from '@/data/demoSeed';
import type { MapNode, PhotoRef } from '@/domain/types';

import { base64ToBytes, dataUrlBytes } from '../base64';
import {
  fromServerNode,
  fromServerPhoto,
  fromServerProject,
  fromServerSpan,
  fromServerTemplate,
  isTombstone,
  photoStoragePath,
  toServerNode,
  toServerPhoto,
  toServerProject,
  toServerSpan,
  toServerTemplate,
  type ServerNodeRow,
  type ServerTable,
} from '../serverMapping';

const ORG = '0f000000-0000-4000-8000-000000000001';
const seed = buildDemoSeed();

/** Writable columns per table, read from the sync_push definition in 0002_sync.sql. */
function writableColumns(): Record<ServerTable, string[]> {
  const sql = readFileSync(join(__dirname, '../../../supabase/migrations/0002_sync.sql'), 'utf8');
  const block = sql.slice(sql.indexOf('v_cols jsonb := jsonb_build_object('), sql.indexOf('v_res jsonb'));
  const out = {} as Record<ServerTable, string[]>;
  const re = /'(client_templates|projects|nodes|spans|photos)', jsonb_build_array\(([^)]*)\)/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    out[m[1] as ServerTable] = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  return out;
}

describe('server mapping', () => {
  test('toServer* send exactly the columns sync_push writes (and no server-managed ones)', () => {
    const cols = writableColumns();
    const n = seed.nodes[0];
    const sent: Record<ServerTable, string[]> = {
      client_templates: Object.keys(toServerTemplate(seed.templates[0], ORG)),
      projects: Object.keys(toServerProject(seed.projects[0], ORG)),
      nodes: Object.keys(toServerNode(n, ORG)),
      spans: Object.keys(toServerSpan(seed.spans[0], ORG)),
      photos: Object.keys(
        toServerPhoto({ id: 'x', nodeId: n.id, projectId: n.projectId, uri: '', watermarkedUri: null, width: 1, height: 1, takenAt: n.createdAt, fix: null, isPrimary: true }, ORG),
      ),
    };
    for (const t of Object.keys(sent) as ServerTable[]) {
      expect(cols[t]?.length).toBeGreaterThan(5);
      expect([...sent[t]].sort()).toEqual([...cols[t]].sort());
    }
    for (const keys of Object.values(sent)) {
      for (const k of ['rev', 'updated_at', 'created_by', 'geom', 'sync_txid']) expect(keys).not.toContain(k);
    }
  });

  test('project round trip carries the company id', () => {
    const p = { ...seed.projects[0], ratePerNode: 4.5 };
    expect(fromServerProject({ ...toServerProject(p, ORG), rev: 3 })).toEqual({ ...p, orgId: ORG });
  });

  test('node round trip, including receiver details and the AI report', () => {
    for (const n of seed.nodes) expect(fromServerNode(toServerNode(n, ORG))).toEqual(n);
    const rtk: MapNode = {
      ...seed.nodes[0],
      position: { ...seed.nodes[0].position, source: 'external', fixQuality: 'rtk_fixed', hdop: 0.6, satellites: 21, receiver: 'Emlid RS3' },
      aiReport: { summary: 'Wood pole', warnings: ['Lean'], detectedType: 'pole', typeConfidence: 0.9, model: 'm', analyzedAt: '2026-11-12T10:00:00.000Z' },
    };
    const row = toServerNode(rtk, ORG);
    expect(row.position_extra).toEqual({ fixQuality: 'rtk_fixed', hdop: 0.6, satellites: 21, receiver: 'Emlid RS3' });
    expect(fromServerNode(row)).toEqual(rtk);
  });

  test('span, template and photo round trips', () => {
    for (const s of seed.spans) expect(fromServerSpan(toServerSpan(s, ORG))).toEqual(s);
    const t = seed.templates[0];
    expect(fromServerTemplate(toServerTemplate(t, ORG))).toEqual({ ...t, orgId: ORG });

    const ph: PhotoRef = {
      id: 'ph', nodeId: 'n', projectId: 'p', uri: 'file:///a.jpg', watermarkedUri: 'file:///a_wm.jpg', width: 2048,
      height: 1536, takenAt: '2026-11-12T10:00:00.000Z', fix: seed.nodes[0].position, isPrimary: true,
      updatedAt: '2026-11-12T11:00:00.000Z', storagePath: photoStoragePath(ORG, 'p', 'ph'),
    };
    const row = toServerPhoto(ph, ORG);
    expect(row).toMatchObject({ storage_path: `${ORG}/p/ph.jpg`, watermarked_path: null, client_updated_at: ph.updatedAt });
    // The server has no local file: uri is empty until downloaded.
    expect(fromServerPhoto(row)).toEqual({
      ...ph, uri: '', watermarkedUri: null, watermarkedPath: null, uploadState: 'uploaded',
    });
    expect(photoStoragePath(ORG, 'p', 'ph', true)).toBe(`${ORG}/p/ph_wm.jpg`);
  });

  test('tombstones and device time', () => {
    const n = seed.nodes[0];
    const row = toServerNode({ ...n, updatedAt: '2026-11-12T12:00:00.000Z' }, ORG, { deletedAt: '2026-11-12T12:00:00.000Z' });
    expect(isTombstone(row)).toBe(true);
    expect(row.client_updated_at).toBe('2026-11-12T12:00:00.000Z');
    expect(isTombstone(toServerNode(n, ORG))).toBe(false);
  });

  test('values as Postgres sends them (numeric strings, +00:00 times, JSON text) are normalized', () => {
    const base = toServerNode(seed.nodes[0], ORG);
    const fromPg = {
      ...base,
      lat: '33.5186' as unknown as number,
      icon_scale: '1.50' as unknown as number,
      accuracy_m: null,
      created_at: '2026-11-12 10:00:00.123456+00',
      client_updated_at: '2026-11-12T11:00:00+00:00',
      fields: JSON.stringify({ pole_tag: 'T1' }) as unknown as ServerNodeRow['fields'],
      rev: 42,
    };
    const n = fromServerNode(fromPg);
    expect(n.position.lat).toBe(33.5186);
    expect(n.iconScale).toBe(1.5);
    expect(n.createdAt).toBe('2026-11-12T10:00:00.123Z');
    expect(n.updatedAt).toBe('2026-11-12T11:00:00.000Z');
    expect(n.fields).toEqual({ pole_tag: 'T1' });
  });

  test('values outside the server checks are clamped', () => {
    const n = toServerNode({ ...seed.nodes[0], iconScale: 9 }, ORG);
    expect(n.icon_scale).toBe(3);
    const s = toServerSpan({ ...seed.spans[0], sagPct: 250, slackFt: -3, lengthOverrideFt: -1 }, ORG);
    expect([s.sag_pct, s.slack_ft, s.length_override_ft]).toEqual([100, 0, 0]);
    expect(() => toServerProject(seed.projects[0], '')).toThrow(/company/);
  });
});

describe('base64', () => {
  test('decodes standard, url-safe and data URLs', () => {
    expect([...base64ToBytes('AAEC/w==')]).toEqual([0, 1, 2, 255]);
    expect([...base64ToBytes('AAEC_w')]).toEqual([0, 1, 2, 255]);
    expect([...dataUrlBytes('data:image/jpeg;base64,SGk=')!]).toEqual([72, 105]);
    expect(dataUrlBytes('file:///x.jpg')).toBeNull();
  });
});
