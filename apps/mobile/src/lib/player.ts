/**
 * The phone half of playback: the Player singleton over RNTP (`audio.ts`), wired to the session and
 * settings, with the queue persisted in core's format (F22). Play state reaches Jellyfin through
 * core's reporter (F26). Lock-screen controls come in a later change.
 */
import { Player, playbackSettingsFrom, readSavedQueue, toSavedQueue } from '@renaissance/core';
import type { JellyfinAdapter, QueueState, Track } from '@renaissance/core';

import { RntpAudioPort } from './audio';
import type { StreamInfo } from './audio';
import { getItem, removeItem, setItem } from './kv';
import { libraryStore } from './library';
import { networkFor } from './network';
import { PHONE_CODECS, sessionStore } from './session';
import { settingsStore } from './settings';

const QUEUE_KEY = 'renaissance.queue';
const POSITION_KEY = 'renaissance.position';

const queueKey = (userId: string) => `${QUEUE_KEY}.${userId}`;
const positionKey = (userId: string) => `${POSITION_KEY}.${userId}`;

export function saveQueue(userId: string, queue: QueueState, position: number): void {
  setItem(queueKey(userId), JSON.stringify(toSavedQueue(userId, queue, position)));
  setItem(positionKey(userId), String(Math.floor(position)));
}

export function savePosition(userId: string, position: number): void {
  setItem(positionKey(userId), String(Math.floor(position)));
}

export function loadQueue(userId: string, lookup: (id: string) => Track | undefined) {
  return readSavedQueue(getItem(queueKey(userId)), getItem(positionKey(userId)), lookup);
}

/** Remove a user's saved queue and position from this device (sign-out, F86). */
export function forgetQueue(userId: string): void {
  removeItem(queueKey(userId));
  removeItem(positionKey(userId));
}

export function artworkUrl(item: { imageId?: string | undefined }, width: number): string | null {
  const { adapter, session } = sessionStore.get();
  if (!adapter || !session || !item.imageId) return null;
  return adapter.imageUrl(session, item.imageId, width);
}

/** The song behind each stream URL the player asked for, so RNTP can show its title. */
const streams = new Map<string, Track>();

function describe(url: string): StreamInfo | undefined {
  const track = streams.get(url);
  if (!track) return undefined;
  const artwork = artworkUrl(track, 512);
  return {
    title: track.title,
    artist: track.artistName,
    ...(track.albumTitle ? { album: track.albumTitle } : {}),
    ...(artwork ? { artwork } : {}),
    duration: track.duration,
  };
}

/** The adapter the session holds now, read on every call, with stream URLs remembered. */
const liveAdapter = new Proxy({} as JellyfinAdapter, {
  get: (_target, prop) => {
    const adapter = sessionStore.get().adapter;
    if (!adapter) return () => '';
    if (prop === 'streamUrl') {
      return (...args: Parameters<JellyfinAdapter['streamUrl']>) => {
        const url = adapter.streamUrl(...args);
        if (streams.size > 50) streams.clear();
        streams.set(url, args[1]);
        return url;
      };
    }
    const value = adapter[prop as keyof JellyfinAdapter];
    return typeof value === 'function'
      ? (value as (...a: unknown[]) => unknown).bind(adapter)
      : value;
  },
});

let player: Player | null = null;

/** The one Player for the app, created on first use and kept across sign-ins. */
export function getPlayer(): Player {
  if (player) return player;
  const created = new Player({
    audio: new RntpAudioPort(describe),
    adapter: liveAdapter,
    session: () => sessionStore.get().session,
    network: () => networkFor(settingsStore.get()),
    settings: () => ({
      ...playbackSettingsFrom(settingsStore.get()),
      directPlayCodecs: PHONE_CODECS,
    }),
    onReportError: () => undefined,
  });
  player = created;
  attachPersistence(created);
  return created;
}

function attachPersistence(p: Player): void {
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  let lastQueue: QueueState | null = null;
  let lastUserId: string | undefined;
  sessionStore.subscribe((state) => {
    const userId = state.session?.userId;
    if (userId === lastUserId) return;
    lastUserId = userId;
    lastQueue = null;
    if (positionTimer) clearTimeout(positionTimer);
    positionTimer = undefined;
  });
  p.subscribe((snapshot) => {
    const userId = sessionStore.get().session?.userId;
    if (!userId) return;
    if (snapshot.queue !== lastQueue) {
      lastQueue = snapshot.queue;
      saveQueue(userId, snapshot.queue, snapshot.position);
      return;
    }
    if (positionTimer) return;
    positionTimer = setTimeout(() => {
      positionTimer = undefined;
      const now = sessionStore.get().session?.userId;
      if (now) savePosition(now, p.snapshot.position);
    }, 5000);
  });
}

/**
 * Restore the saved queue for a user once, after sign-in; nothing plays until Play is pressed. The
 * songs come from the library snapshot, so this waits for the cache (and a first sync).
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

/** For tests. */
export function resetPlayerForTests(): void {
  player?.destroy();
  player = null;
  streams.clear();
}
