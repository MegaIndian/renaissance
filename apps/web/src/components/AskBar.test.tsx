import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { renderWithI18n } from '../test/render';
import { AskBar } from './AskBar';

describe('AskBar', () => {
  it('focuses on ⌘K and Ctrl K and reports no results while typing', async () => {
    setLanguage('en');
    renderWithI18n(<AskBar />);
    const user = userEvent.setup();
    const input = screen.getByRole('searchbox', { name: /Ask for anything/ });
    expect(input).not.toHaveFocus();
    await user.keyboard('{Meta>}k{/Meta}');
    expect(input).toHaveFocus();
    (input as HTMLInputElement).blur();
    await user.keyboard('{Control>}k{/Control}');
    expect(input).toHaveFocus();
    expect(screen.getByText(/Try "play something calm/)).toBeInTheDocument();
    await user.type(input, 'kishore');
    expect(screen.getByText('Nothing in your library matches yet')).toBeInTheDocument();
  });

  it('compact mode hides the hint until there is text', async () => {
    setLanguage('en');
    renderWithI18n(<AskBar compact />);
    expect(screen.queryByText(/Try "play/)).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole('searchbox'), 'x');
    expect(screen.getByText('Nothing in your library matches yet')).toBeInTheDocument();
  });
});
