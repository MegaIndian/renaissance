/**
 * What a tap does, in one place: favourites (F12) and the queue (F22); playlists (F13) live in
 * `playlist-actions.ts`, which only the screens that edit playlists load. Each action changes the
 * screen at once, talks to the server, says what it did in a toast and offers an undo (DESIGN.md
 * rule 10); a failed server call rolls the screen back and says so.
 */
import { creditsArtist, findArtist } from '@renaissance/core';
import type { Album, Artist, CacheItem, Playlist, Track } from '@renaissance/core';
import type { TFunction } from 'i18next';

import { libraryStore, patchItems } from './library';
import { getPlayer } from './player';
import { sessionStore } from './session';
import { toast } from './toast';

function current() {
  const { adapter, session } = sessionStore.get();
  if (!adapter || !session) throw new Error('signed out');
  return { adapter, session };
}

type Kind = 'track' | 'album' | 'artist' | 'playlist';

function setLocalFavorite(kind: Kind, id: string, favorite: boolean): void {
  patchItems(kind, (item: CacheItem) =>
    item.id === id && item.isFavorite !== favorite ? { ...item, isFavorite: favorite } : item,
  );
}

export async function toggleFavorite(
  kind: Kind,
  item: Track | Album | Artist | Playlist,
  t: TFunction,
): Promise<void> {
  const next = !item.isFavorite;
  const title = 'title' in item ? item.title : item.name;
  setLocalFavorite(kind, item.id, next);
  try {
    const { adapter, session } = current();
    await adapter.favorites.set(session, item.id, next);
    toast(t(next ? 'favorites.added' : 'favorites.removed', { title }), {
      undo: () => void toggleFavorite(kind, { ...item, isFavorite: next }, t),
    });
  } catch {
    setLocalFavorite(kind, item.id, !next);
    toast(t('error.failed'), { tone: 'danger' });
  }
}

export function playNow(tracks: Track[], startAt = 0): void {
  getPlayer().playTracks(tracks, startAt);
}

export function playNext(tracks: Track[], t: TFunction): void {
  if (!tracks.length) return;
  const player = getPlayer();
  const before = player.snapshot.queue;
  player.playNext(tracks);
  const message =
    tracks.length === 1
      ? t('queue.addedNext', { title: tracks[0]?.title })
      : t('queue.addedCountNext', { count: tracks.length });
  toast(message, {
    undo: () => undoQueueAdd(before.items.length, tracks.length, before.index + 1),
  });
}

export function addToQueue(tracks: Track[], t: TFunction): void {
  if (!tracks.length) return;
  const player = getPlayer();
  const before = player.snapshot.queue;
  player.addToEnd(tracks);
  const message =
    tracks.length === 1
      ? t('queue.addedToEnd', { title: tracks[0]?.title })
      : t('queue.addedCountEnd', { count: tracks.length });
  toast(message, {
    undo: () => undoQueueAdd(before.items.length, tracks.length, before.items.length),
  });
}

function undoQueueAdd(lengthBefore: number, added: number, insertedAt: number): void {
  const player = getPlayer();
  if (player.snapshot.queue.items.length !== lengthBefore + added) return;
  for (let i = 0; i < added; i++) player.removeAt(Math.max(0, insertedAt));
}

/** Every track of an album from the cache, in disc and track order; the album page uses the server list. */
export function cachedAlbumTracks(albumId: string): Track[] {
  return libraryStore
    .get()
    .snapshot.tracks.filter((x) => x.albumId === albumId)
    .sort(
      (a, b) =>
        (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0),
    );
}

/** Every cached track credited to the artist behind this id, under any of its ids or by name. */
export function cachedArtistTracks(artistId: string): Track[] {
  const { artists, tracks } = libraryStore.get().snapshot;
  const artist = findArtist(artists, artistId);
  if (!artist) return tracks.filter((x) => x.artistIds.includes(artistId));
  return tracks.filter((x) => creditsArtist(x, artist));
}
