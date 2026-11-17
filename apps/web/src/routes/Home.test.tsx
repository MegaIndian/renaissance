import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
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

  it('shows full sentences, not truncated captions under coloured squares', () => {
    setLanguage('en');
    renderWithI18n(<Home />);
    expect(screen.getByText('Sign in to a server to see your music here')).toBeInTheDocument();
    expect(screen.getByText('Your favourite songs appear here')).toBeInTheDocument();
    expect(screen.getAllByTestId('placeholder-art')).toHaveLength(1);
    expect(document.querySelectorAll('.truncate').length).toBe(0);
  });
});
