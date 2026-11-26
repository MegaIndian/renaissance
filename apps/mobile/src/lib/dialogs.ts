import { createStore } from '@renaissance/core';
import type { Playlist, PlaylistEntry, Track } from '@renaissance/core';

/** Dialogs any screen can open; rendered once by the shell. */
export type Dialog =
  | { kind: 'addToPlaylist'; tracks: Track[] }
  | { kind: 'renamePlaylist'; playlist: Playlist }
  | {
      kind: 'deletePlaylist';
      playlist: Playlist;
      /** The entries as shown, so the undo can make the playlist again. */
      entries?: PlaylistEntry[];
      onDeleted?: () => void;
    }
  | { kind: 'newPlaylist'; tracks?: Track[] };

export const dialogStore = createStore<Dialog | null>(null);

export function openDialog(dialog: Dialog): void {
  dialogStore.set(dialog);
}

export function closeDialog(): void {
  dialogStore.set(null);
}
