/**
 * Which catalogue rows answer the words typed, and in what order (design P, Q, X). MusicBrainz and
 * Deezer both return rows that merely contain a word of the query: an artist's name inside another
 * song's title, a mixtape named after the artist, or, for a sentence, songs that happen to share one
 * word with it ("Something's Cooking" for "play something calm for cooking"). Rows are scored by how
 * much of the query they cover and how much of their own title and artist the query covers, the
 * exact title and artist first; rows below a threshold are dropped, and the threshold is stricter
 * when the words read as a sentence, so a sentence shows rows only when one of them is the title
 * itself. Words match on a prefix (the typeahead sends "firem") and within one typo ("firman",
 * "califronia": two letters swapped are one edit). Coverage is counted on the title and the
 * artist; the album's words count only once the title is the one typed (functionality AE). A row
 * whose title or artist carries a version word (live, remix, karaoke, tribute, "made famous",
 * clean) the query did not ask for is another song than the one typed and ranks under every plain
 * row (design AA), and so does a row whose album is a live, tour or compilation record or a
 * karaoke or workout series (design AH, AS). The title is compared after its edition tags are
 * stripped ("Hotel California (2013 Remaster)" is the title "Hotel California"), and a title is
 * exact only when it covers the words typed that are not the artist's (functionality Q); the
 * artist is exact when the words name it whole or its first credit ("Lil Wayne feat. Static
 * Major", functionality Z). Once the song by the artist is in the list, rows by other artists
 * whose title merely names that artist go, albums too and their artists with them (design AI,
 * functionality AC). None of this is a model: it is token overlap.
 */
import type {
  CatalogueAlbum,
  CatalogueArtist,
  CatalogueSearch,
  CatalogueSong,
} from '@renaissance/core';

import { cleanTitle } from '../fetch/clean.js';
import { contentTokens, looksLikeSentence, normalize, tokens } from '../text.js';

/** Share of a query's content words found in a row: up to three words must all match, four allow one miss. */
export const MIN_COVERAGE = 0.7;
/** For a sentence: the row must be the title (and artist) itself. */
export const SENTENCE_COVERAGE = 0.75;

/**
 * Damerau-Levenshtein distance, capped: only "is it within one edit" is ever asked. Two adjacent
 * letters swapped ("califronia" for "california") are one edit, the typo people make most
 * (functionality AA).
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diffs: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
    if (diffs.length <= 1) return true;
    const [x, y] = diffs;
    return diffs.length === 2 && y === x! + 1 && a[x!] === b[y] && a[y] === b[x!];
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < long.length && j < short.length) {
    if (long[i] === short[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    i += 1;
  }
  return true;
}

/**
 * The first credited artist: "Lil Wayne" for "Lil Wayne feat. Static Major", "Simon" for "Simon &
 * Garfunkel". A song is that artist's whatever the credit appends, so the primary credit is what
 * the typed artist is compared with and what a row is deduplicated by (functionality Z).
 */
export function primaryArtist(name: string): string {
  const first = name.split(/\s*(?:,|&|\+|\/|\b(?:feat|ft|featuring|with)\b\.?)\s*/i)[0] ?? name;
  return normalize(first) || normalize(name);
}

/**
 * A typed word stands for a row's word when equal, a prefix of it, or one typo away. Five letters
 * at least for the typo: four-letter words are one edit from too many others ("live", "love",
 * "life"), and "Love of My Life" must not be the title typed as "live".
 */
export const FUZZY_MIN_LETTERS = 5;
export function wordMatches(typed: string, word: string): boolean {
  if (typed === word) return true;
  if (typed.length >= 2 && word.startsWith(typed)) return true;
  return (
    typed.length >= FUZZY_MIN_LETTERS &&
    word.length >= FUZZY_MIN_LETTERS &&
    withinOneEdit(typed, word)
  );
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
  /** The title and the artist are both the words typed, and no version word was added to them. */
  exact: boolean;
  /** The title (edition tags stripped) is the words typed that are not the artist's. */
  exactTitle: boolean;
  /** No version word in the title, the artist or the album that the query did not ask for. */
  plain: boolean;
}

/**
 * Words that mark another version of a song than the plain one: in a title ("Halo (Live)",
 * "Fireman (Remix)") or an artist ("Adele Tribute Band", "Karaoke Hits"). Single words and the
 * phrases tribute acts use.
 */
export const VERSION_WORDS = new Set(
  'live remix remixes rmx mix karaoke cover covers tribute stripped instrumental acoustic unplugged demo edit nightcore sped slowed reverb clean main cappella acapella chopped screwed'.split(
    ' ',
  ),
);
export const VERSION_PHRASES = [
  'originally performed',
  'made famous',
  'in the style of',
  'radio edit',
  'club mix',
  'extended mix',
  'backing track',
  'sing along',
];
/**
 * Words in an album's name that make the row another recording than the studio one: a live or
 * tour record, a radio session, a karaoke or tribute collection, a "year mix" (design AH). A
 * studio album named "Live Through This" would be caught too; the penalty only orders rows that
 * all answer the words, it never drops one.
 */
export const ALBUM_VERSION_WORDS = new Set(
  'live concert tour unplugged session sessions karaoke tribute hits vol workout'.split(' '),
);
/** Karaoke and workout series name themselves by genre and number: "Girl Pop 12", "Pure Energy Workout" (design AS). */
export const ALBUM_VERSION_PHRASES = [
  'year mix',
  'pop hits',
  'girl pop',
  'made famous',
  'in the style of',
];
/** How far a version word pushes a row: under every plain row that covers the words at all. */
export const VERSION_PENALTY = 60;

/** The version words in a title or artist that the query did not ask for. */
export function versionWords(
  text: string,
  query: readonly string[],
  vocabulary: { words: ReadonlySet<string>; phrases: readonly string[] } = {
    words: VERSION_WORDS,
    phrases: VERSION_PHRASES,
  },
): string[] {
  const asked = new Set(query);
  const found = tokens(text).filter((t) => vocabulary.words.has(t) && !asked.has(t));
  const norm = normalize(text);
  const queryText = query.join(' ');
  for (const phrase of vocabulary.phrases) {
    if (norm.includes(phrase) && !queryText.includes(phrase)) found.push(phrase);
  }
  return found;
}

/** The album words that mark a live, tour, session or compilation record the query did not ask for. */
export function albumVersionWords(album: string, query: readonly string[]): string[] {
  return versionWords(album, query, { words: ALBUM_VERSION_WORDS, phrases: ALBUM_VERSION_PHRASES });
}

/**
 * The title as a song is named, for the exact-title test: edition and version tags in brackets or
 * after a dash go ("A Milli (Album Version Explicit)", "Hotel California - 2013 Remaster" are the
 * plain titles). A title that is nothing but tags keeps its words.
 */
export function comparableTitle(title: string): string {
  return cleanTitle(title) || normalize(title);
}

/** Score one row: `names` are its title and artist (or an artist's name), `extra` its album. */
export function scoreRow<T>(
  row: T,
  query: readonly string[],
  names: { title: string; artist?: string; extra?: string },
): ScoredRow<T> {
  const plainTitle = comparableTitle(names.title);
  const artistTokens = names.artist ? tokens(names.artist) : [];
  const albumTokens = tokens(names.extra ?? '');
  // The query lost its filler ("in", "the"), so a title is compared by its content words too:
  // "Rolling in the Deep" is the exact title for "rolling deep adele".
  const titleIn = covered(contentTokens(plainTitle), query);
  // Coverage comes from the title and the artist. The album's words count only once the title is
  // the one typed ("fireman tha carter ii" keeps Fireman), never on their own: "Love of My Life"
  // from the Bohemian Rhapsody soundtrack is not an answer to "bohemian rhapsody queen"
  // (functionality AE).
  const rowTokens = [
    ...tokens(names.title),
    ...artistTokens,
    ...(titleIn === 1 ? albumTokens : []),
  ];
  const coverage = covered(query, rowTokens);
  // Half the artist's words at least: one fuzzy word out of five ("that" for "Phat" in "Gordon
  // Goodwin's Big Phat Band") is noise, and must not put that row over Deezer's first. The first
  // credit alone counts as the whole artist: "Lil Wayne feat. Static Major" is Lil Wayne's row
  // (functionality Z).
  const primaryTokens = names.artist ? tokens(primaryArtist(names.artist)) : [];
  const artistCovered =
    artistTokens.length > 0
      ? Math.max(
          covered(artistTokens, query),
          primaryTokens.length < artistTokens.length ? covered(primaryTokens, query) : 0,
        )
      : 0;
  const artistIn = artistCovered >= 0.5 ? artistCovered : 0;
  const exactArtist = artistTokens.length > 0 && artistIn === 1;
  // The title must also cover the words typed that are not the artist's: "California" by Hotel
  // Valmont is a subset of "hotel california", not the title; "Hotel California" is. The artist's
  // words are set aside only when the whole artist was typed.
  const beyondArtist = exactArtist
    ? query.filter((q) => !artistTokens.some((a) => wordMatches(q, a) || wordMatches(a, q)))
    : query;
  const exactTitle =
    titleIn === 1 &&
    (beyondArtist.length === 0 || covered(beyondArtist, tokens(names.title)) === 1);
  const versions = [
    ...versionWords(`${names.title} ${names.artist ?? ''}`, query),
    ...(names.extra ? albumVersionWords(names.extra, query) : []),
  ];
  // The album is a tiebreak between rows that answer the words alike, worth less than a word and
  // counted on whole words only (a fuzzy "that" for "Phat" is noise here too); a single named
  // after the song says nothing more than its title did.
  const albumIn =
    albumTokens.length > 0 && comparableTitle(names.extra ?? '') !== plainTitle
      ? query.filter((q) => albumTokens.includes(q)).length / query.length
      : 0;
  const score =
    (exactTitle && exactArtist ? 100 : 0) +
    (exactTitle ? 20 : 0) +
    coverage * 10 +
    titleIn * 5 +
    artistIn * 5 +
    albumIn * 2 -
    (versions.length > 0 ? VERSION_PENALTY : 0);
  const plain = versions.length === 0;
  return { row, coverage, score, exact: exactTitle && exactArtist && plain, exactTitle, plain };
}

/** True when every content word of a title (edition tags stripped) is among the words typed. */
export function titleInQuery(title: string, query: readonly string[]): boolean {
  const words = contentTokens(comparableTitle(title));
  return words.length > 0 && covered(words, query) === 1;
}

/** True when a song row is the title and the artist typed, with no version word added. */
export function hasExactRow(
  query: string,
  result: { songs: readonly Pick<CatalogueSong, 'title' | 'artist'>[] },
): boolean {
  const words = contentTokens(query);
  if (words.length === 0) return false;
  return result.songs.some((s) => scoreRow(s, words, { title: s.title, artist: s.artist }).exact);
}

/**
 * True when the rows include the song typed, as the apps understand it (design AM): the title and
 * the artist when the words name both, else, for words that are a title alone ("fireman", "hotel
 * california"), a row with that title and no version word. Words that split into a title and an
 * artist none of the rows is ("set fire to the rain adele" over tribute acts) have no such row,
 * and neither do words that name an artist alone.
 */
export function isSongTyped(
  query: string,
  result: { songs: readonly Pick<CatalogueSong, 'title' | 'artist' | 'album'>[] },
): boolean {
  if (hasExactRow(query, result)) return true;
  const words = contentTokens(query);
  if (words.length === 0) return false;
  const artistNamed = result.songs.some((s) => {
    const artist = tokens(s.artist);
    return artist.length > 0 && artist.length < words.length && covered(artist, words) === 1;
  });
  if (artistNamed) return false;
  return result.songs.some((s) => {
    const scored = scoreRow(s, words, {
      title: s.title,
      artist: s.artist,
      ...(s.album ? { extra: s.album } : {}),
    });
    if (!scored.exactTitle || !scored.plain) return false;
    // Words left over from the title are an artist nobody in the list is.
    const titleWords = tokens(s.title);
    return words.every((w) => titleWords.some((t) => wordMatches(w, t) || wordMatches(t, w)));
  });
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
  const scoredSongs = result.songs.map((s: CatalogueSong) =>
    scoreRow(s, words, {
      title: s.title,
      artist: s.artist,
      ...(s.album ? { extra: s.album } : {}),
    }),
  );
  // Once the song by the artist is in the list, "Lil Wayne Fireman" by DJ Symphony and "Lil'
  // Wayne - Fireman (Streets)" by Alex Kresovich are not it: another artist's row whose title
  // names the asked artist goes (design AI).
  const exactArtists = scoredSongs
    .filter((s) => s.exact)
    .map((s) => tokens(s.row.artist))
    .filter((a) => a.length > 0);
  const namesAskedArtist = (s: ScoredRow<{ title: string; artist: string }>): boolean =>
    exactArtists.some(
      (artist) =>
        normalize(s.row.artist) !== artist.join(' ') && covered(artist, tokens(s.row.title)) === 1,
    );
  const songs = order(
    scoredSongs,
    (s) => s.coverage >= threshold && !(exactArtists.length > 0 && namesAskedArtist(s)),
  );
  const songAlbums = new Set(
    songs.map((s) => `${normalize(s.album ?? '')}|${normalize(s.artist)}`),
  );
  const songArtists = new Set(songs.map((s) => normalize(s.artist)));
  // The same rule for albums: "Lil Wayne A Milli" by DeShawn and "HALO (Beyonce Cover)" by a
  // tribute act are not the asked artist's records, and their artists go with them (functionality AC).
  const albums = order(
    result.albums.map((a: CatalogueAlbum) =>
      scoreRow(a, words, { title: a.title, artist: a.artist }),
    ),
    (s) =>
      (s.coverage >= threshold ||
        songAlbums.has(`${normalize(s.row.title)}|${normalize(s.row.artist)}`)) &&
      !(exactArtists.length > 0 && namesAskedArtist(s)),
  );
  for (const a of albums) songArtists.add(normalize(a.artist));
  const artists = order(
    result.artists.map((a: CatalogueArtist) => scoreRow(a, words, { title: a.name })),
    (s) => s.coverage >= threshold || songArtists.has(normalize(s.row.name)),
  );
  return { ...result, songs, albums, artists };
}
