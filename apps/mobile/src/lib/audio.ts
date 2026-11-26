/**
 * The phone half of playback (ADR 0003, F21): core's `AudioPort` over react-native-track-player.
 * RNTP keeps its own queue; here it holds at most two items, the current stream and the preloaded
 * next one, so RNTP buffers the next song and moves onto it by itself when this one ends (as
 * gapless as RNTP's player allows). That move is reported to core as `ended`, and core's `takeOver`
 * then adopts the stream already playing. Every RNTP call is chained, so a fast Next, Next, Pause
 * runs in the order it was pressed. Playback continues in the background (UIBackgroundModes audio).
 */
import type { AudioEvent, AudioPort } from '@renaissance/core';
import TrackPlayer, { Event, State } from 'react-native-track-player';
import type { AddTrack } from 'react-native-track-player';

import { debug } from './log';

export interface StreamInfo {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  duration?: number;
}

let setup: Promise<void> | null = null;

/** Set the native player up once per process; a second call (a reload in development) is fine. */
export function setupPlayer(): Promise<void> {
  setup ??= TrackPlayer.setupPlayer({ autoHandleInterruptions: true })
    .catch((error: unknown) => {
      // "The player has already been initialized" after a JS reload: carry on with it.
      if (!(error instanceof Error && /already been initialized/i.test(error.message))) throw error;
    })
    .then(() => TrackPlayer.updateOptions({ progressUpdateEventInterval: 1, capabilities: [] }));
  return setup;
}

export class RntpAudioPort implements AudioPort {
  private listeners = new Set<(event: AudioEvent) => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private currentUrl: string | null = null;
  private preloadedUrl: string | null = null;
  /** The preloaded stream RNTP moved onto by itself; `takeOver` adopts it. */
  private advancedTo: string | null = null;
  /** Set while this port moves RNTP itself, so that move is not reported as a song ending. */
  private moving = false;
  private lastPosition = 0;
  private lastDuration = 0;
  private subscriptions: { remove(): void }[];

  constructor(
    private readonly describe: (url: string) => StreamInfo | undefined = () => undefined,
    private readonly ready: () => Promise<void> = setupPlayer,
  ) {
    this.subscriptions = [
      TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e) => {
        if (this.moving) return;
        this.lastPosition = e.position;
        this.lastDuration = e.duration;
        this.emit({ type: 'time', position: e.position, duration: e.duration });
      }),
      TrackPlayer.addEventListener(Event.PlaybackState, (e) => {
        if (this.moving) return;
        if (e.state === State.Playing) this.emit({ type: 'playing' });
        else if (e.state === State.Paused || e.state === State.Ready) this.emit({ type: 'paused' });
        else if (e.state === State.Buffering || e.state === State.Loading) {
          this.emit({ type: 'waiting' });
        }
      }),
      TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e) => {
        if (this.moving || !e.track || e.track.url !== this.preloadedUrl) return;
        if (e.lastTrack?.url !== this.currentUrl) return;
        this.advancedTo = this.preloadedUrl;
        this.emit({ type: 'ended' });
      }),
      TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
        // Only the end of the song itself: a late event from a reset or a load is not an ending.
        if (this.moving || !this.currentUrl || !this.nearEnd()) return;
        this.emit({ type: 'ended' });
      }),
      TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
        this.emit({ type: 'error', message: e.message || e.code || 'media' });
      }),
    ];
  }

  private nearEnd(): boolean {
    return this.lastDuration > 0 && this.lastPosition >= this.lastDuration - 2;
  }

  private emit(event: AudioEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Run RNTP calls one after another; a failure is reported and does not stop the chain. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      await this.ready();
      return task();
    });
    this.chain = next.catch((error: unknown) => debug('rntp call failed', error));
    return next;
  }

  /** Run a task that moves RNTP's queue itself; its events are this port's, not the song's. */
  private move(task: () => Promise<void>): Promise<void> {
    return this.run(async () => {
      this.moving = true;
      try {
        await task();
      } finally {
        this.moving = false;
      }
    });
  }

  private item(url: string): AddTrack {
    const info = this.describe(url) ?? {};
    return { id: url, url, ...info };
  }

  load(url: string, position = 0): void {
    this.currentUrl = url;
    this.preloadedUrl = null;
    this.advancedTo = null;
    this.lastPosition = position;
    this.lastDuration = 0;
    void this.move(async () => {
      await TrackPlayer.reset();
      await TrackPlayer.add(this.item(url));
      if (position > 0) await TrackPlayer.seekTo(position);
    });
  }

  play(): Promise<void> {
    return this.run(() => TrackPlayer.play());
  }

  pause(): void {
    void this.run(() => TrackPlayer.pause());
  }

  seek(seconds: number): void {
    this.lastPosition = seconds;
    void this.run(() => TrackPlayer.seekTo(seconds));
  }

  setVolume(volume: number): void {
    void this.run(() => TrackPlayer.setVolume(volume));
  }

  preload(url: string | null): void {
    if (url === this.preloadedUrl) return;
    this.preloadedUrl = url;
    if (!this.currentUrl) return;
    void this.move(async () => {
      await TrackPlayer.removeUpcomingTracks();
      if (url) await TrackPlayer.add(this.item(url));
    });
  }

  takeOver(url: string): boolean {
    if (!this.currentUrl || this.preloadedUrl !== url) return false;
    const auto = this.advancedTo === url;
    this.currentUrl = url;
    this.preloadedUrl = null;
    this.advancedTo = null;
    this.lastPosition = 0;
    this.lastDuration = 0;
    void this.move(async () => {
      // Pressed Next with the next song buffered: move onto it here.
      if (!auto) await TrackPlayer.skipToNext();
      const index = await TrackPlayer.getActiveTrackIndex();
      if (index) await TrackPlayer.remove([...Array(index).keys()]);
    });
    return true;
  }

  position(): number {
    return this.lastPosition;
  }

  duration(): number {
    return this.lastDuration;
  }

  on(listener: (event: AudioEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    for (const sub of this.subscriptions) sub.remove();
    this.listeners.clear();
    this.currentUrl = null;
    this.preloadedUrl = null;
    void this.run(() => TrackPlayer.reset());
  }
}
