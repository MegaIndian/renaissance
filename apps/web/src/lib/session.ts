/**
 * The signed-in session (F1, F2, F86): one Jellyfin user per household member. The adapter instance
 * lives here; the token lives in the vault (F5). `restoreSession` runs once at startup so a reload
 * comes back signed in without asking.
 */
import { JellyfinAdapter, ServerError, carriesToken, createStore } from '@renaissance/core';
import type { Credentials, Server, Session } from '@renaissance/core';

import { swallow } from './log';
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
 * token and a wrong password stays a wrong password. Only the adapter the app currently holds may
 * fire it: a sync still paging with the previous user's adapter after a sign-out sees 401s of its
 * own, and those must not sign the next user out.
 */
export function createAdapter(server: Server, onUnauthorized?: () => void): JellyfinAdapter {
  const adapter: JellyfinAdapter = new JellyfinAdapter(server, {
    deviceName: deviceName(),
    deviceId: deviceId(),
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (
        response.status === 401 &&
        onUnauthorized &&
        carriesToken(init) &&
        sessionStore.get().adapter === adapter
      ) {
        onUnauthorized();
      }
      return response;
    },
    ...(typeof WebSocket === 'undefined' ? {} : { WebSocket }),
  });
  return adapter;
}

export {
  addressHasScheme,
  classifySignInError,
  isPlainHttp,
  serverFromAddress,
  withHttp,
} from '@renaissance/core';
export type { SignInFailure } from '@renaissance/core';

const CHANNEL = 'renaissance-session';

/** What one tab tells the others when a session ends; `key` names the user so a later sign-in is untouched. */
interface SignedOutMessage {
  type: 'signed-out';
  key: string;
  reason: SessionState['reason'];
}

export function sessionKey(session: Session): string {
  return `${session.server.id}:${session.userId}`;
}

function channel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
}

/** Tell the other tabs of this browser that this user's session ended, and why. */
function broadcastSignedOut(session: Session, reason: SessionState['reason']): void {
  const bc = channel();
  if (!bc) return;
  const message: SignedOutMessage = { type: 'signed-out', key: sessionKey(session), reason };
  bc.postMessage(message);
  bc.close();
}

/**
 * Follow sign-outs from the other tabs of this browser: the vault is shared and the token revoked,
 * so a tab still showing that user would otherwise sit "signed in" until its next request fails and
 * keep reconnecting its websocket with a dead key. Returns the unsubscribe.
 */
export function followOtherTabs(): () => void {
  const bc = channel();
  if (!bc) return () => undefined;
  bc.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<SignedOutMessage> | null;
    if (!data || data.type !== 'signed-out' || typeof data.key !== 'string') return;
    const { status, session } = sessionStore.get();
    if (status !== 'signedIn' || !session || sessionKey(session) !== data.key) return;
    // The other tab already cleared the vault and told the server; this tab only follows.
    sessionStore.set(signedOut(data.reason === 'expired' ? 'expired' : null));
  };
  return () => bc.close();
}

/** The server revoked this token: forget it and show the sign-in screen with a sentence. */
export function expireSession(): void {
  const { status, session } = sessionStore.get();
  if (status !== 'signedIn' || !session) return;
  sessionStore.set(signedOut('expired'));
  void clearSession().catch(swallow('vault clear failed'));
  broadcastSignedOut(session, 'expired');
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

/** The user chose to sign out: revoke the token on the server and forget it here and in the other tabs. */
export async function signOut(): Promise<void> {
  const { adapter, session } = sessionStore.get();
  sessionStore.set(signedOut());
  await clearSession().catch(swallow('vault clear failed'));
  if (session) broadcastSignedOut(session, null);
  if (adapter && session) await adapter.signOut(session).catch(swallow('server sign-out failed'));
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
