/**
 * Which catalogue rows answer the words typed, and in what order (design P, Q, X). MusicBrainz and
 * Deezer both return rows that merely contain a word of the query: an artist's name inside another
 * song's title, a mixtape named after the artist, or, for a sentence, songs that happen to share one
 * word with it ("Something's Cooking" for "play something calm for cooking"). Rows are scored by how
 * much of the query they cover and how much of their own title and artist the query covers, the
 * exact title and artist first; rows below a threshold are dropped, and the threshold is stricter
 * when the words read as a sentence, so a sentence shows rows only when one of them is the title
 * itself. Words match on a prefix (the typeahead sends "firem") and within one typo ("firman").
 * None of this is a model: it is token overlap.
 */
import type {
  CatalogueAlbum,
  CatalogueArtist,
  CatalogueSearch,
  CatalogueSong,
} from '@renaissance/core';

import { contentTokens, looksLikeSentence, normalize, tokens } from '../text.js';

/** Share of a query's content words found in a row: up to three words must all match, four allow one miss. */
export const MIN_COVERAGE = 0.7;
/** For a sentence: the row must be the title (and artist) itself. */
export const SENTENCE_COVERAGE = 0.75;

/** Levenshtein distance, capped: only "is it within one edit" is ever asked. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (edits > 0) return false;
    edits = 1;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** A typed word stands for a row's word when equal, a prefix of it, or one typo away (4+ letters). */
export function wordMatches(typed: string, word: string): boolean {
  if (typed === word) return true;
  if (typed.length >= 2 && word.startsWith(typed)) return true;
  return typed.length >= 4 && word.length >= 4 && withinOneEdit(typed, word);
}

function covered(want: readonly string[], have: readonly string[]): number {
  if (want.length === 0) return 0;
  let hit = 0;
  for (const t of want) if (have.some((h) => wordMatches(t, h) || wordMatches(h, t))) hit += 1;
  return hit / want.length;
}

export interface ScoredRow<T> {
  row: T;
  /** How much of the query the row covers (0 to 1). */
  coverage: number;
  /** Exact title and artist both in the query, title in the query, then overlap sums. */
  score: number;
}

/** Score one row: `names` are its title and artist (or an artist's name), `extra` its album. */
export function scoreRow<T>(
  row: T,
  query: readonly string[],
  names: { title: string; artist?: string; extra?: string },
): ScoredRow<T> {
  const titleTokens = tokens(names.title);
  const artistTokens = names.artist ? tokens(names.artist) : [];
  const rowTokens = [...titleTokens, ...artistTokens, ...tokens(names.extra ?? '')];
  const coverage = covered(query, rowTokens);
  const titleIn = covered(titleTokens, query);
  const artistIn = artistTokens.length > 0 ? covered(artistTokens, query) : 0;
  const exactTitle = titleIn === 1;
  const exactArtist = artistTokens.length > 0 && artistIn === 1;
  const score =
    (exactTitle && exactArtist ? 100 : 0) +
    (exactTitle ? 20 : 0) +
    coverage * 10 +
    titleIn * 5 +
    artistIn * 5;
  return { row, coverage, score };
}

function order<T>(scored: ScoredRow<T>[], keep: (s: ScoredRow<T>) => boolean): T[] {
  return scored
    .map((s, i) => ({ ...s, i }))
    .filter(keep)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.row);
}

/**
 * The rows that answer the query, best first. The query's command words and filler are ignored
 * ("play fireman lil wayne" asks about "fireman lil wayne"); rows that cover too little of what is
 * left are dropped; for a sentence only a row that is the title itself survives. An album or an
 * artist also stays when a surviving song belongs to it, so "fireman" still shows Tha Carter II and
 * Lil Wayne under the song.
 */
export function relevantRows<T extends Pick<CatalogueSearch, 'songs' | 'albums' | 'artists'>>(
  query: string,
  result: T,
): T {
  const words = contentTokens(query);
  if (words.length === 0) return result;
  const threshold = looksLikeSentence(query) ? SENTENCE_COVERAGE : MIN_COVERAGE;
  const songs = order(
    result.songs.map((s: CatalogueSong) =>
      scoreRow(s, words, {
        title: s.title,
        artist: s.artist,
        ...(s.album ? { extra: s.album } : {}),
      }),
    ),
    (s) => s.coverage >= threshold,
  );
  const songAlbums = new Set(
    songs.map((s) => `${normalize(s.album ?? '')}|${normalize(s.artist)}`),
  );
  const songArtists = new Set(songs.map((s) => normalize(s.artist)));
  const albums = order(
    result.albums.map((a: CatalogueAlbum) =>
      scoreRow(a, words, { title: a.title, artist: a.artist }),
    ),
    (s) =>
      s.coverage >= threshold ||
      songAlbums.has(`${normalize(s.row.title)}|${normalize(s.row.artist)}`),
  );
  for (const a of albums) songArtists.add(normalize(a.artist));
  const artists = order(
    result.artists.map((a: CatalogueArtist) => scoreRow(a, words, { title: a.name })),
    (s) => s.coverage >= threshold || songArtists.has(normalize(s.row.name)),
  );
  return { ...result, songs, albums, artists };
}
