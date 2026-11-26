import { createStore } from '@renaissance/core';
import type { Playlist, PlaylistEntry, Track } from '@renaissance/core';

/** The song menu any row can open; rendered once by the shell as a bottom sheet (web's TrackMenu). */
export interface TrackMenuState {
  track: Track;
  /** Set on a playlist page: the entry, so the menu can offer "Remove from playlist". */
  playlist?: { playlist: Playlist; entry: PlaylistEntry; index: number; count: number };
}

export const trackMenuStore = createStore<TrackMenuState | null>(null);

export function openTrackMenu(state: TrackMenuState): void {
  trackMenuStore.set(state);
}

export function closeTrackMenu(): void {
  trackMenuStore.set(null);
}
