// SQLite schema and migration runner. Each migration runs once, in order, inside a transaction,
// and records its version in schema_version. To change the schema, APPEND a new migration; never
// edit one that has shipped.

export interface Migration {
  version: number;
  description: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        client TEXT NOT NULL DEFAULT '',
        job_number TEXT NOT NULL DEFAULT '',
        work_type TEXT NOT NULL DEFAULT 'mixed',
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        rate_per_foot REAL,
        rate_per_node REAL,
        template_id TEXT,
        walk_mode INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        position TEXT NOT NULL,
        fields TEXT NOT NULL DEFAULT '{}',
        ai_meta TEXT NOT NULL DEFAULT '{}',
        icon_scale REAL NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft',
        notes TEXT NOT NULL DEFAULT '',
        possible_duplicate_of TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id, seq)`,
      `CREATE TABLE IF NOT EXISTS spans (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        from_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        to_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        slack_ft REAL NOT NULL DEFAULT 0,
        sag_pct REAL NOT NULL DEFAULT 0,
        length_override_ft REAL,
        fields TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_spans_project ON spans(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_spans_from ON spans(from_node_id)`,
      `CREATE INDEX IF NOT EXISTS idx_spans_to ON spans(to_node_id)`,
      `CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY NOT NULL,
        node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        uri TEXT NOT NULL,
        watermarked_uri TEXT,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        taken_at TEXT NOT NULL,
        fix TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_photos_node ON photos(node_id)`,
      `CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        client TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    description: 'Store the last AI analysis report per node',
    statements: [`ALTER TABLE nodes ADD COLUMN ai_report TEXT`],
  },
];

/** The subset of expo-sqlite's SQLiteDatabase the runner needs (keeps it testable). */
export interface MigrationDb {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string, ...params: (string | number | null)[]): Promise<T | null>;
  runAsync(source: string, ...params: (string | number | null)[]): Promise<unknown>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export async function getSchemaVersion(db: MigrationDb): Promise<number> {
  await db.execAsync('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL)');
  const row = await db.getFirstAsync<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_version');
  return row?.v ?? 0;
}

/** Applies pending migrations in version order. Returns the versions applied. */
export async function runMigrations(db: MigrationDb, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  const current = await getSchemaVersion(db);
  const pending = [...migrations].filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  const applied: number[] = [];
  for (const m of pending) {
    await db.withTransactionAsync(async () => {
      for (const sql of m.statements) await db.execAsync(sql);
      await db.runAsync('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', m.version, new Date().toISOString());
    });
    applied.push(m.version);
  }
  return applied;
}
