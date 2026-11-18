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
 * ranked and pruned by `relevance.ts`, so a row answers the words typed or is not shown, and a
 * Deezer failure is never cached as "nothing found".
 */
import type {
  CatalogueAlbum,
  CatalogueArtist,
  CatalogueSearch,
  CatalogueSong,
} from '@renaissance/core';

import type { CacheStore } from '../db/cache.js';
import { cleanTitle } from '../fetch/clean.js';
import { normalize, tokenOverlap, tokens } from '../text.js';
import type { DeezerAlbum, DeezerArtist, DeezerClient, DeezerTrack } from './deezer.js';
import type {
  MbArtistCredit,
  MbRecording,
  MbRelease,
  MbReleaseGroup,
  MusicBrainzClient,
} from './musicbrainz.js';
import { recordingQuery, releaseGroupQuery } from './musicbrainz.js';
import { relevantRows } from './relevance.js';

export const SEARCH_TTL_MS = 24 * 60 * 60_000;
export const LOOKUP_TTL_MS = 7 * 24 * 60 * 60_000;
export const FAST_TTL_MS = 10 * 60_000;
/** How many recordings a title-and-artist lookup reads before choosing: live and mixtape versions come first as often as not. */
export const LOOKUP_LIMIT = 40;

export interface SearchOptions {
  /** The profile typing; a newer search from the same profile drops this one while it waits. */
  owner?: string;
  /** Typeahead: answer at once from the cache or Deezer; never wait for MusicBrainz. */
  fast?: boolean;
}

export interface LookupOptions {
  /** The caller's own duration in seconds: the version within a few seconds of it is the one meant. */
  duration?: number;
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
  const songs: CatalogueSong[] = [];
  const seenSongs = new Set<string>();
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
    const key = `${normalize(track.title)}|${normalize(track.artist.name)}`;
    if (!seenSongs.has(key)) {
      seenSongs.add(key);
      songs.push(songFromDeezer(track));
    }
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
    songs: songs.slice(0, 8),
    albums: [...albums.values()].slice(0, 4),
    artists: [...artists.values()].slice(0, 3),
  };
}

export const coverArt = (releaseGroupId: string): string =>
  `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;

export function creditName(credit: MbArtistCredit[] | undefined): string {
  if (!credit || credit.length === 0) return '';
  return (
    credit
      .map((c, i) => (i === 0 ? c.name : ` ${c.name}`))
      .join('')
      .trim() || credit[0]!.artist.name
  );
}

/** Words in a MusicBrainz note or a release group type that mark another version of a song. */
const VERSION_NOTE =
  /\b(live|remix|rmx|mix|edit|demo|instrumental|karaoke|acoustic|unplugged|rehearsal|take|version|dub|radio)\b/i;

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
  return s;
}

/** Prefer an official release that is an album or single over compilations, live albums and bootlegs. */
export function pickRelease(rec: MbRecording) {
  return [...(rec.releases ?? [])].sort((a, b) => releaseScore(b) - releaseScore(a))[0];
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
  const note = rec.disambiguation ?? '';
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
): CatalogueSong | undefined {
  const artist = creditName(rec['artist-credit']);
  if (!rec.title || !artist) return undefined;
  const release = pickRelease(rec);
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
  const match = deezer.find(
    (d) =>
      normalize(d.title) === normalize(rec.title) && tokenOverlap(d.artist.name, artist) >= 0.5,
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
}) {
  const { musicBrainz, deezer, cache } = options;
  /** The same words typed on two phones at once cost one search. */
  const inFlight = new Map<string, Promise<CatalogueSearch>>();

  async function fetchSearch(
    query: string,
    key: string,
    who: SearchOptions,
  ): Promise<CatalogueSearch> {
    const batch = normalize(query);
    const limits = who.owner ? { owner: who.owner, batch } : {};
    const [recordings, groups, deezerAnswer] = await Promise.all([
      musicBrainz.searchRecordings(query, 12, limits),
      musicBrainz.searchReleaseGroups(query, 6, limits),
      deezer.search(query, 15, limits),
    ]);
    const deezerTracks = deezerAnswer ?? [];
    const songs: CatalogueSong[] = [];
    const seenSongs = new Set<string>();
    for (const rec of recordings) {
      if (rec.video) continue;
      const song = songFromRecording(rec, deezerTracks);
      if (!song) continue;
      const dedupe = `${normalize(song.title)}|${normalize(song.artist)}`;
      if (seenSongs.has(dedupe)) continue;
      seenSongs.add(dedupe);
      songs.push(song);
    }
    const albums = groups
      .map((g) => albumFromReleaseGroup(g, deezerTracks))
      .filter((a): a is CatalogueAlbum => !!a);
    const result: CatalogueSearch = relevantRows(query, {
      query,
      songs: songs.slice(0, 8),
      artists: artistsFromCredits(recordings, groups, deezerTracks),
      albums,
      cached: false,
    });
    // Without Deezer the rows lack art and previews: keep that answer only briefly.
    cache.set(key, result, deezerAnswer ? SEARCH_TTL_MS : FAST_TTL_MS);
    return result;
  }

  async function fastSearch(query: string, who: SearchOptions): Promise<CatalogueSearch> {
    const key = `catalogue:fast:${normalize(query)}`;
    const cached = cache.get<CatalogueSearch>(key);
    if (cached) return { ...cached, cached: true };
    const limits = who.owner ? { owner: who.owner, batch: normalize(query) } : {};
    // Two Deezer calls: the tracks (whose albums and artists make the other rows) and the album
    // search, so an album named as such is found; a third call for artists would cost another
    // 100 ms slot for rows the tracks already give.
    const [tracks, albums] = await Promise.all([
      deezer.search(query, 15, limits),
      deezer.searchAlbums(query, 4, limits),
    ]);
    const result: CatalogueSearch = relevantRows(query, {
      query,
      ...fromDeezer(tracks ?? [], albums ?? []),
      cached: false,
      partial: true,
    });
    // A quota hit or an outage is not "nothing found": only an answer Deezer gave is remembered.
    if (tracks !== undefined) cache.set(key, result, FAST_TTL_MS);
    return result;
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
      const key = `catalogue:search:${normalize(query)}`;
      const cached = cache.get<CatalogueSearch>(key);
      if (cached) return { ...cached, cached: true };
      const running = inFlight.get(key);
      if (running) return running;
      if (who.fast) return fastSearch(query, who);
      const promise = fetchSearch(query, key, who).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
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
      const key = `catalogue:song:${normalize(title)}|${normalize(artist)}|${want.duration ?? ''}`;
      const cached = cache.get<CatalogueSong | null>(key);
      if (cached !== undefined) return cached ?? undefined;
      const recordings = await musicBrainz.searchRecordings(
        recordingQuery(title, artist),
        LOOKUP_LIMIT,
        { vital: true },
      );
      const chosen = chooseRecording(recordings, title, artist, want);
      const song = chosen ? songFromRecording(chosen, []) : undefined;
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
