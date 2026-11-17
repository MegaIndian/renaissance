import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

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
});
