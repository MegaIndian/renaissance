import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addressHasScheme,
  carriesToken,
  classifySignInError,
  isPlainHttp,
  serverFromAddress,
  withHttp,
} from '../src/address';
import { ServerError } from '../src/adapters/jellyfin';
import { MemoryLibraryStore } from '../src/library-cache';
import {
  LibraryController,
  PUSH_FETCH_LIMIT,
  REFRESH_INTERVAL_MS,
  RETRY_FIRST_MS,
  applyPatch,
  libraryKey,
} from '../src/library-controller';
import type { LibraryPlatform } from '../src/library-controller';
import type { Album, Track } from '../src/models';
import * as Q from '../src/queue';
import { readSavedQueue, toSavedQueue } from '../src/saved-queue';
import { SessionController, sessionKey } from '../src/session-controller';
import type { SessionVault } from '../src/session-controller';
import type {
  Library,
  Page,
  PageRequest,
  ServerAdapter,
  ServerEvents,
  Session,
} from '../src/server-adapter';
import { album, artist, playlist, server, session, track } from './fixtures';

describe('address', () => {
  it('reads an address with or without a scheme', () => {
    expect(addressHasScheme(' http://a.b ')).toBe(true);
    expect(addressHasScheme('a.b')).toBe(false);
    expect(serverFromAddress('music.example.com/jf/')).toEqual({
      id: 'music.example.com',
      kind: 'jellyfin',
      name: 'music.example.com',
      url: 'https://music.example.com/jf',
    });
    expect(serverFromAddress('10.0.0.2:8096', 'http')?.url).toBe('http://10.0.0.2:8096');
    expect(serverFromAddress('localhost')?.url).toBe('https://localhost');
  });

  it('refuses what is not an address', () => {
    for (const text of ['', '  ', 'two words.com', 'jellyfin', 'ftp://a.b', 'http://']) {
      expect(serverFromAddress(text)).toBeNull();
    }
  });

  it('falls back to http and says when that is clear text', () => {
    const https = serverFromAddress('music.example.com');
    expect(https && isPlainHttp(https)).toBe(false);
    const http = https && withHttp(https);
    expect(http?.url).toBe('http://music.example.com');
    expect(http && isPlainHttp(http)).toBe(true);
    expect(isPlainHttp({ ...server, url: 'http://localhost:8096' })).toBe(false);
    expect(isPlainHttp({ ...server, url: 'http://127.0.0.1' })).toBe(false);
  });

  it('classifies sign-in failures', () => {
    expect(classifySignInError(new ServerError(401, '/x'))).toBe('credentials');
    expect(classifySignInError(new ServerError(403, '/x'))).toBe('credentials');
    expect(classifySignInError(new ServerError(500, '/x'))).toEqual({ status: 500 });
    expect(classifySignInError(new TypeError('network'))).toBe('unreachable');
  });

  it('tells a request with a token from one without', () => {
    const auth = 'MediaBrowser Client="R", Token="abc"';
    expect(carriesToken({ headers: { Authorization: auth } })).toBe(true);
    expect(carriesToken({ headers: new Headers({ Authorization: auth }) })).toBe(true);
    expect(carriesToken({ headers: [['authorization', auth]] })).toBe(true);
    expect(carriesToken({ headers: { Authorization: 'MediaBrowser Client="R"' } })).toBe(false);
    expect(carriesToken(undefined)).toBe(false);
  });
});

describe('saved queue', () => {
  const tracks = [track('a'), track('b'), track('c')];
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const lookup = (id: string) => byId.get(id);

  it('round-trips ids and bookkeeping, with the own position winning', () => {
    const queue = Q.setRepeat(Q.replace(Q.emptyQueue, tracks, 1), 'all');
    const record = JSON.stringify(toSavedQueue('u1', queue, 12));
    const back = readSavedQueue(record, '40', lookup);
    expect(back?.queue.items.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(back?.queue.index).toBe(1);
    expect(back?.queue.repeat).toBe('all');
    expect(back?.position).toBe(40);
    expect(readSavedQueue(record, 'x', lookup)?.position).toBe(12);
    expect(readSavedQueue(record, null, lookup)?.position).toBe(12);
  });

  it('drops songs the library lost; a lost current song restarts at zero on the next', () => {
    const queue = Q.replace(Q.emptyQueue, tracks, 1);
    const record = JSON.stringify(toSavedQueue('u1', queue, 30));
    const back = readSavedQueue(record, null, (id) => (id === 'b' ? undefined : byId.get(id)));
    expect(back?.queue.items.map((t) => t.id)).toEqual(['a', 'c']);
    expect(back?.queue.index).toBe(1);
    expect(back?.position).toBe(0);
    expect(readSavedQueue(record, null, () => undefined)).toBeNull();
  });

  it('reads the legacy shape and refuses garbage', () => {
    const legacy = JSON.stringify({
      userId: 'u1',
      queue: Q.replace(Q.emptyQueue, tracks, 0),
      position: 5,
    });
    expect(readSavedQueue(legacy, null, lookup)?.position).toBe(5);
    expect(readSavedQueue(null, null, lookup)).toBeNull();
    expect(readSavedQueue('{', null, lookup)).toBeNull();
    expect(
      readSavedQueue(JSON.stringify({ version: 2, ids: ['a'], keys: [0] }), null, lookup),
    ).toBeNull();
  });
});

/** A fake server: a library over lists, a push channel the test fires, and call counts. */
function fakeServer(initial: { tracks?: Track[]; albums?: Album[] } = {}) {
  const data = {
    tracks: initial.tracks ?? [track('t1', { dateAdded: '2026-01-01T00:00:00.000Z' })],
    albums: initial.albums ?? [album('al1', { dateAdded: '2026-01-01T00:00:00.000Z' })],
    artists: [artist('a1')],
    playlists: [playlist('p1')],
  };
  let events: ServerEvents = {};
  let fail: Error | null = null;
  let syncs = 0;
  const extra = new Map<string, Track>();
  const page = <T>(list: T[], p: PageRequest = {}): Promise<Page<T>> => {
    if (fail) return Promise.reject(fail);
    const start = p.start ?? 0;
    return Promise.resolve({
      items: list.slice(start, start + (p.limit ?? list.length)),
      total: list.length,
    });
  };
  const library = {
    artists: (p?: PageRequest) => {
      syncs += 1;
      return page(data.artists, p);
    },
    albumArtists: (p?: PageRequest) => page(data.artists, p),
    playlists: (p?: PageRequest) => page(data.playlists, p),
    tracks: (p?: PageRequest) => page(data.tracks, p),
    albums: (p?: PageRequest) => page(data.albums, p),
    userDataChangedSince: (_since: string, p?: PageRequest) => page([] as Track[], p),
    ids: (kind: string) =>
      Promise.resolve((kind === 'track' ? data.tracks : data.albums).map((i) => i.id)),
    byIds: () => Promise.resolve([]),
    musicByIds: vi.fn((ids: readonly string[]) => {
      if (fail) return Promise.reject(fail);
      return Promise.resolve({
        tracks: ids.flatMap((id) => (extra.has(id) ? [extra.get(id) as Track] : [])),
        albums: [],
      });
    }),
  } as unknown as Library & { musicByIds: ReturnType<typeof vi.fn> };
  const adapter = {
    library: () => library,
    subscribe: (_s: Session, e: ServerEvents) => {
      events = e;
      return () => {
        events = {};
      };
    },
  } as unknown as ServerAdapter;
  return {
    adapter,
    library,
    data,
    extra,
    push: () => events,
    setFail: (error: Error | null) => {
      fail = error;
    },
    syncs: () => syncs,
  };
}

function platform(extra: Partial<LibraryPlatform> = {}) {
  const stores = new Map<string, MemoryLibraryStore>();
  const resume = new Set<() => void>();
  const posted: string[] = [];
  const peerListeners = new Map<string, () => void>();
  const p: LibraryPlatform = {
    openStore: (key) => {
      const store = stores.get(key) ?? new MemoryLibraryStore();
      stores.set(key, store);
      return Promise.resolve({ store, persisted: true });
    },
    onResume: (listener) => {
      resume.add(listener);
      return () => resume.delete(listener);
    },
    peers: {
      post: (key) => posted.push(key),
      listen: (key, onChange) => {
        peerListeners.set(key, onChange);
        return () => peerListeners.delete(key);
      },
    },
    ...extra,
  };
  return { p, stores, resume, posted, peerListeners };
}

describe('LibraryController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keys the store per server and user', () => {
    expect(libraryKey({ ...session, server: { ...server, id: 'a b:1' } })).toBe(
      'renaissance-library-a_b_1-u1',
    );
  });

  it('starts, shows the synced snapshot, and stops clean', async () => {
    const s = fakeServer();
    const { p, resume, peerListeners } = platform();
    const c = new LibraryController(p);
    await c.start(s.adapter, session);
    const state = c.state.get();
    expect(state.ready).toBe(true);
    expect(state.sync.status).toBe('idle');
    expect(state.sync.mode).toBe('full');
    expect(state.snapshot.tracks.map((t) => t.id)).toEqual(['t1']);
    expect(state.index.groups('Track', 4).length).toBeGreaterThan(0);
    expect(c.key).toBe(libraryKey(session));
    expect(resume.size).toBe(1);
    expect(peerListeners.size).toBe(1);
    // A second start for the same user is a no-op.
    await c.start(s.adapter, session);
    expect(s.syncs()).toBe(1);
    c.stop();
    expect(c.state.get().ready).toBe(false);
    expect(c.key).toBeNull();
    expect(resume.size).toBe(0);
    expect(peerListeners.size).toBe(0);
    await expect(c.refresh()).resolves.toBeUndefined();
  });

  it('refreshes on resume, on peers, on pushes and on the interval; joins a running sync', async () => {
    const s = fakeServer();
    const { p, resume, peerListeners } = platform();
    const c = new LibraryController(p);
    await c.start(s.adapter, session);
    const first = c.refresh();
    expect(c.refresh()).toBe(first);
    await first;
    expect(s.syncs()).toBe(2);
    for (const l of resume) l();
    await vi.waitFor(() => expect(s.syncs()).toBe(3));
    peerListeners.get(libraryKey(session))?.();
    await vi.advanceTimersByTimeAsync(500);
    expect(s.syncs()).toBe(4);
    s.push().onLibraryChanged?.();
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.syncs()).toBe(5);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(s.syncs()).toBe(6);
    c.stop();
  });

  it('chains a full rebuild asked for during a delta', async () => {
    const s = fakeServer();
    const c = new LibraryController(platform().p);
    await c.start(s.adapter, session);
    const delta = c.refresh();
    const full = c.refresh({ full: true });
    expect(full).not.toBe(delta);
    await full;
    expect(c.state.get().sync.mode).toBe('full');
    c.stop();
  });

  it('says a failed sync and retries with a back-off', async () => {
    const s = fakeServer();
    const c = new LibraryController(platform().p);
    s.setFail(new Error('down'));
    await c.start(s.adapter, session);
    expect(c.state.get().sync).toMatchObject({ status: 'error', error: 'down' });
    expect(c.state.get().ready).toBe(true);
    s.setFail(null);
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
    expect(c.state.get().sync.status).toBe('idle');
    c.stop();
  });

  it('patches at once, writes the store, tells peers, and replays a patch made mid-sync', async () => {
    const s = fakeServer();
    const { p, stores, posted } = platform();
    const c = new LibraryController(p);
    await c.start(s.adapter, session);
    const heart = (item: { id: string; isFavorite: boolean }) =>
      item.id === 't1' ? { ...item, isFavorite: true } : item;
    const running = c.refresh();
    c.patchItems('track', heart as never);
    expect(c.state.get().snapshot.tracks[0]?.isFavorite).toBe(true);
    await running;
    expect(c.state.get().snapshot.tracks[0]?.isFavorite).toBe(true);
    const stored = await stores.get(libraryKey(session))?.read('track');
    expect((stored?.[0] as Track).isFavorite).toBe(true);
    expect(posted.length).toBe(1);
    c.patchItems('track', (item) => item, { broadcast: false });
    c.patchItems('playlist', (item) => (item.id === 'p1' ? null : item));
    expect(c.state.get().snapshot.playlists).toEqual([]);
    c.addItems('playlist', [playlist('p2'), playlist('p2')]);
    c.addItems('playlist', [playlist('p2')]);
    expect(c.state.get().snapshot.playlists.map((x) => x.id)).toEqual(['p2']);
    c.stop();
  });

  it('applies pushed user data, fetches unknown ids, and keeps the ones it could not get', async () => {
    const s = fakeServer();
    s.extra.set('t9', track('t9'));
    const c = new LibraryController(platform().p);
    await c.start(s.adapter, session);
    await c.applyUserDataChanges([]);
    await c.applyUserDataChanges([
      { itemId: 't1', isFavorite: true, playCount: 3, lastPlayed: '2026-02-01T00:00:00.000Z' },
      { itemId: 't9' },
    ]);
    const tracks = c.state.get().snapshot.tracks;
    expect(tracks.find((t) => t.id === 't1')).toMatchObject({ isFavorite: true, playCount: 3 });
    expect(tracks.map((t) => t.id)).toContain('t9');
    s.setFail(new Error('timeout'));
    await c.applyUserDataChanges([{ itemId: 'x1', isFavorite: true }]);
    s.setFail(null);
    s.library.musicByIds.mockClear();
    await c.refresh();
    expect(s.library.musicByIds).toHaveBeenCalledWith(['x1']);
    c.stop();
  });

  it('caps the ids fetched per push', async () => {
    const s = fakeServer();
    const c = new LibraryController(platform().p);
    await c.start(s.adapter, session);
    const many = Array.from({ length: PUSH_FETCH_LIMIT + 5 }, (_, i) => ({ itemId: `n${i}` }));
    await c.applyUserDataChanges(many);
    expect(s.library.musicByIds.mock.calls[0]?.[0]).toHaveLength(PUSH_FETCH_LIMIT);
    c.stop();
  });

  it('a start that lost the race to a stop closes its store and gives up', async () => {
    const s = fakeServer();
    const close = vi.fn(() => Promise.resolve());
    let release: () => void = () => undefined;
    const c = new LibraryController({
      openStore: () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              store: Object.assign(new MemoryLibraryStore(), { close }),
              persisted: false,
            });
        }),
    });
    const starting = c.start(s.adapter, session);
    c.stop();
    release();
    await starting;
    expect(close).toHaveBeenCalled();
    expect(c.key).toBeNull();
  });

  it('applyPatch keeps album artists in step with a patched artist list', () => {
    const snapshot = {
      ...c0(),
      artists: [artist('a1'), artist('a2')],
      albumArtists: [artist('a1')],
    };
    const out = applyPatch(snapshot, 'artist', (item) =>
      item.id === 'a1' ? { ...item, isFavorite: true } : item,
    );
    expect(out.snapshot.albumArtists[0]?.isFavorite).toBe(true);
    expect(applyPatch(snapshot, 'artist', (item) => item).snapshot).toBe(snapshot);
  });
});

function c0() {
  return {
    tracks: [],
    albums: [],
    artists: [],
    albumArtists: [],
    playlists: [],
    genres: [],
    years: [],
    syncedAt: null,
  };
}

describe('SessionController', () => {
  function setup(stored: Session | null = null) {
    let kept: Session | null = stored;
    const vault: SessionVault<'keychain' | 'none'> = {
      load: vi.fn(() =>
        Promise.resolve(kept ? { session: kept, mode: 'keychain' as const } : null),
      ),
      save: vi.fn((s: Session) => {
        kept = s;
        return Promise.resolve('keychain' as const);
      }),
      clear: vi.fn(() => {
        kept = null;
        return Promise.resolve();
      }),
    };
    const ended: [string, string | null][] = [];
    let meStatus = 200;
    const fetchImpl = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: meStatus })),
    );
    const created: { server: string; fetch: typeof fetch }[] = [];
    const makeAdapter = (srv: typeof server, f: typeof fetch) => {
      created.push({ server: srv.url, fetch: f });
      return {
        server: srv,
        signIn: vi.fn(() => Promise.resolve(session)),
        signOut: vi.fn(() => Promise.resolve()),
        me: vi.fn(async (s: Session) => {
          const response = await f('x', {
            headers: { Authorization: `MediaBrowser Token="${s.token}"` },
          });
          if (response.status !== 200) throw new ServerError(response.status, '/Users/Me');
          return { userId: s.userId, userName: s.userName };
        }),
        quickConnect: { authenticate: vi.fn(() => Promise.resolve(session)) },
      } as unknown as ServerAdapter;
    };
    const c = new SessionController({
      vault,
      createAdapter: makeAdapter,
      fetch: fetchImpl as unknown as typeof fetch,
      unsavedMode: 'none',
      onEnded: (s, reason) => ended.push([sessionKey(s), reason]),
    });
    return {
      c,
      vault,
      ended,
      created,
      setMe: (status: number) => {
        meStatus = status;
      },
    };
  }

  it('restores a stored session once, signed out without one', async () => {
    const empty = setup();
    await empty.c.restore();
    expect(empty.c.state.get().status).toBe('signedOut');
    const kept = setup(session);
    expect(kept.c.state.get().status).toBe('loading');
    await Promise.all([kept.c.restore(), kept.c.restore()]);
    expect(kept.vault.load).toHaveBeenCalledTimes(1);
    expect(kept.c.state.get()).toMatchObject({ status: 'signedIn', vault: 'keychain' });
    kept.c.reset();
    expect(kept.c.state.get().status).toBe('loading');
  });

  it('a token revoked while the app was closed lands signed out as expired', async () => {
    const s = setup(session);
    s.setMe(401);
    await s.c.restore();
    expect(s.c.state.get()).toMatchObject({ status: 'signedOut', reason: 'expired' });
    expect(s.vault.clear).toHaveBeenCalled();
    expect(s.ended).toEqual([[sessionKey(session), 'expired']]);
  });

  it('a server that is down keeps the session', async () => {
    const s = setup(session);
    s.setMe(503);
    await s.c.restore();
    expect(s.c.state.get().status).toBe('signedIn');
  });

  it('a vault that cannot be read is signed out', async () => {
    const s = setup();
    (s.vault.load as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('locked'));
    await s.c.restore();
    expect(s.c.state.get().status).toBe('signedOut');
  });

  it('signs in, keeps the token, and only the current adapter can expire it', async () => {
    const s = setup();
    await s.c.signIn(server, { userName: 'demo', password: 'pw' });
    expect(s.vault.save).toHaveBeenCalledWith(session);
    const state = s.c.state.get();
    expect(state.status).toBe('signedIn');
    // A 401 to a request without a token (a sign-in attempt) is not an expiry.
    const watched = s.created.at(-1)?.fetch as typeof fetch;
    s.setMe(401);
    await watched('x', {});
    expect(s.c.state.get().status).toBe('signedIn');
    await watched('x', { headers: { Authorization: 'MediaBrowser Token="t"' } });
    expect(s.c.state.get().reason).toBe('expired');
    s.c.expire();
    expect(s.ended).toHaveLength(1);
  });

  it('Quick Connect adopts the session; a refused vault save still signs in', async () => {
    const s = setup();
    (s.vault.save as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'));
    await s.c.signInWithQuickConnect(server, 'secret');
    expect(s.c.state.get()).toMatchObject({ status: 'signedIn', vault: 'none' });
  });

  it('signs out: forgets the token, tells peers and the server', async () => {
    const s = setup();
    await s.c.signIn(server, { userName: 'demo', password: 'pw' });
    const adapter = s.c.state.get().adapter as unknown as { signOut: ReturnType<typeof vi.fn> };
    await s.c.signOut();
    expect(s.c.state.get()).toMatchObject({ status: 'signedOut', reason: null });
    expect(s.vault.clear).toHaveBeenCalled();
    expect(adapter.signOut).toHaveBeenCalledWith(session);
    expect(s.ended).toEqual([[sessionKey(session), null]]);
  });

  it('follows a peer that ended this user only', async () => {
    const s = setup();
    await s.c.signIn(server, { userName: 'demo', password: 'pw' });
    s.c.follow('other:u9', null);
    expect(s.c.state.get().status).toBe('signedIn');
    s.c.follow(sessionKey(session), 'expired');
    expect(s.c.state.get()).toMatchObject({ status: 'signedOut', reason: 'expired' });
  });

  it('probe builds an adapter on the plain fetch', () => {
    const s = setup();
    s.c.probe(server);
    expect(s.created).toHaveLength(1);
  });
});
