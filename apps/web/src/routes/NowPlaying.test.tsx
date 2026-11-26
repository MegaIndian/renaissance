import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { updateSettings } from '../lib/settings';
import { signInFake, tracks } from '../test/fakes';
import { renderApp } from '../test/render';
import { setViewport } from '../test/setup';

describe('NowPlaying', () => {
  afterEach(() => updateSettings({ mode: 'simple' }));

  it('shows the current song, its artist link, the heart and the transport on a phone', async () => {
    setLanguage('en');
    setViewport(390);
    const { player, calls } = signInFake();
    player.playTracks(tracks, 1);
    renderApp('/now-playing');
    const user = userEvent.setup();
    const main = within(await screen.findByRole('main'));
    expect((await main.findAllByText('Carefree')).length).toBeGreaterThan(0);
    expect(main.getByRole('link', { name: 'Kevin MacLeod' })).toHaveAttribute('href', '/artist/a1');
    expect(main.getByRole('heading', { level: 1 })).toHaveTextContent('Royalty Free');
    const transport = screen.getByTestId('now-playing-transport');
    await user.click(within(transport).getByRole('button', { name: 'Next' }));
    expect(player.snapshot.queue.index).toBe(2);
    expect(main.getAllByText('Fluffing a Duck').length).toBeGreaterThan(0);
    await user.click(within(transport).getByRole('button', { name: 'Pause' }));
    expect(player.snapshot.status).toBe('paused');
    expect(within(transport).getByRole('button', { name: 'Play' })).toBeInTheDocument();
    await user.click(main.getByRole('button', { name: 'Remove from favourites' }));
    expect(calls.favorites).toEqual([{ id: 't3', favorite: false }]);
    expect(main.getAllByRole('link', { name: 'Queue' }).length).toBeGreaterThan(0);
    // Lyrics and cast are present but muted; the phase hint shows in advanced mode only.
    expect(screen.getByRole('button', { name: 'Lyrics' })).toBeDisabled();
    expect(screen.queryByText('Lyrics arrive in phase 6')).not.toBeInTheDocument();
    updateSettings({ mode: 'advanced' });
    expect(await screen.findByText('Lyrics arrive in phase 6')).toBeInTheDocument();
  });

  it('says what went wrong when the stream fails, and that nothing plays when the queue is empty', async () => {
    setLanguage('en');
    setViewport(390);
    const { player, audio } = signInFake();
    player.playTracks(tracks, 0);
    renderApp('/now-playing');
    const main = within(await screen.findByRole('main'));
    await main.findAllByText('Sneaky Snitch');
    audio.emit({ type: 'error', message: 'refused' });
    expect(await main.findByRole('alert')).toHaveTextContent(
      'This song could not be played. Skipping to the next one is safe.',
    );
    player.clear();
    expect(await main.findByText('Nothing playing')).toBeInTheDocument();
    expect(main.getByRole('heading', { level: 1 })).toHaveTextContent('Now playing');
  });
});
