/**
 * Playlist actions (F13): create, rename, delete, add, remove and reorder, each synced with Jellyfin,
 * each with a toast and an undo (DESIGN.md rule 10). Kept apart from `actions.ts` so the shell does
 * not carry them; the playlist page, the dialogs and the song menu load this module.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Playlist, PlaylistEntry, Track } from '@renaissance/core';
import type { TFunction } from 'i18next';

import { titleOf } from './names';
import { addItems, patchItems } from './library';
import { queryKeys } from './queries';
import { sessionStore } from './session';
import { toast } from './toast';

function current() {
  const { adapter, session } = sessionStore.get();
  if (!adapter || !session) throw new Error('signed out');
  return { adapter, session };
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
    toast(t('playlist.created', { name: playlist.name }), {
      undo: () => void deletePlaylist(playlist, t, { quiet: true }),
    });
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

/**
 * Delete a playlist. Undo makes it again with the same songs when the caller knew them (the playlist
 * page passes its entries); the server's ids are new, the name and order are the same.
 */
export async function deletePlaylist(
  playlist: Playlist,
  t: TFunction,
  options: { entries?: PlaylistEntry[]; quiet?: boolean } = {},
): Promise<boolean> {
  try {
    const { adapter, session } = current();
    await adapter.playlists.remove(session, playlist.id);
    patchItems('playlist', (p) => (p.id === playlist.id ? null : p));
    if (!options.quiet) {
      const entries = options.entries;
      toast(
        t('playlist.deleted', { name: playlist.name }),
        entries
          ? {
              undo: () =>
                void createPlaylist(
                  playlist.name,
                  entries.map((e) => e.id),
                  t,
                ),
            }
          : {},
      );
    }
    return true;
  } catch {
    toast(t('error.failed'), { tone: 'danger' });
    return false;
  }
}

function setPlaylistCount(playlistId: string, delta: number): void {
  patchItems('playlist', (p) =>
    p.id === playlistId
      ? { ...p, trackCount: Math.max(0, ((p as Playlist).trackCount ?? 0) + delta) }
      : p,
  );
}

/** Add songs, read the playlist back, and offer to take those very entries out again. */
export async function addToPlaylist(
  playlist: Playlist,
  tracks: Track[],
  t: TFunction,
  queryClient: QueryClient,
  options: { quiet?: boolean } = {},
): Promise<void> {
  try {
    const { adapter, session } = current();
    await adapter.playlists.addTracks(
      session,
      playlist.id,
      tracks.map((x) => x.id),
    );
    setPlaylistCount(playlist.id, tracks.length);
    const entries = await adapter.library(session).playlistTracks(playlist.id);
    queryClient.setQueryData(queryKeys.playlistTracks(playlist.id), entries);
    if (options.quiet) return;
    // Jellyfin appends: the added entries are the last ones.
    const added = entries.slice(-tracks.length).map((e) => e.entryId);
    toast(
      tracks.length === 1
        ? t('playlist.added', { name: playlist.name })
        : t('playlist.addedCount', { name: playlist.name, count: tracks.length }),
      {
        undo: () =>
          void removeFromPlaylist(
            playlist,
            added,
            tracks[0] ? titleOf(tracks[0], t) : '',
            t,
            queryClient,
            {
              quiet: true,
            },
          ),
      },
    );
  } catch {
    toast(t('error.failed'), { tone: 'danger' });
  }
}

/** Remove entries; undo adds the songs back (at the end, which is where Jellyfin puts them). */
export async function removeFromPlaylist(
  playlist: Playlist,
  entryIds: string[],
  title: string,
  t: TFunction,
  queryClient: QueryClient,
  options: { quiet?: boolean; tracks?: Track[] } = {},
): Promise<void> {
  try {
    const { adapter, session } = current();
    await adapter.playlists.removeEntries(session, playlist.id, entryIds);
    setPlaylistCount(playlist.id, -entryIds.length);
    const entries = await adapter.library(session).playlistTracks(playlist.id);
    queryClient.setQueryData(queryKeys.playlistTracks(playlist.id), entries);
    if (options.quiet) return;
    const removed = options.tracks;
    toast(
      t('playlist.removed', { title, name: playlist.name }),
      removed?.length
        ? { undo: () => void addToPlaylist(playlist, removed, t, queryClient, { quiet: true }) }
        : {},
    );
  } catch {
    toast(t('error.failed'), { tone: 'danger' });
  }
}

/**
 * Reorder (F13). The adapter moves the entry, reads the playlist back and says whether the server's
 * order is the one asked for; the screen shows the server's order either way. The toast comes after
 * the read-back and undoes by moving the entry back; when the order differs it is an error toast.
 */
export async function movePlaylistEntry(
  playlist: Playlist,
  entryId: string,
  toIndex: number,
  title: string,
  t: TFunction,
  queryClient: QueryClient,
  options: { quiet?: boolean } = {},
): Promise<boolean> {
  const key = queryKeys.playlistTracks(playlist.id);
  const before = queryClient.getQueryData<PlaylistEntry[]>(key) ?? [];
  const fromIndex = before.findIndex((e) => e.entryId === entryId);
  try {
    const { adapter, session } = current();
    const result = await adapter.playlists.move(session, playlist.id, entryId, toIndex);
    queryClient.setQueryData(key, result.entries);
    if (!result.ok) {
      toast(t('playlist.reorderFailed', { title }), { tone: 'danger' });
      return false;
    }
    if (!options.quiet) {
      toast(t('playlist.reorderedTo', { title, position: toIndex + 1 }), {
        undo: () => {
          if (fromIndex >= 0) {
            void movePlaylistEntry(playlist, entryId, fromIndex, title, t, queryClient, {
              quiet: true,
            });
          }
        },
      });
    }
    return true;
  } catch {
    await queryClient.invalidateQueries({ queryKey: key });
    toast(t('error.failed'), { tone: 'danger' });
    return false;
  }
}
