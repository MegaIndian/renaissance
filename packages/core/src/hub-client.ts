/**
 * hubClient: how the apps talk to the hub (ADR 0007 point 4). The apps send the Jellyfin token
 * they already hold; the hub turns it into a profile. Every answer is validated against the shapes
 * in `hub.ts`, so a hub of another version fails loudly instead of rendering nonsense.
 */
import type { z } from 'zod';

import { AlreadyHere, AlreadyRequested, CatalogueSearch, HubEvent, MusicRequest } from './hub';
import type { HubEvent as HubEventT, NewRequest } from './hub';
import { trimTrailingSlashes } from './url';

export interface HubClientOptions {
  /** The hub's base URL, for example `http://localhost:8787`. */
  url: string;
  /** The caller's Jellyfin access token; absent means unauthenticated calls only. */
  token?: string;
  fetch?: typeof fetch;
}

export class HubError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? `${code} (${status})`);
    this.name = 'HubError';
    this.status = status;
    this.code = code;
  }
}

/** Splits one `text/event-stream` chunk stream into parsed events; exported for tests. */
export function parseSseChunk(buffer: string): {
  events: { event: string; data: string }[];
  rest: string;
} {
  const events: { event: string; data: string }[] = [];
  let rest = buffer;
  let index = rest.indexOf('\n\n');
  while (index !== -1) {
    const block = rest.slice(0, index);
    rest = rest.slice(index + 2);
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0) events.push({ event, data: data.join('\n') });
    index = rest.indexOf('\n\n');
  }
  return { events, rest };
}

export function createHubClient(options: HubClientOptions) {
  const base = trimTrailingSlashes(options.url);
  const doFetch = options.fetch ?? fetch;

  function headers(json = false): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json' };
    if (json) h['content-type'] = 'application/json';
    if (options.token) h.authorization = `Bearer ${options.token}`;
    return h;
  }

  async function call<T>(
    schema: z.ZodType<T>,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const init: RequestInit = { method, headers: headers(body !== undefined) };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (signal) init.signal = signal;
    const res = await doFetch(`${base}${path}`, init);
    if (!res.ok) {
      let code = 'http_error';
      let message: string | undefined;
      try {
        const parsed = (await res.json()) as { error?: string; message?: string };
        if (typeof parsed.error === 'string') code = parsed.error;
        if (typeof parsed.message === 'string') message = parsed.message;
      } catch {
        /* a body that is not JSON keeps the generic code */
      }
      throw new HubError(res.status, code, message);
    }
    if (res.status === 204) return schema.parse(undefined);
    return schema.parse(await res.json());
  }

  return {
    url: base,
    /** Typeahead (F61): abortable, so the app drops the answer to letters already replaced. */
    catalogueSearch: (q: string, signal?: AbortSignal, options: { full?: boolean } = {}) =>
      call(
        CatalogueSearch,
        'GET',
        `/catalogue/search?q=${encodeURIComponent(q)}${options.full ? '&full=1' : ''}`,
        undefined,
        signal,
      ),
    /** The caller's own requests and the ones they watch, newest first. */
    requests: () => call(MusicRequest.array(), 'GET', '/requests'),
    request: (id: string) => call(MusicRequest, 'GET', `/requests/${encodeURIComponent(id)}`),
    /** A new request (201), the one already on its way (`alreadyRequested`), or the item already on the server. */
    createRequest: (input: NewRequest) =>
      call(MusicRequest.or(AlreadyHere).or(AlreadyRequested), 'POST', '/requests', input),
    cancelRequest: (id: string) =>
      call(MusicRequest, 'DELETE', `/requests/${encodeURIComponent(id)}`),
    retryRequest: (id: string) =>
      call(MusicRequest, 'POST', `/requests/${encodeURIComponent(id)}/retry`),
    /** `GET /events`: request status changes and "Ready" for the caller. Returns a stop function. */
    events(onEvent: (event: HubEventT) => void, onError?: (error: unknown) => void): () => void {
      const controller = new AbortController();
      void (async () => {
        try {
          const res = await doFetch(`${base}/events`, {
            headers: { ...headers(), accept: 'text/event-stream' },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new HubError(res.status, 'http_error');
          await readSse(res.body, (_event, data) => {
            const parsed = HubEvent.safeParse(JSON.parse(data));
            if (parsed.success) onEvent(parsed.data);
          });
        } catch (error) {
          if (!controller.signal.aborted) onError?.(error);
        }
      })();
      return () => controller.abort();
    },
  };
}

export type HubClient = ReturnType<typeof createHubClient>;

async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;
    for (const e of events) onEvent(e.event, e.data);
  }
}
