/**
 * One fetch wrapper for every integration: timeouts, JSON parsing, and errors that carry the
 * status but never the URL's query string or a header (a key could be in either).
 */
export class HttpError extends Error {
  readonly status: number;
  readonly service: string;
  constructor(service: string, status: number, message?: string) {
    super(message ?? `${service} answered ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.service = service;
  }
}

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Accept these statuses without throwing; the body is still parsed. */
  okStatuses?: number[];
}

export interface HttpResponse<T> {
  status: number;
  body: T;
}

export type Fetch = typeof fetch;

export async function httpJson<T = unknown>(
  service: string,
  url: string,
  options: HttpOptions = {},
  doFetch: Fetch = fetch,
): Promise<HttpResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      signal: controller.signal,
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const res = await doFetch(url, init);
    if (!res.ok && !(options.okStatuses ?? []).includes(res.status)) {
      // The path names the call; the query string (which may carry a token) is never included.
      throw new HttpError(
        service,
        res.status,
        `${service} answered ${res.status} on ${new URL(url).pathname}`,
      );
    }
    const text = await res.text();
    const body = (text.length > 0 ? JSON.parse(text) : undefined) as T;
    return { status: res.status, body };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(service, 0, `${service} did not answer in time`);
    }
    const cause = error instanceof Error ? error.message : String(error);
    throw new HttpError(service, 0, `${service} unreachable: ${cause}`);
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
