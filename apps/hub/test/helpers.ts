import type { CollectionItem, Profile } from '@renaissance/core';

import { buildApp as realBuildApp } from '../src/app.js';
import type { BuildOptions } from '../src/app.js';
import type { CollectionSink, NewCollectionItem, RuleSource } from '../src/contracts.js';
import { createStores } from '../src/db/index.js';
import type { Stores } from '../src/db/index.js';
import { createPipeline as realCreatePipeline } from '../src/fetch/pipeline.js';
import type { PipelineDeps } from '../src/fetch/pipeline.js';
import { createRequestService as realCreateRequestService } from '../src/requests/service.js';

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

/**
 * A collection that remembers, standing in for F86's store so the tests can see what F61 files
 * through the `CollectionSink` seam (an item already here, a request turned Ready).
 */
export function memoryCollection(): CollectionSink & {
  list(profile: string): CollectionItem[];
  remove(id: number, profile: string): CollectionItem | undefined;
} {
  const items: CollectionItem[] = [];
  let next = 1;
  return {
    add(input: NewCollectionItem) {
      const found = items.find((i) => i.profile === input.profile && i.item === input.item);
      if (found) return found;
      const item: CollectionItem = {
        id: next++,
        profile: input.profile,
        item: input.item,
        kind: input.kind,
        title: input.title,
        artist: input.artist,
        ...(input.album ? { album: input.album } : {}),
        addedBy: input.addedBy,
        addedAt: new Date().toISOString(),
        source: input.source,
      };
      items.push(item);
      return item;
    },
    list: (profile) => items.filter((i) => i.profile === profile).reverse(),
    remove(id, profile) {
      const index = items.findIndex((i) => i.id === id && i.profile === profile);
      return index === -1 ? undefined : items.splice(index, 1)[0];
    },
  };
}

/** Household rules in memory, standing in for F80's store behind the `RuleSource` seam. */
export function memoryRules(): RuleSource & { add(profile: string, text: string): void } {
  const rules: { profile: string; text: string }[] = [];
  return {
    add: (profile, text) => void rules.push({ profile, text }),
    list: (profile) => rules.filter((r) => r.profile === profile).map((r) => r.text),
  };
}

export type TestStores = Stores & {
  collection: ReturnType<typeof memoryCollection>;
  rules: ReturnType<typeof memoryRules>;
};

/** The pipeline with the test stores' collection and rules behind its seams. */
export function createPipeline(deps: PipelineDeps): ReturnType<typeof realCreatePipeline> {
  const stores = deps.stores as Partial<TestStores>;
  return realCreatePipeline({
    ...(stores.collection ? { collection: stores.collection } : {}),
    ...(stores.rules ? { rules: stores.rules } : {}),
    ...deps,
  });
}

export function createRequestService(
  deps: Parameters<typeof realCreateRequestService>[0],
): ReturnType<typeof realCreateRequestService> {
  const stores = deps.stores as Partial<TestStores>;
  return realCreateRequestService({
    ...(stores.collection ? { collection: stores.collection } : {}),
    ...deps,
  });
}

export function buildApp(options: BuildOptions): ReturnType<typeof realBuildApp> {
  const stores = options.stores as Partial<TestStores> | undefined;
  return realBuildApp({
    ...(stores?.collection ? { collection: stores.collection } : {}),
    ...(stores?.rules ? { rules: stores.rules } : {}),
    ...options,
  });
}

export function memoryStores(): TestStores {
  const stores = Object.assign(createStores(':memory:'), {
    collection: memoryCollection(),
    rules: memoryRules(),
  });
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
