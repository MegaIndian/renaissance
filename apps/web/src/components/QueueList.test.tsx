import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { toastStore } from '../lib/toast';
import { signInFake, tracks } from '../test/fakes';
import { renderWithI18n } from '../test/render';
import { NowPlayingBar } from './NowPlayingBar';
import { QueueList } from './QueueList';

describe('QueueList and NowPlayingBar', () => {
  it('shows now playing and up next, moves, removes and clears with undo', async () => {
    setLanguage('en');
    const { player } = signInFake();
    player.playTracks(tracks, 0);
    renderWithI18n(<QueueList />);
    const user = userEvent.setup();
    expect(screen.getByRole('region', { name: 'Now playing' })).toHaveTextContent('Sneaky Snitch');
    const upNext = screen.getByRole('list', { name: 'Up next' });
    expect(
      within(upNext)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(expect.arrayContaining([expect.stringContaining('Carefree')]));
    await user.click(
      within(upNext).getByRole('button', { name: 'More options for Fluffing a Duck' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['t1', 't3', 't2', 't4']);
    await user.click(
      within(screen.getByRole('list', { name: 'Up next' })).getByRole('button', {
        name: 'More options for Carefree',
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Remove from queue' }));
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['t1', 't3', 't4']);
    expect(toastStore.get()?.message).toBe('Removed Carefree from the queue');
    toastStore.get()?.undo?.();
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['t1', 't3', 't2', 't4']);
    await user.click(screen.getByRole('button', { name: 'Play Monkeys Spinning Monkeys' }));
    expect(player.snapshot.queue.index).toBe(3);
    await user.click(screen.getByRole('button', { name: 'Clear queue' }));
    expect(screen.getByText('The queue is empty')).toBeInTheDocument();
    toastStore.get()?.undo?.();
    expect(player.snapshot.queue.items).toHaveLength(4);
  });

  it('the bar shows the track, toggles play and pause, and links to now playing', async () => {
    setLanguage('en');
    const { player } = signInFake();
    player.playTracks(tracks, 1);
    renderWithI18n(<NowPlayingBar />);
    const user = userEvent.setup();
    expect(screen.getByRole('link', { name: 'Open now playing' })).toHaveTextContent('Carefree');
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(player.snapshot.status).toBe('paused');
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.snapshot.status).toBe('playing');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(player.snapshot.queue.index).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Shuffle off' }));
    expect(player.snapshot.queue.shuffle).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Repeat off' }));
    expect(player.snapshot.queue.repeat).toBe('all');
    expect(screen.getByRole('slider', { name: 'Position' })).toBeInTheDocument();
  });
});
