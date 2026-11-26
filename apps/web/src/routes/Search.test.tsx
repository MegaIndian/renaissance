import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { libraryStore } from '../lib/library';
import { recentSearchesStore } from '../lib/recent';
import { signInFake } from '../test/fakes';
import { renderApp } from '../test/render';

describe('Search', () => {
  it('renders every matching kind for ?q=, in its own group, and plays from the song rows', async () => {
    setLanguage('en');
    const { player } = signInFake();
    renderApp('/search?q=kevin');
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Results for "kevin"' }),
    ).toBeInTheDocument();
    // The Ask bar in the shell lists its own hits for the term; the page's groups are in main.
    const main = within(screen.getByRole('main'));
    expect(
      within(main.getByRole('region', { name: 'Artists' })).getByRole('link', {
        name: /Kevin MacLeod/,
      }),
    ).toBeInTheDocument();
    expect(
      within(main.getByRole('region', { name: 'Albums' })).getByRole('link', {
        name: /Royalty Free/,
      }),
    ).toBeInTheDocument();
    const songs = main.getByRole('region', { name: 'Songs' });
    expect(within(songs).getAllByRole('listitem')).toHaveLength(4);
    await user.click(within(songs).getByRole('button', { name: 'Play Carefree' }));
    expect(player.snapshot.queue.items[player.snapshot.queue.index]?.id).toBe('t2');
  });

  it("signed out, with a term, it shows the Library's sentence and Sign in, not a bare heading (design AG)", async () => {
    setLanguage('en');
    renderApp('/search?q=kevin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    expect(main.getByText('Your library appears here after you sign in')).toBeInTheDocument();
    expect(main.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByText(/Results for/)).not.toBeInTheDocument();
  });

  it('finds playlists by name, and says when nothing matches', async () => {
    setLanguage('en');
    signInFake();
    const view = renderApp('/search?q=drive');
    const playlists = await screen.findByRole('region', { name: 'Playlists' });
    expect(within(playlists).getByRole('link', { name: /Drive/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Songs' })).not.toBeInTheDocument();
    view.unmount();
    renderApp('/search?q=zzzz');
    expect(await screen.findByText('Nothing in your library matches "zzzz"')).toBeInTheDocument();
  });

  it('with no term it invites a search and offers the recent ones; before the cache is in, no "nothing matches"', async () => {
    setLanguage('en');
    signInFake();
    recentSearchesStore.set(['duck', 'snitch']);
    const view = renderApp('/search');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
    expect(
      screen.getByText('Type above to search songs, albums, artists and playlists'),
    ).toBeInTheDocument();
    const recent = screen.getByRole('region', { name: 'Recent searches' });
    expect(within(recent).getByRole('link', { name: 'duck' })).toHaveAttribute(
      'href',
      '/search?q=duck',
    );
    view.unmount();
    libraryStore.set({ ...libraryStore.get(), ready: false });
    renderApp('/search?q=zzzz');
    await screen.findByRole('heading', { level: 1, name: 'Results for "zzzz"' });
    expect(screen.queryByText(/Nothing in your library matches/)).not.toBeInTheDocument();
  });
});
