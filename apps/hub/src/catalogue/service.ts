/**
 * The catalogue (F61): songs, artists and albums for the words typed, from MusicBrainz, with art
 * and previews from Deezer and a Cover Art Archive URL where Deezer has nothing. Not an LLM.
 * Answers are cached in SQLite for a day; lookups by id for a week.
 *
 * Two speeds. MusicBrainz allows one request a second for the whole house, so the typeahead
 * (`fast`) never waits for it: it answers from the cache when the words were looked up before, else
 * from Deezer alone (art, previews, durations, no MusicBrainz ids), marked `partial`. A full search
 * (Enter, the model's context, the pipeline) asks MusicBrainz and waits its turn. A song added from
 * a Deezer row gets its MusicBrainz ids in the pipeline from its title and artist.
 */
import type {
  CatalogueAlbum,
  CatalogueArtist,
  CatalogueSearch,
  CatalogueSong,
} from '@renaissance/core';

import type { CacheStore } from '../db/cache.js';
import { normalize, tokenOverlap } from '../text.js';
import type { DeezerClient, DeezerTrack } from './deezer.js';
import type {
  MbArtistCredit,
  MbRecording,
  MbRelease,
  MbReleaseGroup,
  MusicBrainzClient,
} from './musicbrainz.js';
import { recordingQuery, releaseGroupQuery } from './musicbrainz.js';

export const SEARCH_TTL_MS = 24 * 60 * 60_000;
export const LOOKUP_TTL_MS = 7 * 24 * 60 * 60_000;

export interface SearchOptions {
  /** The profile typing; a newer search from the same profile drops this one while it waits. */
  owner?: string;
  /** Typeahead: answer at once from the cache or Deezer; never wait for MusicBrainz. */
  fast?: boolean;
}

export const FAST_TTL_MS = 10 * 60_000;

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

/** The albums and artists the Deezer tracks belong to, each once. */
export function fromDeezer(tracks: DeezerTrack[]): {
  songs: CatalogueSong[];
  albums: CatalogueAlbum[];
  artists: CatalogueArtist[];
} {
  const songs: CatalogueSong[] = [];
  const seenSongs = new Set<string>();
  const albums = new Map<number, CatalogueAlbum>();
  const artists = new Map<number, CatalogueArtist>();
  for (const track of tracks) {
    const key = `${normalize(track.title)}|${normalize(track.artist.name)}`;
    if (!seenSongs.has(key)) {
      seenSongs.add(key);
      songs.push(songFromDeezer(track));
    }
    if (!albums.has(track.album.id)) {
      const album: CatalogueAlbum = {
        id: `dz:album:${track.album.id}`,
        title: track.album.title,
        artist: track.artist.name,
      };
      const cover = track.album.cover_medium ?? track.album.cover_big;
      if (cover) album.art = cover;
      albums.set(track.album.id, album);
    }
    if (!artists.has(track.artist.id)) {
      const artist: CatalogueArtist = {
        id: `dz:artist:${track.artist.id}`,
        name: track.artist.name,
      };
      if (track.artist.picture_medium) artist.art = track.artist.picture_medium;
      artists.set(track.artist.id, artist);
    }
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

const yearOf = (date: string | undefined): number | undefined => {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isInteger(y) && y > 0 ? y : undefined;
};

/** How canonical a release is: official studio albums and singles first, mixtapes and bootlegs last. */
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
  if (r.date) s += 1;
  return s;
}

/** Prefer an official release that is an album or single over compilations and bootlegs. */
export function pickRelease(rec: MbRecording) {
  return [...(rec.releases ?? [])].sort((a, b) => releaseScore(b) - releaseScore(a))[0];
}

/**
 * Which recording of a title is the one people mean: the one on the best release, then the one on
 * the most releases. MusicBrainz lists every mixtape version first as often as not.
 */
export function recordingScore(rec: MbRecording): number {
  const releases = rec.releases ?? [];
  const best = releases.length > 0 ? Math.max(...releases.map(releaseScore)) : -20;
  return best * 10 + Math.min(releases.length, 9);
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
    const [recordings, groups, deezerTracks] = await Promise.all([
      musicBrainz.searchRecordings(query, 10, limits),
      musicBrainz.searchReleaseGroups(query, 6, limits),
      deezer.search(query),
    ]);
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
    const result: CatalogueSearch = {
      query,
      songs: songs.slice(0, 8),
      artists: artistsFromCredits(recordings, groups, deezerTracks),
      albums,
      cached: false,
    };
    cache.set(key, result, SEARCH_TTL_MS);
    return result;
  }

  async function fastSearch(query: string): Promise<CatalogueSearch> {
    const key = `catalogue:fast:${normalize(query)}`;
    const cached = cache.get<CatalogueSearch>(key);
    if (cached) return { ...cached, cached: true };
    const result: CatalogueSearch = {
      query,
      ...fromDeezer(await deezer.search(query)),
      cached: false,
      partial: true,
    };
    cache.set(key, result, FAST_TTL_MS);
    return result;
  }

  return {
    async search(q: string, who: SearchOptions = {}): Promise<CatalogueSearch> {
      const query = q.trim().replace(/\s+/g, ' ');
      const key = `catalogue:search:${normalize(query)}`;
      const cached = cache.get<CatalogueSearch>(key);
      if (cached) return { ...cached, cached: true };
      const running = inFlight.get(key);
      if (running) return running;
      if (who.fast) return fastSearch(query);
      const promise = fetchSearch(query, key, who).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },

    /** The best recording for a title and artist, for requests that arrive without ids. */
    async findSong(title: string, artist: string): Promise<CatalogueSong | undefined> {
      const key = `catalogue:song:${normalize(title)}|${normalize(artist)}`;
      const cached = cache.get<CatalogueSong | null>(key);
      if (cached !== undefined) return cached ?? undefined;
      const recordings = (
        await musicBrainz.searchRecordings(recordingQuery(title, artist), 15)
      ).filter((r) => !r.video);
      const exact = recordings.filter(
        (r) =>
          normalize(r.title) === normalize(title) &&
          tokenOverlap(artist, creditName(r['artist-credit'])) >= 0.5,
      );
      const pool = exact.length > 0 ? exact : recordings;
      const ordered = [...pool].sort((a, b) => recordingScore(b) - recordingScore(a));
      const song = ordered
        .map((r) => songFromRecording(r, []))
        .find((s): s is CatalogueSong => !!s);
      cache.set(key, song ?? null, LOOKUP_TTL_MS);
      return song;
    },

    async findAlbum(title: string, artist: string): Promise<CatalogueAlbum | undefined> {
      const key = `catalogue:album:${normalize(title)}|${normalize(artist)}`;
      const cached = cache.get<CatalogueAlbum | null>(key);
      if (cached !== undefined) return cached ?? undefined;
      const groups = await musicBrainz.searchReleaseGroups(releaseGroupQuery(title, artist), 8);
      const album = groups
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
