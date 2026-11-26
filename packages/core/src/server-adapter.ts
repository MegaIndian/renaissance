/**
 * ServerAdapter: the one interface every music server implements.
 * JellyfinAdapter in v1; a Subsonic adapter (F6) can be added without touching any screen.
 * Every method takes the `Session` so one adapter can serve several accounts on the same server.
 */
import type {
  Album,
  Artist,
  Genre,
  Lyrics,
  Playlist,
  PlaylistEntry,
  Server,
  Track,
} from './models';

/**
 * The server could not be reached at all: no route, a refused connection, or no answer within the
 * adapter's timeout. Screens show the "could not reach that server" sentence for this one.
 */
export class UnreachableError extends Error {
  constructor(
    readonly path: string,
    readonly reason: 'timeout' | 'network',
    options?: ErrorOptions,
  ) {
    super(`${reason === 'timeout' ? 'No answer in time' : 'No connection'} for ${path}`, options);
    this.name = 'UnreachableError';
  }
}

/**
 * The caller gave up on the work (a sign-out while the library was syncing): the request was
 * aborted on purpose and nothing is wrong with the server. Nothing is shown for this one.
 */
export class CancelledError extends Error {
  constructor(what: string) {
    super(`Cancelled ${what}`);
    this.name = 'CancelledError';
  }
}

export type StreamQuality = 'original' | { maxBitrate: number };

export interface Credentials {
  userName: string;
  password: string;
}

export interface Session {
  server: Server;
  userId: string;
  userName: string;
  /** Opaque token kept in the platform's most secure store (ADR 0008), never in plain files. */
  token: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface PageRequest {
  start?: number;
  limit?: number;
  /** Aborts the request; the adapter rejects with `CancelledError` once it fires. */
  signal?: AbortSignal | undefined;
}

/** Options for the bulk reads a sync makes outside of pages. */
export interface RequestOptions {
  signal?: AbortSignal | undefined;
}

/** Sort keys every list offers (F15); each adapter maps them to its server's names. */
export type SortKey =
  | 'name'
  | 'dateAdded'
  | 'year'
  | 'playCount'
  | 'lastPlayed'
  | 'random'
  /** Most recently edited on the server first; used by the delta refresh, not offered in menus. */
  | 'lastSaved';
export type SortOrder = 'asc' | 'desc';

export interface ItemQuery {
  sort?: SortKey;
  order?: SortOrder;
  /** Only favourites (F12). */
  favorites?: boolean;
  artistId?: string;
  albumArtistId?: string;
  albumId?: string;
  genre?: string;
  year?: number;
  /** Items the server saw as new or changed after this ISO datetime, for the delta refresh (F14). */
  addedAfter?: string;
}

export interface SearchResult {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
  playlists: Playlist[];
}

export type PlayMethod = 'direct' | 'transcode';

export interface PlaybackReport {
  trackId: string;
  /** Position in seconds. */
  position: number;
  state: 'started' | 'progress' | 'stopped';
  paused?: boolean;
  method?: PlayMethod;
  /** One id per playback of a track, so the server can tell two plays of the same song apart. */
  playSessionId?: string;
}

export interface QuickConnectStart {
  /** The code the user types into the Jellyfin web app. */
  code: string;
  /** Opaque; polled with `state` and then exchanged with `authenticate`. */
  secret: string;
}

export interface QuickConnect {
  enabled(session?: Session): Promise<boolean>;
  initiate(): Promise<QuickConnectStart>;
  /** True once the user has approved the code on the server. */
  state(secret: string): Promise<boolean>;
  authenticate(secret: string): Promise<Session>;
}

export interface Library {
  artists(page?: PageRequest, query?: ItemQuery): Promise<Page<Artist>>;
  albumArtists(page?: PageRequest, query?: ItemQuery): Promise<Page<Artist>>;
  artist(id: string): Promise<Artist>;
  albums(page?: PageRequest, query?: ItemQuery): Promise<Page<Album>>;
  album(id: string): Promise<Album>;
  albumTracks(albumId: string): Promise<Track[]>;
  tracks(page?: PageRequest, query?: ItemQuery): Promise<Page<Track>>;
  track(id: string): Promise<Track>;
  genres(): Promise<Genre[]>;
  years(): Promise<number[]>;
  playlists(page?: PageRequest, query?: ItemQuery): Promise<Page<Playlist>>;
  playlist(id: string): Promise<Playlist>;
  playlistTracks(playlistId: string): Promise<PlaylistEntry[]>;
  search(term: string, limit?: number): Promise<SearchResult>;
  /** Most recently added albums, or tracks when the server has loose files without albums. */
  latest(limit?: number): Promise<{ albums: Album[]; tracks: Track[] }>;
  recentlyPlayed(limit?: number): Promise<Track[]>;
  mostPlayed(limit?: number): Promise<Track[]>;
  favorites(page?: PageRequest): Promise<Page<Track>>;
  similarArtists(artistId: string, limit?: number): Promise<Artist[]>;
  instantMix(itemId: string, limit?: number): Promise<Track[]>;
  /**
   * Items whose per-user data (favourite, play count) changed after `since`, for the delta
   * refresh. Tracks only; albums and artists follow from their tracks.
   */
  userDataChangedSince(since: string, page?: PageRequest): Promise<Page<Track>>;
  /** Every id of a kind, cheaply, so the cache can drop what the server deleted. */
  ids(kind: 'track' | 'album' | 'artist' | 'playlist', options?: RequestOptions): Promise<string[]>;
  /** The items behind these ids, so the cache can fetch what a delta missed (tracks and albums). */
  byIds(kind: 'track', ids: readonly string[], options?: RequestOptions): Promise<Track[]>;
  byIds(kind: 'album', ids: readonly string[], options?: RequestOptions): Promise<Album[]>;
  /**
   * The music behind ids of unknown kind (a push names whatever any device touched): one request,
   * the answer sorted by the server's own type; anything that is not a song or an album is dropped.
   */
  musicByIds(ids: readonly string[]): Promise<{ tracks: Track[]; albums: Album[] }>;
}

export interface Favorites {
  set(session: Session, itemId: string, favorite: boolean): Promise<void>;
}

export interface MoveResult {
  /** The playlist as the server has it after the move, read back. */
  entries: PlaylistEntry[];
  /** True when the read-back order is the one asked for. */
  ok: boolean;
  /** How many server calls it took. */
  calls: number;
}

export interface Playlists {
  /** A new playlist visible to this user only. */
  create(session: Session, name: string, trackIds: string[]): Promise<Playlist>;
  rename(session: Session, playlistId: string, name: string): Promise<void>;
  addTracks(session: Session, playlistId: string, trackIds: string[]): Promise<void>;
  removeEntries(session: Session, playlistId: string, entryIds: string[]): Promise<void>;
  /**
   * Put the entry at `toIndex`, then read the playlist back. Adapters compensate for servers whose
   * move does not land where asked and report whether the final order matches.
   */
  move(session: Session, playlistId: string, entryId: string, toIndex: number): Promise<MoveResult>;
  remove(session: Session, playlistId: string): Promise<void>;
}

/**
 * One item's per-user data as the server pushed it (a favourite or a play on any device). Fields the
 * push left out are unknown, not false.
 */
export interface UserDataChange {
  itemId: string;
  isFavorite?: boolean | undefined;
  playCount?: number | undefined;
  lastPlayed?: string | undefined;
}

/** What the server pushes while connected (Jellyfin: the `/socket` websocket). */
export interface ServerEvents {
  onLibraryChanged?: () => void;
  /** The items whose user data changed, when the push names them; an empty list when it does not. */
  onUserDataChanged?: (changes: UserDataChange[]) => void;
}

export interface ServerAdapter {
  readonly server: Server;
  /** Is anything answering at this address? The server's version when it is. Needs no session. */
  ping(): Promise<{ version: string | null }>;
  signIn(credentials: Credentials): Promise<Session>;
  signOut(session: Session): Promise<void>;
  /** Who this token belongs to; throws `ServerError` 401 when the server has revoked it. */
  me(session: Session): Promise<{ userId: string; userName: string }>;
  readonly quickConnect: QuickConnect;
  library(session: Session): Library;
  readonly favorites: Favorites;
  readonly playlists: Playlists;
  streamUrl(session: Session, track: Track, quality: StreamQuality, playSessionId?: string): string;
  downloadUrl(session: Session, track: Track): string;
  imageUrl(session: Session, imageId: string, width?: number): string;
  lyrics(session: Session, trackId: string): Promise<Lyrics | null>;
  reportPlayback(session: Session, report: PlaybackReport): Promise<void>;
  /** Subscribe to server pushes; returns the unsubscribe. Adapters without a channel return a no-op. */
  subscribe(session: Session, events: ServerEvents): () => void;
}
