import type { HubEvent } from '@renaissance/core';
import { describe, expect, it } from 'vitest';

import { createEventBus } from '../src/events/bus.js';
import {
  PipelineError,
  createPipeline,
  describePick,
  lidarrPathFor,
  mapTrack,
  pickRelease,
} from '../src/fetch/pipeline.js';
import type { PipelineDeps } from '../src/fetch/pipeline.js';
import { createRunner } from '../src/fetch/runner.js';
import { recordingLogger } from '../src/log.js';
import { createRequestService } from '../src/requests/service.js';
import {
  FLAC,
  MP3,
  carterAlbum,
  fakeCatalogue,
  fakeLibrary,
  fakeLidarr,
  fakeNavidrome,
  fakeSlskd,
  firemanSong,
  ids,
  response,
} from './fakes.js';
import { instantSleep, memoryStores, mom, sahil } from './helpers.js';

function setup(
  overrides: Partial<PipelineDeps> & {
    slskdResults?: Record<string, ReturnType<typeof response>[]>;
    transfers?: Parameters<typeof fakeSlskd>[0]['transfers'];
    lidarrOptions?: Parameters<typeof fakeLidarr>[0];
  } = {},
) {
  const stores = memoryStores();
  const bus = createEventBus();
  const events: HubEvent[] = [];
  bus.subscribe(sahil.id, (e) => events.push(e));
  const slskd = fakeSlskd({
    results: overrides.slskdResults ?? { 'lil wayne fireman': [response('cuchillo', [{}])] },
    ...(overrides.transfers ? { transfers: overrides.transfers } : {}),
  });
  const lidarr = fakeLidarr(overrides.lidarrOptions ?? {});
  const lib = fakeLibrary();
  const navidrome = fakeNavidrome();
  const log = recordingLogger();
  const deps: PipelineDeps = {
    stores,
    bus,
    catalogue: fakeCatalogue(),
    library: lib.library,
    slskd: slskd.client,
    lidarr: lidarr.client,
    navidrome: navidrome.client,
    lidarrDownloadsDir: '/files/downloads/music/complete',
    log,
    sleep: instantSleep,
    downloadTimeoutMs: 1,
    tracksTimeoutMs: 1000,
    ...overrides,
  };
  const pipeline = createPipeline(deps);
  return { stores, bus, events, slskd, lidarr, lib, navidrome, log, pipeline };
}

const statuses = (events: HubEvent[]) =>
  events
    .filter((e) => e.type === 'request')
    .map((e) => (e as Extract<HubEvent, { type: 'request' }>).request.status);

describe('helpers', () => {
  it('maps a file to a track by recording id, then title, then closest duration', () => {
    const tracks = [
      {
        id: 1,
        title: 'Fireman',
        trackNumber: '3',
        absoluteTrackNumber: 3,
        duration: 183_000,
        hasFile: false,
        foreignRecordingId: 'x',
      },
      {
        id: 2,
        title: 'Fireman',
        trackNumber: '9',
        absoluteTrackNumber: 9,
        duration: 240_000,
        hasFile: false,
        foreignRecordingId: ids.recording,
      },
      {
        id: 3,
        title: 'Fireman (Remix)',
        trackNumber: '10',
        absoluteTrackNumber: 10,
        duration: 183_000,
        hasFile: false,
      },
    ];
    expect(mapTrack(tracks, { title: 'Fireman', recordingId: ids.recording })?.id).toBe(2);
    expect(mapTrack(tracks, { title: 'Fireman', duration: 183 })?.id).toBe(1);
    expect(mapTrack(tracks, { title: 'fireman' })?.id).toBe(1);
    expect(mapTrack(tracks, { title: 'Fireman Remix' })?.id).toBe(3);
    expect(mapTrack(tracks, { title: 'Hustler Musik' })).toBeUndefined();
  });

  it('picks our release, else the monitored one, else the first', () => {
    const album = {
      id: 1,
      title: 'A',
      foreignAlbumId: 'g',
      monitored: true,
      releases: [
        { id: 10, foreignReleaseId: 'r1', title: 'A', trackCount: 1, monitored: false },
        { id: 11, foreignReleaseId: 'r2', title: 'A', trackCount: 1, monitored: true },
      ],
    };
    expect(pickRelease(album, 'r1')?.id).toBe(10);
    expect(pickRelease(album, 'nope')?.id).toBe(11);
    expect(
      pickRelease({ ...album, releases: album.releases.map((r) => ({ ...r, monitored: false })) })
        ?.id,
    ).toBe(10);
    expect(pickRelease({ ...album, releases: [] })).toBeUndefined();
    expect(lidarrPathFor('/files/downloads/music/complete', FLAC)).toBe(
      '/files/downloads/music/complete/Tha Carter II/03 - Fireman.flac',
    );
    expect(
      describePick({
        candidate: {
          username: 'u',
          filename: FLAC,
          size: 1,
          hasFreeUploadSlot: true,
          queueLength: 0,
          uploadSpeed: 0,
        },
        score: 9,
        reasons: ['a', 'b'],
      }),
    ).toBe('03 - Fireman.flac from u (score 9: a, b)');
  });
});

describe('pipeline: a single', () => {
  it('finds, downloads, maps and imports with albumReleaseId and disableReleaseSwitching, then scans and fills the collection', async () => {
    const t = setup({
      transfers: {
        [FLAC]: [
          { state: 'InProgress', bytesTransferred: 15_000_000 },
          { state: 'Completed, Succeeded' },
        ],
      },
    });
    const req = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const result = await t.pipeline.run(req.id);
    expect(result?.status).toBe('ready');
    expect(result?.recordingId).toBe(ids.recording);
    expect(result?.releaseGroupId).toBe(ids.releaseGroup);
    expect(result?.duration).toBe(183);
    expect(statuses(t.events)).toEqual([
      'finding',
      'finding',
      'finding',
      'downloading',
      'importing',
      'importing',
      'ready',
    ]);
    expect(t.events.some((e) => e.type === 'ready')).toBe(true);
    expect(t.slskd.searches).toEqual(['lil wayne fireman']);
    expect(t.slskd.enqueued).toEqual([
      { username: 'cuchillo', files: [{ filename: FLAC, size: 30_000_000 }] },
    ]);
    const profileWrite = t.lidarr.writes.find((w) => w.path === 'metadataprofile');
    expect(profileWrite).toBeDefined();
    const artistWrite = t.lidarr.writes.find((w) => w.path === 'artist')!.body as Record<
      string,
      unknown
    >;
    expect(artistWrite.metadataProfileId).toBe(
      t.lidarr.profiles.find((p) => p.name.includes('Renaissance'))!.id,
    );
    expect(artistWrite.rootFolderPath).toBe('/files/media/music');
    expect(artistWrite.qualityProfileId).toBe(2);
    const albumWrite = t.lidarr.writes.find((w) => w.path === 'album')!.body as Record<
      string,
      unknown
    >;
    expect(albumWrite.monitored).toBe(false);
    const releaseSwitch = t.lidarr.writes.find((w) => w.path.startsWith('album/'))!.body as {
      releases: { foreignReleaseId: string; monitored: boolean }[];
    };
    expect(releaseSwitch.releases.map((r) => [r.foreignReleaseId, r.monitored])).toEqual([
      ['c0ffee00-0000-4000-8000-000000000099', false],
      [ids.release, true],
    ]);
    const importCmd = t.lidarr.writes.find(
      (w) => (w.body as { name: string }).name === 'ManualImport',
    )!.body as { files: Record<string, unknown>[] };
    expect(importCmd.files).toHaveLength(1);
    expect(importCmd.files[0]).toMatchObject({
      path: '/files/downloads/music/complete/Tha Carter II/03 - Fireman.flac',
      trackIds: [3003],
      disableReleaseSwitching: true,
      quality: { quality: { id: 6, name: 'FLAC' } },
    });
    const album = t.lidarr.albums[0]!;
    expect(importCmd.files[0]!.albumId).toBe(album.id);
    expect(importCmd.files[0]!.albumReleaseId).toBe(
      album.releases!.find((r) => r.foreignReleaseId === ids.release)!.id,
    );
    expect(t.lidarr.writes.some((w) => (w.body as { name: string }).name === 'RefreshArtist')).toBe(
      true,
    );
    expect(t.navidrome.scans).toHaveLength(1);
    expect(t.lib.refreshes).toHaveLength(1);
    const collection = t.stores.collection.list(sahil.id);
    expect(collection).toHaveLength(1);
    expect(collection[0]).toMatchObject({
      item: `mb:recording:${ids.recording}`,
      source: 'request',
      title: 'Fireman',
      album: 'Tha Carter II',
    });
    expect(result?.steps.map((s) => s.status)).toContain('downloading');
    expect(result?.detail).toBe('Imported 03 - Fireman.flac');
  });

  it('drops the leading Lil when the first query returns nothing', async () => {
    const t = setup({
      slskdResults: {
        'lil wayne fireman': [],
        'wayne fireman': [response('u2', [{ filename: MP3, extension: 'mp3', bitRate: 320 }])],
      },
    });
    const req = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const result = await t.pipeline.run(req.id);
    expect(result?.status).toBe('ready');
    expect(t.slskd.searches).toEqual(['lil wayne fireman', 'wayne fireman']);
    expect(result?.steps.some((s) => s.detail?.includes('"lil wayne fireman": 0 files'))).toBe(
      true,
    );
  });

  it('fails with no_results after every query, and no_candidates when files were all excluded', async () => {
    const none = setup({ slskdResults: {} });
    const r1 = none.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const out1 = await none.pipeline.run(r1.id);
    expect(out1).toMatchObject({ status: 'failed', reason: 'no_results' });
    expect(none.slskd.searches).toEqual([
      'lil wayne fireman',
      'wayne fireman',
      'fireman tha carter ii',
      'fireman',
    ]);
    expect(none.slskd.enqueued).toEqual([]);
    const locked = setup({ slskdResults: { fireman: [response('u', [{ isLocked: true }])] } });
    const r2 = locked.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    expect(await locked.pipeline.run(r2.id)).toMatchObject({
      status: 'failed',
      reason: 'no_candidates',
    });
  });

  it('honours a household rule: live files are excluded', async () => {
    const t = setup({
      slskdResults: {
        'lil wayne fireman': [response('u', [{ filename: '@@x\\Lil Wayne\\Fireman (Live).flac' }])],
      },
    });
    t.stores.rules.add(sahil.id, 'no live versions');
    const req = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    expect(await t.pipeline.run(req.id)).toMatchObject({
      status: 'failed',
      reason: 'no_candidates',
    });
  });

  it('tries the next file when a download errors, and fails after the last', async () => {
    const results = {
      'lil wayne fireman': [
        response('a', [{ filename: FLAC }]),
        response('b', [{ filename: MP3, extension: 'mp3', bitRate: 320, size: 9_000_000 }]),
      ],
    };
    const t = setup({
      slskdResults: results,
      transfers: { [FLAC]: [{ state: 'Completed, Errored', exception: 'peer offline' }] },
    });
    const req = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const result = await t.pipeline.run(req.id);
    expect(result?.status).toBe('ready');
    expect(t.slskd.enqueued.map((e) => e.username)).toEqual(['a', 'b']);
    expect(t.log.lines.some((l) => l.includes('peer offline'))).toBe(true);
    const both = setup({
      slskdResults: results,
      transfers: { [FLAC]: [{ state: 'Completed, TimedOut' }], [MP3]: [{ state: 'InProgress' }] },
    });
    const r2 = both.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const out = await both.pipeline.run(r2.id);
    expect(out).toMatchObject({ status: 'failed', reason: 'download_failed' });
    expect(out?.detail).toContain('no progress');
  });

  it('fails when no Lidarr track matches, when Lidarr cannot see the file, and when the import command fails', async () => {
    const unmapped = setup({
      lidarrOptions: { tracks: [{ id: 1, title: 'Something Else', foreignRecordingId: 'zzz' }] },
    });
    const r1 = unmapped.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    expect(await unmapped.pipeline.run(r1.id)).toMatchObject({
      status: 'failed',
      reason: 'track_unmapped',
    });
    const invisible = setup({ lidarrOptions: { candidateVisible: false } });
    const r2 = invisible.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const out2 = await invisible.pipeline.run(r2.id);
    expect(out2).toMatchObject({ status: 'failed', reason: 'import_failed' });
    expect(out2?.detail).toContain(
      '/files/downloads/music/complete/Tha Carter II/03 - Fireman.flac',
    );
    const rejected = setup({ lidarrOptions: { commandStatus: 'failed' } });
    const r3 = rejected.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const out3 = await rejected.pipeline.run(r3.id);
    expect(out3).toMatchObject({ status: 'failed', reason: 'import_failed' });
    expect(out3?.detail).toContain('Has unmatched tracks');
  });

  it('reuses an existing artist, switching it to the singles profile, and an existing singles profile', async () => {
    const t = setup({
      lidarrOptions: { singlesProfile: true, existingArtist: true, releaseMonitored: true },
    });
    const req = t.stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    expect((await t.pipeline.run(req.id))?.status).toBe('ready');
    expect(t.lidarr.writes.find((w) => w.path === 'metadataprofile')).toBeUndefined();
    expect(t.lidarr.writes.find((w) => w.path === 'artist')).toBeUndefined();
    expect(
      (t.lidarr.writes.find((w) => w.path === 'artist/7')!.body as { metadataProfileId: number })
        .metadataProfileId,
    ).toBe(3);
    expect(t.lidarr.writes.find((w) => w.path.startsWith('album/'))).toBeUndefined();
  });

  it('fails cleanly when MusicBrainz has nothing, when slskd or Lidarr are not configured, and keeps going when scans fail', async () => {
    const miss = setup({ catalogue: fakeCatalogue({ song: undefined, album: undefined }) });
    const r1 = miss.stores.requests.create(
      { kind: 'track', title: 'Nothing', artist: 'Nobody' },
      sahil.id,
    );
    expect(await miss.pipeline.run(r1.id)).toMatchObject({
      status: 'failed',
      reason: 'catalogue_miss',
    });
    const r1b = miss.stores.requests.create(
      { kind: 'album', title: 'Nothing', artist: 'Nobody' },
      sahil.id,
    );
    expect(await miss.pipeline.run(r1b.id)).toMatchObject({
      status: 'failed',
      reason: 'catalogue_miss',
    });
    const off = createPipeline({
      ...setup(),
      slskd: undefined,
      lidarr: undefined,
    } as unknown as PipelineDeps);
    const s = memoryStores();
    const offPipeline = createPipeline({
      stores: s,
      bus: createEventBus(),
      catalogue: fakeCatalogue(),
      library: fakeLibrary().library,
      lidarrDownloadsDir: '/d',
      log: recordingLogger(),
      sleep: instantSleep,
    });
    void off;
    const r2 = s.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    expect(await offPipeline.run(r2.id)).toMatchObject({
      status: 'failed',
      reason: 'not_configured',
    });
    const r3 = s.requests.create(
      { kind: 'album', title: 'Tha Carter II', artist: 'Lil Wayne' },
      sahil.id,
    );
    expect(await offPipeline.run(r3.id)).toMatchObject({
      status: 'failed',
      reason: 'not_configured',
    });
    expect(await offPipeline.run('missing')).toBeUndefined();
    const flaky = setup({
      library: fakeLibrary({ failRefresh: true }).library,
      navidrome: fakeNavidrome(true).client,
    });
    const r4 = flaky.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const out = await flaky.pipeline.run(r4.id);
    expect(out?.status).toBe('ready');
    expect(out?.steps.find((st) => st.detail?.startsWith('Scans:'))?.detail).toBe(
      'Scans: lidarr; failed: navidrome, jellyfin',
    );
  });

  it('stops when the request was cancelled underneath it', async () => {
    const t = setup();
    const service = createRequestService({
      stores: t.stores,
      library: t.lib.library,
      bus: t.bus,
      enqueue: () => {},
    });
    const req = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    expect(service.cancel(sahil, req.id)).toMatchObject({ status: 'failed', reason: 'cancelled' });
    expect(await t.pipeline.run(req.id)).toBeUndefined();
    expect(t.slskd.enqueued).toEqual([]);
    expect(new PipelineError('x', 'y').reason).toBe('x');
  });
});

describe('pipeline: an album', () => {
  it('hands the album to Lidarr monitored, then marks it ready when every track has a file', async () => {
    const t = setup();
    const req = t.stores.requests.create({ kind: 'album', ...carterAlbum }, mom.id);
    const momEvents: HubEvent[] = [];
    t.bus.subscribe(mom.id, (e) => momEvents.push(e));
    const result = await t.pipeline.run(req.id);
    expect(result?.status).toBe('finding');
    expect(result?.detail).toContain('Lidarr is looking for');
    const albumWrite = t.lidarr.writes.find((w) => w.path === 'album')!.body as {
      monitored: boolean;
    };
    expect(albumWrite.monitored).toBe(true);
    expect(t.lidarr.writes.some((w) => (w.body as { name: string }).name === 'AlbumSearch')).toBe(
      true,
    );
    expect(t.slskd.searches).toEqual([]);
    t.lidarr.setAlbumStats({ trackCount: 22, trackFileCount: 10 });
    await t.pipeline.pollAlbums();
    expect(t.stores.requests.get(req.id)?.progress).toEqual({ done: 10, total: 22 });
    t.lidarr.setAlbumStats({ trackCount: 22, trackFileCount: 22 });
    await t.pipeline.pollAlbums();
    const done = t.stores.requests.get(req.id)!;
    expect(done.status).toBe('ready');
    expect(t.stores.collection.list(mom.id)[0]).toMatchObject({
      item: `mb:release-group:${ids.releaseGroup}`,
      kind: 'album',
    });
    expect(momEvents.some((e) => e.type === 'ready')).toBe(true);
    expect(t.events.some((e) => e.type === 'ready')).toBe(false);
    await t.pipeline.pollAlbums();
    expect(t.stores.requests.get(req.id)?.status).toBe('ready');
  });

  it('polls nothing without Lidarr and survives a Lidarr error', async () => {
    const s = memoryStores();
    const noLidarr = createPipeline({
      stores: s,
      bus: createEventBus(),
      catalogue: fakeCatalogue(),
      library: fakeLibrary().library,
      lidarrDownloadsDir: '/d',
      log: recordingLogger(),
      sleep: instantSleep,
    });
    await noLidarr.pollAlbums();
    const t = setup();
    const req = t.stores.requests.create({ kind: 'album', ...carterAlbum }, sahil.id);
    t.stores.requests.update(req.id, { status: 'finding' });
    t.lidarr.client.albumByForeignId = async () => {
      throw new Error('lidarr down');
    };
    await t.pipeline.pollAlbums();
    expect(t.log.lines.some((l) => l.includes('album poll failed'))).toBe(true);
    t.lidarr.client.albumByForeignId = async () => undefined;
    await t.pipeline.pollAlbums();
    expect(t.stores.requests.get(req.id)?.status).toBe('finding');
  });
});

describe('runner', () => {
  it('runs queued requests one at a time and recovers after a restart', async () => {
    const t = setup();
    const runner = createRunner({
      pipeline: t.pipeline,
      stores: t.stores,
      bus: t.bus,
      log: t.log,
      albumPollMs: 60_000,
    });
    const a = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const b = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    runner.enqueue(a.id);
    runner.enqueue(b.id);
    expect(runner.pending()).toBe(2);
    await runner.idle();
    expect(t.stores.requests.get(a.id)?.status).toBe('ready');
    expect(t.stores.requests.get(b.id)?.status).toBe('ready');
    expect(runner.pending()).toBe(0);
    await runner.idle();

    const inFlight = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    t.stores.requests.update(inFlight.id, { status: 'downloading' });
    const album = t.stores.requests.create({ kind: 'album', ...carterAlbum }, sahil.id);
    t.stores.requests.update(album.id, { status: 'finding' });
    const fresh = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    runner.start();
    await runner.idle();
    runner.stop();
    expect(t.stores.requests.get(inFlight.id)).toMatchObject({
      status: 'failed',
      reason: 'interrupted',
    });
    expect(t.stores.requests.get(album.id)?.status).toBe('finding');
    expect(t.stores.requests.get(fresh.id)?.status).toBe('ready');
    expect(t.log.lines.some((l) => l.includes('requests resumed'))).toBe(true);
  });
});
