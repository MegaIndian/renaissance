/**
 * The web half of playback: `DomAudioPort` (two media elements, so the next track is buffered while
 * this one plays and takes over on `ended`, F21), the Player singleton wired to the session and
 * settings, the persisted queue (F22) and the MediaSession bridge for media keys and lock screens (F25).
 */
import { Player, parseQueue, playbackSettingsFrom } from '@renaissance/core';
import type { AudioEvent, AudioPort, QueueState, Track } from '@renaissance/core';

import { networkFor } from './network';
import { sessionStore } from './session';
import { settingsStore } from './settings';

export class DomAudioPort implements AudioPort {
  private slots: [HTMLAudioElement, HTMLAudioElement];
  private current = 0;
  private listeners = new Set<(event: AudioEvent) => void>();
  private pendingSeek: number | null = null;
  private preloadedUrl: string | null = null;

  constructor(create: () => HTMLAudioElement = () => new Audio()) {
    this.slots = [create(), create()];
    for (const el of this.slots) {
      el.preload = 'auto';
      el.crossOrigin = null;
    }
    this.attach(this.slots[0]);
  }

  private get el(): HTMLAudioElement {
    return this.slots[this.current] as HTMLAudioElement;
  }

  private get spare(): HTMLAudioElement {
    return this.slots[1 - this.current] as HTMLAudioElement;
  }

  private emit(event: AudioEvent): void {
    for (const l of this.listeners) l(event);
  }

  private handlers = {
    timeupdate: () =>
      this.emit({ type: 'time', position: this.el.currentTime, duration: this.el.duration || 0 }),
    durationchange: () =>
      this.emit({ type: 'time', position: this.el.currentTime, duration: this.el.duration || 0 }),
    playing: () => this.emit({ type: 'playing' }),
    pause: () => {
      if (!this.el.ended) this.emit({ type: 'paused' });
    },
    waiting: () => this.emit({ type: 'waiting' }),
    ended: () => this.emit({ type: 'ended' }),
    error: () => this.emit({ type: 'error', message: this.el.error?.message || 'media' }),
    loadedmetadata: () => {
      if (this.pendingSeek !== null) {
        this.el.currentTime = this.pendingSeek;
        this.pendingSeek = null;
      }
    },
  };

  private attach(el: HTMLAudioElement): void {
    for (const [name, handler] of Object.entries(this.handlers)) el.addEventListener(name, handler);
  }

  private detach(el: HTMLAudioElement): void {
    for (const [name, handler] of Object.entries(this.handlers))
      el.removeEventListener(name, handler);
  }

  load(url: string, position = 0): void {
    this.pendingSeek = position > 0 ? position : null;
    this.el.src = url;
    this.el.load();
  }

  play(): Promise<void> {
    return this.el.play();
  }

  pause(): void {
    this.el.pause();
  }

  seek(seconds: number): void {
    if (Number.isFinite(this.el.duration) || this.el.readyState > 0) this.el.currentTime = seconds;
    else this.pendingSeek = seconds;
  }

  setVolume(volume: number): void {
    for (const el of this.slots) el.volume = volume;
  }

  preload(url: string | null): void {
    this.preloadedUrl = url;
    if (url) {
      if (this.spare.src !== url) {
        this.spare.src = url;
        this.spare.load();
      }
    } else {
      this.spare.removeAttribute('src');
    }
  }

  takeOver(url: string): boolean {
    if (this.preloadedUrl !== url || this.spare.src !== url) return false;
    const old = this.el;
    this.detach(old);
    old.pause();
    old.removeAttribute('src');
    this.current = 1 - this.current;
    this.attach(this.el);
    this.preloadedUrl = null;
    this.pendingSeek = null;
    return true;
  }

  position(): number {
    return this.el.currentTime;
  }

  duration(): number {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }

  on(listener: (event: AudioEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    for (const el of this.slots) {
      this.detach(el);
      el.pause();
      el.removeAttribute('src');
    }
    this.listeners.clear();
  }
}

const QUEUE_KEY = 'renaissance.queue';

interface SavedQueue {
  userId: string;
  queue: QueueState;
  position: number;
}

function queueKey(userId: string): string {
  return `${QUEUE_KEY}.${userId}`;
}

export function saveQueue(userId: string, queue: QueueState, position: number): void {
  try {
    const saved: SavedQueue = { userId, queue, position };
    localStorage.setItem(queueKey(userId), JSON.stringify(saved));
  } catch {
    /* storage full or unavailable: the queue lasts the session */
  }
}

export function loadQueue(userId: string): { queue: QueueState; position: number } | null {
  try {
    const raw = localStorage.getItem(queueKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedQueue>;
    const queue = parseQueue(parsed.queue);
    if (!queue.items.length) return null;
    const position =
      typeof parsed.position === 'number' && parsed.position >= 0 ? parsed.position : 0;
    return { queue, position };
  } catch {
    return null;
  }
}

let player: Player | null = null;

/** The one Player for the page, created on first use and kept across sign-ins (the session is read live). */
export function getPlayer(): Player {
  if (player) return player;
  const created = new Player({
    audio: new DomAudioPort(),
    adapter: new Proxy({} as never, {
      get: (_target, prop) => {
        const adapter = sessionStore.get().adapter;
        if (!adapter) return () => '';
        const value = adapter[prop as keyof typeof adapter];
        return typeof value === 'function' ? value.bind(adapter) : value;
      },
    }),
    session: () => sessionStore.get().session,
    network: () => networkFor(settingsStore.get()),
    settings: () => playbackSettingsFrom(settingsStore.get()),
    onReportError: () => undefined,
  });
  player = created;
  attachPersistence(created);
  attachMediaSession(created);
  return created;
}

function attachPersistence(p: Player): void {
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  let lastQueue: QueueState | null = null;
  p.subscribe((snapshot) => {
    const userId = sessionStore.get().session?.userId;
    if (!userId) return;
    if (snapshot.queue !== lastQueue) {
      // A queue change is saved at once; a reload a moment later must find it.
      lastQueue = snapshot.queue;
      saveQueue(userId, snapshot.queue, Math.floor(snapshot.position));
      return;
    }
    // The position is saved at most every five seconds, without postponing itself.
    if (positionTimer) return;
    positionTimer = setTimeout(() => {
      positionTimer = undefined;
      const current = p.snapshot;
      saveQueue(userId, current.queue, Math.floor(current.position));
    }, 5000);
  });
}

/** Restore the saved queue for a user once, after sign-in; nothing plays until Play is pressed. */
export function restoreQueue(userId: string): void {
  const saved = loadQueue(userId);
  if (!saved) return;
  const p = getPlayer();
  if (p.snapshot.queue.items.length) return;
  p.restore(saved.queue, saved.position);
}

export function artworkUrl(track: Track, width: number): string | null {
  const { adapter, session } = sessionStore.get();
  if (!adapter || !session || !track.imageId) return null;
  return adapter.imageUrl(session, track.imageId, width);
}

function attachMediaSession(p: Player): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => void p.play());
  ms.setActionHandler('pause', () => p.pause());
  ms.setActionHandler('previoustrack', () => p.previous());
  ms.setActionHandler('nexttrack', () => p.next());
  ms.setActionHandler('seekto', (details) => {
    if (typeof details.seekTime === 'number') p.seek(details.seekTime);
  });
  ms.setActionHandler('seekbackward', (details) =>
    p.seek(p.snapshot.position - (details.seekOffset ?? 10)),
  );
  ms.setActionHandler('seekforward', (details) =>
    p.seek(p.snapshot.position + (details.seekOffset ?? 10)),
  );
  let lastTrack: Track | undefined;
  p.subscribe((snapshot) => {
    const track = snapshot.queue.items[snapshot.queue.index];
    if (track !== lastTrack) {
      lastTrack = track;
      if (!track) {
        ms.metadata = null;
      } else {
        const art = [192, 512].flatMap((size) => {
          const src = artworkUrl(track, size);
          return src ? [{ src, sizes: `${size}x${size}`, type: 'image/jpeg' }] : [];
        });
        ms.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artistName,
          album: track.albumTitle ?? '',
          artwork: art,
        });
      }
    }
    ms.playbackState =
      snapshot.status === 'playing' || snapshot.status === 'loading'
        ? 'playing'
        : snapshot.status === 'paused'
          ? 'paused'
          : 'none';
    if (track && snapshot.duration > 0 && typeof ms.setPositionState === 'function') {
      try {
        ms.setPositionState({
          duration: snapshot.duration,
          position: Math.min(snapshot.position, snapshot.duration),
          playbackRate: 1,
        });
      } catch {
        /* a position past the duration during a seek is harmless */
      }
    }
  });
}

/** For tests. */
export function resetPlayerForTests(): void {
  player?.destroy();
  player = null;
}
