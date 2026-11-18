/**
 * The signed-in session (F1, F2, F86): one Jellyfin user per household member. The adapter instance
 * lives here; the token lives in the vault (F5). `restoreSession` runs once at startup so a reload
 * comes back signed in without asking.
 */
import { JellyfinAdapter, ServerError, createStore } from '@renaissance/core';
import type { Credentials, Server, Session } from '@renaissance/core';

import { clearSession, loadSession, saveSession } from './vault';
import type { VaultMode } from './vault';

declare const __APP_VERSION__: string;

const DEVICE_KEY = 'renaissance.deviceId';

export interface SessionState {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  adapter: JellyfinAdapter | null;
  vault: VaultMode | null;
  /**
   * Why the app is signed out: `expired` when the server answered 401 to this token (a password
   * change, the device removed in Jellyfin, a sign-out from another tab); the sign-in screen says so.
   */
  reason: 'expired' | null;
}

const signedOut = (reason: SessionState['reason'] = null): SessionState => ({
  status: 'signedOut',
  session: null,
  adapter: null,
  vault: null,
  reason,
});

export const sessionStore = createStore<SessionState>({
  status: 'loading',
  session: null,
  adapter: null,
  vault: null,
  reason: null,
});

function deviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return 'renaissance-web';
  }
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua)
    ? 'Firefox'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Mac/.test(navigator.platform)
    ? 'Mac'
    : /Win/.test(navigator.platform)
      ? 'Windows'
      : /Linux/.test(navigator.platform)
        ? 'Linux'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Android/.test(ua)
            ? 'Android'
            : '';
  return [browser, os].filter(Boolean).join(' on ');
}

/**
 * The adapter for a server. `onUnauthorized` fires when a request that carried this session's token
 * is answered 401: the token was revoked, so the session is over (F1, F86). Sign-in attempts carry no
 * token and a wrong password stays a wrong password.
 */
export function createAdapter(server: Server, onUnauthorized?: () => void): JellyfinAdapter {
  return new JellyfinAdapter(server, {
    deviceName: deviceName(),
    deviceId: deviceId(),
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (response.status === 401 && onUnauthorized && carriesToken(init)) onUnauthorized();
      return response;
    },
    ...(typeof WebSocket === 'undefined' ? {} : { WebSocket }),
  });
}

function carriesToken(init: RequestInit | undefined): boolean {
  const headers = init?.headers;
  const value =
    headers instanceof Headers
      ? headers.get('Authorization')
      : Array.isArray(headers)
        ? headers.find(([k]) => k.toLowerCase() === 'authorization')?.[1]
        : (headers as Record<string, string> | undefined)?.['Authorization'];
  return !!value && /\bToken="/.test(value);
}

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

/** The server revoked this token: forget it and show the sign-in screen with a sentence. */
export function expireSession(): void {
  const { status, session } = sessionStore.get();
  if (status !== 'signedIn' || !session) return;
  sessionStore.set(signedOut('expired'));
  void clearSession().catch(() => undefined);
}

/** Adopt a session that just signed in: an adapter that watches for 401, the token in the vault. */
async function adopt(server: Server, session: Session): Promise<void> {
  const adapter = createAdapter(server, expireSession);
  const vault = await saveSession(session).catch<VaultMode>(() => 'none');
  sessionStore.set({ status: 'signedIn', session, adapter, vault, reason: null });
}

export async function signIn(server: Server, credentials: Credentials): Promise<Session> {
  const session = await createAdapter(server).signIn(credentials);
  await adopt(server, session);
  return session;
}

export async function signInWithQuickConnect(server: Server, secret: string): Promise<Session> {
  const session = await createAdapter(server).quickConnect.authenticate(secret);
  await adopt(server, session);
  return session;
}

/** The user chose to sign out: revoke the token on the server and forget it here. */
export async function signOut(): Promise<void> {
  const { adapter, session } = sessionStore.get();
  sessionStore.set(signedOut());
  await clearSession().catch(() => undefined);
  if (adapter && session) await adapter.signOut(session).catch(() => undefined);
}

let restoring: Promise<void> | null = null;

/**
 * Read the vault once; the store is `loading` until then so screens do not flash signed out. The
 * restored token is checked with one `/Users/Me`: a 401 means it was revoked while the app was
 * closed, and the sign-in screen says so. A server that is down keeps the session, so the cache works.
 */
export function restoreSession(): Promise<void> {
  restoring ??= loadSession()
    .then(async (stored) => {
      if (!stored) {
        sessionStore.set(signedOut());
        return;
      }
      const adapter = createAdapter(stored.session.server, expireSession);
      sessionStore.set({
        status: 'signedIn',
        session: stored.session,
        adapter,
        vault: stored.mode,
        reason: null,
      });
      try {
        await adapter.me(stored.session);
      } catch (error) {
        if (error instanceof ServerError && (error.status === 401 || error.status === 403)) {
          expireSession();
        }
      }
    })
    .catch(() => {
      sessionStore.set(signedOut());
    });
  return restoring;
}

/** For tests: forget the restore so the next call reads the vault again. */
export function resetSessionForTests(): void {
  restoring = null;
  sessionStore.set({ status: 'loading', session: null, adapter: null, vault: null, reason: null });
}
