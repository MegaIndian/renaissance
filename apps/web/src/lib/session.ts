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
}

export const sessionStore = createStore<SessionState>({
  status: 'loading',
  session: null,
  adapter: null,
  vault: null,
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

export function createAdapter(server: Server): JellyfinAdapter {
  return new JellyfinAdapter(server, {
    deviceName: deviceName(),
    deviceId: deviceId(),
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
    fetch: (input, init) => fetch(input, init),
    ...(typeof WebSocket === 'undefined' ? {} : { WebSocket }),
  });
}

/** Turn what the user typed into a Server, or null when it is not an address. */
export function serverFromAddress(address: string): Server | null {
  let text = address.trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const base = `${url.origin}${url.pathname}`;
  return { id: url.host, kind: 'jellyfin', name: url.hostname, url: base.replace(/\/+$/, '') };
}

export type SignInFailure = 'address' | 'credentials' | 'unreachable' | { status: number };

export function classifySignInError(error: unknown): SignInFailure {
  if (error instanceof ServerError) {
    if (error.status === 401 || error.status === 403) return 'credentials';
    return { status: error.status };
  }
  return 'unreachable';
}

async function adopt(adapter: JellyfinAdapter, session: Session): Promise<void> {
  const vault = await saveSession(session).catch<VaultMode>(() => 'plain');
  sessionStore.set({ status: 'signedIn', session, adapter, vault });
}

export async function signIn(server: Server, credentials: Credentials): Promise<Session> {
  const adapter = createAdapter(server);
  const session = await adapter.signIn(credentials);
  await adopt(adapter, session);
  return session;
}

export async function signInWithQuickConnect(server: Server, secret: string): Promise<Session> {
  const adapter = createAdapter(server);
  const session = await adapter.quickConnect.authenticate(secret);
  await adopt(adapter, session);
  return session;
}

export async function signOut(): Promise<void> {
  const { adapter, session } = sessionStore.get();
  sessionStore.set({ status: 'signedOut', session: null, adapter: null, vault: null });
  await clearSession().catch(() => undefined);
  if (adapter && session) await adapter.signOut(session).catch(() => undefined);
}

let restoring: Promise<void> | null = null;

/** Read the vault once; the store is `loading` until then so screens do not flash signed out. */
export function restoreSession(): Promise<void> {
  restoring ??= loadSession()
    .then((stored) => {
      if (!stored) {
        sessionStore.set({ status: 'signedOut', session: null, adapter: null, vault: null });
        return;
      }
      sessionStore.set({
        status: 'signedIn',
        session: stored.session,
        adapter: createAdapter(stored.session.server),
        vault: stored.mode,
      });
    })
    .catch(() => {
      sessionStore.set({ status: 'signedOut', session: null, adapter: null, vault: null });
    });
  return restoring;
}

/** For tests: forget the restore so the next call reads the vault again. */
export function resetSessionForTests(): void {
  restoring = null;
  sessionStore.set({ status: 'loading', session: null, adapter: null, vault: null });
}
