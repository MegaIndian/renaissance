import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  TOKEN_CACHE_TTL_MS,
  isAdmin,
  jellyfinAuthenticator,
  staticAuthenticator,
} from '../src/auth/authenticator.js';
import { requireAdmin, requireProfile, tokenFrom } from '../src/auth/plugin.js';
import { fakeFetch, memoryStores, sahil } from './helpers.js';

const user = { Id: 'u-sahil', Name: 'Sahil', IsAdministrator: true };

describe('isAdmin', () => {
  it('uses the list when given, else Jellyfin administrators', () => {
    expect(isAdmin(user, [])).toBe(true);
    expect(isAdmin({ ...user, IsAdministrator: false }, [])).toBe(false);
    expect(isAdmin({ ...user, IsAdministrator: false }, ['sahil'])).toBe(true);
    expect(isAdmin({ ...user, IsAdministrator: false }, ['U-SAHIL'])).toBe(true);
    expect(isAdmin(user, ['kevin'])).toBe(false);
  });
});

describe('jellyfinAuthenticator', () => {
  it('asks Jellyfin once per token, caches, and never stores the token', async () => {
    const stores = memoryStores();
    const { fetch, calls } = fakeFetch({
      '/Users/Me': (_u, init) =>
        (init.headers as Record<string, string>)['x-emby-token'] === 'good'
          ? { Id: user.Id, Name: user.Name, Policy: { IsAdministrator: true } }
          : { __status: 401 },
    });
    const auth = jellyfinAuthenticator({
      url: 'http://jf.test',
      admins: [],
      profiles: stores.profiles,
      cache: stores.cache,
      fetch,
    });
    expect(auth.configured).toBe(true);
    const profile = await auth.authenticate('good');
    expect(profile).toMatchObject({ id: 'u-sahil', name: 'Sahil', role: 'admin' });
    await auth.authenticate('good');
    expect(calls).toHaveLength(1);
    expect(await auth.authenticate('bad')).toBeNull();
    expect(await auth.authenticate('bad')).toBeNull();
    expect(calls).toHaveLength(2);
    const rows = stores.db.prepare('SELECT key, value FROM cache').all() as unknown as {
      key: string;
      value: string;
    }[];
    expect(JSON.stringify(rows)).not.toContain('good');
    expect(TOKEN_CACHE_TTL_MS).toBe(300_000);
  });

  it('is unconfigured without a URL', async () => {
    const stores = memoryStores();
    const auth = jellyfinAuthenticator({
      url: undefined,
      admins: [],
      profiles: stores.profiles,
      cache: stores.cache,
    });
    expect(auth.configured).toBe(false);
    expect(await auth.authenticate('x')).toBeNull();
  });
});

describe('tokenFrom and guards', () => {
  it('reads bearer, MediaBrowser, X-Emby-Token and (when allowed) the query', async () => {
    const app = Fastify();
    app.get('/t', async (request) => ({
      header: tokenFrom(request),
      query: tokenFrom(request, true),
    }));
    expect(
      (await app.inject({ url: '/t', headers: { authorization: 'Bearer abc' } })).json(),
    ).toEqual({ header: 'abc', query: 'abc' });
    expect(
      (
        await app.inject({
          url: '/t',
          headers: { authorization: 'MediaBrowser Client="x", Token="tok"' },
        })
      ).json().header,
    ).toBe('tok');
    expect(
      (await app.inject({ url: '/t', headers: { 'x-emby-token': 'emby' } })).json().header,
    ).toBe('emby');
    expect((await app.inject({ url: '/t?token=q' })).json()).toEqual({ header: null, query: 'q' });
    expect((await app.inject({ url: '/t' })).json()).toEqual({ header: null, query: null });
    expect(
      (await app.inject({ url: '/t', headers: { authorization: 'Basic abc' } })).json().header,
    ).toBeNull();
    expect(
      (await app.inject({ url: '/t', headers: { authorization: 'Bearer' } })).json().header,
    ).toBeNull();
    expect(
      (
        await app.inject({ url: '/t', headers: { authorization: `Bearer ${'a'.repeat(2000)}` } })
      ).json().header,
    ).toBeNull();
    expect(
      (
        await app.inject({
          url: '/t',
          headers: { authorization: 'mediabrowser Client="x", Token="' },
        })
      ).json().header,
    ).toBe('Client="x", Token="');
    await app.close();
  });

  it('answers 503 unconfigured, 401 bad token, 403 non-admin', async () => {
    const stores = memoryStores();
    const off = jellyfinAuthenticator({
      url: undefined,
      admins: [],
      profiles: stores.profiles,
      cache: stores.cache,
    });
    const app = Fastify();
    app.get('/off', { preHandler: requireProfile(off) }, async () => ({ ok: true }));
    const on = staticAuthenticator({ good: sahil, member: { ...sahil, role: 'member' } });
    app.get('/on', { preHandler: requireProfile(on) }, async (request) => request.profile);
    app.get('/admin', { preHandler: [requireProfile(on), requireAdmin] }, async () => ({
      ok: true,
    }));
    expect(
      (await app.inject({ url: '/off', headers: { authorization: 'Bearer x' } })).statusCode,
    ).toBe(503);
    expect((await app.inject({ url: '/on' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/on', headers: { authorization: 'Bearer nope' } })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: '/on', headers: { authorization: 'Bearer good' } })).json().name,
    ).toBe('Sahil');
    expect(
      (await app.inject({ url: '/admin', headers: { authorization: 'Bearer member' } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/admin', headers: { authorization: 'Bearer good' } })).statusCode,
    ).toBe(200);
    await app.close();
  });
});

describe('token cache shape and peek', () => {
  it('keeps id, name and the admin flag only, and peeks without calling Jellyfin', async () => {
    const stores = memoryStores();
    const { fetch, calls } = fakeFetch({
      '/Users/Me': () => ({
        ...user,
        Policy: { IsAdministrator: true, EnableAllFolders: true },
        Configuration: { AudioLanguagePreference: 'en' },
      }),
    });
    const auth = jellyfinAuthenticator({
      url: 'http://jf.test',
      admins: [],
      profiles: stores.profiles,
      cache: stores.cache,
      fetch,
    });
    expect(auth.peek('good')).toBeNull();
    expect(calls).toHaveLength(0);
    await auth.authenticate('good');
    expect(auth.peek('good')).toMatchObject({ id: 'u-sahil', role: 'admin' });
    expect(calls).toHaveLength(1);
    const rows = stores.db.prepare('SELECT value FROM cache').all() as unknown as {
      value: string;
    }[];
    expect(JSON.parse(rows[0]!.value)).toEqual({
      Id: 'u-sahil',
      Name: 'Sahil',
      IsAdministrator: true,
    });
    const off = jellyfinAuthenticator({
      url: undefined,
      admins: [],
      profiles: stores.profiles,
      cache: stores.cache,
    });
    expect(off.peek('good')).toBeNull();
  });
});
