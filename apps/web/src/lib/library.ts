/**
 * The library on the web (F14): an IndexedDB `LibraryStore` per server and user, one in-memory
 * snapshot every screen reads, the instant search index over it, and the sync lifecycle (load from
 * disk, refresh from the server, refresh again on server pushes and every fifteen minutes). When the
 * browser refuses IndexedDB (a private window with site data blocked), core's `MemoryLibraryStore`
 * holds the library for the session instead, so the app still works; it is synced in full on every load.
 */
import { LibraryController, MemoryLibraryStore, libraryKey } from '@renaissance/core';
import type {
  Album,
  Artist,
  CacheItem,
  CacheKind,
  LibraryMeta,
  LibraryPlatform,
  LibraryStore,
  Playlist,
  ServerAdapter,
  Session,
  Track,
  UserDataChange,
} from '@renaissance/core';
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

import { debug } from './log';

interface LibrarySchema extends DBSchema {
  track: { key: string; value: Track };
  album: { key: string; value: Album };
  artist: { key: string; value: Artist };
  playlist: { key: string; value: Playlist };
  meta: { key: string; value: LibraryMeta };
}

/** A store the web app can hold: core's interface, plus `close` where the platform has one. */
export type WebLibraryStore = LibraryStore & { close?: () => Promise<void> };

/** One database per server and user, so switching users never shows someone else's favourites (F86). */
export class IndexedDbLibraryStore implements LibraryStore {
  private db: Promise<IDBPDatabase<LibrarySchema>>;

  constructor(readonly name: string) {
    // An async wrapper: `indexedDB` missing or a getter that throws becomes a rejection, not a throw.
    this.db = (async () =>
      openDB<LibrarySchema>(name, 1, {
        upgrade(db) {
          for (const kind of ['track', 'album', 'artist', 'playlist'] as const) {
            db.createObjectStore(kind, { keyPath: 'id' });
          }
          db.createObjectStore('meta');
        },
      }))();
  }

  /** Resolves once the database is open; rejects when the browser refuses storage. */
  async ready(): Promise<void> {
    await this.db;
  }

  async read(kind: CacheKind): Promise<CacheItem[]> {
    return (await this.db).getAll(kind);
  }

  async write(kind: CacheKind, items: readonly CacheItem[]): Promise<void> {
    const tx = (await this.db).transaction(kind, 'readwrite');
    await Promise.all([...items.map((item) => tx.store.put(item as never)), tx.done]);
  }

  async remove(kind: CacheKind, ids: readonly string[]): Promise<void> {
    const tx = (await this.db).transaction(kind, 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  }

  async replace(kind: CacheKind, items: readonly CacheItem[]): Promise<void> {
    const tx = (await this.db).transaction(kind, 'readwrite');
    await tx.store.clear();
    await Promise.all([...items.map((item) => tx.store.put(item as never)), tx.done]);
  }

  async count(kind: CacheKind): Promise<number> {
    return (await this.db).count(kind);
  }

  async readMeta(): Promise<LibraryMeta | null> {
    return (await (await this.db).get('meta', 'meta')) ?? null;
  }

  async writeMeta(meta: LibraryMeta): Promise<void> {
    await (await this.db).put('meta', meta, 'meta');
  }

  async clear(): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['track', 'album', 'artist', 'playlist', 'meta'], 'readwrite');
    await Promise.all([
      ...(['track', 'album', 'artist', 'playlist', 'meta'] as const).map((s) =>
        tx.objectStore(s).clear(),
      ),
      tx.done,
    ]);
  }

  async close(): Promise<void> {
    (await this.db).close();
  }
}

/**
 * Open this user's store: IndexedDB when the browser allows it, memory for the session when it does
 * not (`indexedDB` undefined, a getter that throws `SecurityError`, or an open that fails).
 */
export async function openLibraryStore(
  name: string,
): Promise<{ store: WebLibraryStore; persisted: boolean }> {
  try {
    const store = new IndexedDbLibraryStore(name);
    await store.ready();
    return { store, persisted: true };
  } catch {
    return { store: new MemoryLibraryStore(), persisted: false };
  }
}

/**
 * Remove a user's database from this browser (sign-out, F86). Safe when it does not exist, and when
 * the browser blocks storage altogether (there is nothing to remove).
 */
export function deleteLibrary(session: Session): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(dbName(session));
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

export type { LibraryState, SyncState } from '@renaissance/core';
export { PUSH_FETCH_LIMIT } from '@renaissance/core';

const CHANNEL = 'renaissance-library';

/** Other tabs of this browser signed in as the same user: a change there is a refresh here. */
function tabPeers(): NonNullable<LibraryPlatform['peers']> | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  let channel: BroadcastChannel | null = null;
  return {
    post: (key) => channel?.postMessage(key),
    listen: (key, onChange) => {
      const mine = new BroadcastChannel(CHANNEL);
      channel = mine;
      mine.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === key) onChange();
      };
      return () => {
        mine.close();
        if (channel === mine) channel = null;
      };
    },
  };
}

/**
 * The lifecycle lives in core (`LibraryController`); the web supplies IndexedDB, the browser's
 * `online` event and the BroadcastChannel to its other tabs.
 */
const peers = tabPeers();
const controller = new LibraryController({
  openStore: openLibraryStore,
  onResume: (listener) => {
    window.addEventListener('online', listener);
    return () => window.removeEventListener('online', listener);
  },
  ...(peers ? { peers } : {}),
  log: (where, error) => debug(where, error),
});

export const libraryStore = controller.state;

export function dbName(session: Session): string {
  return libraryKey(session);
}

/**
 * Refresh from the server; one at a time, later calls join the running one. A full rebuild asked for
 * while a delta runs follows it instead of being dropped (func AE).
 */
export function refreshLibrary(options: { full?: boolean } = {}): Promise<void> {
  return controller.refresh(options);
}

/** Called when the session changes: open this user's cache, show it, then refresh. */
export function startLibrary(adapter: ServerAdapter, session: Session): Promise<void> {
  return controller.start(adapter, session);
}

export function stopLibrary(): void {
  controller.stop();
}

/** Tell the other tabs of this browser, signed in as the same user, to refresh from the server. */
export function broadcastLibraryChange(): void {
  controller.broadcastChange();
}

/**
 * Apply a local change (favourite toggled, playlist renamed) to the snapshot and the disk cache at
 * once; see `LibraryController.patchItems`.
 */
export function patchItems<K extends CacheKind>(
  kind: K,
  update: (item: CacheItem) => CacheItem | null,
  options: { broadcast?: boolean } = {},
): void {
  controller.patchItems(kind, update, options);
}

/** What another device changed, from the server's push; see `LibraryController.applyUserDataChanges`. */
export function applyUserDataChanges(changes: UserDataChange[]): Promise<void> {
  return controller.applyUserDataChanges(changes);
}

/** Add brand-new items (a created playlist) to the snapshot and the cache. */
export function addItems(kind: CacheKind, items: CacheItem[]): void {
  controller.addItems(kind, items);
}
