import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { collectionItem, fakeHub } from '../test/hub';
import { renderWithI18n } from '../test/render';
import { Library } from './Library';

describe('Library', () => {
  it('defaults to Mine, lists the collection, and switches to everything on the server', async () => {
    setLanguage('en');
    const hub = fakeHub({
      collection: vi.fn(async () => [
        collectionItem(),
        collectionItem({
          id: 2,
          title: 'Red',
          artist: 'Taylor Swift',
          kind: 'album',
          source: 'add',
        }),
      ]),
    });
    renderWithI18n(<Library />, hub);
    expect(await screen.findByText('Fireman')).toBeInTheDocument();
    expect(screen.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByText('Added')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Everything on the server' }));
    expect(screen.getByText('Your library appears here after you sign in')).toBeInTheDocument();
    expect(screen.queryByText('Fireman')).not.toBeInTheDocument();
  });

  it('asks to sign in without a hub, and shows the empty collection sentence', async () => {
    setLanguage('en');
    renderWithI18n(<Library />, null);
    expect(screen.getByText('Sign in to see your music')).toBeInTheDocument();
    renderWithI18n(<Library />, fakeHub());
    expect(await screen.findByText('Nothing in your music yet')).toBeInTheDocument();
  });
});
