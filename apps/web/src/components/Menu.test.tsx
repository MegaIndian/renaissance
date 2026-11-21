import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setLanguage } from '../lib/i18n';
import { renderWithI18n } from '../test/render';
import { Menu, flipsAbove } from './Menu';
import { ScrollContainerContext } from './ScrollContainer';

const items = [
  'Play next',
  'Add to end',
  'Add to playlist',
  'Go to album',
  'Go to artist',
  'Remove',
].map((label) => ({ key: label, label, onSelect: () => undefined }));

/** jsdom has no layout: give the trigger, the list and the scroll container the boxes of a phone. */
function layout(triggerTop: number, { menuHeight = 240, mainTop = 56, mainBottom = 760 } = {}) {
  const rect = (top: number, height: number): DOMRect =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 390,
      width: 390,
      x: 0,
      y: top,
    }) as DOMRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('role') === 'menu') return rect(0, menuHeight);
    if (this.tagName === 'MAIN') return rect(mainTop, mainBottom - mainTop);
    if (this.getAttribute('aria-haspopup') === 'menu') return rect(triggerTop, 32);
    return rect(0, 0);
  });
}

function renderMenu() {
  const main = { current: null as HTMLElement | null };
  return renderWithI18n(
    <ScrollContainerContext.Provider value={main}>
      <main
        ref={(el) => {
          main.current = el;
        }}
      >
        <Menu label="More for Carefree" items={items} />
      </main>
    </ScrollContainerContext.Provider>,
  );
}

describe('Menu placement', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens above its trigger when the scroll container has no room below, so every item is reachable', async () => {
    setLanguage('en');
    window.innerHeight = 844;
    layout(700);
    renderMenu();
    await userEvent.setup().click(screen.getByRole('button', { name: 'More for Carefree' }));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('data-placement', 'above');
    expect(menu.className).toContain('bottom-full');
    expect(menu.className).not.toContain('mt-1');
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
  });

  it('opens below when there is room, and again below after a flip once it is reopened with room', async () => {
    setLanguage('en');
    window.innerHeight = 844;
    layout(100);
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More for Carefree' }));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('data-placement', 'below');
    expect(menu.className).toContain('mt-1');
    expect(menu.className).not.toContain('bottom-full');
  });

  it('is placed again when its container scrolls or the window resizes, so the place is never stale (prod AG)', async () => {
    setLanguage('en');
    window.innerHeight = 844;
    layout(700);
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More for Carefree' }));
    expect(screen.getByRole('menu')).toHaveAttribute('data-placement', 'above');
    // The list scrolled up with its row: room below now, so the list follows.
    layout(100);
    screen.getByRole('main').dispatchEvent(new Event('scroll'));
    await waitFor(() =>
      expect(screen.getByRole('menu')).toHaveAttribute('data-placement', 'below'),
    );
    expect(screen.getByRole('menu').className).not.toContain('bottom-full');
    // A resize that leaves no room below flips it back; the list stays open throughout.
    layout(700);
    window.dispatchEvent(new Event('resize'));
    await waitFor(() =>
      expect(screen.getByRole('menu')).toHaveAttribute('data-placement', 'above'),
    );
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
  });

  it('flipsAbove measures against the viewport when there is no scroll container, and never flips into less room', () => {
    const el = (top: number, height: number) =>
      ({
        getBoundingClientRect: () => ({ top, bottom: top + height, height }) as DOMRect,
      }) as HTMLElement;
    window.innerHeight = 844;
    expect(flipsAbove(el(700, 32), el(0, 240), null)).toBe(true);
    expect(flipsAbove(el(100, 32), el(0, 240), null)).toBe(false);
    // A trigger at the very top of a short viewport: no room either way, so stay below (the main scrolls).
    expect(flipsAbove(el(10, 32), el(0, 240), el(0, 200))).toBe(false);
    expect(flipsAbove(null, el(0, 240), null)).toBe(false);
  });
});
