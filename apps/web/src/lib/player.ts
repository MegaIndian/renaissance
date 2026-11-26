/**
 * The web half of playback: `DomAudioPort` (two media elements, so the next track is buffered while
 * this one plays and takes over on `ended`, F21), the Player singleton wired to the session and
 * settings, the persisted queue (F22) and the MediaSession bridge for media keys and lock screens (F25).
 */
import { Player, playbackSettingsFrom, readSavedQueue, toSavedQueue } from '@renaissance/core';
import type { AudioEvent, AudioPort, QueueState, Track } from '@renaissance/core';

import { i18n } from './i18n';
import { libraryStore } from './library';
import { debug } from './log';
import { networkFor } from './network';
import { sessionStore } from './session';
import { settingsStore } from './settings';
import { toast } from './toast';

export class DomAudioPort implements AudioPort {
  private slots: [HTMLAudioElement, HTMLAudioElement];
  private current = 0;
  private listeners = new Set<(event: AudioEvent) => void>();
  private pendingSeek: number | null = null;
  private preloadedUrl: string | null = null;

  constructor(create: () => HTMLAudioElement = () => new Audio()) {
    this.slots = [create(), create()];
    for (const el of this.slots) {
      // Nothing is fetched until a stream is loaded or preloaded on purpose (a restored queue
      // must not start a transcode on the server).
      el.preload = 'none';
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
    this.el.preload = 'auto';
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
        this.spare.preload = 'auto';
        this.spare.src = url;
        this.spare.load();
      }
    } else {
      this.spare.removeAttribute('src');
      this.spare.preload = 'none';
    }
  }

  takeOver(url: string): boolean {
    // A spare whose stream failed (refused while this one was refused too) is not adopted: the
    // caller loads the track afresh instead of inheriting the error.
    if (this.preloadedUrl !== url || this.spare.src !== url || this.spare.error) return false;
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
const POSITION_KEY = 'renaissance.position';

/**
 * The persisted queue (F22) in core's format (`saved-queue.ts`): song ids and the queue's
 * bookkeeping, never the songs themselves, so a 20,000-song shuffle fits in localStorage (func AA).
 */
function queueKey(userId: string): string {
  return `${QUEUE_KEY}.${userId}`;
}

/**
 * The position lives under its own key: it changes every few seconds while the queue, a megabyte
 * for a 20,000-song shuffle, changes only when the user touches it (prod AK). The queue record
 * keeps a position too, for the reload that follows a queue change before the next tick.
 */
function positionKey(userId: string): string {
  return `${POSITION_KEY}.${userId}`;
}

/** Write only the position for this user; false when the browser refused. */
export function savePosition(userId: string, position: number): boolean {
  try {
    localStorage.setItem(positionKey(userId), String(Math.floor(position)));
    return true;
  } catch (error) {
    debug('position save failed', error);
    return false;
  }
}

/** Write the queue for this user; false when the browser refused (quota, private window). */
export function saveQueue(userId: string, queue: QueueState, position: number): boolean {
  try {
    const saved = toSavedQueue(userId, queue, position);
    localStorage.setItem(queueKey(userId), JSON.stringify(saved));
    localStorage.setItem(positionKey(userId), String(position));
    return true;
  } catch (error) {
    debug('queue save failed', error);
    return false;
  }
}

/** Remove a user's saved queue and position from this browser (sign-out, F86). */
export function forgetQueue(userId: string): void {
  try {
    localStorage.removeItem(queueKey(userId));
    localStorage.removeItem(positionKey(userId));
  } catch {
    /* nothing to forget */
  }
}

/**
 * Read a user's saved queue, with the songs looked up in the library by id (core's
 * `readSavedQueue`: a song the library no longer holds is left out; nothing left is `null`).
 */
export function loadQueue(
  userId: string,
  lookup: (id: string) => Track | undefined,
): { queue: QueueState; position: number } | null {
  try {
    return readSavedQueue(
      localStorage.getItem(queueKey(userId)),
      localStorage.getItem(positionKey(userId)),
      lookup,
    );
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

/** A save that fails is said once per page: the queue still works, it just lasts the session. */
let saveFailureReported = false;

function persist(userId: string, queue: QueueState, position: number): void {
  if (saveQueue(userId, queue, position) || saveFailureReported) return;
  saveFailureReported = true;
  toast(i18n.t('queue.saveFailed'), { tone: 'danger' });
}

function attachPersistence(p: Player): void {
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  let lastQueue: QueueState | null = null;
  let lastUserId: string | undefined;
  const clearTimer = (): void => {
    if (positionTimer) clearTimeout(positionTimer);
    positionTimer = undefined;
  };
  // A sign-out or a change of user ends the tick: it must not write the previous user's key back
  // after `forgetQueue` removed it (prod AL).
  sessionStore.subscribe((state) => {
    const userId = state.session?.userId;
    if (userId === lastUserId) return;
    lastUserId = userId;
    lastQueue = null;
    clearTimer();
  });
  p.subscribe((snapshot) => {
    const userId = sessionStore.get().session?.userId;
    if (!userId) return;
    if (snapshot.queue !== lastQueue) {
      // A queue change is saved at once; a reload a moment later must find it.
      lastQueue = snapshot.queue;
      persist(userId, snapshot.queue, Math.floor(snapshot.position));
      return;
    }
    // The position alone, at most every five seconds, without postponing itself (prod AK).
    if (positionTimer) return;
    positionTimer = setTimeout(() => {
      positionTimer = undefined;
      // The user is read again now: the one from five seconds ago may have signed out.
      const now = sessionStore.get().session?.userId;
      if (!now) return;
      savePosition(now, p.snapshot.position);
    }, 5000);
  });
}

/**
 * Restore the saved queue for a user once, after sign-in; nothing plays until Play is pressed. The
 * songs come from the library snapshot, so this waits for the cache to be read (and, on a first
 * sign-in, for the first sync) and gives up if the user signs out meanwhile.
 */
export function restoreQueue(userId: string): void {
  const p = getPlayer();
  if (p.snapshot.queue.items.length) return;
  const attempt = (): boolean => {
    const { snapshot, ready, sync } = libraryStore.get();
    const firstSync =
      !ready || sync.status === 'loading' || (sync.status === 'syncing' && !snapshot.syncedAt);
    if (firstSync) return false;
    const byId = new Map(snapshot.tracks.map((t) => [t.id, t]));
    const saved = loadQueue(userId, (id) => byId.get(id));
    if (saved && !p.snapshot.queue.items.length) p.restore(saved.queue, saved.position);
    return true;
  };
  if (attempt()) return;
  const unsubscribe = libraryStore.subscribe(() => {
    if (sessionStore.get().session?.userId !== userId || attempt()) unsubscribe();
  });
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
          title: track.title || i18n.t('library.untitled'),
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
  saveFailureReported = false;
}
