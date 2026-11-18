/**
 * Deezer's public search: cover art, 30-second previews, and the typeahead's rows. No key, no
 * account. Deezer allows about 50 requests per 5 seconds per address and answers a quota hit as a
 * `200` with an `error` body and no `data`, so calls are spaced through a limiter of their own (the
 * typist's older prefixes are dropped as they type) and any failure is reported as `undefined`,
 * never as an empty list that would be cached as "nothing found". A refusal by the limiter itself
 * (`busy`, `superseded`) is thrown, so the route can answer 503 and the app keeps its rows.
 */
import { httpJson } from '../http.js';
import type { Fetch } from '../http.js';
import { LimiterBusyError, createRateLimiter } from './rate-limiter.js';
import type { RateLimiter, ScheduleOptions } from './rate-limiter.js';

export const DEEZER_URL = 'https://api.deezer.com';
/** 50 per 5 s: one every 100 ms keeps the house under Deezer's quota. */
export const DEEZER_INTERVAL_MS = 100;

export interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  preview?: string;
  artist: { id: number; name: string; picture_medium?: string };
  album: { id: number; title: string; cover_medium?: string; cover_big?: string };
}

export interface DeezerAlbum {
  id: number;
  title: string;
  cover_medium?: string;
  cover_big?: string;
  artist: { id: number; name: string; picture_medium?: string };
  record_type?: string;
  release_date?: string;
}

export interface DeezerArtist {
  id: number;
  name: string;
  picture_medium?: string;
}

export function deezerClient(
  options: { fetch?: Fetch; baseUrl?: string; limiter?: RateLimiter } = {},
) {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl ?? DEEZER_URL;
  const limiter = options.limiter ?? createRateLimiter(DEEZER_INTERVAL_MS, { maxQueue: 48 });

  /** The `data` list, or undefined when Deezer failed, refused (quota) or answered no list. */
  async function list<T>(
    path: string,
    q: string,
    limit: number,
    who: Omit<ScheduleOptions, 'key'>,
  ): Promise<T[] | undefined> {
    const url = new URL(`${base}/${path}`);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(limit));
    try {
      const res = await limiter.schedule(
        () =>
          httpJson<{ data?: T[]; error?: { code?: number; message?: string } }>(
            'deezer',
            url.toString(),
            { timeoutMs: 6_000 },
            doFetch,
          ),
        { ...who, key: url.toString() },
      );
      if (res.body?.error || !Array.isArray(res.body?.data)) return undefined;
      return res.body.data;
    } catch (error) {
      if (error instanceof LimiterBusyError) throw error;
      // Art and previews are decoration and the typeahead has other sources: a Deezer outage must
      // not break search. The caller sees "no answer", not "no songs".
      return undefined;
    }
  }

  /** Deezer's advanced syntax: a quote inside a name would end the field, so it is dropped. */
  const field = (name: string, value: string): string =>
    `${name}:"${value.replace(/"/g, '').trim()}"`;

  return {
    search: (q: string, limit = 15, who: Omit<ScheduleOptions, 'key'> = {}) =>
      list<DeezerTrack>('search', q, limit, who),
    /** `artist:"adele" track:"rolling in the deep"`: the song by that artist, when the plain search listed others. */
    searchTrack: (
      artist: string,
      title: string,
      limit = 5,
      who: Omit<ScheduleOptions, 'key'> = {},
    ) =>
      list<DeezerTrack>(
        'search',
        `${field('artist', artist)} ${field('track', title)}`,
        limit,
        who,
      ),
    searchAlbums: (q: string, limit = 4, who: Omit<ScheduleOptions, 'key'> = {}) =>
      list<DeezerAlbum>('search/album', q, limit, who),
    searchArtists: (q: string, limit = 3, who: Omit<ScheduleOptions, 'key'> = {}) =>
      list<DeezerArtist>('search/artist', q, limit, who),
  };
}
export type DeezerClient = ReturnType<typeof deezerClient>;
