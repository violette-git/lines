/// <reference types="jest" />
import { MIGRATIONS, runMigrations, type MigrationDb } from '@/data/migrations';
import {
  NODE_COLUMNS,
  PHOTO_COLUMNS,
  PROJECT_COLUMNS,
  SPAN_COLUMNS,
  TEMPLATE_COLUMNS,
  nodeParams,
  parseJson,
  photoParams,
  projectParams,
  rowToNode,
  rowToPhoto,
  rowToProject,
  rowToSpan,
  rowToTemplate,
  spanParams,
  templateParams,
  upsertSql,
} from '@/data/rowMapping';
import { buildDemoSeed } from '@/data/demoSeed';
import type { PhotoRef } from '@/domain/types';

const zip = <T>(cols: string[], vals: unknown[]) => Object.fromEntries(cols.map((c, i) => [c, vals[i]])) as T;

describe('row mapping round trips', () => {
  const seed = buildDemoSeed();

  test('project', () => {
    const p = { ...seed.projects[0], ratePerNode: null };
    expect(rowToProject(zip(PROJECT_COLUMNS, projectParams(p)))).toEqual(p);
  });

  test('node with JSON fields, aiMeta and position', () => {
    for (const n of seed.nodes) expect(rowToNode(zip(NODE_COLUMNS, nodeParams(n)))).toEqual(n);
  });

  test('span', () => {
    for (const s of seed.spans) expect(rowToSpan(zip(SPAN_COLUMNS, spanParams(s)))).toEqual(s);
  });

  test('photo with and without fix', () => {
    const base: PhotoRef = {
      id: 'ph', nodeId: 'n', projectId: 'p', uri: 'file:///a.jpg', watermarkedUri: null, width: 4032, height: 3024,
      takenAt: '2026-11-12T00:00:00Z', fix: null, isPrimary: true,
    };
    expect(rowToPhoto(zip(PHOTO_COLUMNS, photoParams(base)))).toEqual(base);
    const withFix = { ...base, isPrimary: false, watermarkedUri: 'file:///a_wm.jpg', fix: seed.nodes[0].position };
    expect(rowToPhoto(zip(PHOTO_COLUMNS, photoParams(withFix)))).toEqual(withFix);
  });

  test('template', () => {
    const t = seed.templates[0];
    expect(rowToTemplate(zip(TEMPLATE_COLUMNS, templateParams(t)))).toEqual(t);
  });

  test('corrupt JSON falls back', () => {
    expect(parseJson('{bad', { ok: 1 })).toEqual({ ok: 1 });
    const n = seed.nodes[0];
    const row = zip<Record<string, unknown>>(NODE_COLUMNS, nodeParams(n));
    const back = rowToNode({ ...(row as any), fields: '{bad', position: 'nope' });
    expect(back.fields).toEqual({});
    expect(back.position.lat).toBe(n.position.lat);
  });

  test('upsert SQL uses ON CONFLICT DO UPDATE (not INSERT OR REPLACE, which would fire cascades)', () => {
    const sql = upsertSql('nodes', NODE_COLUMNS);
    expect(sql).toMatch(/^INSERT INTO nodes \(/);
    expect(sql).toMatch(/ON CONFLICT\(id\) DO UPDATE SET/);
    expect(sql).not.toMatch(/REPLACE/);
    expect(sql).not.toMatch(/id = excluded\.id/);
    expect((sql.match(/\?/g) ?? []).length).toBe(NODE_COLUMNS.length);
  });
});

describe('migration runner', () => {
  function fakeDb() {
    const executed: string[] = [];
    const versions: number[] = [];
    const db: MigrationDb = {
      execAsync: async (sql) => void executed.push(sql),
      getFirstAsync: async <T,>() => ({ v: versions.length ? Math.max(...versions) : null }) as T,
      runAsync: async (_sql, version) => void versions.push(version as number),
      withTransactionAsync: async (task) => task(),
    };
    return { db, executed, versions };
  }

  test('applies all migrations on a fresh database, then nothing', async () => {
    const { db, executed, versions } = fakeDb();
    expect(await runMigrations(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(versions).toEqual(MIGRATIONS.map((m) => m.version));
    expect(executed.some((s) => /CREATE TABLE IF NOT EXISTS nodes/.test(s))).toBe(true);
    expect(executed.some((s) => /ON DELETE CASCADE/.test(s))).toBe(true);
    expect(await runMigrations(db)).toEqual([]);
  });

  test('applies only newer migrations in order', async () => {
    const { db, versions } = fakeDb();
    await runMigrations(db);
    const top = Math.max(...MIGRATIONS.map((m) => m.version));
    const extra = [
      ...MIGRATIONS,
      { version: top + 2, description: 'd', statements: ['SELECT 4'] },
      { version: top + 1, description: 'c', statements: ['SELECT 3'] },
    ];
    expect(await runMigrations(db, extra)).toEqual([top + 1, top + 2]);
    expect(versions).toEqual([...MIGRATIONS.map((m) => m.version), top + 1, top + 2]);
  });

  test('migration versions are unique and increasing', () => {
    const v = MIGRATIONS.map((m) => m.version);
    expect(v).toEqual([...v].sort((a, b) => a - b));
    expect(new Set(v).size).toBe(v.length);
  });
});
