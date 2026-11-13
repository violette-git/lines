// Native Repository on expo-sqlite (async API). JSON columns hold fields/aiMeta/position/fix.
// Cascades use ON DELETE CASCADE with PRAGMA foreign_keys = ON; photo FILES are deleted manually.
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { PhotoStore, Repository } from '@/domain/contracts';
import { DEFAULT_SETTINGS, type AppSettings } from '@/domain/types';

import { runMigrations } from './migrations';
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
  type NodeRow,
  type PhotoRow,
  type ProjectRow,
  type SpanRow,
  type TemplateRow,
} from './rowMapping';

export const DB_NAME = 'linemap.db';
const SETTINGS_KEY = 'app';

const SQL = {
  upsertProject: upsertSql('projects', PROJECT_COLUMNS),
  upsertNode: upsertSql('nodes', NODE_COLUMNS),
  upsertSpan: upsertSql('spans', SPAN_COLUMNS),
  upsertPhoto: upsertSql('photos', PHOTO_COLUMNS),
  upsertTemplate: upsertSql('templates', TEMPLATE_COLUMNS),
};

export class SqliteRepository implements Repository {
  private dbPromise: Promise<SQLiteDatabase> | null = null;

  constructor(
    private readonly photoStore: PhotoStore | null = null,
    private readonly dbName: string = DB_NAME,
  ) {}

  private db(): Promise<SQLiteDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const db = await openDatabaseAsync(this.dbName);
        // PRAGMAs must run outside transactions, per connection.
        await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
        await runMigrations(db);
        return db;
      })();
      this.dbPromise.catch(() => {
        this.dbPromise = null; // allow retry after a failed open
      });
    }
    return this.dbPromise;
  }

  async init(): Promise<void> {
    await this.db();
  }

  private async removeFiles(rows: { uri: string; watermarked_uri: string | null }[]) {
    if (!this.photoStore) return;
    for (const r of rows) {
      await this.photoStore.remove(r.uri).catch(() => undefined);
      if (r.watermarked_uri) await this.photoStore.remove(r.watermarked_uri).catch(() => undefined);
    }
  }

  // ---------- projects ----------
  async listProjects() {
    const db = await this.db();
    const rows = await db.getAllAsync<ProjectRow>('SELECT * FROM projects ORDER BY updated_at DESC');
    return rows.map(rowToProject);
  }

  async getProject(id: string) {
    const db = await this.db();
    const r = await db.getFirstAsync<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id]);
    return r ? rowToProject(r) : null;
  }

  async upsertProject(p: Parameters<Repository['upsertProject']>[0]) {
    const db = await this.db();
    await db.runAsync(SQL.upsertProject, projectParams(p));
  }

  async deleteProject(id: string) {
    const db = await this.db();
    const files = await db.getAllAsync<{ uri: string; watermarked_uri: string | null }>(
      'SELECT uri, watermarked_uri FROM photos WHERE project_id = ?',
      [id],
    );
    await db.withTransactionAsync(async () => {
      // Explicit deletes in dependency order (cascades would cover this; being explicit protects
      // databases opened without foreign_keys).
      await db.runAsync('DELETE FROM photos WHERE project_id = ?', [id]);
      await db.runAsync('DELETE FROM spans WHERE project_id = ?', [id]);
      await db.runAsync('DELETE FROM nodes WHERE project_id = ?', [id]);
      await db.runAsync('DELETE FROM projects WHERE id = ?', [id]);
    });
    await this.removeFiles(files);
  }

  // ---------- nodes ----------
  async listNodes(projectId: string) {
    const db = await this.db();
    const rows = await db.getAllAsync<NodeRow>('SELECT * FROM nodes WHERE project_id = ? ORDER BY seq ASC', [projectId]);
    return rows.map(rowToNode);
  }

  async getNode(id: string) {
    const db = await this.db();
    const r = await db.getFirstAsync<NodeRow>('SELECT * FROM nodes WHERE id = ?', [id]);
    return r ? rowToNode(r) : null;
  }

  async upsertNode(n: Parameters<Repository['upsertNode']>[0]) {
    const db = await this.db();
    await db.runAsync(SQL.upsertNode, nodeParams(n));
  }

  async deleteNode(id: string) {
    const db = await this.db();
    const files = await db.getAllAsync<{ uri: string; watermarked_uri: string | null }>(
      'SELECT uri, watermarked_uri FROM photos WHERE node_id = ?',
      [id],
    );
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM photos WHERE node_id = ?', [id]);
      await db.runAsync('DELETE FROM spans WHERE from_node_id = ? OR to_node_id = ?', [id, id]);
      await db.runAsync('UPDATE nodes SET possible_duplicate_of = NULL WHERE possible_duplicate_of = ?', [id]);
      await db.runAsync('DELETE FROM nodes WHERE id = ?', [id]);
    });
    await this.removeFiles(files);
  }

  // ---------- spans ----------
  async listSpans(projectId: string) {
    const db = await this.db();
    const rows = await db.getAllAsync<SpanRow>('SELECT * FROM spans WHERE project_id = ? ORDER BY created_at ASC', [projectId]);
    return rows.map(rowToSpan);
  }

  async upsertSpan(s: Parameters<Repository['upsertSpan']>[0]) {
    const db = await this.db();
    await db.runAsync(SQL.upsertSpan, spanParams(s));
  }

  async deleteSpan(id: string) {
    const db = await this.db();
    await db.runAsync('DELETE FROM spans WHERE id = ?', [id]);
  }

  // ---------- photos ----------
  async listPhotos(projectId: string) {
    const db = await this.db();
    const rows = await db.getAllAsync<PhotoRow>('SELECT * FROM photos WHERE project_id = ? ORDER BY taken_at ASC', [projectId]);
    return rows.map(rowToPhoto);
  }

  async upsertPhoto(p: Parameters<Repository['upsertPhoto']>[0]) {
    const db = await this.db();
    await db.runAsync(SQL.upsertPhoto, photoParams(p));
  }

  async deletePhoto(id: string) {
    const db = await this.db();
    const files = await db.getAllAsync<{ uri: string; watermarked_uri: string | null }>(
      'SELECT uri, watermarked_uri FROM photos WHERE id = ?',
      [id],
    );
    await db.runAsync('DELETE FROM photos WHERE id = ?', [id]);
    await this.removeFiles(files);
  }

  // ---------- templates ----------
  async listTemplates() {
    const db = await this.db();
    const rows = await db.getAllAsync<TemplateRow>('SELECT * FROM templates ORDER BY name COLLATE NOCASE ASC');
    return rows.map(rowToTemplate);
  }

  async upsertTemplate(t: Parameters<Repository['upsertTemplate']>[0]) {
    const db = await this.db();
    await db.runAsync(SQL.upsertTemplate, templateParams(t));
  }

  async deleteTemplate(id: string) {
    const db = await this.db();
    await db.withTransactionAsync(async () => {
      await db.runAsync('UPDATE projects SET template_id = NULL WHERE template_id = ?', [id]);
      await db.runAsync('DELETE FROM templates WHERE id = ?', [id]);
    });
  }

  // ---------- settings ----------
  async getSettings(): Promise<AppSettings> {
    const db = await this.db();
    const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [SETTINGS_KEY]);
    return { ...DEFAULT_SETTINGS, ...parseJson<Partial<AppSettings>>(r?.value, {}) };
  }

  async saveSettings(s: AppSettings) {
    const db = await this.db();
    await db.runAsync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [SETTINGS_KEY, JSON.stringify(s)],
    );
  }
}
