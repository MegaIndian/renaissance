import { describe, expect, it, vi } from 'vitest';

import { PlaybackReporter } from '../src/play-reporting';
import { Player } from '../src/playback';
import type { AudioEvent, AudioPort } from '../src/playback';
import type { Track } from '../src/models';
import type { PlaybackReport, ServerAdapter, StreamQuality } from '../src/server-adapter';
import { session, track } from './fixtures';

/** A fake media layer: two slots, instant events, every call recorded. */
class FakeAudio implements AudioPort {
  log: string[] = [];
  current: string | null = null;
  spare: string | null = null;
  pos = 0;
  dur = 180;
  private listeners = new Set<(e: AudioEvent) => void>();
  rejectPlay = false;
  load(url: string, position = 0) {
    this.current = url;
    this.pos = position;
    this.log.push(`load ${new URL(url).pathname}@${position}`);
  }
  play() {
    this.log.push('play');
    if (this.rejectPlay) return Promise.reject(new Error('NotAllowedError'));
    this.emit({ type: 'playing' });
    return Promise.resolve();
  }
  pause() {
    this.log.push('pause');
    this.emit({ type: 'paused' });
  }
  seek(s: number) {
    this.pos = s;
    this.log.push(`seek ${s}`);
  }
  setVolume(v: number) {
    this.log.push(`volume ${v}`);
  }
  preload(url: string | null) {
    this.spare = url;
    this.log.push(`preload ${url ? new URL(url).pathname : 'none'}`);
  }
  takeOver(url: string) {
    if (this.spare !== url) return false;
    this.current = url;
    this.spare = null;
    this.pos = 0;
    this.log.push(`takeover ${new URL(url).pathname}`);
    return true;
  }
  position() {
    return this.pos;
  }
  duration() {
    return this.dur;
  }
  on(listener: (e: AudioEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  destroy() {
    this.log.push('destroy');
  }
  emit(e: AudioEvent) {
    for (const l of this.listeners) l(e);
  }
  tick(position: number) {
    this.pos = position;
    this.emit({ type: 'time', position, duration: this.dur });
  }
}

function setup(options: { reports?: PlaybackReport[]; network?: 'wifi' | 'cellular' } = {}) {
  const audio = new FakeAudio();
  const reports = options.reports ?? [];
  let now = 0;
  const adapter = {
    streamUrl: (_s: unknown, t: Track, quality: StreamQuality, ps?: string) =>
      `http://h/Audio/${t.id}/universal?q=${quality === 'original' ? 'o' : quality.maxBitrate}&ps=${ps ?? ''}`,
    reportPlayback: (_s: unknown, r: PlaybackReport) => {
      reports.push(r);
      return Promise.resolve();
    },
  } as unknown as ServerAdapter;
  const reporter = new PlaybackReporter({
    send: (r) => adapter.reportPlayback(session, r),
    now: () => now,
    newId: () => `ps${reports.length}`,
  });
  const player = new Player({
    audio,
    adapter,
    session: () => session,
    network: () => options.network ?? 'wifi',
    random: () => 0.5,
    reporter,
  });
  return { audio, player, reports, advance: (ms: number) => (now += ms) };
}

const tracks = ['1', '2', '3'].map((id) => track(id, { codec: 'mp3', bitrate: 320_000 }));

describe('Player', () => {
  it('plays a list from the chosen track, preloads the next, and reports started', () => {
    const { audio, player, reports } = setup();
    player.playTracks(tracks, 1);
    expect(player.snapshot.status).toBe('playing');
    expect(player.snapshot.queue.index).toBe(1);
    expect(player.snapshot.method).toBe('direct');
    expect(audio.log).toEqual(['load /Audio/2/universal@0', 'play', 'preload /Audio/3/universal']);
    expect(reports).toEqual([
      { trackId: '2', position: 0, state: 'started', method: 'direct', playSessionId: 'ps0' },
    ]);
  });

  it('hands over gaplessly at the end: the preloaded slot takes over and the old track is stopped', () => {
    const { audio, player, reports } = setup();
    player.playTracks(tracks, 0);
    audio.tick(179);
    audio.emit({ type: 'ended' });
    expect(player.snapshot.queue.index).toBe(1);
    expect(audio.log.slice(-3)).toEqual([
      'takeover /Audio/2/universal',
      'play',
      'preload /Audio/3/universal',
    ]);
    expect(reports.map((r) => `${r.state} ${r.trackId} ${r.position}`)).toEqual([
      'started 1 0',
      'stopped 1 179',
      'started 2 0',
    ]);
  });

  it('stops at the end of the queue with repeat off and restarts from the top when Play is pressed', async () => {
    const { audio, player, reports } = setup();
    player.playTracks([tracks[2] as (typeof tracks)[number]]);
    expect(audio.log.at(-1)).toBe('preload none');
    audio.tick(180);
    audio.emit({ type: 'ended' });
    expect(player.snapshot.status).toBe('ended');
    expect(reports.at(-1)).toMatchObject({ state: 'stopped', position: 180 });
    await player.play();
    expect(player.snapshot.status).toBe('playing');
    expect(player.snapshot.position).toBe(0);
  });

  it('repeat all wraps; repeat one replays the same track at the end but Next still moves on', () => {
    const { audio, player } = setup();
    player.playTracks(tracks, 2);
    player.setRepeat('all');
    expect(audio.log.at(-1)).toBe('preload /Audio/1/universal');
    audio.emit({ type: 'ended' });
    expect(player.snapshot.queue.index).toBe(0);
    player.setRepeat('one');
    expect(audio.spare).toBeNull();
    audio.emit({ type: 'ended' });
    expect(player.snapshot.queue.index).toBe(0);
    expect(audio.log.at(-3)).toBe('load /Audio/1/universal@0');
    player.next();
    expect(player.snapshot.queue.index).toBe(1);
    player.cycleRepeat();
    expect(player.snapshot.queue.repeat).toBe('off');
  });

  it('pause, resume, seek and volume go to the port and send a progress report at once', async () => {
    const { audio, player, reports, advance } = setup();
    player.playTracks(tracks);
    audio.tick(5);
    expect(reports).toHaveLength(1);
    advance(10_000);
    audio.tick(15);
    expect(reports.at(-1)).toMatchObject({ state: 'progress', position: 15, paused: false });
    player.pause();
    expect(player.snapshot.status).toBe('paused');
    expect(reports.at(-1)).toMatchObject({ state: 'progress', paused: true });
    player.seek(60);
    expect(audio.log.at(-1)).toBe('seek 60');
    expect(player.snapshot.position).toBe(60);
    player.toggle();
    await Promise.resolve();
    expect(player.snapshot.status).toBe('playing');
    player.setVolume(2);
    expect(player.snapshot.volume).toBe(1);
    player.setVolume(0.3);
    expect(audio.log.at(-1)).toBe('volume 0.3');
  });

  it('previous restarts after three seconds, goes back before that', () => {
    const { audio, player } = setup();
    player.playTracks(tracks, 1);
    audio.tick(10);
    player.previous();
    expect(player.snapshot.queue.index).toBe(1);
    expect(audio.log.at(-1)).toBe('seek 0');
    audio.tick(1);
    player.previous();
    expect(player.snapshot.queue.index).toBe(0);
    player.previous();
    expect(player.snapshot.queue.index).toBe(0);
  });

  it('play next, add to end, jump, remove and move keep the preload in step', () => {
    const { audio, player } = setup();
    player.playTracks(tracks, 0);
    player.playNext([track('9', { codec: 'mp3' })]);
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['1', '9', '2', '3']);
    expect(audio.log.at(-1)).toBe('preload /Audio/9/universal');
    player.addToEnd([track('10', { codec: 'mp3' })]);
    expect(player.snapshot.queue.items.at(-1)?.id).toBe('10');
    player.move(1, 3);
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['1', '2', '3', '9', '10']);
    expect(audio.log.at(-1)).toBe('preload /Audio/2/universal');
    player.jumpTo(3);
    expect(player.snapshot.queue.index).toBe(3);
    expect(audio.log.at(-2)).toBe('play');
    player.removeAt(0);
    expect(player.snapshot.queue.index).toBe(2);
    player.removeAt(2);
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['2', '3', '10']);
    expect(player.snapshot.queue.index).toBe(2);
    expect(audio.log.at(-3)).toBe('takeover /Audio/10/universal');
    player.clear();
    expect(player.snapshot.status).toBe('idle');
    expect(player.snapshot.queue.items).toEqual([]);
  });

  it('empty-queue adds start playback; restore loads without playing', () => {
    const { audio, player } = setup();
    player.addToEnd([tracks[0] as (typeof tracks)[number]]);
    expect(player.snapshot.status).toBe('playing');
    const second = setup();
    second.player.playNext([tracks[1] as (typeof tracks)[number]]);
    expect(second.player.snapshot.queue.index).toBe(0);
    const third = setup();
    third.player.restore(player.snapshot.queue, 42);
    expect(third.player.snapshot.status).toBe('paused');
    expect(third.player.snapshot.position).toBe(42);
    expect(third.audio.log).toEqual(['load /Audio/1/universal@42', 'preload none']);
    expect(audio.log).toContain('play');
  });

  it('shuffle on and off through the engine', () => {
    const { player } = setup();
    player.playTracks(tracks, 0);
    player.setShuffle(true, true);
    expect(player.snapshot.queue.shuffle).toBe(true);
    expect(player.snapshot.queue.albumAware).toBe(true);
    player.setShuffle(false);
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('transcodes on cellular when the bitrate is above the cap and tells the server so', () => {
    const { player, reports } = setup({ network: 'cellular' });
    player.playTracks([track('f', { codec: 'flac', bitrate: 900_000 })]);
    expect(player.snapshot.method).toBe('transcode');
    expect(reports[0]).toMatchObject({ method: 'transcode' });
  });

  it('a refused play and a media error become an error status; signed out is reported', () => {
    const { audio, player } = setup();
    audio.rejectPlay = true;
    player.playTracks(tracks);
    return Promise.resolve().then(() => {
      expect(player.snapshot.status).toBe('error');
      expect(player.snapshot.error).toBe('NotAllowedError');
      audio.emit({ type: 'error', message: 'decode' });
      expect(player.snapshot.error).toBe('decode');
      const signedOut = new Player({
        audio: new FakeAudio(),
        adapter: {} as ServerAdapter,
        session: () => null,
        reporter: null,
      });
      signedOut.playTracks(tracks);
      expect(signedOut.snapshot.error).toBe('signed-out');
      signedOut.destroy();
    });
  });

  it('waiting and paused events from the media layer update the status; destroy stops the track', () => {
    const { audio, player, reports } = setup();
    player.playTracks(tracks);
    audio.emit({ type: 'waiting' });
    expect(player.snapshot.status).toBe('loading');
    audio.emit({ type: 'playing' });
    audio.emit({ type: 'paused' });
    expect(player.snapshot.status).toBe('paused');
    player.destroy();
    expect(reports.at(-1)?.state).toBe('stopped');
    expect(audio.log.at(-1)).toBe('destroy');
  });

  it('next at the end with repeat off ends playback instead of doing nothing', () => {
    const { player } = setup();
    player.playTracks(tracks, 2);
    player.next();
    expect(player.snapshot.status).toBe('ended');
  });
});

describe('PlaybackReporter', () => {
  it('sends started, throttled progress, forced progress and stopped; swallows send errors', async () => {
    const sent: PlaybackReport[] = [];
    const onError = vi.fn();
    let now = 0;
    let fail = false;
    const reporter = new PlaybackReporter({
      send: (r) => {
        if (fail) return Promise.reject(new Error('down'));
        sent.push(r);
        return Promise.resolve();
      },
      now: () => now,
      newId: () => 'id',
      onError,
    });
    expect(reporter.playSessionId).toBeUndefined();
    reporter.progress(1);
    reporter.stopped(1);
    expect(sent).toEqual([]);
    reporter.started(track('a'), 'direct');
    expect(reporter.activeTrackId).toBe('a');
    reporter.progress(2);
    now = 9_999;
    reporter.progress(3);
    now = 10_000;
    reporter.progress(4);
    reporter.progress(5, true, true);
    expect(sent.map((r) => `${r.state}:${r.position}`)).toEqual([
      'started:0',
      'progress:4',
      'progress:5',
    ]);
    reporter.started(track('b'), 'transcode', 0, 7);
    expect(sent.at(-2)).toMatchObject({ state: 'stopped', trackId: 'a', position: 7 });
    expect(sent.at(-1)).toMatchObject({ state: 'started', trackId: 'b', method: 'transcode' });
    fail = true;
    reporter.stopped(9);
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    const defaults = new PlaybackReporter({ send: () => Promise.resolve() });
    expect(defaults.started(track('c'), 'direct')).toMatch(/\w+-\w+/);
  });
});
