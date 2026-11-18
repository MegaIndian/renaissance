import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { sessionStore } from '../lib/session';

afterEach(() => cleanup());

/** Tests start signed out unless they sign in; the app itself starts `loading` until the vault is read. */
beforeEach(() => {
  localStorage.clear();
  sessionStore.set({ status: 'signedOut', session: null, adapter: null, vault: null });
  setViewport(1280);
});

/** jsdom has no matchMedia; tests set the width with `setViewport`. */
export function setViewport(width: number): void {
  window.matchMedia = (query: string): MediaQueryList => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}

/** jsdom has no ResizeObserver (virtual lists and card grids measure with it). */
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;

/** jsdom's media elements do not play; the player tests drive `DomAudioPort` with these stubs. */
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: vi.fn(() => Promise.resolve()),
});
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: vi.fn() });
