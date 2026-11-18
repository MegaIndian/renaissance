/**
 * MusicBrainz web service: recordings, release groups and artists by search, releases by id.
 * One request a second with a User-Agent that names the app and a contact, as MusicBrainz asks.
 */
import { HttpError, httpJson, sleep } from '../http.js';
import type { Fetch } from '../http.js';
import { luceneEscape } from '../text.js';
import { createRateLimiter } from './rate-limiter.js';
import type { RateLimiter } from './rate-limiter.js';

export const MUSICBRAINZ_URL = 'https://musicbrainz.org/ws/2';

export interface MbArtistCredit {
  name: string;
  artist: { id: string; name: string };
}
export interface MbReleaseGroupRef {
  id: string;
  title: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'first-release-date'?: string;
}
export interface MbReleaseRef {
  id: string;
  title: string;
  status?: string;
  date?: string;
  country?: string;
  'release-group'?: MbReleaseGroupRef;
  'track-count'?: number;
  media?: {
    format?: string;
    'track-count'?: number;
    tracks?: {
      id: string;
      number: string;
      title: string;
      length?: number;
      recording?: { id: string; title: string; length?: number };
    }[];
  }[];
}
export interface MbRecording {
  id: string;
  title: string;
  length?: number;
  'artist-credit'?: MbArtistCredit[];
  releases?: MbReleaseRef[];
  'first-release-date'?: string;
  video?: boolean;
}
export interface MbReleaseGroup {
  id: string;
  title: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  'artist-credit'?: MbArtistCredit[];
}
export interface MbArtist {
  id: string;
  name: string;
  disambiguation?: string;
  type?: string;
  score?: number;
}
export interface MbRelease extends MbReleaseRef {
  'artist-credit'?: MbArtistCredit[];
}

export function userAgent(version: string, contact: string | undefined): string {
  return `Renaissance/${version} (${contact ?? 'https://github.com/MegaIndian/renaissance'})`;
}

export function musicBrainzClient(options: {
  version: string;
  contact: string | undefined;
  fetch?: Fetch;
  limiter?: RateLimiter;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}) {
  const doFetch = options.fetch ?? fetch;
  const limiter = options.limiter ?? createRateLimiter(1_000);
  const base = options.baseUrl ?? MUSICBRAINZ_URL;
  const wait = options.sleep ?? sleep;
  const headers = { 'user-agent': userAgent(options.version, options.contact) };

  function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${base}/${path}`);
    url.searchParams.set('fmt', 'json');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // MusicBrainz answers 503 when a client is over its share; wait and try again, twice.
    return limiter.schedule(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await httpJson<T>(
            'musicbrainz',
            url.toString(),
            { headers, timeoutMs: 12_000 },
            doFetch,
          );
          return res.body;
        } catch (error) {
          const retry = error instanceof HttpError && error.status === 503 && attempt < 2;
          if (!retry) throw error;
          await wait(2_000 * (attempt + 1));
        }
      }
    });
  }

  return {
    async searchRecordings(query: string, limit = 10): Promise<MbRecording[]> {
      const body = await get<{ recordings?: MbRecording[] }>('recording', {
        query,
        limit: String(limit),
      });
      return body.recordings ?? [];
    },
    async searchReleaseGroups(query: string, limit = 8): Promise<MbReleaseGroup[]> {
      const body = await get<{ 'release-groups'?: MbReleaseGroup[] }>('release-group', {
        query,
        limit: String(limit),
      });
      return body['release-groups'] ?? [];
    },
    async searchArtists(query: string, limit = 5): Promise<MbArtist[]> {
      const body = await get<{ artists?: MbArtist[] }>('artist', { query, limit: String(limit) });
      return body.artists ?? [];
    },
    /** A release with its media and tracks, for the import mapping. */
    release(id: string): Promise<MbRelease> {
      return get<MbRelease>(`release/${id}`, { inc: 'recordings+artist-credits+release-groups' });
    },
    recording(id: string): Promise<MbRecording> {
      return get<MbRecording>(`recording/${id}`, { inc: 'artist-credits+releases+release-groups' });
    },
  };
}
export type MusicBrainzClient = ReturnType<typeof musicBrainzClient>;

/** `recording:"title" AND artist:"artist"` when both are known, else the words as typed. */
export function recordingQuery(title: string, artist?: string): string {
  const t = luceneEscape(title.trim());
  if (!artist) return t;
  return `recording:"${t}" AND artist:"${luceneEscape(artist.trim())}"`;
}

export function releaseGroupQuery(title: string, artist?: string): string {
  const t = luceneEscape(title.trim());
  if (!artist) return t;
  return `releasegroup:"${t}" AND artist:"${luceneEscape(artist.trim())}"`;
}
