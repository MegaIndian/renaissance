import { describe, expect, it } from 'vitest';

import {
  MemoryLibraryStore,
  buildSnapshot,
  emptySnapshot,
  loadSnapshot,
  syncLibrary,
} from '../src/library-cache';
import type { Album, Artist, Playlist, Track } from '../src/models';
import type { ItemQuery, Library, Page, PageRequest } from '../src/server-adapter';
import { album, artist, playlist, track } from './fixtures';

/** A fake server library over in-memory lists, paged like Jellyfin, counting calls. */
function fakeLibrary(data: {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}) {
  const calls: string[] = [];
  const page = <T>(list: T[], p: PageRequest = {}): Page<T> => {
    const start = p.start ?? 0;
    const limit = p.limit ?? list.length;
    return { items: list.slice(start, start + limit), total: list.length };
  };
  const byDateDesc = (
    a: { dateAdded?: string | undefined },
    b: { dateAdded?: string | undefined },
  ) => Date.parse(b.dateAdded ?? '2000-01-01') - Date.parse(a.dateAdded ?? '2000-01-01');
  const lib = {
    artists: (p?: PageRequest, q?: ItemQuery) => {
      calls.push(`artists ${q?.sort}`);
      return Promise.resolve(page(data.artists, p));
    },
    albumArtists: (p?: PageRequest) => {
      calls.push('albumArtists');
      return Promise.resolve(page(data.artists.slice(0, 1), p));
    },
    albums: (p?: PageRequest, q?: ItemQuery) => {
      calls.push(`albums ${q?.sort ?? ''}`);
      if (q?.sort === 'lastSaved') return Promise.resolve({ items: [], total: data.albums.length });
      const list = q?.sort === 'dateAdded' ? [...data.albums].sort(byDateDesc) : data.albums;
      return Promise.resolve(page(list, p));
    },
    tracks: (p?: PageRequest, q?: ItemQuery) => {
      calls.push(`tracks ${q?.sort ?? ''} ${p?.start ?? 0}`);
      // Nothing was edited on this server: the "recently saved" page is empty, like a quiet library.
      if (q?.sort === 'lastSaved') return Promise.resolve({ items: [], total: data.tracks.length });
      const list = q?.sort === 'dateAdded' ? [...data.tracks].sort(byDateDesc) : data.tracks;
      return Promise.resolve(page(list, p));
    },
    playlists: (p?: PageRequest) => {
      calls.push('playlists');
      return Promise.resolve(page(data.playlists, p));
    },
    userDataChangedSince: (since: string, p?: PageRequest) => {
      calls.push(`userData ${since}`);
      return Promise.resolve(
        page(
          data.tracks.filter((t) => t.isFavorite),
          p,
        ),
      );
    },
    ids: (kind: string) => {
      calls.push(`ids ${kind}`);
      return Promise.resolve((kind === 'track' ? data.tracks : data.albums).map((i) => i.id));
    },
    byIds: (kind: string, ids: string[]) => {
      calls.push(`byIds ${kind} ${ids.join(',')}`);
      const list: { id: string }[] = kind === 'track' ? data.tracks : data.albums;
      return Promise.resolve(list.filter((i) => ids.includes(i.id)));
    },
  } as unknown as Library;
  return { lib, calls };
}

const t = (id: string, day: number, extra: Partial<Track> = {}) =>
  track(id, { dateAdded: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`, ...extra });

describe('syncLibrary', () => {
  it('first run: pages every kind into the store, reports progress, records the time and the watermark', async () => {
    const tracks = Array.from({ length: 25 }, (_, i) =>
      t(`t${i}`, 1 + (i % 9), { genres: ['G' + (i % 3)], year: 2000 + (i % 2) }),
    );
    const { lib, calls } = fakeLibrary({
      tracks,
      albums: [album('al1', { artistIds: ['a2'], year: 1999, genres: ['Jazz'] })],
      artists: [artist('a1'), artist('a2')],
      playlists: [playlist('p1')],
    });
    const store = new MemoryLibraryStore();
    const progress: string[] = [];
    const result = await syncLibrary(lib, store, {
      pageSize: 10,
      now: () => new Date('2026-02-01T00:00:00.000Z'),
      onProgress: (p) => progress.push(`${p.kind} ${p.done}/${p.total}`),
    });
    expect(result.mode).toBe('full');
    expect(result.counts).toEqual({ track: 25, album: 1, artist: 2, playlist: 1 });
    expect(result.snapshot.tracks).toHaveLength(25);
    expect(result.snapshot.genres).toEqual(['G0', 'G1', 'G2', 'Jazz']);
    expect(result.snapshot.years).toEqual([2001, 2000, 1999]);
    expect(result.snapshot.albumArtists.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(result.snapshot.syncedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(progress).toContain('track 10/25');
    expect(progress).toContain('track 25/25');
    expect(calls.filter((c) => c.startsWith('tracks')).length).toBe(3);
    expect((await store.readMeta())?.syncedAt).toBe('2026-02-01T00:00:00.000Z');
    // The watermark is the newest stamp the items carry, not a clock.
    expect((await store.readMeta())?.watermark).toEqual({
      added: '2026-01-09T00:00:00.000Z',
      saved: '2026-01-09T00:00:00.000Z',
    });
    expect((await loadSnapshot(store)).tracks).toHaveLength(25);
  });

  it('delta: fetches only what is new or changed, and drops what the server deleted', async () => {
    const data = {
      tracks: [t('old1', 1), t('old2', 2), t('old3', 3)],
      albums: [album('al1', { dateAdded: '2026-01-01T00:00:00.000Z' })],
      artists: [artist('a1')],
      playlists: [],
    };
    const { lib, calls } = fakeLibrary(data);
    const store = new MemoryLibraryStore();
    await syncLibrary(lib, store, { now: () => new Date('2026-01-10T00:00:00.000Z') });
    calls.length = 0;

    // The server gains two tracks, loses one, and a favourite changes.
    data.tracks = [t('new1', 20), t('new2', 21), t('old1', 1, { isFavorite: true }), t('old2', 2)];
    const result = await syncLibrary(lib, store, {
      pageSize: 1,
      now: () => new Date('2026-01-25T00:00:00.000Z'),
    });
    expect(result.mode).toBe('delta');
    const ids = result.snapshot.tracks.map((x) => x.id).sort();
    expect(ids).toEqual(['new1', 'new2', 'old1', 'old2']);
    expect(result.snapshot.tracks.find((x) => x.id === 'old1')?.isFavorite).toBe(true);
    expect(result.snapshot.syncedAt).toBe('2026-01-25T00:00:00.000Z');
    // Paging by date stopped at the first item older than the watermark (day 3, the newest the
    // full sync saw): three pages of one (new2, new1, old2-stop).
    expect(calls.filter((c) => c.startsWith('tracks dateAdded')).length).toBe(3);
    expect(calls).toContain('userData 2026-01-03T00:00:00.000Z');
    expect(calls).toContain('ids track');
    expect(calls).not.toContain('ids album');
  });

  it('delta: ids the server has and the cache lacks are fetched by id (a healed miss), and the count is compared without a read', async () => {
    const data = {
      tracks: [t('old1', 1), t('old2', 2)],
      albums: [album('al1', { dateAdded: '2026-01-01T00:00:00.000Z' })],
      artists: [artist('a1')],
      playlists: [],
    };
    const { lib, calls } = fakeLibrary(data);
    const store = new MemoryLibraryStore();
    await syncLibrary(lib, store, { now: () => new Date('2026-01-10T00:00:00.000Z') });
    // A track whose DateCreated is older than the watermark (a slow import stamped in the past)
    // appears on the server: the date paging never sees it, the count differs, so it is fetched by id.
    data.tracks = [t('old1', 1), t('old2', 2), t('missed', 1)];
    data.albums = [
      album('al1', { dateAdded: '2026-01-01T00:00:00.000Z' }),
      album('al2', { dateAdded: '2026-01-01T00:00:00.000Z' }),
    ];
    calls.length = 0;
    const result = await syncLibrary(lib, store, {
      now: () => new Date('2026-01-25T00:00:00.000Z'),
    });
    expect(result.mode).toBe('delta');
    expect(result.healed).toBe(2);
    expect(result.snapshot.tracks.map((x) => x.id).sort()).toEqual(['missed', 'old1', 'old2']);
    expect(result.snapshot.albums.map((x) => x.id).sort()).toEqual(['al1', 'al2']);
    expect(calls).toContain('byIds track missed');
    expect(calls).toContain('byIds album al2');
    expect(await store.count('track')).toBe(3);
    // A second delta with nothing changed compares counts only: no id list, no fetch by id.
    calls.length = 0;
    const quiet = await syncLibrary(lib, store, {
      now: () => new Date('2026-01-26T00:00:00.000Z'),
    });
    expect(quiet.healed).toBe(0);
    expect(calls.filter((c) => c.startsWith('ids') || c.startsWith('byIds'))).toEqual([]);
  });

  it('the watermark follows lastSaved when present, moves only forward, and a meta without one means a full sync', async () => {
    const data = {
      tracks: [
        t('a', 1, { lastSaved: '2026-01-15T00:00:00.000Z' }),
        t('b', 2),
        { ...t('c', 3), dateAdded: undefined } as Track,
      ],
      albums: [album('al1', { dateAdded: '2026-01-04T00:00:00.000Z' })],
      artists: [],
      playlists: [],
    };
    const { lib, calls } = fakeLibrary(data);
    const store = new MemoryLibraryStore();
    // A meta written by an older build: no watermark, so this run is a full one, whatever the clock says.
    await store.writeMeta({ syncedAt: '2026-01-10T00:00:00.000Z', albumArtistIds: [] });
    const full = await syncLibrary(lib, store, { now: () => new Date('2026-03-01T12:05:00.000Z') });
    expect(full.mode).toBe('full');
    expect(full.snapshot.syncedAt).toBe('2026-03-01T12:05:00.000Z');
    expect((await store.readMeta())?.watermark).toEqual({
      added: '2026-01-04T00:00:00.000Z',
      saved: '2026-01-15T00:00:00.000Z',
    });
    // A delta that sees nothing newer keeps the watermark; user data is asked from the save stamp.
    calls.length = 0;
    const quiet = await syncLibrary(lib, store, {
      now: () => new Date('2026-03-02T00:00:00.000Z'),
    });
    expect(quiet.mode).toBe('delta');
    expect(calls).toContain('userData 2026-01-15T00:00:00.000Z');
    expect((await store.readMeta())?.watermark).toEqual({
      added: '2026-01-04T00:00:00.000Z',
      saved: '2026-01-15T00:00:00.000Z',
    });
    // A server whose items carry no stamps at all gets a full sync every time.
    const undated = fakeLibrary({
      tracks: [{ ...track('x'), dateAdded: undefined } as Track],
      albums: [],
      artists: [],
      playlists: [],
    });
    const bare = new MemoryLibraryStore();
    expect((await syncLibrary(undated.lib, bare)).mode).toBe('full');
    expect((await bare.readMeta())?.watermark).toBeUndefined();
    expect((await syncLibrary(undated.lib, bare)).mode).toBe('full');
  });

  it('a signal that fires mid-sync stops the paging, reaches every page request, and rejects as cancelled (prod AJ)', async () => {
    const tracks = Array.from({ length: 50 }, (_, i) => t(`t${i}`, 1 + (i % 9)));
    const { lib, calls } = fakeLibrary({
      tracks,
      albums: [album('al1')],
      artists: [artist('a1')],
      playlists: [],
    });
    const controller = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const original = lib.tracks.bind(lib);
    lib.tracks = (p, q) => {
      signals.push(p?.signal);
      // The second page of songs is where the user signs out.
      if ((p?.start ?? 0) === 10) controller.abort();
      return original(p, q);
    };
    const store = new MemoryLibraryStore();
    await expect(
      syncLibrary(lib, store, { pageSize: 10, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'CancelledError' });
    // Two pages of songs went out (the abort landed during the second), none after, no albums.
    expect(calls.filter((c) => c.startsWith('tracks dateAdded')).length).toBe(2);
    expect(calls.filter((c) => c.startsWith('albums')).length).toBe(0);
    expect(signals.every((s) => s === controller.signal)).toBe(true);
    // Nothing was written: the store is as it was.
    expect(await store.readMeta()).toBeNull();
    expect(await store.count('track')).toBe(0);
    // A signal that fired before the sync began sends no request.
    const fresh = fakeLibrary({ tracks, albums: [], artists: [], playlists: [] });
    await expect(
      syncLibrary(fresh.lib, store, { pageSize: 10, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'CancelledError' });
    expect(fresh.calls).toEqual([]);
  });

  it('a corrupt record in the store is skipped, not fatal', async () => {
    const store = new MemoryLibraryStore();
    await store.write('track', [track('ok'), { id: 'bad' } as unknown as Track]);
    const snapshot = await loadSnapshot(store);
    expect(snapshot.tracks.map((x) => x.id)).toEqual(['ok']);
    expect(snapshot.syncedAt).toBeNull();
  });

  it('buildSnapshot and emptySnapshot shapes', () => {
    expect(emptySnapshot.tracks).toEqual([]);
    const snap = buildSnapshot([], [], [artist('a1')], [], {
      syncedAt: '2026-01-01T00:00:00.000Z',
      albumArtistIds: ['a1'],
    });
    expect(snap.albumArtists).toHaveLength(1);
  });

  it('MemoryLibraryStore clears everything', async () => {
    const store = new MemoryLibraryStore();
    await store.write('album', [album('x')]);
    await store.writeMeta({ syncedAt: '2026-01-01T00:00:00.000Z', albumArtistIds: [] });
    expect(await store.count('album')).toBe(1);
    await store.remove('album', ['x']);
    expect(await store.read('album')).toEqual([]);
    await store.clear();
    expect(await store.readMeta()).toBeNull();
  });
});
