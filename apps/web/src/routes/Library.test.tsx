import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { updateSettings } from '../lib/settings';
import { LibraryIndex, buildSnapshot } from '@renaissance/core';

import { libraryStore } from '../lib/library';
import { signInFake } from '../test/fakes';
import { renderApp } from '../test/render';

describe('Library', () => {
  afterEach(() => updateSettings({ mode: 'simple' }));

  it('simple mode: four sections, songs play from the row, favourites toggle from the heart', async () => {
    setLanguage('en');
    const { player, calls } = signInFake();
    renderApp('/library?section=tracks');
    const user = userEvent.setup();
    const sections = await screen.findByRole('radiogroup', { name: 'Library section' });
    expect(
      within(sections)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Artists', 'Albums', 'Songs', 'Playlists']);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.getByText('4 songs')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Play Carefree' }));
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['t2', 't3', 't4', 't1']);
    expect(player.snapshot.queue.index).toBe(0);
    await user.click(
      within(screen.getByRole('list')).getAllByRole('button', { name: 'Add to favourites' })[0]!,
    );
    expect(calls.favorites).toEqual([{ id: 't2', favorite: true }]);
    expect(screen.getByRole('status')).toHaveTextContent('Added Carefree to favourites');
  });

  it('advanced mode: seven sections, sort and filter from the toolbar, URL carries the state', async () => {
    setLanguage('en');
    updateSettings({ mode: 'advanced' });
    signInFake();
    renderApp('/library?section=tracks&sort=playCount');
    const user = userEvent.setup();
    const sections = await screen.findByRole('radiogroup', { name: 'Library section' });
    expect(within(sections).getAllByRole('radio')).toHaveLength(7);
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Carefree');
    await user.click(screen.getByRole('button', { name: 'Favourites only' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('1 song')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('4 songs')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sort by' }));
    await user.click(screen.getByRole('menuitem', { name: 'Name' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')[0]).toHaveTextContent(
      'Carefree',
    );
    await user.click(screen.getByRole('button', { name: 'Sort by' }));
    await user.click(screen.getByRole('menuitem', { name: 'Descending' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')[0]).toHaveTextContent(
      'Sneaky Snitch',
    );
    await user.click(screen.getByRole('button', { name: 'Genre' }));
    await user.click(screen.getByRole('menuitem', { name: 'Orchestra' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
    await user.click(within(sections).getByRole('radio', { name: 'Genres' }));
    expect(screen.getByRole('grid')).toBeInTheDocument();
    await user.click(within(sections).getByRole('radio', { name: 'Years' }));
    expect(screen.getByRole('link', { name: /2014/ })).toBeInTheDocument();
    await user.click(within(sections).getByRole('radio', { name: 'Albums' }));
    expect(screen.getByRole('link', { name: /Royalty Free/ })).toBeInTheDocument();
  });

  it('the song count waits for the cache: no "0 songs" while the library loads from disk', async () => {
    setLanguage('en');
    signInFake();
    const empty = buildSnapshot([], [], [], [], null);
    libraryStore.set({
      snapshot: empty,
      index: new LibraryIndex(empty),
      sync: { status: 'loading', progress: null, mode: null, error: null },
      ready: false,
      persisted: true,
    });
    renderApp('/library?section=tracks');
    await screen.findByRole('radiogroup', { name: 'Library section' });
    expect(screen.queryByText(/\d+ songs?$/)).not.toBeInTheDocument();
    // The cache was read and it was empty: the first sync is running. Still no "0 songs" (prod AE).
    libraryStore.set({
      ...libraryStore.get(),
      ready: true,
      sync: {
        status: 'syncing',
        progress: { kind: 'artist', done: 1, total: 1 },
        mode: null,
        error: null,
      },
    });
    expect(await screen.findByText(/Loading your library for the first time/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+ songs?$/)).not.toBeInTheDocument();
    libraryStore.set({
      ...libraryStore.get(),
      ready: true,
      sync: { status: 'idle', progress: null, mode: null, error: null },
    });
    expect(await screen.findByText('0 songs')).toBeInTheDocument();
  });

  it('the albums and artists counts and the playlists empty state wait for the cache too (func AC)', async () => {
    setLanguage('en');
    signInFake();
    const empty = buildSnapshot([], [], [], [], null);
    libraryStore.set({
      snapshot: empty,
      index: new LibraryIndex(empty),
      sync: { status: 'loading', progress: null, mode: null, error: null },
      ready: false,
      persisted: true,
    });
    renderApp('/library?section=albums');
    const user = userEvent.setup();
    const sections = await screen.findByRole('radiogroup', { name: 'Library section' });
    expect(screen.queryByText(/\d+ albums?$/)).not.toBeInTheDocument();
    await user.click(within(sections).getByRole('radio', { name: 'Artists' }));
    expect(screen.queryByText(/\d+ artists?$/)).not.toBeInTheDocument();
    await user.click(within(sections).getByRole('radio', { name: 'Playlists' }));
    expect(screen.queryByText('No playlists yet')).not.toBeInTheDocument();
    expect(screen.getByText(/Loading your library for the first time/)).toBeInTheDocument();
    libraryStore.set({
      ...libraryStore.get(),
      ready: true,
      sync: { status: 'idle', progress: null, mode: null, error: null },
    });
    expect(await screen.findByText('No playlists yet')).toBeInTheDocument();
    await user.click(within(sections).getByRole('radio', { name: 'Albums' }));
    expect(await screen.findByText('0 albums')).toBeInTheDocument();
  });

  it('a first sync that fails says so, instead of claiming a last time and an empty library (func AD)', async () => {
    setLanguage('en');
    updateSettings({ mode: 'advanced' });
    signInFake();
    const empty = buildSnapshot([], [], [], [], null);
    libraryStore.set({
      snapshot: empty,
      index: new LibraryIndex(empty),
      sync: { status: 'error', progress: null, mode: null, error: 'offline' },
      ready: true,
      persisted: true,
    });
    renderApp('/library?section=tracks');
    await screen.findByRole('radiogroup', { name: 'Library section' });
    expect(
      screen.getAllByText(
        'Your library could not be loaded from the server. It will be tried again.',
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/could not be refreshed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ songs?$/)).not.toBeInTheDocument();
  });

  it('the year filter carries the filter glyph like the genre filter beside it (design AF)', async () => {
    setLanguage('en');
    updateSettings({ mode: 'advanced' });
    signInFake();
    renderApp('/library?section=tracks');
    const year = await screen.findByRole('button', { name: 'Year' });
    const genre = screen.getByRole('button', { name: 'Genre' });
    expect(genre.querySelector('svg')).not.toBeNull();
    expect(year.querySelector('svg')).not.toBeNull();
  });

  it('signed out: one sentence and the Sign in primary', async () => {
    setLanguage('en');
    renderApp('/library');
    expect(
      await screen.findByText('Your library appears here after you sign in'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);
  });
});
