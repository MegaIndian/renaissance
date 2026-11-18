import { describe, expect, it, vi } from 'vitest';

import { deezerClient } from '../src/catalogue/deezer.js';
import {
  musicBrainzClient,
  recordingQuery,
  releaseGroupQuery,
  userAgent,
} from '../src/catalogue/musicbrainz.js';
import { LimiterBusyError, createRateLimiter } from '../src/catalogue/rate-limiter.js';
import {
  SEARCH_TTL_MS,
  albumFromReleaseGroup,
  artistsFromCredits,
  catalogueService,
  coverArt,
  creditName,
  pickRelease,
  songFromRecording,
} from '../src/catalogue/service.js';
import type { MbRecording, MbReleaseGroup } from '../src/catalogue/musicbrainz.js';
import { fakeFetch, memoryStores } from './helpers.js';

const wayne = {
  name: 'Lil Wayne',
  artist: { id: 'ac9a487a-d9d2-4f27-bb23-0f4686488345', name: 'Lil Wayne' },
};
const rg = {
  id: '8ea5d7a4-0b31-4b2a-9b7f-0d6c0f4e0c11',
  title: 'Tha Carter II',
  'primary-type': 'Album',
  'first-release-date': '2005-12-06',
};
const fireman: MbRecording = {
  id: '3f3d2a1e-5c5e-4a1a-9b1e-7f0c4a6d2b10',
  title: 'Fireman',
  length: 183_000,
  'artist-credit': [wayne],
  releases: [
    {
      id: 'c0ffee00-0000-4000-8000-000000000001',
      title: 'Fireman',
      status: 'Official',
      date: '2005-10-18',
      'release-group': {
        id: 'c0ffee00-0000-4000-8000-000000000002',
        title: 'Fireman',
        'primary-type': 'Single',
      },
    },
    {
      id: 'c0ffee00-0000-4000-8000-000000000003',
      title: 'Tha Carter II',
      status: 'Official',
      date: '2005-12-06',
      'release-group': rg,
    },
    {
      id: 'c0ffee00-0000-4000-8000-000000000004',
      title: 'Now Hits 2006',
      status: 'Official',
      'release-group': {
        id: 'c0ffee00-0000-4000-8000-000000000005',
        title: 'Now',
        'primary-type': 'Album',
        'secondary-types': ['Compilation'],
      },
    },
  ],
};
const deezerTrack = {
  id: 1,
  title: 'Fireman',
  duration: 183,
  preview: 'https://cdn.deezer.test/fireman.mp3',
  artist: { id: 2, name: 'Lil Wayne', picture_medium: 'https://cdn.deezer.test/wayne.jpg' },
  album: { id: 3, title: 'Tha Carter II', cover_medium: 'https://cdn.deezer.test/carter2.jpg' },
};

describe('rate limiter', () => {
  it('spaces calls by the interval, in order', async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter(1000);
    const order: number[] = [];
    const a = limiter.schedule(async () => order.push(1));
    const b = limiter.schedule(async () => order.push(2));
    const c = limiter.schedule(async () => {
      throw new Error('boom');
    });
    const d = limiter.schedule(async () => order.push(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([a, b, d, c.catch(() => undefined)]);
    expect(order).toEqual([1, 2, 3]);
    vi.useRealTimers();
  });
});

describe('musicBrainzClient', () => {
  it('sends the user agent and json format and parses each list', async () => {
    const { fetch, calls } = fakeFetch({
      '/recording?': () => ({ recordings: [fireman] }),
      '/release-group?': () => ({ 'release-groups': [{ ...rg, 'artist-credit': [wayne] }] }),
      '/artist?': () => ({ artists: [{ id: wayne.artist.id, name: 'Lil Wayne' }] }),
      '/release/': () => ({ id: 'r', title: 'Tha Carter II', media: [] }),
      '/recording/': () => fireman,
    });
    const mb = musicBrainzClient({
      version: '1.2.3',
      contact: 'me@example.com',
      fetch,
      limiter: createRateLimiter(0),
    });
    expect((await mb.searchRecordings('fireman'))[0]?.title).toBe('Fireman');
    expect((await mb.searchReleaseGroups('carter'))[0]?.title).toBe('Tha Carter II');
    expect((await mb.searchArtists('wayne'))[0]?.name).toBe('Lil Wayne');
    expect((await mb.release('r')).title).toBe('Tha Carter II');
    expect((await mb.recording(fireman.id)).id).toBe(fireman.id);
    expect(calls[0]!.headers['user-agent']).toBe('Renaissance/1.2.3 (me@example.com)');
    expect(calls[0]!.url).toContain('fmt=json');
    expect(userAgent('0.0.1', undefined)).toBe(
      'Renaissance/0.0.1 (https://github.com/MegaIndian/renaissance)',
    );
    expect(recordingQuery('Fireman', 'Lil Wayne')).toBe(
      'recording:"Fireman" AND artist:"Lil Wayne"',
    );
    expect(recordingQuery('Fire: man')).toBe('Fire\\: man');
    expect(releaseGroupQuery('Tha Carter II', 'Lil Wayne')).toBe(
      'releasegroup:"Tha Carter II" AND artist:"Lil Wayne"',
    );
    expect(releaseGroupQuery('x')).toBe('x');
  });

  it('answers empty lists when the body has none', async () => {
    const { fetch } = fakeFetch({
      '/recording?': () => ({}),
      '/release-group?': () => ({}),
      '/artist?': () => ({}),
    });
    const mb = musicBrainzClient({
      version: '1',
      contact: undefined,
      fetch,
      limiter: createRateLimiter(0),
    });
    expect(await mb.searchRecordings('x')).toEqual([]);
    expect(await mb.searchReleaseGroups('x')).toEqual([]);
    expect(await mb.searchArtists('x')).toEqual([]);
  });
});

describe('deezerClient', () => {
  it('returns tracks, albums and artists, and reports a failure or a quota error as no answer', async () => {
    const limiter = createRateLimiter(0);
    const ok = deezerClient({
      fetch: fakeFetch({
        '/search/album': () => ({
          data: [{ id: 3, title: 'Tha Carter II', artist: deezerTrack.artist }],
        }),
        '/search/artist': () => ({ data: [deezerTrack.artist] }),
        '/search': () => ({ data: [deezerTrack] }),
      }).fetch,
      limiter,
    });
    expect((await ok.search('fireman'))?.[0]?.preview).toBe(deezerTrack.preview);
    expect((await ok.searchAlbums('carter'))?.[0]?.title).toBe('Tha Carter II');
    expect((await ok.searchArtists('wayne'))?.[0]?.name).toBe('Lil Wayne');
    const down = deezerClient({
      fetch: fakeFetch({ '/search': () => ({ __status: 500 }) }).fetch,
      limiter,
    });
    expect(await down.search('fireman')).toBeUndefined();
    const empty = deezerClient({ fetch: fakeFetch({ '/search': () => ({}) }).fetch, limiter });
    expect(await empty.search('fireman')).toBeUndefined();
    // The quota: a 200 with an error body and no data is not "nothing found".
    const quota = deezerClient({
      fetch: fakeFetch({
        '/search': () => ({
          error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 },
        }),
      }).fetch,
      limiter,
    });
    expect(await quota.search('fireman')).toBeUndefined();
  });
});

describe('mapping', () => {
  it('prefers an official album or single over a compilation', () => {
    expect(pickRelease(fireman)?.title).toBe('Tha Carter II');
    expect(pickRelease({ ...fireman, releases: [] })).toBeUndefined();
  });

  it('builds a song with Deezer art and preview, falling back to Cover Art Archive', () => {
    const song = songFromRecording(fireman, [deezerTrack])!;
    expect(song).toMatchObject({
      id: `mb:recording:${fireman.id}`,
      title: 'Fireman',
      artist: 'Lil Wayne',
      artistId: wayne.artist.id,
      album: 'Tha Carter II',
      releaseGroupId: rg.id,
      duration: 183,
      year: 2005,
      preview: deezerTrack.preview,
      art: deezerTrack.album.cover_medium,
    });
    const bare = songFromRecording(fireman, [])!;
    expect(bare.art).toBe(coverArt(rg.id));
    expect(bare.preview).toBeUndefined();
    expect(songFromRecording({ id: 'x', title: '' }, [])).toBeUndefined();
    const noRelease = songFromRecording(
      { id: 'x', title: 'T', 'artist-credit': [wayne], 'first-release-date': '1999' },
      [],
    )!;
    expect(noRelease.year).toBe(1999);
    expect(noRelease.album).toBeUndefined();
  });

  it('builds albums and artists from credits without extra calls', () => {
    const group: MbReleaseGroup = { ...rg, 'artist-credit': [wayne] };
    const album = albumFromReleaseGroup(group, [deezerTrack])!;
    expect(album).toMatchObject({
      id: `mb:release-group:${rg.id}`,
      title: 'Tha Carter II',
      artist: 'Lil Wayne',
      type: 'Album',
      year: 2005,
      art: deezerTrack.album.cover_medium,
    });
    expect(albumFromReleaseGroup(group, [])!.art).toBe(coverArt(rg.id));
    expect(albumFromReleaseGroup({ id: 'x', title: 'T' }, [])).toBeUndefined();
    const artists = artistsFromCredits([fireman], [group], [deezerTrack]);
    expect(artists).toEqual([
      {
        id: `mb:artist:${wayne.artist.id}`,
        artistId: wayne.artist.id,
        name: 'Lil Wayne',
        art: deezerTrack.artist.picture_medium,
      },
    ]);
    expect(
      creditName([wayne, { name: 'Robin Thicke', artist: { id: 'r', name: 'Robin Thicke' } }]),
    ).toBe('Lil Wayne Robin Thicke');
    expect(
      creditName([
        { name: 'Lil Wayne feat. ', artist: { id: 'a', name: 'Lil Wayne' } },
        { name: 'X', artist: { id: 'b', name: 'X' } },
      ]),
    ).toBe('Lil Wayne feat.  X');
    expect(creditName(undefined)).toBe('');
  });
});

describe('catalogueService', () => {
  function service() {
    const stores = memoryStores();
    const { fetch, calls } = fakeFetch({
      'musicbrainz.org/ws/2/recording?': () => ({
        recordings: [
          fireman,
          { ...fireman, id: 'dup', title: 'Fireman' },
          { ...fireman, id: 'vid', title: 'Fireman (video)', video: true },
        ],
      }),
      'musicbrainz.org/ws/2/release-group?': () => ({
        'release-groups': [{ ...rg, 'artist-credit': [wayne] }],
      }),
      'api.deezer.com/search': () => ({ data: [deezerTrack] }),
      'musicbrainz.org/ws/2/release/': () => ({
        id: 'c0ffee00-0000-4000-8000-000000000003',
        title: 'Tha Carter II',
        media: [{ tracks: [{ id: 't1', number: '3', title: 'Fireman' }] }],
      }),
    });
    const mb = musicBrainzClient({
      version: '1',
      contact: undefined,
      fetch,
      limiter: createRateLimiter(0),
    });
    return {
      svc: catalogueService({
        musicBrainz: mb,
        deezer: deezerClient({ fetch }),
        cache: stores.cache,
      }),
      calls,
      stores,
    };
  }

  it('merges songs, albums and artists, dedupes, skips videos, and caches', async () => {
    const { svc, calls } = service();
    const result = await svc.search('  lil wayne   fireman ');
    expect(result.query).toBe('lil wayne fireman');
    expect(result.songs.map((s) => s.title)).toEqual(['Fireman']);
    expect(result.albums[0]?.title).toBe('Tha Carter II');
    expect(result.artists[0]?.name).toBe('Lil Wayne');
    expect(result.cached).toBe(false);
    const musicBrainzCalls = calls.filter((c) => c.url.includes('musicbrainz')).length;
    const again = await svc.search('Lil Wayne Fireman');
    expect(again.cached).toBe(true);
    expect(calls.filter((c) => c.url.includes('musicbrainz')).length).toBe(musicBrainzCalls);
    expect(SEARCH_TTL_MS).toBe(86_400_000);
  });

  it('finds one song or album by title and artist, caching misses too', async () => {
    const { svc, calls } = service();
    const song = await svc.findSong('Fireman', 'Lil Wayne');
    expect(song?.recordingId).toBe(fireman.id);
    const before = calls.length;
    await svc.findSong('fireman', 'LIL WAYNE');
    expect(calls.length).toBe(before);
    const album = await svc.findAlbum('Tha Carter II', 'Lil Wayne');
    expect(album?.releaseGroupId).toBe(rg.id);
    expect((await svc.release('c0ffee00-0000-4000-8000-000000000003')).title).toBe('Tha Carter II');
    await svc.release('c0ffee00-0000-4000-8000-000000000003');
    expect(calls.filter((c) => c.url.includes('/release/')).length).toBe(1);
  });

  it('never lets a remix or another title stand in for the song, accepts a feature credit, and remembers a miss', async () => {
    const stores = memoryStores();
    const { fetch } = fakeFetch({
      '/recording?': (url) => {
        const q = url.searchParams.get('query') ?? '';
        if (q.includes('Nothing')) return { recordings: [] };
        if (q.includes('Drowning')) {
          return {
            recordings: [
              {
                ...fireman,
                id: 'c0ffee00-0000-4000-8000-00000000d001',
                title: 'Drowning (feat. Kodak Black)',
              },
            ],
          };
        }
        if (q.includes('Kolaveri')) {
          return {
            recordings: [
              {
                ...fireman,
                id: 'c0ffee00-0000-4000-8000-00000000d002',
                title: 'Why This Kolaveri Di (The Soup of Love)',
              },
            ],
          };
        }
        // What MusicBrainz lists for "Fireman" by Lil Wayne when the plain recording is missing:
        // a remix, a song whose title merely contains the words, and a different song.
        return {
          recordings: [
            { ...fireman, id: 'c0ffee00-0000-4000-8000-00000000a001', title: 'Fireman (Remix)' },
            { ...fireman, id: 'c0ffee00-0000-4000-8000-00000000a002', title: 'Lil Wayne Fireman' },
            { ...fireman, id: 'c0ffee00-0000-4000-8000-00000000a003', title: 'Hustler Musik' },
          ],
        };
      },
      '/release-group?': () => ({ 'release-groups': [] }),
    });
    const mb = musicBrainzClient({
      version: '1',
      contact: undefined,
      fetch,
      limiter: createRateLimiter(0),
    });
    const svc = catalogueService({
      musicBrainz: mb,
      deezer: deezerClient({ fetch }),
      cache: stores.cache,
    });
    // A remix is another song: the request fails with catalogue_miss rather than fetching it.
    expect(await svc.findSong('Fireman', 'Lil Wayne')).toBeUndefined();
    // A feature credit or a subtitle in the title is the same song.
    expect((await svc.findSong('Drowning', 'Lil Wayne'))?.title).toBe(
      'Drowning (feat. Kodak Black)',
    );
    expect((await svc.findSong('Why This Kolaveri Di', 'Lil Wayne'))?.title).toBe(
      'Why This Kolaveri Di (The Soup of Love)',
    );
    expect(await svc.findSong('Nothing', 'Nobody')).toBeUndefined();
    expect(await svc.findSong('Nothing', 'Nobody')).toBeUndefined();
    expect(await svc.findAlbum('Nothing', 'Nobody')).toBeUndefined();
  });
});

describe('recording choice', () => {
  const mixtape: MbRecording = {
    id: 'mix',
    title: 'Fireman',
    length: 247_000,
    'artist-credit': [wayne],
    releases: [
      {
        id: 'r-mix',
        title: 'The Suffix: Remastered',
        status: 'Official',
        date: '2005-11-20',
        'release-group': {
          id: 'rg-mix',
          title: 'The Suffix',
          'primary-type': 'Album',
          'secondary-types': ['Mixtape/Street'],
        },
      },
    ],
  };
  const bootleg: MbRecording = {
    id: 'boot',
    title: 'Fireman',
    'artist-credit': [wayne],
    releases: [
      {
        id: 'r-boot',
        title: 'Gold',
        status: 'Bootleg',
        'release-group': { id: 'rg-boot', title: 'Gold', 'primary-type': 'Album' },
      },
    ],
  };

  it('scores official albums above mixtapes and bootlegs', async () => {
    const { releaseScore, recordingScore } = await import('../src/catalogue/service.js');
    expect(releaseScore(fireman.releases![1]!)).toBeGreaterThan(
      releaseScore(mixtape.releases![0]!),
    );
    expect(releaseScore(mixtape.releases![0]!)).toBeGreaterThan(
      releaseScore(bootleg.releases![0]!),
    );
    expect(recordingScore(fireman)).toBeGreaterThan(recordingScore(mixtape));
    expect(recordingScore({ id: 'none', title: 'x' })).toBeLessThan(recordingScore(bootleg));
  });

  it('findSong picks the canonical recording even when MusicBrainz lists a mixtape first', async () => {
    const stores = memoryStores();
    const { fetch } = fakeFetch({
      '/recording?': () => ({ recordings: [mixtape, bootleg, fireman] }),
    });
    const mb = musicBrainzClient({
      version: '1',
      contact: undefined,
      fetch,
      limiter: createRateLimiter(0),
    });
    const svc = catalogueService({
      musicBrainz: mb,
      deezer: deezerClient({ fetch }),
      cache: stores.cache,
    });
    const song = await svc.findSong('Fireman', 'Lil Wayne');
    expect(song?.recordingId).toBe(fireman.id);
    expect(song?.album).toBe('Tha Carter II');
  });

  it('retries a MusicBrainz 503 twice, then gives up', async () => {
    let calls = 0;
    const { fetch } = fakeFetch({
      '/recording?': () => (++calls < 3 ? { __status: 503 } : { recordings: [fireman] }),
    });
    const mb = musicBrainzClient({
      version: '1',
      contact: undefined,
      fetch,
      limiter: createRateLimiter(0),
      sleep: async () => {},
    });
    expect((await mb.searchRecordings('fireman')).length).toBe(1);
    expect(calls).toBe(3);
    const always = musicBrainzClient({
      version: '1',
      contact: undefined,
      fetch: fakeFetch({ '/recording?': () => ({ __status: 503 }) }).fetch,
      limiter: createRateLimiter(0),
      sleep: async () => {},
    });
    await expect(always.searchRecordings('x')).rejects.toThrow('503');
    const other = musicBrainzClient({
      version: '1',
      contact: undefined,
      fetch: fakeFetch({ '/recording?': () => ({ __status: 400 }) }).fetch,
      limiter: createRateLimiter(0),
      sleep: async () => {},
    });
    await expect(other.searchRecordings('x')).rejects.toThrow('400');
  });
});

describe('rate limiter: four typists', () => {
  it('shares identical in-flight keys, drops a superseded search, and fails fast past the cap', async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter(1000, { maxQueue: 3 });
    const ran: string[] = [];
    const call = (name: string) => async () => {
      ran.push(name);
      return name;
    };
    // Two phones typing the same word cost one call.
    const a1 = limiter.schedule(call('fireman'), { key: 'fireman', owner: 'sahil', batch: 'f' });
    const a2 = limiter.schedule(call('fireman'), { key: 'fireman', owner: 'mom', batch: 'f' });
    // One call, but each phone holds its own promise (so one moving on never fails the other).
    expect(a1).not.toBe(a2);
    // Mom types on: her earlier prefix (a different batch) is dropped while it waits.
    const old = limiter.schedule(call('fire'), { key: 'fire', owner: 'mom', batch: 'fire' });
    const older = limiter.schedule(call('fir'), { key: 'fir', owner: 'kevin', batch: 'fir' });
    const newer = limiter.schedule(call('firem'), { key: 'firem', owner: 'mom', batch: 'firem' });
    // "fireman" is running; "fir" and "firem" wait; "fire" was dropped.
    expect(limiter.queued()).toBe(2);
    // The queue is capped: a fourth waiting call is refused at once.
    const spare = limiter.schedule(call('x'), { key: 'x', owner: 'dad', batch: 'x' });
    const refused = limiter.schedule(call('too many'));
    await expect(old).rejects.toMatchObject({ name: 'LimiterBusyError', code: 'superseded' });
    await expect(refused).rejects.toMatchObject({ code: 'busy' });
    await vi.advanceTimersByTimeAsync(0);
    expect(await a1).toBe('fireman');
    expect(await a2).toBe('fireman');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await older).toBe('fir');
    expect(await newer).toBe('firem');
    expect(await spare).toBe('x');
    expect(ran).toEqual(['fireman', 'fir', 'firem', 'x']);
    // Once settled the key is free again, and a call without options still works.
    const again = limiter.schedule(call('fireman'), { key: 'fireman' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await again).toBe('fireman');
    const plain = limiter.schedule(call('plain'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await plain).toBe('plain');
    expect(new LimiterBusyError('busy').message).toContain('busy');
    vi.useRealTimers();
  });

  it('drops a shared call only when every owner has moved on, and never a vital one', async () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter(1000, { maxQueue: 2 });
      const ran: string[] = [];
      const call = (name: string) => async () => {
        ran.push(name);
        return name;
      };
      // Something is running (and stays running until released), so the next calls wait in the queue.
      let release: (value: string) => void = () => undefined;
      const running = limiter.schedule(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      );
      // Mom and Dad both wait on "fireman"; Mom types on. Dad's answer must still come.
      const momFireman = limiter.schedule(call('fireman'), {
        key: 'fireman',
        owner: 'mom',
        batch: 'fireman',
      });
      const dadFireman = limiter.schedule(call('fireman'), {
        key: 'fireman',
        owner: 'dad',
        batch: 'fireman',
      });
      const momMore = limiter.schedule(call('fireman x'), {
        key: 'fireman x',
        owner: 'mom',
        batch: 'fireman x',
      });
      await expect(momFireman).rejects.toMatchObject({ code: 'superseded' });
      expect(limiter.queued()).toBe(2);
      // The queue is full for typists, never for the pipeline, whose call goes first.
      await expect(
        limiter.schedule(call('typist'), { owner: 'kevin', batch: 'k' }),
      ).rejects.toMatchObject({
        code: 'busy',
      });
      const vital = limiter.schedule(call('pipeline'), { vital: true });
      expect(limiter.queued()).toBe(3);
      release('running');
      expect(await running).toBe('running');
      await vi.advanceTimersByTimeAsync(4000);
      expect(await vital).toBe('pipeline');
      expect(await dadFireman).toBe('fireman');
      expect(await momMore).toBe('fireman x');
      expect(ran).toEqual(['pipeline', 'fireman', 'fireman x']);
      // An anonymous sharer keeps a call alive even when its typist moves on.
      const hold = limiter.schedule(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      );
      const shared = limiter.schedule(call('kishore'), {
        key: 'kishore',
        owner: 'mom',
        batch: 'kishore',
      });
      const anonymous = limiter.schedule(call('kishore'), { key: 'kishore' });
      limiter.schedule(call('kishore k'), { key: 'kishore k', owner: 'mom', batch: 'kishore k' });
      await expect(shared).rejects.toMatchObject({ code: 'superseded' });
      release('held');
      expect(await hold).toBe('held');
      await vi.advanceTimersByTimeAsync(3000);
      expect(await anonymous).toBe('kishore');
    } finally {
      vi.useRealTimers();
    }
  });

  it('catalogueService shares one search between concurrent callers and passes the owner on', async () => {
    const stores = memoryStores();
    let mbCalls = 0;
    const { fetch } = fakeFetch({
      'musicbrainz.org/ws/2/recording?': () => {
        mbCalls += 1;
        return { recordings: [fireman] };
      },
      'musicbrainz.org/ws/2/release-group?': () => {
        mbCalls += 1;
        return { 'release-groups': [{ ...rg, 'artist-credit': [wayne] }] };
      },
      'api.deezer.com/search': () => ({ data: [] }),
    });
    const scheduled: unknown[] = [];
    const limiter = createRateLimiter(0);
    const spy = {
      schedule: <T>(fn: () => Promise<T>, opts?: unknown) => {
        scheduled.push(opts);
        return limiter.schedule(fn, opts as never);
      },
      queued: () => 0,
    };
    const svc = catalogueService({
      musicBrainz: musicBrainzClient({ version: '1', contact: undefined, fetch, limiter: spy }),
      deezer: deezerClient({ fetch }),
      cache: stores.cache,
    });
    const [one, two] = await Promise.all([
      svc.search('fireman', { owner: 'u-mom' }),
      svc.search('fireman', { owner: 'u-sahil' }),
    ]);
    expect(one).toBe(two);
    expect(mbCalls).toBe(2);
    expect(scheduled[0]).toMatchObject({ owner: 'u-mom', batch: 'fireman' });
    expect((scheduled[0] as { key: string }).key).toContain('/recording?');
    expect((await svc.search('fireman')).cached).toBe(true);
  });
});

describe('the fast path (typeahead)', () => {
  it('answers from Deezer without a MusicBrainz call, caches briefly, and prefers a full cached answer', async () => {
    const { fromDeezer, FAST_TTL_MS } = await import('../src/catalogue/service.js');
    const stores = memoryStores();
    let mbCalls = 0;
    let dzCalls = 0;
    const { fetch } = fakeFetch({
      'musicbrainz.org/ws/2/recording?': () => {
        mbCalls += 1;
        return { recordings: [fireman] };
      },
      'musicbrainz.org/ws/2/release-group?': () => {
        mbCalls += 1;
        return { 'release-groups': [{ ...rg, 'artist-credit': [wayne] }] };
      },
      'api.deezer.com/search/album': () => ({
        data: [
          { id: 3, title: 'Tha Carter II', artist: deezerTrack.artist, release_date: '2005-12-06' },
        ],
      }),
      'api.deezer.com/search/artist': () => ({ data: [deezerTrack.artist] }),
      'api.deezer.com/search': () => {
        dzCalls += 1;
        return { data: [deezerTrack, { ...deezerTrack, id: 9, title: 'Fireman' }] };
      },
    });
    const svc = catalogueService({
      musicBrainz: musicBrainzClient({
        version: '1',
        contact: undefined,
        fetch,
        limiter: createRateLimiter(0),
      }),
      deezer: deezerClient({ fetch, limiter: createRateLimiter(0) }),
      cache: stores.cache,
    });
    const fast = await svc.search('fireman', { owner: 'u-mom', fast: true });
    expect(mbCalls).toBe(0);
    expect(dzCalls).toBe(1);
    expect(fast.partial).toBe(true);
    expect(fast.songs).toEqual([
      {
        id: 'dz:track:1',
        title: 'Fireman',
        artist: 'Lil Wayne',
        album: 'Tha Carter II',
        duration: 183,
        art: 'https://cdn.deezer.test/carter2.jpg',
        preview: 'https://cdn.deezer.test/fireman.mp3',
      },
    ]);
    expect(fast.albums[0]).toMatchObject({ id: 'dz:album:3', title: 'Tha Carter II' });
    expect(fast.artists[0]).toMatchObject({
      id: 'dz:artist:2',
      name: 'Lil Wayne',
      art: 'https://cdn.deezer.test/wayne.jpg',
    });
    expect((await svc.search('fireman', { fast: true })).cached).toBe(true);
    expect(dzCalls).toBe(1);
    expect(FAST_TTL_MS).toBe(600_000);
    // Enter: the full search asks MusicBrainz; from then on the typeahead gets the full answer.
    const full = await svc.search('fireman');
    expect(mbCalls).toBe(2);
    expect(full.partial).toBeUndefined();
    const again = await svc.search('fireman', { fast: true });
    expect(again.cached).toBe(true);
    expect(again.partial).toBeUndefined();
    expect(again.songs[0]?.recordingId).toBe(fireman.id);
    expect(fromDeezer([])).toEqual({ songs: [], albums: [], artists: [] });
    const bare = fromDeezer([
      {
        id: 5,
        title: 'X',
        duration: 1,
        artist: { id: 6, name: 'Y' },
        album: { id: 7, title: 'Z' },
      },
    ]);
    expect(bare.songs[0]).toEqual({
      id: 'dz:track:5',
      title: 'X',
      artist: 'Y',
      album: 'Z',
      duration: 1,
    });
    expect(bare.albums[0]?.art).toBeUndefined();
    expect(bare.artists[0]?.art).toBeUndefined();
  });
});
