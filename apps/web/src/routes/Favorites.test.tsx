import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { LibraryIndex, buildSnapshot } from '@renaissance/core';

import { setLanguage } from '../lib/i18n';
import { libraryStore } from '../lib/library';
import { albums, artists, playlists, signInFake, tracks } from '../test/fakes';
import { renderApp } from '../test/render';

describe('Favorites', () => {
  it('lists the hearted songs, albums and artists, plays them, and unhearts from the row', async () => {
    setLanguage('en');
    const { player, calls } = signInFake();
    const snapshot = buildSnapshot(
      tracks,
      albums.map((a) => ({ ...a, isFavorite: true })),
      artists.map((a) => ({ ...a, isFavorite: true })),
      playlists,
      { syncedAt: '2026-11-17T21:00:00.000Z', albumArtistIds: ['a1'] },
    );
    libraryStore.set({ ...libraryStore.get(), snapshot, index: new LibraryIndex(snapshot) });
    renderApp('/favorites');
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Favourites' }),
    ).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    expect(
      within(main.getByRole('region', { name: 'Albums' })).getByRole('link', {
        name: /Royalty Free/,
      }),
    ).toBeInTheDocument();
    expect(
      within(main.getByRole('region', { name: 'Artists' })).getByRole('link', {
        name: /Kevin MacLeod/,
      }),
    ).toBeInTheDocument();
    const songs = main.getByRole('region', { name: 'Songs' });
    expect(
      within(songs)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('Fluffing a Duck')]);
    await user.click(screen.getByRole('button', { name: 'Play all' }));
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['t3']);
    await user.click(within(songs).getByRole('button', { name: 'Remove from favourites' }));
    expect(calls.favorites).toEqual([{ id: 't3', favorite: false }]);
    expect(screen.getByRole('status')).toHaveTextContent('Removed Fluffing a Duck from favourites');
  });

  it('with nothing hearted it says so once the cache is in, and nothing before', async () => {
    setLanguage('en');
    signInFake();
    const snapshot = buildSnapshot(
      tracks.map((t) => ({ ...t, isFavorite: false })),
      albums,
      artists,
      playlists,
      null,
    );
    libraryStore.set({
      ...libraryStore.get(),
      snapshot,
      index: new LibraryIndex(snapshot),
      ready: false,
    });
    renderApp('/favorites');
    await screen.findByRole('heading', { level: 1, name: 'Favourites' });
    expect(screen.queryByText('No favourites yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play all' })).not.toBeInTheDocument();
    libraryStore.set({ ...libraryStore.get(), ready: true });
    expect(await screen.findByText('No favourites yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Tap the heart on a song, album or artist and it appears here/),
    ).toBeInTheDocument();
  });
});
