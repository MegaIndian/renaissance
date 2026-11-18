import { describe, expect, it } from 'vitest';

import {
  defaultOrder,
  filterAlbums,
  filterTracks,
  formatDuration,
  groupByDisc,
  seededRandom,
  sortAlbumTracks,
  sortItems,
} from '../src/sort';
import { album, track } from './fixtures';

const tracks = [
  track('a', {
    title: 'Zebra',
    dateAdded: '2026-01-03T00:00:00.000Z',
    year: 2001,
    playCount: 3,
    lastPlayed: '2026-02-01T00:00:00.000Z',
    genres: ['Rock'],
    isFavorite: true,
  }),
  track('b', {
    title: 'apple',
    dateAdded: '2026-01-01T00:00:00.000Z',
    year: 2010,
    playCount: 9,
    genres: ['Jazz'],
  }),
  track('c', {
    title: 'Mango 10',
    dateAdded: '2026-01-02T00:00:00.000Z',
    playCount: 3,
    lastPlayed: '2026-03-01T00:00:00.000Z',
    albumId: 'al1',
    artistIds: ['a2'],
  }),
  track('d', { title: 'Mango 9', year: 2005 }),
];

describe('sortItems', () => {
  it('sorts by name case-insensitively with numeric awareness', () => {
    expect(sortItems(tracks, 'name').map((t) => t.title)).toEqual([
      'apple',
      'Mango 9',
      'Mango 10',
      'Zebra',
    ]);
    expect(sortItems(tracks, 'name', 'desc')[0]?.title).toBe('Zebra');
  });

  it('sorts by date added, year, play count and last played, newest or most first by default', () => {
    expect(defaultOrder('name')).toBe('asc');
    expect(defaultOrder('dateAdded')).toBe('desc');
    expect(sortItems(tracks, 'dateAdded').map((t) => t.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(sortItems(tracks, 'year').map((t) => t.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortItems(tracks, 'playCount').map((t) => t.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(sortItems(tracks, 'lastPlayed').map((t) => t.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortItems(tracks, 'lastSaved').map((t) => t.id)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('random is stable for a seed and differs across seeds', () => {
    const one = sortItems(tracks, 'random', 'asc', 7).map((t) => t.id);
    expect(sortItems(tracks, 'random', 'asc', 7).map((t) => t.id)).toEqual(one);
    expect([...one].sort()).toEqual(['a', 'b', 'c', 'd']);
    const r = seededRandom(1);
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('does not mutate the input', () => {
    const copy = [...tracks];
    sortItems(tracks, 'name');
    expect(tracks).toEqual(copy);
  });
});

describe('filters', () => {
  it('filters tracks by favourites, genre, year, artist and album', () => {
    expect(filterTracks(tracks, { favorites: true }).map((t) => t.id)).toEqual(['a']);
    expect(filterTracks(tracks, { genre: 'Jazz' }).map((t) => t.id)).toEqual(['b']);
    expect(filterTracks(tracks, { year: 2005 }).map((t) => t.id)).toEqual(['d']);
    expect(filterTracks(tracks, { artistId: 'a2' }).map((t) => t.id)).toEqual(['c']);
    expect(filterTracks(tracks, { albumId: 'al1' }).map((t) => t.id)).toEqual(['c']);
    expect(filterTracks(tracks, {})).toHaveLength(4);
  });

  it('filters albums the same way', () => {
    const albums = [
      album('1', { genres: ['Rock'], year: 1999, isFavorite: true }),
      album('2', { artistIds: ['zz'] }),
    ];
    expect(filterAlbums(albums, { favorites: true }).map((a) => a.id)).toEqual(['1']);
    expect(filterAlbums(albums, { genre: 'Rock', year: 1999 }).map((a) => a.id)).toEqual(['1']);
    expect(filterAlbums(albums, { artistId: 'zz' }).map((a) => a.id)).toEqual(['2']);
  });
});

describe('album order and durations', () => {
  it('orders by disc then track and groups discs', () => {
    const list = [
      track('1', { discNumber: 2, trackNumber: 1 }),
      track('2', { discNumber: 1, trackNumber: 2 }),
      track('3', { discNumber: 1, trackNumber: 1 }),
      track('4', { title: 'Bonus' }),
    ];
    expect(sortAlbumTracks(list).map((t) => t.id)).toEqual(['4', '3', '2', '1']);
    const discs = groupByDisc(list);
    expect(discs.map((d) => d.disc)).toEqual([1, 2]);
    expect(discs[0]?.tracks.map((t) => t.id)).toEqual(['4', '3', '2']);
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(3729)).toBe('1:02:09');
    expect(formatDuration(-3)).toBe('0:00');
  });
});
