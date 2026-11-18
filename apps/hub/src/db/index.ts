import type { DatabaseSync } from 'node:sqlite';

import { cacheStore } from './cache.js';
import { collectionStore } from './collection.js';
import { openDatabase } from './database.js';
import { profileStore } from './profiles.js';
import { requestStore } from './requests.js';
import { ruleStore } from './rules.js';
import { usageStore } from './usage.js';

export interface Stores {
  db: DatabaseSync;
  profiles: ReturnType<typeof profileStore>;
  collection: ReturnType<typeof collectionStore>;
  requests: ReturnType<typeof requestStore>;
  rules: ReturnType<typeof ruleStore>;
  usage: ReturnType<typeof usageStore>;
  cache: ReturnType<typeof cacheStore>;
  close(): void;
}

export function createStores(path: string): Stores {
  const db = openDatabase(path);
  return {
    db,
    profiles: profileStore(db),
    collection: collectionStore(db),
    requests: requestStore(db),
    rules: ruleStore(db),
    usage: usageStore(db),
    cache: cacheStore(db),
    close: () => db.close(),
  };
}

export { migrations, migrate, openDatabase } from './database.js';
export type { NewCollectionItem } from './collection.js';
export type { RequestUpdate } from './requests.js';
export type { UsageSample } from './usage.js';
