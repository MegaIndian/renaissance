import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { setHubForTests } from '../lib/hub';
import { setLanguage } from '../lib/i18n';
import { signInFake } from '../test/fakes';
import { answer, fireman, useFakeHub } from '../test/hub';
import { renderApp } from '../test/render';

afterEach(() => setHubForTests(null));

const chopped = {
  id: 'dz:track:2',
  title: 'Fireman (Chopped & Screwed)',
  artist: 'Lil Wayne',
  album: 'Tha Carter II (Chopped)',
};

describe('Search: the catalogue after the library (F61)', () => {
  it('asks the full search and wears the one blue on the first row, the song typed', async () => {
    setLanguage('en');
    signInFake();
    const hub = useFakeHub({ search: (q) => answer(q, { songs: [fireman, chopped] }) });
    renderApp('/search?q=fireman%20lil%20wayne');
    const user = userEvent.setup();
    const main = within(await screen.findByRole('main'));
    const section = await main.findByRole('region', { name: 'Add from the catalogue' });
    const rows = await within(section).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // The version moves into the subtitle, where a narrow row still shows it.
    expect(rows[1]).toHaveTextContent('Fireman');
    expect(rows[1]).toHaveTextContent('Chopped & Screwed · Lil Wayne');
    const other = within(section).getByRole('button', {
      name: 'Add Fireman (Chopped & Screwed) by Lil Wayne',
    });
    const exact = within(section).getByRole('button', { name: 'Add Fireman by Lil Wayne' });
    expect(exact.className).toContain('bg-primary');
    expect(other.className).not.toContain('bg-primary');
    expect(hub.searched).toContainEqual({ q: 'fireman lil wayne', full: true });
    await user.click(exact);
    expect(hub.created[0]).toMatchObject({ title: 'Fireman' });
    expect(await within(section).findByText(/On its way/)).toBeInTheDocument();
  });

  it('keeps every Add secondary and says why when no row is the song typed', async () => {
    setLanguage('en');
    signInFake();
    useFakeHub({ search: (q) => answer(q, { songs: [chopped], exact: false, busy: true }) });
    renderApp('/search?q=fireman');
    const main = within(await screen.findByRole('main'));
    const section = await main.findByRole('region', { name: 'Add from the catalogue' });
    expect(
      await within(section).findByText('The catalogue is busy; these may be other versions'),
    ).toBeInTheDocument();
    expect(
      within(section).getByRole('button', { name: /Add Fireman \(Chopped/ }).className,
    ).not.toContain('bg-primary');
  });

  it('shows nothing of the catalogue without a hub', async () => {
    setLanguage('en');
    signInFake();
    renderApp('/search?q=kevin');
    await screen.findByRole('heading', { level: 1, name: 'Results for "kevin"' });
    expect(screen.queryByRole('region', { name: 'Add from the catalogue' })).toBeNull();
  });
});
