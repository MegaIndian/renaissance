/**
 * A signed-in state for component tests: a session in the store, a fake adapter that records calls,
 * a library snapshot in memory, and the real Player on a fake audio port.
 */
import { LibraryIndex, Player, buildSnapshot, emptyQueue, ServerError } from '@renaissance/core';
import type {
  Album,
  Artist,
  AudioEvent,
  AudioPort,
  JellyfinAdapter,
  ListenEvent,
  PlaybackReport,
  Playlist,
  Session,
  Track,
} from '@renaissance/core';
import { vi } from 'vitest';

import { libraryStore } from '../lib/library';
import { sessionStore } from '../lib/session';
import * as playerModule from '../lib/player';

export const session: Session = {
  server: { id: 'demo', kind: 'jellyfin', name: 'demo', url: 'http://demo.local' },
  userId: 'u1',
  userName: 'Sahil',
  token: 'tok',
};

export function track(id: string, extra: Partial<Track> = {}): Track {
  return {
    id,
    title: `Track ${id}`,
    artistIds: ['a1'],
    artistName: 'Kevin MacLeod',
    duration: 120,
    isFavorite: false,
    playCount: 0,
    genres: [],
    codec: 'mp3',
    bitrate: 320_000,
    ...extra,
  };
}

export const tracks: Track[] = [
  track('t1', {
    title: 'Sneaky Snitch',
    albumId: 'al1',
    albumTitle: 'Royalty Free',
    trackNumber: 1,
    year: 2010,
    genres: ['Contemporary'],
  }),
  track('t2', {
    title: 'Carefree',
    albumId: 'al1',
    albumTitle: 'Royalty Free',
    trackNumber: 2,
    year: 2014,
    playCount: 3,
    lastPlayed: '2026-11-17T20:00:00.000Z',
  }),
  track('t3', { title: 'Fluffing a Duck', isFavorite: true, year: 2010 }),
  track('t4', { title: 'Monkeys Spinning Monkeys', genres: ['Orchestra'] }),
];
export const albums: Album[] = [
  {
    id: 'al1',
    title: 'Royalty Free',
    artistIds: ['a1'],
    artistName: 'Kevin MacLeod',
    year: 2010,
    genres: ['Contemporary'],
    trackCount: 2,
    isFavorite: false,
    playCount: 0,
  },
];
export const artists: Artist[] = [
  {
    id: 'a1',
    name: 'Kevin MacLeod',
    isFavorite: false,
    playCount: 0,
    bio: 'Composer from Wisconsin.',
  },
];
export const playlists: Playlist[] = [
  { id: 'p1', name: 'Drive', trackCount: 1, isFavorite: false, playCount: 0 },
];

export class FakeAudio implements AudioPort {
  log: string[] = [];
  listeners = new Set<(e: AudioEvent) => void>();
  load(url: string, position = 0) {
    this.log.push(`load ${new URL(url).pathname}@${position}`);
  }
  play() {
    this.log.push('play');
    this.emit({ type: 'playing' });
    return Promise.resolve();
  }
  pause() {
    this.log.push('pause');
    this.emit({ type: 'paused' });
  }
  seek(s: number) {
    this.log.push(`seek ${s}`);
  }
  setVolume() {}
  preload(url: string | null) {
    this.log.push(`preload ${url ? new URL(url).pathname : 'none'}`);
  }
  takeOver() {
    return false;
  }
  position() {
    return 0;
  }
  duration() {
    return 120;
  }
  on(l: (e: AudioEvent) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  destroy() {}
  emit(e: AudioEvent) {
    for (const l of this.listeners) l(e);
  }
}

export interface FakeAdapterCalls {
  favorites: { id: string; favorite: boolean }[];
  reports: PlaybackReport[];
  playlists: string[];
}

export interface FakeAdapterOptions {
  fail?: { favorites?: boolean };
  /** Awaited before a favourite call answers, so a test can hold the server's answer back. */
  favoritesGate?: () => Promise<void>;
}

export function fakeAdapter(options: FakeAdapterOptions = {}) {
  const fail = options.fail ?? {};
  const calls: FakeAdapterCalls = { favorites: [], reports: [], playlists: [] };
  const page = <T>(items: T[]): Promise<{ items: T[]; total: number }> =>
    Promise.resolve({ items, total: items.length });
  const adapter = {
    server: session.server,
    imageUrl: (_s: Session, id: string, width: number) =>
      `http://demo.local/Items/${id}/Images/Primary?fillWidth=${width}`,
    streamUrl: (_s: Session, t: Track) => `http://demo.local/Audio/${t.id}/universal`,
    reportPlayback: (_s: Session, report: PlaybackReport) => {
      calls.reports.push(report);
      return Promise.resolve();
    },
    favorites: {
      set: async (_s: Session, id: string, favorite: boolean) => {
        await options.favoritesGate?.();
        if (fail.favorites) throw new Error('down');
        calls.favorites.push({ id, favorite });
      },
    },
    playlists: {
      create: (_s: Session, name: string, ids: string[]) => {
        calls.playlists.push(`create ${name} ${ids.join(',')}`);
        return Promise.resolve({
          id: `p-${name}`,
          name,
          trackCount: ids.length,
          isFavorite: false,
          playCount: 0,
        } as Playlist);
      },
      rename: (_s: Session, id: string, name: string) => {
        calls.playlists.push(`rename ${id} ${name}`);
        return Promise.resolve();
      },
      addTracks: (_s: Session, id: string, ids: string[]) => {
        calls.playlists.push(`add ${id} ${ids.join(',')}`);
        return Promise.resolve();
      },
      removeEntries: (_s: Session, id: string, ids: string[]) => {
        calls.playlists.push(`remove ${id} ${ids.join(',')}`);
        return Promise.resolve();
      },
      move: (_s: Session, id: string, entry: string, to: number) => {
        calls.playlists.push(`move ${id} ${entry} ${to}`);
        return Promise.resolve();
      },
      remove: (_s: Session, id: string) => {
        calls.playlists.push(`delete ${id}`);
        return Promise.resolve();
      },
    },
    library: () => ({
      // The paged reads one full sync needs, over the fixtures.
      artists: () => page(artists),
      albumArtists: () => page(artists),
      playlists: () => page(playlists),
      tracks: () => page(tracks),
      albums: () => page(albums),
      userDataChangedSince: () => page([]),
      ids: () => Promise.resolve([]),
      byIds: () => Promise.resolve([]),
      musicByIds: () => Promise.resolve({ tracks: [], albums: [] }),
      albumTracks: () => Promise.resolve(tracks.filter((t) => t.albumId === 'al1')),
      album: (id: string) =>
        id === 'al1'
          ? Promise.resolve(albums[0])
          : Promise.reject(new ServerError(404, `/Items/${id}`)),
      artist: () => Promise.resolve(artists[0]),
      similarArtists: () => Promise.resolve([]),
      playlistTracks: () => Promise.resolve([{ ...tracks[2], entryId: 'e3' }]),
      recentlyPlayed: () => Promise.resolve([tracks[1]]),
    }),
    subscribe: () => () => undefined,
    signOut: () => Promise.resolve(),
  } as unknown as JellyfinAdapter;
  return { adapter, calls };
}

/** Sign a fake user in with the fixture library and a fresh Player on a FakeAudio. */
export function signInFake(options: FakeAdapterOptions = {}) {
  const { adapter, calls } = fakeAdapter(options);
  sessionStore.set({ status: 'signedIn', session, adapter, vault: 'encrypted', reason: null });
  const snapshot = buildSnapshot(tracks, albums, artists, playlists, {
    syncedAt: '2026-11-17T21:00:00.000Z',
    albumArtistIds: ['a1'],
  });
  libraryStore.set({
    snapshot,
    index: new LibraryIndex(snapshot),
    sync: { status: 'idle', progress: null, mode: 'delta', error: null },
    ready: true,
    persisted: true,
  });
  const audio = new FakeAudio();
  const player = new Player({
    audio,
    adapter,
    session: () => sessionStore.get().session,
    reporter: null,
  });
  vi.spyOn(playerModule, 'getPlayer').mockReturnValue(player);
  return { adapter, calls, player, audio, snapshot, emptyQueue };
}

let n = 0;
/** One play in the listening log, a full song of t1 by default. */
export function listen(extra: Partial<ListenEvent> = {}): ListenEvent {
  n += 1;
  return {
    id: `l${String(n).padStart(4, '0')}`,
    serverId: session.server.id,
    userId: session.userId,
    trackId: 't1',
    artistIds: ['a1'],
    title: 'Sneaky Snitch',
    artistName: 'Kevin MacLeod',
    trackDuration: 120,
    at: '2026-11-20T10:00:00.000Z',
    endedAt: '2026-11-20T10:02:00.000Z',
    listened: 120,
    position: 120,
    completed: true,
    skipped: false,
    endReason: 'ended',
    source: { kind: 'library' },
    device: 'Chrome on Mac',
    ...extra,
  };
}
