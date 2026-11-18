/**
 * JellyfinAdapter: every call Renaissance makes to a Jellyfin server (10.10 and later), mapped from
 * plan.md's "Jellyfin API map" onto the ServerAdapter interface. `fetch` and `WebSocket` are
 * injected so the adapter runs unchanged on web, mobile and under test with a fake server.
 *
 * Notes from the demo server (10.10.7), kept here because they shape the delta refresh (F14):
 * `MinDateLastSaved` answers 500, so new items are found by paging `SortBy=DateCreated` and edited
 * ones by paging `SortBy=DateLastSaved`; `MinDateLastSavedForUser` works and carries favourite and
 * play-count changes. Image endpoints are anonymous, so image URLs never carry the token.
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
  Page,
  PageRequest,
  PlaybackReport,
  Playlists,
  QuickConnect,
  SearchResult,
  ServerAdapter,
  ServerEvents,
  Session,
  SortKey,
  StreamQuality,
} from '../server-adapter';
import { trimTrailingSlashes } from '../url';
import {
  JfAuthResult,
  JfItem,
  JfItemsResult,
  JfLyrics,
  JfPlaylistCreated,
  JfQuickConnectResult,
  JfSocketMessage,
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
}

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

export function toTrack(item: JfItem): Track {
  const audio = item.MediaStreams?.find((s) => s.Type === 'Audio');
  return TrackSchema.parse({
    id: item.Id,
    title: item.Name || '(untitled)',
    albumId: optional(item.AlbumId),
    albumTitle: optional(item.Album),
    artistIds: (item.ArtistItems ?? []).map((a) => a.Id),
    artistName: artistName(item),
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
    ...userData(item),
  });
}

export function toPlaylistEntry(item: JfItem): PlaylistEntry {
  return PlaylistEntrySchema.parse({ ...toTrack(item), entryId: item.PlaylistItemId ?? item.Id });
}

export function toAlbum(item: JfItem): Album {
  const artists = item.AlbumArtists?.length ? item.AlbumArtists : (item.ArtistItems ?? []);
  return AlbumSchema.parse({
    id: item.Id,
    title: item.Name || '(untitled)',
    artistIds: artists.map((a) => a.Id),
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
    ...userData(item),
  });
}

export function toArtist(item: JfItem): Artist {
  return ArtistSchema.parse({
    id: item.Id,
    name: item.Name || '(unknown artist)',
    imageId: primaryImageId(item),
    bio: optional(item.Overview),
    dateAdded: isoDate(item.DateCreated),
    ...userData(item),
  });
}

export function toPlaylist(item: JfItem): Playlist {
  return PlaylistSchema.parse({
    id: item.Id,
    name: item.Name || '(untitled)',
    trackCount: item.ChildCount ?? 0,
    duration: item.RunTimeTicks ? ticksToSeconds(item.RunTimeTicks) : undefined,
    imageId: primaryImageId(item),
    dateAdded: isoDate(item.DateCreated),
    ...userData(item),
  });
}

const TRACK_FIELDS = 'DateCreated,Genres,MediaStreams,ParentId';
const ALBUM_FIELDS = 'DateCreated,Genres,ChildCount';
const ARTIST_FIELDS = 'DateCreated,Overview';
const PLAYLIST_FIELDS = 'DateCreated,ChildCount';

type Params = Record<string, string | number | boolean | undefined>;

export class JellyfinAdapter implements ServerAdapter {
  readonly server: Server;
  private readonly options: JellyfinAdapterOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(server: Server, options: JellyfinAdapterOptions) {
    if (server.kind !== 'jellyfin') {
      throw new Error(`JellyfinAdapter needs a jellyfin server, got ${server.kind}`);
    }
    this.server = { ...server, url: serverBase(server.url) };
    this.options = options;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
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

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    schema: z.ZodType<T>,
    { token, params, body }: { token?: string | undefined; params?: Params; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: this.authorizationHeader(token),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await this.fetchImpl(this.url(path, params), init);
    if (!response.ok) throw new ServerError(response.status, path);
    const text = await response.text();
    const json: unknown = text.length ? JSON.parse(text) : undefined;
    return schema.parse(json);
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
    });
    return this.session(result);
  }

  async signOut(session: Session): Promise<void> {
    await this.request('POST', '/Sessions/Logout', z.unknown(), { token: session.token });
  }

  readonly quickConnect: QuickConnect = {
    enabled: (session?: Session) =>
      this.request('GET', '/QuickConnect/Enabled', z.boolean(), { token: session?.token }),
    initiate: async () => {
      const result = await this.request('POST', '/QuickConnect/Initiate', JfQuickConnectResult);
      return { code: result.Code, secret: result.Secret };
    },
    state: async (secret: string) => {
      const result = await this.request('GET', '/QuickConnect/Connect', JfQuickConnectResult, {
        params: { secret },
      });
      return result.Authenticated;
    },
    authenticate: async (secret: string) => {
      const result = await this.request(
        'POST',
        '/Users/AuthenticateWithQuickConnect',
        JfAuthResult,
        { body: { Secret: secret } },
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
        body: { Name: name, Ids: trackIds, UserId: session.userId, MediaType: 'Audio' },
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
    move: async (session, playlistId, entryId, toIndex) => {
      await this.request(
        'POST',
        `/Playlists/${encodeURIComponent(playlistId)}/Items/${encodeURIComponent(entryId)}/Move/${Math.max(0, Math.floor(toIndex))}`,
        z.unknown(),
        { token: session.token },
      );
    },
    remove: async (session, playlistId) => {
      await this.request('DELETE', `/Items/${encodeURIComponent(playlistId)}`, z.unknown(), {
        token: session.token,
      });
    },
  };

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

  /** Jellyfin's `/socket` channel: `LibraryChanged` and `UserDataChanged` drive the delta refresh (F14). */
  subscribe(session: Session, events: ServerEvents): () => void {
    const Socket = this.options.WebSocket;
    if (!Socket) return () => undefined;
    const url = this.url('/socket', { api_key: session.token, deviceId: this.options.deviceId });
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket | undefined;
    let closed = false;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = (): void => {
      if (closed) return;
      socket = new Socket(url.toString());
      socket.onopen = () => {
        retry = 1000;
        socket?.send(JSON.stringify({ MessageType: 'KeepAlive' }));
      };
      socket.onmessage = (message: { data: unknown }) => {
        const parsed = JfSocketMessage.safeParse(
          typeof message.data === 'string' ? JSON.parse(message.data) : message.data,
        );
        if (!parsed.success) return;
        if (parsed.data.MessageType === 'LibraryChanged') events.onLibraryChanged?.();
        if (parsed.data.MessageType === 'UserDataChanged') events.onUserDataChanged?.();
        if (parsed.data.MessageType === 'ForceKeepAlive') {
          socket?.send(JSON.stringify({ MessageType: 'KeepAlive' }));
        }
      };
      socket.onclose = () => {
        if (closed) return;
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
