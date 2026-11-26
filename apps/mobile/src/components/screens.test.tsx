import { ServerError } from '@renaissance/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import Home from '@/app/(tabs)/index';
import Library from '@/app/(tabs)/library';
import QueueScreen from '@/app/queue';
import SignIn from '@/app/sign-in';
import { AskBar } from '@/components/AskBar';
import { NowPlayingBar } from '@/components/NowPlayingBar';
import { TrackRow } from '@/components/TrackRow';
import { getPlayer, resetPlayerForTests } from '@/lib/player';
import { sessions } from '@/lib/session';
import { toastStore } from '@/lib/toast';
import { album, server, setLibrary, signIn, signOutForTests, track } from '@/test/fixtures';
import { renderWithApp } from '@/test/render';
import { router } from '@/test/router';

jest.mock('expo-router', () =>
  jest.requireActual<{ expoRouterMock: () => unknown }>('@/test/router').expoRouterMock(),
);

const tracks = [
  track('1', { title: 'Carefree', trackNumber: 1 }),
  track('2', { title: 'Sneaky Snitch', trackNumber: 2 }),
];

beforeEach(() => {
  jest.clearAllMocks();
  resetPlayerForTests();
  toastStore.set(null);
});

describe('TrackRow', () => {
  it('plays on a tap, toggles the heart and opens the menu, each with its label', async () => {
    const onPlay = jest.fn();
    const onHeart = jest.fn();
    const onMenu = jest.fn();
    await renderWithApp(
      <TrackRow
        track={tracks[0]!}
        index={0}
        onPlay={onPlay}
        onToggleFavorite={onHeart}
        onMenu={onMenu}
      />,
    );
    await fireEvent.press(screen.getByLabelText('Play Carefree'));
    await fireEvent.press(screen.getByLabelText('Add to favourites'));
    await fireEvent.press(screen.getByLabelText('More options for Carefree'));
    expect(onPlay).toHaveBeenCalled();
    expect(onHeart).toHaveBeenCalled();
    expect(onMenu).toHaveBeenCalled();
    expect(screen.getByText('Kevin · Royalty Free')).toBeTruthy();
  });
});

describe('Home', () => {
  it('signed out: one primary that leads to sign in, and the three rows say what will appear', async () => {
    signOutForTests();
    await renderWithApp(<Home />);
    expect(screen.getByText('Sign in to a server to see your music here')).toBeTruthy();
    expect(screen.getByText('My songs')).toBeTruthy();
    expect(screen.getByText('Recently played')).toBeTruthy();
    expect(screen.getByText('Made for you')).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'Sign in' }));
    expect(router.push).toHaveBeenCalledWith('/sign-in');
  });

  it('signed in: greets by name and fills My songs from the favourites in the cache', async () => {
    signIn({ library: () => ({ recentlyPlayed: () => Promise.resolve([]) }) } as never);
    setLibrary([tracks[0]!, { ...tracks[1]!, isFavorite: true }]);
    await renderWithApp(<Home />);
    expect(screen.getByText(/, Asha$/)).toBeTruthy();
    expect(screen.getByLabelText('Sneaky Snitch, Kevin')).toBeTruthy();
    expect(
      screen.getByText('Mixes built from what you play appear here, each named in words'),
    ).toBeTruthy();
  });
});

describe('Sign in', () => {
  const fill = async () => {
    await fireEvent.changeText(screen.getByTestId('sign-in-address'), 'https://demo.test');
    await fireEvent.changeText(screen.getByTestId('sign-in-user'), 'asha');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'pw');
  };

  beforeEach(() => signOutForTests());

  it('signs in with the typed server, user and password and goes back', async () => {
    const spy = jest
      .spyOn(sessions, 'signIn')
      .mockResolvedValue({ server, userId: 'u', userName: 'asha', token: 't' });
    await renderWithApp(<SignIn />);
    await fill();
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://demo.test' }), {
      userName: 'asha',
      password: 'pw',
    });
  });

  it('says a wrong password in a sentence', async () => {
    jest
      .spyOn(sessions, 'signIn')
      .mockRejectedValue(new ServerError(401, '/Users/AuthenticateByName'));
    await renderWithApp(<SignIn />);
    await fill();
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(await screen.findByText('The user name or password is wrong.')).toBeTruthy();
  });

  it('refuses something that is not an address, and warns about plain http before sending', async () => {
    await renderWithApp(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('sign-in-address'), 'not an address');
    await fireEvent.changeText(screen.getByTestId('sign-in-user'), 'asha');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(screen.getByText(/That is not a web address/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('sign-in-address'), 'http://192.168.1.20:8096');
    expect(screen.getByText(/This address uses http, not https/)).toBeTruthy();
  });

  it('Quick Connect shows the code to type in Jellyfin', async () => {
    const adapter = {
      ping: jest.fn(() => Promise.resolve({ version: '10.10' })),
      quickConnect: {
        enabled: jest.fn(() => Promise.resolve(true)),
        initiate: jest.fn(() => Promise.resolve({ code: '123456', secret: 's' })),
        state: jest.fn(() => new Promise<boolean>(() => undefined)),
      },
    };
    jest.spyOn(sessions, 'probe').mockReturnValue(adapter as never);
    await renderWithApp(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('sign-in-address'), 'https://demo.test');
    await fireEvent.press(screen.getByTestId('sign-in-quick-connect'));
    expect(await screen.findByText('123456')).toBeTruthy();
    expect(screen.getByText('Waiting for you to approve the code…')).toBeTruthy();
  });
});

describe('Ask bar', () => {
  it('shows library hits as you type; a song plays and an album opens', async () => {
    signIn();
    setLibrary(tracks);
    await renderWithApp(<AskBar />);
    const input = screen.getByTestId('ask-input');
    await fireEvent(input, 'focus');
    await fireEvent.changeText(input, 'royalty');
    await fireEvent.press(await screen.findByTestId('ask-hit-album-al1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/album/[id]', params: { id: 'al1' } });
    await fireEvent(input, 'focus');
    await fireEvent.changeText(input, 'sneaky');
    await fireEvent.press(await screen.findByTestId('ask-hit-track-2'));
    expect(getPlayer().snapshot.queue.items.map((t) => t.id)).toEqual(['2']);
  });

  it('signed out, it says to sign in first', async () => {
    signOutForTests();
    await renderWithApp(<AskBar />);
    expect(screen.getByText('Sign in to search your library')).toBeTruthy();
  });
});

describe('Library', () => {
  it('lists artists, then albums from the cache, and opens an album', async () => {
    signIn();
    setLibrary(tracks, [album]);
    await renderWithApp(<Library />);
    expect(screen.getByLabelText('Kevin')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Albums' }));
    await fireEvent.press(screen.getByTestId('album-al1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/album/[id]', params: { id: 'al1' } });
  });

  it('shows genres with their song counts', async () => {
    signIn();
    setLibrary(tracks);
    await renderWithApp(<Library />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Genres' }));
    expect(screen.getByText('Jazz')).toBeTruthy();
    expect(screen.getByText('2 songs')).toBeTruthy();
  });
});

describe('Player bar and queue', () => {
  it('the bar says nothing is playing, then shows the song and pauses it', async () => {
    signIn();
    await renderWithApp(<NowPlayingBar />);
    expect(screen.getByText('Nothing playing')).toBeTruthy();
    await act(async () => getPlayer().playTracks(tracks, 0));
    expect(screen.getByText('Carefree')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bar-toggle'));
    expect(getPlayer().snapshot.status).toBe('paused');
    await fireEvent.press(screen.getByTestId('now-playing-bar'));
    expect(router.push).toHaveBeenCalledWith('/now-playing');
  });

  it('the queue moves and removes with an undo that keeps the song playing', async () => {
    signIn();
    const three = [...tracks, track('3', { title: 'Monkeys' })];
    await act(async () => getPlayer().playTracks(three, 0));
    await renderWithApp(<QueueScreen />);
    expect(screen.getByText('Up next · 2 songs')).toBeTruthy();
    await fireEvent.press(screen.getAllByLabelText('Move down')[0]!);
    expect(getPlayer().snapshot.queue.items.map((t) => t.id)).toEqual(['1', '3', '2']);
    expect(toastStore.get()?.message).toBe('Moved Sneaky Snitch to position 2');
    await fireEvent.press(screen.getAllByLabelText('Remove from queue')[0]!);
    expect(getPlayer().snapshot.queue.items.map((t) => t.id)).toEqual(['1', '2']);
    await act(async () => toastStore.get()?.undo?.());
    expect(getPlayer().snapshot.queue.items.map((t) => t.id)).toEqual(['1', '3', '2']);
    expect(getPlayer().snapshot.queue.index).toBe(0);
  });
});
