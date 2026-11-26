import { describe, expect, it, vi } from 'vitest';

import { HubEvent, splitTitleVersion } from '../src/hub';

import { HubClientError, createHubClient, parseSseChunk } from '../src/index';
import type { MusicRequest } from '../src/index';

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
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('/catalogue/')
            ? jsonResponse({ query: 'fire man', songs: [], artists: [], albums: [], cached: false })
            : jsonResponse([request]),
        ),
      );
    const hub = createHubClient({ url: 'http://hub.test/', token: 'tok', fetch: fetchMock });
    expect(hub.url).toBe('http://hub.test');
    const items = await hub.requests();
    expect(items[0]?.title).toBe('Fireman');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://hub.test/requests');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    await hub.catalogueSearch('fire man', undefined, { full: true });
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe(
      'http://hub.test/catalogue/search?q=fire%20man&full=1',
    );
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
        .mockResolvedValue(
          jsonResponse({ error: 'too_late', message: 'The download has started.' }, 409),
        ),
    });
    await expect(hub.cancelRequest(request.id)).rejects.toMatchObject({
      status: 409,
      code: 'too_late',
      message: 'The download has started.',
    });
    const plain = createHubClient({
      url: 'http://hub.test',
      fetch: vi.fn().mockResolvedValue(new Response('nope', { status: 500 })),
    });
    await expect(plain.requests()).rejects.toBeInstanceOf(HubClientError);
  });

  it('rejects an answer of the wrong shape', async () => {
    const hub = createHubClient({
      url: 'http://hub.test',
      fetch: vi.fn().mockResolvedValue(jsonResponse({ nope: 1 })),
    });
    await expect(hub.request(request.id)).rejects.toThrow();
  });

  it('covers every route helper', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/catalogue/search'))
        return jsonResponse({ query: 'x', songs: [], artists: [], albums: [], cached: false });
      if (url.includes('/requests/')) return jsonResponse(request);
      return jsonResponse([]);
    });
    const hub = createHubClient({
      url: 'http://hub.test',
      token: 't',
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect((await hub.catalogueSearch('x')).songs).toEqual([]);
    expect((await hub.request(request.id)).id).toBe(request.id);
    expect((await hub.cancelRequest(request.id)).id).toBe(request.id);
    expect((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].method).toBe(
      'DELETE',
    );
    expect((await hub.retryRequest(request.id)).id).toBe(request.id);
    const duplicate = vi.fn().mockResolvedValue(jsonResponse({ alreadyRequested: true, request }));
    const again = await createHubClient({ url: 'http://hub.test', fetch: duplicate }).createRequest(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
    );
    expect('alreadyRequested' in again && again.request.id).toBe(request.id);
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
      });
    });
    expect(got).toEqual([event]);
    expect(abortSignal?.aborted).toBe(true);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://hub.test/events');
  });

  it('reports stream errors unless aborted', async () => {
    const hub = createHubClient({
      url: 'http://hub.test',
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    });
    const error = await new Promise<unknown>((resolve) => hub.events(() => {}, resolve));
    expect(error).toBeInstanceOf(HubClientError);
  });
});

describe('round 4: the version in a title and the late catalogue event', () => {
  it('splits the version named in brackets off a title', () => {
    expect(splitTitleVersion('Fireman (Chopped & Screwed)')).toEqual({
      title: 'Fireman',
      version: 'Chopped & Screwed',
    });
    expect(splitTitleVersion("22 (Taylor's Version)")).toEqual({
      title: '22',
      version: "Taylor's Version",
    });
    expect(splitTitleVersion('Fireman [Explicit]')).toEqual({
      title: 'Fireman',
      version: 'Explicit',
    });
    expect(splitTitleVersion('Rolling in the Deep')).toEqual({ title: 'Rolling in the Deep' });
    expect(splitTitleVersion("(Sittin' On) The Dock of the Bay")).toEqual({
      title: "(Sittin' On) The Dock of the Bay",
    });
    expect(splitTitleVersion('(Untitled)')).toEqual({ title: '(Untitled)' });
    expect(splitTitleVersion('Why This Kolaveri Di?: The Soup of Love')).toEqual({
      title: 'Why This Kolaveri Di?: The Soup of Love',
    });
  });

  it('accepts a catalogue event with a full answer', () => {
    const parsed = HubEvent.safeParse({
      type: 'catalogue',
      result: { query: 'halo beyonce', songs: [], artists: [], albums: [], cached: false },
    });
    expect(parsed.success).toBe(true);
    expect(HubEvent.safeParse({ type: 'catalogue' }).success).toBe(false);
  });
});
