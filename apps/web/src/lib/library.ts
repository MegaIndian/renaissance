/**
 * The library on the web (F14): an IndexedDB `LibraryStore` per server and user, one in-memory
 * snapshot every screen reads, the instant search index over it, and the sync lifecycle (load from
 * disk, refresh from the server, refresh again on server pushes and every fifteen minutes). When the
 * browser refuses IndexedDB (a private window with site data blocked), core's `MemoryLibraryStore`
 * holds the library for the session instead, so the app still works; it is synced in full on every load.
 */
import {
  LibraryIndex,
  MemoryLibraryStore,
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
  UserDataChange,
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
  /** False when the browser refused IndexedDB and the library lives in memory for this session. */
  persisted: boolean;
}

export const libraryStore = createStore<LibraryState>({
  snapshot: emptySnapshot,
  index: new LibraryIndex(),
  sync: { status: 'idle', progress: null, mode: null, error: null },
  ready: false,
  persisted: true,
});

const REFRESH_INTERVAL_MS = 15 * 60_000;
/** After a failed refresh: 30 s, then doubling to five minutes, until one succeeds. */
const RETRY_FIRST_MS = 30_000;
const RETRY_MAX_MS = 5 * 60_000;
const CHANNEL = 'renaissance-library';

let active: {
  key: string;
  store: WebLibraryStore;
  adapter: ServerAdapter;
  session: Session;
  stop: () => void;
  /** Ask the other tabs of this browser to refresh too (a heart in one tab shows in the other). */
  broadcast: () => void;
  retry: (ms: number) => void;
} | null = null;
let syncing: Promise<void> | null = null;
/**
 * Local patches made while a sync is in flight. The sync built its snapshot from a read that began
 * before the patch, so each is replayed on the result before it is shown (a heart tapped during a
 * delta stays a heart).
 */
let pendingPatches: { kind: CacheKind; update: (item: CacheItem) => CacheItem | null }[] = [];
let retryDelay = RETRY_FIRST_MS;
/** Bumped by every start and stop, so a start that lost the race while opening its store gives up. */
let generation = 0;

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
      retryDelay = RETRY_FIRST_MS;
      let snapshot = result.snapshot;
      for (const patch of pendingPatches) {
        const applied = applyPatch(snapshot, patch.kind, patch.update);
        snapshot = applied.snapshot;
        // The disk copy may hold the server's row from the sync; the patch is the newer truth.
        if (applied.changed.length) {
          void current.store.write(patch.kind, applied.changed).catch(() => undefined);
        }
      }
      pendingPatches = [];
      setSnapshot(snapshot);
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
      // An outage does not wait for the fifteen-minute timer: try again soon, backing off.
      current.retry(retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    })
    .finally(() => {
      syncing = null;
      pendingPatches = [];
    });
  return syncing;
}

/** Called when the session changes: open this user's cache, show it, then refresh. */
export async function startLibrary(adapter: ServerAdapter, session: Session): Promise<void> {
  const key = dbName(session);
  if (active?.key === key) return;
  stopLibrary();
  const mine = ++generation;
  patchSync({ status: 'loading', progress: null, error: null });
  const { store, persisted } = await openLibraryStore(key);
  if (mine !== generation) {
    void store.close?.().catch(() => undefined);
    return;
  }
  libraryStore.set((s) => ({ ...s, persisted }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay = 2000): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refreshLibrary(), delay);
  };
  const unsubscribe = adapter.subscribe(session, {
    onLibraryChanged: () => schedule(),
    onUserDataChanged: (changes) => {
      // The push names the items: patch them now. The delta that follows cannot see a favourite
      // or a play on 10.10.7 (ADR 0012), so this is how another device's heart reaches this one.
      void applyUserDataChanges(changes).catch(() => undefined);
      schedule();
    },
  });
  const interval = setInterval(() => void refreshLibrary(), REFRESH_INTERVAL_MS);
  const onOnline = (): void => void refreshLibrary();
  window.addEventListener('online', onOnline);
  // Other tabs of this browser signed in as the same user: a change there is a refresh here.
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  if (channel) {
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === key) schedule(500);
    };
  }
  active = {
    key,
    store,
    adapter,
    session,
    broadcast: () => channel?.postMessage(key),
    retry: (ms) => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void refreshLibrary(), ms);
    },
    stop: () => {
      unsubscribe();
      clearInterval(interval);
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
      channel?.close();
      void store.close?.().catch(() => undefined);
    },
  };
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
  generation += 1;
  active?.stop();
  active = null;
  syncing = null;
  pendingPatches = [];
  libraryStore.set({
    snapshot: emptySnapshot,
    index: new LibraryIndex(),
    sync: { status: 'idle', progress: null, mode: null, error: null },
    ready: false,
    persisted: true,
  });
}

/** Tell the other tabs of this browser, signed in as the same user, to refresh from the server. */
export function broadcastLibraryChange(): void {
  active?.broadcast();
}

const LIST_KEY = {
  track: 'tracks',
  album: 'albums',
  artist: 'artists',
  playlist: 'playlists',
} as const;

/** One patch over a snapshot: the new snapshot plus what changed, so the caller can write it. */
function applyPatch(
  snapshot: LibrarySnapshot,
  kind: CacheKind,
  update: (item: CacheItem) => CacheItem | null,
): { snapshot: LibrarySnapshot; changed: CacheItem[]; removed: string[] } {
  const listKey = LIST_KEY[kind];
  const changed: CacheItem[] = [];
  const removed: string[] = [];
  const next = (snapshot[listKey] as CacheItem[]).flatMap((item) => {
    const result = update(item);
    if (result === item) return [item];
    if (result === null) {
      removed.push(item.id);
      return [];
    }
    changed.push(result);
    return [result];
  });
  if (!changed.length && !removed.length) return { snapshot, changed, removed };
  const out = { ...snapshot, [listKey]: next } as LibrarySnapshot;
  if (kind === 'artist') {
    const ids = new Set(snapshot.albumArtists.map((a) => a.id));
    out.albumArtists = out.artists.filter((a) => ids.has(a.id));
  }
  return { snapshot: out, changed, removed };
}

/**
 * Apply a local change (favourite toggled, playlist renamed) to the snapshot and the disk cache at
 * once. The other tabs are told to refresh unless the caller asks to wait (an optimistic change
 * broadcasts once the server has it, so the other tab never reads the old state back). A patch made
 * while a sync runs is kept and replayed on the sync's result, which was read before the patch.
 */
export function patchItems<K extends CacheKind>(
  kind: K,
  update: (item: CacheItem) => CacheItem | null,
  options: { broadcast?: boolean } = {},
): void {
  const state = libraryStore.get();
  const { snapshot, changed, removed } = applyPatch(state.snapshot, kind, update);
  if (!changed.length && !removed.length) return;
  if (syncing) pendingPatches.push({ kind, update });
  setSnapshot(snapshot);
  if (active) {
    if (changed.length) void active.store.write(kind, changed).catch(() => undefined);
    if (removed.length) void active.store.remove(kind, removed).catch(() => undefined);
    if (options.broadcast !== false) active.broadcast();
  }
}

/**
 * What another device changed, from the server's push: patch the cached rows by id, and fetch the
 * tracks or albums the cache does not hold yet (an item outside the delta's reach). No broadcast:
 * every tab has its own socket.
 */
export async function applyUserDataChanges(changes: UserDataChange[]): Promise<void> {
  if (!changes.length) return;
  const byId = new Map(changes.map((c) => [c.itemId, c]));
  const merge = (item: CacheItem): CacheItem => {
    const change = byId.get(item.id);
    if (!change) return item;
    const next = {
      ...item,
      ...(change.isFavorite !== undefined ? { isFavorite: change.isFavorite } : {}),
      ...(change.playCount !== undefined ? { playCount: change.playCount } : {}),
      ...(change.lastPlayed !== undefined ? { lastPlayed: change.lastPlayed } : {}),
    } as CacheItem;
    const same = (['isFavorite', 'playCount', 'lastPlayed'] as const).every(
      (key) => (next as Record<string, unknown>)[key] === (item as Record<string, unknown>)[key],
    );
    return same ? item : next;
  };
  const known = new Set<string>();
  const { snapshot } = libraryStore.get();
  for (const kind of ['track', 'album', 'artist', 'playlist'] as const) {
    for (const item of snapshot[LIST_KEY[kind]] as CacheItem[]) {
      if (byId.has(item.id)) known.add(item.id);
    }
    patchItems(kind, merge, { broadcast: false });
  }
  const missing = changes.map((c) => c.itemId).filter((id) => !known.has(id));
  const current = active;
  if (!missing.length || !current) return;
  const library = current.adapter.library(current.session);
  const fetchedTracks = await library.byIds('track', missing);
  const stillMissing = missing.filter((id) => !fetchedTracks.some((t) => t.id === id));
  const fetchedAlbums = stillMissing.length ? await library.byIds('album', stillMissing) : [];
  if (active !== current) return;
  if (fetchedTracks.length) addItems('track', fetchedTracks);
  if (fetchedAlbums.length) addItems('album', fetchedAlbums);
}

/** Add brand-new items (a created playlist) to the snapshot and the cache. */
export function addItems(kind: CacheKind, items: CacheItem[]): void {
  const state = libraryStore.get();
  const listKey = LIST_KEY[kind];
  const existing = new Set((state.snapshot[listKey] as CacheItem[]).map((i) => i.id));
  const fresh = [
    ...new Map(items.filter((i) => !existing.has(i.id)).map((i) => [i.id, i])).values(),
  ];
  if (!fresh.length) return;
  setSnapshot({
    ...state.snapshot,
    [listKey]: [...(state.snapshot[listKey] as CacheItem[]), ...fresh],
  } as LibrarySnapshot);
  if (active) {
    void active.store.write(kind, fresh).catch(() => undefined);
    active.broadcast();
  }
}
