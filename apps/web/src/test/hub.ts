/** A hub for component tests: catalogue answers by query, requests in memory, events on demand. */
import { HubClientError } from '@renaissance/core';
import type {
  CatalogueSearch,
  CatalogueSong,
  HubClient,
  HubEvent,
  MusicRequest,
  NewRequest,
} from '@renaissance/core';
import { vi } from 'vitest';

import type { TFunction } from 'i18next';

import { setHubForTests } from '../lib/hub';
import { i18n } from '../lib/i18n';

export const fireman: CatalogueSong = {
  id: 'mb:recording:3f3d2a1e-5c5e-4a1a-9b1e-7f0c4a6d2b10',
  recordingId: '3f3d2a1e-5c5e-4a1a-9b1e-7f0c4a6d2b10',
  title: 'Fireman',
  artist: 'Lil Wayne',
  album: 'Tha Carter II',
  duration: 263,
  art: 'https://art.test/fireman.jpg',
  preview: 'https://cdn.test/fireman.mp3',
};

export function request(over: Partial<MusicRequest> = {}): MusicRequest {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'track',
    title: 'Fireman',
    artist: 'Lil Wayne',
    album: 'Tha Carter II',
    recordingId: fireman.recordingId!,
    requestedBy: 'u1',
    requestedByName: 'Sahil',
    status: 'requested',
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
    steps: [{ at: '2026-11-26T00:00:00.000Z', status: 'requested' }],
    ...over,
  };
}

export function answer(query: string, over: Partial<CatalogueSearch> = {}): CatalogueSearch {
  return { query, songs: [], albums: [], artists: [], cached: false, exact: true, ...over };
}

type CreateResult = Awaited<ReturnType<HubClient['createRequest']>>;

export function fakeHub(
  options: {
    search?: (q: string, full: boolean) => CatalogueSearch | Error;
    create?: (input: NewRequest) => CreateResult | Error;
    cancel?: (id: string) => MusicRequest | Error;
    list?: MusicRequest[] | Error;
  } = {},
) {
  let emit: ((event: HubEvent) => void) | null = null;
  const created: NewRequest[] = [];
  const searched: { q: string; full: boolean }[] = [];
  const client = {
    url: 'http://hub.test',
    catalogueSearch: vi.fn(async (q: string, _signal?: AbortSignal, o?: { full?: boolean }) => {
      searched.push({ q, full: !!o?.full });
      const out = options.search?.(q, !!o?.full) ?? answer(q);
      if (out instanceof Error) throw out;
      return out;
    }),
    createRequest: vi.fn(async (input: NewRequest) => {
      created.push(input);
      const out = options.create?.(input) ?? request({ title: input.title, artist: input.artist });
      if (out instanceof Error) throw out;
      return out;
    }),
    cancelRequest: vi.fn(async (id: string) => {
      const out = options.cancel?.(id) ?? request({ id, status: 'cancelled' });
      if (out instanceof Error) throw out;
      return out;
    }),
    retryRequest: vi.fn(),
    request: vi.fn(),
    requests: vi.fn(async () => {
      if (options.list instanceof Error) throw options.list;
      return options.list ?? [];
    }),
    events: vi.fn((onEvent: (event: HubEvent) => void) => {
      emit = onEvent;
      return () => {
        emit = null;
      };
    }),
  } as unknown as HubClient;
  return {
    client,
    created,
    searched,
    emit: (event: HubEvent) => emit?.(event),
    connected: () => emit !== null,
  };
}

/** Puts a fake hub in the store for the component under test. */
export function useFakeHub(options: Parameters<typeof fakeHub>[0] = {}) {
  const hub = fakeHub(options);
  setHubForTests(hub.client, 'u1', i18n.t.bind(i18n) as TFunction);
  return hub;
}

export const busy = () => new HubClientError(503, 'busy');
