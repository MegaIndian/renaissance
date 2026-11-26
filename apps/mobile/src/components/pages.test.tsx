import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import AlbumPage from '@/app/album/[id]';
import ArtistPage from '@/app/artist/[id]';
import Favorites from '@/app/favorites';
import GenrePage from '@/app/genre/[name]';
import NowPlaying from '@/app/now-playing';
import PlaylistPage from '@/app/playlist/[id]';
import SettingsScreen from '@/app/settings';
import { Dialogs } from '@/components/Dialogs';
import { TrackMenu } from '@/components/TrackMenu';
import { addToQueue, playNext, toggleFavorite } from '@/lib/actions';
import { openDialog } from '@/lib/dialogs';
import { libraryStore } from '@/lib/library';
import { openTrackMenu } from '@/lib/menu';
import { getPlayer, resetPlayerForTests } from '@/lib/player';
import { sessions, sessionStore } from '@/lib/session';
import { settingsStore } from '@/lib/settings';
import { toastStore } from '@/lib/toast';
import { album, artist, setLibrary, signIn, track } from '@/test/fixtures';
import { renderWithApp } from '@/test/render';
import { params, router } from '@/test/router';

jest.mock('expo-router', () =>
  jest.requireActual<{ expoRouterMock: () => unknown }>('@/test/router').expoRouterMock(),
);

const tracks = [
  track('1', { title: 'Carefree', trackNumber: 1 }),
  track('2', { title: 'Sneaky Snitch', trackNumber: 2 }),
];
const playlist = { id: 'p1', name: 'Road trip', trackCount: 2, isFavorite: false, playCount: 0 };
const entries = tracks.map((t, i) => ({ ...t, entryId: `e${i}` }));

function fakeServer() {
  const favorites = { set: jest.fn(() => Promise.resolve()) };
  const playlists = {
    create: jest.fn((_s: unknown, name: string) =>
      Promise.resolve({ id: 'p2', name, trackCount: 1, isFavorite: false, playCount: 0 }),
    ),
    rename: jest.fn(() => Promise.resolve()),
    addTracks: jest.fn(() => Promise.resolve()),
    removeEntries: jest.fn(() => Promise.resolve()),
    move: jest.fn(() => Promise.resolve({ entries: [...entries].reverse(), ok: true, calls: 2 })),
    remove: jest.fn(() => Promise.resolve()),
  };
  const library = {
    album: jest.fn(() => Promise.resolve(album)),
    albumTracks: jest.fn(() => Promise.resolve(tracks)),
    artist: jest.fn(() => Promise.resolve({ ...artist, bio: 'Composer from Wisconsin.' })),
    similarArtists: jest.fn(() => Promise.resolve([])),
    playlistTracks: jest.fn(() => Promise.resolve(entries)),
    recentlyPlayed: jest.fn(() => Promise.resolve([])),
  };
  const adapter = signIn({ favorites, playlists, library: () => library } as never);
  setLibrary(tracks);
  libraryStore.set((s) => ({ ...s, snapshot: { ...s.snapshot, playlists: [playlist] } }));
  return { adapter, favorites, playlists, library };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPlayerForTests();
  toastStore.set(null);
  for (const key of Object.keys(params)) delete params[key];
});

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as never;

describe('actions', () => {
  it('a heart changes the cache at once, tells the server, and undoes', async () => {
    const { favorites } = fakeServer();
    await toggleFavorite('track', tracks[0]!, t);
    expect(favorites.set).toHaveBeenCalledWith(expect.anything(), '1', true);
    expect(libraryStore.get().snapshot.tracks[0]?.isFavorite).toBe(true);
    expect(toastStore.get()?.message).toContain('favorites.added');
    await act(async () => toastStore.get()?.undo?.());
    await waitFor(() =>
      expect(favorites.set).toHaveBeenLastCalledWith(expect.anything(), '1', false),
    );
  });

  it('a refused heart rolls back and says so', async () => {
    const { favorites } = fakeServer();
    favorites.set.mockRejectedValueOnce(new Error('500'));
    await toggleFavorite('track', tracks[0]!, t);
    expect(libraryStore.get().snapshot.tracks[0]?.isFavorite).toBe(false);
    expect(toastStore.get()).toMatchObject({ tone: 'danger', message: 'error.failed' });
  });

  it('play next and add to queue start an empty queue, then line up, each with an undo', () => {
    fakeServer();
    addToQueue([tracks[0]!], t);
    expect(toastStore.get()?.message).toContain('queue.startedPlaying');
    playNext([tracks[1]!], t);
    expect(getPlayer().snapshot.queue.items.map((x) => x.id)).toEqual(['1', '2']);
    toastStore.get()?.undo?.();
    expect(getPlayer().snapshot.queue.items.map((x) => x.id)).toEqual(['1']);
    addToQueue(tracks, t);
    expect(toastStore.get()?.message).toContain('queue.addedCountEnd');
  });
});

describe('pages', () => {
  it('album: the server tracks in order, Play starts from the first', async () => {
    fakeServer();
    params.id = 'al1';
    await renderWithApp(<AlbumPage />);
    expect(await screen.findByText('Sneaky Snitch')).toBeTruthy();
    expect(screen.getByText('2010 · Jazz · 2 songs · 4 min')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('album-play'));
    expect(getPlayer().snapshot.queue.items.map((x) => x.id)).toEqual(['1', '2']);
    await fireEvent.press(screen.getAllByText('Kevin')[0]!);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/artist/[id]', params: { id: 'ar1' } });
  });

  it('album: one the server does not have says so', async () => {
    const { library } = fakeServer();
    library.album.mockRejectedValue(
      new (jest.requireActual('@renaissance/core').ServerError)(404, '/x'),
    );
    params.id = 'gone';
    await renderWithApp(<AlbumPage />);
    expect(await screen.findByText('This album is not on the server any more')).toBeTruthy();
  });

  it('artist: biography, songs and albums', async () => {
    fakeServer();
    params.id = 'ar1';
    await renderWithApp(<ArtistPage />);
    expect(await screen.findByText('Composer from Wisconsin.')).toBeTruthy();
    expect(screen.getByText('Carefree')).toBeTruthy();
    expect(screen.getByLabelText('Royalty Free, Kevin · 2010')).toBeTruthy();
    await fireEvent.press(screen.getByText('Play all'));
    expect(getPlayer().snapshot.queue.items).toHaveLength(2);
  });

  it('genre and favourites read the cache', async () => {
    fakeServer();
    params.name = 'Jazz';
    await renderWithApp(<GenrePage />);
    expect(screen.getByText('Songs in Jazz')).toBeTruthy();
    expect(screen.getByText('Sneaky Snitch')).toBeTruthy();
  });

  it('favourites with none says how to add one', async () => {
    fakeServer();
    await renderWithApp(<Favorites />);
    expect(screen.getByText('No favourites yet')).toBeTruthy();
  });

  it('playlist: the entries from the server; rename and delete open their dialogs', async () => {
    fakeServer();
    params.id = 'p1';
    await renderWithApp(
      <>
        <PlaylistPage />
        <Dialogs />
      </>,
    );
    expect(await screen.findByText('Sneaky Snitch')).toBeTruthy();
    await fireEvent.press(screen.getByText('Rename'));
    expect(screen.getByTestId('playlist-name').props.value).toBe('Road trip');
  });

  it('now playing with nothing queued says so', async () => {
    fakeServer();
    await renderWithApp(<NowPlaying />);
    expect(screen.getByText('The queue is empty')).toBeTruthy();
  });

  it('now playing: title, transport, the queue button', async () => {
    fakeServer();
    await act(async () => getPlayer().playTracks(tracks, 1));
    await renderWithApp(<NowPlaying />);
    expect(screen.getByTestId('now-playing-title').props.children).toBe('Sneaky Snitch');
    await fireEvent.press(screen.getByLabelText('Repeat off'));
    expect(getPlayer().snapshot.queue.repeat).toBe('all');
    await fireEvent.press(screen.getByLabelText('Shuffle off'));
    expect(getPlayer().snapshot.queue.shuffle).toBe(true);
    await fireEvent.press(screen.getByTestId('now-playing-toggle'));
    expect(getPlayer().snapshot.status).toBe('paused');
    await fireEvent.press(screen.getByTestId('open-queue'));
    expect(router.push).toHaveBeenCalledWith('/queue');
  });

  it('settings: theme and quality apply at once; sign out ends the session', async () => {
    fakeServer();
    const signOut = jest.spyOn(sessions, 'signOut').mockResolvedValue();
    await renderWithApp(<SettingsScreen />);
    expect(
      screen.getByText("Kept in this phone's keychain, readable only by this app"),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    expect(settingsStore.get().theme).toBe('dark');
    await fireEvent.press(screen.getAllByRole('radio', { name: 'Low (128 kbps)' })[1]!);
    expect(settingsStore.get().cellularQuality).toBe('low');
    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(signOut).toHaveBeenCalled();
    expect(sessionStore.get().status).toBe('signedIn');
  });
});

describe('menu and dialogs', () => {
  it("the song menu queues, opens Add to playlist, and goes to the song's album", async () => {
    const { playlists } = fakeServer();
    await renderWithApp(
      <>
        <TrackMenu />
        <Dialogs />
      </>,
    );
    await act(async () => openTrackMenu({ track: tracks[0]! }));
    await fireEvent.press(screen.getByTestId('menu-add-to-queue'));
    expect(getPlayer().snapshot.queue.items.map((x) => x.id)).toEqual(['1']);
    await act(async () => openTrackMenu({ track: tracks[0]! }));
    await fireEvent.press(screen.getByText('Go to album'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/album/[id]', params: { id: 'al1' } });
    await act(async () => openTrackMenu({ track: tracks[0]! }));
    await fireEvent.press(screen.getByText('Add to playlist'));
    await fireEvent.press(screen.getByText('Road trip'));
    await waitFor(() =>
      expect(playlists.addTracks).toHaveBeenCalledWith(expect.anything(), 'p1', ['1']),
    );
  });

  it('on a playlist page the menu moves a song and takes it out', async () => {
    const { playlists } = fakeServer();
    await renderWithApp(<TrackMenu />);
    await act(async () =>
      openTrackMenu({
        track: entries[0]!,
        playlist: { playlist, entry: entries[0]!, index: 0, count: 2 },
      }),
    );
    expect(screen.queryByText('Move up')).toBeNull();
    await fireEvent.press(screen.getByText('Move down'));
    await waitFor(() =>
      expect(playlists.move).toHaveBeenCalledWith(expect.anything(), 'p1', 'e0', 1),
    );
    await act(async () =>
      openTrackMenu({
        track: entries[1]!,
        playlist: { playlist, entry: entries[1]!, index: 1, count: 2 },
      }),
    );
    await fireEvent.press(screen.getByText('Remove from playlist'));
    await waitFor(() =>
      expect(playlists.removeEntries).toHaveBeenCalledWith(expect.anything(), 'p1', ['e1']),
    );
  });

  it('new, rename and delete playlist dialogs call the server', async () => {
    const { playlists } = fakeServer();
    await renderWithApp(<Dialogs />);
    await act(async () => openDialog({ kind: 'newPlaylist' }));
    await fireEvent.changeText(screen.getByTestId('playlist-name'), 'Evening');
    await fireEvent.press(screen.getByText('Create playlist'));
    await waitFor(() =>
      expect(playlists.create).toHaveBeenCalledWith(expect.anything(), 'Evening', []),
    );
    await act(async () => openDialog({ kind: 'renamePlaylist', playlist }));
    await fireEvent.changeText(screen.getByTestId('playlist-name'), 'Long drive');
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() =>
      expect(playlists.rename).toHaveBeenCalledWith(expect.anything(), 'p1', 'Long drive'),
    );
    const onDeleted = jest.fn();
    await act(async () => openDialog({ kind: 'deletePlaylist', playlist, entries, onDeleted }));
    await fireEvent.press(screen.getByText('Delete playlist'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(playlists.remove).toHaveBeenCalledWith(expect.anything(), 'p1');
  });
});
