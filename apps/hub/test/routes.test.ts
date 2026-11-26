import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
import { buildApp, memoryStores, mom, sahil } from './helpers.js';

const authenticator = staticAuthenticator({ 'tok-sahil': sahil, 'tok-mom': mom });
const auth = (token = 'tok-sahil') => ({ authorization: `Bearer ${token}` });

async function build(
  extra: Partial<Parameters<typeof buildApp>[0]> = {},
  env: Record<string, string> = {},
  omit: (keyof Parameters<typeof buildApp>[0])[] = [],
) {
  const stores = memoryStores();
  const slskd = fakeSlskd({ results: { 'lil wayne fireman': [response('cuchillo', [{}])] } });
  const lidarr = fakeLidarr();
  const lib = fakeLibrary();
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
    pingMs: 50,
    albumPollMs: 60_000,
    ...extra,
  };
  for (const key of omit) delete options[key];
  const app = await buildApp(options);
  await app.ready();
  return { app, stores, slskd, lidarr, lib };
}

describe('GET /health', () => {
  it('answers status to anyone and integrations only to a valid token', async () => {
    const { app } = await build();
    const anon = await app.inject({ url: '/health' });
    expect(anon.statusCode).toBe(200);
    expect(anon.json()).toEqual({
      status: 'ok',
      service: 'renaissance-hub',
      version,
      database: 'ok',
    });
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

  it('never calls Jellyfin and never fails when Jellyfin is down: the cache alone decides', async () => {
    const { jellyfinAuthenticator } = await import('../src/auth/authenticator.js');
    const { fakeFetch } = await import('./helpers.js');
    const stores = memoryStores();
    const { fetch: jf, calls } = fakeFetch({
      '/Users/Me': () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const real = jellyfinAuthenticator({
      url: 'http://jf.test',
      admins: [],
      profiles: stores.profiles,
      cache: stores.cache,
      fetch: jf,
    });
    const { app } = await build({ authenticator: real, stores });
    const res = await app.inject({ url: '/health', headers: auth('any-token') });
    expect(res.statusCode).toBe(200);
    expect(res.json().integrations).toBeUndefined();
    expect(calls).toHaveLength(0);
    // A token the hub has checked recently (through any other route) unlocks the detail.
    stores.cache.set(
      `auth:${(await import('node:crypto')).createHash('sha256').update('seen').digest('hex')}`,
      { Id: 'u-sahil', Name: 'Sahil', IsAdministrator: true },
      60_000,
    );
    const seen = await app.inject({ url: '/health', headers: auth('seen') });
    expect(seen.json().integrations).toBeDefined();
    expect(calls).toHaveLength(0);
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
    for (const url of ['/requests', '/requests/x', '/events', '/catalogue/search?q=ab']) {
      expect((await app.inject({ url })).statusCode).toBe(401);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/requests',
          payload: { kind: 'track', title: 'T', artist: 'A' },
        })
      ).statusCode,
    ).toBe(401);
    // The routes F61 leaves to later lanes are not there at all.
    for (const url of ['/me', '/collection', '/rules', '/budget']) {
      expect((await app.inject({ url, headers: auth() })).statusCode).toBe(404);
    }
    await app.close();
    const off = await build({}, { JELLYFIN_URL: '' }, ['authenticator']);
    expect((await off.app.inject({ url: '/requests', headers: auth() })).statusCode).toBe(503);
    await off.app.close();
  });
});

describe('/requests', () => {
  it('creates for the caller, runs the pipeline, and shows each profile its own requests only', async () => {
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
    const id = created.json().id as string;
    expect(
      (await app.inject({ url: `/requests/${id}`, headers: auth('tok-mom') })).statusCode,
    ).toBe(200);
    // Not the asker, not a watcher: another profile's request is not there (F87 adds the admin view).
    expect((await app.inject({ url: `/requests/${id}`, headers: auth() })).statusCode).toBe(404);
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

  it('short-circuits when the song is already on the server: no fetch, added at once', async () => {
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
    expect(stores.requests.listMine(sahil.id)).toEqual([]);
    expect(stores.collection.list(sahil.id)).toHaveLength(1);
    expect(stores.collection.list(mom.id)).toEqual([]);
    await app.close();
  });

  it('answers an item already here with an unstored entry when no collection is wired', async () => {
    const found = {
      item: { Id: 'jf-t1', Name: 'Fireman', Type: 'Audio', Artists: ['Lil Wayne'] },
      hit: { id: 'jf-t1', kind: 'track' as const, title: 'Fireman', artist: 'Lil Wayne' },
    };
    const { app } = await build({
      library: fakeLibrary({ found }).library,
      stores: Object.assign(memoryStores(), { collection: undefined }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: auth(),
      payload: { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ alreadyHere: true, item: { id: 0, item: 'jf-t1' } });
    await app.close();
  });

  it('answers a second request for the same song with the running one (200), by anyone', async () => {
    const { app } = await build({ startRunner: false });
    const first = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: auth(),
      payload: { kind: 'track', ...firemanSong },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: auth('tok-mom'),
      payload: { kind: 'track', ...firemanSong },
    });
    expect(second.statusCode).toBe(200);
    // The answer says so, names the running request, and Mom now watches it: it is in her list.
    expect(second.json().alreadyRequested).toBe(true);
    expect(second.json().request.id).toBe(first.json().id);
    expect(second.json().request.watchers).toEqual([mom.id]);
    expect(second.json().alreadyHere).toBeUndefined();
    const momList = await app.inject({ url: '/requests', headers: auth('tok-mom') });
    expect(momList.json().map((r: { id: string }) => r.id)).toEqual([first.json().id]);
    const momOne = await app.inject({
      url: `/requests/${first.json().id}`,
      headers: auth('tok-mom'),
    });
    expect(momOne.statusCode).toBe(200);
    // A watcher sees it but cannot stop it: only the asker may.
    const momCancel = await app.inject({
      method: 'DELETE',
      url: `/requests/${first.json().id}`,
      headers: auth('tok-mom'),
    });
    expect(momCancel.statusCode).toBe(404);
    await app.hub.runner.idle();
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
    expect(cancelled.json()).toMatchObject({ status: 'cancelled' });
    expect(cancelled.json().reason).toBeUndefined();
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

describe('/catalogue/search', () => {
  it('answers 503 busy with retry-after when the limiter is full or the search was superseded', async () => {
    const { LimiterBusyError } = await import('../src/catalogue/rate-limiter.js');
    const owners: unknown[] = [];
    const catalogue = {
      ...fakeCatalogue(),
      search: async (_q: string, who?: unknown) => {
        owners.push(who);
        throw new LimiterBusyError('busy');
      },
    } as unknown as ReturnType<typeof fakeCatalogue>;
    const { app } = await build({ catalogue });
    const res = await app.inject({ url: '/catalogue/search?q=fireman', headers: auth() });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.json()).toMatchObject({ error: 'busy' });
    expect(owners).toEqual([{ owner: sahil.id, fast: true }]);
    await app.close();
  });

  it("validates q and marks library hits, by the words typed and by the rows' artists", async () => {
    const lib = fakeLibrary();
    lib.library.search = async (_token: string, text: string) =>
      text === 'fireman'
        ? {
            tracks: [{ id: 'jf-t1', kind: 'track', title: 'Fireman', artist: 'Lil Wayne' }],
            albums: [{ id: 'jf-a1', kind: 'album', title: 'Tha Carter II' }],
            artists: [],
          }
        : {
            tracks: [],
            albums: [],
            artists: [{ id: 'jf-ar1', kind: 'artist', title: 'Lil Wayne' }],
          };
    lib.library.tracksByArtists = async (_token: string, names: readonly string[]) =>
      names.includes('Lil Wayne')
        ? [{ id: 'jf-t1', kind: 'track', title: 'Fireman', artist: 'Lil Wayne' }]
        : [];
    const { app } = await build({ library: lib.library });
    expect((await app.inject({ url: '/catalogue/search?q=a', headers: auth() })).statusCode).toBe(
      400,
    );
    const res = await app.inject({ url: '/catalogue/search?q=fireman', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().songs[0]).toMatchObject({ title: 'Fireman', libraryId: 'jf-t1' });
    expect(res.json().albums[0]).toMatchObject({ title: carterAlbum.title, libraryId: 'jf-a1' });
    // An artist query: the name search finds no track called "lil wayne", the artist lookup does.
    const byArtist = await app.inject({ url: '/catalogue/search?q=lil wayne', headers: auth() });
    expect(byArtist.statusCode).toBe(200);
    expect(byArtist.json().songs[0]).toMatchObject({ title: 'Fireman', libraryId: 'jf-t1' });
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
    const viaQuery = await readEvents(`${base}/events?token=tok-sahil`, {}, 1);
    expect(viaQuery[0]).toMatch(/^event: ping/);
    expect(formatEvent({ type: 'ping', at: 'now' })).toBe(
      'event: ping\ndata: {"type":"ping","at":"now"}\n\n',
    );
    for (let i = 0; built.app.hub.bus.size() > 0 && i < 50; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(built.app.hub.bus.size()).toBe(0);
  });
});

describe('rate limit and CORS', () => {
  it('answers 429 past the per-address limit, except on /health', async () => {
    const { app } = await build({}, { RENAISSANCE_HUB_RATE_LIMIT: '2' });
    const hit = () => app.inject({ url: '/requests', headers: auth() });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    const third = await hit();
    expect(third.statusCode).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/requests', headers: auth(), remoteAddress: '10.0.0.9' }))
        .statusCode,
    ).toBe(200);
    await app.close();
  });

  it('allows the dev origin outside production and none in production without configuration', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/requests',
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
      url: '/requests',
      headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
    const prod = await build({}, { NODE_ENV: 'production', RENAISSANCE_HUB_TRUST_PROXY: 'true' });
    const none = await prod.app.inject({
      method: 'OPTIONS',
      url: '/requests',
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
    const res = await app.inject({ url: '/requests', headers: auth() });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('jellyfin_unreachable');
    await app.close();
  });
});
