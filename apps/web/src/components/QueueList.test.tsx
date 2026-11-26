import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { toastStore } from '../lib/toast';
import { signInFake, track, tracks } from '../test/fakes';
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
    // The undo comes from outside React: let the list re-render before the next row is clicked.
    act(() => toastStore.get()?.undo?.());
    expect(player.snapshot.queue.items.map((t) => t.id)).toEqual(['t1', 't3', 't2', 't4']);
    expect(
      within(screen.getByRole('list', { name: 'Up next' })).getAllByRole('listitem'),
    ).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Play Monkeys Spinning Monkeys' }));
    expect(player.snapshot.queue.index).toBe(3);
    await user.click(screen.getByRole('button', { name: 'Clear queue' }));
    expect(screen.getByText('The queue is empty')).toBeInTheDocument();
    act(() => toastStore.get()?.undo?.());
    expect(player.snapshot.queue.items).toHaveLength(4);
  });

  it('a 20,000-song queue mounts a few dozen rows, not twenty thousand, and the rows still act (func AI)', async () => {
    setLanguage('en');
    const { player } = signInFake();
    const many = Array.from({ length: 20_000 }, (_, i) => track(`s${i}`, { title: `Song ${i}` }));
    player.playTracks(many, 0);
    renderWithI18n(<QueueList />);
    const user = userEvent.setup();
    const upNext = screen.getByRole('list', { name: 'Up next' });
    expect(screen.getByText('Up next · 19,999 songs')).toBeInTheDocument();
    const rows = within(upNext).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(200);
    expect(rows[0]).toHaveTextContent('Song 1');
    await user.click(within(upNext).getByRole('button', { name: 'More options for Song 2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(player.snapshot.queue.items.slice(0, 3).map((t) => t.id)).toEqual(['s0', 's2', 's1']);
    await user.click(within(upNext).getByRole('button', { name: 'Play Song 3' }));
    expect(player.snapshot.queue.index).toBe(3);
    expect(
      within(screen.getByRole('list', { name: 'Up next' })).getAllByRole('listitem').length,
    ).toBeLessThan(200);
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
