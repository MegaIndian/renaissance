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
  ids(kind: 'track' | 'album' | 'artist' | 'playlist'): Promise<string[]>;
}

export interface Favorites {
  set(session: Session, itemId: string, favorite: boolean): Promise<void>;
}

export interface Playlists {
  create(session: Session, name: string, trackIds: string[]): Promise<Playlist>;
  rename(session: Session, playlistId: string, name: string): Promise<void>;
  addTracks(session: Session, playlistId: string, trackIds: string[]): Promise<void>;
  removeEntries(session: Session, playlistId: string, entryIds: string[]): Promise<void>;
  move(session: Session, playlistId: string, entryId: string, toIndex: number): Promise<void>;
  remove(session: Session, playlistId: string): Promise<void>;
}

/** What the server pushes while connected (Jellyfin: the `/socket` websocket). */
export interface ServerEvents {
  onLibraryChanged?: () => void;
  onUserDataChanged?: () => void;
}

export interface ServerAdapter {
  readonly server: Server;
  signIn(credentials: Credentials): Promise<Session>;
  signOut(session: Session): Promise<void>;
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
