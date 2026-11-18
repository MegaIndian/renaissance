import { describe, expect, it } from 'vitest';

import {
  JellyfinAdapter,
  ServerError,
  headerSafe,
  secondsToTicks,
  serverBase,
  ticksToSeconds,
  toAlbum,
  toTrack,
} from '../src/adapters/jellyfin';
import { Server as ServerSchema } from '../src/models';
import type { Server } from '../src/models';
import { fakeFetch, jfAudio, server, session, track as makeTrack } from './fixtures';

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
  });

  it('falls back to the container as codec and names an untitled file', () => {
    const t = toTrack({ Id: 'x', Name: '', Container: 'FLAC', MediaStreams: [] } as never);
    expect(t.title).toBe('(untitled)');
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
      'POST /Playlists/pl1/Items/e2/Move/0': () => undefined,
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
    await adapter.playlists.move(session, 'pl1', 'e2', 0);
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
    const withSocket = new JellyfinAdapter(server, {
      ...options,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    const stop = withSocket.subscribe(session, {
      onLibraryChanged: () => events.library++,
      onUserDataChanged: () => events.user++,
    });
    const socket = sockets[0] as FakeSocket;
    expect(socket.url).toMatch(/^ws:\/\/localhost:8096\/socket\?api_key=tok&deviceId=dev-1$/);
    socket.onopen?.();
    expect(socket.sent[0]).toContain('KeepAlive');
    socket.onmessage?.({ data: JSON.stringify({ MessageType: 'LibraryChanged', Data: {} }) });
    socket.onmessage?.({ data: JSON.stringify({ MessageType: 'UserDataChanged' }) });
    socket.onmessage?.({ data: JSON.stringify({ MessageType: 'ForceKeepAlive' }) });
    socket.onmessage?.({ data: 'null' });
    expect(events).toEqual({ library: 1, user: 1 });
    expect(socket.sent).toHaveLength(2);
    stop();
    socket.onclose?.();
    expect(sockets).toHaveLength(1);
  });

  it('ServerError carries the path', () => {
    const e = new ServerError(500, '/Items');
    expect(e.message).toContain('500');
    expect(e.path).toBe('/Items');
  });
});
