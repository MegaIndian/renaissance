/**
 * The library on the web (F14): an IndexedDB `LibraryStore` per server and user, one in-memory
 * snapshot every screen reads, the instant search index over it, and the sync lifecycle (load from
 * disk, refresh from the server, refresh again on server pushes and every fifteen minutes).
 */
import {
  LibraryIndex,
  createStore,
  emptySnapshot,
  loadSnapshot,
  syncLibrary,
} from '@renaissance/core';
import type {
  Album,
  Artist,
  CacheItem,
  CacheKind,
  LibraryMeta,
  LibrarySnapshot,
  LibraryStore,
  Playlist,
  ServerAdapter,
  Session,
  SyncProgress,
  Track,
} from '@renaissance/core';
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

interface LibrarySchema extends DBSchema {
  track: { key: string; value: Track };
  album: { key: string; value: Album };
  artist: { key: string; value: Artist };
  playlist: { key: string; value: Playlist };
  meta: { key: string; value: LibraryMeta };
}

/** One database per server and user, so switching users never shows someone else's favourites (F86). */
export class IndexedDbLibraryStore implements LibraryStore {
  private db: Promise<IDBPDatabase<LibrarySchema>>;

  constructor(readonly name: string) {
    this.db = openDB<LibrarySchema>(name, 1, {
      upgrade(db) {
        for (const kind of ['track', 'album', 'artist', 'playlist'] as const) {
          db.createObjectStore(kind, { keyPath: 'id' });
        }
        db.createObjectStore('meta');
      },
    });
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

export interface SyncState {
  status: 'idle' | 'loading' | 'syncing' | 'error';
  progress: SyncProgress | null;
  mode: 'full' | 'delta' | null;
  error: string | null;
}

export interface LibraryState {
  snapshot: LibrarySnapshot;
  index: LibraryIndex;
  sync: SyncState;
  /** Set once the first read from disk (or the first sync) finished. */
  ready: boolean;
}

export const libraryStore = createStore<LibraryState>({
  snapshot: emptySnapshot,
  index: new LibraryIndex(),
  sync: { status: 'idle', progress: null, mode: null, error: null },
  ready: false,
});

const REFRESH_INTERVAL_MS = 15 * 60_000;

let active: {
  key: string;
  store: IndexedDbLibraryStore;
  adapter: ServerAdapter;
  session: Session;
  stop: () => void;
} | null = null;
let syncing: Promise<void> | null = null;

function setSnapshot(snapshot: LibrarySnapshot): void {
  libraryStore.set((s) => ({
    ...s,
    snapshot,
    index: new LibraryIndex(snapshot),
    ready: true,
  }));
}

function patchSync(patch: Partial<SyncState>): void {
  libraryStore.set((s) => ({ ...s, sync: { ...s.sync, ...patch } }));
}

export function dbName(session: Session): string {
  return `renaissance-library-${session.server.id}-${session.userId}`.replace(/[^\w.-]/g, '_');
}

/** Refresh from the server; one at a time, later calls join the running one. */
export function refreshLibrary(options: { full?: boolean } = {}): Promise<void> {
  const current = active;
  if (!current) return Promise.resolve();
  if (syncing) return syncing;
  patchSync({ status: 'syncing', error: null, progress: null });
  syncing = syncLibrary(current.adapter.library(current.session), current.store, {
    ...(options.full ? { full: true } : {}),
    onProgress: (progress) => patchSync({ progress }),
  })
    .then((result) => {
      if (active !== current) return;
      setSnapshot(result.snapshot);
      patchSync({ status: 'idle', progress: null, mode: result.mode });
    })
    .catch((error: unknown) => {
      if (active !== current) return;
      patchSync({
        status: 'error',
        progress: null,
        error: error instanceof Error ? error.message : String(error),
      });
      libraryStore.set((s) => ({ ...s, ready: true }));
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

/** Called when the session changes: open this user's cache, show it, then refresh. */
export async function startLibrary(adapter: ServerAdapter, session: Session): Promise<void> {
  const key = dbName(session);
  if (active?.key === key) return;
  stopLibrary();
  const store = new IndexedDbLibraryStore(key);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refreshLibrary(), 2000);
  };
  const unsubscribe = adapter.subscribe(session, {
    onLibraryChanged: schedule,
    onUserDataChanged: schedule,
  });
  const interval = setInterval(() => void refreshLibrary(), REFRESH_INTERVAL_MS);
  const onOnline = (): void => void refreshLibrary();
  window.addEventListener('online', onOnline);
  active = {
    key,
    store,
    adapter,
    session,
    stop: () => {
      unsubscribe();
      clearInterval(interval);
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      void store.close();
    },
  };
  patchSync({ status: 'loading', progress: null, error: null });
  try {
    const snapshot = await loadSnapshot(store);
    if (active?.key !== key) return;
    setSnapshot(snapshot);
  } catch {
    /* an unreadable cache is rebuilt by the sync below */
  }
  await refreshLibrary();
}

export function stopLibrary(): void {
  active?.stop();
  active = null;
  syncing = null;
  libraryStore.set({
    snapshot: emptySnapshot,
    index: new LibraryIndex(),
    sync: { status: 'idle', progress: null, mode: null, error: null },
    ready: false,
  });
}

/** Apply a local change (favourite toggled, playlist renamed) to the snapshot and the disk cache at once. */
export function patchItems<K extends CacheKind>(
  kind: K,
  update: (item: CacheItem) => CacheItem | null,
): void {
  const state = libraryStore.get();
  const listKey = { track: 'tracks', album: 'albums', artist: 'artists', playlist: 'playlists' }[
    kind
  ] as 'tracks' | 'albums' | 'artists' | 'playlists';
  const changed: CacheItem[] = [];
  const removed: string[] = [];
  const next = (state.snapshot[listKey] as CacheItem[]).flatMap((item) => {
    const result = update(item);
    if (result === item) return [item];
    if (result === null) {
      removed.push(item.id);
      return [];
    }
    changed.push(result);
    return [result];
  });
  if (!changed.length && !removed.length) return;
  const snapshot = { ...state.snapshot, [listKey]: next } as LibrarySnapshot;
  if (kind === 'artist') {
    const ids = new Set(state.snapshot.albumArtists.map((a) => a.id));
    snapshot.albumArtists = snapshot.artists.filter((a) => ids.has(a.id));
  }
  setSnapshot(snapshot);
  if (active) {
    if (changed.length) void active.store.write(kind, changed).catch(() => undefined);
    if (removed.length) void active.store.remove(kind, removed).catch(() => undefined);
  }
}

/** Add brand-new items (a created playlist) to the snapshot and the cache. */
export function addItems(kind: CacheKind, items: CacheItem[]): void {
  const state = libraryStore.get();
  const listKey = { track: 'tracks', album: 'albums', artist: 'artists', playlist: 'playlists' }[
    kind
  ] as 'tracks' | 'albums' | 'artists' | 'playlists';
  const existing = new Set((state.snapshot[listKey] as CacheItem[]).map((i) => i.id));
  const fresh = [
    ...new Map(items.filter((i) => !existing.has(i.id)).map((i) => [i.id, i])).values(),
  ];
  if (!fresh.length) return;
  setSnapshot({
    ...state.snapshot,
    [listKey]: [...(state.snapshot[listKey] as CacheItem[]), ...fresh],
  } as LibrarySnapshot);
  if (active) void active.store.write(kind, fresh).catch(() => undefined);
}
