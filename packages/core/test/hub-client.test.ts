import { describe, expect, it, vi } from 'vitest';

import { HubClientError, createHubClient, parseSseChunk } from '../src/index';
import type { AskResponse, MusicRequest } from '../src/index';

const request: MusicRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'track',
  title: 'Fireman',
  artist: 'Lil Wayne',
  requestedBy: 'u1',
  requestedByName: 'Sahil',
  status: 'requested',
  createdAt: '2026-11-17T00:00:00.000Z',
  updatedAt: '2026-11-17T00:00:00.000Z',
  steps: [{ at: '2026-11-17T00:00:00.000Z', status: 'requested' }],
};

const answer: AskResponse = {
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('parseSseChunk', () => {
  it('splits complete events and keeps the partial tail', () => {
    const { events, rest } = parseSseChunk('event: a\ndata: 1\n\ndata: 2\n\nevent: c\ndata: {"x"');
    expect(events).toEqual([
      { event: 'a', data: '1' },
      { event: 'message', data: '2' },
    ]);
    expect(rest).toBe('event: c\ndata: {"x"');
  });

  it('joins multi-line data', () => {
    expect(parseSseChunk('data: a\ndata: b\n\n').events[0]?.data).toBe('a\nb');
  });
});

describe('createHubClient', () => {
  it('sends the bearer token and validates the answer', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([request])));
    const hub = createHubClient({ url: 'http://hub.test/', token: 'tok', fetch: fetchMock });
    expect(hub.url).toBe('http://hub.test');
    const items = await hub.requests();
    expect(items[0]?.title).toBe('Fireman');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://hub.test/requests');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    await hub.requests('house');
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe('http://hub.test/requests?scope=house');
  });

  it('posts JSON bodies and accepts the already-here answer', async () => {
    const already = {
      alreadyHere: true,
      item: {
        id: 1,
        profile: 'u1',
        item: 'jf1',
        kind: 'track',
        title: 'Fireman',
        artist: 'Lil Wayne',
        addedBy: 'u1',
        addedAt: '2026-11-17T00:00:00.000Z',
        source: 'add',
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(already));
    const hub = createHubClient({ url: 'http://hub.test', fetch: fetchMock });
    const result = await hub.createRequest({
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
    });
    expect('alreadyHere' in result && result.alreadyHere).toBe(true);
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
    });
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('turns error bodies into HubClientError with the hub code', async () => {
    const hub = createHubClient({
      url: 'http://hub.test',
      fetch: vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'forbidden', message: 'Admins only.' }, 403)),
    });
    await expect(hub.budget('house')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      message: 'Admins only.',
    });
    const plain = createHubClient({
      url: 'http://hub.test',
      fetch: vi.fn().mockResolvedValue(new Response('nope', { status: 500 })),
    });
    await expect(plain.rules()).rejects.toBeInstanceOf(HubClientError);
  });

  it('rejects an answer of the wrong shape', async () => {
    const hub = createHubClient({
      url: 'http://hub.test',
      fetch: vi.fn().mockResolvedValue(jsonResponse({ nope: 1 })),
    });
    await expect(hub.me()).rejects.toThrow();
  });

  it('covers every route helper', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/me'))
        return jsonResponse({
          id: 'u1',
          name: 'Sahil',
          role: 'admin',
          mode: 'simple',
          language: 'en',
        });
      if (url.includes('/catalogue/search'))
        return jsonResponse({ query: 'x', songs: [], artists: [], albums: [], cached: false });
      if (url.includes('/requests/')) return jsonResponse(request);
      if (url.includes('/collection/'))
        return jsonResponse({
          id: 3,
          profile: 'u1',
          item: 'jf1',
          kind: 'track',
          title: 'T',
          artist: 'A',
          addedBy: 'u1',
          addedAt: '2026-11-17T00:00:00.000Z',
          source: 'add',
        });
      if (url.includes('/collection')) return jsonResponse([]);
      if (url.includes('/rules'))
        return jsonResponse(
          url.endsWith('/rules') && init.method === 'GET'
            ? []
            : {
                id: 1,
                profile: 'u1',
                text: 'no live versions',
                createdAt: '2026-11-17T00:00:00.000Z',
              },
        );
      if (url.includes('/budget'))
        return jsonResponse({
          model: 'claude-opus-5-5',
          month: '2026-11',
          capUsd: 10,
          spentUsd: 0,
          remainingUsd: 10,
          off: false,
          days: [],
        });
      if (url.endsWith('/ask')) return jsonResponse(answer);
      return jsonResponse([]);
    });
    const hub = createHubClient({
      url: 'http://hub.test',
      token: 't',
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect((await hub.me()).name).toBe('Sahil');
    expect((await hub.catalogueSearch('x')).songs).toEqual([]);
    expect((await hub.request(request.id)).id).toBe(request.id);
    expect((await hub.cancelRequest(request.id)).id).toBe(request.id);
    expect(await hub.collection()).toEqual([]);
    expect(await hub.rules()).toEqual([]);
    expect((await hub.addRule('no live versions')).id).toBe(1);
    expect((await hub.deleteRule(1)).id).toBe(1);
    expect((await hub.budget()).capUsd).toBe(10);
    expect((await hub.ask({ text: 'hi' })).model).toBe('off');
    await expect(hub.removeFromCollection(3)).resolves.toBeDefined();
  });

  it('streams /ask: instant first, then the answer', async () => {
    const instant = {
      tracks: [{ id: 't1', kind: 'track', title: 'Fireman' }],
      albums: [],
      artists: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          `event: instant\ndata: ${JSON.stringify(instant)}\n\n`,
          `event: answer\ndata: ${JSON.stringify(answer)}\n\n`,
        ]),
      );
    const hub = createHubClient({ url: 'http://hub.test', token: 't', fetch: fetchMock });
    const seen: unknown[] = [];
    const result = await hub.askStreaming({ text: 'fireman' }, (i) => seen.push(i));
    expect(seen).toEqual([instant]);
    expect(result.model).toBe('off');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://hub.test/ask?stream=1');
  });

  it('fails a stream that ends without an answer or with an error status', async () => {
    const hub = createHubClient({
      url: 'http://hub.test',
      fetch: vi.fn().mockResolvedValue(sseResponse([])),
    });
    await expect(hub.askStreaming({ text: 'x' }, () => {})).rejects.toMatchObject({
      code: 'stream_ended',
    });
    const bad = createHubClient({
      url: 'http://hub.test',
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    });
    await expect(bad.askStreaming({ text: 'x' }, () => {})).rejects.toMatchObject({ status: 401 });
  });

  it('subscribes to /events and stops on abort', async () => {
    const event = { type: 'ready', request };
    let abortSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      abortSignal = init.signal ?? undefined;
      return sseResponse([
        `event: ready\ndata: ${JSON.stringify(event)}\n\n`,
        'data: not json at all\n\n'.replace('not json at all', '{"type":"bogus"}'),
      ]);
    });
    const hub = createHubClient({
      url: 'http://hub.test',
      token: 't',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const got: unknown[] = [];
    await new Promise<void>((resolve) => {
      const stop = hub.events((e) => {
        got.push(e);
        stop();
        resolve();
      }, 'house');
    });
    expect(got).toEqual([event]);
    expect(abortSignal?.aborted).toBe(true);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://hub.test/events?scope=house',
    );
  });

  it('reports stream errors unless aborted', async () => {
    const hub = createHubClient({
      url: 'http://hub.test',
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    });
    const error = await new Promise<unknown>((resolve) => hub.events(() => {}, 'mine', resolve));
    expect(error).toBeInstanceOf(HubClientError);
  });
});
