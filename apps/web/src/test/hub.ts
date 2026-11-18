import type {
  AskResponse,
  CollectionItem,
  HubClient,
  MusicRequest,
  Profile,
} from '@renaissance/core';
import { vi } from 'vitest';

export const admin: Profile = {
  id: 'u-sahil',
  name: 'Sahil',
  role: 'admin',
  mode: 'simple',
  language: 'en',
};
export const member: Profile = {
  id: 'u-mom',
  name: 'Mom',
  role: 'member',
  mode: 'simple',
  language: 'gu',
};

export function request(over: Partial<MusicRequest> = {}): MusicRequest {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'track',
    title: 'Fireman',
    artist: 'Lil Wayne',
    album: 'Tha Carter II',
    requestedBy: 'u-sahil',
    requestedByName: 'Sahil',
    status: 'requested',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    steps: [{ at: '2026-11-18T00:00:00.000Z', status: 'requested' }],
    ...over,
  };
}

export function collectionItem(over: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: 1,
    profile: 'u-sahil',
    item: 'mb:recording:x',
    kind: 'track',
    title: 'Fireman',
    artist: 'Lil Wayne',
    album: 'Tha Carter II',
    addedBy: 'u-sahil',
    addedAt: '2026-11-18T00:00:00.000Z',
    source: 'request',
    ...over,
  };
}

export const emptyAnswer: AskResponse = {
  model: 'off',
  language: 'en',
  instant: { tracks: [], albums: [], artists: [] },
  actions: [],
  why: '',
  reason: 'no_key',
  rejected: [],
  tools: [
    'search_library',
    'lookup_catalogue',
    'play',
    'queue',
    'make_playlist',
    'request',
    'set_rule',
    'explain',
  ],
};

/** A hub client whose every method is a mock; override what a test needs. */
export function fakeHub(over: Partial<HubClient> = {}, profile: Profile = admin): HubClient {
  return {
    url: 'http://hub.test',
    me: vi.fn(async () => profile),
    catalogueSearch: vi.fn(async (q: string) => ({
      query: q,
      songs: [],
      artists: [],
      albums: [],
      cached: false,
    })),
    requests: vi.fn(async () => [] as MusicRequest[]),
    request: vi.fn(async () => request()),
    createRequest: vi.fn(async () => request()),
    cancelRequest: vi.fn(async (id: string) =>
      request({ id, status: 'failed', reason: 'cancelled' }),
    ),
    retryRequest: vi.fn(async (id: string) => request({ id, status: 'requested' })),
    collection: vi.fn(async () => [] as CollectionItem[]),
    removeFromCollection: vi.fn(async () => collectionItem()),
    rules: vi.fn(async () => []),
    addRule: vi.fn(async () => ({
      id: 1,
      profile: 'u-sahil',
      text: 'x',
      createdAt: '2026-11-18T00:00:00.000Z',
    })),
    deleteRule: vi.fn(async () => ({
      id: 1,
      profile: 'u-sahil',
      text: 'x',
      createdAt: '2026-11-18T00:00:00.000Z',
    })),
    budget: vi.fn(async () => ({
      model: 'claude-opus-5-5',
      month: '2026-11',
      capUsd: 10,
      spentUsd: 0,
      remainingUsd: 10,
      off: false,
      days: [],
    })),
    ask: vi.fn(async () => emptyAnswer),
    askStreaming: vi.fn(async (_input, onInstant) => {
      onInstant(emptyAnswer.instant);
      return emptyAnswer;
    }),
    undo: vi.fn(async () => true),
    events: vi.fn(() => () => undefined),
    ...over,
  } as HubClient;
}
