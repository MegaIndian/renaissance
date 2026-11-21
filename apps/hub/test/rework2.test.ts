/**
 * Round 2 rework: the production, design and functionality judges' letters, each with the case
 * that confirmed the gap. Catalogue relevance (design P, Q, X; functionality B), the live-version
 * choice and the caller's duration (functionality A), the pipeline's lane and the Deezer answer
 * (functionality C, F; production T), the late album cancel (production Q), the deadline after a
 * retry (production S), the conditional cancel and its codes (production U; functionality I),
 * the matched song (production V), watchers (production W; functionality D), soularr's failed
 * imports (functionality E), database errors (functionality G), the folder's version words
 * (functionality A) and the preflight for DELETE (design O).
 */
import Fastify from 'fastify';
import type { HubEvent } from '@renaissance/core';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createBudget } from '../src/ask/budget.js';
import { createEngine } from '../src/ask/engine.js';
import { requireProfile } from '../src/auth/plugin.js';
import { staticAuthenticator } from '../src/auth/authenticator.js';
import type { Authenticator } from '../src/auth/authenticator.js';
import { deezerClient } from '../src/catalogue/deezer.js';
import { musicBrainzClient } from '../src/catalogue/musicbrainz.js';
import type { MbRecording } from '../src/catalogue/musicbrainz.js';
import { LimiterBusyError, createRateLimiter } from '../src/catalogue/rate-limiter.js';
import { relevantRows, wordMatches } from '../src/catalogue/relevance.js';
import {
  FAST_TTL_MS,
  SEARCH_TTL_MS,
  catalogueService,
  fromDeezer,
  recordingScore,
} from '../src/catalogue/service.js';
import { loadConfig } from '../src/config.js';
import { createEventBus } from '../src/events/bus.js';
import { createPipeline, fileTitle } from '../src/fetch/pipeline.js';
import type { PipelineDeps } from '../src/fetch/pipeline.js';
import { score } from '../src/fetch/rank.js';
import { emptyPolicy, parseRules } from '../src/fetch/rules.js';
import { createRunner } from '../src/fetch/runner.js';
import { createHealthState } from '../src/health.js';
import { HttpError } from '../src/http.js';
import type { JellyfinLibrary } from '../src/jellyfin/library.js';
import { recordingLogger } from '../src/log.js';
import { createRequestService } from '../src/requests/service.js';
import { contentTokens, looksLikeSentence } from '../src/text.js';
import {
  carterAlbum,
  fakeCatalogue,
  fakeLibrary,
  fakeLidarr,
  fakeNavidrome,
  fakeSlskd,
  firemanSong,
  ids,
  response,
} from './fakes.js';
import { fakeFetch, instantSleep, memoryStores, mom, sahil } from './helpers.js';

const wayne = {
  name: 'Lil Wayne',
  artist: { id: 'ac9a487a-d9d2-4f27-bb23-0f4686488345', name: 'Lil Wayne' },
};
const credit = (name: string, id: string) => [{ name, artist: { id, name } }];
const studio = (
  id: string,
  title: string,
  artistCredit = [wayne],
  extra: Partial<MbRecording> = {},
): MbRecording => ({
  id,
  title,
  length: 263_000,
  'artist-credit': artistCredit,
  releases: [
    {
      id: `rel-${id}`,
      title: 'Tha Carter II',
      status: 'Official',
      date: '2005-12-06',
      'release-group': { id: `rg-${id}`, title: 'Tha Carter II', 'primary-type': 'Album' },
    },
  ],
  ...extra,
});

/** What MusicBrainz lists for "Fireman Lil Wayne": the real song ninth (design P's capture). */
const firemanListing: MbRecording[] = [
  studio(
    'a1',
    'Lil Wayne Fireman',
    credit('DJ Symphony', 'dj-symphony-0000-4000-8000-000000000001'),
  ),
  studio(
    'a2',
    "Lil' Wayne - Fireman (Streets)",
    credit('Alex Kresovich', 'alex-kresovich-0000-4000-8000-000000000002'),
  ),
  studio(
    'a3',
    'when a fireman starts to burn',
    credit('Someone', 'someone-0000-0000-4000-8000-000000000003'),
  ),
  studio('a4', 'Lil Wayne', credit('Mixtape Guy', 'mixtape-guy-0000-4000-8000-000000000004')),
  studio('a5', 'Lil Wayne', credit('Other Guy', 'other-guy-0000-0000-4000-8000-000000000005')),
  studio('a6', 'Fireman', wayne ? [wayne] : [], {}),
];
firemanListing[5]!.id = '3f3d2a1e-5c5e-4a1a-9b1e-7f0c4a6d2b10';

function catalogueOver(routes: Parameters<typeof fakeFetch>[0]) {
  const stores = memoryStores();
  const { fetch, calls } = fakeFetch(routes);
  const limiter = createRateLimiter(0);
  const svc = catalogueService({
    musicBrainz: musicBrainzClient({ version: '1', contact: undefined, fetch, limiter }),
    deezer: deezerClient({ fetch, limiter: createRateLimiter(0) }),
    cache: stores.cache,
  });
  return { svc, calls, stores };
}

describe('relevance: the rows answer the words typed (design P, Q, X; functionality B)', () => {
  it('ranks the exact title and artist first, however MusicBrainz ordered them, in the full search and the typeahead after it', async () => {
    const { svc } = catalogueOver({
      '/recording?': () => ({ recordings: firemanListing }),
      '/release-group?': () => ({ 'release-groups': [] }),
      'api.deezer.com/search': () => ({ data: [] }),
    });
    const full = await svc.search('Fireman Lil Wayne');
    expect(full.songs[0]).toMatchObject({ title: 'Fireman', artist: 'Lil Wayne' });
    // The DJ Symphony row shares every word but is not the song: once the song by the artist is
    // in the list, a row by someone else whose title names the artist goes (design AI).
    expect(full.songs.map((s) => s.artist)).not.toContain('Someone');
    expect(full.songs.map((s) => s.artist)).not.toContain('DJ Symphony');
    // Mixtapes titled "Lil Wayne" cover a third of the query only.
    expect(full.songs.map((s) => s.title)).not.toContain('Lil Wayne');
    // The typeahead reads the same cached answer: nothing poisoned.
    const fast = await svc.search('fireman lil wayne', { fast: true });
    expect(fast.cached).toBe(true);
    expect(fast.songs[0]).toMatchObject({ title: 'Fireman', artist: 'Lil Wayne' });
  });

  it('shows no rows for a sentence unless a row is the title itself, in English and Gujarati', async () => {
    const { svc } = catalogueOver({
      '/recording?': (url) => {
        const q = url.searchParams.get('query') ?? '';
        if (q.includes('cooking')) {
          return {
            recordings: [
              studio(
                'c1',
                "Something's Cooking",
                credit('Cook Band', 'cook-band-0000-0000-4000-8000-000000000011'),
              ),
              studio('c2', 'Calm', credit('Spa Days', 'spa-days-0000-0000-4000-8000-000000000012')),
            ],
          };
        }
        if (q.includes('રસોઈ')) {
          return {
            recordings: [
              studio(
                'g1',
                'મૃત બાળકની વિસ્ફોટ',
                credit('PANTSU SCUM', 'pantsu-scum-0000-0000-4000-8000-000000000013'),
              ),
              studio(
                'g2',
                'શાંત રાત',
                credit('Manna Dey', 'manna-dey-0000-0000-4000-8000-000000000014'),
              ),
            ],
          };
        }
        if (q.includes('Kabhi')) {
          return {
            recordings: [
              studio(
                'k1',
                'Kabhi Kabhie Mere Dil Mein',
                credit('Mukesh', 'mukesh-0000-0000-4000-8000-000000000015'),
              ),
              studio('k2', 'Dil Mein', credit('Other', 'other-0000-0000-4000-8000-000000000016')),
            ],
          };
        }
        return {
          recordings: [
            studio('z1', 'Blorp!', credit('Nobody', 'nobody-0000-0000-4000-8000-000000000017')),
          ],
        };
      },
      '/release-group?': () => ({ 'release-groups': [] }),
      'api.deezer.com/search': () => ({ data: [] }),
    });
    expect(looksLikeSentence('play something calm for cooking')).toBe(true);
    expect(looksLikeSentence('રસોઈ માટે શાંત ગીત વગાડ')).toBe(true);
    expect(looksLikeSentence('Kabhi Kabhie Mere Dil Mein')).toBe(false);
    expect(looksLikeSentence('fireman lil wayne')).toBe(false);
    expect(contentTokens('play something calm for cooking')).toEqual(['calm', 'cooking']);
    const en = await svc.search('play something calm for cooking');
    expect(en.songs).toEqual([]);
    const gu = await svc.search('રસોઈ માટે શાંત ગીત વગાડ');
    expect(gu.songs).toEqual([]);
    expect(gu.artists).toEqual([]);
    // A long title is not a sentence: the exact row stays, the partial one goes.
    const title = await svc.search('Kabhi Kabhie Mere Dil Mein');
    expect(title.songs.map((s) => s.title)).toEqual(['Kabhi Kabhie Mere Dil Mein']);
    // Nonsense: MusicBrainz always answers something; the threshold keeps it off the screen.
    const nonsense = await svc.search('zzqqxxv blorp');
    expect(nonsense.songs).toEqual([]);
  });

  it('matches a prefix while typing and one typo, and keeps the album and artist of a surviving song', () => {
    expect(wordMatches('firem', 'fireman')).toBe(true);
    expect(wordMatches('firman', 'fireman')).toBe(true);
    expect(wordMatches('fire', 'water')).toBe(false);
    expect(wordMatches('ab', 'ba')).toBe(false);
    const rows = {
      songs: [
        { id: 's1', title: 'Fireman', artist: 'Lil Wayne', album: 'Tha Carter II' },
        { id: 's2', title: 'Water', artist: 'Tyla', album: 'Tyla' },
      ],
      albums: [
        { id: 'a1', title: 'Tha Carter II', artist: 'Lil Wayne' },
        { id: 'a2', title: 'Tyla', artist: 'Tyla' },
      ],
      artists: [
        { id: 'r1', name: 'Lil Wayne' },
        { id: 'r2', name: 'Tyla' },
      ],
    };
    const out = relevantRows('firem', rows);
    expect(out.songs.map((s) => s.id)).toEqual(['s1']);
    expect(out.albums.map((a) => a.id)).toEqual(['a1']);
    expect(out.artists.map((a) => a.id)).toEqual(['r1']);
    expect(relevantRows('firman', rows).songs.map((s) => s.id)).toEqual(['s1']);
    expect(relevantRows('', rows)).toBe(rows);
  });
});

describe('the recording choice (functionality A) and the Deezer answer (production T; functionality F, J)', () => {
  it("never picks a live take or a remix for a plain title, and the caller's duration picks the version", () => {
    const studioTake = studio(
      's',
      'Hotel California',
      credit('Eagles', 'eagles-0000-0000-4000-8000-000000000021'),
      {
        length: 391_000,
      },
    );
    const liveTake: MbRecording = {
      ...studio(
        'l',
        'Hotel California',
        credit('Eagles', 'eagles-0000-0000-4000-8000-000000000021'),
        {
          length: 417_000,
          disambiguation: 'live, 1999',
        },
      ),
      releases: Array.from({ length: 6 }, (_, i) => ({
        id: `live-${i}`,
        title: 'Legacy',
        status: 'Official',
        date: '2018-11-02',
        'release-group': {
          id: `rg-live-${i}`,
          title: 'Legacy',
          'primary-type': 'Album',
          'secondary-types': ['Live', 'Compilation'],
        },
      })),
    };
    expect(recordingScore(studioTake, { title: 'Hotel California' })).toBeGreaterThan(
      recordingScore(liveTake, { title: 'Hotel California' }),
    );
    // Asked for the live one by name: the note is no longer a penalty.
    expect(recordingScore(liveTake, { title: 'Hotel California (live)' })).toBeGreaterThan(
      recordingScore(liveTake, { title: 'Hotel California' }),
    );
    // A duration from the caller's row picks between two studio versions (an edit and the album
    // take), but never lifts a live take over the studio one.
    const edit = studio(
      'e',
      'Hotel California',
      credit('Eagles', 'eagles-0000-0000-4000-8000-000000000021'),
      {
        length: 240_000,
      },
    );
    expect(
      recordingScore(studioTake, { title: 'Hotel California', duration: 391 }),
    ).toBeGreaterThan(recordingScore(edit, { title: 'Hotel California', duration: 391 }));
    expect(recordingScore(edit, { title: 'Hotel California', duration: 240 })).toBeGreaterThan(
      recordingScore(studioTake, { title: 'Hotel California', duration: 240 }),
    );
    expect(
      recordingScore(studioTake, { title: 'Hotel California', duration: 417 }),
    ).toBeGreaterThan(recordingScore(liveTake, { title: 'Hotel California', duration: 417 }));
  });

  it('findSong reads forty recordings on the pipeline lane and the live take loses', async () => {
    const liveFirst: MbRecording[] = [
      studio('l', 'Hotel California', credit('Eagles', 'eagles-0000-0000-4000-8000-000000000021'), {
        length: 417_000,
        disambiguation: 'live, 1999',
      }),
      studio('s', 'Hotel California', credit('Eagles', 'eagles-0000-0000-4000-8000-000000000021'), {
        length: 391_000,
      }),
    ];
    const { svc, calls } = catalogueOver({
      '/recording?': () => ({ recordings: liveFirst }),
      'api.deezer.com/search': () => ({ data: [] }),
    });
    const song = await svc.findSong('Hotel California', 'Eagles');
    expect(song?.recordingId).toBe('s');
    expect(calls[0]!.url).toContain('limit=40');
  });

  it('never caches a Deezer failure or quota error as "nothing found", and keeps a Deezer-less full answer briefly', async () => {
    let deezerUp = false;
    const { svc, stores } = catalogueOver({
      'api.deezer.com/search/album': () => (deezerUp ? { data: [] } : { error: { code: 4 } }),
      'api.deezer.com/search/artist': () => (deezerUp ? { data: [] } : { error: { code: 4 } }),
      'api.deezer.com/search': () =>
        deezerUp
          ? {
              data: [
                {
                  id: 1,
                  title: 'Fireman',
                  duration: 263,
                  artist: { id: 2, name: 'Lil Wayne' },
                  album: { id: 3, title: 'Tha Carter II' },
                },
              ],
            }
          : { error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } },
      '/recording?': () => ({ recordings: [firemanListing[5]!] }),
      '/release-group?': () => ({ 'release-groups': [] }),
    });
    const quota = await svc.search('fireman', { fast: true });
    expect(quota.songs).toEqual([]);
    expect(quota.cached).toBe(false);
    deezerUp = true;
    const again = await svc.search('fireman', { fast: true });
    expect(again.cached).toBe(false);
    expect(again.songs[0]?.title).toBe('Fireman');
    // The full search without Deezer is kept for the fast TTL, not a day.
    deezerUp = false;
    const now = Date.now();
    await svc.search('fireman lil wayne');
    const row = stores.db
      .prepare('SELECT expires_at FROM cache WHERE key = ?')
      .get('catalogue:search:fireman lil wayne') as { expires_at: number };
    expect(row.expires_at - now).toBeLessThanOrEqual(FAST_TTL_MS + 1000);
    expect(row.expires_at - now).toBeLessThan(SEARCH_TTL_MS);
  });

  it('the typeahead lists the albums and artists Deezer names, the album search first', () => {
    const out = fromDeezer(
      [
        {
          id: 1,
          title: 'Fireman',
          duration: 263,
          artist: { id: 2, name: 'Lil Wayne' },
          album: { id: 3, title: 'Tha Carter II' },
        },
      ],
      [
        {
          id: 9,
          title: 'Tha Carter II',
          artist: { id: 2, name: 'Lil Wayne' },
          cover_medium: 'https://cdn.deezer.test/c2.jpg',
          release_date: '2005-12-06',
        },
      ],
      [{ id: 2, name: 'Lil Wayne', picture_medium: 'https://cdn.deezer.test/w.jpg' }],
    );
    expect(out.albums[0]).toMatchObject({ id: 'dz:album:9', title: 'Tha Carter II', year: 2005 });
    // The track's own edition of the same album is the same row, not a second one.
    expect(out.albums).toHaveLength(1);
    expect(out.artists).toEqual([
      { id: 'dz:artist:2', name: 'Lil Wayne', art: 'https://cdn.deezer.test/w.jpg' },
    ]);
  });
});

describe('the engine with the model off (design Q; functionality B, C) and a duplicate (production W)', () => {
  function engineOver(routes: Parameters<typeof fakeFetch>[0], busy = false) {
    const stores = memoryStores();
    const bus = createEventBus();
    const { fetch, calls } = fakeFetch(routes);
    const limiter = createRateLimiter(0, { maxQueue: busy ? 0 : 16 });
    const catalogue = catalogueService({
      musicBrainz: musicBrainzClient({ version: '1', contact: undefined, fetch, limiter }),
      deezer: deezerClient({ fetch, limiter: createRateLimiter(0) }),
      cache: stores.cache,
    });
    const library = {
      configured: true,
      find: async () => undefined,
      search: async () => ({ tracks: [], albums: [], artists: [] }),
      refresh: async () => true,
    } as unknown as JellyfinLibrary;
    const requests = createRequestService({ stores, library, bus, enqueue: () => {} });
    const engine = createEngine({
      client: undefined,
      model: 'claude-opus-5-5',
      budget: createBudget({ usage: stores.usage, capUsd: 10, model: 'claude-opus-5-5' }),
      stores,
      library,
      catalogue,
      requests,
      log: recordingLogger(),
    });
    return { engine, calls, stores, requests, bus };
  }

  it('offers no catalogue rows for a sentence in either language, and strips the command from the catalogue query', async () => {
    const t = engineOver({
      '/recording?': () => ({
        recordings: [
          studio(
            'c1',
            "Something's Cooking",
            credit('Cook Band', 'cook-band-0000-0000-4000-8000-000000000011'),
          ),
        ],
      }),
      '/release-group?': () => ({ 'release-groups': [] }),
      'api.deezer.com/search': () => ({ data: [] }),
    });
    const en = await t.engine.ask({
      profile: sahil,
      token: 't',
      text: 'play something calm for cooking',
    });
    expect(en.model).toBe('off');
    expect(en.catalogue?.songs).toEqual([]);
    expect(en.catalogue?.albums).toEqual([]);
    // The one line for a sentence with the model off; a name that matched nothing says nothing.
    expect(en.why).toBe('Smart answers are off right now. Type a song or artist name');
    expect((await t.engine.ask({ profile: sahil, token: 't', text: 'zzqqxxv blorp' })).why).toBe(
      '',
    );
    const asked = new URL(t.calls.find((c) => c.url.includes('/recording?'))!.url).searchParams.get(
      'query',
    );
    expect(asked).toBe('something calm for cooking');
    const gu = await t.engine.ask({ profile: mom, token: 't', text: 'રસોઈ માટે શાંત ગીત વગાડ' });
    expect(gu.language).toBe('gu');
    expect(gu.catalogue?.songs).toEqual([]);
    expect(gu.why).toBe('સ્માર્ટ જવાબ અત્યારે બંધ છે. ગીત કે કલાકારનું નામ લખો');
  });

  it('falls back to the Deezer rows when the MusicBrainz queue is full', async () => {
    const t = engineOver(
      {
        '/recording?': () => ({ recordings: [] }),
        '/release-group?': () => ({ 'release-groups': [] }),
        'api.deezer.com/search/album': () => ({ data: [] }),
        'api.deezer.com/search/artist': () => ({ data: [] }),
        'api.deezer.com/search': () => ({
          data: [
            {
              id: 1,
              title: 'Fireman',
              duration: 263,
              artist: { id: 2, name: 'Lil Wayne' },
              album: { id: 3, title: 'Tha Carter II' },
            },
          ],
        }),
      },
      true,
    );
    const out = await t.engine.ask({ profile: sahil, token: 't', text: 'fireman lil wayne' });
    expect(out.catalogue?.partial).toBe(true);
    expect(out.catalogue?.songs[0]).toMatchObject({ id: 'dz:track:1', title: 'Fireman' });
    expect(t.calls.some((c) => c.url.includes('musicbrainz'))).toBe(false);
    expect(new LimiterBusyError('busy').code).toBe('busy');
  });

  it('words a request already on its way as such, with no undo, and makes the asker a watcher', async () => {
    const stores = memoryStores();
    const bus = createEventBus();
    const lib = fakeLibrary();
    const requests = createRequestService({ stores, library: lib.library, bus, enqueue: () => {} });
    const first = await requests.create(mom, { kind: 'track', ...firemanSong });
    expect(first.kind).toBe('request');
    const reply = {
      id: 'm',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [
        {
          type: 'tool_use',
          id: 't',
          name: 'request',
          input: {
            kind: 'track',
            title: 'Fireman',
            artist: 'Lil Wayne',
            catalogueId: firemanSong.id,
          },
        },
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
    const engine = createEngine({
      client: { messages: { create: vi.fn(async () => reply as never) } },
      model: 'claude-opus-5-5',
      budget: createBudget({ usage: stores.usage, capUsd: 10, model: 'claude-opus-5-5' }),
      stores,
      library: lib.library,
      catalogue: fakeCatalogue(),
      requests,
      log: recordingLogger(),
    });
    const out = await engine.ask({
      profile: sahil,
      token: 't',
      text: 'get me fireman by lil wayne',
    });
    expect(out.actions[0]).toMatchObject({
      tool: 'request',
      undoable: false,
      summary: 'Fireman by Lil Wayne is already on its way, asked by Mom',
    });
    expect(out.actions[0]!.undo).toBeUndefined();
    const id = (first as { request: { id: string } }).request.id;
    expect(stores.requests.get(id)?.watchers).toEqual([sahil.id]);
    // The same asker asking twice hears it in the first person.
    const mine = await engine.ask({
      profile: mom,
      token: 't',
      text: 'fireman lil wayne',
      language: 'en',
    });
    expect(mine.actions[0]!.summary).toBe('Fireman by Lil Wayne is already on its way');
    expect(stores.requests.get(id)?.watchers).toEqual([sahil.id]);
  });
});

function pipelineSetup(
  overrides: Partial<PipelineDeps> & { lidarrOptions?: Parameters<typeof fakeLidarr>[0] } = {},
) {
  const stores = memoryStores();
  const bus = createEventBus();
  const events: Record<string, HubEvent[]> = { [sahil.id]: [], [mom.id]: [] };
  bus.subscribe(sahil.id, (e) => events[sahil.id]!.push(e));
  bus.subscribe(mom.id, (e) => events[mom.id]!.push(e));
  const slskd = fakeSlskd({ results: { 'lil wayne fireman': [response('cuchillo', [{}])] } });
  const lidarr = fakeLidarr(overrides.lidarrOptions ?? {});
  const lib = fakeLibrary();
  const log = recordingLogger();
  const deps: PipelineDeps = {
    stores,
    bus,
    catalogue: fakeCatalogue(),
    library: lib.library,
    slskd: slskd.client,
    lidarr: lidarr.client,
    navidrome: fakeNavidrome().client,
    lidarrDownloadsDir: '/files/downloads/music/complete',
    lidarrFailedImportsDir: '/files/downloads/music/failed_imports',
    log,
    sleep: instantSleep,
    downloadTimeoutMs: 1,
    tracksTimeoutMs: 1000,
    arrivalCheckMs: 0,
    ...overrides,
  };
  const pipeline = createPipeline(deps);
  const service = createRequestService({
    stores,
    library: lib.library,
    bus,
    enqueue: () => {},
    abandon: (r) => pipeline.abandon(r),
  });
  return { stores, bus, events, slskd, lidarr, lib, log, pipeline, service };
}

describe("albums: a late cancel, the deadline after a retry, soularr's failed imports (production Q, S; functionality E)", () => {
  it('unmonitors an album cancelled while Lidarr was adding it', async () => {
    const t = pipelineSetup();
    const req = t.stores.requests.create({ kind: 'album', ...carterAlbum }, mom.id);
    const original = t.lidarr.client.addAlbum.bind(t.lidarr.client);
    t.lidarr.client.addAlbum = async (album) => {
      const created = await original(album);
      // Mom taps Undo while Lidarr is still answering the add: nothing to unmonitor yet.
      expect(await t.service.cancel(mom, req.id)).toMatchObject({ status: 'cancelled' });
      return created;
    };
    expect(await t.pipeline.run(req.id)).toBeUndefined();
    expect(t.stores.requests.get(req.id)?.status).toBe('cancelled');
    expect(t.lidarr.albums[0]?.monitored).toBe(false);
    expect(t.lidarr.writes.some((w) => (w.body as { name?: string }).name === 'AlbumSearch')).toBe(
      false,
    );
    expect(t.log.lines.some((l) => l.includes('album unmonitored after a late cancel'))).toBe(true);
    await t.pipeline.pollAlbums();
    expect(t.stores.requests.get(req.id)?.status).toBe('cancelled');
  });

  it('measures the deadline from the retry, not the first request', async () => {
    let clock = Date.parse('2026-11-18T00:00:00Z');
    const t = pipelineSetup({ albumDeadlineMs: 2 * 24 * 60 * 60_000, now: () => clock });
    const req = t.stores.requests.create({ kind: 'album', ...carterAlbum }, mom.id);
    t.stores.db
      .prepare('UPDATE requests SET created_at = ?, steps = ? WHERE id = ?')
      .run(
        new Date(clock).toISOString(),
        JSON.stringify([{ at: new Date(clock).toISOString(), status: 'requested' }]),
        req.id,
      );
    expect((await t.pipeline.run(req.id))?.status).toBe('finding');
    t.lidarr.setAlbumStats({ trackCount: 22, trackFileCount: 3 });
    clock += 3 * 24 * 60 * 60_000;
    await t.pipeline.pollAlbums();
    expect(t.stores.requests.get(req.id)).toMatchObject({
      status: 'failed',
      reason: 'not_found_in_time',
    });
    // A week later Mom retries: the retry is the new start (its own column), so the next poll
    // keeps waiting.
    clock += 7 * 24 * 60 * 60_000;
    const retried = t.service.retry(mom, req.id);
    expect(retried).toMatchObject({ status: 'requested' });
    expect(retried).toHaveProperty('requestedAt');
    t.stores.db
      .prepare('UPDATE requests SET requested_at = ? WHERE id = ?')
      .run(new Date(clock).toISOString(), req.id);
    expect((await t.pipeline.run(req.id))?.status).toBe('finding');
    expect(t.lidarr.albums[0]?.monitored).toBe(true);
    clock += 60_000;
    await t.pipeline.pollAlbums();
    expect(t.stores.requests.get(req.id)).toMatchObject({
      status: 'finding',
      progress: { unit: 'songs', done: 3, total: 22 },
    });
  });

  it('files what soularr fetched when Lidarr refused it, then marks the album ready', async () => {
    const t = pipelineSetup();
    const req = t.stores.requests.create({ kind: 'album', ...carterAlbum }, mom.id);
    expect((await t.pipeline.run(req.id))?.status).toBe('finding');
    const album = t.lidarr.albums[0]!;
    t.lidarr.client.importCandidates = async (folder) =>
      folder.endsWith('failed_imports')
        ? [
            {
              path: `${folder}/Lil Wayne - Tha Carter II (2005)/03 Fireman.flac`,
              quality: { quality: { id: 6, name: 'FLAC' } },
              album: { id: album.id },
              tracks: [{ id: 3003 }],
              rejections: [{ reason: 'Has missing tracks' }],
            },
            {
              path: `${folder}/Lil Wayne - Tha Carter II (2005)/01 Tha Mobb.flac`,
              quality: { quality: { id: 6, name: 'FLAC' } },
              rejections: [{ reason: 'Has missing tracks' }],
            },
            {
              path: `${folder}/Someone Else - Other (2001)/01 Other.flac`,
              quality: { quality: { id: 6, name: 'FLAC' } },
            },
          ]
        : [];
    t.lidarr.setAlbumStats({ trackCount: 2, trackFileCount: 0 });
    await t.pipeline.pollAlbums();
    const imported = t.lidarr.writes.find(
      (w) => (w.body as { name?: string }).name === 'ManualImport',
    )!.body as {
      files: {
        path: string;
        trackIds: number[];
        albumReleaseId: number;
        disableReleaseSwitching: boolean;
      }[];
    };
    expect(imported.files.map((f) => f.trackIds)).toEqual([[3003], [3001]]);
    expect(imported.files.every((f) => f.disableReleaseSwitching && f.albumReleaseId > 0)).toBe(
      true,
    );
    expect(imported.files.map((f) => f.path)).not.toContain(
      expect.stringContaining('Someone Else'),
    );
    const row = t.stores.requests.get(req.id)!;
    expect(row.status).toBe('finding');
    expect(row.detail).toContain('Filed 2 file(s)');
    expect(fileTitle('0111 Look Back at It.flac', 'A Boogie Wit da Hoodie')).toBe(
      'look back at it',
    );
    expect(
      fileTitle('A Boogie Wit da Hoodie - Look Back at It.flac', 'A Boogie Wit da Hoodie'),
    ).toBe('look back at it');
    // Lidarr counted the files: the next poll finishes it.
    t.lidarr.setAlbumStats({ trackCount: 2, trackFileCount: 2 });
    await t.pipeline.pollAlbums();
    expect(t.stores.requests.get(req.id)?.status).toBe('ready');
  });

  it('keeps waiting when a folder of the right name holds files that match no track, and when Lidarr cannot list the folder', async () => {
    const t = pipelineSetup();
    const req = t.stores.requests.create({ kind: 'album', ...carterAlbum }, mom.id);
    expect((await t.pipeline.run(req.id))?.status).toBe('finding');
    t.lidarr.client.importCandidates = async (folder) => [
      {
        path: `${folder}/Lil Wayne - Tha Carter II (2005)/Bonus Freestyle.flac`,
        quality: { quality: { id: 6, name: 'FLAC' } },
        rejections: [{ reason: 'Has missing tracks' }],
      },
    ];
    await t.pipeline.pollAlbums();
    const row = t.stores.requests.get(req.id)!;
    // What did not map has not arrived: no failure, nothing unmonitored, the deadline decides.
    expect(row.status).toBe('finding');
    expect(t.lidarr.albums[0]?.monitored).toBe(true);
    expect(t.lidarr.writes.some((w) => (w.body as { name?: string }).name === 'ManualImport')).toBe(
      false,
    );
    expect(t.log.lines.some((l) => l.includes('parked files match no track'))).toBe(true);
    // A folder Lidarr cannot read is an empty folder, not a crash.
    const r2 = t.stores.requests.create({ kind: 'album', ...carterAlbum }, sahil.id);
    expect((await t.pipeline.run(r2.id))?.status).toBe('finding');
    t.lidarr.client.importCandidates = async () => {
      throw new Error('lidarr: folder not found');
    };
    await t.pipeline.pollAlbums();
    expect(t.stores.requests.get(r2.id)?.status).toBe('finding');
    expect(t.log.lines.some((l) => l.includes('could not list import candidates'))).toBe(true);
  });
});

describe('cancel codes and the conditional write (production U; functionality I)', () => {
  it('answers too late when a poll finished the album during the cancel, and not active for finished rows', async () => {
    const t = pipelineSetup();
    const req = t.stores.requests.create({ kind: 'album', ...carterAlbum }, mom.id);
    expect((await t.pipeline.run(req.id))?.status).toBe('finding');
    // Lidarr finishes the album while the cancel is telling Lidarr to stop looking.
    const service = createRequestService({
      stores: t.stores,
      library: t.lib.library,
      bus: t.bus,
      enqueue: () => {},
      abandon: async (r) => {
        t.lidarr.setAlbumStats({ trackCount: 22, trackFileCount: 22 });
        await t.pipeline.pollAlbums();
        return t.pipeline.abandon(r);
      },
    });
    expect(await service.cancel(mom, req.id)).toBe('not_active');
    expect(t.stores.requests.get(req.id)?.status).toBe('ready');
    expect(t.stores.collection.list(mom.id)).toHaveLength(1);
    // A cancelled request cancelled again is the same row; a failed one has nothing to stop.
    const r2 = t.stores.requests.create({ kind: 'track', ...firemanSong }, mom.id);
    expect(await service.cancel(mom, r2.id)).toMatchObject({ status: 'cancelled' });
    expect(await service.cancel(mom, r2.id)).toMatchObject({ status: 'cancelled', id: r2.id });
    const r3 = t.stores.requests.create({ kind: 'track', ...firemanSong }, mom.id);
    t.stores.requests.update(r3.id, { status: 'failed', reason: 'no_results' });
    expect(await service.cancel(mom, r3.id)).toBe('not_active');
    const r4 = t.stores.requests.create({ kind: 'track', ...firemanSong }, mom.id);
    t.stores.requests.update(r4.id, { status: 'downloading' });
    expect(await service.cancel(mom, r4.id)).toBe('too_late');
    expect(t.stores.requests.cancel('nope', 'x')).toBeUndefined();
  });

  it('the route answers 409 not_active and 200 for a second cancel', async () => {
    const stores = memoryStores();
    const app = await buildApp({
      config: loadConfig({
        RENAISSANCE_HUB_DB: ':memory:',
        JELLYFIN_URL: 'http://jf.test',
        JELLYFIN_API_KEY: 'k',
      }),
      stores,
      authenticator: staticAuthenticator({ 'tok-sahil': sahil }),
      library: fakeLibrary().library,
      catalogue: fakeCatalogue(),
      startRunner: false,
    });
    await app.ready();
    const headers = { authorization: 'Bearer tok-sahil' };
    const req = stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    stores.requests.update(req.id, { status: 'failed', reason: 'no_results' });
    const notActive = await app.inject({ method: 'DELETE', url: `/requests/${req.id}`, headers });
    expect(notActive.statusCode).toBe(409);
    expect(notActive.json().error).toBe('not_active');
    const r2 = stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    expect(
      (await app.inject({ method: 'DELETE', url: `/requests/${r2.id}`, headers })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'DELETE', url: `/requests/${r2.id}`, headers })).statusCode,
    ).toBe(200);
    await app.close();
  });
});

describe('the matched song and the watchers (production V, W; functionality A, D)', () => {
  it("records what the catalogue matched when it differs from the words, and keeps the caller's duration", async () => {
    const t = pipelineSetup();
    const typed = t.stores.requests.create(
      { kind: 'track', title: 'fire man', artist: 'lil wayne', duration: 180 },
      sahil.id,
    );
    const out = await t.pipeline.run(typed.id);
    expect(out?.status).toBe('ready');
    expect(out?.matched).toEqual({ title: 'Fireman', artist: 'Lil Wayne' });
    // The caller's duration stands (the recording's 183 did not replace it) and the search and
    // the mapping used the matched song, not the typed words.
    expect(out?.duration).toBe(180);
    expect(t.slskd.searches[0]).toBe('lil wayne fireman');
    expect(out?.steps.some((s) => s.detail?.includes('Mapped to track 3 "Fireman"'))).toBe(true);
    const same = t.stores.requests.create(
      { kind: 'track', title: 'FIREMAN', artist: 'Lil Wayne' },
      sahil.id,
    );
    const out2 = await t.pipeline.run(same.id);
    expect(out2?.matched).toBeUndefined();
    expect(out2?.duration).toBe(183);
  });

  it('a second asker watches the request: Ready and the item reach both', async () => {
    const t = pipelineSetup();
    const first = await t.service.create(mom, { kind: 'track', ...firemanSong });
    const id = (first as { request: { id: string } }).request.id;
    const again = await t.service.create(sahil, { kind: 'track', ...firemanSong });
    expect(again).toMatchObject({ kind: 'duplicate', request: { id, watchers: [sahil.id] } });
    expect(t.service.list(sahil, 'mine').map((r) => r.id)).toEqual([id]);
    expect(t.service.get(sahil, id)?.id).toBe(id);
    expect(await t.pipeline.run(id)).toMatchObject({ status: 'ready' });
    expect(t.stores.collection.list(mom.id)[0]).toMatchObject({
      item: `mb:recording:${ids.recording}`,
    });
    expect(t.stores.collection.list(sahil.id)[0]).toMatchObject({
      item: `mb:recording:${ids.recording}`,
      addedBy: sahil.id,
    });
    expect(t.events[mom.id]!.some((e) => e.type === 'ready')).toBe(true);
    expect(t.events[sahil.id]!.some((e) => e.type === 'ready')).toBe(true);
    // Watching twice, or the asker "duplicating" their own request, adds nothing.
    expect(t.stores.requests.watch(id, sahil.id)?.watchers).toEqual([sahil.id]);
    expect(t.stores.requests.watch(id, mom.id)?.watchers).toEqual([sahil.id]);
    expect(t.stores.requests.watch('nope', mom.id)).toBeUndefined();
  });
});

describe("the folder's version words (functionality A)", () => {
  it('penalises a live folder and excludes it under a no-live rule', () => {
    const want = {
      title: 'Hotel California',
      artist: 'Eagles',
      duration: 391,
      policy: emptyPolicy(),
    };
    const live = {
      username: 'u',
      filename: '@@x\\Music\\Eagles\\Eagles Live\\03 Hotel California.flac',
      size: 40_000_000,
      extension: 'flac',
      length: 391,
      hasFreeUploadSlot: true,
      queueLength: 0,
      uploadSpeed: 2_000_000,
    };
    const scored = score(live, want).scored!;
    expect(scored.reasons).toContain('live in folder');
    const plain = score(
      { ...live, filename: '@@x\\Music\\Eagles\\Hotel California\\03 Hotel California.flac' },
      want,
    ).scored!;
    expect(plain.score - scored.score).toBe(30);
    expect(score(live, { ...want, policy: parseRules(['no live versions']) }).excluded).toBe(
      'rule: no live',
    );
    // "Live" in the title asked for is not a penalty.
    expect(
      score(live, { ...want, title: 'Hotel California (Live)' }).scored!.reasons,
    ).not.toContain('live in folder');
  });
});

describe('database errors and the preflight (functionality G; design O)', () => {
  it('reports a hub-side failure as 500 storage_error, Jellyfin as 503, and degrades /health when the database refuses a write', async () => {
    const app = Fastify();
    const broken: Authenticator = {
      configured: true,
      peek: () => null,
      authenticate: async () => {
        throw new Error('SQLITE_READONLY: attempt to write a readonly database');
      },
    };
    const down: Authenticator = {
      configured: true,
      peek: () => null,
      authenticate: async () => {
        throw new HttpError('jellyfin', 0, 'jellyfin unreachable');
      },
    };
    app.get('/broken', { preHandler: requireProfile(broken) }, async () => ({ ok: true }));
    app.get('/down', { preHandler: requireProfile(down) }, async () => ({ ok: true }));
    const headers = { authorization: 'Bearer x' };
    const storage = await app.inject({ url: '/broken', headers });
    expect(storage.statusCode).toBe(500);
    expect(storage.json().error).toBe('storage_error');
    expect((await app.inject({ url: '/down', headers })).statusCode).toBe(503);
    await app.close();

    const health = createHealthState();
    expect(health.database.ok).toBe(true);
    health.markDatabase(false, 'readonly');
    expect(health.database).toMatchObject({ ok: false, error: 'readonly' });
    health.markDatabase(true);
    expect(health.database.error).toBeUndefined();

    const stores = memoryStores();
    stores.cache.sweep = () => {
      throw new Error('SQLITE_READONLY');
    };
    const hub = await buildApp({
      config: loadConfig({
        RENAISSANCE_HUB_DB: ':memory:',
        JELLYFIN_URL: 'http://jf.test',
        JELLYFIN_API_KEY: 'k',
      }),
      stores,
      authenticator: staticAuthenticator({ 'tok-sahil': sahil }),
      library: fakeLibrary().library,
      catalogue: fakeCatalogue(),
    });
    await hub.ready();
    const res = await hub.inject({ url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', database: 'error' });
    await hub.close();
    // The runner alone, with a healthy sweep, marks the database ok.
    const log = recordingLogger();
    const good = createHealthState();
    good.markDatabase(false);
    const runner = createRunner({
      pipeline: {
        run: async () => undefined,
        pollAlbums: async () => {},
        abandon: async () => undefined,
      },
      stores: memoryStores(),
      bus: createEventBus(),
      log,
      health: good,
    });
    runner.start();
    runner.stop();
    expect(good.database.ok).toBe(true);
  });

  it('the preflight allows DELETE, so Cancel and every Undo work from a browser', async () => {
    const app = await buildApp({
      config: loadConfig({
        RENAISSANCE_HUB_DB: ':memory:',
        JELLYFIN_URL: 'http://jf.test',
        JELLYFIN_API_KEY: 'k',
      }),
      stores: memoryStores(),
      authenticator: staticAuthenticator({ 'tok-sahil': sahil }),
      library: fakeLibrary().library,
      catalogue: fakeCatalogue(),
      startRunner: false,
    });
    await app.ready();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/requests/abc',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'DELETE',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(res.headers['access-control-allow-methods']).split(/,\s*/)).toEqual(
      expect.arrayContaining(['GET', 'POST', 'DELETE']),
    );
    await app.close();
  });
});
