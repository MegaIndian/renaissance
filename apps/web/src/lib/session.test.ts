import { ServerError } from '@renaissance/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { session } from '../test/fakes';
import { startApp } from './app';
import { dbName } from './library';
import {
  createAdapter,
  expireSession,
  followOtherTabs,
  isPlainHttp,
  resetSessionForTests,
  restoreSession,
  serverFromAddress,
  sessionKey,
  sessionStore,
  signOut,
  withHttp,
} from './session';
import { clearSession, saveSession } from './vault';

/** A fetch that answers every request with one status and records the Authorization header. */
function answering(status: number, body = '{}') {
  const auths: string[] = [];
  const impl: typeof fetch = (_input, init) => {
    const headers = init?.headers as Record<string, string>;
    auths.push(headers['Authorization'] ?? '');
    return Promise.resolve(
      new Response(body, { status, headers: { 'content-type': 'application/json' } }),
    );
  };
  return { impl, auths };
}

describe('serverFromAddress', () => {
  it('defaults to https, keeps a typed scheme, and refuses what is not an address', () => {
    expect(serverFromAddress('music.example.com')?.url).toBe('https://music.example.com');
    expect(serverFromAddress('music.example.com', 'http')?.url).toBe('http://music.example.com');
    expect(serverFromAddress('http://192.168.1.5:8096/')?.url).toBe('http://192.168.1.5:8096');
    expect(serverFromAddress('HTTPS://Music.Example.com/jellyfin/')?.url).toBe(
      'https://music.example.com/jellyfin',
    );
    expect(serverFromAddress('localhost:8096')?.url).toBe('https://localhost:8096');
    expect(serverFromAddress('not an address')).toBeNull();
    expect(serverFromAddress('nodot')).toBeNull();
    expect(serverFromAddress('ftp://music.example.com')).toBeNull();
    expect(serverFromAddress('   ')).toBeNull();
    expect(withHttp(serverFromAddress('music.example.com')!).url).toBe('http://music.example.com');
    expect(isPlainHttp(serverFromAddress('http://music.example.com')!)).toBe(true);
    expect(isPlainHttp(serverFromAddress('http://localhost:8096')!)).toBe(false);
    expect(isPlainHttp(serverFromAddress('https://music.example.com')!)).toBe(false);
  });
});

describe('a revoked token', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearSession();
    resetSessionForTests();
  });

  it('any 401 to a request that carried the token signs the app out with the expired reason; a sign-in 401 does not', async () => {
    const { impl } = answering(401);
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
    const expired = vi.fn();
    const adapter = createAdapter(session.server, expired);
    sessionStore.set({ status: 'signedIn', session, adapter, vault: 'encrypted', reason: null });
    await expect(adapter.signIn({ userName: 'a', password: 'b' })).rejects.toBeInstanceOf(
      ServerError,
    );
    expect(expired).not.toHaveBeenCalled();
    await expect(adapter.favorites.set(session, 't1', true)).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    expireSession();
    expect(sessionStore.get()).toMatchObject({ status: 'signedOut', reason: 'expired' });
    // Expiring twice, or while signed out, changes nothing.
    expireSession();
    expect(sessionStore.get().reason).toBe('expired');
  });

  it('a 401 seen by an adapter that is no longer the current one is ignored (the next user stays signed in)', async () => {
    const { impl } = answering(401);
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
    const expired = vi.fn();
    // User A's adapter, still paging a sync after A signed out; user B is signed in now.
    const previous = createAdapter(session.server, expired);
    const current = createAdapter(session.server, expired);
    const b = { ...session, userId: 'u2', userName: 'B', token: 'tok-b' };
    sessionStore.set({
      status: 'signedIn',
      session: b,
      adapter: current,
      vault: 'encrypted',
      reason: null,
    });
    await expect(previous.favorites.set(session, 't1', true)).rejects.toMatchObject({
      status: 401,
    });
    expect(expired).not.toHaveBeenCalled();
    expect(sessionStore.get().status).toBe('signedIn');
    await expect(current.favorites.set(b, 't1', true)).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
  });

  it('restore checks the token once with /Users/Me: 401 expires it, a server that is down keeps it', async () => {
    await saveSession(session);
    const { impl, auths } = answering(401);
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
    resetSessionForTests();
    await restoreSession();
    expect(sessionStore.get()).toMatchObject({ status: 'signedOut', reason: 'expired' });
    expect(spy.mock.calls.map((c) => new URL(String(c[0])).pathname)).toEqual(['/Users/Me']);
    expect(auths[0]).toContain('Token="tok"');
    // The vault was cleared: a second restore finds nothing.
    resetSessionForTests();
    await restoreSession();
    expect(sessionStore.get()).toMatchObject({ status: 'signedOut', reason: null });

    await saveSession(session);
    spy.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
    resetSessionForTests();
    await restoreSession();
    expect(sessionStore.get()).toMatchObject({ status: 'signedIn', vault: 'encrypted' });
    expect(sessionStore.get().session?.token).toBe('tok');
  });
});

describe('sign-out', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearSession();
    resetSessionForTests();
    localStorage.clear();
  });

  it("a chosen sign-out deletes this user's library database and saved queue; an expiry keeps them", async () => {
    const { impl } = answering(204, '');
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
    const queryClient = { clear: vi.fn() };
    startApp(queryClient as never);
    // The app's own restore (an empty vault) settles first, so it cannot race the sign-in below.
    await restoreSession();
    const name = dbName(session);
    const open = () =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => {
          request.transaction?.abort();
          resolve(false);
        };
        request.onsuccess = () => {
          request.result.close();
          resolve(true);
        };
        request.onerror = () => resolve(false);
      });
    localStorage.setItem(`renaissance.queue.${session.userId}`, '{}');
    const adapter = createAdapter(session.server);
    sessionStore.set({ status: 'signedIn', session, adapter, vault: 'encrypted', reason: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(await open()).toBe(true);
    expireSession();
    await new Promise((r) => setTimeout(r, 20));
    expect(localStorage.getItem(`renaissance.queue.${session.userId}`)).toBe('{}');
    expect(await open()).toBe(true);

    sessionStore.set({ status: 'signedIn', session, adapter, vault: 'encrypted', reason: null });
    await new Promise((r) => setTimeout(r, 20));
    await signOut();
    await new Promise((r) => setTimeout(r, 50));
    expect(localStorage.getItem(`renaissance.queue.${session.userId}`)).toBeNull();
    expect(await open()).toBe(false);
    expect(queryClient.clear).toHaveBeenCalled();
  });
});

describe('other tabs', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearSession();
    resetSessionForTests();
  });

  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('a sign-out posted by another tab ends the same user here with its reason; sign-out and expiry post it', async () => {
    const { impl } = answering(204, '');
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
    const stop = followOtherTabs();
    const otherTab = new BroadcastChannel('renaissance-session');
    const heard: unknown[] = [];
    otherTab.onmessage = (event: MessageEvent<unknown>) => heard.push(event.data);
    try {
      const adapter = createAdapter(session.server);
      const signedIn = {
        status: 'signedIn',
        session,
        adapter,
        vault: 'encrypted',
        reason: null,
      } as const;
      sessionStore.set(signedIn);
      // Another user's sign-out, and a message that is not one, change nothing.
      otherTab.postMessage({ type: 'signed-out', key: 'demo:someone-else', reason: null });
      otherTab.postMessage('renaissance-library-demo-u1');
      await settle();
      expect(sessionStore.get().status).toBe('signedIn');
      otherTab.postMessage({ type: 'signed-out', key: sessionKey(session), reason: 'expired' });
      await settle();
      expect(sessionStore.get()).toMatchObject({ status: 'signedOut', reason: 'expired' });
      sessionStore.set(signedIn);
      otherTab.postMessage({ type: 'signed-out', key: sessionKey(session), reason: null });
      await settle();
      expect(sessionStore.get()).toMatchObject({ status: 'signedOut', reason: null });

      // This tab's own sign-out and expiry tell the others.
      sessionStore.set(signedIn);
      await signOut();
      sessionStore.set(signedIn);
      expireSession();
      await settle();
      expect(heard).toEqual([
        { type: 'signed-out', key: 'demo:u1', reason: null },
        { type: 'signed-out', key: 'demo:u1', reason: 'expired' },
      ]);
    } finally {
      stop();
      otherTab.close();
    }
  });
});
