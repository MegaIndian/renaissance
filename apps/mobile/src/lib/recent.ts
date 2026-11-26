import { createStore, rememberSearch } from '@renaissance/core';

import { getItem, setItem } from './kv';

const KEY = 'renaissance.recentSearches';

/** Recent searches (F11), newest first, kept on this device. */
export const recentSearchesStore = createStore<string[]>([]);

export function loadRecent(): void {
  try {
    const parsed: unknown = JSON.parse(getItem(KEY) ?? '[]');
    recentSearchesStore.set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
    );
  } catch {
    recentSearchesStore.set([]);
  }
}

recentSearchesStore.subscribe((list) => setItem(KEY, JSON.stringify(list)));

export function rememberRecent(term: string): void {
  recentSearchesStore.set((list) => rememberSearch(list, term));
}

export function clearRecent(): void {
  recentSearchesStore.set([]);
}
