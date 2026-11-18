/**
 * Library lookups with the hub's own API key (F86 "already here") and with the caller's token
 * (the Ask bar's instant layer, so results are what that user may see).
 */
import type { InstantResults, LibraryHit } from '@renaissance/core';

import { httpJson } from '../http.js';
import type { Fetch } from '../http.js';
import { normalize, tokenOverlap } from '../text.js';

export interface JellyfinItem {
  Id: string;
  Name: string;
  Type: 'Audio' | 'MusicAlbum' | 'MusicArtist' | string;
  Artists?: string[];
  AlbumArtist?: string;
  AlbumArtists?: { Name: string; Id: string }[];
  Album?: string;
  AlbumId?: string;
  RunTimeTicks?: number;
  ProviderIds?: Record<string, string>;
  ImageTags?: Record<string, string>;
}

interface ItemsResult {
  Items: JellyfinItem[];
  TotalRecordCount: number;
}

export const TICKS_PER_SECOND = 10_000_000;

export function toHit(item: JellyfinItem): LibraryHit {
  const kind =
    item.Type === 'MusicAlbum' ? 'album' : item.Type === 'MusicArtist' ? 'artist' : 'track';
  const hit: LibraryHit = { id: item.Id, kind, title: item.Name };
  const artist = item.Artists?.[0] ?? item.AlbumArtist ?? item.AlbumArtists?.[0]?.Name;
  if (artist) hit.artist = artist;
  if (item.Album) hit.album = item.Album;
  if (item.RunTimeTicks) hit.duration = Math.round(item.RunTimeTicks / TICKS_PER_SECOND);
  if (item.ImageTags?.Primary) hit.imageId = item.Id;
  else if (item.AlbumId) hit.imageId = item.AlbumId;
  return hit;
}

export interface LibraryMatch {
  item: JellyfinItem;
  hit: LibraryHit;
}

/** Same title and the artist named: how the hub decides a request is already on the server. */
export function matchesTrack(
  item: JellyfinItem,
  title: string,
  artist: string,
  recordingId?: string,
): boolean {
  if (recordingId && item.ProviderIds?.MusicBrainzTrack === recordingId) return true;
  if (normalize(item.Name) !== normalize(title)) return false;
  const names = [...(item.Artists ?? []), item.AlbumArtist ?? ''].filter(Boolean);
  return names.some((n) => tokenOverlap(artist, n) >= 0.6 || tokenOverlap(n, artist) >= 0.6);
}

export function matchesAlbum(
  item: JellyfinItem,
  title: string,
  artist: string,
  releaseGroupId?: string,
): boolean {
  if (releaseGroupId && item.ProviderIds?.MusicBrainzReleaseGroup === releaseGroupId) return true;
  if (normalize(item.Name) !== normalize(title)) return false;
  const names = [item.AlbumArtist ?? '', ...(item.AlbumArtists ?? []).map((a) => a.Name)].filter(
    Boolean,
  );
  return names.some((n) => tokenOverlap(artist, n) >= 0.6 || tokenOverlap(n, artist) >= 0.6);
}

export function jellyfinLibrary(options: {
  url: string | undefined;
  apiKey: string | undefined;
  fetch?: Fetch;
}) {
  const doFetch = options.fetch ?? fetch;
  const configured = options.url !== undefined && options.apiKey !== undefined;

  async function items(token: string, params: Record<string, string>): Promise<JellyfinItem[]> {
    const url = new URL(`${options.url}/Items`);
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('Fields', 'ProviderIds,Path');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await httpJson<ItemsResult>(
      'jellyfin',
      url.toString(),
      { headers: { 'x-emby-token': token }, timeoutMs: 8_000 },
      doFetch,
    );
    return res.body?.Items ?? [];
  }

  return {
    configured,
    /** Is this song or album already on the server? Uses the hub's key: the whole library counts. */
    async find(input: {
      kind: 'track' | 'album';
      title: string;
      artist: string;
      recordingId?: string;
      releaseGroupId?: string;
    }): Promise<LibraryMatch | undefined> {
      if (!configured || !options.apiKey) return undefined;
      const found = await items(options.apiKey, {
        SearchTerm: input.title,
        IncludeItemTypes: input.kind === 'track' ? 'Audio' : 'MusicAlbum',
        Limit: '25',
      });
      const item = found.find((i) =>
        input.kind === 'track'
          ? matchesTrack(i, input.title, input.artist, input.recordingId)
          : matchesAlbum(i, input.title, input.artist, input.releaseGroupId),
      );
      return item ? { item, hit: toHit(item) } : undefined;
    },
    /** The instant layer: what the caller may see, by their own token. */
    async search(token: string, text: string, limit = 8): Promise<InstantResults> {
      const empty: InstantResults = { tracks: [], albums: [], artists: [] };
      if (!options.url) return empty;
      const found = await items(token, {
        SearchTerm: text,
        IncludeItemTypes: 'Audio,MusicAlbum,MusicArtist',
        Limit: String(limit * 3),
      });
      const out: InstantResults = { tracks: [], albums: [], artists: [] };
      for (const item of found) {
        const hit = toHit(item);
        const list =
          hit.kind === 'track' ? out.tracks : hit.kind === 'album' ? out.albums : out.artists;
        if (list.length < limit) list.push(hit);
      }
      return out;
    },
    /** Ask Jellyfin to look for new files after an import. */
    async refresh(): Promise<boolean> {
      if (!configured || !options.apiKey) return false;
      await httpJson(
        'jellyfin',
        `${options.url}/Library/Refresh`,
        { method: 'POST', headers: { 'x-emby-token': options.apiKey }, okStatuses: [204] },
        doFetch,
      );
      return true;
    },
  };
}
export type JellyfinLibrary = ReturnType<typeof jellyfinLibrary>;
