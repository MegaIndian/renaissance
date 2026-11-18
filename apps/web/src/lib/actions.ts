/**
 * What a tap does, in one place: favourites (F12), playlists (F13) and the queue (F22). Each action
 * changes the screen at once, talks to the server, says what it did in a toast and offers an undo
 * (DESIGN.md rule 10); a failed server call rolls the screen back and says so.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Album, Artist, CacheItem, Playlist, Track } from '@renaissance/core';
import type { TFunction } from 'i18next';

import { addItems, libraryStore, patchItems } from './library';
import { getPlayer } from './player';
import { queryKeys } from './queries';
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

export async function createPlaylist(
  name: string,
  trackIds: string[],
  t: TFunction,
): Promise<Playlist | null> {
  try {
    const { adapter, session } = current();
    const playlist = await adapter.playlists.create(session, name, trackIds);
    addItems('playlist', [playlist]);
    toast(t('playlist.created', { name: playlist.name }));
    return playlist;
  } catch {
    toast(t('error.failed'), { tone: 'danger' });
    return null;
  }
}

export async function renamePlaylist(
  playlist: Playlist,
  name: string,
  t: TFunction,
): Promise<void> {
  const previous = playlist.name;
  patchItems('playlist', (p) => (p.id === playlist.id ? { ...p, name } : p));
  try {
    const { adapter, session } = current();
    await adapter.playlists.rename(session, playlist.id, name);
    toast(t('playlist.renamed', { name }), {
      undo: () => void renamePlaylist({ ...playlist, name }, previous, t),
    });
  } catch {
    patchItems('playlist', (p) => (p.id === playlist.id ? { ...p, name: previous } : p));
    toast(t('error.failed'), { tone: 'danger' });
  }
}

export async function deletePlaylist(playlist: Playlist, t: TFunction): Promise<boolean> {
  try {
    const { adapter, session } = current();
    await adapter.playlists.remove(session, playlist.id);
    patchItems('playlist', (p) => (p.id === playlist.id ? null : p));
    toast(t('playlist.deleted', { name: playlist.name }));
    return true;
  } catch {
    toast(t('error.failed'), { tone: 'danger' });
    return false;
  }
}

export async function addToPlaylist(
  playlist: Playlist,
  tracks: Track[],
  t: TFunction,
  queryClient: QueryClient,
): Promise<void> {
  try {
    const { adapter, session } = current();
    await adapter.playlists.addTracks(
      session,
      playlist.id,
      tracks.map((x) => x.id),
    );
    patchItems('playlist', (p) =>
      p.id === playlist.id
        ? { ...p, trackCount: ((p as Playlist).trackCount ?? 0) + tracks.length }
        : p,
    );
    await queryClient.invalidateQueries({ queryKey: queryKeys.playlistTracks(playlist.id) });
    toast(
      tracks.length === 1
        ? t('playlist.added', { name: playlist.name })
        : t('playlist.addedCount', { name: playlist.name, count: tracks.length }),
    );
  } catch {
    toast(t('error.failed'), { tone: 'danger' });
  }
}

export async function removeFromPlaylist(
  playlist: Playlist,
  entryIds: string[],
  title: string,
  t: TFunction,
  queryClient: QueryClient,
): Promise<void> {
  try {
    const { adapter, session } = current();
    await adapter.playlists.removeEntries(session, playlist.id, entryIds);
    patchItems('playlist', (p) =>
      p.id === playlist.id
        ? { ...p, trackCount: Math.max(0, ((p as Playlist).trackCount ?? 0) - entryIds.length) }
        : p,
    );
    await queryClient.invalidateQueries({ queryKey: queryKeys.playlistTracks(playlist.id) });
    toast(t('playlist.removed', { title, name: playlist.name }));
  } catch {
    toast(t('error.failed'), { tone: 'danger' });
  }
}

export async function movePlaylistEntry(
  playlist: Playlist,
  entryId: string,
  toIndex: number,
  title: string,
  t: TFunction,
  queryClient: QueryClient,
): Promise<void> {
  try {
    const { adapter, session } = current();
    await adapter.playlists.move(session, playlist.id, entryId, toIndex);
    await queryClient.invalidateQueries({ queryKey: queryKeys.playlistTracks(playlist.id) });
    toast(t('playlist.reordered', { title }));
  } catch {
    await queryClient.invalidateQueries({ queryKey: queryKeys.playlistTracks(playlist.id) });
    toast(t('error.failed'), { tone: 'danger' });
  }
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

export function cachedArtistTracks(artistId: string): Track[] {
  return libraryStore.get().snapshot.tracks.filter((x) => x.artistIds.includes(artistId));
}
