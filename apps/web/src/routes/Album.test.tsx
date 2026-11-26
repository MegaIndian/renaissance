import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ServerError, UnreachableError } from '@renaissance/core';

import { setLanguage } from '../lib/i18n';
import { libraryStore } from '../lib/library';
import { session, signInFake, track } from '../test/fakes';
import { renderApp } from '../test/render';

describe('Album, artist and playlist pages', () => {
  it('album: title, artist link, meta line, numbered tracks, play and menu', async () => {
    setLanguage('en');
    const { player } = signInFake();
    renderApp('/album/al1');
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Royalty Free' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kevin MacLeod' })).toHaveAttribute(
      'href',
      '/artist/a1',
    );
    expect(screen.getByText(/2010 · Contemporary · 2 songs/)).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Play' }));
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['t1', 't2']);
    await user.click(within(rows[1]!).getByRole('button', { name: 'More options for Carefree' }));
    expect(screen.getByRole('menuitem', { name: 'Play next' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Go to album' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('album: a heart on the album page fills at once, before any refetch', async () => {
    setLanguage('en');
    const { calls } = signInFake();
    renderApp('/album/al1');
    const user = userEvent.setup();
    await screen.findByRole('heading', { level: 1, name: 'Royalty Free' });
    const rows = screen.getAllByRole('listitem');
    const row = rows.find((r) => within(r).queryByText('Carefree')) as HTMLElement;
    const heart = within(row).getByRole('button', { name: 'Add to favourites' });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    await user.click(heart);
    // The rows come from the server's list; the cache's favourite is laid over them by id.
    expect(within(row).getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(calls.favorites).toEqual([{ id: 't2', favorite: true }]);
    await user.click(within(row).getByRole('button', { name: 'Remove from favourites' }));
    expect(within(row).getByRole('button', { name: 'Add to favourites' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('a playlist route says nothing while the cache is still loading, then that the playlist is gone', async () => {
    setLanguage('en');
    signInFake();
    libraryStore.set({ ...libraryStore.get(), ready: false });
    renderApp('/playlist/nope');
    await screen.findByRole('search');
    expect(
      screen.queryByText('This playlist is not on the server any more'),
    ).not.toBeInTheDocument();
    libraryStore.set({ ...libraryStore.get(), ready: true });
    expect(
      await screen.findByText('This playlist is not on the server any more'),
    ).toBeInTheDocument();
  });

  it('artist: biography, albums row and songs', async () => {
    setLanguage('en');
    signInFake();
    renderApp('/artist/a1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Kevin MacLeod' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Composer from Wisconsin.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Albums' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play Carefree' })).toBeInTheDocument();
  });

  it('playlist: tracks from the server, rename dialog, remove entry', async () => {
    setLanguage('en');
    const { calls } = signInFake();
    renderApp('/playlist/p1');
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Drive' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Play Fluffing a Duck' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename' });
    await user.clear(within(dialog).getByLabelText('Playlist name'));
    await user.type(within(dialog).getByLabelText('Playlist name'), 'Sunday drive');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(calls.playlists).toContain('rename p1 Sunday drive');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sunday drive' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More options for Fluffing a Duck' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from playlist' }));
    expect(calls.playlists).toContain('remove p1 e3');
  });

  it('playlist: 3,000 entries mount a few dozen rows, not three thousand (func AJ)', async () => {
    setLanguage('en');
    const { adapter } = signInFake();
    const library = adapter.library(session);
    vi.spyOn(adapter, 'library').mockReturnValue({
      ...library,
      playlistTracks: () =>
        Promise.resolve(
          Array.from({ length: 3_000 }, (_, i) => ({
            ...track(`s${i}`, { title: `Song ${i}` }),
            entryId: `e${i}`,
          })),
        ),
    });
    renderApp('/playlist/p1');
    expect(await screen.findByRole('button', { name: 'Play Song 0' })).toBeInTheDocument();
    expect(screen.getByText(/3,000 songs/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Songs' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(200);
  });

  it('missing items say so, after saying that they are being looked up (design AE)', async () => {
    setLanguage('en');
    signInFake();
    renderApp('/album/nope');
    expect(await screen.findByText('Loading…')).toHaveAttribute('role', 'status');
    expect(await screen.findByText('This album is not on the server any more')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('a server that cannot be reached is asked again, then says so, not "not on the server any more" (prod AM)', async () => {
    setLanguage('en');
    const { adapter } = signInFake();
    const library = adapter.library(session);
    let albumAsked = 0;
    let artistAsked = 0;
    let goneAsked = 0;
    vi.spyOn(adapter, 'library').mockReturnValue({
      ...library,
      album: (id: string) => {
        if (id === 'gone') {
          goneAsked += 1;
          return Promise.reject(new ServerError(404, '/Items/gone'));
        }
        albumAsked += 1;
        return Promise.reject(new UnreachableError('/Items/far', 'timeout'));
      },
      artist: () => {
        artistAsked += 1;
        return Promise.reject(new ServerError(503, '/Items/far'));
      },
    });
    const view = renderApp('/album/far');
    expect(
      await screen.findByText('The server could not be reached. Try again when it is back.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('This album is not on the server any more')).not.toBeInTheDocument();
    expect(albumAsked).toBe(3);
    view.unmount();
    renderApp('/artist/far');
    expect(
      await screen.findByText('The server could not be reached. Try again when it is back.'),
    ).toBeInTheDocument();
    expect(artistAsked).toBe(3);
    // A 404 is the answer: asked once, and the sentence is the "gone" one.
    renderApp('/album/gone');
    expect(await screen.findByText('This album is not on the server any more')).toBeInTheDocument();
    expect(goneAsked).toBe(1);
  });

  it('an unknown artist is looked up with a visible cue, not a blank page (design AE)', async () => {
    setLanguage('en');
    const { adapter } = signInFake();
    const library = adapter.library(session);
    vi.spyOn(adapter, 'library').mockReturnValue({
      ...library,
      artist: () => Promise.reject(new ServerError(404, '/Items/nope')),
    });
    renderApp('/artist/nope');
    expect(await screen.findByText('Loading…')).toHaveAttribute('role', 'status');
    expect(
      await screen.findByText('This artist is not on the server any more'),
    ).toBeInTheDocument();
  });
});
