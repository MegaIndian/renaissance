import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MAX_TEXT, STORE_CAP, memoryRequestStore } from '../src/routes/requests.js';
import { readVersion, version } from '../src/version.js';

const app = await buildApp({ config: loadConfig({}) });

beforeAll(() => app.ready());
afterAll(() => app.close());

describe('GET /health', () => {
  it('reports ok and integration presence only', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.integrations.anthropic).toBe(false);
  });

  it('reports the version from the package manifest, not an npm variable', async () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(version).toBe(manifest.version);
    expect((await app.inject({ method: 'GET', url: '/health' })).json().version).toBe(
      manifest.version,
    );
    expect(readVersion(new URL('./missing.json', import.meta.url))).toBe('0.0.0');
    expect(readVersion(new URL('./routes.test.ts', import.meta.url))).toBe('0.0.0');
  });
});

describe('rate limit', () => {
  it('answers 429 past the per-address limit, except on /health', async () => {
    const limited = await buildApp({ config: loadConfig({ RENAISSANCE_HUB_RATE_LIMIT: '2' }) });
    const hit = () => limited.inject({ method: 'GET', url: '/requests' });
    expect((await hit()).statusCode).toBe(200);
    const second = await hit();
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-ratelimit-remaining']).toBe('0');
    const third = await hit();
    expect(third.statusCode).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect((await limited.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const other = await limited.inject({
      method: 'GET',
      url: '/requests',
      remoteAddress: '10.0.0.9',
    });
    expect(other.statusCode).toBe(200);
    await limited.close();
  });

  it('is off at 0 and defaults to 120 a minute', async () => {
    expect(loadConfig({}).rateLimitPerMinute).toBe(120);
    const open = await buildApp({ config: loadConfig({ RENAISSANCE_HUB_RATE_LIMIT: '0' }) });
    for (let i = 0; i < 5; i++) {
      expect((await open.inject({ method: 'GET', url: '/requests' })).statusCode).toBe(200);
    }
    await open.close();
  });
});

describe('CORS', () => {
  it('answers the web dev server preflight for /ask outside production', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/ask',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
  });

  it('does not allow an unknown origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/ask',
      headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('has no CORS at all in production without configured origins', async () => {
    const prod = await buildApp({ config: loadConfig({ NODE_ENV: 'production' }) });
    const res = await prod.inject({
      method: 'OPTIONS',
      url: '/ask',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    expect(res.statusCode).toBe(404);
    await prod.close();
  });
});

describe('POST /ask', () => {
  it('validates the body', async () => {
    const res = await app.inject({ method: 'POST', url: '/ask', payload: { text: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('answers not implemented with no actions and the fixed tool list', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ask',
      payload: { text: 'play something calm' },
    });
    expect(res.statusCode).toBe(501);
    const body = res.json();
    expect(body.actions).toEqual([]);
    expect(body.tools).toContain('search_library');
    expect(body.tools).not.toContain('invent_song');
  });
});

describe('/requests', () => {
  it('starts empty, accepts a request, lists and fetches it', async () => {
    expect((await app.inject({ method: 'GET', url: '/requests' })).json()).toEqual({ items: [] });
    const created = await app.inject({
      method: 'POST',
      url: '/requests',
      payload: { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
    });
    expect(created.statusCode).toBe(201);
    const item = created.json();
    expect(item.status).toBe('requested');
    expect((await app.inject({ method: 'GET', url: '/requests' })).json().items).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `/requests/${item.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/requests/nope' })).statusCode).toBe(404);
  });

  it('rejects an incomplete request', async () => {
    const res = await app.inject({ method: 'POST', url: '/requests', payload: { kind: 'track' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects strings over the maximum length and a malformed MusicBrainz id', async () => {
    const long = 'x'.repeat(MAX_TEXT + 1);
    const tooLong = await app.inject({
      method: 'POST',
      url: '/requests',
      payload: { kind: 'album', title: long, artist: 'A' },
    });
    expect(tooLong.statusCode).toBe(400);
    const badId = await app.inject({
      method: 'POST',
      url: '/requests',
      payload: { kind: 'album', title: 'T', artist: 'A', musicBrainzId: 'not-a-uuid' },
    });
    expect(badId.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: '/requests',
      payload: { kind: 'album', title: 'x'.repeat(MAX_TEXT), artist: 'A' },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('the memory store drops the oldest past its cap and lists newest first by insertion', () => {
    const store = memoryRequestStore(3);
    const first = store.add({ kind: 'track', title: '1', artist: 'a', requestedBy: 'local' });
    for (const n of ['2', '3', '4']) {
      store.add({ kind: 'track', title: n, artist: 'a', requestedBy: 'local' });
    }
    expect(store.list()).toHaveLength(3);
    expect(store.get(first.id)).toBeUndefined();
    // All four were added within the same millisecond or two; order must still be newest first.
    expect(store.list().map((item) => item.title)).toEqual(['4', '3', '2']);
    expect(STORE_CAP).toBe(500);
  });
});
