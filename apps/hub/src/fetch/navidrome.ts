/** Navidrome through the Subsonic API: `startScan` after an import. Optional. */
import { createHash, randomBytes } from 'node:crypto';

import { httpJson } from '../http.js';
import type { Fetch } from '../http.js';

export function navidromeClient(options: {
  url: string;
  user: string;
  password: string;
  fetch?: Fetch;
  dryRun?: boolean;
}) {
  const doFetch = options.fetch ?? fetch;
  const call = async <T>(method: string, params: Record<string, string> = {}): Promise<T> => {
    const salt = randomBytes(6).toString('hex');
    const token = createHash('md5')
      .update(options.password + salt)
      .digest('hex');
    const url = new URL(`${options.url}/rest/${method}`);
    url.searchParams.set('u', options.user);
    url.searchParams.set('t', token);
    url.searchParams.set('s', salt);
    url.searchParams.set('v', '1.16.1');
    url.searchParams.set('c', 'renaissance-hub');
    url.searchParams.set('f', 'json');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await httpJson<{
      'subsonic-response': T & { status: string; error?: { message: string } };
    }>('navidrome', url.toString(), {}, doFetch);
    const body = res.body['subsonic-response'];
    if (body.status !== 'ok') throw new Error(`Navidrome: ${body.error?.message ?? 'failed'}`);
    return body;
  };
  return {
    async startScan(): Promise<void> {
      if (options.dryRun) return;
      await call('startScan');
    },
    async search(query: string): Promise<{ title: string; artist?: string; album?: string }[]> {
      const body = await call<{
        searchResult3?: { song?: { title: string; artist?: string; album?: string }[] };
      }>('search3', { query, songCount: '10', albumCount: '0', artistCount: '0' });
      return body.searchResult3?.song ?? [];
    },
  };
}
export type NavidromeClient = ReturnType<typeof navidromeClient>;
