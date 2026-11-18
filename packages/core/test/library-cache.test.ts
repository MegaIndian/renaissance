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
      const list = q?.sort === 'dateAdded' ? [...data.albums].sort(byDateDesc) : data.albums;
      return Promise.resolve(page(list, p));
    },
    tracks: (p?: PageRequest, q?: ItemQuery) => {
      calls.push(`tracks ${q?.sort ?? ''} ${p?.start ?? 0}`);
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
  } as unknown as Library;
  return { lib, calls };
}

const t = (id: string, day: number, extra: Partial<Track> = {}) =>
  track(id, { dateAdded: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`, ...extra });

describe('syncLibrary', () => {
  it('first run: pages every kind into the store, reports progress and records the time', async () => {
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
    // Paging by date stopped at the first old item: three pages of one (new1, new2, old1-stop).
    expect(calls.filter((c) => c.startsWith('tracks dateAdded')).length).toBe(3);
    expect(calls).toContain('userData 2026-01-10T00:00:00.000Z');
    expect(calls).toContain('ids track');
    expect(calls).not.toContain('ids album');
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
    await store.remove('album', ['x']);
    expect(await store.read('album')).toEqual([]);
    await store.clear();
    expect(await store.readMeta()).toBeNull();
  });
});
