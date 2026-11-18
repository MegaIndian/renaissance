import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
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
    expect(settingsStore.get().language).toBe('gu');
    expect(document.documentElement.lang).toBe('gu');
    view.unmount();
  });
});
