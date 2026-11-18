/**
 * The catalogue (F61): songs, artists and albums for the words typed, from MusicBrainz, with art
 * and previews from Deezer and a Cover Art Archive URL where Deezer has nothing. Not an LLM.
 * Answers are cached in SQLite for a day; lookups by id for a week.
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

/** Prefer an official release that is an album or single over compilations and bootlegs. */
export function pickRelease(rec: MbRecording) {
  const releases = rec.releases ?? [];
  const score = (r: NonNullable<MbRecording['releases']>[number]): number => {
    let s = 0;
    if (r.status === 'Official') s += 10;
    const type = r['release-group']?.['primary-type'];
    if (type === 'Album') s += 5;
    if (type === 'Single') s += 4;
    if (type === 'EP') s += 3;
    if ((r['release-group']?.['secondary-types'] ?? []).length > 0) s -= 6;
    if (r.date) s += 1;
    return s;
  };
  return [...releases].sort((a, b) => score(b) - score(a))[0];
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

  return {
    async search(q: string): Promise<CatalogueSearch> {
      const query = q.trim().replace(/\s+/g, ' ');
      const key = `catalogue:search:${normalize(query)}`;
      const cached = cache.get<CatalogueSearch>(key);
      if (cached) return { ...cached, cached: true };
      const [recordings, groups, deezerTracks] = await Promise.all([
        musicBrainz.searchRecordings(query, 10),
        musicBrainz.searchReleaseGroups(query, 6),
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
    },

    /** The best recording for a title and artist, for requests that arrive without ids. */
    async findSong(title: string, artist: string): Promise<CatalogueSong | undefined> {
      const key = `catalogue:song:${normalize(title)}|${normalize(artist)}`;
      const cached = cache.get<CatalogueSong | null>(key);
      if (cached !== undefined) return cached ?? undefined;
      const recordings = await musicBrainz.searchRecordings(recordingQuery(title, artist), 10);
      const best = recordings
        .filter((r) => !r.video)
        .map((r) => songFromRecording(r, []))
        .filter((s): s is CatalogueSong => !!s)
        .find(
          (s) => normalize(s.title) === normalize(title) && tokenOverlap(artist, s.artist) >= 0.5,
        );
      const song =
        best ??
        recordings.map((r) => songFromRecording(r, [])).find((s): s is CatalogueSong => !!s);
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
