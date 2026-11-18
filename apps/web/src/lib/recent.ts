import { createStore, rememberSearch } from '@renaissance/core';

const KEY = 'renaissance.recentSearches';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Recent searches (F11), newest first, kept in this browser. */
export const recentSearchesStore = createStore<string[]>(read());

recentSearchesStore.subscribe((list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private window */
  }
});

export function rememberRecent(term: string): void {
  recentSearchesStore.set((list) => rememberSearch(list, term));
}

export function clearRecent(): void {
  recentSearchesStore.set([]);
}
