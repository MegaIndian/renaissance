import { JellyfinAdapter, LibraryIndex, buildSnapshot } from '@renaissance/core';
import type { Album, Artist, Session, Track } from '@renaissance/core';

import { libraryStore } from '@/lib/library';
import { sessionStore } from '@/lib/session';

export const server = {
  id: 'demo.test',
  kind: 'jellyfin' as const,
  name: 'demo.test',
  url: 'https://demo.test',
};
export const session: Session = { server, userId: 'u1', userName: 'Asha', token: 'tok' };

export const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id,
  title: `Song ${id}`,
  artistIds: ['ar1'],
  artistName: 'Kevin',
  albumId: 'al1',
  albumTitle: 'Royalty Free',
  duration: 125,
  isFavorite: false,
  playCount: 0,
  genres: ['Jazz'],
  ...extra,
});

export const album: Album = {
  id: 'al1',
  title: 'Royalty Free',
  artistIds: ['ar1'],
  artistName: 'Kevin',
  genres: ['Jazz'],
  isFavorite: false,
  playCount: 0,
  year: 2010,
  trackCount: 2,
};

export const artist: Artist = { id: 'ar1', name: 'Kevin', isFavorite: false, playCount: 0 };

/** A signed-in session over an adapter whose network calls are stubbed. */
export function signIn(overrides: Partial<JellyfinAdapter> = {}): JellyfinAdapter {
  const adapter = new JellyfinAdapter(server, {
    deviceName: 'test',
    deviceId: 'test',
    version: '0',
    fetch: () => Promise.resolve(new Response('{}', { status: 200 })),
  });
  Object.assign(adapter, {
    reportPlayback: jest.fn(() => Promise.resolve()),
    ...overrides,
  });
  sessionStore.set({ status: 'signedIn', session, adapter, vault: 'keychain', reason: null });
  return adapter;
}

export function signOutForTests(): void {
  sessionStore.set({
    status: 'signedOut',
    session: null,
    adapter: null,
    vault: null,
    reason: null,
  });
}

/** Put a library snapshot in place, as if the cache had loaded. */
export function setLibrary(
  tracks: Track[],
  albums: Album[] = [album],
  artists: Artist[] = [artist],
): void {
  const snapshot = buildSnapshot(tracks, albums, artists, [], {
    syncedAt: new Date().toISOString(),
    albumArtistIds: ['ar1'],
  });
  libraryStore.set({
    snapshot,
    index: new LibraryIndex(snapshot),
    sync: { status: 'idle', progress: null, mode: 'full', error: null },
    ready: true,
    persisted: true,
  });
}
