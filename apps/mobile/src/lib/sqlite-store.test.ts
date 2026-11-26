import { DatabaseSync } from 'node:sqlite';

import { loadSnapshot, syncLibrary } from '@renaissance/core';
import type { Library, LibraryMeta, Track } from '@renaissance/core';

import { SqliteLibraryStore } from './sqlite-store';
import type { SqlDatabase } from './sqlite-store';

/** expo-sqlite's async API over Node's own SQLite, so the store runs real SQL in the tests. */
function nodeDb(): SqlDatabase & { closed: boolean } {
  const db = new DatabaseSync(':memory:');
  const wrapper = {
    closed: false,
    execAsync: (source: string) => {
      db.exec(source);
      return Promise.resolve();
    },
    runAsync: (source: string, params: (string | number | null)[]) => {
      db.prepare(source).run(...params);
      return Promise.resolve();
    },
    getAllAsync: <T>(source: string, params: (string | number | null)[]) =>
      Promise.resolve(db.prepare(source).all(...params) as T[]),
    getFirstAsync: <T>(source: string, params: (string | number | null)[]) =>
      Promise.resolve((db.prepare(source).get(...params) as T | undefined) ?? null),
    withTransactionAsync: async (task: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    closeAsync: () => {
      wrapper.closed = true;
      db.close();
      return Promise.resolve();
    },
  };
  return wrapper;
}

const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id,
  title: `Song ${id}`,
  artistIds: ['a1'],
  artistName: 'Artist',
  duration: 100,
  isFavorite: false,
  playCount: 0,
  genres: ['Jazz'],
  dateAdded: '2026-01-01T00:00:00.000Z',
  ...extra,
});

describe('SqliteLibraryStore', () => {
  it('writes, reads, counts, removes and replaces each kind', async () => {
    const store = new SqliteLibraryStore(() => Promise.resolve(nodeDb()));
    await store.opened();
    await store.write('track', [track('1'), track('2')]);
    await store.write('track', [track('2', { title: 'Again' })]);
    expect(await store.count('track')).toBe(2);
    expect((await store.read('track')).find((t) => t.id === '2')).toMatchObject({ title: 'Again' });
    await store.remove('track', ['1']);
    expect((await store.read('track')).map((t) => t.id)).toEqual(['2']);
    await store.replace('track', [track('3')]);
    expect((await store.read('track')).map((t) => t.id)).toEqual(['3']);
    await store.write('track', []);
    await store.remove('track', []);
    expect(await store.count('album')).toBe(0);
  });

  it('writes more rows than one statement binds, in chunks', async () => {
    const store = new SqliteLibraryStore(() => Promise.resolve(nodeDb()));
    const many = Array.from({ length: 1234 }, (_, i) => track(String(i)));
    await store.replace('track', many);
    expect(await store.count('track')).toBe(1234);
    await store.remove(
      'track',
      many.slice(0, 600).map((t) => t.id),
    );
    expect(await store.count('track')).toBe(634);
  });

  it('keeps the meta, refuses a bad one, and clears everything', async () => {
    const db = nodeDb();
    const store = new SqliteLibraryStore(() => Promise.resolve(db));
    expect(await store.readMeta()).toBeNull();
    const meta: LibraryMeta = { syncedAt: '2026-01-02T00:00:00.000Z', albumArtistIds: ['a1'] };
    await store.writeMeta(meta);
    expect(await store.readMeta()).toEqual(meta);
    await db.runAsync('INSERT OR REPLACE INTO meta (id, json) VALUES (1, ?)', ['{"syncedAt":1}']);
    expect(await store.readMeta()).toBeNull();
    await db.runAsync('INSERT OR REPLACE INTO meta (id, json) VALUES (1, ?)', ['not json']);
    expect(await store.readMeta()).toBeNull();
    await store.write('album', [
      {
        id: 'al',
        title: 'A',
        artistIds: [],
        artistName: '',
        genres: [],
        isFavorite: false,
        playCount: 0,
      },
    ]);
    await store.clear();
    expect(await store.count('album')).toBe(0);
    expect(await store.readMeta()).toBeNull();
    await store.close();
    expect(db.closed).toBe(true);
  });

  it('skips a row that is not JSON instead of failing the read', async () => {
    const db = nodeDb();
    const store = new SqliteLibraryStore(() => Promise.resolve(db));
    await store.write('track', [track('1')]);
    await db.runAsync('INSERT INTO track (id, json) VALUES (?, ?)', ['bad', '{']);
    expect((await store.read('track')).map((t) => t.id)).toEqual(['1']);
  });

  it('rolls a failed write back as a whole', async () => {
    const db = nodeDb();
    const store = new SqliteLibraryStore(() => Promise.resolve(db));
    await store.write('track', [track('1')]);
    const bad = { ...track('2'), id: null } as unknown as Track;
    await expect(store.replace('track', [bad])).rejects.toThrow();
    expect((await store.read('track')).map((t) => t.id)).toEqual(['1']);
  });

  it('rejects when the database cannot open', async () => {
    const store = new SqliteLibraryStore(() => Promise.reject(new Error('denied')));
    await expect(store.opened()).rejects.toThrow('denied');
  });

  it("runs core's full sync into SQLite and reads the snapshot back", async () => {
    const tracks = [track('1'), track('2', { isFavorite: true })];
    const page = <T>(items: T[]) => Promise.resolve({ items, total: items.length });
    const library = {
      artists: () => page([{ id: 'a1', name: 'Artist', isFavorite: false, playCount: 0 }]),
      albumArtists: () => page([]),
      playlists: () => page([]),
      tracks: () => page(tracks),
      albums: () => page([]),
    } as unknown as Library;
    const store = new SqliteLibraryStore(() => Promise.resolve(nodeDb()));
    const result = await syncLibrary(library, store);
    expect(result.mode).toBe('full');
    const snapshot = await loadSnapshot(store);
    expect(snapshot.tracks.map((t) => t.id).sort()).toEqual(['1', '2']);
    expect(snapshot.genres).toEqual(['Jazz']);
  });
});
