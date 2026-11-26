import type { DatabaseSync } from 'node:sqlite';

import { cacheStore } from './cache.js';
import { openDatabase } from './database.js';
import { profileStore } from './profiles.js';
import { requestStore } from './requests.js';

/**
 * The household database's stores that F61 uses. The schema (database.ts) also holds the
 * collection, rules and usage tables; their stores arrive with F86, F80 and F76.
 */
export interface Stores {
  db: DatabaseSync;
  profiles: ReturnType<typeof profileStore>;
  requests: ReturnType<typeof requestStore>;
  cache: ReturnType<typeof cacheStore>;
  close(): void;
}

export function createStores(path: string): Stores {
  const db = openDatabase(path);
  return {
    db,
    profiles: profileStore(db),
    requests: requestStore(db),
    cache: cacheStore(db),
    close: () => db.close(),
  };
}

export { DatabaseUnavailableError, migrations, migrate, openDatabase } from './database.js';
export { lastRequestedAt } from './requests.js';
export type { RequestUpdate } from './requests.js';
