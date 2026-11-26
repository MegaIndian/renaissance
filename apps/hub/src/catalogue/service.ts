/**
 * The catalogue (F61): songs, artists and albums for the words typed, from MusicBrainz, with art
 * and previews from Deezer and a Cover Art Archive URL where Deezer has nothing. Not an LLM.
 * Answers are cached in SQLite for a day; lookups by id for a week.
 *
 * Two speeds. MusicBrainz allows one request a second for the whole house, so the typeahead
 * (`fast`) never waits for it: it answers from the cache when the words were looked up before, else
 * from Deezer alone (tracks, albums and artists; art, previews, durations; no MusicBrainz ids),
 * marked `partial`. A full search (Enter, the model's context) asks MusicBrainz and waits its turn.
 * The pipeline's lookups (`vital`) are never refused and go ahead of the typing. Every list is
 * ranked and pruned by `relevance.ts` before it is cut to size, so a row answers the words typed
 * or is not shown, and a Deezer failure is never cached as "nothing found". When no row is the
 * title and artist typed, both speeds ask once more with the words split into a title and an
 * artist (the artist the rows name, or the words left over from an exact title) before ranking,
 * so a tribute act or a live take never stands first for a song the plain search listed others for.
 * Every answer says whether a row is the song typed (`exact`), whether the full search is still
 * running for it (`pending`) and whether MusicBrainz was busy and the rows are other versions
 * (`busy`), so the apps never put the one primary Add on a radio edit or a live take (design AM).
 */
import type {
  CatalogueAlbum,
  CatalogueArtist,
  CatalogueSearch,
  CatalogueSong,
} from '@renaissance/core';

import type { CacheStore } from '../db/cache.js';
import { cleanTitle } from '../fetch/clean.js';
import { HttpError, isBusy, sleep as realSleep } from '../http.js';
import { contentTokens, looksLikeSentence, normalize, tokenOverlap, tokens } from '../text.js';
import type { DeezerAlbum, DeezerArtist, DeezerClient, DeezerTrack } from './deezer.js';
import type {
  MbArtistCredit,
  MbRecording,
  MbRelease,
  MbReleaseGroup,
  MusicBrainzClient,
} from './musicbrainz.js';
import { fullSearchQuery, recordingQuery, releaseGroupQuery } from './musicbrainz.js';
import { LimiterBusyError } from './rate-limiter.js';
import {
  comparableTitle,
  hasExactRow,
  isSongTyped,
  primaryArtist,
  relevantRows,
  titleInQuery,
} from './relevance.js';

export const SEARCH_TTL_MS = 24 * 60 * 60_000;
export const LOOKUP_TTL_MS = 7 * 24 * 60 * 60_000;
export const FAST_TTL_MS = 10 * 60_000;
/**
 * How many recordings a title-and-artist lookup reads before choosing (MusicBrainz's maximum):
 * every "Billie Jean" scores alike in its search, and the recording on Thriller, with its 294
 * releases, sat past the fortieth of 154 while a compilation-only copy sat in the first forty
 * (design AL). One call either way.
 */
export const LOOKUP_LIMIT = 100;
/** How many recordings the full search reads before pruning: the song by the artist can sit past the first dozen. */
export const SEARCH_LIMIT = 50;
/** How long after MusicBrainz answered 503 past the retries the typeahead says "busy" instead of asking again. */
export const BUSY_MS = 60_000;
/** How many rows of each kind an answer carries, after pruning. */
export const ROW_LIMITS = { songs: 8, albums: 4, artists: 3 } as const;
/**
 * How long the typeahead waits for MusicBrainz when Deezer has no row that is the title and artist
 * typed (Deezer's catalogue lacks some originals altogether: Adele, Beyoncé's plain "Halo"). The
 * full search runs on regardless and lands in the cache for the next letters.
 */
export const FAST_WAIT_MS = 2_000;

export interface SearchOptions {
  /** The profile typing; a newer search from the same profile drops this one while it waits. */
  owner?: string;
  /** Typeahead: answer at once from the cache or Deezer; never wait for MusicBrainz. */
  fast?: boolean;
}

export interface LookupOptions {
  /** The caller's own duration in seconds: the version within a few seconds of it is the one meant. */
  duration?: number;
  /** The album the caller named: the recording's release of that name is preferred as the import target. */
  album?: string;
}

/** A Deezer track as a catalogue song: no MusicBrainz ids yet, everything the row needs. */
export function songFromDeezer(track: DeezerTrack): CatalogueSong {
  const song: CatalogueSong = {
    id: `dz:track:${track.id}`,
    title: track.title,
    artist: track.artist.name,
    album: track.album.title,
    duration: track.duration,
  };
  const cover = track.album.cover_medium ?? track.album.cover_big;
  if (cover) song.art = cover;
  if (track.preview) song.preview = track.preview;
  return song;
}

const yearOf = (date: string | undefined): number | undefined => {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isInteger(y) && y > 0 ? y : undefined;
};

/**
 * Words in an album's name that say it is not the studio record the song was made for: a live or
 * tour album, a compilation named for a year or a mix, a soundtrack or "This Is It" collection
 * (design AK). Used to choose between two editions of the same song, never to drop a row.
 */
export const COLLECTION_TITLE =
  /\b(live|concert|tour|unplugged|session|sessions|mix|megamix|remix|remixes|karaoke|tribute|hits|best of|greatest|collection|anthology|essential|essentials|soundtrack|ost|this is it|year|vol|volume|\d{4})\b/i;

/**
 * Which of two Deezer tracks with the same title and artist is the one people mean: the one on an
 * album that is not a live, tour or compilation record, then Deezer's own popularity, then the
 * one Deezer listed first.
 */
export function betterDeezerTrack(a: DeezerTrack, b: DeezerTrack): DeezerTrack {
  const collection = (t: DeezerTrack) => (COLLECTION_TITLE.test(t.album.title) ? 1 : 0);
  if (collection(a) !== collection(b)) return collection(a) < collection(b) ? a : b;
  if ((a.rank ?? 0) !== (b.rank ?? 0)) return (a.rank ?? 0) > (b.rank ?? 0) ? a : b;
  return a;
}

/**
 * The typeahead's rows from Deezer: the tracks found, the albums named (Deezer's album search first,
 * then the albums of the tracks) and the artists named, each once.
 */
export function fromDeezer(
  tracks: DeezerTrack[],
  albumHits: DeezerAlbum[] = [],
  artistHits: DeezerArtist[] = [],
): {
  songs: CatalogueSong[];
  albums: CatalogueAlbum[];
  artists: CatalogueArtist[];
} {
  // Songs once per title and artist, the studio edition kept when Deezer lists several (design AK).
  const songs = new Map<string, DeezerTrack>();
  // Albums once per title and artist: Deezer lists every edition as its own album.
  const albums = new Map<string, CatalogueAlbum>();
  const albumKey = (title: string, artist: string) => `${normalize(title)}|${normalize(artist)}`;
  const artists = new Map<number, CatalogueArtist>();
  const addArtist = (a: { id: number; name: string; picture_medium?: string }): void => {
    if (artists.has(a.id)) return;
    const artist: CatalogueArtist = { id: `dz:artist:${a.id}`, name: a.name };
    if (a.picture_medium) artist.art = a.picture_medium;
    artists.set(a.id, artist);
  };
  for (const hit of albumHits) {
    if (albums.has(albumKey(hit.title, hit.artist.name))) continue;
    const album: CatalogueAlbum = {
      id: `dz:album:${hit.id}`,
      title: hit.title,
      artist: hit.artist.name,
    };
    const cover = hit.cover_medium ?? hit.cover_big;
    if (cover) album.art = cover;
    const year = yearOf(hit.release_date);
    if (year) album.year = year;
    albums.set(albumKey(hit.title, hit.artist.name), album);
  }
  for (const hit of artistHits) addArtist(hit);
  for (const track of tracks) {
    const key = `${normalize(track.title)}|${primaryArtist(track.artist.name)}`;
    const seen = songs.get(key);
    songs.set(key, seen ? betterDeezerTrack(seen, track) : track);
    if (!albums.has(albumKey(track.album.title, track.artist.name))) {
      const album: CatalogueAlbum = {
        id: `dz:album:${track.album.id}`,
        title: track.album.title,
        artist: track.artist.name,
      };
      const cover = track.album.cover_medium ?? track.album.cover_big;
      if (cover) album.art = cover;
      albums.set(albumKey(track.album.title, track.artist.name), album);
    }
    addArtist(track.artist);
  }
  return {
    songs: [...songs.values()].map(songFromDeezer),
    albums: [...albums.values()],
    artists: [...artists.values()],
  };
}

/** The rows cut to size, after pruning: never before, or the right row could be cut away unseen. */
export function limitRows<T extends Pick<CatalogueSearch, 'songs' | 'albums' | 'artists'>>(
  result: T,
): T {
  return {
    ...result,
    songs: result.songs.slice(0, ROW_LIMITS.songs),
    albums: result.albums.slice(0, ROW_LIMITS.albums),
    artists: result.artists.slice(0, ROW_LIMITS.artists),
  };
}

/**
 * Where the words split into a title and an artist, read from the rows already found: an artist
 * the rows name whose every word was typed ("Beyoncé" in "halo beyonce"), else the words left
 * over from a row that is the exact title ("adele" after "Rolling in the Deep"). Undefined when
 * the rows give no hint; the caller then shows what it has.
 */
export function guessSplit(
  query: string,
  songs: readonly Pick<CatalogueSong, 'title' | 'artist'>[],
): { title: string; artist: string } | undefined {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const content = contentTokens(query);
  if (words.length < 2) return undefined;
  const without = (drop: ReadonlySet<string>): string =>
    words.filter((w) => !drop.has(normalize(w))).join(' ');
  for (const song of songs) {
    const artistTokens = tokens(song.artist);
    if (artistTokens.length === 0 || artistTokens.length >= words.length) continue;
    if (!artistTokens.every((t) => content.includes(t))) continue;
    const title = without(new Set(artistTokens));
    if (title) return { title, artist: song.artist };
  }
  for (const song of songs) {
    if (!titleInQuery(song.title, content)) continue;
    const titleTokens = new Set(tokens(song.title));
    const artist = without(titleTokens);
    if (artist && artist !== words.join(' ')) return { title: song.title, artist };
  }
  return undefined;
}

export const coverArt = (releaseGroupId: string): string =>
  `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;

/** "Lil Wayne feat. Static Major": the credits with their join phrases, as MusicBrainz writes them. */
export function creditName(credit: MbArtistCredit[] | undefined): string {
  if (!credit || credit.length === 0) return '';
  const last = credit.length - 1;
  return (
    credit
      .map((c, i) => `${c.name}${i < last ? (c.joinphrase ?? ' ') : ''}`)
      .join('')
      .replace(/\s+/g, ' ')
      .trim() || credit[0]!.artist.name
  );
}

/**
 * Words in a MusicBrainz note or a release group type that mark another version of a song. A
 * censored ("clean") or an "explicit" edit noted as such is an edit of the plain recording, never
 * the recording itself (functionality R).
 */
export const VERSION_NOTE =
  /\b(live|remix|rmx|mix|edit|demo|instrumental|karaoke|acoustic|unplugged|rehearsal|take|version|dub|radio|clean|censored|explicit|chopped|screwed|slowed|sped)\b/i;

/**
 * Notes on a recording that say it is the plain one, not a version of it: "album version",
 * "single version", MusicBrainz's "album / single version" on Billie Jean (design AL).
 */
export const PLAIN_NOTE =
  /\b(album(?: ?\/ ?single)? version|single version|original version|original|explicit|uncensored)\b/gi;

/** How canonical a release is: official studio albums and singles first, live, mixtapes and bootlegs last. */
export function releaseScore(r: NonNullable<MbRecording['releases']>[number]): number {
  let s = 0;
  if (r.status === 'Official') s += 10;
  else if (r.status === 'Bootleg') s -= 10;
  const type = r['release-group']?.['primary-type'];
  if (type === 'Album') s += 5;
  if (type === 'Single') s += 4;
  if (type === 'EP') s += 3;
  const secondary = r['release-group']?.['secondary-types'] ?? [];
  if (secondary.length > 0) s -= 6;
  if (secondary.some((t) => /mixtape|bootleg|demo/i.test(t))) s -= 10;
  if (secondary.some((t) => /live/i.test(t))) s -= 15;
  if (r.date) s += 1;
  // "The Video Year Mix 2011", "Michael Jackson's This Is It": a collection by its name, when the
  // release group's types do not already say so (design AK).
  const groupTitle = r['release-group']?.title ?? '';
  if (
    secondary.length === 0 &&
    (COLLECTION_TITLE.test(groupTitle) || COLLECTION_TITLE.test(r.title))
  )
    s -= 3;
  return s;
}

/** The release's date, else its group's first date, as a sortable number; unknown dates sort last. */
function releaseTime(r: NonNullable<MbRecording['releases']>[number]): number {
  const date = r.date ?? r['release-group']?.['first-release-date'];
  const time = date ? Date.parse(date.length === 4 ? `${date}-01-01` : date) : NaN;
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

/** A release that collects recordings made for other records: by its group's types, or by its name when the types say nothing. */
export function isCollection(r: NonNullable<MbRecording['releases']>[number]): boolean {
  const secondary = r['release-group']?.['secondary-types'] ?? [];
  if (secondary.some((t) => /compilation|live|dj-mix|mixtape|bootleg|remix|demo/i.test(t)))
    return true;
  const groupTitle = r['release-group']?.title ?? '';
  return (
    secondary.length === 0 && (COLLECTION_TITLE.test(groupTitle) || COLLECTION_TITLE.test(r.title))
  );
}

/** A release whose group is a soundtrack and nothing else: the record a song was made for, as often as not. */
function isSoundtrack(r: NonNullable<MbRecording['releases']>[number]): boolean {
  const secondary = r['release-group']?.['secondary-types'] ?? [];
  return secondary.length > 0 && secondary.every((t) => /soundtrack/i.test(t));
}

/**
 * Prefer an official release that is an album or single over compilations, live albums and
 * bootlegs, the earliest of them when they tie (the album the song was made for came out before
 * the collections that reissued it, design AK). The release named by the caller (the album on the
 * row they tapped) beats them all, unless that release is itself a collection: a song tapped on
 * "Michael Jackson's This Is It" or "The 80s, Part 2" is filed under Thriller, never under the
 * compilation (design AL). A soundtrack that is the recording's earliest release is the record the
 * song was made for ("8 Mile" for "Lose Yourself"), so its type costs it nothing there
 * (functionality Z).
 */
export function pickRelease(rec: MbRecording, preferAlbum?: string) {
  const releases = rec.releases ?? [];
  const wanted = preferAlbum ? normalize(cleanTitle(preferAlbum)) : '';
  const earliest = Math.min(...releases.map(releaseTime));
  // A single named after the song is the song's own packaging, not where people file it: when
  // the recording is also on a studio album, the album is preferred over that single even when
  // the row named the single ("Lollipop" the single over Tha Carter III, functionality Z).
  const songTitle = normalize(cleanTitle(rec.title));
  const hasAlbum = releases.some(
    (r) => r['release-group']?.['primary-type'] === 'Album' && !isCollection(r),
  );
  const selfTitledSingle = (r: NonNullable<MbRecording['releases']>[number]): boolean =>
    r['release-group']?.['primary-type'] === 'Single' &&
    normalize(cleanTitle(r.title)) === songTitle &&
    hasAlbum;
  const scoreOf = (r: NonNullable<MbRecording['releases']>[number]): number =>
    releaseScore(r) +
    (wanted && !isCollection(r) && !selfTitledSingle(r) && normalize(cleanTitle(r.title)) === wanted
      ? 100
      : 0) +
    (isSoundtrack(r) && releaseTime(r) === earliest ? 6 : 0);
  return [...releases].sort(
    (a, b) => scoreOf(b) - scoreOf(a) || releaseTime(a) - releaseTime(b),
  )[0];
}

/**
 * Which recording of a title is the one people mean: the one on the best release, then the one on
 * the most releases; a recording MusicBrainz itself notes as live, a remix or a demo is another
 * song unless those words were asked for, and one whose every release is a live album is too. A
 * caller's duration, when given, picks the version within a few seconds of it.
 */
export function recordingScore(
  rec: MbRecording,
  want: { title?: string; duration?: number } = {},
): number {
  const releases = rec.releases ?? [];
  const best = releases.length > 0 ? Math.max(...releases.map(releaseScore)) : -20;
  let s = best * 10 + Math.min(releases.length, 9);
  const asked = tokens(want.title ?? '');
  // MusicBrainz notes the canonical recording itself "explicit" when a clean edit exists (A Milli
  // on Tha Carter III) or "album version" when a radio edit does (Halo on I Am… Sasha Fierce):
  // those notes name the plain recording, not another version of it.
  const note = (rec.disambiguation ?? '').replace(PLAIN_NOTE, ' ');
  const noteWords = tokens(note).filter((w) => VERSION_NOTE.test(w));
  if (noteWords.some((w) => !asked.includes(w))) s -= 300;
  const allLive =
    releases.length > 0 &&
    releases.every((r) =>
      (r['release-group']?.['secondary-types'] ?? []).some((t) => /live/i.test(t)),
    );
  if (allLive && !asked.includes('live')) s -= 200;
  if (want.duration !== undefined && rec.length) {
    const diff = Math.abs(rec.length / 1000 - want.duration);
    if (diff <= 5) s += 150;
    else if (diff > 20) s -= 100;
  }
  return s;
}

export function songFromRecording(
  rec: MbRecording,
  deezer: DeezerTrack[],
  preferAlbum?: string,
): CatalogueSong | undefined {
  const artist = creditName(rec['artist-credit']);
  if (!rec.title || !artist) return undefined;
  const release = pickRelease(rec, preferAlbum);
  const song: CatalogueSong = {
    id: `mb:recording:${rec.id}`,
    recordingId: rec.id,
    title: rec.title,
    artist,
  };
  const artistId = rec['artist-credit']?.[0]?.artist.id;
  if (artistId) song.artistId = artistId;
  if (rec.length) song.duration = Math.round(rec.length / 1000);
  if (release) {
    song.album = release.title;
    song.releaseId = release.id;
    if (release['release-group']) {
      song.releaseGroupId = release['release-group'].id;
      song.art = coverArt(release['release-group'].id);
    }
    const year = yearOf(release.date ?? release['release-group']?.['first-release-date']);
    if (year) song.year = year;
  }
  const year = yearOf(rec['first-release-date']);
  if (year && !song.year) song.year = year;
  // The Deezer track for art and a preview: the same title, or the same title once edition tags
  // are stripped ("Hotel California (2013 Remaster)" for "Hotel California").
  const match =
    deezer.find(
      (d) =>
        normalize(d.title) === normalize(rec.title) && tokenOverlap(d.artist.name, artist) >= 0.5,
    ) ??
    deezer.find(
      (d) =>
        comparableTitle(d.title) === comparableTitle(rec.title) &&
        tokenOverlap(d.artist.name, artist) >= 0.5,
    );
  if (match) {
    if (match.preview) song.preview = match.preview;
    const cover = match.album.cover_medium ?? match.album.cover_big;
    if (cover) song.art = cover;
  }
  return song;
}

export function albumFromReleaseGroup(
  rg: MbReleaseGroup,
  deezer: DeezerTrack[],
): CatalogueAlbum | undefined {
  const artist = creditName(rg['artist-credit']);
  if (!rg.title || !artist) return undefined;
  const album: CatalogueAlbum = {
    id: `mb:release-group:${rg.id}`,
    releaseGroupId: rg.id,
    title: rg.title,
    artist,
    art: coverArt(rg.id),
  };
  const artistId = rg['artist-credit']?.[0]?.artist.id;
  if (artistId) album.artistId = artistId;
  if (rg['primary-type']) album.type = rg['primary-type'];
  const year = yearOf(rg['first-release-date']);
  if (year) album.year = year;
  const match = deezer.find(
    (d) =>
      normalize(d.album.title) === normalize(rg.title) &&
      tokenOverlap(d.artist.name, artist) >= 0.5,
  );
  const cover = match?.album.cover_medium ?? match?.album.cover_big;
  if (cover) album.art = cover;
  return album;
}

/** Artists come from the credits of the songs and albums found: no third MusicBrainz call. */
export function artistsFromCredits(
  recordings: MbRecording[],
  groups: MbReleaseGroup[],
  deezer: DeezerTrack[],
  limit = 5,
): CatalogueArtist[] {
  const seen = new Map<string, CatalogueArtist>();
  const credits = [...recordings, ...groups].flatMap((r) => r['artist-credit'] ?? []);
  for (const c of credits) {
    if (seen.has(c.artist.id) || seen.size >= limit) continue;
    const artist: CatalogueArtist = {
      id: `mb:artist:${c.artist.id}`,
      artistId: c.artist.id,
      name: c.artist.name,
    };
    const picture = deezer.find((d) => tokenOverlap(d.artist.name, c.artist.name) >= 0.99)?.artist
      .picture_medium;
    if (picture) artist.art = picture;
    seen.set(c.artist.id, artist);
  }
  return [...seen.values()];
}

/** How well a release group's type fits an album request: studio albums, singles and EPs first. */
export function groupScore(rg: MbReleaseGroup): number {
  let s = 0;
  const type = rg['primary-type'];
  if (type === 'Album') s += 5;
  if (type === 'Single') s += 4;
  if (type === 'EP') s += 3;
  const secondary = rg['secondary-types'] ?? [];
  if (secondary.length > 0) s -= 6;
  if (secondary.some((t) => /live|compilation|mixtape|bootleg|demo|remix/i.test(t))) s -= 10;
  if (rg['first-release-date']) s += 1;
  return s;
}

export function catalogueService(options: {
  musicBrainz: MusicBrainzClient;
  deezer: DeezerClient;
  cache: CacheStore;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fastWaitMs?: number;
  /**
   * Told when a typeahead answered without the song by the artist typed and the full search found
   * it afterwards: the owner's open panel gets the full answer (design AH).
   */
  onLateAnswer?: (owner: string, result: CatalogueSearch) => void;
}) {
  const { musicBrainz, deezer, cache } = options;
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const fastWaitMs = options.fastWaitMs ?? FAST_WAIT_MS;
  /** The same words typed on two phones at once cost one search. */
  const inFlight = new Map<string, Promise<CatalogueSearch>>();

  /** A Deezer call on the typist's lane; a refusal by the limiter is "no answer" for the full search. */
  const deezerOrNothing = (call: Promise<DeezerTrack[] | undefined>) =>
    call.catch((error: unknown) => {
      if (error instanceof LimiterBusyError) return undefined;
      throw error;
    });

  /**
   * Both speeds: when no row is the title and artist typed, the words are split by what the rows
   * say and Deezer is asked once more for that artist's song; the new tracks join the old ones.
   */
  async function withFielded(
    query: string,
    tracks: DeezerTrack[],
    songs: readonly Pick<CatalogueSong, 'title' | 'artist'>[],
    limits: { owner?: string; batch?: string },
    swallowBusy: boolean,
  ): Promise<{ tracks: DeezerTrack[]; split?: { title: string; artist: string } }> {
    if (hasExactRow(query, { songs })) return { tracks };
    const split = guessSplit(query, songs);
    if (!split) return { tracks };
    const call = deezer.searchTrack(split.artist, split.title, 5, limits);
    const more = (await (swallowBusy ? deezerOrNothing(call) : call)) ?? [];
    const seen = new Set(tracks.map((t) => t.id));
    return { tracks: [...tracks, ...more.filter((t) => !seen.has(t.id))], split };
  }

  /**
   * MusicBrainz's answer to a second recording query, merged into the first by id. A call the
   * limiter drops (the typist moved on) or MusicBrainz refuses adds nothing.
   */
  async function moreRecordings(
    have: MbRecording[],
    query: string,
    limits: { owner?: string; batch?: string },
  ): Promise<MbRecording[]> {
    const more = await musicBrainz
      .searchRecordings(query, SEARCH_LIMIT, limits)
      .catch((error: unknown) => {
        if (error instanceof LimiterBusyError || error instanceof HttpError) return [];
        throw error;
      });
    const seen = new Set(have.map((r) => r.id));
    return [...have, ...more.filter((r) => !seen.has(r.id))];
  }

  /**
   * The full search: MusicBrainz with the words and every title-and-artist split of them, every
   * recording and every Deezer track pruned by the words typed before the list is cut, the Deezer
   * rows the recordings did not match kept as rows of their own (they carry the song when
   * MusicBrainz lists others first), and a fielded second Deezer call when no row is exact.
   */
  async function fetchSearch(
    query: string,
    key: string,
    who: SearchOptions,
  ): Promise<CatalogueSearch> {
    const batch = normalize(query);
    const limits = who.owner ? { owner: who.owner, batch } : {};
    const [firstRecordings, groups, deezerAnswer] = await Promise.all([
      musicBrainz.searchRecordings(fullSearchQuery(query), SEARCH_LIMIT, limits),
      // The albums wait a second behind the recordings on MusicBrainz's lane; when the typist's
      // next letters drop that call, or MusicBrainz answers it 503 past the retries, the songs
      // already found still make the answer: the albums are the optional half (functionality X).
      musicBrainz.searchReleaseGroups(query, 6, limits).catch((error: unknown) => {
        if (error instanceof LimiterBusyError || error instanceof HttpError) return [];
        throw error;
      }),
      deezerOrNothing(deezer.search(query, 15, limits)),
    ]);
    let recordings = firstRecordings;
    const fromMusicBrainz = (tracks: DeezerTrack[]): CatalogueSong[] => {
      // Every recording of a title by an artist (the first credit: "Lil Wayne feat. Static Major"
      // is Lil Wayne's), best first by `recordingScore`: never a live, clean or compilation-only
      // recording MusicBrainz happened to list first (functionality R, Z).
      const byKey = new Map<string, { rec: MbRecording; score: number }[]>();
      // The plain recording for a title once its edition tags are stripped: a Deezer "Hotel
      // California (2013 Remaster)" is the Eagles' "Hotel California" row, not a row of its own.
      const plain = new Map<string, string>();
      for (const rec of recordings) {
        if (rec.video) continue;
        const artist = creditName(rec['artist-credit']);
        if (!rec.title || !artist) continue;
        const dedupe = `${normalize(rec.title)}|${primaryArtist(artist)}`;
        const score = recordingScore(rec, { title: query });
        const list = byKey.get(dedupe) ?? [];
        list.push({ rec, score });
        byKey.set(dedupe, list);
        const cleaned = `${comparableTitle(rec.title)}|${primaryArtist(artist)}`;
        if (!plain.has(cleaned) || comparableTitle(rec.title) === normalize(rec.title))
          plain.set(cleaned, dedupe);
      }
      for (const list of byKey.values()) list.sort((a, b) => b.score - a.score);
      // Deezer's order is popularity and the tiebreak between rows that answer the words alike
      // (functionality Q): the songs Deezer also lists first, in its order, each with its
      // MusicBrainz recording when one matched, then the recordings Deezer did not have.
      const songs: CatalogueSong[] = [];
      const seen = new Set<string>();
      const push = (dedupe: string, song: CatalogueSong | undefined): void => {
        if (!song || seen.has(dedupe)) return;
        seen.add(dedupe);
        songs.push(song);
      };
      for (const song of fromDeezer(tracks).songs) {
        const raw = `${normalize(song.title)}|${primaryArtist(song.artist)}`;
        const dedupe = byKey.has(raw)
          ? raw
          : plain.get(`${comparableTitle(song.title)}|${primaryArtist(song.artist)}`);
        const candidates = dedupe ? (byKey.get(dedupe) ?? []) : [];
        // The Deezer row names an album. The recording on that album is the one it stands for
        // (a plain "Fireman" on Tha Carter II, not the chopped-and-screwed one MusicBrainz lists
        // under the same title); when the album is a collection, the best recording stands in
        // and names its studio release, unless MusicBrainz's list holds no recording of the song
        // on any studio record (every "Billie Jean" scores alike and the Thriller one can sit
        // past the fiftieth), in which case the row stays Deezer's too; when the album is a
        // studio record none of the recordings is on, the row stays Deezer's and the pipeline
        // resolves it against that album when it is requested, rather than carry ids that would
        // file the song under another record or a compilation (functionality Z, design AL).
        const album = song.album ?? '';
        const wanted = normalize(cleanTitle(album));
        const onAlbum = candidates.find(({ rec }) =>
          (rec.releases ?? []).some(
            (r) => !isCollection(r) && normalize(cleanTitle(r.title)) === wanted,
          ),
        );
        const best = candidates[0];
        const onStudioRecord = (rec: MbRecording): boolean =>
          (rec.releases ?? []).some((r) => !isCollection(r));
        if (onAlbum && dedupe) push(dedupe, songFromRecording(onAlbum.rec, tracks, album));
        else if (
          dedupe &&
          best &&
          (!album || COLLECTION_TITLE.test(album)) &&
          (onStudioRecord(best.rec) || !album)
        )
          push(dedupe, songFromRecording(best.rec, tracks));
        else push(raw, song);
      }
      for (const [dedupe, list] of byKey) push(dedupe, songFromRecording(list[0]!.rec, tracks));
      return songs;
    };
    let deezerTracks = deezerAnswer ?? [];
    if (deezerAnswer) {
      ({ tracks: deezerTracks } = await withFielded(
        query,
        deezerTracks,
        fromMusicBrainz(deezerTracks),
        limits,
        true,
      ));
    }
    let songs = fromMusicBrainz(deezerTracks);
    // A typo only Deezer tolerates ("hotel califronia"): MusicBrainz's query has no fuzzy term, so
    // when none of its recordings is the song typed and Deezer's first row spells the title
    // another way, MusicBrainz is asked once more with Deezer's spelling (functionality AA).
    const top = fromDeezer(deezerTracks).songs[0];
    const typed = tokens(query);
    if (
      top &&
      !hasExactRow(query, { songs: songs.filter((s) => s.recordingId) }) &&
      !contentTokens(comparableTitle(top.title)).every((t) => typed.includes(t))
    ) {
      recordings = await moreRecordings(
        recordings,
        recordingQuery(cleanTitle(top.title) || top.title, top.artist),
        limits,
      );
      songs = fromMusicBrainz(deezerTracks);
    }
    const albums = groups
      .map((g) => albumFromReleaseGroup(g, deezerTracks))
      .filter((a): a is CatalogueAlbum => !!a);
    const ranked = relevantRows(query, {
      query,
      songs,
      artists: artistsFromCredits(recordings, groups, deezerTracks),
      albums,
      cached: false,
    });
    const result: CatalogueSearch = { ...limitRows(ranked), exact: isSongTyped(query, ranked) };
    // Without Deezer the rows lack art and previews: keep that answer only briefly.
    cache.set(key, result, deezerAnswer ? SEARCH_TTL_MS : FAST_TTL_MS);
    return result;
  }

  /** When MusicBrainz last answered 503 past the retries (or not at all): the typeahead says "busy" until then. */
  let busyUntil = 0;

  /**
   * The full search that a typeahead could not wait for, watched to its end: the full answer with
   * the song by the artist goes to the typist's open panel as a `catalogue` event (design AH);
   * MusicBrainz busy or down goes there too, as the rows already shown marked `busy`, so the panel
   * can say the list is other versions and offer no primary Add (design AM).
   */
  function watchLate(
    query: string,
    who: SearchOptions,
    shown: CatalogueSearch,
    full: Promise<CatalogueSearch>,
  ): void {
    if (!who.owner || !options.onLateAnswer) return;
    const owner = who.owner;
    const tell = options.onLateAnswer;
    full.then(
      (late) => {
        if (isSongTyped(query, late)) tell(owner, late);
      },
      (error: unknown) => {
        if (error instanceof LimiterBusyError && error.code === 'superseded') return;
        if (error instanceof LimiterBusyError || isBusy(error, 'musicbrainz')) {
          const { pending: _pending, ...rows } = shown;
          tell(owner, { ...rows, busy: true, exact: false });
        }
      },
    );
  }

  async function fastSearch(query: string, who: SearchOptions): Promise<CatalogueSearch> {
    const key = fastKey(query);
    const limits = who.owner ? { owner: who.owner, batch: normalize(query) } : {};
    // Two Deezer calls: the tracks (whose albums and artists make the other rows) and the album
    // search, so an album named as such is found; a third call for artists would cost another
    // 100 ms slot for rows the tracks already give. A limiter refusal is thrown to the route (503).
    const [plain, albums] = await Promise.all([
      deezer.search(query, 15, limits),
      deezer.searchAlbums(query, 4, limits),
    ]);
    let tracks = plain ?? [];
    let split: { title: string; artist: string } | undefined;
    if (plain) {
      ({ tracks, split } = await withFielded(
        query,
        tracks,
        fromDeezer(tracks).songs,
        limits,
        false,
      ));
    }
    const ranked = relevantRows(query, {
      query,
      ...fromDeezer(tracks, albums ?? []),
      cached: false,
      partial: true,
    });
    const result: CatalogueSearch = { ...limitRows(ranked), exact: isSongTyped(query, ranked) };
    // A quota hit or an outage is not "nothing found": only an answer Deezer gave is remembered.
    if (plain !== undefined) cache.set(key, result, FAST_TTL_MS);
    // The rows named a title and an artist but none is the song by that artist (Deezer's catalogue
    // lacks some originals altogether): ask MusicBrainz (the full search, shared with any Enter
    // that follows) and wait briefly for it. Its answer, when it comes in time, is the one shown;
    // either way it lands in the cache for the next letters.
    if (split && !hasExactRow(query, ranked) && !looksLikeSentence(query)) {
      if (now() < busyUntil) return { ...result, busy: true, exact: false };
      const full = startFull(query, who);
      const winner = await Promise.race([
        full.catch(() => undefined),
        sleep(fastWaitMs).then(() => undefined),
      ]);
      if (winner) return winner;
      // Too slow for this keystroke: the panel shows the Deezer rows now, marked provisional, and
      // the owner's stream carries the full answer, or the busy mark, when MusicBrainz is done
      // (design AH, AM). The cache already prefers that answer for the next keystroke.
      const shown: CatalogueSearch = { ...result, pending: true };
      watchLate(query, who, shown, full);
      return shown;
    }
    return result;
  }

  /** The full search for these words, one at a time per key: a second caller joins the first. */
  function startFull(query: string, who: SearchOptions): Promise<CatalogueSearch> {
    const key = fullKey(query);
    const running = inFlight.get(key);
    if (running) return running;
    const promise = fetchSearch(query, key, who)
      .catch((error: unknown) => {
        // MusicBrainz over its share or down: the typeahead says so for a minute rather than
        // starting a full search on every keystroke that lands on the same words.
        if (isBusy(error, 'musicbrainz')) busyUntil = now() + BUSY_MS;
        throw error;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  const fullKey = (query: string) => `catalogue:search:${normalize(query)}`;
  const fastKey = (query: string) => `catalogue:fast:${normalize(query)}`;

  /**
   * What the typeahead answers from the cache: the full answer (it carries MusicBrainz ids) when
   * it has the song typed or the fast one does not either; never a full answer without the exact
   * row over a fast answer that had it, so an Enter can never take the right song away.
   */
  function cachedForFast(query: string): CatalogueSearch | undefined {
    const full = cache.get<CatalogueSearch>(fullKey(query));
    const fast = cache.get<CatalogueSearch>(fastKey(query));
    if (full && (!fast || hasExactRow(query, full) || !hasExactRow(query, fast))) return full;
    return fast;
  }

  /**
   * A cached typeahead answer that never got its full search (MusicBrainz was busy, or the
   * typist's letters dropped it): while MusicBrainz is known to be busy the rows are marked so;
   * otherwise the full search is tried again once, its answer or its failure going to the
   * typist's stream, so a panel is never left on other versions for the ten minutes the fast
   * answer is cached (design AM).
   */
  function fromFastCache(query: string, cached: CatalogueSearch, who: SearchOptions) {
    const shown: CatalogueSearch = { ...cached, cached: true };
    const settled = !!cache.get<CatalogueSearch>(fullKey(query));
    if (settled || hasExactRow(query, cached) || looksLikeSentence(query)) return shown;
    if (!guessSplit(query, cached.songs)) return shown;
    if (now() < busyUntil) return { ...shown, busy: true, exact: false };
    const full = startFull(query, who);
    const pending: CatalogueSearch = { ...shown, pending: true, exact: false };
    watchLate(query, who, pending, full);
    return pending;
  }

  /** The recording for a title and artist, none when nothing is close enough (`catalogue_miss`). */
  function chooseRecording(
    recordings: MbRecording[],
    title: string,
    artist: string,
    want: LookupOptions,
  ): MbRecording | undefined {
    const wantTitle = cleanTitle(title);
    const byArtist = recordings.filter(
      (r) => !r.video && tokenOverlap(artist, creditName(r['artist-credit'])) >= 0.5,
    );
    const exact = byArtist.filter((r) => cleanTitle(r.title) === wantTitle);
    // The fallback pool must still be the same song: most of the wanted words present, at least
    // half of the recording's words wanted (a subtitle such as "(The Soup of Love)" is fine), and
    // none of the extra words a version word, so "Fireman (Remix)" or "Lil Wayne Fireman" never
    // stands in for "Fireman".
    const wanted = new Set(tokens(wantTitle));
    const pool =
      exact.length > 0
        ? exact
        : byArtist.filter((r) => {
            const have = cleanTitle(r.title);
            const extra = tokens(have).filter((t) => !wanted.has(t));
            return (
              tokenOverlap(wantTitle, have) >= 0.6 &&
              tokenOverlap(have, wantTitle) >= 0.5 &&
              !extra.some((t) => VERSION_NOTE.test(t))
            );
          });
    const scoreOf = (r: MbRecording) =>
      recordingScore(r, {
        title,
        ...(want.duration !== undefined ? { duration: want.duration } : {}),
      });
    return [...pool].sort((a, b) => scoreOf(b) - scoreOf(a))[0];
  }

  return {
    async search(q: string, who: SearchOptions = {}): Promise<CatalogueSearch> {
      const query = q.trim().replace(/\s+/g, ' ');
      const key = fullKey(query);
      const cached = who.fast ? cachedForFast(query) : cache.get<CatalogueSearch>(key);
      if (cached) {
        return who.fast && cached.partial
          ? fromFastCache(query, cached, who)
          : { ...cached, cached: true };
      }
      const running = inFlight.get(key);
      if (running) return running;
      return who.fast ? fastSearch(query, who) : startFull(query, who);
    },

    /**
     * The best recording for a title and artist, for requests that arrive without ids: the studio
     * version on the artist's own release, never a live take or a remix nobody asked for.
     */
    async findSong(
      title: string,
      artist: string,
      want: LookupOptions = {},
    ): Promise<CatalogueSong | undefined> {
      const key = `catalogue:song:${normalize(title)}|${normalize(artist)}|${want.duration ?? ''}|${normalize(want.album ?? '')}`;
      const cached = cache.get<CatalogueSong | null>(key);
      if (cached !== undefined) return cached ?? undefined;
      const recordings = await musicBrainz.searchRecordings(
        recordingQuery(title, artist),
        LOOKUP_LIMIT,
        { vital: true },
      );
      const chosen = chooseRecording(recordings, title, artist, want);
      const song = chosen ? songFromRecording(chosen, [], want.album) : undefined;
      cache.set(key, song ?? null, LOOKUP_TTL_MS);
      return song;
    },

    async findAlbum(title: string, artist: string): Promise<CatalogueAlbum | undefined> {
      const key = `catalogue:album:${normalize(title)}|${normalize(artist)}`;
      const cached = cache.get<CatalogueAlbum | null>(key);
      if (cached !== undefined) return cached ?? undefined;
      const groups = await musicBrainz.searchReleaseGroups(releaseGroupQuery(title, artist), 12, {
        vital: true,
      });
      const wantTitle = cleanTitle(title);
      const close = groups.filter(
        (g) =>
          tokenOverlap(artist, creditName(g['artist-credit'])) >= 0.5 &&
          tokenOverlap(wantTitle, cleanTitle(g.title)) >= 0.6 &&
          tokenOverlap(cleanTitle(g.title), wantTitle) >= 0.6,
      );
      const exact = close.filter((g) => cleanTitle(g.title) === wantTitle);
      const pool = exact.length > 0 ? exact : close;
      const album = [...pool]
        .sort((a, b) => groupScore(b) - groupScore(a))
        .map((g) => albumFromReleaseGroup(g, []))
        .find((a): a is CatalogueAlbum => !!a);
      cache.set(key, album ?? null, LOOKUP_TTL_MS);
      return album;
    },

    /** A release with its tracks, for mapping files to MusicBrainz tracks before import. */
    async release(id: string): Promise<MbRelease> {
      const key = `catalogue:release:${id}`;
      const cached = cache.get<MbRelease>(key);
      if (cached) return cached;
      const release = await musicBrainz.release(id);
      cache.set(key, release, LOOKUP_TTL_MS);
      return release;
    },
  };
}
export type CatalogueService = ReturnType<typeof catalogueService>;
