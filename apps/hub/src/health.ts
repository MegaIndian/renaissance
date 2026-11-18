/**
 * What the container health check reads besides "the process answers": whether the hub's own
 * database took its last write. The runner's minute tick (the cache sweep) is that write; a
 * read-only volume or a full disk turns `/health` to 503 so the container restarts and the
 * problem is seen, instead of every route answering "Jellyfin unreachable" for days.
 */
export interface HealthState {
  readonly database: { ok: boolean; error?: string; checkedAt?: string };
  markDatabase(ok: boolean, error?: string, now?: Date): void;
}

export function createHealthState(): HealthState {
  const database: { ok: boolean; error?: string; checkedAt?: string } = { ok: true };
  return {
    database,
    markDatabase(ok, error, now = new Date()) {
      database.ok = ok;
      database.checkedAt = now.toISOString();
      if (ok) delete database.error;
      else database.error = error ?? 'write failed';
    },
  };
}
