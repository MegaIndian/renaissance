/**
 * The household database (ADR 0009): one SQLite file through `node:sqlite`, no native build step, so
 * the Alpine image needs nothing extra. Migrations are code, run in order at start, each once.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const migrations: readonly string[] = [
  `
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    mode TEXT NOT NULL DEFAULT 'simple' CHECK (mode IN ('simple', 'advanced')),
    language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'gu')),
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE TABLE collection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile TEXT NOT NULL REFERENCES profiles(id),
    item TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('track', 'album')),
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    added_by TEXT NOT NULL,
    added_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('request', 'add', 'import', 'favourite')),
    UNIQUE (profile, item)
  );
  CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('track', 'album')),
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    recording_id TEXT,
    release_group_id TEXT,
    release_id TEXT,
    artist_id TEXT,
    duration REAL,
    requested_by TEXT NOT NULL REFERENCES profiles(id),
    status TEXT NOT NULL,
    reason TEXT,
    detail TEXT,
    progress_done INTEGER,
    progress_total INTEGER,
    steps TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX requests_by_profile ON requests (requested_by, seq DESC);
  CREATE TABLE rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile TEXT NOT NULL REFERENCES profiles(id),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE usage (
    profile TEXT NOT NULL,
    day TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (profile, day)
  );
  CREATE TABLE cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  // 2: the downloaded file's Soulseek path, so a failed import can be retried without a new download.
  `ALTER TABLE requests ADD COLUMN source_file TEXT;`,
];

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

/** Applies every migration past the stored version; returns how many ran. */
export function migrate(db: DatabaseSync): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as
    { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  let ran = 0;
  while (version < migrations.length) {
    const sql = migrations[version];
    if (sql === undefined) break;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      version += 1;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    ran += 1;
  }
  return ran;
}
