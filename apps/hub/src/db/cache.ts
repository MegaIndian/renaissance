import type { DatabaseSync } from 'node:sqlite';

/** JSON values with a TTL, for catalogue answers and Jellyfin token checks. */
export function cacheStore(db: DatabaseSync) {
  const get = db.prepare('SELECT value FROM cache WHERE key = ? AND expires_at > ?');
  const put = db.prepare(
    'INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
  );
  const sweep = db.prepare('DELETE FROM cache WHERE expires_at <= ?');
  const del = db.prepare('DELETE FROM cache WHERE key = ?');
  return {
    get<T>(key: string, now = Date.now()): T | undefined {
      const row = get.get(key, now) as unknown as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    set(key: string, value: unknown, ttlMs: number, now = Date.now()): void {
      put.run(key, JSON.stringify(value), now + ttlMs);
    },
    delete(key: string): void {
      del.run(key);
    },
    sweep(now = Date.now()): void {
      sweep.run(now);
    },
  };
}
export type CacheStore = ReturnType<typeof cacheStore>;
