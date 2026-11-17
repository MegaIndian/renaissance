/**
 * JellyfinAdapter stub (phase 0). Phase 1 fills every method against the Jellyfin 10.10+ API
 * (plan.md "Jellyfin API map"). Only the pure URL builders are real here so they can be tested.
 */
import type { Lyrics, Server, Track } from '../models';
import { trimTrailingSlashes } from '../url';
import type {
  Credentials,
  Library,
  PlaybackReport,
  ServerAdapter,
  Session,
  StreamQuality,
} from '../server-adapter';

export const CLIENT_NAME = 'Renaissance';

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (phase 1)`);
    this.name = 'NotImplementedError';
  }
}

export interface JellyfinAdapterOptions {
  deviceName: string;
  deviceId: string;
  version: string;
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

export class JellyfinAdapter implements ServerAdapter {
  readonly server: Server;
  private readonly options: JellyfinAdapterOptions;

  constructor(server: Server, options: JellyfinAdapterOptions) {
    if (server.kind !== 'jellyfin') {
      throw new Error(`JellyfinAdapter needs a jellyfin server, got ${server.kind}`);
    }
    this.server = { ...server, url: serverBase(server.url) };
    this.options = options;
  }

  private url(path: string): URL {
    return new URL(`${this.server.url}${path}`);
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

  signIn(_credentials: Credentials): Promise<Session> {
    return Promise.reject(new NotImplementedError('signIn'));
  }

  library(_session: Session): Library {
    throw new NotImplementedError('library');
  }

  streamUrl(session: Session, track: Track, quality: StreamQuality): string {
    const url = this.url(`/Audio/${encodeURIComponent(track.id)}/universal`);
    url.searchParams.set('UserId', session.userId);
    url.searchParams.set('DeviceId', this.options.deviceId);
    url.searchParams.set('api_key', session.token);
    url.searchParams.set(
      'Container',
      'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg',
    );
    url.searchParams.set('TranscodingContainer', 'mp3');
    url.searchParams.set('TranscodingProtocol', 'http');
    url.searchParams.set('AudioCodec', 'mp3');
    if (quality !== 'original') {
      url.searchParams.set('MaxStreamingBitrate', String(quality.maxBitrate));
    }
    return url.toString();
  }

  downloadUrl(session: Session, track: Track): string {
    const url = this.url(`/Items/${encodeURIComponent(track.id)}/Download`);
    url.searchParams.set('api_key', session.token);
    return url.toString();
  }

  imageUrl(_session: Session, imageId: string, width = 300): string {
    const url = this.url(`/Items/${encodeURIComponent(imageId)}/Images/Primary`);
    url.searchParams.set('fillWidth', String(width));
    url.searchParams.set('quality', '90');
    return url.toString();
  }

  lyrics(_session: Session, _trackId: string): Promise<Lyrics | null> {
    return Promise.reject(new NotImplementedError('lyrics'));
  }

  reportPlayback(_session: Session, _report: PlaybackReport): Promise<void> {
    return Promise.reject(new NotImplementedError('reportPlayback'));
  }
}
