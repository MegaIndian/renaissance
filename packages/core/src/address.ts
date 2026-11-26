/**
 * What the user typed into the sign-in screen's address field, and what a failed sign-in means
 * (F1). One reading for every app: no scheme means https first, plain http only as a fallback the
 * screen announces, and a host without a dot, a port or `localhost` is not an address.
 */
import type { Server } from './models';
import { ServerError } from './adapters/jellyfin';

/** Does the typed address name a scheme? Without one, https is tried first (ADR 0008). */
export function addressHasScheme(address: string): boolean {
  return /^https?:\/\//i.test(address.trim());
}

/**
 * Turn what the user typed into a Server, or null when it is not an address. No scheme means
 * `https://`; the sign-in screen falls back to http only when https does not answer at all, and says
 * so first. A host with spaces, or without a dot, a port or `localhost`, is not an address.
 */
export function serverFromAddress(
  address: string,
  scheme: 'https' | 'http' = 'https',
): Server | null {
  let text = address.trim();
  if (!text) return null;
  if (/\s/.test(text)) return null;
  if (!addressHasScheme(text)) text = `${scheme}://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname;
  const plausible =
    host === 'localhost' || host.includes('.') || host.includes(':') || url.port !== '';
  if (!plausible) return null;
  const base = `${url.origin}${url.pathname}`;
  return { id: url.host, kind: 'jellyfin', name: url.hostname, url: base.replace(/\/+$/, '') };
}

/** The same address on plain http, for the fallback when https does not answer. */
export function withHttp(server: Server): Server {
  const url = server.url.replace(/^https:/i, 'http:');
  return { ...server, id: server.id, url };
}

/** True when signing in to this server would send the password and token in clear text. */
export function isPlainHttp(server: Server): boolean {
  return (
    /^http:/i.test(server.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(server.url)
  );
}

export type SignInFailure = 'address' | 'credentials' | 'unreachable' | { status: number };

export function classifySignInError(error: unknown): SignInFailure {
  if (error instanceof ServerError) {
    if (error.status === 401 || error.status === 403) return 'credentials';
    return { status: error.status };
  }
  return 'unreachable';
}

/** Did this request carry a session token (as opposed to a sign-in, which carries none)? */
export function carriesToken(init: RequestInit | undefined): boolean {
  const headers = init?.headers;
  const value =
    headers instanceof Headers
      ? headers.get('Authorization')
      : Array.isArray(headers)
        ? headers.find(([k]) => k?.toLowerCase() === 'authorization')?.[1]
        : (headers as Record<string, string> | undefined)?.['Authorization'];
  return !!value && /\bToken="/.test(value);
}
