/**
 * The playback engine (F20 to F27): a small state machine in core that owns the queue, decides direct
 * play or transcode through the policy, asks the adapter for stream URLs, preloads the next track for
 * a gapless hand-over, and reports plays. The audio itself is behind `AudioPort`, a thin adapter per
 * platform (two media elements on web, RNTP on mobile). Everything here is unit-tested with a fake port.
 */
import type { Track } from './models';
import { PlaybackReporter } from './play-reporting';
import type { NetworkClass, PlaybackSettings } from './playback-policy';
import { decidePlayback, defaultPlaybackSettings } from './playback-policy';
import * as Q from './queue';
import type { QueueState, RepeatMode } from './queue';
import type { PlayMethod, ServerAdapter, Session } from './server-adapter';
import type { Store } from './store';
import { createStore } from './store';

export type AudioEvent =
  | { type: 'time'; position: number; duration: number }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'waiting' }
  | { type: 'ended' }
  | { type: 'error'; message: string };

export interface AudioPort {
  /** Load a source into the current slot, starting from `position` seconds once it can. */
  load(url: string, position?: number): void;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  /** Buffer the next source in the spare slot; `null` clears it. */
  preload(url: string | null): void;
  /** Make the preloaded source current (gapless). False when that url was not preloaded. */
  takeOver(url: string): boolean;
  position(): number;
  duration(): number;
  on(listener: (event: AudioEvent) => void): () => void;
  destroy(): void;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlayerSnapshot {
  queue: QueueState;
  status: PlayerStatus;
  /** Seconds into the current track. */
  position: number;
  /** Seconds, 0 until the media reports it. */
  duration: number;
  volume: number;
  method: PlayMethod | null;
  error: string | null;
}

export interface PlayerDeps {
  audio: AudioPort;
  adapter: ServerAdapter;
  session: () => Session | null;
  network?: () => NetworkClass;
  settings?: () => PlaybackSettings;
  random?: () => number;
  /** Replace the default reporter (tests); `null` turns reporting off. */
  reporter?: PlaybackReporter | null;
  onReportError?: (error: unknown) => void;
}

export const initialPlayerSnapshot: PlayerSnapshot = {
  queue: Q.emptyQueue,
  status: 'idle',
  position: 0,
  duration: 0,
  volume: 1,
  method: null,
  error: null,
};

export class Player {
  readonly store: Store<PlayerSnapshot>;
  private readonly deps: PlayerDeps;
  private readonly reporter: PlaybackReporter | null;
  private readonly stopListening: () => void;
  private preloaded: { key: number; url: string } | null = null;
  /** The queue key whose stream is loaded in the current slot. */
  private loadedKey: number | undefined;

  constructor(deps: PlayerDeps) {
    this.deps = deps;
    this.store = createStore<PlayerSnapshot>(initialPlayerSnapshot);
    this.reporter =
      deps.reporter === undefined
        ? new PlaybackReporter({
            send: (report) => {
              const session = deps.session();
              return session ? deps.adapter.reportPlayback(session, report) : Promise.resolve();
            },
            ...(deps.onReportError ? { onError: deps.onReportError } : {}),
          })
        : deps.reporter;
    this.stopListening = deps.audio.on((event) => this.onAudio(event));
  }

  get snapshot(): PlayerSnapshot {
    return this.store.get();
  }

  subscribe(listener: (snapshot: PlayerSnapshot) => void): () => void {
    return this.store.subscribe(listener);
  }

  destroy(): void {
    this.stopListening();
    this.reporter?.stopped(this.snapshot.position);
    this.deps.audio.destroy();
  }

  private patch(partial: Partial<PlayerSnapshot>): void {
    this.store.set((s) => ({ ...s, ...partial }));
  }

  private get queue(): QueueState {
    return this.snapshot.queue;
  }

  private decide(track: Track) {
    const network = this.deps.network?.() ?? 'wifi';
    const settings = this.deps.settings?.() ?? defaultPlaybackSettings;
    return decidePlayback(track, network, settings);
  }

  private streamFor(
    track: Track,
    playSessionId?: string,
  ): { url: string; method: PlayMethod } | null {
    const session = this.deps.session();
    if (!session) return null;
    const decision = this.decide(track);
    return {
      url: this.deps.adapter.streamUrl(session, track, decision.quality, playSessionId),
      method: decision.method,
    };
  }

  /** Start the current queue position from `position` seconds, through the preloaded slot when it matches. */
  private start(queue: QueueState, position = 0, autoplay = true): void {
    const track = Q.current(queue);
    const key = queue.keys[queue.index];
    if (!track || key === undefined) {
      this.reporter?.stopped(this.snapshot.position);
      this.loadedKey = undefined;
      this.patch({ queue, status: 'idle', position: 0, duration: 0, method: null, error: null });
      return;
    }
    const lastPosition = this.snapshot.position;
    const method = this.decide(track).method;
    const playSessionId = this.reporter?.started(track, method, position, lastPosition);
    const stream = this.streamFor(track, playSessionId);
    if (!stream) {
      this.patch({ queue, status: 'error', error: 'signed-out', method: null });
      return;
    }
    const preloaded = this.preloaded;
    this.preloaded = null;
    const tookOver =
      position === 0 && preloaded?.key === key && this.deps.audio.takeOver(preloaded.url);
    if (!tookOver) this.deps.audio.load(stream.url, position);
    this.loadedKey = key;
    this.patch({
      queue,
      status: autoplay ? 'loading' : 'paused',
      position,
      duration: track.duration,
      method: stream.method,
      error: null,
    });
    if (autoplay) {
      this.deps.audio.play().catch((error: unknown) => {
        this.patch({ status: 'error', error: error instanceof Error ? error.message : 'play' });
      });
    }
    this.preloadNext(queue);
  }

  /** Buffer what `next()` will land on so the hand-over at the end of this track is gapless (F21). */
  private preloadNext(queue: QueueState): void {
    const nextTrack = Q.peekNext(queue);
    if (!nextTrack || queue.repeat === 'one') {
      this.preloaded = null;
      this.deps.audio.preload(null);
      return;
    }
    const advanced = Q.next(queue);
    const key = advanced.keys[advanced.index];
    const stream = this.streamFor(nextTrack);
    if (key === undefined || !stream) return;
    if (this.preloaded?.key === key) return;
    this.preloaded = { key, url: stream.url };
    this.deps.audio.preload(stream.url);
  }

  private onAudio(event: AudioEvent): void {
    switch (event.type) {
      case 'time': {
        const duration = event.duration || this.snapshot.duration;
        this.patch({ position: event.position, duration });
        this.reporter?.progress(event.position, this.snapshot.status === 'paused');
        return;
      }
      case 'playing':
        this.patch({ status: 'playing', error: null });
        return;
      case 'paused':
        if (this.snapshot.status === 'playing') this.patch({ status: 'paused' });
        return;
      case 'waiting':
        if (this.snapshot.status === 'playing') this.patch({ status: 'loading' });
        return;
      case 'ended':
        this.onEnded();
        return;
      case 'error':
        this.patch({ status: 'error', error: event.message });
        return;
    }
  }

  private onEnded(): void {
    const queue = this.queue;
    if (queue.repeat === 'one') {
      this.start(queue, 0);
      return;
    }
    const advanced = Q.next(queue);
    if (advanced === queue) {
      this.reporter?.stopped(this.snapshot.duration || this.snapshot.position);
      this.loadedKey = undefined;
      this.patch({ status: 'ended', position: this.snapshot.duration });
      return;
    }
    this.start(advanced, 0);
  }

  /** Replace the queue with these tracks and play from `startAt`. */
  playTracks(tracks: Track[], startAt = 0): void {
    this.start(Q.replace(this.queue, tracks, startAt, this.deps.random), 0);
  }

  /** Put the queue back after a reload: nothing plays until the user presses Play (F22). */
  restore(queue: QueueState, position = 0): void {
    if (!Q.current(queue)) {
      this.patch({ queue });
      return;
    }
    this.start(queue, position, false);
  }

  playNext(tracks: Track[]): void {
    const wasEmpty = this.queue.index < 0;
    const queue = Q.playNext(this.queue, tracks);
    if (wasEmpty) this.start(queue, 0);
    else {
      this.patch({ queue });
      this.preloadNext(queue);
    }
  }

  addToEnd(tracks: Track[]): void {
    const wasEmpty = this.queue.index < 0;
    const queue = Q.addToEnd(this.queue, tracks);
    if (wasEmpty) this.start(queue, 0);
    else {
      this.patch({ queue });
      this.preloadNext(queue);
    }
  }

  jumpTo(index: number): void {
    const queue = Q.jumpTo(this.queue, index);
    if (queue !== this.queue) this.start(queue, 0);
    else if (index === this.queue.index) void this.play();
  }

  removeAt(index: number): void {
    const before = this.queue;
    const queue = Q.removeAt(before, index);
    if (queue === before) return;
    if (index === before.index) {
      if (Q.current(queue)) this.start(queue, 0);
      else {
        this.deps.audio.pause();
        this.start(queue, 0);
      }
      return;
    }
    this.patch({ queue });
    this.preloadNext(queue);
  }

  move(from: number, to: number): void {
    const queue = Q.move(this.queue, from, to);
    if (queue === this.queue) return;
    this.patch({ queue });
    this.preloadNext(queue);
  }

  clear(): void {
    this.deps.audio.pause();
    this.deps.audio.preload(null);
    this.preloaded = null;
    this.start(Q.clear(this.queue), 0);
  }

  async play(): Promise<void> {
    const { status, queue } = this.snapshot;
    if (!Q.current(queue)) return;
    if (status === 'ended') {
      this.start(queue, 0);
      return;
    }
    if (this.loadedKey !== queue.keys[queue.index]) {
      this.start(queue, this.snapshot.position);
      return;
    }
    this.patch({ status: 'loading' });
    try {
      await this.deps.audio.play();
      this.reporter?.progress(this.snapshot.position, false, true);
    } catch (error) {
      this.patch({ status: 'error', error: error instanceof Error ? error.message : 'play' });
    }
  }

  pause(): void {
    if (this.snapshot.status !== 'playing' && this.snapshot.status !== 'loading') return;
    this.deps.audio.pause();
    this.patch({ status: 'paused' });
    this.reporter?.progress(this.snapshot.position, true, true);
  }

  toggle(): void {
    if (this.snapshot.status === 'playing' || this.snapshot.status === 'loading') this.pause();
    else void this.play();
  }

  /** The user pressed Next: always moves on, repeat one included. */
  next(): void {
    const queue = Q.next(this.queue, { manual: true });
    if (queue === this.queue) {
      if (this.queue.repeat === 'off' && Q.current(this.queue)) {
        this.deps.audio.pause();
        this.reporter?.stopped(this.snapshot.position);
        this.loadedKey = undefined;
        this.patch({ status: 'ended' });
      }
      return;
    }
    this.start(queue, 0);
  }

  /** Previous within the first three seconds goes back a track; later it restarts this one. */
  previous(): void {
    if (this.snapshot.position > 3) {
      this.seek(0);
      return;
    }
    const queue = Q.previous(this.queue);
    if (queue === this.queue) this.seek(0);
    else this.start(queue, 0);
  }

  seek(seconds: number): void {
    const duration = this.snapshot.duration;
    const position = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
    this.deps.audio.seek(position);
    this.patch({ position });
    this.reporter?.progress(position, this.snapshot.status === 'paused', true);
  }

  setVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume));
    this.deps.audio.setVolume(clamped);
    this.patch({ volume: clamped });
  }

  setShuffle(shuffle: boolean, albumAware?: boolean): void {
    const queue = Q.setShuffle(
      this.queue,
      shuffle,
      this.deps.random,
      albumAware === undefined ? {} : { albumAware },
    );
    this.patch({ queue });
    this.preloadNext(queue);
  }

  setRepeat(repeat: RepeatMode): void {
    const queue = Q.setRepeat(this.queue, repeat);
    this.patch({ queue });
    this.preloadNext(queue);
  }

  /** Off, all, one, off. */
  cycleRepeat(): void {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const next = order[(order.indexOf(this.queue.repeat) + 1) % order.length] ?? 'off';
    this.setRepeat(next);
  }
}
