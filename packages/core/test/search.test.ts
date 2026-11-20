import { describe, expect, it } from 'vitest';

import { LibraryIndex, isEmptyResult, normalize, rememberSearch, score } from '../src/search';
import { album, artist, playlist, track } from './fixtures';

describe('normalize', () => {
  it('lower-cases, strips accents and punctuation, keeps Gujarati', () => {
    expect(normalize("  Beyoncé's  Halo! ")).toBe('beyonce s halo');
    expect(normalize('કિશોર કુમાર')).toBe('કિશોર કુમાર');
    expect(normalize('A.B.C.')).toBe('a b c');
  });
});

describe('score', () => {
  it('ranks exact, prefix, word, substring, then secondary fields', () => {
    expect(score('halo', 'halo', '')).toBe(100);
    expect(score('hal', 'halo', '')).toBe(80);
    expect(score('light', 'northern light', '')).toBe(60);
    expect(score('orth', 'northern light', '')).toBe(40);
    expect(score('kevin snitch', 'sneaky snitch', 'kevin macleod')).toBe(35);
    expect(score('kevin', 'sneaky snitch', 'kevin macleod')).toBe(30);
    expect(score('leod', 'sneaky snitch', 'kevin macleod')).toBe(20);
    expect(score('zzz', 'sneaky snitch', 'kevin macleod')).toBe(0);
    expect(score('', 'x', 'y')).toBe(0);
  });
});

describe('LibraryIndex', () => {
  const index = new LibraryIndex({
    tracks: [
      track('t1', {
        title: 'Sneaky Snitch',
        artistName: 'Kevin MacLeod',
        albumTitle: 'Royalty Free',
      }),
      track('t2', { title: 'Carefree', artistName: 'Kevin MacLeod', playCount: 9 }),
      track('t3', { title: 'Fluffing a Duck', artistName: 'Kevin MacLeod', isFavorite: true }),
      track('t4', { title: 'Snitch Theme', artistName: 'Someone' }),
    ],
    albums: [album('al1', { title: 'Royalty Free', artistName: 'Kevin MacLeod', year: 2010 })],
    artists: [artist('a1', { name: 'Kevin MacLeod' })],
    playlists: [playlist('p1', { name: 'Sneaky mix' })],
  });

  it('finds every kind and orders by match quality, then plays and favourites', () => {
    const hits = index.search('sneaky');
    expect(hits.tracks.map((t) => t.id)).toEqual(['t1']);
    expect(hits.playlists.map((p) => p.name)).toEqual(['Sneaky mix']);
    expect(hits.albums).toEqual([]);
    const snitch = index.search('snitch');
    expect(snitch.tracks.map((t) => t.id)).toEqual(['t4', 't1']);
    const kevin = index.search('kevin');
    expect(kevin.artists[0]?.id).toBe('a1');
    expect(kevin.albums[0]?.id).toBe('al1');
    expect(kevin.tracks.map((t) => t.id)).toEqual(['t2', 't3', 't1']);
  });

  it('groups the kinds by their best match, so an exact artist or album name leads the list', () => {
    // 'kevin macleod' is the artist's exact name; the songs and the album only carry it as their
    // artist (an equal score, so songs keep their place before albums).
    const kevin = index.groups('kevin macleod');
    expect(kevin.map((g) => g.kind)).toEqual(['artist', 'track', 'album']);
    expect(kevin[0]?.items.map((i) => i.id)).toEqual(['a1']);
    // The album's exact title beats the songs on it; the playlist that starts with the word comes next.
    const royalty = index.groups('royalty free');
    expect(royalty.map((g) => g.kind)).toEqual(['album', 'track']);
    // A tie keeps songs first: 'sneaky' is a prefix of the song and of the playlist.
    expect(index.groups('sneaky').map((g) => g.kind)).toEqual(['track', 'playlist']);
    // Kinds with no hit are left out; blank input gives nothing.
    expect(index.groups('snitch').map((g) => g.kind)).toEqual(['track']);
    expect(index.groups('  ')).toEqual([]);
    // The big library: an artist named exactly what was typed comes before songs containing the digits.
    const big = new LibraryIndex({
      tracks: Array.from({ length: 2000 }, (_, i) =>
        track(`t${i}`, { title: `Song ${10000 + i}`, artistName: `Artist ${i % 500}` }),
      ),
      artists: Array.from({ length: 500 }, (_, i) => artist(`a${i}`, { name: `Artist ${i}` })),
    });
    const groups = big.groups('Artist 499', 4);
    expect(groups[0]?.kind).toBe('artist');
    expect(groups[0]?.items[0]?.id).toBe('a499');
  });

  it('respects the limit, handles blank input and reports size', () => {
    expect(index.search('kevin', 2).tracks).toHaveLength(2);
    expect(isEmptyResult(index.search('   '))).toBe(true);
    expect(isEmptyResult(index.search('nothing here'))).toBe(true);
    expect(index.size).toBe(7);
  });

  it('answers in well under 100 ms for 20,000 tracks', () => {
    const big = new LibraryIndex({
      tracks: Array.from({ length: 20_000 }, (_, i) =>
        track(`t${i}`, {
          title: `Song number ${i} about ${i % 7 ? 'rain' : 'sun'}`,
          artistName: `Artist ${i % 500}`,
        }),
      ),
    });
    const started = performance.now();
    const hits = big.search('about sun', 8);
    const elapsed = performance.now() - started;
    expect(hits.tracks).toHaveLength(8);
    expect(elapsed).toBeLessThan(100);
  });

  it('can be rebuilt kind by kind', () => {
    const idx = new LibraryIndex();
    expect(idx.size).toBe(0);
    idx.rebuild({ artists: [artist('a1', { name: 'Kishore Kumar' })] });
    expect(idx.search('kishore').artists).toHaveLength(1);
  });
});

describe('rememberSearch', () => {
  it('keeps the newest first, removes duplicates case-insensitively, caps and trims', () => {
    let recent: string[] = [];
    recent = rememberSearch(recent, ' duck ');
    recent = rememberSearch(recent, 'kevin');
    recent = rememberSearch(recent, 'Duck');
    expect(recent).toEqual(['Duck', 'kevin']);
    expect(rememberSearch(recent, '   ')).toEqual(recent);
    for (let i = 0; i < 20; i++) recent = rememberSearch(recent, `q${i}`);
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe('q19');
  });
});
