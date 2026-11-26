import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { LibraryIndex, buildSnapshot } from '@renaissance/core';

import { setLanguage } from '../lib/i18n';
import { libraryStore } from '../lib/library';
import { settingsStore, updateSettings } from '../lib/settings';
import { renderApp } from '../test/render';
import { signInFake } from '../test/fakes';
import { setViewport } from '../test/setup';

describe('Settings', () => {
  afterEach(() => {
    updateSettings({
      mode: 'simple',
      theme: 'system',
      wifiQuality: 'lossless',
      albumAwareShuffle: false,
    });
    setLanguage('en');
  });

  it('switches mode, theme and quality, persists them, and sets data attributes', async () => {
    setLanguage('en');
    signInFake();
    renderApp('/settings');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: 'Advanced' }));
    expect(settingsStore.get().mode).toBe('advanced');
    expect(document.documentElement.dataset['mode']).toBe('advanced');
    expect(JSON.parse(localStorage.getItem('renaissance.settings') ?? '{}').mode).toBe('advanced');
    expect(screen.getByRole('link', { name: 'Search' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset['theme']).toBe('light');
    await user.selectOptions(screen.getByLabelText('Quality on Wi-Fi'), 'medium');
    expect(settingsStore.get().wifiQuality).toBe('medium');
    await user.click(screen.getByRole('checkbox', { name: /Shuffle whole albums/ }));
    expect(settingsStore.get().albumAwareShuffle).toBe(true);
    expect(screen.getByText('Signed in as Sahil')).toBeInTheDocument();
    expect(screen.getByText(/Encrypted in this browser/)).toBeInTheDocument();
    expect(screen.getByText(/Version \d/)).toBeInTheDocument();
    // Two library buttons, two names: the full rebuild and the quick refresh.
    expect(screen.getByRole('button', { name: 'Rebuild library' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Refresh library' })).toHaveLength(1);
  });

  it('the library counts wait for the cache: nothing says "0 songs" while it loads from disk', async () => {
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
    renderApp('/settings');
    expect(await screen.findByRole('button', { name: 'Rebuild library' })).toBeInTheDocument();
    expect(screen.queryByText(/songs · /)).not.toBeInTheDocument();
    // The first sync is running over an empty cache: still no "0 songs · 0 albums" (prod AE).
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
    expect(await screen.findByText(/Loading your library: 1 of 1 artists/)).toBeInTheDocument();
    expect(screen.queryByText(/songs · /)).not.toBeInTheDocument();
    libraryStore.set({
      ...libraryStore.get(),
      ready: true,
      sync: { status: 'idle', progress: null, mode: null, error: null },
    });
    expect(await screen.findByText('0 songs · 0 albums · 0 artists')).toBeInTheDocument();
  });

  it('the theme, language and network groups have a visible caption, not only an aria-label (design AC)', async () => {
    setLanguage('en');
    renderApp('/settings');
    const theme = await screen.findByRole('radiogroup', { name: 'Theme' });
    const main = within(screen.getByRole('main'));
    for (const [name, group] of [
      ['Theme', theme],
      ['Language', main.getByRole('radiogroup', { name: 'Language' })],
      ['Network', main.getByRole('radiogroup', { name: 'Network' })],
    ] as const) {
      const labelId = group.getAttribute('aria-labelledby');
      expect(labelId, name).toBeTruthy();
      const caption = document.getElementById(labelId ?? '');
      expect(caption).toHaveTextContent(name);
      expect(caption?.className).not.toContain('sr-only');
    }
  });

  it('the avatar goes to Settings when signed in and to Sign in when not; language persists in settings', async () => {
    setViewport(390);
    setLanguage('en');
    renderApp('/');
    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Sign in' }),
    ).toHaveAttribute('href', '/sign-in');
    signInFake();
    const view = renderApp('/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const user = userEvent.setup();
    const groups = screen.getAllByRole('radiogroup', { name: 'Language' });
    await user.click(groups.at(-1)!.querySelector('[role="radio"]:last-child') as HTMLElement);
    // The choice is stored and `lang` set once the Gujarati chunk is in: wait for both.
    await waitFor(() => expect(settingsStore.get().language).toBe('gu'));
    await waitFor(() => expect(document.documentElement.lang).toBe('gu'));
    view.unmount();
  });
});
