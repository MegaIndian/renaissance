/**
 * The library's lifecycle on any platform (F14, ADR 0008): open this user's store, show what is on
 * disk, refresh from the server, refresh again on server pushes, on resume and every fifteen
 * minutes, and patch the snapshot at once for local actions. The platform injects where the store
 * lives (IndexedDB on web, SQLite on mobile), what "resumed" means (back online, back to the
 * foreground) and, where there is such a thing, how to reach other tabs signed in as the same user.
 */
import type {
  CacheItem,
  CacheKind,
  LibrarySnapshot,
  LibraryStore,
  SyncProgress,
} from './library-cache';
import { emptySnapshot, loadSnapshot, syncLibrary } from './library-cache';
import { LibraryIndex } from './search';
import type { ServerAdapter, Session, UserDataChange } from './server-adapter';
import type { Store } from './store';
import { createStore } from './store';

/** A platform store: core's interface, plus `close` where the platform has one. */
export type PlatformLibraryStore = LibraryStore & { close?: () => Promise<void> };

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
  /** False when the platform refused storage and the library lives in memory for this session. */
  persisted: boolean;
}

export interface LibraryPlatform {
  /** Open this user's store; `persisted: false` when the platform refused storage (memory instead). */
  openStore(key: string): Promise<{ store: PlatformLibraryStore; persisted: boolean }>;
  /** The platform came back (online again, back to the foreground); returns the unsubscribe. */
  onResume?(listener: () => void): () => void;
  /** Other instances signed in as the same user (browser tabs); absent where there are none. */
  peers?: {
    post(key: string): void;
    listen(key: string, onChange: () => void): () => void;
  };
  /** Where swallowed errors go (a debug log); nothing by default. */
  log?(where: string, error: unknown): void;
}

export const REFRESH_INTERVAL_MS = 15 * 60_000;
/** After a failed refresh: 30 s, then doubling to five minutes, until one succeeds. */
export const RETRY_FIRST_MS = 30_000;
export const RETRY_MAX_MS = 5 * 60_000;
/** Unknown ids fetched per push, at most; the ones past it reach the cache through the next sync. */
export const PUSH_FETCH_LIMIT = 100;

/** One store per server and user, so switching users never shows someone else's favourites (F86). */
export function libraryKey(session: Session): string {
  return `renaissance-library-${session.server.id}-${session.userId}`.replace(/[^\w.-]/g, '_');
}

const LIST_KEY = {
  track: 'tracks',
  album: 'albums',
  artist: 'artists',
  playlist: 'playlists',
} as const;

type Update = (item: CacheItem) => CacheItem | null;

/** One patch over a snapshot: the new snapshot plus what changed, so the caller can write it. */
export function applyPatch(
  snapshot: LibrarySnapshot,
  kind: CacheKind,
  update: Update,
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

const initialState = (): LibraryState => ({
  snapshot: emptySnapshot,
  index: new LibraryIndex(),
  sync: { status: 'idle', progress: null, mode: null, error: null },
  ready: false,
  persisted: true,
});

interface Active {
  key: string;
  store: PlatformLibraryStore;
  adapter: ServerAdapter;
  session: Session;
  /** Fired by `stop`: a sync in flight sends no further page and the one in flight is aborted. */
  abort: AbortController;
  stop: () => void;
  retry: (ms: number) => void;
}

/** What the platform holds: the observable state and the lifecycle calls. */
export interface LibraryController {
  readonly state: Store<LibraryState>;
  /** The signed-in user's store key, or null when stopped. */
  readonly key: string | null;
  refresh(options?: { full?: boolean }): Promise<void>;
  start(adapter: ServerAdapter, session: Session): Promise<void>;
  stop(): void;
  broadcastChange(): void;
  patchItems(kind: CacheKind, update: Update, options?: { broadcast?: boolean }): void;
  addItems(kind: CacheKind, items: CacheItem[]): void;
  applyUserDataChanges(changes: UserDataChange[]): Promise<void>;
}

/**
 * A closure rather than a class: the web shell carries this module, and closure locals minify where
 * property names would not (the shell's first-load budget is 200 kB).
 */
export function createLibraryController(platform: LibraryPlatform): LibraryController {
  const state = createStore<LibraryState>(initialState());
  let active: Active | null = null;
  let syncing: Promise<void> | null = null;
  /** Whether the running sync is a full one, so a Rebuild during it is not chained twice. */
  let syncingFull = false;
  /**
   * Ids a server push named that could not be fetched (a timeout, a 401 mid-flight). The delta that
   * follows cannot see them (ADR 0013), so the next refresh fetches them itself (prod AH).
   */
  let missedIds = new Set<string>();
  /**
   * Local patches made while a sync is in flight. The sync built its snapshot from a read that began
   * before the patch, so each is replayed on the result before it is shown.
   */
  let pendingPatches: { kind: CacheKind; update: Update }[] = [];
  let retryDelay = RETRY_FIRST_MS;
  /** Bumped by every start and stop, so a start that lost the race while opening its store gives up. */
  let generation = 0;

  function log(where: string): (error: unknown) => void {
    return (error) => platform.log?.(where, error);
  }

  function setSnapshot(snapshot: LibrarySnapshot): void {
    state.set((s) => ({ ...s, snapshot, index: new LibraryIndex(snapshot), ready: true }));
  }

  function patchSync(patch: Partial<SyncState>): void {
    state.set((s) => ({ ...s, sync: { ...s.sync, ...patch } }));
  }

  /**
   * Refresh from the server; one at a time, later calls join the running one. A full rebuild asked
   * for while a delta runs follows it instead of being dropped (func AE).
   */
  function refresh(options: { full?: boolean } = {}): Promise<void> {
    const current = active;
    if (!current) return Promise.resolve();
    if (syncing) {
      if (options.full && !syncingFull) {
        return syncing.then(() => refresh({ full: true }));
      }
      return syncing;
    }
    patchSync({ status: 'syncing', error: null, progress: null });
    const mine: Promise<void> = syncLibrary(
      current.adapter.library(current.session),
      current.store,
      {
        ...(options.full ? { full: true } : {}),
        onProgress: (progress) => patchSync({ progress }),
        signal: current.abort.signal,
      },
    )
      .then((result) => {
        if (active !== current) return;
        retryDelay = RETRY_FIRST_MS;
        let snapshot = result.snapshot;
        for (const patch of pendingPatches) {
          const applied = applyPatch(snapshot, patch.kind, patch.update);
          snapshot = applied.snapshot;
          // The disk copy may hold the server's row from the sync; the patch is the newer truth.
          if (applied.changed.length) {
            void current.store.write(patch.kind, applied.changed).catch(log('cache write failed'));
          }
          if (applied.removed.length) {
            void current.store
              .remove(patch.kind, applied.removed)
              .catch(log('cache remove failed'));
          }
        }
        pendingPatches = [];
        setSnapshot(snapshot);
        patchSync({ status: 'idle', progress: null, mode: result.mode });
        void fetchMissed(current);
      })
      .catch((error: unknown) => {
        if (active !== current) return;
        patchSync({
          status: 'error',
          progress: null,
          error: error instanceof Error ? error.message : String(error),
        });
        state.set((s) => ({ ...s, ready: true }));
        // An outage does not wait for the fifteen-minute timer: try again soon, backing off.
        current.retry(retryDelay);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      })
      .finally(() => {
        // A sync that lost the race (sign-out, then a new sign-in) must not clear the new user's.
        if (syncing === mine) {
          syncing = null;
          pendingPatches = [];
        }
      });
    syncing = mine;
    syncingFull = options.full === true;
    return mine;
  }

  /** Fetch what earlier pushes named and could not get; a failure keeps the ids for the next time. */
  async function fetchMissed(current: Active): Promise<void> {
    if (!missedIds.size) return;
    const ids = [...missedIds].slice(0, PUSH_FETCH_LIMIT);
    missedIds = new Set([...missedIds].filter((id) => !ids.includes(id)));
    try {
      const fetched = await current.adapter.library(current.session).musicByIds(ids);
      if (active !== current) return;
      if (fetched.tracks.length) addItems('track', fetched.tracks);
      if (fetched.albums.length) addItems('album', fetched.albums);
    } catch (error) {
      if (active === current) for (const id of ids) missedIds.add(id);
      platform.log?.('missed ids fetch failed', error);
    }
  }

  /** Called when the session changes: open this user's store, show it, then refresh. */
  async function start(adapter: ServerAdapter, session: Session): Promise<void> {
    const key = libraryKey(session);
    if (active?.key === key) return;
    stop();
    const mine = ++generation;
    patchSync({ status: 'loading', progress: null, error: null });
    const { store, persisted } = await platform.openStore(key);
    if (mine !== generation) {
      void store.close?.().catch(log('store close failed'));
      return;
    }
    state.set((s) => ({ ...s, persisted }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay = 2000): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), delay);
    };
    const unsubscribe = adapter.subscribe(session, {
      onLibraryChanged: () => schedule(),
      onUserDataChanged: (changes) => {
        // The push names the items: patch them now. The delta that follows cannot see a favourite
        // or a play on 10.10.7 (ADR 0013), so this is how another device's heart reaches this one.
        void applyUserDataChanges(changes).catch(log('push apply failed'));
        schedule();
      },
    });
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const stopResume = platform.onResume?.(() => void refresh()) ?? (() => undefined);
    const stopPeers = platform.peers?.listen(key, () => schedule(500)) ?? (() => undefined);
    const abort = new AbortController();
    active = {
      key,
      store,
      adapter,
      session,
      abort,
      retry: (ms) => {
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void refresh(), ms);
      },
      stop: () => {
        // A sign-out revokes the token: a sync still paging would only collect 401s (prod AJ).
        abort.abort();
        unsubscribe();
        clearInterval(interval);
        if (timer !== undefined) clearTimeout(timer);
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        stopResume();
        stopPeers();
        void store.close?.().catch(log('store close failed'));
      },
    };
    try {
      const snapshot = await loadSnapshot(store);
      if (active?.key !== key) return;
      setSnapshot(snapshot);
    } catch {
      /* an unreadable cache is rebuilt by the sync below */
    }
    await refresh();
  }

  function stop(): void {
    generation += 1;
    active?.stop();
    active = null;
    syncing = null;
    syncingFull = false;
    pendingPatches = [];
    missedIds = new Set();
    retryDelay = RETRY_FIRST_MS;
    state.set(initialState());
  }

  /** Tell the other instances signed in as the same user to refresh from the server. */
  function broadcastChange(): void {
    const current = active;
    if (current) platform.peers?.post(current.key);
  }

  /**
   * Apply a local change (favourite toggled, playlist renamed) to the snapshot and the store at
   * once. Peers are told to refresh unless the caller asks to wait (an optimistic change broadcasts
   * once the server has it). A patch made while a sync runs is replayed on the sync's result.
   */
  function patchItems(
    kind: CacheKind,
    update: Update,
    options: { broadcast?: boolean } = {},
  ): void {
    const { snapshot, changed, removed } = applyPatch(state.get().snapshot, kind, update);
    if (!changed.length && !removed.length) return;
    if (syncing) pendingPatches.push({ kind, update });
    setSnapshot(snapshot);
    const current = active;
    if (!current) return;
    if (changed.length) void current.store.write(kind, changed).catch(log('cache write failed'));
    if (removed.length) {
      void current.store.remove(kind, removed).catch(log('cache remove failed'));
    }
    if (options.broadcast !== false) broadcastChange();
  }

  /** Add brand-new items (a created playlist, a song a push named) to the snapshot and the store. */
  function addItems(kind: CacheKind, items: CacheItem[]): void {
    const { snapshot } = state.get();
    const listKey = LIST_KEY[kind];
    const existing = new Set((snapshot[listKey] as CacheItem[]).map((i) => i.id));
    const fresh = [
      ...new Map(items.filter((i) => !existing.has(i.id)).map((i) => [i.id, i])).values(),
    ];
    if (!fresh.length) return;
    setSnapshot({
      ...snapshot,
      [listKey]: [...(snapshot[listKey] as CacheItem[]), ...fresh],
    } as LibrarySnapshot);
    const current = active;
    if (current) {
      void current.store.write(kind, fresh).catch(log('cache write failed'));
      broadcastChange();
    }
  }

  /**
   * What another device changed, from the server's push: patch the cached rows by id, and fetch
   * the tracks or albums the store does not hold yet. No broadcast: every instance has its socket.
   */
  async function applyUserDataChanges(changes: UserDataChange[]): Promise<void> {
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
    const { snapshot } = state.get();
    for (const kind of ['track', 'album', 'artist', 'playlist'] as const) {
      for (const item of snapshot[LIST_KEY[kind]] as CacheItem[]) {
        if (byId.has(item.id)) known.add(item.id);
      }
      patchItems(kind, merge, { broadcast: false });
    }
    // The push names whatever any device touched, films included: one request for the unknown
    // ids, no more than a page of them per push (a bigger batch is the delta's job).
    const missing = changes
      .map((c) => c.itemId)
      .filter((id) => !known.has(id))
      .slice(0, PUSH_FETCH_LIMIT);
    const current = active;
    if (!missing.length || !current) return;
    let fetched: Awaited<ReturnType<ReturnType<ServerAdapter['library']>['musicByIds']>>;
    try {
      fetched = await current.adapter.library(current.session).musicByIds(missing);
    } catch (error) {
      // Kept for the next refresh: the delta cannot bring them (ADR 0013).
      if (active === current) for (const id of missing) missedIds.add(id);
      platform.log?.('push fetch failed', error);
      return;
    }
    if (active !== current) return;
    if (fetched.tracks.length) addItems('track', fetched.tracks);
    if (fetched.albums.length) addItems('album', fetched.albums);
  }
  return {
    state,
    get key() {
      return active?.key ?? null;
    },
    refresh,
    start,
    stop,
    broadcastChange,
    patchItems,
    addItems,
    applyUserDataChanges,
  };
}
