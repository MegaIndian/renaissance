import { LibraryIndex, buildSnapshot, loadSnapshot } from '@renaissance/core';
import { describe, expect, it } from 'vitest';

import { albums, artists, playlists, session, tracks } from '../test/fakes';
import { IndexedDbLibraryStore, addItems, dbName, libraryStore, patchItems } from './library';

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
