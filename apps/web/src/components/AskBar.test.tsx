import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { renderWithI18n } from '../test/render';
import { signInFake } from '../test/fakes';
import { AskBar } from './AskBar';

function setPlatform(value: string): void {
  Object.defineProperty(navigator, 'platform', { value, configurable: true });
}

describe('AskBar', () => {
  afterEach(() => setPlatform(''));

  it('focuses on ⌘K and Ctrl K and asks to sign in while signed out', async () => {
    setLanguage('en');
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    const input = screen.getByRole('combobox', { name: 'Ask for anything' });
    expect(input).toHaveAttribute('placeholder', 'Ask for anything');
    expect(input).not.toHaveFocus();
    await user.keyboard('{Meta>}k{/Meta}');
    expect(input).toHaveFocus();
    (input as HTMLInputElement).blur();
    await user.keyboard('{Control>}k{/Control}');
    expect(input).toHaveFocus();
    expect(screen.getByText('Sign in to search your library')).toBeInTheDocument();
  });

  it('lists library hits instantly while typing and plays a song on Enter', async () => {
    setLanguage('en');
    const { player } = signInFake();
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    const input = screen.getByRole('combobox');
    expect(screen.getByText(/A song, an album, an artist or a playlist/)).toBeInTheDocument();
    await user.type(input, 'duck');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Fluffing a Duck');
    expect(options.at(-1)).toHaveTextContent('See all results');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(player.snapshot.queue.items[0]?.title).toBe('Fluffing a Duck');
    expect(input).toHaveValue('');
    await user.type(input, 'zzzz');
    expect(screen.getByText('Nothing in your library matches yet')).toBeInTheDocument();
  });

  it('lists the kind holding the best match first: an artist typed by name leads the songs', async () => {
    setLanguage('en');
    signInFake();
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox'), 'kevin macleod');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Kevin MacLeod');
    expect(options[0]).toHaveTextContent('Artists');
    expect(options[1]).toHaveTextContent('Songs');
  });

  it('shows recent searches when empty and can clear them', async () => {
    setLanguage('en');
    signInFake();
    localStorage.setItem('renaissance.recentSearches', JSON.stringify(['kevin']));
    const { recentSearchesStore } = await import('../lib/recent');
    recentSearchesStore.set(['kevin']);
    renderWithI18n(<AskBar compact />);
    const user = userEvent.setup();
    expect(screen.queryByText(/A song, an album/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'kevin' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear recent searches' }));
    expect(recentSearchesStore.get()).toEqual([]);
  });

  it('spells the shortcut for the platform', () => {
    setLanguage('en');
    setPlatform('MacIntel');
    const mac = renderWithI18n(<AskBar />);
    expect(mac.container.querySelector('kbd')).toHaveTextContent('⌘K');
    mac.unmount();
    setPlatform('Win32');
    renderWithI18n(<AskBar />);
    expect(document.querySelector('kbd')).toHaveTextContent('Ctrl K');
  });
});
