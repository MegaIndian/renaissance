/** Deezer's public search: cover art and 30-second previews. No key, no account. */
import { httpJson } from '../http.js';
import type { Fetch } from '../http.js';

export const DEEZER_URL = 'https://api.deezer.com';

export interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  preview?: string;
  artist: { id: number; name: string; picture_medium?: string };
  album: { id: number; title: string; cover_medium?: string; cover_big?: string };
}

export function deezerClient(options: { fetch?: Fetch; baseUrl?: string } = {}) {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl ?? DEEZER_URL;
  return {
    async search(q: string, limit = 15): Promise<DeezerTrack[]> {
      try {
        const url = new URL(`${base}/search`);
        url.searchParams.set('q', q);
        url.searchParams.set('limit', String(limit));
        const res = await httpJson<{ data?: DeezerTrack[] }>(
          'deezer',
          url.toString(),
          { timeoutMs: 6_000 },
          doFetch,
        );
        return res.body?.data ?? [];
      } catch {
        // Art and previews are decoration: a Deezer outage must not break search.
        return [];
      }
    },
  };
}
export type DeezerClient = ReturnType<typeof deezerClient>;
