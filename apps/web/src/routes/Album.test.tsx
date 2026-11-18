import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { signInFake } from '../test/fakes';
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

  it('missing items say so', async () => {
    setLanguage('en');
    signInFake();
    renderApp('/album/nope');
    expect(await screen.findByText('This album is not on the server any more')).toBeInTheDocument();
  });
});
