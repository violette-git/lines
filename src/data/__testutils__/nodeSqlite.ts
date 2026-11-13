// TEST ONLY. Wraps Node's built-in SQLite (node:sqlite, Node 22.5+) in the small slice of the
// expo-sqlite async API that SqliteRepository uses, so the real SQL can run under Jest.
import type { RepoDb } from '../sqliteRepository';

type Bind = string | number | null;
interface NodeStatement {
  run(...p: Bind[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...p: Bind[]): unknown[];
  get(...p: Bind[]): unknown;
}
interface NodeDb {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
}

export function nodeSqliteAvailable(): boolean {
  try {
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

export function createNodeSqliteDb(): RepoDb & { raw: NodeDb } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDb };
  const d = new DatabaseSync(':memory:');
  const norm = (params: unknown[]): Bind[] =>
    (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as Bind[];
  const plain = <T,>(r: unknown) => (r == null ? null : ({ ...(r as object) } as T));
  const db = {
    raw: d,
    async execAsync(sql: string) {
      d.exec(sql);
    },
    async runAsync(sql: string, ...params: unknown[]) {
      const r = d.prepare(sql).run(...norm(params));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]) {
      return d.prepare(sql).all(...norm(params)).map((r) => plain<T>(r) as T);
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]) {
      return plain<T>(d.prepare(sql).get(...norm(params)));
    },
    async withTransactionAsync(task: () => Promise<void>) {
      d.exec('BEGIN');
      try {
        await task();
        d.exec('COMMIT');
      } catch (e) {
        d.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db as unknown as RepoDb & { raw: NodeDb };
}
