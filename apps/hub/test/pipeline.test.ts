import type { HubEvent } from '@renaissance/core';
import { describe, expect, it } from 'vitest';

import { createEventBus } from '../src/events/bus.js';
import {
  PipelineError,
  describePick,
  lidarrPathFor,
  mapTrack,
  pickRelease,
} from '../src/fetch/pipeline.js';
import type { PipelineDeps } from '../src/fetch/pipeline.js';
import { createRunner } from '../src/fetch/runner.js';
import { recordingLogger } from '../src/log.js';
import type { CreateResult } from '../src/requests/service.js';
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
import {
  createPipeline,
  createRequestService,
  instantSleep,
  memoryStores,
  mom,
  sahil,
} from './helpers.js';

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
    let clock = 1_000_000;
    const t = setup({
      transfers: {
        [FLAC]: [
          { state: 'InProgress', bytesTransferred: 15_000_000 },
          { state: 'Completed, Succeeded' },
        ],
      },
      downloadTimeoutMs: 60_000,
      tracksTimeoutMs: 60_000,
      // Each look at the clock is two seconds later, so the estimate has a rate to work from.
      now: () => (clock += 2_000),
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
      'downloading',
      'downloading',
      'importing',
      'importing',
      'importing',
      'ready',
    ]);
    // The progress write carried the percentage and an estimate, and added no step.
    const progressEvent = t.events.find(
      (e) => e.type === 'request' && e.request.progress?.done === 50,
    ) as Extract<HubEvent, { type: 'request' }>;
    expect(progressEvent.request.progress).toMatchObject({ unit: 'percent', total: 100 });
    expect(progressEvent.request.progress?.etaSeconds).toBeGreaterThanOrEqual(1);
    expect(result?.steps.filter((s) => s.status === 'downloading')).toHaveLength(2);
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
    expect(result?.steps.some((s) => s.detail === 'Importing 03 - Fireman.flac')).toBe(true);
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
    expect(out?.detail).toContain('not finished after');
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

  it('never touches an existing artist (profile or monitoring); adds the album explicitly and says so', async () => {
    const t = setup({
      lidarrOptions: { singlesProfile: true, existingArtist: true, releaseMonitored: true },
    });
    const req = t.stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    const out = await t.pipeline.run(req.id);
    expect(out?.status).toBe('ready');
    expect(t.lidarr.writes.find((w) => w.path === 'metadataprofile')).toBeUndefined();
    expect(t.lidarr.writes.find((w) => w.path === 'artist')).toBeUndefined();
    expect(t.lidarr.writes.find((w) => w.path.startsWith('artist/'))).toBeUndefined();
    expect(t.lidarr.artists[0]?.metadataProfileId).toBe(1);
    expect(t.lidarr.writes.find((w) => w.path === 'album')).toBeDefined();
    expect(t.lidarr.writes.find((w) => w.path.startsWith('album/'))).toBeUndefined();
    expect(
      out?.steps.find((s) => s.detail?.includes('profile and monitoring unchanged'))?.detail,
    ).toContain('Using the Lidarr artist Lil Wayne as it is');
    // A new artist still gets the singles profile and no monitoring of new items.
    const fresh = setup({ lidarrOptions: { singlesProfile: true } });
    const r2 = fresh.stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    expect((await fresh.pipeline.run(r2.id))?.status).toBe('ready');
    const added = fresh.lidarr.writes.find((w) => w.path === 'artist')!.body as Record<
      string,
      unknown
    >;
    expect(added.metadataProfileId).toBe(3);
    expect(added.monitorNewItems).toBe('none');
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
    const cancelled = await service.cancel(sahil, req.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', detail: 'Cancelled by Sahil' });
    expect((cancelled as { reason?: string }).reason).toBeUndefined();
    expect(await t.pipeline.run(req.id)).toBeUndefined();
    expect(t.slskd.enqueued).toEqual([]);
    expect(t.stores.requests.get(req.id)?.status).toBe('cancelled');
    expect(new PipelineError('x', 'y').reason).toBe('x');
  });

  it('a cancel that lands mid-search stops everything: no download, no overwrite, still cancelled', async () => {
    const t = setup({
      slskdResults: {
        'lil wayne fireman': [],
        'wayne fireman': [response('cuchillo', [{}])],
      },
    });
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
    // Mom taps cancel while the first slskd query is still out.
    const original = t.slskd.client.search.bind(t.slskd.client);
    t.slskd.client.search = async (text) => {
      const out = await original(text);
      if (text === 'lil wayne fireman') await service.cancel(sahil, req.id);
      return out;
    };
    expect(await t.pipeline.run(req.id)).toBeUndefined();
    const row = t.stores.requests.get(req.id)!;
    expect(row.status).toBe('cancelled');
    expect(row.reason).toBeUndefined();
    expect(t.slskd.enqueued).toEqual([]);
    expect(row.steps.map((s) => s.status)).toEqual([
      'requested',
      'finding',
      'finding',
      'cancelled',
    ]);
    expect(t.log.lines.some((l) => l.includes('request stopped'))).toBe(true);
  });

  it('a cancel that lands while a step is failing never throws and leaves the row cancelled', async () => {
    const t = setup({ slskdResults: { 'lil wayne fireman': [] } });
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
    t.slskd.client.search = async () => {
      await service.cancel(sahil, req.id);
      throw new Error('slskd unreachable');
    };
    const runner = createRunner({
      pipeline: t.pipeline,
      stores: t.stores,
      bus: t.bus,
      log: t.log,
      albumPollMs: 60_000,
    });
    runner.enqueue(req.id);
    await expect(runner.idle()).resolves.toBeUndefined();
    expect(runner.pending()).toBe(0);
    expect(t.stores.requests.get(req.id)).toMatchObject({ status: 'cancelled' });
    // The queue is not wedged: the next request runs.
    const next = t.stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    t.slskd.client.search = async () => [response('cuchillo', [{}])];
    runner.enqueue(next.id);
    await runner.idle();
    expect(t.stores.requests.get(next.id)?.status).toBe('ready');
    // A run whose pipeline throws outright is logged and the queue still drains.
    const throwing = createRunner({
      pipeline: {
        run: async () => {
          throw new Error('unexpected');
        },
        pollAlbums: async () => {},
        abandon: async () => undefined,
        dueRetries: () => [],
      },
      stores: t.stores,
      bus: t.bus,
      log: t.log,
    });
    throwing.enqueue('x');
    await expect(throwing.idle()).resolves.toBeUndefined();
    expect(throwing.pending()).toBe(0);
    expect(t.log.lines.some((l) => l.includes('request run threw'))).toBe(true);
  });

  it('counts a missing transfer record as a failed attempt, and in dry run as downloaded', async () => {
    const t = setup({ missingTransferPolls: 1 });
    t.slskd.client.transfers = async () => [];
    const req = t.stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    const out = await t.pipeline.run(req.id);
    expect(out).toMatchObject({ status: 'failed', reason: 'download_failed' });
    expect(out?.detail).toContain('slskd has no transfer for it');
    const dry = setup({ dryRun: true });
    dry.slskd.client.transfers = async () => [];
    const r2 = dry.stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    const out2 = await dry.pipeline.run(r2.id);
    expect(out2?.status).toBe('ready');
    expect(out2?.steps.some((s) => s.detail?.startsWith('Dry run:'))).toBe(true);
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
    // No statistics yet: the total is the monitored release's track count, never "0 of 0".
    expect(result?.progress).toEqual({ unit: 'songs', done: 0, total: 22 });
    t.lidarr.setAlbumStats({ trackCount: 22, trackFileCount: 10 });
    await t.pipeline.pollAlbums();
    await t.pipeline.pollAlbums();
    const polled = t.stores.requests.get(req.id)!;
    expect(polled.progress).toEqual({ unit: 'songs', done: 10, total: 22 });
    // Polls change progress only: the step log did not grow.
    expect(polled.steps).toHaveLength(result!.steps.length);
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

describe('pipeline: retries and releases', () => {
  it('resumes at the import when the request already has its downloaded file', async () => {
    const t = setup();
    const req = t.stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    t.stores.requests.update(req.id, {
      status: 'failed',
      reason: 'lidarr_album',
      ids: { sourceFile: FLAC },
    });
    const service = createRequestService({
      stores: t.stores,
      library: t.lib.library,
      bus: t.bus,
      enqueue: () => {},
    });
    expect(service.retry(sahil, req.id)).toMatchObject({ status: 'requested' });
    expect(service.retry(sahil, req.id)).toBe('not_failed');
    const requested = t.stores.requests.get(req.id)!;
    expect(requested.steps.map((s) => s.status)).toEqual(['requested', 'failed', 'requested']);
    expect(service.retry(sahil, 'nope')).toBe('not_found');
    const result = await t.pipeline.run(req.id);
    expect(result?.status).toBe('ready');
    expect(t.slskd.searches).toEqual([]);
    expect(t.slskd.enqueued).toEqual([]);
    expect(result?.steps.some((s) => s.detail?.includes('downloaded earlier'))).toBe(true);
    const cancelled = t.stores.requests.create({ kind: 'track', ...firemanSong }, sahil.id);
    t.stores.requests.update(cancelled.id, { status: 'cancelled' });
    expect(service.retry(sahil, cancelled.id)).toBe('not_failed');
  });

  it('records the downloaded file on the request and waits for Lidarr to fill the releases', async () => {
    const t = setup();
    let albumReads = 0;
    const realAlbum = t.lidarr.client.album;
    const realAdd = t.lidarr.client.addAlbum;
    t.lidarr.client.addAlbum = async (a) => {
      const created = await realAdd(a);
      const stored = t.lidarr.albums.find((x) => x.id === created.id)!;
      const releases = stored.releases ?? [];
      stored.releases = [];
      t.lidarr.client.album = async (id) => {
        albumReads += 1;
        if (albumReads >= 2) stored.releases = releases;
        return realAlbum(id);
      };
      return { ...created, releases: [] };
    };
    const req = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const result = await t.pipeline.run(req.id);
    expect(result?.status).toBe('ready');
    expect(result?.sourceFile).toBe(FLAC);
    expect(albumReads).toBeGreaterThanOrEqual(2);
  });

  it('in dry-run, maps against MusicBrainz tracks and logs the import it would send', async () => {
    const t = setup({ dryRun: true, lidarrOptions: { tracks: [], candidateVisible: false } });
    t.lidarr.client.tracks = async () => [];
    const catalogue = fakeCatalogue();
    catalogue.release = async () => ({
      id: ids.release,
      title: 'Tha Carter II',
      media: [
        {
          tracks: [
            {
              id: 'mt1',
              number: '4',
              title: 'Fireman',
              recording: { id: ids.recording, title: 'Fireman' },
            },
          ],
        },
      ],
    });
    const dry = createPipeline({
      stores: t.stores,
      bus: t.bus,
      catalogue,
      library: t.lib.library,
      slskd: t.slskd.client,
      lidarr: t.lidarr.client,
      lidarrDownloadsDir: '/files/downloads/music/complete',
      log: t.log,
      sleep: instantSleep,
      tracksTimeoutMs: 1,
      dryRun: true,
    });
    const req = t.stores.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const result = await dry.run(req.id);
    expect(result?.status).toBe('ready');
    expect(t.log.lines.some((l) => l.includes('would import this file once downloaded'))).toBe(
      true,
    );
    const importCmd = t.lidarr.writes.find(
      (w) => (w.body as { name: string }).name === 'ManualImport',
    )!.body as { files: { trackIds: number[]; quality: { quality: { name: string } } }[] };
    expect(importCmd.files[0]!.trackIds).toEqual([-1]);
    expect(importCmd.files[0]!.quality.quality.name).toBe('Unknown');
  });
});

describe('pipeline: album deadline and cancel', () => {
  it('fails an album nobody found within the deadline and unmonitors it', async () => {
    let clock = Date.parse('2026-11-18T00:00:00Z');
    const t = setup({ albumDeadlineMs: 2 * 24 * 60 * 60_000, now: () => clock });
    const req = t.stores.requests.create({ kind: 'album', ...carterAlbum }, mom.id);
    // created_at is the store's clock: pin it to the test clock.
    t.stores.db
      .prepare('UPDATE requests SET created_at = ? WHERE id = ?')
      .run(new Date(clock).toISOString(), req.id);
    expect((await t.pipeline.run(req.id))?.status).toBe('finding');
    expect(t.stores.requests.get(req.id)?.detail).toContain('for up to 2 days');
    t.lidarr.setAlbumStats({ trackCount: 22, trackFileCount: 3 });
    clock += 24 * 60 * 60_000;
    await t.pipeline.pollAlbums();
    expect(t.stores.requests.get(req.id)).toMatchObject({
      status: 'finding',
      progress: { unit: 'songs', done: 3, total: 22 },
    });
    clock += 2 * 24 * 60 * 60_000;
    await t.pipeline.pollAlbums();
    const failed = t.stores.requests.get(req.id)!;
    expect(failed).toMatchObject({ status: 'failed', reason: 'not_found_in_time' });
    expect(failed.detail).toContain('3 of 22 tracks in 2 days');
    expect(failed.detail).toContain('no longer monitors');
    const albumWrite = t.lidarr.writes.filter((w) => w.path.startsWith('album/')).pop()!.body as {
      monitored: boolean;
    };
    expect(albumWrite.monitored).toBe(false);
  });

  it('cancelling an album request unmonitors it in Lidarr and says so; a poll of a cancelled row is skipped', async () => {
    const t = setup();
    const service = createRequestService({
      stores: t.stores,
      library: t.lib.library,
      bus: t.bus,
      enqueue: () => {},
      abandon: (r) => t.pipeline.abandon(r),
    });
    const req = t.stores.requests.create({ kind: 'album', ...carterAlbum }, mom.id);
    expect((await t.pipeline.run(req.id))?.status).toBe('finding');
    const cancelled = await service.cancel(mom, req.id);
    expect(cancelled).toMatchObject({ status: 'cancelled' });
    expect((cancelled as { detail: string }).detail).toBe(
      'Cancelled by Mom; Lidarr no longer monitors Tha Carter II',
    );
    expect(t.lidarr.albums[0]?.monitored).toBe(false);
    t.lidarr.setAlbumStats({ trackCount: 22, trackFileCount: 22 });
    await t.pipeline.pollAlbums();
    expect(t.stores.requests.get(req.id)?.status).toBe('cancelled');
    expect(t.stores.collection.list(mom.id)).toEqual([]);
    // Unmonitoring is best effort: a Lidarr error is logged, the cancel still lands.
    const r2 = t.stores.requests.create({ kind: 'album', ...carterAlbum }, mom.id);
    t.lidarr.client.albumByForeignId = async () => {
      throw new Error('lidarr down');
    };
    expect(await service.cancel(mom, r2.id)).toMatchObject({
      status: 'cancelled',
      detail: 'Cancelled by Mom',
    });
    expect(t.log.lines.some((l) => l.includes('could not unmonitor'))).toBe(true);
    // Nothing to do without ids or without Lidarr.
    const bare = t.stores.requests.create(
      { kind: 'album', title: 'Red', artist: 'Taylor Swift' },
      mom.id,
    );
    expect(await t.pipeline.abandon(bare)).toBeUndefined();
    const r3 = t.stores.requests.create({ kind: 'track', ...firemanSong }, mom.id);
    expect(await service.cancel(mom, r3.id)).toMatchObject({ detail: 'Cancelled by Mom' });
  });
});

describe('request service: duplicates', () => {
  it('answers a second request for the same song with the one already running', async () => {
    const t = setup();
    const enqueued: string[] = [];
    const service = createRequestService({
      stores: t.stores,
      library: t.lib.library,
      bus: t.bus,
      enqueue: (id) => enqueued.push(id),
    });
    const first = (await service.create(sahil, { kind: 'track', ...firemanSong })) as Extract<
      CreateResult,
      { kind: 'request' }
    >;
    expect(first.kind).toBe('request');
    const again = await service.create(mom, { kind: 'track', ...firemanSong });
    expect(again).toMatchObject({ kind: 'duplicate', request: { id: first.request.id } });
    const byName = await service.create(mom, {
      kind: 'track',
      title: 'FIREMAN',
      artist: 'lil wayne',
    });
    expect(byName.kind).toBe('duplicate');
    const album = await service.create(mom, { kind: 'album', ...carterAlbum });
    expect(album.kind).toBe('request');
    expect(await service.create(sahil, { kind: 'album', ...carterAlbum })).toMatchObject({
      kind: 'duplicate',
    });
    const other = (await service.create(mom, {
      kind: 'track',
      ...firemanSong,
      recordingId: '00000000-0000-4000-8000-000000000001',
    })) as Extract<CreateResult, { kind: 'request' }>;
    expect(other.kind).toBe('request');
    expect(enqueued).toHaveLength(3);
    // Once the first is done (or failed), a new request for the same song is allowed again.
    t.stores.requests.update(first.request.id, { status: 'failed', reason: 'no_results' });
    t.stores.requests.update(other.request.id, { status: 'ready' });
    expect((await service.create(mom, { kind: 'track', ...firemanSong })).kind).toBe('request');
  });
});
