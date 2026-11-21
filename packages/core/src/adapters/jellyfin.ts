/**
 * JellyfinAdapter: every call Renaissance makes to a Jellyfin server (10.10 and later), mapped from
 * plan.md's "Jellyfin API map" onto the ServerAdapter interface. `fetch` and `WebSocket` are
 * injected so the adapter runs unchanged on web, mobile and under test with a fake server.
 *
 * Notes from the demo server (10.10.7), kept here because they shape the delta refresh (F14):
 * `MinDateLastSaved` answers 500, so new items are found by paging `SortBy=DateCreated` and edited
 * ones by paging `SortBy=DateLastSaved`; `MinDateLastSavedForUser` works and filters on the item's
 * own `DateLastSaved` (a metadata save; measured on 10.10.7, a favourite or a play does not bump it,
 * so those reach the cache through the `DateLastSaved` page and the socket's `UserDataChanged`).
 * The delta needs no clock on either side: it reads from the newest `DateCreated` and
 * `DateLastSaved` the previous sync saw, the server's own stamps, which a cross-origin page can read
 * (the `Date` header it cannot). 10.10.7 leaves `DateLastSaved` out of the item DTO even when asked
 * for, and `DateCreated` then stands in. Image endpoints are anonymous, so image URLs never carry
 * the token.
 */
import { z } from 'zod';

import type { Album, Artist, Lyrics, Playlist, PlaylistEntry, Server, Track } from '../models';
import {
  Album as AlbumSchema,
  Artist as ArtistSchema,
  Genre as GenreSchema,
  Playlist as PlaylistSchema,
  PlaylistEntry as PlaylistEntrySchema,
  Track as TrackSchema,
} from '../models';
import type {
  Credentials,
  Favorites,
  ItemQuery,
  Library,
  MoveResult,
  Page,
  PageRequest,
  PlaybackReport,
  Playlists,
  QuickConnect,
  SearchResult,
  ServerAdapter,
  ServerEvents,
  UserDataChange,
  Session,
  SortKey,
  StreamQuality,
} from '../server-adapter';
import { UnreachableError } from '../server-adapter';
import { trimTrailingSlashes } from '../url';
import {
  JfAuthResult,
  JfItem,
  JfItemsResult,
  JfLyrics,
  JfPlaylistCreated,
  JfQuickConnectResult,
  JfSocketMessage,
  JfUserDataChanged,
  JfUserDataEntry,
} from './jellyfin-schemas';

export const CLIENT_NAME = 'Renaissance';

/** Containers and codecs a browser or phone can usually play; the universal endpoint transcodes the rest. */
export const UNIVERSAL_CONTAINERS =
  'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg';

const TICKS_PER_SECOND = 10_000_000;

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}

/** A non-2xx answer from the server, with the status so screens can tell "wrong password" from "down". */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Jellyfin answered ${status} for ${path}`);
    this.name = 'ServerError';
  }
}

export interface JellyfinAdapterOptions {
  deviceName: string;
  deviceId: string;
  version: string;
  fetch?: typeof fetch;
  /** The platform's WebSocket; absent means `subscribe` is a no-op. */
  WebSocket?: typeof WebSocket;
  /** Milliseconds before a request is abandoned as unreachable; tests shorten these. */
  timeouts?: Partial<RequestTimeouts>;
}

export interface RequestTimeouts {
  /** Sign-in, Quick Connect and ping: the user is waiting on a button. */
  auth: number;
  /** Everything else. */
  request: number;
}

export const DEFAULT_TIMEOUTS: RequestTimeouts = { auth: 8_000, request: 15_000 };

/** How `Move/{index}` lands on this server: learned from the first reorder's read-back. */
export type MoveSemantics = 'unknown' | 'standard' | 'priorItem';

const JfPublicInfo = z.object({ Version: z.string().nullish() });
const JfUser = z.object({ Id: z.string(), Name: z.string().nullish() });

/** Header values sit inside double quotes: drop quotes, backslashes and control characters. */
export function headerSafe(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/["\\\u0000-\u001f\u007f]/g, '').trim();
}

/** The server URL without trailing slashes, whatever the caller stored. */
export function serverBase(url: string): string {
  return trimTrailingSlashes(url);
}

export function ticksToSeconds(ticks: number | null | undefined): number {
  return ticks ? ticks / TICKS_PER_SECOND : 0;
}

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

const sortBy: Record<SortKey, string> = {
  name: 'SortName',
  dateAdded: 'DateCreated,SortName',
  year: 'ProductionYear,SortName',
  playCount: 'PlayCount,SortName',
  lastPlayed: 'DatePlayed,SortName',
  random: 'Random',
  lastSaved: 'DateLastSaved',
};

function optional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function lower(value: string | null | undefined): string | undefined {
  return value ? value.toLowerCase() : undefined;
}

/** Jellyfin dates have seven fractional digits; `Date` and Zod want at most three. */
function isoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function userData(item: JfItem) {
  return {
    isFavorite: item.UserData?.IsFavorite ?? false,
    playCount: item.UserData?.PlayCount ?? 0,
    lastPlayed: isoDate(item.UserData?.LastPlayedDate),
  };
}

function primaryImageId(item: JfItem): string | undefined {
  if (item.ImageTags?.['Primary']) return item.Id;
  if (item.AlbumPrimaryImageTag && item.AlbumId) return item.AlbumId;
  return undefined;
}

function artistName(item: JfItem): string {
  const names = (item.ArtistItems ?? []).map((a) => a.Name).filter((n): n is string => !!n);
  if (names.length) return names.join(', ');
  if (item.Artists?.length) return item.Artists.join(', ');
  return item.AlbumArtist ?? '';
}

function credits(list: { Id: string; Name?: string | null | undefined }[] | null | undefined) {
  return (list ?? []).map((a) => ({ id: a.Id, name: a.Name ?? '' }));
}

export function toTrack(item: JfItem): Track {
  const audio = item.MediaStreams?.find((s) => s.Type === 'Audio');
  return TrackSchema.parse({
    id: item.Id,
    title: item.Name?.trim() ?? '',
    albumId: optional(item.AlbumId),
    albumTitle: optional(item.Album),
    artistIds: (item.ArtistItems ?? []).map((a) => a.Id),
    artistName: artistName(item),
    artistCredits: credits(item.ArtistItems),
    albumArtistName: optional(item.AlbumArtist),
    duration: ticksToSeconds(item.RunTimeTicks),
    trackNumber: optional(item.IndexNumber),
    discNumber: optional(item.ParentIndexNumber),
    codec: lower(audio?.Codec) ?? lower(item.Container),
    container: lower(item.Container),
    bitrate: optional(audio?.BitRate),
    sampleRate: optional(audio?.SampleRate),
    year: optional(item.ProductionYear),
    genres: item.Genres ?? [],
    imageId: primaryImageId(item),
    dateAdded: isoDate(item.DateCreated),
    lastSaved: isoDate(item.DateLastSaved),
    ...userData(item),
  });
}

/**
 * The items a `UserDataChanged` push names; an unparseable or absent `Data` names none. Each entry
 * is parsed on its own: one that misses the shape is dropped, the others in the batch still apply.
 */
export function userDataChanges(data: unknown): UserDataChange[] {
  const parsed = JfUserDataChanged.safeParse(data);
  if (!parsed.success) return [];
  return parsed.data.UserDataList.flatMap((raw) => {
    const entry = JfUserDataEntry.safeParse(raw);
    if (!entry.success) return [];
    return [
      {
        itemId: entry.data.ItemId,
        isFavorite: entry.data.IsFavorite ?? undefined,
        playCount: entry.data.PlayCount ?? undefined,
        lastPlayed: isoDate(entry.data.LastPlayedDate),
      },
    ];
  });
}

export function toPlaylistEntry(item: JfItem): PlaylistEntry {
  return PlaylistEntrySchema.parse({ ...toTrack(item), entryId: item.PlaylistItemId ?? item.Id });
}

export function toAlbum(item: JfItem): Album {
  const artists = item.AlbumArtists?.length ? item.AlbumArtists : (item.ArtistItems ?? []);
  return AlbumSchema.parse({
    id: item.Id,
    title: item.Name?.trim() ?? '',
    artistIds: artists.map((a) => a.Id),
    artistCredits: credits(artists),
    artistName:
      item.AlbumArtist ??
      artists
        .map((a) => a.Name)
        .filter(Boolean)
        .join(', '),
    year: optional(item.ProductionYear),
    genres: item.Genres ?? [],
    trackCount: optional(item.ChildCount),
    duration: item.RunTimeTicks ? ticksToSeconds(item.RunTimeTicks) : undefined,
    imageId: primaryImageId(item),
    dateAdded: isoDate(item.DateCreated),
    lastSaved: isoDate(item.DateLastSaved),
    ...userData(item),
  });
}

export function toArtist(item: JfItem): Artist {
  return ArtistSchema.parse({
    id: item.Id,
    name: item.Name?.trim() ?? '',
    imageId: primaryImageId(item),
    bio: optional(item.Overview),
    dateAdded: isoDate(item.DateCreated),
    ...userData(item),
  });
}

export function toPlaylist(item: JfItem): Playlist {
  return PlaylistSchema.parse({
    id: item.Id,
    name: item.Name?.trim() ?? '',
    trackCount: item.ChildCount ?? 0,
    duration: item.RunTimeTicks ? ticksToSeconds(item.RunTimeTicks) : undefined,
    imageId: primaryImageId(item),
    dateAdded: isoDate(item.DateCreated),
    ...userData(item),
  });
}

const TRACK_FIELDS = 'DateCreated,DateLastSaved,Genres,MediaStreams,ParentId';
const ALBUM_FIELDS = 'DateCreated,DateLastSaved,Genres,ChildCount';
/** A song's and an album's fields together, for a fetch by id whose kinds are not known. */
const MUSIC_FIELDS = 'DateCreated,DateLastSaved,Genres,MediaStreams,ParentId,ChildCount';
const ARTIST_FIELDS = 'DateCreated,Overview';
const PLAYLIST_FIELDS = 'DateCreated,ChildCount';

type Params = Record<string, string | number | boolean | undefined>;

export class JellyfinAdapter implements ServerAdapter {
  readonly server: Server;
  private readonly options: JellyfinAdapterOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly timeouts: RequestTimeouts;
  /** Learned on the first reorder (see `playlist-reorder.ts`); exposed so tests and logs can read it. */
  moveSemantics: MoveSemantics = 'unknown';

  constructor(server: Server, options: JellyfinAdapterOptions) {
    if (server.kind !== 'jellyfin') {
      throw new Error(`JellyfinAdapter needs a jellyfin server, got ${server.kind}`);
    }
    this.server = { ...server, url: serverBase(server.url) };
    this.options = options;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  }

  private url(path: string, params: Params = {}): URL {
    const url = new URL(`${this.server.url}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return url;
  }

  /** The `Authorization: MediaBrowser ...` header value Jellyfin expects. */
  authorizationHeader(token?: string): string {
    const parts = [
      `Client="${CLIENT_NAME}"`,
      `Device="${headerSafe(this.options.deviceName)}"`,
      `DeviceId="${headerSafe(this.options.deviceId)}"`,
      `Version="${headerSafe(this.options.version)}"`,
    ];
    if (token) parts.push(`Token="${headerSafe(token)}"`);
    return `MediaBrowser ${parts.join(', ')}`;
  }

  /**
   * One call. Every request carries an `AbortSignal` so a black-holed host fails within the timeout
   * instead of hanging a button; a timeout or a network failure becomes `UnreachableError`.
   */
  private async fetchRaw(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    {
      token,
      params,
      body,
      timeout = 'request',
    }: {
      token?: string | undefined;
      params?: Params;
      body?: unknown;
      timeout?: keyof RequestTimeouts;
    } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: this.authorizationHeader(token),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(this.timeouts[timeout]);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, params), init);
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new UnreachableError(path, timedOut ? 'timeout' : 'network', { cause: error });
    }
    if (!response.ok) throw new ServerError(response.status, path);
    return response;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    schema: z.ZodType<T>,
    options: Parameters<JellyfinAdapter['fetchRaw']>[2] = {},
  ): Promise<T> {
    const response = await this.fetchRaw(method, path, options);
    const text = await response.text();
    const json: unknown = text.length ? JSON.parse(text) : undefined;
    return schema.parse(json);
  }

  async ping(): Promise<{ version: string | null }> {
    const info = await this.request('GET', '/System/Info/Public', JfPublicInfo, {
      timeout: 'auth',
    });
    return { version: info.Version ?? null };
  }

  async me(session: Session): Promise<{ userId: string; userName: string }> {
    const user = await this.request('GET', '/Users/Me', JfUser, { token: session.token });
    return { userId: user.Id, userName: user.Name ?? session.userName };
  }

  private session(result: z.infer<typeof JfAuthResult>): Session {
    return {
      server: this.server,
      userId: result.User.Id,
      userName: result.User.Name,
      token: result.AccessToken,
    };
  }

  async signIn(credentials: Credentials): Promise<Session> {
    const result = await this.request('POST', '/Users/AuthenticateByName', JfAuthResult, {
      body: { Username: credentials.userName, Pw: credentials.password },
      timeout: 'auth',
    });
    return this.session(result);
  }

  async signOut(session: Session): Promise<void> {
    await this.request('POST', '/Sessions/Logout', z.unknown(), { token: session.token });
  }

  readonly quickConnect: QuickConnect = {
    enabled: (session?: Session) =>
      this.request('GET', '/QuickConnect/Enabled', z.boolean(), {
        token: session?.token,
        timeout: 'auth',
      }),
    initiate: async () => {
      const result = await this.request('POST', '/QuickConnect/Initiate', JfQuickConnectResult, {
        timeout: 'auth',
      });
      return { code: result.Code, secret: result.Secret };
    },
    state: async (secret: string) => {
      const result = await this.request('GET', '/QuickConnect/Connect', JfQuickConnectResult, {
        params: { secret },
        timeout: 'auth',
      });
      return result.Authenticated;
    },
    authenticate: async (secret: string) => {
      const result = await this.request(
        'POST',
        '/Users/AuthenticateWithQuickConnect',
        JfAuthResult,
        { body: { Secret: secret }, timeout: 'auth' },
      );
      return this.session(result);
    },
  };

  private queryParams(query: ItemQuery, page: PageRequest): Params {
    return {
      SortBy: query.sort ? sortBy[query.sort] : 'SortName',
      SortOrder:
        (query.order ?? (query.sort === 'name' || !query.sort ? 'asc' : 'desc')) === 'asc'
          ? 'Ascending'
          : 'Descending',
      Filters: query.favorites ? 'IsFavorite' : undefined,
      ArtistIds: query.artistId,
      AlbumArtistIds: query.albumArtistId,
      ParentId: query.albumId,
      Genres: query.genre,
      Years: query.year,
      StartIndex: page.start,
      Limit: page.limit,
    };
  }

  library(session: Session): Library {
    const token = session.token;
    const userId = session.userId;
    const items = (params: Params) =>
      this.request('GET', '/Items', JfItemsResult, {
        token,
        params: { userId, Recursive: true, ...params },
      });
    const one = (id: string, fields: string) =>
      this.request(
        'GET',
        `/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(id)}`,
        JfItem,
        {
          token,
          params: { Fields: fields },
        },
      );
    const pageOf = <T>(
      result: z.infer<typeof JfItemsResult>,
      map: (item: JfItem) => T,
    ): Page<T> => ({
      items: result.Items.map(map),
      total: result.TotalRecordCount,
    });
    const artistsFrom = async (path: string, page: PageRequest, query: ItemQuery) =>
      pageOf(
        await this.request('GET', path, JfItemsResult, {
          token,
          params: {
            userId,
            Fields: ARTIST_FIELDS,
            ...this.queryParams(query, page),
            // Artists do not sort by play count or year; the server would answer 400.
            SortBy: query.sort === 'random' ? 'Random' : 'SortName',
            Genres: query.genre,
          },
        }),
        toArtist,
      );
    const tracksWhere = async (params: Params, page: PageRequest = {}) =>
      pageOf(
        await items({
          IncludeItemTypes: 'Audio',
          Fields: TRACK_FIELDS,
          StartIndex: page.start,
          Limit: page.limit,
          ...params,
        }),
        toTrack,
      );
    const library: Library = {
      artists: (page = {}, query = {}) => artistsFrom('/Artists', page, query),
      albumArtists: (page = {}, query = {}) => artistsFrom('/Artists/AlbumArtists', page, query),
      artist: async (id) => toArtist(await one(id, ARTIST_FIELDS)),
      albums: async (page = {}, query = {}) =>
        pageOf(
          await items({
            IncludeItemTypes: 'MusicAlbum',
            Fields: ALBUM_FIELDS,
            ...this.queryParams(query, page),
          }),
          toAlbum,
        ),
      album: async (id) => toAlbum(await one(id, ALBUM_FIELDS)),
      albumTracks: async (albumId) =>
        (
          await tracksWhere({
            ParentId: albumId,
            SortBy: 'ParentIndexNumber,IndexNumber,SortName',
            SortOrder: 'Ascending',
          })
        ).items,
      tracks: (page = {}, query = {}) => tracksWhere(this.queryParams(query, page)),
      track: async (id) => toTrack(await one(id, TRACK_FIELDS)),
      genres: async () => {
        const result = await this.request('GET', '/MusicGenres', JfItemsResult, {
          token,
          params: { userId, SortBy: 'SortName', SortOrder: 'Ascending' },
        });
        return result.Items.map((g) => GenreSchema.parse({ id: g.Id, name: g.Name ?? '' }));
      },
      years: async () => {
        const result = await this.request('GET', '/Years', JfItemsResult, {
          token,
          params: { userId, IncludeItemTypes: 'Audio', Recursive: true },
        });
        return result.Items.map((y) => Number(y.Name))
          .filter((y) => Number.isInteger(y))
          .sort((a, b) => b - a);
      },
      playlists: async (page = {}, query = {}) =>
        pageOf(
          await items({
            IncludeItemTypes: 'Playlist',
            Fields: PLAYLIST_FIELDS,
            ...this.queryParams({ sort: 'name', ...query }, page),
            SortBy: query.sort === 'dateAdded' ? 'DateCreated,SortName' : 'SortName',
          }),
          toPlaylist,
        ),
      playlist: async (id) => toPlaylist(await one(id, PLAYLIST_FIELDS)),
      playlistTracks: async (playlistId) => {
        const result = await this.request(
          'GET',
          `/Playlists/${encodeURIComponent(playlistId)}/Items`,
          JfItemsResult,
          { token, params: { userId, Fields: TRACK_FIELDS } },
        );
        return result.Items.map(toPlaylistEntry);
      },
      search: async (term, limit = 20) => {
        const [tracks, albums, artists, playlists] = await Promise.all([
          items({
            searchTerm: term,
            IncludeItemTypes: 'Audio',
            Fields: TRACK_FIELDS,
            Limit: limit,
          }),
          items({
            searchTerm: term,
            IncludeItemTypes: 'MusicAlbum',
            Fields: ALBUM_FIELDS,
            Limit: limit,
          }),
          this.request('GET', '/Artists', JfItemsResult, {
            token,
            params: { userId, searchTerm: term, Fields: ARTIST_FIELDS, Limit: limit },
          }),
          items({
            searchTerm: term,
            IncludeItemTypes: 'Playlist',
            Fields: PLAYLIST_FIELDS,
            Limit: limit,
          }),
        ]);
        return {
          tracks: tracks.Items.map(toTrack),
          albums: albums.Items.map(toAlbum),
          artists: artists.Items.map(toArtist),
          playlists: playlists.Items.map(toPlaylist),
        } satisfies SearchResult;
      },
      latest: async (limit = 12) => {
        const latest = z.array(JfItem);
        const [albums, tracks] = await Promise.all([
          this.request('GET', `/Users/${encodeURIComponent(userId)}/Items/Latest`, latest, {
            token,
            params: { IncludeItemTypes: 'MusicAlbum', Fields: ALBUM_FIELDS, Limit: limit },
          }),
          this.request('GET', `/Users/${encodeURIComponent(userId)}/Items/Latest`, latest, {
            token,
            params: { IncludeItemTypes: 'Audio', Fields: TRACK_FIELDS, Limit: limit },
          }),
        ]);
        return { albums: albums.map(toAlbum), tracks: tracks.map(toTrack) };
      },
      recentlyPlayed: async (limit = 12) =>
        (
          await tracksWhere({
            SortBy: 'DatePlayed',
            SortOrder: 'Descending',
            Filters: 'IsPlayed',
            Limit: limit,
          })
        ).items,
      mostPlayed: async (limit = 12) =>
        (
          await tracksWhere({
            SortBy: 'PlayCount',
            SortOrder: 'Descending',
            Filters: 'IsPlayed',
            Limit: limit,
          })
        ).items,
      favorites: (page = {}) =>
        tracksWhere({ Filters: 'IsFavorite', SortBy: 'SortName', SortOrder: 'Ascending' }, page),
      similarArtists: async (artistId, limit = 12) => {
        const result = await this.request(
          'GET',
          `/Artists/${encodeURIComponent(artistId)}/Similar`,
          JfItemsResult,
          { token, params: { userId, limit, Fields: ARTIST_FIELDS } },
        );
        return result.Items.map(toArtist);
      },
      instantMix: async (itemId, limit = 50) => {
        const result = await this.request(
          'GET',
          `/Items/${encodeURIComponent(itemId)}/InstantMix`,
          JfItemsResult,
          { token, params: { userId, limit, Fields: TRACK_FIELDS } },
        );
        return result.Items.map(toTrack);
      },
      userDataChangedSince: (since, page = {}) =>
        tracksWhere({ MinDateLastSavedForUser: since, SortBy: 'SortName' }, page),
      ids: async (kind) => {
        const type = {
          track: 'Audio',
          album: 'MusicAlbum',
          artist: 'MusicArtist',
          playlist: 'Playlist',
        }[kind];
        const path = kind === 'artist' ? '/Artists' : '/Items';
        const out: string[] = [];
        const limit = 2000;
        for (let start = 0; ; start += limit) {
          const result = await this.request('GET', path, JfItemsResult, {
            token,
            params: {
              userId,
              Recursive: true,
              IncludeItemTypes: kind === 'artist' ? undefined : type,
              EnableImages: false,
              EnableUserData: false,
              EnableTotalRecordCount: true,
              SortBy: 'SortName',
              StartIndex: start,
              Limit: limit,
            },
          });
          out.push(...result.Items.map((i) => i.Id));
          if (result.Items.length < limit || out.length >= result.TotalRecordCount) break;
        }
        return out;
      },
      musicByIds: async (wanted) => {
        const tracks: Track[] = [];
        const albums: Album[] = [];
        const chunk = 100;
        for (let start = 0; start < wanted.length; start += chunk) {
          const result = await items({
            Ids: wanted.slice(start, start + chunk).join(','),
            Fields: MUSIC_FIELDS,
          });
          for (const item of result.Items) {
            if (item.Type === 'Audio') tracks.push(toTrack(item));
            else if (item.Type === 'MusicAlbum') albums.push(toAlbum(item));
          }
        }
        return { tracks, albums };
      },
      byIds: (async (kind: 'track' | 'album', wanted: readonly string[]) => {
        const out: (Track | Album)[] = [];
        const chunk = 100;
        for (let start = 0; start < wanted.length; start += chunk) {
          const result = await items({
            Ids: wanted.slice(start, start + chunk).join(','),
            IncludeItemTypes: kind === 'track' ? 'Audio' : 'MusicAlbum',
            Fields: kind === 'track' ? TRACK_FIELDS : ALBUM_FIELDS,
          });
          if (kind === 'track') out.push(...result.Items.map(toTrack));
          else out.push(...result.Items.map(toAlbum));
        }
        return out;
      }) as Library['byIds'],
    };
    return library;
  }

  readonly favorites: Favorites = {
    set: async (session, itemId, favorite) => {
      await this.request(
        favorite ? 'POST' : 'DELETE',
        `/UserFavoriteItems/${encodeURIComponent(itemId)}`,
        z.unknown(),
        { token: session.token, params: { userId: session.userId } },
      );
    },
  };

  readonly playlists: Playlists = {
    create: async (session, name, trackIds) => {
      const created = await this.request('POST', '/Playlists', JfPlaylistCreated, {
        token: session.token,
        body: {
          Name: name,
          Ids: trackIds,
          UserId: session.userId,
          MediaType: 'Audio',
          // 10.10 defaults to a public playlist that every other user sees (F86).
          IsPublic: false,
        },
      });
      return this.library(session).playlist(created.Id);
    },
    rename: async (session, playlistId, name) => {
      await this.request('POST', `/Playlists/${encodeURIComponent(playlistId)}`, z.unknown(), {
        token: session.token,
        body: { Name: name },
      });
    },
    addTracks: async (session, playlistId, trackIds) => {
      if (!trackIds.length) return;
      await this.request(
        'POST',
        `/Playlists/${encodeURIComponent(playlistId)}/Items`,
        z.unknown(),
        {
          token: session.token,
          params: { ids: trackIds.join(','), userId: session.userId },
        },
      );
    },
    removeEntries: async (session, playlistId, entryIds) => {
      if (!entryIds.length) return;
      await this.request(
        'DELETE',
        `/Playlists/${encodeURIComponent(playlistId)}/Items`,
        z.unknown(),
        {
          token: session.token,
          params: { entryIds: entryIds.join(',') },
        },
      );
    },
    move: (session, playlistId, entryId, toIndex) =>
      this.movePlaylistEntry(session, playlistId, entryId, toIndex),
    remove: async (session, playlistId) => {
      await this.request('DELETE', `/Items/${encodeURIComponent(playlistId)}`, z.unknown(), {
        token: session.token,
      });
    },
  };

  private async moveOnce(
    session: Session,
    playlistId: string,
    entryId: string,
    index: number,
  ): Promise<void> {
    await this.request(
      'POST',
      `/Playlists/${encodeURIComponent(playlistId)}/Items/${encodeURIComponent(entryId)}/Move/${Math.max(0, Math.floor(index))}`,
      z.unknown(),
      { token: session.token },
    );
  }

  /**
   * Move with a read-back (see `playlist-reorder.ts`). First call: send the index as is, read back,
   * and learn whether this server lands where asked (`standard`) or one slot off (`priorItem`, 10.10).
   * On a `priorItem` server the compensating moves are planned from the measured model. The result
   * carries the server's final order and whether it is the one asked for.
   */
  private async movePlaylistEntry(
    session: Session,
    playlistId: string,
    entryId: string,
    toIndex: number,
  ): Promise<MoveResult> {
    // The planner is only needed here; loading it on demand keeps it out of the app shell.
    const { landingIndex10_10, planMoves10_10, reorder } = await import('../playlist-reorder');
    const library = this.library(session);
    let entries = await library.playlistTracks(playlistId);
    const from = entries.findIndex((e) => e.entryId === entryId);
    const to = Math.max(0, Math.min(Math.floor(toIndex), entries.length - 1));
    let calls = 1;
    if (from < 0 || from === to) return { entries, ok: from >= 0, calls };
    const wanted = reorder(
      entries.map((e) => e.entryId),
      from,
      to,
    );
    const same = (list: PlaylistEntry[]) => list.every((e, i) => e.entryId === wanted[i]);
    const n = entries.length;

    if (this.moveSemantics !== 'priorItem') {
      await this.moveOnce(session, playlistId, entryId, to);
      entries = await library.playlistTracks(playlistId);
      calls += 2;
      if (same(entries)) {
        this.moveSemantics = 'standard';
        return { entries, ok: true, calls };
      }
      const landed = entries.findIndex((e) => e.entryId === entryId);
      if (entries.length !== n || landed !== landingIndex10_10(from, to, n)) {
        // Neither model explains the landing (a concurrent edit, a server this code has not met):
        // forget what was learned and measure again on the next move.
        this.moveSemantics = 'unknown';
        return { entries, ok: false, calls };
      }
      this.moveSemantics = 'priorItem';
    }

    // A 10.10 server: plan from where the entry sits now to where it should be.
    const current = entries.findIndex((e) => e.entryId === entryId);
    const target = wanted.indexOf(entryId);
    for (const step of planMoves10_10(
      entries.map((e) => e.entryId),
      current,
      target,
    )) {
      await this.moveOnce(session, playlistId, step.entryId, step.index);
      calls += 1;
    }
    entries = await library.playlistTracks(playlistId);
    calls += 1;
    const ok = same(entries);
    // A planned sequence that did not land means the model is wrong for this server now (a
    // `standard` server whose first landing happened to match 10.10, or a concurrent edit): back
    // to `unknown`, so the next move is measured instead of planned under the wrong model.
    if (!ok) this.moveSemantics = 'unknown';
    return { entries, ok, calls };
  }

  streamUrl(
    session: Session,
    track: Track,
    quality: StreamQuality,
    playSessionId?: string,
  ): string {
    return this.url(`/Audio/${encodeURIComponent(track.id)}/universal`, {
      UserId: session.userId,
      DeviceId: this.options.deviceId,
      api_key: session.token,
      Container: UNIVERSAL_CONTAINERS,
      TranscodingContainer: 'mp3',
      TranscodingProtocol: 'http',
      AudioCodec: 'mp3',
      MaxStreamingBitrate: quality === 'original' ? undefined : quality.maxBitrate,
      PlaySessionId: playSessionId,
    }).toString();
  }

  downloadUrl(session: Session, track: Track): string {
    return this.url(`/Items/${encodeURIComponent(track.id)}/Download`, {
      api_key: session.token,
    }).toString();
  }

  /** Images are anonymous on Jellyfin, so the URL carries no token and can be cached by the browser. */
  imageUrl(_session: Session, imageId: string, width = 300): string {
    return this.url(`/Items/${encodeURIComponent(imageId)}/Images/Primary`, {
      fillWidth: width,
      quality: 90,
    }).toString();
  }

  async lyrics(session: Session, trackId: string): Promise<Lyrics | null> {
    try {
      const result = await this.request(
        'GET',
        `/Audio/${encodeURIComponent(trackId)}/Lyrics`,
        JfLyrics,
        { token: session.token },
      );
      if (!result.Lyrics.length) return null;
      const synced = result.Lyrics.every((l) => typeof l.Start === 'number');
      return {
        trackId,
        synced,
        lines: result.Lyrics.map((l) => ({
          text: l.Text,
          ...(typeof l.Start === 'number' ? { start: l.Start / 10_000 } : {}),
        })),
      };
    } catch (error) {
      if (error instanceof ServerError && error.status === 404) return null;
      throw error;
    }
  }

  async reportPlayback(session: Session, report: PlaybackReport): Promise<void> {
    const path = {
      started: '/Sessions/Playing',
      progress: '/Sessions/Playing/Progress',
      stopped: '/Sessions/Playing/Stopped',
    }[report.state];
    await this.request('POST', path, z.unknown(), {
      token: session.token,
      body: {
        ItemId: report.trackId,
        MediaSourceId: report.trackId,
        PositionTicks: secondsToTicks(report.position),
        IsPaused: report.paused ?? false,
        PlayMethod: report.method === 'transcode' ? 'Transcode' : 'DirectPlay',
        PlaySessionId: report.playSessionId,
        CanSeek: true,
        ...(report.state === 'progress' ? { EventName: 'TimeUpdate' } : {}),
      },
    });
  }

  /**
   * Jellyfin's `/socket` channel (F14): `LibraryChanged` schedules the delta refresh; `UserDataChanged`
   * names the items whose favourite or play count changed on any device, so the cache can patch them
   * at once (the delta cannot see them: 10.10.7 does not bump `DateLastSaved` for user data, ADR 0013).
   */
  subscribe(session: Session, events: ServerEvents): () => void {
    const Socket = this.options.WebSocket;
    if (!Socket) return () => undefined;
    const url = this.url('/socket', { api_key: session.token, deviceId: this.options.deviceId });
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket | undefined;
    let closed = false;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The upgrade carries the token as `api_key` and a refusal never passes through `fetch`, so a
    // revoked token would reconnect forever. Two closes in a row before any open ask `/Users/Me`
    // once, through `fetch`, where a 401 ends the session (see `createAdapter` on the web).
    let failedBeforeOpen = 0;
    let probed = false;
    let opened = false;
    const open = (): void => {
      if (closed) return;
      opened = false;
      socket = new Socket(url.toString());
      socket.onopen = () => {
        opened = true;
        retry = 1000;
        failedBeforeOpen = 0;
        probed = false;
        socket?.send(JSON.stringify({ MessageType: 'KeepAlive' }));
      };
      socket.onmessage = (message: { data: unknown }) => {
        let data: unknown = message.data;
        if (typeof data === 'string') {
          // One malformed frame from a proxy must not throw out of the handler.
          try {
            data = JSON.parse(data);
          } catch {
            return;
          }
        }
        const parsed = JfSocketMessage.safeParse(data);
        if (!parsed.success) return;
        if (parsed.data.MessageType === 'LibraryChanged') events.onLibraryChanged?.();
        if (parsed.data.MessageType === 'UserDataChanged') {
          events.onUserDataChanged?.(userDataChanges(parsed.data.Data));
        }
        if (parsed.data.MessageType === 'ForceKeepAlive') {
          socket?.send(JSON.stringify({ MessageType: 'KeepAlive' }));
        }
      };
      socket.onclose = () => {
        if (closed) return;
        if (!opened && ++failedBeforeOpen >= 2 && !probed) {
          probed = true;
          void this.me(session).catch(() => undefined);
        }
        timer = setTimeout(open, retry);
        retry = Math.min(retry * 2, 60_000);
      };
      socket.onerror = () => socket?.close();
    };
    open();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }
}
