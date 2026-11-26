import { describe, expect, it } from 'vitest';

import { artistKey, creditsArtist, creditsOf, findArtist, mergeArtists } from '../src/artists';
import { buildSnapshot } from '../src/library-cache';
import { LibraryIndex } from '../src/search';
import { album, artist, track } from './fixtures';

/** The demo server's shape: `/Artists` lists one id, every track and album carries another. */
const metadataArtist = artist('53d2', { name: 'Kevin MacLeod', imageId: '53d2', bio: 'Composer' });
const tracks = ['Carefree', 'Sneaky Snitch'].map((title, i) =>
  track(`t${i}`, {
    title,
    artistIds: ['1e42'],
    artistName: 'Kevin MacLeod',
    artistCredits: [{ id: '1e42', name: 'Kevin MacLeod' }],
    albumId: 'al1',
  }),
);
const albums = [
  album('al1', {
    artistIds: ['1e42'],
    artistName: 'Kevin MacLeod',
    artistCredits: [{ id: '1e42', name: 'Kevin MacLeod' }],
  }),
];

describe('mergeArtists', () => {
  it('merges two ids for one name into one artist that keeps the server entry and lists both ids', () => {
    const merged = mergeArtists([metadataArtist], tracks, albums);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: '53d2', name: 'Kevin MacLeod', bio: 'Composer' });
    expect(merged[0]?.ids).toEqual(['53d2', '1e42']);
  });

  it('keys on the normalised name: case, spacing and compatibility forms are one artist', () => {
    const merged = mergeArtists(
      [artist('a', { name: 'Kevin  MacLeod' })],
      [
        track('t', {
          artistIds: ['b'],
          artistName: 'kevin macleod',
          artistCredits: [{ id: 'b', name: 'kevin macleod' }],
        }),
      ],
      [],
    );
    expect(merged.map((a) => a.ids)).toEqual([['a', 'b']]);
    expect(artistKey('ＡＢＢＡ ')).toBe('abba');
  });

  it('a credited id the server already lists never opens a second artist, whatever the item spells', () => {
    const merged = mergeArtists(
      [artist('a1'), artist('a2')],
      [track('t', { artistIds: ['a1'], artistName: 'Artist' })],
      [],
    );
    expect(merged.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('an artist that only appears in credits is built from the first credit', () => {
    const merged = mergeArtists(
      [],
      [
        track('t', {
          artistIds: ['x'],
          artistName: 'Only In Tracks',
          artistCredits: [{ id: 'x', name: 'Only In Tracks' }],
        }),
      ],
      [],
    );
    expect(merged).toEqual([
      { id: 'x', name: 'Only In Tracks', isFavorite: false, playCount: 0, ids: ['x'] },
    ]);
  });

  it('records cached before credits were stored pair a single id with the single name', () => {
    expect(creditsOf({ artistIds: ['a'], artistName: 'One' })).toEqual([{ id: 'a', name: 'One' }]);
    expect(creditsOf({ artistIds: ['a', 'b'], artistName: 'One, Two' })).toEqual([]);
    expect(creditsOf({ artistIds: [], artistName: '' })).toEqual([]);
  });

  it('two server entries with one name keep the one with art and either favourite', () => {
    const merged = mergeArtists(
      [
        artist('a', { name: 'Dup', isFavorite: true }),
        artist('b', { name: 'Dup', imageId: 'img' }),
      ],
      [],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'b', imageId: 'img', isFavorite: true, ids: ['b', 'a'] });
  });
});

describe('findArtist and creditsArtist', () => {
  const artists = mergeArtists([metadataArtist], tracks, albums);
  it('resolves by either id, then by name, else undefined', () => {
    expect(findArtist(artists, '53d2')?.id).toBe('53d2');
    expect(findArtist(artists, '1e42')?.id).toBe('53d2');
    expect(findArtist(artists, 'nope', 'kevin macleod')?.id).toBe('53d2');
    expect(findArtist(artists, 'nope')).toBeUndefined();
    expect(findArtist(artists, undefined, 'Someone Else')).toBeUndefined();
  });

  it('matches items by any merged id or by the credited name', () => {
    const kevin = artists[0] as (typeof artists)[number];
    expect(tracks.every((t) => creditsArtist(t, kevin))).toBe(true);
    expect(creditsArtist(albums[0] as (typeof albums)[number], kevin)).toBe(true);
    expect(
      creditsArtist(track('z', { artistIds: ['zz'], artistName: 'KEVIN MACLEOD' }), kevin),
    ).toBe(true);
    expect(creditsArtist(track('y', { artistIds: ['yy'], artistName: 'Other' }), kevin)).toBe(
      false,
    );
  });
});

describe('the snapshot', () => {
  it('lists one merged artist, resolves album artists through merged ids, and indexes it once', () => {
    const snapshot = buildSnapshot(tracks, albums, [metadataArtist], [], {
      syncedAt: '2026-01-01T00:00:00.000Z',
      albumArtistIds: ['53d2'],
    });
    expect(snapshot.artists.map((a) => a.ids)).toEqual([['53d2', '1e42']]);
    expect(snapshot.albumArtists.map((a) => a.id)).toEqual(['53d2']);
    expect(new LibraryIndex(snapshot).search('kevin').artists).toHaveLength(1);
  });
});
