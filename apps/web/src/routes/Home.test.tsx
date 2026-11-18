import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { settingsStore } from '../lib/settings';
import { signInFake } from '../test/fakes';
import { renderWithI18n } from '../test/render';
import { Home } from './Home';

describe('Home', () => {
  it('greets by the time of day', () => {
    setLanguage('en');
    const view = renderWithI18n(<Home now={new Date(2026, 10, 17, 8)} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good morning');
    view.unmount();
    renderWithI18n(<Home now={new Date(2026, 10, 17, 20)} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good evening');
  });

  it('shows full sentences, no placeholder art and no truncation while signed out', () => {
    setLanguage('en');
    renderWithI18n(<Home />);
    expect(screen.getByText('Sign in to a server to see your music here')).toBeInTheDocument();
    expect(screen.getByText('Your favourite songs appear here')).toBeInTheDocument();
    expect(screen.queryAllByTestId('placeholder-art')).toHaveLength(0);
    expect(document.querySelectorAll('.truncate').length).toBe(0);
  });

  it('signed in, simple mode: greets by name and shows three rows, no phase talk', async () => {
    setLanguage('en');
    settingsStore.set({ ...settingsStore.get(), mode: 'simple' });
    const { player } = signInFake();
    renderWithI18n(<Home now={new Date(2026, 10, 17, 20)} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good evening, Sahil');
    const mySongs = screen.getByRole('region', { name: 'My songs' });
    expect(
      within(mySongs).getByRole('button', { name: 'Play Fluffing a Duck' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recently played' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Made for you' })).toBeInTheDocument();
    expect(screen.queryByText(/phase 4/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recently added' })).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(within(mySongs).getByRole('button', { name: 'Play Fluffing a Duck' }));
    expect(player.snapshot.queue.items[0]?.id).toBe('t3');
    expect(player.snapshot.status).toBe('playing');
  });

  it('advanced mode adds Recently added and Most played and names the mixes phase', () => {
    setLanguage('en');
    settingsStore.set({ ...settingsStore.get(), mode: 'advanced' });
    signInFake();
    renderWithI18n(<Home />);
    expect(screen.getByRole('region', { name: 'Recently added' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Most played' })).toBeInTheDocument();
    expect(screen.getByText('Mixes arrive in phase 4.')).toBeInTheDocument();
    settingsStore.set({ ...settingsStore.get(), mode: 'simple' });
  });
});
