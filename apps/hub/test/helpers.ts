import type { Profile } from '@renaissance/core';

import { createStores } from '../src/db/index.js';
import type { Stores } from '../src/db/index.js';

export const sahil: Profile = {
  id: 'u-sahil',
  name: 'Sahil',
  role: 'admin',
  mode: 'advanced',
  language: 'en',
};
export const mom: Profile = {
  id: 'u-mom',
  name: 'Mom',
  role: 'member',
  mode: 'simple',
  language: 'gu',
};

export function memoryStores(): Stores {
  const stores = createStores(':memory:');
  stores.profiles.seen(sahil.id, sahil.name, sahil.role);
  stores.profiles.seen(mom.id, mom.name, mom.role);
  stores.profiles.setPreferences(sahil.id, 'advanced', 'en');
  stores.profiles.setPreferences(mom.id, 'simple', 'gu');
  return stores;
}

/** A fetch that answers from a table of URL fragments; records every call. */
export function fakeFetch(
  routes: Record<
    string,
    (url: URL, init: RequestInit) => unknown | { __status: number; body?: unknown }
  >,
) {
  const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] =
    [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    );
    const headers = Object.fromEntries(
      Object.entries((init.headers as Record<string, string>) ?? {}).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: url.toString(), method: init.method ?? 'GET', body, headers });
    const key = Object.keys(routes).find(
      (k) => `${url.pathname}${url.search}`.includes(k) || url.toString().includes(k),
    );
    if (!key) return new Response(JSON.stringify({ error: 'no fake route' }), { status: 404 });
    const out = routes[key]!(url, init);
    const result = out instanceof Promise ? await out : out;
    if (result && typeof result === 'object' && '__status' in result) {
      const r = result as { __status: number; body?: unknown };
      const empty = r.body === undefined || [204, 205, 304].includes(r.__status);
      return new Response(empty ? null : JSON.stringify(r.body), { status: r.__status });
    }
    return new Response(result === undefined ? '' : JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

export const instantSleep = (): Promise<void> => Promise.resolve();
