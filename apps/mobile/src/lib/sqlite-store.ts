/**
 * The library cache on a phone (F14): core's `LibraryStore` over SQLite, one database per server
 * and user (F86). One table per kind keyed by id with the item as JSON (core validates every record
 * when it reads), and a one-row meta table. Writes run in a transaction so a crash half-way leaves
 * the previous rows. `SqlDatabase` is the slice of expo-sqlite this needs, so tests run it on Node's
 * own SQLite.
 */
import type { CacheItem, CacheKind, LibraryMeta, PlatformLibraryStore } from '@renaissance/core';
import { LibraryMeta as LibraryMetaSchema } from '@renaissance/core';

export interface SqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: (string | number | null)[]): Promise<unknown>;
  getAllAsync<T>(source: string, params: (string | number | null)[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: (string | number | null)[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

const KINDS: readonly CacheKind[] = ['track', 'album', 'artist', 'playlist'];
/** Rows per INSERT: SQLite's default limit is 32,766 bound values; two per row stays well under. */
const CHUNK = 500;

export const SCHEMA = [
  'PRAGMA journal_mode = WAL;',
  ...KINDS.map(
    (k) => `CREATE TABLE IF NOT EXISTS ${k} (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);`,
  ),
  'CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);',
].join('\n');

function table(kind: CacheKind): CacheKind {
  if (!KINDS.includes(kind)) throw new Error(`unknown kind ${String(kind)}`);
  return kind;
}

export class SqliteLibraryStore implements PlatformLibraryStore {
  private ready: Promise<SqlDatabase>;

  constructor(open: () => Promise<SqlDatabase>) {
    this.ready = (async () => {
      const db = await open();
      await db.execAsync(SCHEMA);
      return db;
    })();
  }

  /** Resolves once the database is open; rejects when the platform refused it. */
  async opened(): Promise<void> {
    await this.ready;
  }

  async read(kind: CacheKind): Promise<CacheItem[]> {
    const db = await this.ready;
    const rows = await db.getAllAsync<{ json: string }>(`SELECT json FROM ${table(kind)}`, []);
    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row.json) as CacheItem];
      } catch {
        return [];
      }
    });
  }

  private async insert(
    db: SqlDatabase,
    kind: CacheKind,
    items: readonly CacheItem[],
  ): Promise<void> {
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      const values = chunk.map(() => '(?, ?)').join(', ');
      await db.runAsync(
        `INSERT OR REPLACE INTO ${table(kind)} (id, json) VALUES ${values}`,
        chunk.flatMap((item) => [item.id, JSON.stringify(item)]),
      );
    }
  }

  async write(kind: CacheKind, items: readonly CacheItem[]): Promise<void> {
    if (!items.length) return;
    const db = await this.ready;
    await db.withTransactionAsync(() => this.insert(db, kind, items));
  }

  async remove(kind: CacheKind, ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const db = await this.ready;
    await db.withTransactionAsync(async () => {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        await db.runAsync(
          `DELETE FROM ${table(kind)} WHERE id IN (${chunk.map(() => '?').join(', ')})`,
          [...chunk],
        );
      }
    });
  }

  async replace(kind: CacheKind, items: readonly CacheItem[]): Promise<void> {
    const db = await this.ready;
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM ${table(kind)}`, []);
      await this.insert(db, kind, items);
    });
  }

  async count(kind: CacheKind): Promise<number> {
    const db = await this.ready;
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table(kind)}`,
      [],
    );
    return row?.n ?? 0;
  }

  async readMeta(): Promise<LibraryMeta | null> {
    const db = await this.ready;
    const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM meta WHERE id = 1', []);
    if (!row) return null;
    try {
      const parsed = LibraryMetaSchema.safeParse(JSON.parse(row.json));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async writeMeta(meta: LibraryMeta): Promise<void> {
    const db = await this.ready;
    await db.runAsync('INSERT OR REPLACE INTO meta (id, json) VALUES (1, ?)', [
      JSON.stringify(meta),
    ]);
  }

  async clear(): Promise<void> {
    const db = await this.ready;
    await db.withTransactionAsync(async () => {
      for (const kind of [...KINDS, 'meta'] as const) await db.runAsync(`DELETE FROM ${kind}`, []);
    });
  }

  async close(): Promise<void> {
    await (await this.ready).closeAsync();
  }
}
