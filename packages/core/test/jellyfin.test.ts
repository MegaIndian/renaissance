import { describe, expect, it, vi } from 'vitest';

import {
  JellyfinAdapter,
  ServerError,
  headerSafe,
  secondsToTicks,
  serverBase,
  ticksToSeconds,
  toAlbum,
  toArtist,
  toPlaylist,
  toTrack,
  userDataChanges,
} from '../src/adapters/jellyfin';
import { MemoryLibraryStore, syncLibrary } from '../src/library-cache';
import { Server as ServerSchema } from '../src/models';
import type { Server } from '../src/models';
import { reorder } from '../src/playlist-reorder';
import { UnreachableError } from '../src/server-adapter';
import { fakeFetch, jfAudio, server, session, track as makeTrack } from './fixtures';
import { jellyfin10_10Move } from './playlist-reorder.test';

const options = { deviceName: 'Test', deviceId: 'dev-1', version: '0.0.0' };
const adapter = new JellyfinAdapter(server, options);
const track = makeTrack('abc');

function items(list: unknown[], total = list.length) {
  return { Items: list, TotalRecordCount: total, StartIndex: 0 };
}

describe('JellyfinAdapter URLs and headers', () => {
  it('builds the MediaBrowser authorization header', () => {
    expect(adapter.authorizationHeader('tok')).toBe(
      'MediaBrowser Client="Renaissance", Device="Test", DeviceId="dev-1", Version="0.0.0", Token="tok"',
    );
  });

  it('builds a universal stream URL with a bitrate cap and a play session', () => {
    const url = new URL(adapter.streamUrl(session, track, { maxBitrate: 320_000 }, 'ps1'));
    expect(url.pathname).toBe('/Audio/abc/universal');
    expect(url.searchParams.get('MaxStreamingBitrate')).toBe('320000');
    expect(url.searchParams.get('PlaySessionId')).toBe('ps1');
    expect(url.searchParams.get('api_key')).toBe('tok');
    expect(url.searchParams.get('TranscodingContainer')).toBe('mp3');
  });

  it('omits the cap for original quality', () => {
    const url = new URL(adapter.streamUrl(session, track, 'original'));
    expect(url.searchParams.has('MaxStreamingBitrate')).toBe(false);
  });

  it('image URLs carry no token (Jellyfin images are anonymous) and the width', () => {
    const url = new URL(adapter.imageUrl(session, 'img1', 120));
    expect(url.pathname).toBe('/Items/img1/Images/Primary');
    expect(url.searchParams.get('fillWidth')).toBe('120');
    expect(url.searchParams.has('api_key')).toBe(false);
  });

  it('refuses a non-Jellyfin server', () => {
    expect(() => new JellyfinAdapter({ ...server, kind: 'subsonic' }, options)).toThrow();
  });

  it('converts ticks both ways', () => {
    expect(ticksToSeconds(1366204250)).toBeCloseTo(136.62, 2);
    expect(ticksToSeconds(null)).toBe(0);
    expect(secondsToTicks(10)).toBe(100_000_000);
  });
});

describe('JellyfinAdapter URL and header hygiene', () => {
  const slashServer: Server = { ...server, url: 'http://localhost:8096///' };
  const slashAdapter = new JellyfinAdapter(slashServer, {
    deviceName: 'Sahil\'s "Mac"\\\n',
    deviceId: 'dev-1',
    version: '0.0.0',
  });

  it('drops trailing slashes from the server URL', () => {
    expect(slashAdapter.server.url).toBe('http://localhost:8096');
    expect(slashAdapter.downloadUrl(session, track)).toBe(
      'http://localhost:8096/Items/abc/Download?api_key=tok',
    );
  });

  it('escapes quotes, backslashes and control characters in header values', () => {
    expect(slashAdapter.authorizationHeader()).toBe(
      'MediaBrowser Client="Renaissance", Device="Sahil\'s Mac", DeviceId="dev-1", Version="0.0.0"',
    );
    expect(headerSafe('a"b\\c\u0000d\u007f')).toBe('abcd');
  });

  it('the Server schema trims slashes and serverBase handles thousands of them in one pass', () => {
    expect(ServerSchema.parse({ ...server, url: 'https://x.example/' }).url).toBe(
      'https://x.example',
    );
    expect(serverBase(`http://h${'/'.repeat(5000)}`)).toBe('http://h');
  });
});

describe('JellyfinAdapter mapping', () => {
  it('maps an audio item to a Track, with the album image as fallback art', () => {
    const t = toTrack({
      ...jfAudio('t1', 'Sneaky Snitch', {
        AlbumId: 'al1',
        AlbumPrimaryImageTag: 'tag',
        IndexNumber: 3,
        ParentIndexNumber: 1,
      }),
    } as never);
    expect(t).toMatchObject({
      id: 't1',
      title: 'Sneaky Snitch',
      albumId: 'al1',
      albumTitle: 'Royalty Free',
      artistIds: ['art1'],
      artistName: 'Kevin MacLeod',
      trackNumber: 3,
      discNumber: 1,
      codec: 'mp3',
      container: 'mp3',
      bitrate: 320000,
      sampleRate: 44100,
      year: 2010,
      genres: ['Contemporary'],
      imageId: 'al1',
      isFavorite: true,
      playCount: 2,
    });
    expect(t.duration).toBeCloseTo(136.62, 2);
    expect(t.dateAdded).toBe('2026-11-18T03:08:05.676Z');
    expect(t.lastSaved).toBe('2026-11-18T03:09:00.000Z');
  });

  it('falls back to the container as codec and keeps an untitled file untitled (func AG)', () => {
    const t = toTrack({ Id: 'x', Name: '', Container: 'FLAC', MediaStreams: [] } as never);
    // No English in the cache: the screens translate an empty title where they render it.
    expect(t.title).toBe('');
    // A name that is only spaces is no name either.
    expect(toTrack({ Id: 'y', Name: '   ' } as never).title).toBe('');
    expect(toAlbum({ Id: 'z', Name: ' \t ' } as never).title).toBe('');
    expect(toArtist({ Id: 'w', Name: null } as never).name).toBe('');
    expect(toPlaylist({ Id: 'v' } as never).name).toBe('');
    expect(t.codec).toBe('flac');
    expect(t.isFavorite).toBe(false);
  });

  it('maps an album from its album artists', () => {
    const a = toAlbum({
      Id: 'al1',
      Name: 'Royalty Free',
      AlbumArtists: [{ Id: 'art1', Name: 'Kevin MacLeod' }],
      AlbumArtist: 'Kevin MacLeod',
      ChildCount: 4,
      RunTimeTicks: 10_000_000,
      ImageTags: { Primary: 'x' },
      ProductionYear: 2010,
    } as never);
    expect(a).toMatchObject({
      artistIds: ['art1'],
      trackCount: 4,
      duration: 1,
      imageId: 'al1',
      year: 2010,
    });
  });
});

describe('JellyfinAdapter calls', () => {
  function make(routes: Parameters<typeof fakeFetch>[0]) {
    const fake = fakeFetch(routes);
    return {
      adapter: new JellyfinAdapter(server, { ...options, fetch: fake.fetch }),
      calls: fake.calls,
    };
  }

  it('signs in by name and builds the session', async () => {
    const { adapter, calls } = make({
      'POST /Users/AuthenticateByName': () => ({
        User: { Id: 'u9', Name: 'sahil' },
        AccessToken: 'secret-token',
      }),
    });
    const s = await adapter.signIn({ userName: 'sahil', password: 'pw' });
    expect(s).toEqual({
      server: adapter.server,
      userId: 'u9',
      userName: 'sahil',
      token: 'secret-token',
    });
    expect(calls[0]?.body).toEqual({ Username: 'sahil', Pw: 'pw' });
  });

  it('surfaces a 401 as a ServerError with the status', async () => {
    const { adapter } = make({
      'POST /Users/AuthenticateByName': () => new Response('', { status: 401 }),
    });
    await expect(adapter.signIn({ userName: 'a', password: 'b' })).rejects.toMatchObject({
      name: 'ServerError',
      status: 401,
    });
  });

  it('rejects a malformed answer at the boundary', async () => {
    const { adapter } = make({ 'POST /Users/AuthenticateByName': () => ({ nope: true }) });
    await expect(adapter.signIn({ userName: 'a', password: 'b' })).rejects.toThrow();
  });

  it('runs Quick Connect: initiate, poll, authenticate', async () => {
    let polls = 0;
    const { adapter } = make({
      'POST /QuickConnect/Initiate': () => ({ Code: '123456', Secret: 's3', Authenticated: false }),
      'GET /QuickConnect/Connect': (url) => {
        expect(url.searchParams.get('secret')).toBe('s3');
        return { Code: '123456', Secret: 's3', Authenticated: ++polls > 1 };
      },
      'POST /Users/AuthenticateWithQuickConnect': (_u, body) => {
        expect(body).toEqual({ Secret: 's3' });
        return { User: { Id: 'u1', Name: 'demo' }, AccessToken: 'tok' };
      },
      'GET /QuickConnect/Enabled': () => true,
    });
    expect(await adapter.quickConnect.enabled()).toBe(true);
    const start = await adapter.quickConnect.initiate();
    expect(start.code).toBe('123456');
    expect(await adapter.quickConnect.state(start.secret)).toBe(false);
    expect(await adapter.quickConnect.state(start.secret)).toBe(true);
    expect((await adapter.quickConnect.authenticate(start.secret)).userId).toBe('u1');
  });

  it('lists tracks with the sort, filter and page mapped to Jellyfin names', async () => {
    const { adapter, calls } = make({
      'GET /Items': () => items([jfAudio('t1', 'A'), jfAudio('t2', 'B')], 40),
    });
    const page = await adapter
      .library(session)
      .tracks(
        { start: 20, limit: 2 },
        { sort: 'playCount', favorites: true, genre: 'Jazz', year: 2010 },
      );
    expect(page.total).toBe(40);
    expect(page.items.map((t) => t.id)).toEqual(['t1', 't2']);
    const p = calls[0]?.url.searchParams;
    expect(p?.get('IncludeItemTypes')).toBe('Audio');
    expect(p?.get('SortBy')).toBe('PlayCount,SortName');
    expect(p?.get('SortOrder')).toBe('Descending');
    expect(p?.get('Filters')).toBe('IsFavorite');
    expect(p?.get('Genres')).toBe('Jazz');
    expect(p?.get('Years')).toBe('2010');
    expect(p?.get('StartIndex')).toBe('20');
    expect(p?.get('Limit')).toBe('2');
    expect(p?.get('userId')).toBe('u1');
    expect(p?.get('Recursive')).toBe('true');
  });

  it('album tracks come in disc and track order; artists never sort by play count', async () => {
    const { adapter, calls } = make({
      'GET /Items': () => items([jfAudio('t1', 'A')]),
      'GET /Artists': () => items([{ Id: 'a1', Name: 'Kevin' }]),
      'GET /Artists/AlbumArtists': () => items([{ Id: 'a1', Name: 'Kevin' }]),
    });
    const lib = adapter.library(session);
    await lib.albumTracks('al1');
    expect(calls[0]?.url.searchParams.get('ParentId')).toBe('al1');
    expect(calls[0]?.url.searchParams.get('SortBy')).toBe('ParentIndexNumber,IndexNumber,SortName');
    const artists = await lib.artists({}, { sort: 'playCount' });
    expect(artists.items[0]?.name).toBe('Kevin');
    expect(calls[1]?.url.searchParams.get('SortBy')).toBe('SortName');
    expect((await lib.albumArtists()).items).toHaveLength(1);
  });

  it('reads genres from /MusicGenres and years from /Years, newest first', async () => {
    const { adapter } = make({
      'GET /MusicGenres': () => items([{ Id: 'g1', Name: 'Jazz' }]),
      'GET /Years': () =>
        items([
          { Id: 'y1', Name: '2010' },
          { Id: 'y2', Name: '2014' },
          { Id: 'y3', Name: 'x' },
        ]),
    });
    const lib = adapter.library(session);
    expect(await lib.genres()).toEqual([{ id: 'g1', name: 'Jazz' }]);
    expect(await lib.years()).toEqual([2014, 2010]);
  });

  it('searches every kind in parallel and returns latest, recent, most played and favourites', async () => {
    const { adapter, calls } = make({
      'GET /Items': (url) => {
        const type = url.searchParams.get('IncludeItemTypes');
        if (type === 'Audio') return items([jfAudio('t1', 'Duck')]);
        if (type === 'MusicAlbum') return items([{ Id: 'al1', Name: 'Ducks', AlbumArtists: [] }]);
        return items([]);
      },
      'GET /Artists': () => items([{ Id: 'a1', Name: 'Duck Man' }]),
      'GET /Users/u1/Items/Latest': (url) =>
        url.searchParams.get('IncludeItemTypes') === 'Audio' ? [jfAudio('t2', 'New')] : [],
    });
    const lib = adapter.library(session);
    const result = await lib.search('duck');
    expect(result.tracks[0]?.title).toBe('Duck');
    expect(result.albums[0]?.title).toBe('Ducks');
    expect(result.artists[0]?.name).toBe('Duck Man');
    expect(result.playlists).toEqual([]);
    expect(calls.filter((c) => c.url.searchParams.get('searchTerm') === 'duck')).toHaveLength(4);
    const latest = await lib.latest(5);
    expect(latest.tracks[0]?.id).toBe('t2');
    expect(latest.albums).toEqual([]);
    await lib.recentlyPlayed(3);
    expect(calls.at(-1)?.url.searchParams.get('SortBy')).toBe('DatePlayed');
    expect(calls.at(-1)?.url.searchParams.get('Filters')).toBe('IsPlayed');
    await lib.mostPlayed(3);
    expect(calls.at(-1)?.url.searchParams.get('SortBy')).toBe('PlayCount');
    await lib.favorites({ start: 0, limit: 10 });
    expect(calls.at(-1)?.url.searchParams.get('Filters')).toBe('IsFavorite');
    await lib.userDataChangedSince('2026-01-01T00:00:00.000Z');
    expect(calls.at(-1)?.url.searchParams.get('MinDateLastSavedForUser')).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('pages through every id without images or user data', async () => {
    const { adapter, calls } = make({
      'GET /Items': (url) => {
        const start = Number(url.searchParams.get('StartIndex'));
        const all = Array.from({ length: 2500 }, (_, i) => ({ Id: `t${i}` }));
        return items(all.slice(start, start + 2000), 2500);
      },
    });
    const ids = await adapter.library(session).ids('track');
    expect(ids).toHaveLength(2500);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.searchParams.get('EnableImages')).toBe('false');
  });

  it('sets and clears favourites on /UserFavoriteItems', async () => {
    const { adapter, calls } = make({
      'POST /UserFavoriteItems/t1': () => ({ IsFavorite: true }),
      'DELETE /UserFavoriteItems/t1': () => ({ IsFavorite: false }),
    });
    await adapter.favorites.set(session, 't1', true);
    await adapter.favorites.set(session, 't1', false);
    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
    expect(calls[0]?.url.searchParams.get('userId')).toBe('u1');
  });

  it('creates, renames, reorders, edits and deletes playlists', async () => {
    const { adapter, calls } = make({
      'POST /Playlists': (_u, body) => {
        expect(body).toEqual({
          Name: 'Drive',
          Ids: ['t1', 't2'],
          UserId: 'u1',
          MediaType: 'Audio',
          IsPublic: false,
        });
        return { Id: 'pl1' };
      },
      'GET /Users/u1/Items/pl1': () => ({
        Id: 'pl1',
        Name: 'Drive',
        ChildCount: 2,
        Type: 'Playlist',
      }),
      'POST /Playlists/pl1': (_u, body) => {
        expect(body).toEqual({ Name: 'Sunday drive' });
        return undefined;
      },
      'POST /Playlists/pl1/Items': () => undefined,
      'DELETE /Playlists/pl1/Items': () => undefined,
      'DELETE /Items/pl1': () => undefined,
      'GET /Playlists/pl1/Items': () => items([jfAudio('t1', 'A', { PlaylistItemId: 'e1' })]),
    });
    const created = await adapter.playlists.create(session, 'Drive', ['t1', 't2']);
    expect(created).toMatchObject({ id: 'pl1', name: 'Drive', trackCount: 2 });
    await adapter.playlists.rename(session, 'pl1', 'Sunday drive');
    await adapter.playlists.addTracks(session, 'pl1', ['t3', 't4']);
    expect(calls.at(-1)?.url.searchParams.get('ids')).toBe('t3,t4');
    await adapter.playlists.removeEntries(session, 'pl1', ['e1']);
    expect(calls.at(-1)?.url.searchParams.get('entryIds')).toBe('e1');
    await adapter.playlists.addTracks(session, 'pl1', []);
    const entries = await adapter.library(session).playlistTracks('pl1');
    expect(entries[0]?.entryId).toBe('e1');
    await adapter.playlists.remove(session, 'pl1');
    expect(calls.at(-1)?.method).toBe('DELETE');
    expect(calls.at(-1)?.url.pathname).toBe('/Items/pl1');
  });

  it('reports started, progress and stopped with ticks and the play method', async () => {
    const { adapter, calls } = make({
      'POST /Sessions/Playing': () => undefined,
      'POST /Sessions/Playing/Progress': () => undefined,
      'POST /Sessions/Playing/Stopped': () => undefined,
    });
    await adapter.reportPlayback(session, {
      trackId: 't1',
      position: 0,
      state: 'started',
      method: 'direct',
      playSessionId: 'ps',
    });
    await adapter.reportPlayback(session, {
      trackId: 't1',
      position: 10.5,
      state: 'progress',
      paused: true,
      method: 'transcode',
      playSessionId: 'ps',
    });
    await adapter.reportPlayback(session, {
      trackId: 't1',
      position: 60,
      state: 'stopped',
      playSessionId: 'ps',
    });
    expect(calls.map((c) => c.url.pathname)).toEqual([
      '/Sessions/Playing',
      '/Sessions/Playing/Progress',
      '/Sessions/Playing/Stopped',
    ]);
    expect(calls[0]?.body).toMatchObject({
      ItemId: 't1',
      PositionTicks: 0,
      PlayMethod: 'DirectPlay',
      PlaySessionId: 'ps',
      CanSeek: true,
    });
    expect(calls[1]?.body).toMatchObject({
      PositionTicks: 105_000_000,
      IsPaused: true,
      PlayMethod: 'Transcode',
      EventName: 'TimeUpdate',
    });
    expect(calls[2]?.body).toMatchObject({ PositionTicks: 600_000_000 });
  });

  it('lyrics: synced, unsynced and none', async () => {
    const { adapter } = make({
      'GET /Audio/t1/Lyrics': () => ({
        Lyrics: [
          { Text: 'a', Start: 10_000 },
          { Text: 'b', Start: 20_000 },
        ],
      }),
      'GET /Audio/t2/Lyrics': () => ({ Lyrics: [{ Text: 'a' }] }),
      'GET /Audio/t3/Lyrics': () => new Response('', { status: 404 }),
    });
    expect(await adapter.lyrics(session, 't1')).toEqual({
      trackId: 't1',
      synced: true,
      lines: [
        { text: 'a', start: 1 },
        { text: 'b', start: 2 },
      ],
    });
    expect((await adapter.lyrics(session, 't2'))?.synced).toBe(false);
    expect(await adapter.lyrics(session, 't3')).toBeNull();
  });

  it('signs out and subscribes to the socket with reconnects', async () => {
    const { adapter, calls } = make({ 'POST /Sessions/Logout': () => undefined });
    await adapter.signOut(session);
    expect(calls[0]?.url.pathname).toBe('/Sessions/Logout');
    expect(adapter.subscribe(session, {})).toBeTypeOf('function');

    const sockets: FakeSocket[] = [];
    class FakeSocket {
      onopen: (() => void) | null = null;
      onmessage: ((m: { data: unknown }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      sent: string[] = [];
      constructor(readonly url: string) {
        sockets.push(this);
      }
      send(data: string) {
        this.sent.push(data);
      }
      close() {
        this.onclose?.();
      }
    }
    const events = { library: 0, user: 0 };
    const changes: unknown[] = [];
    const withSocket = new JellyfinAdapter(server, {
      ...options,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    const stop = withSocket.subscribe(session, {
      onLibraryChanged: () => events.library++,
      onUserDataChanged: (list) => {
        events.user++;
        changes.push(list);
      },
    });
    const socket = sockets[0] as FakeSocket;
    expect(socket.url).toMatch(/^ws:\/\/localhost:8096\/socket\?api_key=tok&deviceId=dev-1$/);
    socket.onopen?.();
    expect(socket.sent[0]).toContain('KeepAlive');
    socket.onmessage?.({ data: JSON.stringify({ MessageType: 'LibraryChanged', Data: {} }) });
    socket.onmessage?.({ data: JSON.stringify({ MessageType: 'UserDataChanged' }) });
    // The shape 10.10.7 pushes when another device hearts a song (captured on the demo).
    socket.onmessage?.({
      data: JSON.stringify({
        MessageType: 'UserDataChanged',
        Data: {
          UserId: 'u1',
          UserDataList: [
            {
              Rating: 0,
              PlayedPercentage: 0,
              PlaybackPositionTicks: 0,
              PlayCount: 3,
              IsFavorite: true,
              LastPlayedDate: '2026-11-19T20:00:00.0000000Z',
              Played: true,
              Key: 'k1',
              ItemId: 't5000',
            },
            { PlayCount: 1, IsFavorite: false, Played: false, Key: 'k2', ItemId: 'al7' },
          ],
        },
      }),
    });
    socket.onmessage?.({ data: JSON.stringify({ MessageType: 'ForceKeepAlive' }) });
    socket.onmessage?.({ data: 'null' });
    // One malformed frame from a proxy is ignored, not thrown out of the handler.
    expect(() => socket.onmessage?.({ data: '{not json' })).not.toThrow();
    expect(events).toEqual({ library: 1, user: 2 });
    // A push without `Data` names no item; one with it names each item and its user data.
    expect(changes).toEqual([
      [],
      [
        {
          itemId: 't5000',
          isFavorite: true,
          playCount: 3,
          lastPlayed: '2026-11-19T20:00:00.000Z',
        },
        { itemId: 'al7', isFavorite: false, playCount: 1, lastPlayed: undefined },
      ],
    ]);
    expect(socket.sent).toHaveLength(2);
    stop();
    socket.onclose?.();
    expect(sockets).toHaveLength(1);
  });

  it('a socket refused twice before it ever opened asks /Users/Me once, so a revoked token ends through fetch', async () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeSocket[] = [];
      class FakeSocket {
        onopen: (() => void) | null = null;
        onmessage: ((m: { data: unknown }) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(readonly url: string) {
          sockets.push(this);
        }
        send() {}
        close() {
          this.onclose?.();
        }
      }
      const fake = fakeFetch({ 'GET /Users/Me': () => ({ Id: 'u1', Name: 'sahil' }) });
      const adapter = new JellyfinAdapter(server, {
        ...options,
        fetch: fake.fetch,
        WebSocket: FakeSocket as unknown as typeof WebSocket,
      });
      const probes = () => fake.calls.filter((c) => c.url.pathname === '/Users/Me').length;
      const stop = adapter.subscribe(session, {});
      sockets[0]?.onclose?.();
      expect(probes()).toBe(0);
      await vi.advanceTimersByTimeAsync(1000);
      sockets[1]?.onclose?.();
      expect(probes()).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      sockets[2]?.onclose?.();
      expect(probes()).toBe(1);
      // A socket that opens resets the count; a close after an open is an ordinary drop.
      await vi.advanceTimersByTimeAsync(4000);
      sockets[3]?.onopen?.();
      sockets[3]?.onclose?.();
      await vi.advanceTimersByTimeAsync(1000);
      sockets[4]?.onclose?.();
      expect(probes()).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      sockets[5]?.onclose?.();
      expect(probes()).toBe(2);
      stop();
      expect(sockets).toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ServerError carries the path', () => {
    const e = new ServerError(500, '/Items');
    expect(e.message).toContain('500');
    expect(e.path).toBe('/Items');
  });

  it('every request carries an abort signal; a host that never answers fails as unreachable within the timeout', async () => {
    const seen: { path: string; signal: AbortSignal | null | undefined }[] = [];
    const blackHole: typeof fetch = (input, init) =>
      new Promise((_resolve, reject) => {
        seen.push({ path: new URL(String(input)).pathname, signal: init?.signal });
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const slow = new JellyfinAdapter(server, {
      ...options,
      fetch: blackHole,
      timeouts: { auth: 20, request: 40 },
    });
    const started = Date.now();
    await expect(slow.signIn({ userName: 'a', password: 'b' })).rejects.toMatchObject({
      name: 'UnreachableError',
      reason: 'timeout',
      path: '/Users/AuthenticateByName',
    });
    await expect(slow.quickConnect.initiate()).rejects.toMatchObject({ reason: 'timeout' });
    await expect(slow.ping()).rejects.toMatchObject({ reason: 'timeout' });
    await expect(slow.library(session).genres()).rejects.toMatchObject({ reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen.every((s) => s.signal instanceof AbortSignal)).toBe(true);
    // A refused connection is unreachable too, with the cause kept.
    const refused = new JellyfinAdapter(server, {
      ...options,
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const error = await refused.ping().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnreachableError);
    expect((error as UnreachableError).reason).toBe('network');
    expect((error as UnreachableError).cause).toBeInstanceOf(TypeError);
  });

  it("a caller's signal aborts the request in flight and rejects as cancelled, not unreachable (prod AJ)", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const blackHole: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        seen.push(init?.signal);
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const slow = new JellyfinAdapter(server, { ...options, fetch: blackHole });
    const controller = new AbortController();
    const library = slow.library(session);
    const pending = library.tracks({ start: 0, limit: 10, signal: controller.signal });
    const idsPending = library.ids('album', { signal: controller.signal });
    const byIdsPending = library.byIds('track', ['x'], { signal: controller.signal });
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen.every((s) => s instanceof AbortSignal && !s.aborted)).toBe(true);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'CancelledError' });
    await expect(idsPending).rejects.toMatchObject({ name: 'CancelledError' });
    await expect(byIdsPending).rejects.toMatchObject({ name: 'CancelledError' });
    expect(seen.every((s) => s?.aborted)).toBe(true);
    // A signal that has already fired sends nothing at all.
    await expect(
      library.albums({ start: 0, limit: 10, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'CancelledError' });
    expect(seen).toHaveLength(3);
  });

  it('ping reads the public version; me reads /Users/Me and surfaces a revoked token as 401', async () => {
    const { adapter, calls } = make({
      'GET /System/Info/Public': () => ({ Version: '10.10.7' }),
      'GET /Users/Me': (_u, _b, call) =>
        call.url.search === '' && (call as unknown as { headers?: unknown })
          ? { Id: 'u1', Name: 'demo' }
          : undefined,
    });
    expect(await adapter.ping()).toEqual({ version: '10.10.7' });
    expect(await adapter.me(session)).toEqual({ userId: 'u1', userName: 'demo' });
    expect(calls.at(-1)?.url.pathname).toBe('/Users/Me');
    const revoked = make({
      'GET /Users/Me': () => new Response('Unauthorized', { status: 401 }),
    });
    await expect(revoked.adapter.me(session)).rejects.toMatchObject({ status: 401 });
  });

  it('byIds fetches tracks and albums in chunks of 100, asking for the save stamps', async () => {
    const asked: string[] = [];
    const { adapter } = make({
      'GET /Items': (url) => {
        const ids = (url.searchParams.get('Ids') ?? '').split(',');
        asked.push(`${url.searchParams.get('IncludeItemTypes')}:${ids.length}`);
        return items(
          ids.map((id) =>
            url.searchParams.get('IncludeItemTypes') === 'Audio'
              ? jfAudio(id, `Song ${id}`)
              : { Id: id, Name: `Album ${id}`, Type: 'MusicAlbum' },
          ),
        );
      },
    });
    const library = adapter.library(session);
    const tracks = await library.byIds(
      'track',
      Array.from({ length: 150 }, (_, i) => `t${i}`),
    );
    expect(tracks).toHaveLength(150);
    expect(tracks[0]?.artistCredits).toEqual([{ id: 'art1', name: 'Kevin MacLeod' }]);
    const albums = await library.byIds('album', ['a1']);
    expect(albums[0]).toMatchObject({ id: 'a1', title: 'Album a1' });
    expect(await library.byIds('track', [])).toEqual([]);
    expect(asked).toEqual(['Audio:100', 'Audio:50', 'MusicAlbum:1']);
    expect(tracks[0]?.lastSaved).toBe('2026-11-18T03:09:00.000Z');
  });

  it('musicByIds asks once without a type, sorts the answer by the type the server returns and drops the rest', async () => {
    const asked: string[] = [];
    const { adapter } = make({
      'GET /Items': (url) => {
        asked.push(
          `${url.searchParams.get('Ids')} types=${String(url.searchParams.get('IncludeItemTypes'))}`,
        );
        return items([
          jfAudio('t9', 'Song 9'),
          { Id: 'al9', Name: 'Album 9', Type: 'MusicAlbum' },
          { Id: 'movie-1', Name: 'A film', Type: 'Movie' },
          { Id: 'ep-1', Name: 'An episode', Type: 'Episode' },
        ]);
      },
    });
    const found = await adapter.library(session).musicByIds(['t9', 'al9', 'movie-1', 'ep-1']);
    expect(found.tracks.map((t) => t.id)).toEqual(['t9']);
    expect(found.albums.map((a) => a.id)).toEqual(['al9']);
    expect(asked).toEqual(['t9,al9,movie-1,ep-1 types=null']);
    expect(await adapter.library(session).musicByIds([])).toEqual({ tracks: [], albums: [] });
    expect(asked).toHaveLength(1);
  });

  it('a push with one odd entry keeps the good ones', () => {
    const good = {
      PlayCount: 3,
      IsFavorite: true,
      LastPlayedDate: '2026-11-19T20:00:00.0000000Z',
      Key: 'k1',
      ItemId: 't5000',
    };
    expect(
      userDataChanges({
        UserDataList: [
          { ...good, ItemId: 12345 },
          good,
          { ItemId: 'al7', IsFavorite: false, PlayCount: 'many' },
          'not an entry',
          null,
          { ItemId: 'al8', IsFavorite: false },
        ],
      }),
    ).toEqual([
      { itemId: 't5000', isFavorite: true, playCount: 3, lastPlayed: '2026-11-19T20:00:00.000Z' },
      { itemId: 'al8', isFavorite: false, playCount: undefined, lastPlayed: undefined },
    ]);
    expect(userDataChanges({ UserDataList: 'nope' })).toEqual([]);
    expect(userDataChanges(undefined)).toEqual([]);
  });

  it('the delta reads from the stamps the items carry, with no Date header on any answer and no clock', async () => {
    // Two tracks on the server; a later one appears before the second sync. Every fake Response
    // here is built without a Date header, as a cross-origin page sees Jellyfin's answers.
    const dated = (id: string, created: string, saved: string) =>
      jfAudio(id, `Song ${id}`, { DateCreated: created, DateLastSaved: saved });
    let onServer = [
      dated('t1', '2026-11-01T10:00:00.000Z', '2026-11-05T09:00:00.000Z'),
      dated('t2', '2026-11-03T10:00:00.000Z', '2026-11-03T10:00:00.000Z'),
    ];
    const { adapter, calls } = make({
      'GET /Items': (url) => {
        if (url.searchParams.get('IncludeItemTypes') === 'MusicAlbum') return items([]);
        const list = [...onServer];
        if (url.searchParams.get('SortBy')?.startsWith('DateCreated')) {
          list.sort((a, b) => Date.parse(b.DateCreated) - Date.parse(a.DateCreated));
        }
        return items(list);
      },
      'GET /Artists': () => items([]),
      'GET /Artists/AlbumArtists': () => items([]),
    });
    for (const call of calls) expect(call.url.pathname).not.toBe('/System/Info/Public');
    const store = new MemoryLibraryStore();
    const library = adapter.library(session);
    const full = await syncLibrary(library, store, { now: () => new Date('2000-01-01T00:00:00Z') });
    expect(full.mode).toBe('full');
    expect((await store.readMeta())?.watermark).toEqual({
      added: '2026-11-03T10:00:00.000Z',
      saved: '2026-11-05T09:00:00.000Z',
    });
    onServer = [...onServer, dated('t3', '2026-11-10T10:00:00.000Z', '2026-11-10T10:00:00.000Z')];
    calls.length = 0;
    // The device clock is wildly wrong and it does not matter.
    const delta = await syncLibrary(library, store, {
      now: () => new Date('2099-01-01T00:00:00Z'),
    });
    expect(delta.mode).toBe('delta');
    expect(delta.snapshot.tracks.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    const userData = calls.find((c) => c.url.searchParams.has('MinDateLastSavedForUser'));
    expect(userData?.url.searchParams.get('MinDateLastSavedForUser')).toBe(
      '2026-11-05T09:00:00.000Z',
    );
    expect(calls.map((c) => c.url.pathname)).not.toContain('/System/Info/Public');
    expect((await store.readMeta())?.watermark).toEqual({
      added: '2026-11-10T10:00:00.000Z',
      saved: '2026-11-10T10:00:00.000Z',
    });
    expect(delta.snapshot.syncedAt).toBe('2099-01-01T00:00:00.000Z');
  });

  describe('playlist move with read-back', () => {
    /** A fake playlist server; `algorithm` is how its Move lands. */
    function playlistServer(
      names: string[],
      algorithm: (list: string[], entryId: string, index: number) => string[],
    ) {
      let order = names.map((_, i) => `e${i}`);
      let moves = 0;
      const made = make({
        'GET /Playlists/pl/Items': () =>
          items(
            order.map((e) =>
              jfAudio(`t-${e}`, names[Number(e.slice(1))] ?? e, { PlaylistItemId: e }),
            ),
          ),
        '* /Playlists/pl/Items/e0/Move/0': () => undefined,
      });
      // Route every Move/{index} by hand: the fake fetch keys on exact paths.
      const fetchWithMoves: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        const m = /^\/Playlists\/pl\/Items\/([^/]+)\/Move\/(\d+)$/.exec(url.pathname);
        if (m) {
          moves += 1;
          order = algorithm(order, m[1] as string, Number(m[2]));
          return new Response(null, { status: 204 });
        }
        return made.adapter['fetchImpl'](input, init);
      };
      const adapter = new JellyfinAdapter(server, { ...options, fetch: fetchWithMoves });
      return { adapter, order: () => order, moves: () => moves };
    }
    const standard = (list: string[], entryId: string, index: number) => {
      const out = list.filter((e) => e !== entryId);
      out.splice(Math.min(index, out.length), 0, entryId);
      return out;
    };
    const names = ['Carefree', 'Fluffing a Duck', 'Monkeys Spinning Monkeys', 'Sneaky Snitch'];

    it('on a server that lands where asked: one move, one read-back, semantics learned as standard', async () => {
      const { adapter, order, moves } = playlistServer(names, standard);
      const result = await adapter.playlists.move(session, 'pl', 'e1', 0);
      expect(result.ok).toBe(true);
      expect(order()).toEqual(['e1', 'e0', 'e2', 'e3']);
      expect(result.entries.map((e) => e.entryId)).toEqual(['e1', 'e0', 'e2', 'e3']);
      expect(moves()).toBe(1);
      expect(adapter.moveSemantics).toBe('standard');
    });

    it('on Jellyfin 10.10: the first move is read back, the off-by-one is recognised and compensated', async () => {
      const { adapter, order, moves } = playlistServer(names, jellyfin10_10Move);
      // Move up to the top: the server leaves it unchanged; the adapter notices and corrects it.
      const first = await adapter.playlists.move(session, 'pl', 'e1', 0);
      expect(first.ok).toBe(true);
      expect(order()).toEqual(['e1', 'e0', 'e2', 'e3']);
      expect(adapter.moveSemantics).toBe('priorItem');
      // Later moves plan straight away: down by one is one call that moves the neighbour up.
      const before = moves();
      const second = await adapter.playlists.move(session, 'pl', 'e0', 2);
      expect(second.ok).toBe(true);
      expect(order()).toEqual(['e1', 'e2', 'e0', 'e3']);
      expect(moves() - before).toBe(1);
      // Every target is reachable.
      for (let from = 0; from < 4; from++) {
        for (let to = 0; to < 4; to++) {
          const entry = order()[from] as string;
          const wanted = reorder(order(), from, to);
          const result = await adapter.playlists.move(session, 'pl', entry, to);
          expect(result.ok, `${from}->${to}`).toBe(true);
          expect(order()).toEqual(wanted);
        }
      }
    });

    it('a server with unknown semantics reports the mismatch instead of guessing', async () => {
      const ignores = (list: string[]) => [...list];
      const { adapter, moves } = playlistServer(names, ignores);
      const result = await adapter.playlists.move(session, 'pl', 'e0', 2);
      expect(result.ok).toBe(false);
      expect(result.entries.map((e) => e.entryId)).toEqual(['e0', 'e1', 'e2', 'e3']);
      expect(adapter.moveSemantics).toBe('unknown');
      expect(moves()).toBe(1);
    });

    it('a planned sequence that does not land resets the semantics to unknown, and the next move is measured again', async () => {
      // The first Move lands as 10.10 would (a concurrent edit made it look so), the planned
      // compensation is swallowed, and from then on the server is a standard one.
      type Algorithm = (list: string[], entryId: string, index: number) => string[];
      let calls = 0;
      let behaviour: Algorithm = (list, entryId, index) =>
        ++calls === 1 ? jellyfin10_10Move(list, entryId, index) : [...list];
      const { adapter, order } = playlistServer(names, (list, entryId, index) =>
        behaviour(list, entryId, index),
      );
      const wrong = await adapter.playlists.move(session, 'pl', 'e1', 0);
      expect(wrong.ok).toBe(false);
      expect(adapter.moveSemantics).toBe('unknown');
      expect(wrong.entries.map((e) => e.entryId)).toEqual(order());
      // Measured again on a server that now lands where asked: learned as standard, no planning.
      behaviour = standard;
      const next = await adapter.playlists.move(session, 'pl', 'e3', 0);
      expect(next.ok).toBe(true);
      expect(adapter.moveSemantics).toBe('standard');
      expect(order()[0]).toBe('e3');
    });

    it('an unknown entry or a no-op target makes no server call', async () => {
      const { adapter, moves } = playlistServer(names, standard);
      expect((await adapter.playlists.move(session, 'pl', 'e2', 2)).ok).toBe(true);
      expect((await adapter.playlists.move(session, 'pl', 'nope', 0)).ok).toBe(false);
      expect(moves()).toBe(0);
    });
  });
});
