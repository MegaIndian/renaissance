/**
 * ServerAdapter: the one interface every music server implements.
 * JellyfinAdapter in v1; a Subsonic adapter (F6) can be added without touching any screen.
 */
import type { Album, Artist, Lyrics, Playlist, Server, Track } from './models';

export type StreamQuality = 'original' | { maxBitrate: number };

export interface Credentials {
  userName: string;
  password: string;
}

export interface Session {
  server: Server;
  userId: string;
  userName: string;
  /** Opaque token kept in the platform keychain, never in plain files. */
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

export interface SearchResult {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
  playlists: Playlist[];
}

export interface PlaybackReport {
  trackId: string;
  /** Position in seconds. */
  position: number;
  state: 'started' | 'progress' | 'stopped';
}

export interface Library {
  artists(page?: PageRequest): Promise<Page<Artist>>;
  albums(page?: PageRequest): Promise<Page<Album>>;
  albumTracks(albumId: string): Promise<Track[]>;
  playlists(page?: PageRequest): Promise<Page<Playlist>>;
  playlistTracks(playlistId: string): Promise<Track[]>;
  search(term: string): Promise<SearchResult>;
  latest(limit?: number): Promise<Album[]>;
  favorites(page?: PageRequest): Promise<Page<Track>>;
}

export interface ServerAdapter {
  readonly server: Server;
  signIn(credentials: Credentials): Promise<Session>;
  library(session: Session): Library;
  streamUrl(session: Session, track: Track, quality: StreamQuality): string;
  downloadUrl(session: Session, track: Track): string;
  imageUrl(session: Session, imageId: string, width?: number): string;
  lyrics(session: Session, trackId: string): Promise<Lyrics | null>;
  reportPlayback(session: Session, report: PlaybackReport): Promise<void>;
}
