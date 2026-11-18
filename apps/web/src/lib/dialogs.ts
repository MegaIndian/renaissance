import { createStore } from '@renaissance/core';
import type { Playlist, Track } from '@renaissance/core';

/** Dialogs any screen can open; rendered once by the shell. */
export type Dialog =
  | { kind: 'addToPlaylist'; tracks: Track[] }
  | { kind: 'renamePlaylist'; playlist: Playlist }
  | { kind: 'deletePlaylist'; playlist: Playlist; onDeleted?: () => void }
  | { kind: 'newPlaylist'; tracks?: Track[] };

export const dialogStore = createStore<Dialog | null>(null);

export function openDialog(dialog: Dialog): void {
  dialogStore.set(dialog);
}

export function closeDialog(): void {
  dialogStore.set(null);
}
