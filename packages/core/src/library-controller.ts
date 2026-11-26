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

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
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
  timers?: Timers;
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

const globalTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class LibraryController {
  readonly state: Store<LibraryState> = createStore<LibraryState>(initialState());
  private readonly platform: LibraryPlatform;
  private readonly timers: Timers;
  private active: Active | null = null;
  private syncing: Promise<void> | null = null;
  /** Whether the running sync is a full one, so a Rebuild during it is not chained twice. */
  private syncingFull = false;
  /**
   * Ids a server push named that could not be fetched (a timeout, a 401 mid-flight). The delta that
   * follows cannot see them (ADR 0013), so the next refresh fetches them itself (prod AH).
   */
  private missedIds = new Set<string>();
  /**
   * Local patches made while a sync is in flight. The sync built its snapshot from a read that began
   * before the patch, so each is replayed on the result before it is shown.
   */
  private pendingPatches: { kind: CacheKind; update: Update }[] = [];
  private retryDelay = RETRY_FIRST_MS;
  /** Bumped by every start and stop, so a start that lost the race while opening its store gives up. */
  private generation = 0;

  constructor(platform: LibraryPlatform) {
    this.platform = platform;
    this.timers = platform.timers ?? globalTimers;
  }

  private log(where: string): (error: unknown) => void {
    return (error) => this.platform.log?.(where, error);
  }

  private setSnapshot(snapshot: LibrarySnapshot): void {
    this.state.set((s) => ({ ...s, snapshot, index: new LibraryIndex(snapshot), ready: true }));
  }

  private patchSync(patch: Partial<SyncState>): void {
    this.state.set((s) => ({ ...s, sync: { ...s.sync, ...patch } }));
  }

  /** The signed-in user's store key, or null when stopped. */
  get key(): string | null {
    return this.active?.key ?? null;
  }

  /**
   * Refresh from the server; one at a time, later calls join the running one. A full rebuild asked
   * for while a delta runs follows it instead of being dropped (func AE).
   */
  refresh(options: { full?: boolean } = {}): Promise<void> {
    const current = this.active;
    if (!current) return Promise.resolve();
    if (this.syncing) {
      if (options.full && !this.syncingFull) {
        return this.syncing.then(() => this.refresh({ full: true }));
      }
      return this.syncing;
    }
    this.patchSync({ status: 'syncing', error: null, progress: null });
    const mine: Promise<void> = syncLibrary(
      current.adapter.library(current.session),
      current.store,
      {
        ...(options.full ? { full: true } : {}),
        onProgress: (progress) => this.patchSync({ progress }),
        signal: current.abort.signal,
      },
    )
      .then((result) => {
        if (this.active !== current) return;
        this.retryDelay = RETRY_FIRST_MS;
        let snapshot = result.snapshot;
        for (const patch of this.pendingPatches) {
          const applied = applyPatch(snapshot, patch.kind, patch.update);
          snapshot = applied.snapshot;
          // The disk copy may hold the server's row from the sync; the patch is the newer truth.
          if (applied.changed.length) {
            void current.store
              .write(patch.kind, applied.changed)
              .catch(this.log('cache write failed'));
          }
          if (applied.removed.length) {
            void current.store
              .remove(patch.kind, applied.removed)
              .catch(this.log('cache remove failed'));
          }
        }
        this.pendingPatches = [];
        this.setSnapshot(snapshot);
        this.patchSync({ status: 'idle', progress: null, mode: result.mode });
        void this.fetchMissed(current);
      })
      .catch((error: unknown) => {
        if (this.active !== current) return;
        this.patchSync({
          status: 'error',
          progress: null,
          error: error instanceof Error ? error.message : String(error),
        });
        this.state.set((s) => ({ ...s, ready: true }));
        // An outage does not wait for the fifteen-minute timer: try again soon, backing off.
        current.retry(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
      })
      .finally(() => {
        // A sync that lost the race (sign-out, then a new sign-in) must not clear the new user's.
        if (this.syncing === mine) {
          this.syncing = null;
          this.pendingPatches = [];
        }
      });
    this.syncing = mine;
    this.syncingFull = options.full === true;
    return mine;
  }

  /** Fetch what earlier pushes named and could not get; a failure keeps the ids for the next time. */
  private async fetchMissed(current: Active): Promise<void> {
    if (!this.missedIds.size) return;
    const ids = [...this.missedIds].slice(0, PUSH_FETCH_LIMIT);
    this.missedIds = new Set([...this.missedIds].filter((id) => !ids.includes(id)));
    try {
      const fetched = await current.adapter.library(current.session).musicByIds(ids);
      if (this.active !== current) return;
      if (fetched.tracks.length) this.addItems('track', fetched.tracks);
      if (fetched.albums.length) this.addItems('album', fetched.albums);
    } catch (error) {
      if (this.active === current) for (const id of ids) this.missedIds.add(id);
      this.platform.log?.('missed ids fetch failed', error);
    }
  }

  /** Called when the session changes: open this user's store, show it, then refresh. */
  async start(adapter: ServerAdapter, session: Session): Promise<void> {
    const key = libraryKey(session);
    if (this.active?.key === key) return;
    this.stop();
    const mine = ++this.generation;
    this.patchSync({ status: 'loading', progress: null, error: null });
    const { store, persisted } = await this.platform.openStore(key);
    if (mine !== this.generation) {
      void store.close?.().catch(this.log('store close failed'));
      return;
    }
    this.state.set((s) => ({ ...s, persisted }));
    const timers = this.timers;
    let timer: unknown;
    let retryTimer: unknown;
    const schedule = (delay = 2000): void => {
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => void this.refresh(), delay);
    };
    const unsubscribe = adapter.subscribe(session, {
      onLibraryChanged: () => schedule(),
      onUserDataChanged: (changes) => {
        // The push names the items: patch them now. The delta that follows cannot see a favourite
        // or a play on 10.10.7 (ADR 0013), so this is how another device's heart reaches this one.
        void this.applyUserDataChanges(changes).catch(this.log('push apply failed'));
        schedule();
      },
    });
    const interval = timers.setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    const stopResume = this.platform.onResume?.(() => void this.refresh()) ?? (() => undefined);
    const stopPeers = this.platform.peers?.listen(key, () => schedule(500)) ?? (() => undefined);
    const abort = new AbortController();
    this.active = {
      key,
      store,
      adapter,
      session,
      abort,
      retry: (ms) => {
        if (retryTimer !== undefined) timers.clearTimeout(retryTimer);
        retryTimer = timers.setTimeout(() => void this.refresh(), ms);
      },
      stop: () => {
        // A sign-out revokes the token: a sync still paging would only collect 401s (prod AJ).
        abort.abort();
        unsubscribe();
        timers.clearInterval(interval);
        if (timer !== undefined) timers.clearTimeout(timer);
        if (retryTimer !== undefined) timers.clearTimeout(retryTimer);
        stopResume();
        stopPeers();
        void store.close?.().catch(this.log('store close failed'));
      },
    };
    try {
      const snapshot = await loadSnapshot(store);
      if (this.active?.key !== key) return;
      this.setSnapshot(snapshot);
    } catch {
      /* an unreadable cache is rebuilt by the sync below */
    }
    await this.refresh();
  }

  stop(): void {
    this.generation += 1;
    this.active?.stop();
    this.active = null;
    this.syncing = null;
    this.syncingFull = false;
    this.pendingPatches = [];
    this.missedIds = new Set();
    this.retryDelay = RETRY_FIRST_MS;
    this.state.set(initialState());
  }

  /** Tell the other instances signed in as the same user to refresh from the server. */
  broadcastChange(): void {
    const current = this.active;
    if (current) this.platform.peers?.post(current.key);
  }

  /**
   * Apply a local change (favourite toggled, playlist renamed) to the snapshot and the store at
   * once. Peers are told to refresh unless the caller asks to wait (an optimistic change broadcasts
   * once the server has it). A patch made while a sync runs is replayed on the sync's result.
   */
  patchItems(kind: CacheKind, update: Update, options: { broadcast?: boolean } = {}): void {
    const { snapshot, changed, removed } = applyPatch(this.state.get().snapshot, kind, update);
    if (!changed.length && !removed.length) return;
    if (this.syncing) this.pendingPatches.push({ kind, update });
    this.setSnapshot(snapshot);
    const current = this.active;
    if (!current) return;
    if (changed.length)
      void current.store.write(kind, changed).catch(this.log('cache write failed'));
    if (removed.length) {
      void current.store.remove(kind, removed).catch(this.log('cache remove failed'));
    }
    if (options.broadcast !== false) this.broadcastChange();
  }

  /** Add brand-new items (a created playlist, a song a push named) to the snapshot and the store. */
  addItems(kind: CacheKind, items: CacheItem[]): void {
    const { snapshot } = this.state.get();
    const listKey = LIST_KEY[kind];
    const existing = new Set((snapshot[listKey] as CacheItem[]).map((i) => i.id));
    const fresh = [
      ...new Map(items.filter((i) => !existing.has(i.id)).map((i) => [i.id, i])).values(),
    ];
    if (!fresh.length) return;
    this.setSnapshot({
      ...snapshot,
      [listKey]: [...(snapshot[listKey] as CacheItem[]), ...fresh],
    } as LibrarySnapshot);
    const current = this.active;
    if (current) {
      void current.store.write(kind, fresh).catch(this.log('cache write failed'));
      this.broadcastChange();
    }
  }

  /**
   * What another device changed, from the server's push: patch the cached rows by id, and fetch
   * the tracks or albums the store does not hold yet. No broadcast: every instance has its socket.
   */
  async applyUserDataChanges(changes: UserDataChange[]): Promise<void> {
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
    const { snapshot } = this.state.get();
    for (const kind of ['track', 'album', 'artist', 'playlist'] as const) {
      for (const item of snapshot[LIST_KEY[kind]] as CacheItem[]) {
        if (byId.has(item.id)) known.add(item.id);
      }
      this.patchItems(kind, merge, { broadcast: false });
    }
    // The push names whatever any device touched, films included: one request for the unknown
    // ids, no more than a page of them per push (a bigger batch is the delta's job).
    const missing = changes
      .map((c) => c.itemId)
      .filter((id) => !known.has(id))
      .slice(0, PUSH_FETCH_LIMIT);
    const current = this.active;
    if (!missing.length || !current) return;
    let fetched: Awaited<ReturnType<ReturnType<ServerAdapter['library']>['musicByIds']>>;
    try {
      fetched = await current.adapter.library(current.session).musicByIds(missing);
    } catch (error) {
      // Kept for the next refresh: the delta cannot bring them (ADR 0013).
      if (this.active === current) for (const id of missing) this.missedIds.add(id);
      this.platform.log?.('push fetch failed', error);
      return;
    }
    if (this.active !== current) return;
    if (fetched.tracks.length) this.addItems('track', fetched.tracks);
    if (fetched.albums.length) this.addItems('album', fetched.albums);
  }
}
