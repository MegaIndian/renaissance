import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { renderApp } from '../test/render';
import { setViewport } from '../test/setup';

describe('Root shell', () => {
  beforeEach(() => {
    setLanguage('en');
    localStorage.clear();
  });

  it('on a phone shows the tab bar with Home, Library and Requests, the language switch and sign in', () => {
    setViewport(390);
    renderApp('/');
    const tabs = screen.getByRole('navigation', { name: 'Navigation' });
    expect(within(tabs).getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(within(tabs).getByRole('link', { name: 'Library' })).toBeInTheDocument();
    expect(within(tabs).getByRole('link', { name: 'Requests' })).toBeInTheDocument();
    expect(within(tabs).queryByRole('link', { name: 'Search' })).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('on desktop shows the sidebar and the Ask bar once', async () => {
    setViewport(1280);
    renderApp('/library');
    expect(await screen.findByRole('complementary')).toBeInTheDocument();
    expect(screen.getAllByRole('search')).toHaveLength(1);
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument();
  });

  it('keeps the Ask bar on every screen', async () => {
    setViewport(390);
    for (const path of ['/', '/library', '/requests', '/sign-in', '/settings', '/queue']) {
      const view = renderApp(path);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.getAllByRole('search')).toHaveLength(1);
      view.unmount();
    }
  });

  it('switches every string and html lang when the language changes', async () => {
    setViewport(390);
    renderApp('/');
    const user = userEvent.setup();
    expect(document.documentElement.lang).toBe('en');
    await user.click(screen.getByRole('radio', { name: 'ગુજરાતી' }));
    expect(document.documentElement.lang).toBe('gu');
    expect(screen.getByRole('link', { name: 'હોમ' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^શુભ/);
    expect(localStorage.getItem('renaissance.language')).toBe('gu');
    await user.click(screen.getByRole('radio', { name: 'English' }));
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
  });

  it('wraps an unknown URL in the shell with a translated sentence and a link home', () => {
    setViewport(390);
    renderApp('/nope');
    expect(screen.getByText('There is no page at this address')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument();
  });

  it('translates the not-found page', () => {
    setViewport(1280);
    setLanguage('gu');
    renderApp('/nope');
    expect(screen.getByText('આ સરનામે કોઈ પેજ નથી')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'હોમ પર જાઓ' })).toBeInTheDocument();
  });

  it('gives every control the solid focus outline (DESIGN.md rule 7)', async () => {
    for (const [width, path] of [
      [390, '/'],
      [1280, '/sign-in'],
    ] as const) {
      setViewport(width);
      const view = renderApp(path);
      await screen.findByRole('heading', { level: 1 });
      const controls = document.querySelectorAll<HTMLElement>('a, button, input');
      expect(controls.length).toBeGreaterThan(5);
      for (const control of controls) {
        const box = control.closest('.focus-within\\:outline-ring');
        const own = control.className.includes('focus-visible:outline-ring');
        expect(own || box !== null, `${control.tagName} ${control.textContent}`).toBe(true);
      }
      view.unmount();
    }
  });

  it('has exactly one primary action on the home screen and it is Sign in', () => {
    setViewport(390);
    renderApp('/');
    const primaries = document.querySelectorAll('.bg-primary');
    const actionable = [...primaries].filter((el) => el.matches('a, button'));
    expect(actionable).toHaveLength(1);
    expect(actionable[0]?.textContent).toBe('Sign in');
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Play' })).not.toHaveClass('bg-primary');
  });
});
