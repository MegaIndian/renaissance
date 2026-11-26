import { LibraryIndex, MemoryLibraryStore, buildSnapshot, loadSnapshot } from '@renaissance/core';
import type { Track, UserDataChange } from '@renaissance/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { albums, artists, fakeAdapter, playlists, session, tracks } from '../test/fakes';
import {
  IndexedDbLibraryStore,
  PUSH_FETCH_LIMIT,
  addItems,
  applyUserDataChanges,
  dbName,
  deleteLibrary,
  libraryStore,
  openLibraryStore,
  patchItems,
  refreshLibrary,
  startLibrary,
  stopLibrary,
} from './library';

describe('IndexedDbLibraryStore', () => {
  it('writes, reads, replaces, removes and clears every kind plus the meta record', async () => {
    const store = new IndexedDbLibraryStore(`test-${Date.now()}`);
    await store.write('track', tracks);
    await store.write('album', albums);
    await store.write('artist', artists);
    await store.write('playlist', playlists);
    await store.writeMeta({ syncedAt: '2026-11-17T21:00:00.000Z', albumArtistIds: ['a1'] });
    expect((await store.read('track')).length).toBe(4);
    const snapshot = await loadSnapshot(store);
    expect(snapshot.albumArtists.map((a) => a.id)).toEqual(['a1']);
    expect(snapshot.genres).toEqual(['Contemporary', 'Orchestra']);
    await store.remove('track', ['t1']);
    expect((await store.read('track')).map((t) => t.id).sort()).toEqual(['t2', 't3', 't4']);
    await store.replace('track', tracks.slice(0, 1));
    expect((await store.read('track')).map((t) => t.id)).toEqual(['t1']);
    await store.clear();
    expect(await store.read('album')).toEqual([]);
    expect(await store.readMeta()).toBeNull();
    await store.close();
  });

  it('names the database per server and user so household members never share a cache', () => {
    expect(dbName(session)).toBe('renaissance-library-demo-u1');
    expect(dbName({ ...session, userId: 'u2' })).not.toBe(dbName(session));
    expect(dbName({ ...session, server: { ...session.server, id: 'a b/c' } })).toMatch(/^[\w.-]+$/);
  });
});

describe('local patches', () => {
  it('patchItems updates the snapshot and the index; addItems appends new items only', () => {
    const snapshot = buildSnapshot(tracks, albums, artists, playlists, null);
    libraryStore.set({
      snapshot,
      index: new LibraryIndex(snapshot),
      sync: { status: 'idle', progress: null, mode: null, error: null },
      ready: true,
      persisted: true,
    });
    patchItems('track', (item) => (item.id === 't1' ? { ...item, isFavorite: true } : item));
    expect(libraryStore.get().snapshot.tracks.find((t) => t.id === 't1')?.isFavorite).toBe(true);
    const before = libraryStore.get();
    patchItems('track', (item) => item);
    expect(libraryStore.get()).toBe(before);
    patchItems('playlist', (item) => (item.id === 'p1' ? null : item));
    expect(libraryStore.get().snapshot.playlists).toEqual([]);
    addItems('playlist', [playlists[0]!, playlists[0]!]);
    expect(libraryStore.get().snapshot.playlists).toHaveLength(1);
    addItems('playlist', [playlists[0]!]);
    expect(libraryStore.get().snapshot.playlists).toHaveLength(1);
    patchItems('artist', (item) => (item.id === 'a1' ? { ...item, isFavorite: true } : item));
    expect(libraryStore.get().snapshot.albumArtists[0]?.isFavorite).toBe(true);
  });
});

describe('storage that is blocked', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  afterEach(() => {
    stopLibrary();
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
  });

  const blocked = {
    'indexedDB undefined': () =>
      Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true }),
    'indexedDB getter throws SecurityError': () =>
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        get() {
          throw new DOMException('Access is denied', 'SecurityError');
        },
      }),
  };

  for (const [name, block] of Object.entries(blocked)) {
    it(`${name}: the library falls back to a memory store, loads and syncs; delete and stop tolerate it`, async () => {
      block();
      const opened = await openLibraryStore('blocked');
      expect(opened.store).toBeInstanceOf(MemoryLibraryStore);
      expect(opened.persisted).toBe(false);

      await startLibrary(fakeAdapter().adapter, session);
      const state = libraryStore.get();
      expect(state.ready).toBe(true);
      expect(state.persisted).toBe(false);
      expect(state.sync.status).toBe('idle');
      expect(state.snapshot.tracks.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3', 't4']);
      // Local changes still land in the session store.
      patchItems('track', (item) => (item.id === 't1' ? { ...item, isFavorite: true } : item));
      expect(libraryStore.get().snapshot.tracks.find((t) => t.id === 't1')?.isFavorite).toBe(true);

      await expect(deleteLibrary(session)).resolves.toBeUndefined();
      expect(() => stopLibrary()).not.toThrow();
      expect(libraryStore.get().persisted).toBe(true);
    });
  }

  it('with IndexedDB available the store is on disk', async () => {
    const opened = await openLibraryStore(`open-${Date.now()}`);
    expect(opened.persisted).toBe(true);
    expect(opened.store).toBeInstanceOf(IndexedDbLibraryStore);
    await opened.store.close?.();
  });
});

describe('changes while a sync runs, and changes the server pushes', () => {
  afterEach(() => stopLibrary());

  it('a patch made while a sync is in flight survives the sync landing', async () => {
    // The sync reads the store before the patch is written, so its snapshot would show the old heart.
    const { adapter } = fakeAdapter();
    let release: () => void = () => undefined;
    let hold = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const library = adapter.library(session);
    vi.spyOn(adapter, 'library').mockReturnValue({
      ...library,
      tracks: async (...args: Parameters<typeof library.tracks>) => {
        if (hold) await gate;
        return library.tracks(...args);
      },
    });
    await startLibrary(adapter, { ...session, userId: `pending-${Date.now()}` });
    hold = true;
    expect(libraryStore.get().snapshot.tracks.find((t) => t.id === 't1')?.isFavorite).toBe(false);
    const sync = refreshLibrary({ full: true });
    expect(libraryStore.get().sync.status).toBe('syncing');
    patchItems('track', (item) => (item.id === 't1' ? { ...item, isFavorite: true } : item));
    expect(libraryStore.get().snapshot.tracks.find((t) => t.id === 't1')?.isFavorite).toBe(true);
    release();
    await sync;
    expect(libraryStore.get().sync.status).toBe('idle');
    expect(libraryStore.get().snapshot.tracks.find((t) => t.id === 't1')?.isFavorite).toBe(true);
    // A later sync, with nothing pending, shows what the server has.
    await refreshLibrary({ full: true });
    expect(libraryStore.get().snapshot.tracks.find((t) => t.id === 't1')?.isFavorite).toBe(false);
  });

  it('a push naming items patches the cached rows and fetches the ones the cache lacks', async () => {
    const { adapter } = fakeAdapter();
    const fetched: string[] = [];
    let events: { onUserDataChanged?: (changes: UserDataChange[]) => void } = {};
    const library = adapter.library(session);
    vi.spyOn(adapter, 'library').mockReturnValue({
      ...library,
      musicByIds: (ids: readonly string[]) => {
        fetched.push(ids.join(','));
        return Promise.resolve({
          tracks: ids
            .filter((id) => id === 't9')
            .map((id) => ({ ...tracks[0], id, title: 'Song 9' })),
          albums: [],
        });
      },
    } as never);
    vi.spyOn(adapter, 'subscribe').mockImplementation((_s, e) => {
      events = e;
      return () => undefined;
    });
    await startLibrary(adapter, { ...session, userId: `push-${Date.now()}` });
    const before = libraryStore.get().snapshot.tracks.find((t) => t.id === 't2') as Track;
    expect(before.isFavorite).toBe(false);
    expect(before.playCount).toBe(3);

    // What 10.10.7 pushes when another device hearts t2, plays it, and hearts a song the cache has
    // never seen (outside the delta's reach, ADR 0013).
    events.onUserDataChanged?.([
      { itemId: 't2', isFavorite: true, playCount: 4, lastPlayed: '2026-11-20T01:00:00.000Z' },
      { itemId: 'al1', isFavorite: true },
      { itemId: 't9', isFavorite: true, playCount: 1 },
      { itemId: 'movie-1', isFavorite: true },
    ]);
    await vi.waitFor(() => {
      expect(libraryStore.get().snapshot.tracks.some((t) => t.id === 't9')).toBe(true);
    });
    const after = libraryStore.get().snapshot.tracks.find((t) => t.id === 't2') as Track;
    expect(after.isFavorite).toBe(true);
    expect(after.playCount).toBe(4);
    expect(after.lastPlayed).toBe('2026-11-20T01:00:00.000Z');
    expect(libraryStore.get().snapshot.albums[0]?.isFavorite).toBe(true);
    // One request for every unknown id, whatever its kind; the film the server returns is dropped.
    expect(fetched).toEqual(['t9,movie-1']);
    expect(libraryStore.get().snapshot.tracks.some((t) => t.id === 'movie-1')).toBe(false);
    // The push is applied; nothing else of the row changed.
    expect(after.title).toBe('Carefree');

    // An empty push (no `Data`) changes nothing and fetches nothing.
    await applyUserDataChanges([]);
    expect(fetched).toHaveLength(1);

    // A push naming more unknown ids than one page fetches one page; the rest wait for the sync.
    await applyUserDataChanges(
      Array.from({ length: PUSH_FETCH_LIMIT + 50 }, (_, i) => ({
        itemId: `x${i}`,
        isFavorite: true,
      })),
    );
    expect(fetched).toHaveLength(2);
    expect(fetched[1]?.split(',')).toHaveLength(PUSH_FETCH_LIMIT);
  });

  it('Rebuild pressed during a refresh runs the full sync after it instead of dropping it (func AE)', async () => {
    const { adapter } = fakeAdapter();
    const library = adapter.library(session);
    let hold = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reads: string[] = [];
    vi.spyOn(adapter, 'library').mockReturnValue({
      ...library,
      tracks: async (...args: Parameters<typeof library.tracks>) => {
        reads.push('start');
        if (hold) await gate;
        reads.push('done');
        return library.tracks(...args);
      },
    });
    await startLibrary(adapter, { ...session, userId: `rebuild-${Date.now()}` });
    reads.length = 0;
    hold = true;
    const running = refreshLibrary();
    const full = refreshLibrary({ full: true });
    expect(full).not.toBe(running);
    await vi.waitFor(() => expect(reads).toEqual(['start']));
    hold = false;
    release();
    await full;
    expect(libraryStore.get().sync.mode).toBe('full');
    // The running sync read the songs once; the rebuild read them again after it, not alongside.
    expect(reads).toEqual(['start', 'done', 'start', 'done']);
  });

  it('sign-out aborts the sync in flight: the page request is aborted and no further page goes out (prod AJ)', async () => {
    const { adapter } = fakeAdapter();
    const library = adapter.library(session);
    const signals: (AbortSignal | undefined)[] = [];
    let pages = 0;
    let hold = false;
    let release: () => void = () => undefined;
    vi.spyOn(adapter, 'library').mockReturnValue({
      ...library,
      tracks: async (...args: Parameters<typeof library.tracks>) => {
        pages += 1;
        signals.push(args[0]?.signal);
        if (hold) await new Promise<void>((resolve) => (release = resolve));
        return library.tracks(...args);
      },
    });
    await startLibrary(adapter, { ...session, userId: `abort-${Date.now()}` });
    hold = true;
    const sync = refreshLibrary({ full: true });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(false);
    stopLibrary();
    // The signal every page request carried has fired; the request in flight ends with it.
    expect(signals[0]?.aborted).toBe(true);
    release();
    await sync;
    expect(pages).toBe(1);
    expect(libraryStore.get().sync.status).toBe('idle');
    expect(libraryStore.get().snapshot.tracks).toEqual([]);
  });

  it("a sync that lost the race on sign-out does not clear the new user's sync when it ends (func AH)", async () => {
    const { adapter } = fakeAdapter();
    const library = adapter.library(session);
    let hold = false;
    const releases: (() => void)[] = [];
    vi.spyOn(adapter, 'library').mockReturnValue({
      ...library,
      tracks: async (...args: Parameters<typeof library.tracks>) => {
        if (hold) await new Promise<void>((resolve) => releases.push(resolve));
        return library.tracks(...args);
      },
    });
    await startLibrary(adapter, { ...session, userId: `stale-a-${Date.now()}` });
    hold = true;
    const stale = refreshLibrary({ full: true });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    hold = false;
    stopLibrary();
    await startLibrary(adapter, { ...session, userId: `stale-b-${Date.now()}` });
    hold = true;
    const mine = refreshLibrary();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    // The old user's sync ends now: it must not touch the running one.
    releases[0]?.();
    await stale;
    expect(refreshLibrary()).toBe(mine);
    releases[1]?.();
    await mine;
    expect(libraryStore.get().sync.status).toBe('idle');
  });

  it('ids a push named that could not be fetched are fetched by the next refresh (prod AH)', async () => {
    const { adapter } = fakeAdapter();
    const library = adapter.library(session);
    let fail = true;
    const asked: string[][] = [];
    vi.spyOn(adapter, 'library').mockReturnValue({
      ...library,
      musicByIds: (ids: string[]) => {
        asked.push([...ids]);
        if (fail) return Promise.reject(new Error('timeout'));
        return Promise.resolve({
          tracks: ids.map((id) => ({ ...tracks[0]!, id, title: `Fetched ${id}` })),
          albums: [],
        });
      },
    });
    await startLibrary(adapter, { ...session, userId: `missed-${Date.now()}` });
    await applyUserDataChanges([{ itemId: 't9', isFavorite: true }]);
    expect(asked).toEqual([['t9']]);
    expect(libraryStore.get().snapshot.tracks.find((t) => t.id === 't9')).toBeUndefined();
    fail = false;
    await refreshLibrary();
    await vi.waitFor(() => {
      expect(libraryStore.get().snapshot.tracks.find((t) => t.id === 't9')?.title).toBe(
        'Fetched t9',
      );
    });
    expect(asked).toEqual([['t9'], ['t9']]);
    // Once fetched, the id is not asked for again.
    await refreshLibrary();
    expect(asked).toHaveLength(2);
  });

  it('a playlist deleted while a sync runs stays gone on disk, so a cold start does not bring it back', async () => {
    const { adapter } = fakeAdapter();
    let release: () => void = () => undefined;
    let hold = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const library = adapter.library(session);
    vi.spyOn(adapter, 'library').mockReturnValue({
      ...library,
      playlists: async (...args: Parameters<typeof library.playlists>) => {
        if (hold) await gate;
        return library.playlists(...args);
      },
    });
    const user = { ...session, userId: `deleted-${Date.now()}` };
    await startLibrary(adapter, user);
    expect(libraryStore.get().snapshot.playlists.some((p) => p.id === 'p1')).toBe(true);
    hold = true;
    const sync = refreshLibrary({ full: true });
    patchItems('playlist', (item) => (item.id === 'p1' ? null : item));
    expect(libraryStore.get().snapshot.playlists.some((p) => p.id === 'p1')).toBe(false);
    release();
    await sync;
    expect(libraryStore.get().snapshot.playlists.some((p) => p.id === 'p1')).toBe(false);
    stopLibrary();
    // The cold start: what the disk holds before any sync.
    const store = new IndexedDbLibraryStore(dbName(user));
    await vi.waitFor(async () => {
      expect((await store.read('playlist')).map((p) => p.id)).not.toContain('p1');
    });
    await store.close();
  });
});
