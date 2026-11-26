import { describe, expect, it, vi } from 'vitest';

import {
  ListeningLog,
  ListeningTracker,
  MemoryListeningLogStore,
  attachListeningTracker,
  filterListens,
  groupByDay,
  isCompleted,
  isSkip,
  lastDays,
  lastPlayed,
  localDay,
  noopListeningSync,
  parseListenEvent,
  playsPerTrack,
  skipRate,
  syncListening,
  topAlbums,
  topArtists,
  topTracks,
  totalListened,
} from '../src/listening-log';
import type { ListeningSync } from '../src/listening-log';
import type { ListenEvent } from '../src/listening-log';
import type { Track } from '../src/models';
import { Player } from '../src/playback';
import type { AudioEvent, AudioPort, PlayEvent } from '../src/playback';
import type { ServerAdapter } from '../src/server-adapter';
import { session, track } from './fixtures';

class FakeAudio implements AudioPort {
  private listeners = new Set<(e: AudioEvent) => void>();
  failPlay = false;
  load() {}
  play() {
    if (this.failPlay) return Promise.resolve();
    this.emit({ type: 'playing' });
    return Promise.resolve();
  }
  pause() {
    this.emit({ type: 'paused' });
  }
  seek() {}
  setVolume() {}
  preload() {}
  takeOver() {
    return true;
  }
  position() {
    return 0;
  }
  duration() {
    return 180;
  }
  on(listener: (e: AudioEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  destroy() {}
  emit(e: AudioEvent) {
    for (const l of this.listeners) l(e);
  }
  /** Play forward from `from` to `to` in quarter-second ticks, as a media element does. */
  run(from: number, to: number) {
    for (let p = from; p <= to + 1e-9; p += 0.25)
      this.emit({ type: 'time', position: p, duration: 180 });
  }
}

const adapter = {
  streamUrl: (_s: unknown, t: Track) => `http://h/Audio/${t.id}`,
  reportPlayback: () => Promise.resolve(),
} as unknown as ServerAdapter;

const tracks = ['1', '2', '3'].map((id) =>
  track(id, { albumId: 'al1', albumTitle: 'Album', artistIds: ['a1', 'a2'], imageId: `img${id}` }),
);

function setup(options: { enabled?: () => boolean; signedIn?: boolean } = {}) {
  const audio = new FakeAudio();
  const player = new Player({ audio, adapter, session: () => session, reporter: null });
  const recorded: ListenEvent[] = [];
  let now = Date.parse('2026-11-20T10:00:00.000Z');
  let id = 0;
  const tracker = new ListeningTracker({
    context: () =>
      options.signedIn === false ? null : { serverId: 's1', userId: 'u1', device: 'Chrome on Mac' },
    enabled: options.enabled ?? (() => true),
    record: (e) => {
      recorded.push(e);
    },
    now: () => now,
    newId: () => `e${++id}`,
  });
  const detach = attachListeningTracker(player, tracker);
  return {
    audio,
    player,
    tracker,
    recorded,
    detach,
    advance: (seconds: number) => (now += seconds * 1000),
  };
}

describe('skip and completed rules', () => {
  it('moving away under 30 s is a skip; next or a jump before half is a skip at any length', () => {
    expect(isSkip('next', 10, 180)).toBe(true);
    expect(isSkip('previous', 29, 180)).toBe(true);
    expect(isSkip('previous', 31, 180)).toBe(false);
    expect(isSkip('next', 80, 180)).toBe(true);
    expect(isSkip('jump', 80, 180)).toBe(true);
    expect(isSkip('next', 95, 180)).toBe(false);
    expect(isSkip('replaced', 80, 180)).toBe(false);
    expect(isSkip('removed', 5, 180)).toBe(true);
  });

  it('a natural end, a cleared queue, a stop and an error are never skips', () => {
    for (const reason of ['ended', 'cleared', 'stopped', 'error'] as const) {
      expect(isSkip(reason, 2, 180)).toBe(false);
    }
  });

  it('a track under a minute is a skip under half its length; an unknown length uses 30 s', () => {
    expect(isSkip('previous', 8, 20)).toBe(true);
    expect(isSkip('previous', 12, 20)).toBe(false);
    expect(isSkip('previous', 29, 0)).toBe(true);
    expect(isSkip('next', 200, 0)).toBe(false);
  });

  it('completed is a natural end or 90 % heard', () => {
    expect(isCompleted('ended', 3, 180)).toBe(true);
    expect(isCompleted('next', 162, 180)).toBe(true);
    expect(isCompleted('next', 150, 180)).toBe(false);
    expect(isCompleted('stopped', 50, 0)).toBe(false);
  });
});

describe('Player play events', () => {
  it('names the source of each queued copy and the reason each play ended', () => {
    const audio = new FakeAudio();
    const player = new Player({ audio, adapter, session: () => session, reporter: null });
    const events: string[] = [];
    player.onPlay((e: PlayEvent) =>
      events.push(
        e.type === 'start'
          ? `start ${e.track.id} ${e.source.kind}${e.source.id ? `:${e.source.id}` : ''}`
          : `end ${e.track.id} ${e.reason}`,
      ),
    );
    player.playTracks(tracks, 0, { kind: 'album', id: 'al1' });
    player.addToEnd([track('9')], { kind: 'search' });
    player.next();
    audio.emit({ type: 'ended' });
    player.jumpTo(3);
    player.previous();
    player.removeAt(2);
    player.playTracks([track('7')]);
    player.clear();
    expect(events).toEqual([
      'start 1 album:al1',
      'end 1 next',
      'start 2 album:al1',
      'end 2 ended',
      'start 3 album:al1',
      'end 3 jump',
      'start 9 search',
      'end 9 previous',
      'start 3 album:al1',
      'end 3 removed',
      'start 9 search',
      'end 9 replaced',
      'start 7 other',
      'end 7 cleared',
    ]);
  });

  it('repeat one ends and starts the same entry; the end of the queue is an end; Next at the end is next', () => {
    const audio = new FakeAudio();
    const player = new Player({ audio, adapter, session: () => session, reporter: null });
    const events: string[] = [];
    player.onPlay((e) =>
      events.push(`${e.type} ${e.track.id}${e.type === 'end' ? ` ${e.reason}` : ''}`),
    );
    player.playTracks([track('1')], 0, { kind: 'playlist', id: 'p1' });
    player.setRepeat('one');
    audio.emit({ type: 'ended' });
    player.setRepeat('off');
    audio.emit({ type: 'ended' });
    void player.play();
    player.next();
    expect(events).toEqual([
      'start 1',
      'end 1 ended',
      'start 1',
      'end 1 ended',
      'start 1',
      'end 1 next',
    ]);
  });

  it('a restored queue starts no play until Play, and then its source is other', async () => {
    const audio = new FakeAudio();
    const player = new Player({ audio, adapter, session: () => session, reporter: null });
    const events: PlayEvent[] = [];
    player.onPlay((e) => events.push(e));
    player.playTracks(tracks, 0, { kind: 'album', id: 'al1' });
    const queue = player.snapshot.queue;
    player.restore(queue, 40);
    expect(events.map((e) => e.type)).toEqual(['start', 'end']);
    expect(events[1]).toMatchObject({ reason: 'stopped' });
    await player.play();
    expect(events[2]).toMatchObject({ type: 'start', position: 40, source: { kind: 'other' } });
  });

  it('a failed stream ends as error, and playing the same entry again continues its play', async () => {
    const audio = new FakeAudio();
    const player = new Player({ audio, adapter, session: () => session, reporter: null });
    const events: string[] = [];
    player.onPlay((e) => events.push(e.type === 'end' ? `end ${e.reason}` : 'start'));
    player.playTracks(tracks, 0);
    audio.emit({ type: 'error', message: 'refused' });
    await player.play();
    expect(events).toEqual(['start']);
    audio.emit({ type: 'error', message: 'refused' });
    player.next();
    expect(events).toEqual(['start', 'end error', 'start']);
  });

  it('a listener that throws never stops playback; destroy ends the open play as stopped', () => {
    const audio = new FakeAudio();
    const player = new Player({ audio, adapter, session: () => session, reporter: null });
    const reasons: string[] = [];
    player.onPlay(() => {
      throw new Error('listener');
    });
    const off = player.onPlay((e) => {
      if (e.type === 'end') reasons.push(e.reason);
    });
    player.playTracks(tracks, 0);
    expect(player.snapshot.status).toBe('playing');
    player.destroy();
    expect(reasons).toEqual(['stopped']);
    off();
  });
});

describe('ListeningTracker', () => {
  it('logs a play that ran to its end as completed, with the time heard, device and source', () => {
    const { audio, player, recorded, advance } = setup();
    player.playTracks(tracks, 0, { kind: 'album', id: 'al1' });
    audio.run(0, 179.75);
    advance(180);
    audio.emit({ type: 'ended' });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      id: 'e1',
      serverId: 's1',
      userId: 'u1',
      trackId: '1',
      albumId: 'al1',
      artistIds: ['a1', 'a2'],
      title: 'Track 1',
      artistName: 'Artist',
      albumTitle: 'Album',
      imageId: 'img1',
      trackDuration: 180,
      at: '2026-11-20T10:00:00.000Z',
      endedAt: '2026-11-20T10:03:00.000Z',
      listened: 180,
      position: 180,
      completed: true,
      skipped: false,
      endReason: 'ended',
      source: { kind: 'album', id: 'al1' },
      device: 'Chrome on Mac',
    });
    expect(parseListenEvent(recorded[0])).toEqual(recorded[0]);
  });

  it('a Next after 10 s is a skip; seeks and paused time are not counted as heard', () => {
    const { audio, player, recorded } = setup();
    player.playTracks(tracks, 0);
    audio.run(0, 5);
    player.seek(120);
    audio.run(120, 125);
    player.pause();
    audio.emit({ type: 'time', position: 125.5, duration: 180 });
    player.next();
    expect(recorded[0]).toMatchObject({
      listened: 10,
      skipped: true,
      completed: false,
      endReason: 'next',
    });
  });

  it('drops plays under a second, plays while the log is off, and plays while signed out', () => {
    let enabled = false;
    const off = setup({ enabled: () => enabled });
    off.player.playTracks(tracks, 0);
    off.audio.run(0, 60);
    off.player.next();
    expect(off.recorded).toEqual([]);
    enabled = true;
    off.audio.run(0, 0.5);
    off.player.next();
    expect(off.recorded).toEqual([]);

    const signedOut = setup({ signedIn: false });
    signedOut.player.playTracks(tracks, 0);
    signedOut.audio.run(0, 60);
    signedOut.player.next();
    expect(signedOut.recorded).toEqual([]);
    expect(signedOut.tracker.current).toBeNull();
  });

  it('a failing store goes to onError; detach stops following the player', async () => {
    const onError = vi.fn();
    const audio = new FakeAudio();
    const player = new Player({ audio, adapter, session: () => session, reporter: null });
    const tracker = new ListeningTracker({
      context: () => ({ serverId: 's1', userId: 'u1', device: 'd' }),
      enabled: () => true,
      record: () => Promise.reject(new Error('quota')),
      onError,
    });
    const detach = attachListeningTracker(player, tracker);
    player.playTracks(tracks, 0);
    audio.run(0, 40);
    expect(tracker.current).toEqual({ trackId: '1', listened: 40 });
    player.next();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();

    const throwing = new ListeningTracker({
      context: () => ({ serverId: 's1', userId: 'u1', device: 'd' }),
      enabled: () => true,
      record: () => {
        throw new Error('sync');
      },
      onError,
    });
    throwing.start(track('1'), { kind: 'other' });
    throwing.progress(2, true);
    expect(throwing.end(2, 'stopped')).not.toBeNull();
    expect(onError).toHaveBeenCalledTimes(2);

    detach();
    player.next();
    // Detached: the play that was open stays open and nothing new is started or recorded.
    expect(tracker.current).toEqual({ trackId: '2', listened: 0 });
  });

  it('end without a start records nothing', () => {
    const tracker = new ListeningTracker({
      context: () => null,
      enabled: () => true,
      record: () => undefined,
    });
    expect(tracker.end(10, 'next')).toBeNull();
  });
});

let n = 0;
function listen(extra: Partial<ListenEvent> = {}): ListenEvent {
  n += 1;
  return {
    id: `l${String(n).padStart(3, '0')}`,
    serverId: 's1',
    userId: 'u1',
    trackId: 't1',
    albumId: 'al1',
    artistIds: ['a1'],
    title: 'One',
    artistName: 'Ann',
    albumTitle: 'First',
    trackDuration: 200,
    at: '2026-11-20T10:00:00.000Z',
    endedAt: '2026-11-20T10:03:20.000Z',
    listened: 200,
    position: 200,
    completed: true,
    skipped: false,
    endReason: 'ended',
    source: { kind: 'album', id: 'al1' },
    device: 'Chrome on Mac',
    ...extra,
  };
}

const log = [
  listen({ at: '2026-11-18T09:00:00.000Z' }),
  listen({ at: '2026-11-19T09:00:00.000Z' }),
  listen({
    trackId: 't2',
    title: 'Two',
    artistIds: ['a2', 'a1'],
    artistName: 'Bo & Ann',
    albumId: 'al2',
    albumTitle: 'Second',
    at: '2026-11-19T12:00:00.000Z',
  }),
  listen({
    trackId: 't2',
    title: 'Two',
    artistIds: ['a2', 'a1'],
    albumId: 'al2',
    at: '2026-11-20T12:00:00.000Z',
    listened: 8,
    skipped: true,
    completed: false,
    endReason: 'next',
  }),
  listen({
    trackId: 't3',
    title: 'Three',
    artistIds: ['a3'],
    albumId: undefined,
    at: '2026-11-20T13:00:00.000Z',
    listened: 5,
    skipped: true,
    completed: false,
  }),
];

describe('queries', () => {
  it('top tracks: plays without skips, then time heard; skip-only tracks are left out', () => {
    expect(
      topTracks(log).map((s) => [s.trackId, s.plays, s.skips, s.listened, s.lastPlayed]),
    ).toEqual([
      ['t1', 2, 0, 400, '2026-11-19T09:00:00.000Z'],
      ['t2', 1, 1, 208, '2026-11-20T12:00:00.000Z'],
    ]);
    expect(topTracks(log, 1)).toHaveLength(1);
    expect(topTracks([])).toEqual([]);
  });

  it('top artists credits every artist on a track; top albums skips tracks without one', () => {
    expect(topArtists(log).map((s) => [s.artistId, s.plays, s.skips])).toEqual([
      ['a1', 3, 1],
      ['a2', 1, 1],
    ]);
    expect(topArtists(log, 1).map((s) => s.artistId)).toEqual(['a1']);
    expect(topAlbums(log).map((s) => [s.albumId, s.albumTitle, s.plays])).toEqual([
      ['al1', 'First', 2],
      ['al2', 'Second', 1],
    ]);
    expect(topAlbums(log, 1)).toHaveLength(1);
  });

  it('ties are broken by time heard and then by the newest play', () => {
    const a = listen({ trackId: 'x', at: '2026-11-01T00:00:00.000Z' });
    const b = listen({ trackId: 'y', at: '2026-11-02T00:00:00.000Z' });
    const c = listen({ trackId: 'z', at: '2026-11-01T00:00:00.000Z', listened: 300 });
    expect(topTracks([a, b, c]).map((s) => s.trackId)).toEqual(['z', 'y', 'x']);
    expect(topTracks([b, a]).map((s) => s.trackId)).toEqual(['y', 'x']);
  });

  it('plays per track, last played, skip rate and total time', () => {
    expect([...playsPerTrack(log)]).toEqual([
      ['t1', 2],
      ['t2', 1],
    ]);
    expect(lastPlayed(log).get('t2')).toBe('2026-11-20T12:00:00.000Z');
    expect(lastPlayed(log).get('t3')).toBe('2026-11-20T13:00:00.000Z');
    expect(skipRate(log)).toEqual({ plays: 5, skips: 2, rate: 0.4 });
    expect(skipRate(log, { trackId: 't2' })).toEqual({ plays: 2, skips: 1, rate: 0.5 });
    expect(skipRate(log, { artistId: 'a2' }).rate).toBe(0.5);
    expect(skipRate(log, { albumId: 'al1' }).skips).toBe(0);
    expect(skipRate([], {})).toEqual({ plays: 0, skips: 0, rate: 0 });
    expect(totalListened(log)).toBe(613);
  });

  it('filters and groups by local day, newest first', () => {
    expect(filterListens(log, 'skipped')).toHaveLength(2);
    expect(filterListens(log, 'completed')).toHaveLength(3);
    expect(filterListens(log, 'all')).toHaveLength(5);
    const days = groupByDay(log);
    expect(days[0]?.day).toBe(localDay('2026-11-20T13:00:00.000Z'));
    expect(days[0]?.events[0]?.trackId).toBe('t3');
    expect(days.flatMap((d) => d.events)).toHaveLength(5);
    expect(localDay(new Date(2026, 0, 5, 23, 30).toISOString())).toBe('2026-01-05');
  });

  it('lastDays is a window ending now', () => {
    const now = new Date('2026-11-20T00:00:00.000Z');
    expect(lastDays(7, now)).toEqual({ from: new Date('2026-11-13T00:00:00.000Z'), to: now });
  });
});

describe('MemoryListeningLogStore and ListeningLog', () => {
  it('lists newest first in a window, counts, removes, clears with what it removed', async () => {
    const store = new MemoryListeningLogStore();
    await store.add(log);
    await store.add([log[0] as ListenEvent]);
    expect(await store.count()).toBe(5);
    const window = {
      from: new Date('2026-11-19T00:00:00.000Z'),
      to: new Date('2026-11-20T12:00:00.000Z'),
    };
    expect((await store.list(window)).map((e) => e.at)).toEqual([
      '2026-11-19T12:00:00.000Z',
      '2026-11-19T09:00:00.000Z',
    ]);
    expect(await store.list({ limit: 1 })).toHaveLength(1);
    await store.remove([log[4]?.id ?? '']);
    expect(await store.count()).toBe(4);
    const cleared = await store.clear();
    expect(cleared).toHaveLength(4);
    expect(await store.count()).toBe(0);
  });

  it('the facade answers every query over a window', async () => {
    const store = new MemoryListeningLogStore();
    await store.add(log);
    const history = new ListeningLog(store);
    const since19 = { from: new Date('2026-11-19T00:00:00.000Z') };
    expect((await history.events({ limit: 2 })).map((e) => e.trackId)).toEqual(['t3', 't2']);
    expect((await history.topTracks(since19)).map((s) => s.trackId)).toEqual(['t2', 't1']);
    expect((await history.topArtists(since19, 1)).map((s) => s.artistId)).toEqual(['a1']);
    expect((await history.topAlbums()).map((s) => s.albumId)).toEqual(['al1', 'al2']);
    expect(await history.playsOf('t1')).toBe(2);
    expect(await history.playsOf('t1', since19)).toBe(1);
    expect(await history.playsOf('nope')).toBe(0);
    expect((await history.playsPerTrack()).get('t2')).toBe(1);
    expect((await history.lastPlayed()).size).toBe(3);
    expect(await history.lastPlayedOf('t1')).toBe('2026-11-19T09:00:00.000Z');
    expect(await history.skipRate(since19, { trackId: 't2' })).toEqual({
      plays: 2,
      skips: 1,
      rate: 0.5,
    });
    expect(await history.totalListened(since19)).toBe(413);
  });

  it('parseListenEvent rejects what does not match the schema', () => {
    expect(parseListenEvent({ id: 'x' })).toBeNull();
    expect(parseListenEvent(null)).toBeNull();
  });
});

describe('syncListening', () => {
  it('the no-op target stores nothing and marks nothing', async () => {
    const store = new MemoryListeningLogStore();
    await store.add(log);
    expect(await syncListening(store, noopListeningSync)).toBe(0);
    expect(await store.unsynced(10)).toHaveLength(5);
  });

  it('pushes oldest first in batches and marks what the target stored', async () => {
    const store = new MemoryListeningLogStore();
    await store.add(log);
    const seen: string[][] = [];
    const target: ListeningSync = {
      push: (events) => {
        seen.push(events.map((e) => e.at));
        return Promise.resolve(events.map((e) => e.id));
      },
    };
    const at = new Date('2026-11-21T00:00:00.000Z');
    expect(await syncListening(store, target, { batch: 2, now: () => at })).toBe(5);
    expect(seen[0]).toEqual(['2026-11-18T09:00:00.000Z', '2026-11-19T09:00:00.000Z']);
    expect(seen).toHaveLength(3);
    expect(await store.unsynced(10)).toEqual([]);
    expect((await store.list())[0]?.syncedAt).toBe(at.toISOString());
  });

  it('stops after a partial batch, leaving the rest for next time', async () => {
    const store = new MemoryListeningLogStore();
    await store.add(log);
    const partial: ListeningSync = {
      push: (events) => Promise.resolve(events.slice(0, 1).map((e) => e.id)),
    };
    expect(await syncListening(store, partial, { batch: 3 })).toBe(1);
    expect(await store.unsynced(10)).toHaveLength(4);
    await store.markSynced(['missing'], '2026-11-21T00:00:00.000Z');
    expect(await store.count()).toBe(5);
  });
});
