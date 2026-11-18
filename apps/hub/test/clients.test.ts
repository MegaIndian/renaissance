import { describe, expect, it } from 'vitest';

import { createEventBus } from '../src/events/bus.js';
import {
  SINGLES_PROFILE_NAME,
  ensureSinglesProfile,
  lidarrClient,
  waitForCommand,
} from '../src/fetch/lidarr.js';
import { navidromeClient } from '../src/fetch/navidrome.js';
import { slskdClient } from '../src/fetch/slskd.js';
import { HttpError, httpJson } from '../src/http.js';
import { jellyfinLibrary, matchesAlbum, matchesTrack, toHit } from '../src/jellyfin/library.js';
import { recordingLogger, silentLogger } from '../src/log.js';
import { fakeFetch, instantSleep } from './helpers.js';
import { parseArgs } from '../src/cli.js';

describe('httpJson', () => {
  it('parses JSON, accepts listed statuses, and hides URLs from errors', async () => {
    const { fetch } = fakeFetch({
      '/ok': () => ({ a: 1 }),
      '/empty': () => undefined,
      '/teapot': () => ({ __status: 418 }),
      '/created': () => ({ __status: 201, body: { id: 1 } }),
    });
    expect((await httpJson('t', 'http://x.test/ok', {}, fetch)).body).toEqual({ a: 1 });
    expect((await httpJson('t', 'http://x.test/empty', {}, fetch)).body).toBeUndefined();
    expect(
      (
        await httpJson(
          't',
          'http://x.test/created',
          { method: 'POST', body: { a: 1 }, okStatuses: [201] },
          fetch,
        )
      ).status,
    ).toBe(201);
    const error = await httpJson('t', 'http://x.test/teapot?api_key=secret', {}, fetch).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(418);
    expect((error as Error).message).not.toContain('secret');
    const down = await httpJson('t', 'http://x.test/ok', {}, (() =>
      Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch).catch(
      (e: unknown) => e,
    );
    expect((down as HttpError).message).toBe('t unreachable: fetch failed');
    const slow = await httpJson(
      't',
      'http://x.test/ok',
      { timeoutMs: 1 },
      ((_u: string, init: RequestInit) =>
        new Promise((_r, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          ),
        )) as unknown as typeof fetch,
    ).catch((e: unknown) => e);
    expect((slow as HttpError).message).toBe('t did not answer in time');
  });
});

describe('slskdClient', () => {
  it('starts a search, polls to completion, lists responses, enqueues and reads transfers', async () => {
    let polls = 0;
    const { fetch, calls } = fakeFetch({
      '/api/v0/searches/abc/responses': () => [
        { username: 'u', hasFreeUploadSlot: true, uploadSpeed: 1, queueLength: 0, files: [] },
      ],
      '/api/v0/searches/abc': () => ({
        id: 'abc',
        state: ++polls > 1 ? 'Completed, TimedOut' : 'InProgress',
      }),
      '/api/v0/searches': () => ({ id: 'abc', state: 'InProgress' }),
      '/api/v0/transfers/downloads/u': (_url, init) =>
        init.method === 'POST'
          ? { __status: 201 }
          : {
              directories: [
                { files: [{ filename: 'f', size: 1, state: 'InProgress', bytesTransferred: 10 }] },
              ],
            },
      '/api/v0/transfers/downloads/gone': () => ({ __status: 404 }),
    });
    const log = recordingLogger();
    const client = slskdClient({
      url: 'http://slskd.test',
      apiKey: 'key',
      log,
      fetch,
      sleep: instantSleep,
    });
    const responses = await client.search('lil wayne fireman', { timeoutMs: 100 });
    expect(responses).toHaveLength(1);
    expect(calls[0]!.headers['x-api-key']).toBe('key');
    expect(calls[0]!.body).toMatchObject({
      searchText: 'lil wayne fireman',
      filterResponses: true,
    });
    await client.enqueue('u', [{ filename: 'f', size: 1 }]);
    expect(calls.find((c) => c.method === 'POST' && c.url.includes('transfers'))!.body).toEqual([
      { filename: 'f', size: 1 },
    ]);
    expect(await client.transfers('u')).toEqual([
      { filename: 'f', size: 1, state: 'InProgress', bytesTransferred: 10 },
    ]);
    expect(await client.transfers('gone')).toEqual([]);
    expect(log.lines.some((l) => l.includes('slskd search finished'))).toBe(true);
  });

  it('logs instead of writing in dry-run mode', async () => {
    const { fetch, calls } = fakeFetch({});
    const log = recordingLogger();
    const client = slskdClient({
      url: 'http://slskd.test',
      apiKey: 'key',
      log,
      fetch,
      dryRun: true,
    });
    await client.enqueue('u', [{ filename: 'f', size: 1 }]);
    expect(await client.transfers('u')).toEqual([]);
    expect(calls).toEqual([]);
    expect(log.lines[0]).toContain('would POST slskd transfers/downloads');
  });
});

describe('lidarrClient', () => {
  it('reads and writes with the api key header, and logs writes in dry-run mode', async () => {
    const profile = {
      id: 1,
      name: 'Standard',
      primaryAlbumTypes: [
        { albumType: { id: 1, name: 'Album' }, allowed: true },
        { albumType: { id: 3, name: 'Single' }, allowed: false },
      ],
      secondaryAlbumTypes: [{ albumType: { id: 1, name: 'Studio' }, allowed: true }],
      releaseStatuses: [{ releaseStatus: { id: 1, name: 'Official' }, allowed: true }],
    };
    const { fetch, calls } = fakeFetch({
      '/api/v1/rootfolder': () => [{ id: 1, path: '/music' }],
      '/api/v1/metadataprofile': (_u, init) =>
        init.method === 'POST'
          ? { __status: 201, body: { ...JSON.parse(init.body as string), id: 9 } }
          : [profile],
      '/api/v1/qualityprofile': () => [],
      '/api/v1/artist/lookup': () => [{ id: 0, artistName: 'A', foreignArtistId: 'x' }],
      '/api/v1/artist/5': () => ({ id: 5 }),
      '/api/v1/artist': (_u, init) =>
        init.method === 'POST'
          ? { __status: 201, body: { id: 5 } }
          : [{ id: 5, foreignArtistId: 'x' }],
      '/api/v1/album/lookup': () => [{ id: 0, title: 'T', foreignAlbumId: 'g' }],
      '/api/v1/album/7': () => ({ id: 7, title: 'T', foreignAlbumId: 'g', monitored: true }),
      '/api/v1/album': (_u, init) =>
        init.method === 'POST'
          ? { __status: 201, body: { id: 7 } }
          : [{ id: 7, foreignAlbumId: 'g' }],
      '/api/v1/track': () => [{ id: 1, title: 'T' }],
      '/api/v1/manualimport': () => [
        { path: '/d/f.flac', quality: { quality: { id: 6, name: 'FLAC' } } },
      ],
      '/api/v1/command/3': () => ({ id: 3, name: 'ManualImport', status: 'completed' }),
      '/api/v1/command': () => ({
        __status: 201,
        body: { id: 3, name: 'ManualImport', status: 'queued' },
      }),
    });
    const log = recordingLogger();
    const lidarr = lidarrClient({ url: 'http://lidarr.test', apiKey: 'key', log, fetch });
    expect((await lidarr.rootFolders())[0]!.path).toBe('/music');
    expect(calls[0]!.headers['x-api-key']).toBe('key');
    expect((await lidarr.lookupArtist('x'))!.artistName).toBe('A');
    expect((await lidarr.addArtist({ artistName: 'A' })).id).toBe(5);
    expect(
      (
        await lidarr.updateArtist({
          id: 5,
          artistName: 'A',
          foreignArtistId: 'x',
          metadataProfileId: 1,
          qualityProfileId: 1,
          monitored: true,
        })
      ).id,
    ).toBe(5);
    expect((await lidarr.artists())[0]!.id).toBe(5);
    expect((await lidarr.albumByForeignId('g'))!.id).toBe(7);
    expect((await lidarr.album(7)).title).toBe('T');
    expect((await lidarr.lookupAlbum('g'))!.title).toBe('T');
    expect((await lidarr.addAlbum({ title: 'T' })).id).toBe(7);
    expect(
      (await lidarr.updateAlbum({ id: 7, title: 'T', foreignAlbumId: 'g', monitored: true })).id,
    ).toBe(7);
    expect(await lidarr.tracks(7, 70)).toHaveLength(1);
    expect(calls.find((c) => c.url.includes('/track'))!.url).toContain('albumReleaseId=70');
    expect((await lidarr.importCandidates('/d'))[0]!.path).toBe('/d/f.flac');
    const cmd = await lidarr.manualImport([
      {
        path: '/d/f.flac',
        artistId: 5,
        albumId: 7,
        albumReleaseId: 70,
        trackIds: [1],
        quality: { quality: { id: 6, name: 'FLAC' } },
        disableReleaseSwitching: true,
      },
    ]);
    expect(cmd.id).toBe(3);
    const body = calls[calls.length - 1]!.body as {
      name: string;
      importMode: string;
      files: unknown[];
    };
    expect(body).toMatchObject({
      name: 'ManualImport',
      importMode: 'Move',
      replaceExistingFiles: false,
    });
    expect(body.files).toHaveLength(1);
    expect((await lidarr.command('RefreshArtist', { artistId: 5 })).id).toBe(3);
    expect((await lidarr.commandStatus(3)).status).toBe('completed');
    expect((await waitForCommand(lidarr, 3, instantSleep)).status).toBe('completed');
    const singles = await ensureSinglesProfile(lidarr);
    expect(singles.name).toBe(SINGLES_PROFILE_NAME);
    expect(singles.primaryAlbumTypes.find((t) => t.albumType.name === 'Single')!.allowed).toBe(
      true,
    );

    const dry = lidarrClient({
      url: 'http://lidarr.test',
      apiKey: 'key',
      log,
      fetch,
      dryRun: true,
    });
    const before = calls.length;
    const dryArtist = await dry.addArtist({
      artistName: 'A',
      addOptions: { monitor: 'none' },
      images: [{}, {}],
      nested: { deep: true },
    });
    expect(dryArtist.id).toBeGreaterThan(0);
    const dryAlbum = await dry.addAlbum({
      title: 'T',
      releases: [{ id: 0, foreignReleaseId: 'r', title: 'T', trackCount: 1, monitored: true }],
    });
    expect(dryAlbum.releases![0]!.id).toBeGreaterThan(0);
    expect((await dry.manualImport([])).status).toBe('completed');
    expect((await dry.command('RefreshArtist', { artistId: 1 })).status).toBe('completed');
    expect((await dry.commandStatus(1)).status).toBe('completed');
    expect(
      (
        await dry.createMetadataProfile({
          name: 'x',
          primaryAlbumTypes: [],
          secondaryAlbumTypes: [],
          releaseStatuses: [],
        })
      ).id,
    ).toBeGreaterThan(0);
    expect(calls.length).toBe(before);
    const dryLine = log.lines.find((l) => l.includes('would POST lidarr artist'))!;
    expect(dryLine).toContain('"images":"[2]"');
    expect(dryLine).toContain('"nested":"{…}"');
  });

  it("waitForCommand throws with Lidarr's message and ensureSinglesProfile needs a template", async () => {
    const failing = {
      commandStatus: async (id: number) => ({
        id,
        name: 'ManualImport',
        status: 'failed',
        message: 'nope',
      }),
      metadataProfiles: async () => [],
    } as unknown as Parameters<typeof waitForCommand>[0];
    await expect(waitForCommand(failing, 1, instantSleep)).rejects.toThrow(
      'Lidarr command ManualImport failed: nope',
    );
    await expect(ensureSinglesProfile(failing)).rejects.toThrow('no metadata profile');
    let n = 0;
    const slow = {
      commandStatus: async (id: number) => ({
        id,
        name: 'X',
        status: ++n > 2 ? 'completed' : 'started',
      }),
    } as unknown as Parameters<typeof waitForCommand>[0];
    expect((await waitForCommand(slow, 1, instantSleep)).status).toBe('completed');
    const never = {
      commandStatus: async (id: number) => ({ id, name: 'X', status: 'started' }),
    } as unknown as Parameters<typeof waitForCommand>[0];
    await expect(waitForCommand(never, 1, instantSleep, -1)).rejects.toThrow('started: no message');
  });
});

describe('navidromeClient', () => {
  it('signs each call with a salted token and reads search results', async () => {
    const { fetch, calls } = fakeFetch({
      '/rest/startScan': () => ({ 'subsonic-response': { status: 'ok' } }),
      '/rest/search3': () => ({
        'subsonic-response': {
          status: 'ok',
          searchResult3: { song: [{ title: 'Fireman', artist: 'Lil Wayne' }] },
        },
      }),
      '/rest/getUser': () => ({
        'subsonic-response': { status: 'failed', error: { message: 'Wrong username or password' } },
      }),
    });
    const nd = navidromeClient({ url: 'http://nd.test', user: 'sahil', password: 'pw', fetch });
    await nd.startScan();
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('u')).toBe('sahil');
    expect(url.searchParams.get('p')).toBeNull();
    expect(url.searchParams.get('t')).toHaveLength(32);
    expect(url.searchParams.get('s')).toHaveLength(12);
    expect(url.toString()).not.toContain('pw');
    expect(await nd.search('fireman')).toEqual([{ title: 'Fireman', artist: 'Lil Wayne' }]);
    const dry = navidromeClient({
      url: 'http://nd.test',
      user: 'sahil',
      password: 'pw',
      fetch,
      dryRun: true,
    });
    await dry.startScan();
    expect(calls).toHaveLength(2);
    const failing = navidromeClient({
      url: 'http://nd.test',
      user: 'sahil',
      password: 'pw',
      fetch: fakeFetch({
        '/rest/': () => ({
          'subsonic-response': {
            status: 'failed',
            error: { message: 'Wrong username or password' },
          },
        }),
      }).fetch,
    });
    await expect(failing.startScan()).rejects.toThrow('Wrong username or password');
  });
});

describe('jellyfinLibrary', () => {
  const fireman = {
    Id: 'jf1',
    Name: 'Fireman',
    Type: 'Audio',
    Artists: ['Lil Wayne'],
    Album: 'Tha Carter II',
    AlbumId: 'al1',
    RunTimeTicks: 1_830_000_000,
    ProviderIds: { MusicBrainzTrack: 'rec-1' },
  };
  const album = {
    Id: 'al1',
    Name: 'Tha Carter II',
    Type: 'MusicAlbum',
    AlbumArtist: 'Lil Wayne',
    AlbumArtists: [{ Name: 'Lil Wayne', Id: 'ar1' }],
    ImageTags: { Primary: 'x' },
    ProviderIds: { MusicBrainzReleaseGroup: 'rg-1' },
  };
  const artist = { Id: 'ar1', Name: 'Lil Wayne', Type: 'MusicArtist' };

  it('matches tracks and albums by provider id or by title and artist', () => {
    expect(matchesTrack(fireman, 'fireman', 'lil wayne')).toBe(true);
    expect(matchesTrack(fireman, 'Fireman', 'Wayne')).toBe(true);
    expect(matchesTrack(fireman, 'Fireman', 'Taylor Swift')).toBe(false);
    expect(matchesTrack(fireman, 'Hustler', 'Lil Wayne')).toBe(false);
    expect(matchesTrack(fireman, 'Hustler', 'Nobody', 'rec-1')).toBe(true);
    expect(matchesAlbum(album, 'tha carter ii', 'Lil Wayne')).toBe(true);
    expect(matchesAlbum(album, 'Other', 'Lil Wayne', 'rg-1')).toBe(true);
    expect(matchesAlbum(album, 'Tha Carter II', 'Drake')).toBe(false);
    expect(matchesAlbum(album, 'Other', 'Lil Wayne')).toBe(false);
    expect(toHit(fireman)).toEqual({
      id: 'jf1',
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
      album: 'Tha Carter II',
      duration: 183,
      imageId: 'al1',
    });
    expect(toHit(album)).toEqual({
      id: 'al1',
      kind: 'album',
      title: 'Tha Carter II',
      artist: 'Lil Wayne',
      imageId: 'al1',
    });
    expect(toHit(artist)).toEqual({ id: 'ar1', kind: 'artist', title: 'Lil Wayne' });
  });

  it('finds with the hub key, searches with the caller token, refreshes', async () => {
    const { fetch, calls } = fakeFetch({
      '/Items?': (url) => ({
        Items:
          url.searchParams.get('IncludeItemTypes') === 'MusicAlbum'
            ? [album]
            : url.searchParams.get('IncludeItemTypes')?.includes(',')
              ? [fireman, album, artist, { ...fireman, Id: 'jf2' }]
              : [fireman],
        TotalRecordCount: 1,
      }),
      '/Library/Refresh': () => ({ __status: 204 }),
    });
    const lib = jellyfinLibrary({ url: 'http://jf.test', apiKey: 'hubkey', fetch });
    expect(lib.configured).toBe(true);
    const found = await lib.find({ kind: 'track', title: 'Fireman', artist: 'Lil Wayne' });
    expect(found?.hit.id).toBe('jf1');
    expect(calls[0]!.headers['x-emby-token']).toBe('hubkey');
    expect(
      await lib.find({
        kind: 'album',
        title: 'Tha Carter II',
        artist: 'Lil Wayne',
        releaseGroupId: 'rg-1',
      }),
    ).toBeDefined();
    expect(
      await lib.find({ kind: 'track', title: 'Nope', artist: 'Nobody', recordingId: 'zzz' }),
    ).toBeUndefined();
    const instant = await lib.search('callertoken', 'fireman', 1);
    expect(calls[calls.length - 1]!.headers['x-emby-token']).toBe('callertoken');
    expect(instant.tracks).toHaveLength(1);
    expect(instant.albums).toHaveLength(1);
    expect(instant.artists).toHaveLength(1);
    expect(await lib.refresh()).toBe(true);
    const off = jellyfinLibrary({ url: undefined, apiKey: undefined });
    expect(off.configured).toBe(false);
    expect(await off.find({ kind: 'track', title: 'x', artist: 'y' })).toBeUndefined();
    expect(await off.search('t', 'x')).toEqual({ tracks: [], albums: [], artists: [] });
    expect(await off.refresh()).toBe(false);
  });
});

describe('event bus and loggers', () => {
  it('routes events to the profile and to house listeners', () => {
    const bus = createEventBus();
    const mine: unknown[] = [];
    const house: unknown[] = [];
    const stopMine = bus.subscribe('u1', (e) => mine.push(e));
    const stopHouse = bus.subscribe('admin', (e) => house.push(e), 'house');
    bus.publish('u1', { type: 'ping', at: 'a' });
    bus.publish('u2', { type: 'ping', at: 'b' });
    bus.ping(new Date('2026-11-17T00:00:00Z'));
    expect(mine).toHaveLength(2);
    expect(house).toHaveLength(3);
    expect(bus.size()).toBe(2);
    stopMine();
    stopHouse();
    expect(bus.size()).toBe(0);
    silentLogger.info({}, 'x');
    silentLogger.warn({}, 'x');
    silentLogger.error({}, 'x');
    const rec = recordingLogger();
    rec.warn({ a: 1 }, 'w');
    rec.error({ a: 1 }, 'e');
    expect(rec.lines).toEqual(['warn w {"a":1}', 'error e {"a":1}']);
  });
});

describe('cli parseArgs', () => {
  it('reads flags and positional title and artist', () => {
    expect(parseArgs(['--dry-run', 'Fireman', 'Lil Wayne'])).toEqual({
      dryRun: true,
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
    });
    expect(parseArgs(['--album', 'Tha Carter II', 'Lil Wayne'])).toEqual({
      dryRun: false,
      kind: 'album',
      title: 'Tha Carter II',
      artist: 'Lil Wayne',
    });
    expect(typeof parseArgs(['Fireman'])).toBe('string');
  });
});
