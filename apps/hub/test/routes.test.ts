import type Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type { ModelClient } from '../src/ask/engine.js';
import { staticAuthenticator } from '../src/auth/authenticator.js';
import { loadConfig } from '../src/config.js';
import { formatEvent } from '../src/routes/events.js';
import { readVersion, version } from '../src/version.js';
import {
  carterAlbum,
  fakeCatalogue,
  fakeLidarr,
  fakeLibrary,
  fakeSlskd,
  firemanSong,
  response,
} from './fakes.js';
import { memoryStores, mom, sahil } from './helpers.js';

const authenticator = staticAuthenticator({ 'tok-sahil': sahil, 'tok-mom': mom });
const auth = (token = 'tok-sahil') => ({ authorization: `Bearer ${token}` });

const modelReply: Anthropic.Message = {
  id: 'm',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [
    {
      type: 'tool_use',
      id: 't',
      name: 'request',
      input: { kind: 'track', title: 'Fireman', artist: 'Lil Wayne', catalogueId: firemanSong.id },
    },
    { type: 'text', text: 'Requested Fireman.', citations: null },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  stop_details: null,
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  } as Anthropic.Usage,
} as Anthropic.Message;

async function build(
  extra: Partial<Parameters<typeof buildApp>[0]> = {},
  env: Record<string, string> = {},
  omit: (keyof Parameters<typeof buildApp>[0])[] = [],
) {
  const stores = memoryStores();
  const slskd = fakeSlskd({ results: { 'lil wayne fireman': [response('cuchillo', [{}])] } });
  const lidarr = fakeLidarr();
  const lib = fakeLibrary();
  const modelClient: ModelClient = { messages: { create: vi.fn(async () => modelReply) } };
  const options: Parameters<typeof buildApp>[0] = {
    config: loadConfig({
      RENAISSANCE_HUB_DB: ':memory:',
      JELLYFIN_URL: 'http://jf.test',
      JELLYFIN_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'sk-test-value',
      ...env,
    }),
    stores,
    authenticator,
    library: lib.library,
    catalogue: fakeCatalogue(),
    slskd: slskd.client,
    lidarr: lidarr.client,
    modelClient,
    pingMs: 50,
    albumPollMs: 60_000,
    ...extra,
  };
  for (const key of omit) delete options[key];
  const app = await buildApp(options);
  await app.ready();
  return { app, stores, slskd, lidarr, lib, modelClient };
}

describe('GET /health', () => {
  it('answers status to anyone and integrations only to a valid token', async () => {
    const { app } = await build();
    const anon = await app.inject({ url: '/health' });
    expect(anon.statusCode).toBe(200);
    expect(anon.json()).toEqual({ status: 'ok', service: 'renaissance-hub', version });
    const bad = await app.inject({ url: '/health', headers: auth('nope') });
    expect(bad.json().integrations).toBeUndefined();
    const good = await app.inject({ url: '/health', headers: auth() });
    expect(good.json().integrations).toMatchObject({
      jellyfin: true,
      anthropic: true,
      intentModel: 'claude-opus-5-5',
    });
    expect(JSON.stringify(good.json())).not.toContain('sk-test-value');
    await app.close();
  });

  it('reports the version from the package manifest', async () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(version).toBe(manifest.version);
    expect(readVersion(new URL('./missing.json', import.meta.url))).toBe('0.0.0');
    expect(readVersion(new URL('./routes.test.ts', import.meta.url))).toBe('0.0.0');
  });
});

describe('authentication', () => {
  it('needs a token on every route but /health, and 503 without Jellyfin', async () => {
    const { app } = await build();
    for (const url of [
      '/me',
      '/requests',
      '/collection',
      '/rules',
      '/budget',
      '/events',
      '/catalogue/search?q=ab',
    ]) {
      expect((await app.inject({ url })).statusCode).toBe(401);
    }
    expect(
      (await app.inject({ method: 'POST', url: '/ask', payload: { text: 'x' } })).statusCode,
    ).toBe(401);
    await app.close();
    const off = await build({}, { JELLYFIN_URL: '' }, ['authenticator']);
    expect((await off.app.inject({ url: '/me', headers: auth() })).statusCode).toBe(503);
    await off.app.close();
  });

  it('GET and POST /me', async () => {
    const { app } = await build();
    expect((await app.inject({ url: '/me', headers: auth() })).json()).toEqual(sahil);
    const updated = await app.inject({
      method: 'POST',
      url: '/me',
      headers: auth('tok-mom'),
      payload: { language: 'en' },
    });
    expect(updated.json()).toMatchObject({ id: mom.id, language: 'en', mode: 'simple' });
    expect(
      (await app.inject({ method: 'POST', url: '/me', headers: auth(), payload: { mode: 'loud' } }))
        .statusCode,
    ).toBe(400);
    await app.close();
  });
});

describe('/requests', () => {
  it('creates for the caller, runs the pipeline, scopes the list, and shows the house to admins only', async () => {
    const { app, stores } = await build();
    const created = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: auth('tok-mom'),
      payload: { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'requested',
      requestedBy: mom.id,
      requestedByName: 'Mom',
    });
    await app.hub.runner.idle();
    const mine = await app.inject({ url: '/requests', headers: auth('tok-mom') });
    expect(mine.json()).toHaveLength(1);
    expect(mine.json()[0].status).toBe('ready');
    expect((await app.inject({ url: '/requests', headers: auth() })).json()).toEqual([]);
    expect(
      (await app.inject({ url: '/requests?scope=house', headers: auth('tok-mom') })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/requests?scope=house', headers: auth() })).json(),
    ).toHaveLength(1);
    expect((await app.inject({ url: '/requests?scope=galaxy', headers: auth() })).statusCode).toBe(
      400,
    );
    const id = created.json().id as string;
    expect(
      (await app.inject({ url: `/requests/${id}`, headers: auth('tok-mom') })).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: `/requests/${id}`, headers: auth() })).statusCode).toBe(200);
    const other = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: auth(),
      payload: { kind: 'album', title: 'X', artist: 'Y' },
    });
    await app.hub.runner.idle();
    expect(
      (await app.inject({ url: `/requests/${other.json().id}`, headers: auth('tok-mom') }))
        .statusCode,
    ).toBe(404);
    expect((await app.inject({ url: '/requests/nope', headers: auth() })).statusCode).toBe(404);
    expect(stores.collection.list(mom.id)).toHaveLength(1);
    await app.close();
  });

  it('validates the body and bounds strings', async () => {
    const { app } = await build();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/requests',
          headers: auth(),
          payload: { kind: 'track' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/requests',
          headers: auth(),
          payload: { kind: 'ep', title: 'T', artist: 'A' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/requests',
          headers: auth(),
          payload: { kind: 'track', title: 'x'.repeat(201), artist: 'A' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/requests',
          headers: auth(),
          payload: { kind: 'track', title: 'T', artist: 'A', recordingId: 'not-a-uuid' },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it('short-circuits when the song is already on the server (F86)', async () => {
    const found = {
      item: {
        Id: 'jf-t1',
        Name: 'Fireman',
        Type: 'Audio',
        Artists: ['Lil Wayne'],
        Album: 'Tha Carter II',
      },
      hit: {
        id: 'jf-t1',
        kind: 'track' as const,
        title: 'Fireman',
        artist: 'Lil Wayne',
        album: 'Tha Carter II',
      },
    };
    const { app, stores } = await build({ library: fakeLibrary({ found }).library });
    const res = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: auth(),
      payload: { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      alreadyHere: true,
      item: { item: 'jf-t1', source: 'add', profile: sahil.id, album: 'Tha Carter II' },
    });
    expect(stores.requests.listHouse()).toEqual([]);
    const list = await app.inject({ url: '/collection', headers: auth() });
    expect(list.json()).toHaveLength(1);
    expect((await app.inject({ url: '/collection', headers: auth('tok-mom') })).json()).toEqual([]);
    expect(
      (await app.inject({ url: '/collection?scope=house', headers: auth('tok-mom') })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/collection?scope=house', headers: auth() })).json(),
    ).toHaveLength(1);
    expect((await app.inject({ url: '/collection?scope=x', headers: auth() })).statusCode).toBe(
      400,
    );
    const id = list.json()[0].id as number;
    expect(
      (await app.inject({ method: 'DELETE', url: `/collection/${id}`, headers: auth('tok-mom') }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: '/collection/abc', headers: auth() })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'DELETE', url: `/collection/${id}`, headers: auth() }))
        .statusCode,
    ).toBe(200);
    expect((await app.inject({ url: '/collection', headers: auth() })).json()).toEqual([]);
    await app.close();
  });

  it('cancels a request that has not started, refuses later', async () => {
    const { app, stores } = await build({ startRunner: false });
    const created = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: auth(),
      payload: { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
    });
    const id = created.json().id as string;
    await app.hub.runner.idle();
    expect(
      (await app.inject({ method: 'DELETE', url: `/requests/${id}`, headers: auth('tok-mom') }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/requests/${id}`, headers: auth() })).statusCode,
    ).toBe(409);
    const second = stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/requests/${second.id}`,
      headers: auth(),
    });
    expect(cancelled.json()).toMatchObject({ status: 'failed', reason: 'cancelled' });
    expect(
      (await app.inject({ method: 'POST', url: `/requests/${second.id}/retry`, headers: auth() }))
        .statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ method: 'POST', url: '/requests/nope/retry', headers: auth() }))
        .statusCode,
    ).toBe(404);
    const failed = stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    stores.requests.update(failed.id, { status: 'failed', reason: 'no_results' });
    const retried = await app.inject({
      method: 'POST',
      url: `/requests/${failed.id}/retry`,
      headers: auth(),
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json().status).toBe('requested');
    await app.hub.runner.idle();
    expect(stores.requests.get(failed.id)?.status).toBe('ready');
    await app.close();
  });
});

describe('/rules and /budget', () => {
  it('stores rules per profile with their policy, and reports the budget', async () => {
    const { app } = await build();
    expect(
      (await app.inject({ method: 'POST', url: '/rules', headers: auth(), payload: { text: '' } }))
        .statusCode,
    ).toBe(400);
    const created = await app.inject({
      method: 'POST',
      url: '/rules',
      headers: auth(),
      payload: { text: 'no live versions' },
    });
    expect(created.statusCode).toBe(201);
    expect((await app.inject({ url: '/rules', headers: auth() })).json()).toHaveLength(1);
    expect((await app.inject({ url: '/rules', headers: auth('tok-mom') })).json()).toEqual([]);
    expect((await app.inject({ url: '/rules/policy', headers: auth() })).json()).toMatchObject({
      exclude: ['live'],
    });
    const id = created.json().id as number;
    expect(
      (await app.inject({ method: 'DELETE', url: `/rules/${id}`, headers: auth('tok-mom') }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: '/rules/x', headers: auth() })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'DELETE', url: `/rules/${id}`, headers: auth() })).statusCode,
    ).toBe(200);
    const budget = await app.inject({ url: '/budget', headers: auth() });
    expect(budget.json()).toMatchObject({
      model: 'claude-opus-5-5',
      capUsd: 10,
      spentUsd: 0,
      off: false,
      days: [],
    });
    expect(
      (await app.inject({ url: '/budget?scope=house', headers: auth('tok-mom') })).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: '/budget?scope=house', headers: auth() })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ url: '/budget?scope=zzz', headers: auth() })).statusCode).toBe(400);
    await app.close();
  });
});

describe('/catalogue/search', () => {
  it('validates q and marks library hits', async () => {
    const lib = fakeLibrary();
    lib.library.search = async () => ({
      tracks: [{ id: 'jf-t1', kind: 'track', title: 'Fireman', artist: 'Lil Wayne' }],
      albums: [{ id: 'jf-a1', kind: 'album', title: 'Tha Carter II' }],
      artists: [],
    });
    const { app } = await build({ library: lib.library });
    expect((await app.inject({ url: '/catalogue/search?q=a', headers: auth() })).statusCode).toBe(
      400,
    );
    const res = await app.inject({ url: '/catalogue/search?q=fireman', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().songs[0]).toMatchObject({ title: 'Fireman', libraryId: 'jf-t1' });
    expect(res.json().albums[0]).toMatchObject({ title: carterAlbum.title, libraryId: 'jf-a1' });
    await app.close();
  });
});

describe('POST /ask', () => {
  it('validates, answers JSON, and streams instant then answer', async () => {
    const { app, modelClient } = await build();
    expect(
      (await app.inject({ method: 'POST', url: '/ask', headers: auth(), payload: { text: '' } }))
        .statusCode,
    ).toBe(400);
    const res = await app.inject({
      method: 'POST',
      url: '/ask',
      headers: auth(),
      payload: { text: 'get fireman by lil wayne', language: 'en' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      model: 'claude-opus-5-5',
      language: 'en',
      why: 'Requested Fireman.',
    });
    expect(res.json().actions[0]).toMatchObject({ tool: 'request', ranBy: 'hub' });
    expect(modelClient.messages.create).toHaveBeenCalledTimes(1);
    await app.hub.runner.idle();
    const stream = await app.inject({
      method: 'POST',
      url: '/ask?stream=1',
      headers: auth(),
      payload: { text: 'get fireman by lil wayne' },
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    const body = stream.body;
    expect(body.indexOf('event: instant')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('event: answer')).toBeGreaterThan(body.indexOf('event: instant'));
    const accept = await app.inject({
      method: 'POST',
      url: '/ask',
      headers: { ...auth(), accept: 'text/event-stream' },
      payload: { text: 'hello there' },
    });
    expect(accept.headers['content-type']).toContain('text/event-stream');
    await app.hub.runner.idle();
    await app.close();
  });

  it('is off without a key', async () => {
    const { app } = await build({}, { ANTHROPIC_API_KEY: '' }, ['modelClient']);
    const res = await app.inject({
      method: 'POST',
      url: '/ask',
      headers: auth(),
      payload: { text: 'anything at all' },
    });
    expect(res.json()).toMatchObject({ model: 'off', reason: 'no_key', actions: [] });
    await app.close();
  });
});

describe('GET /events', () => {
  let built: Awaited<ReturnType<typeof build>>;
  let base: string;
  beforeAll(async () => {
    built = await build({ startRunner: false });
    await built.app.listen({ host: '127.0.0.1', port: 0 });
    const address = built.app.server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(() => built.app.close());

  async function readEvents(
    url: string,
    headers: Record<string, string>,
    wanted: number,
  ): Promise<string[]> {
    const controller = new AbortController();
    const res = await fetch(url, { headers, signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while ((text.match(/^event: /gm) ?? []).length < wanted) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    controller.abort();
    return text.split('\n\n').filter(Boolean);
  }

  it("pushes the caller's request changes and pings, by header or ?token=", async () => {
    const pending = readEvents(`${base}/events`, auth('tok-mom'), 3);
    await new Promise((r) => setTimeout(r, 20));
    const created = await built.app.inject({
      method: 'POST',
      url: '/requests',
      headers: auth('tok-mom'),
      payload: { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
    });
    expect(created.statusCode).toBe(201);
    const blocks = await pending;
    expect(blocks[0]).toMatch(/^event: ping/);
    expect(
      blocks.some((b) => b.startsWith('event: request') && b.includes('"status":"requested"')),
    ).toBe(true);
    expect(blocks.filter((b) => b.startsWith('event: ping')).length).toBeGreaterThanOrEqual(1);
    const viaQuery = await readEvents(`${base}/events?token=tok-sahil&scope=house`, {}, 1);
    expect(viaQuery[0]).toMatch(/^event: ping/);
    expect(formatEvent({ type: 'ping', at: 'now' })).toBe(
      'event: ping\ndata: {"type":"ping","at":"now"}\n\n',
    );
    for (let i = 0; built.app.hub.bus.size() > 0 && i < 50; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(built.app.hub.bus.size()).toBe(0);
  });

  it('refuses the house scope to members and bad scopes to everyone', async () => {
    expect(
      (await built.app.inject({ url: '/events?scope=house', headers: auth('tok-mom') })).statusCode,
    ).toBe(403);
    expect(
      (await built.app.inject({ url: '/events?scope=nope', headers: auth() })).statusCode,
    ).toBe(400);
  });
});

describe('rate limit and CORS', () => {
  it('answers 429 past the per-address limit, except on /health', async () => {
    const { app } = await build({}, { RENAISSANCE_HUB_RATE_LIMIT: '2' });
    const hit = () => app.inject({ url: '/me', headers: auth() });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    const third = await hit();
    expect(third.statusCode).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/me', headers: auth(), remoteAddress: '10.0.0.9' })).statusCode,
    ).toBe(200);
    await app.close();
  });

  it('allows the dev origin outside production and none in production without configuration', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/ask',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const evil = await app.inject({
      method: 'OPTIONS',
      url: '/ask',
      headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
    const prod = await build({}, { NODE_ENV: 'production', RENAISSANCE_HUB_TRUST_PROXY: 'true' });
    const none = await prod.app.inject({
      method: 'OPTIONS',
      url: '/ask',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    expect(none.statusCode).toBe(404);
    await prod.app.close();
  });
});

describe('buildApp defaults', () => {
  it('builds the real clients from configuration and opens its own database', async () => {
    const app = await buildApp({
      config: loadConfig({
        RENAISSANCE_HUB_DB: ':memory:',
        JELLYFIN_URL: 'http://jf.test',
        JELLYFIN_API_KEY: 'k',
        SLSKD_URL: 'http://slskd.test',
        SLSKD_API_KEY: 's',
        LIDARR_URL: 'http://lidarr.test',
        LIDARR_API_KEY: 'l',
        LIDARR_ROOT_FOLDER: '/music',
        NAVIDROME_URL: 'http://nd.test',
        NAVIDROME_USER: 'u',
        NAVIDROME_PASSWORD: 'p',
        ANTHROPIC_API_KEY: 'sk-test',
      }),
      startRunner: false,
    });
    await app.ready();
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    const res = await app.inject({ url: '/me', headers: auth() });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('jellyfin_unreachable');
    await app.close();
  });
});
