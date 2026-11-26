/**
 * Settings (F67 subset, F84): core's schema, kept in the app's key-value store and parsed on the way
 * back in, so a corrupt or old value falls back to the defaults.
 */
import { createStore, defaultSettings, parseSettings } from '@renaissance/core';
import type { Settings } from '@renaissance/core';

import { getItem, setItem } from './kv';

const STORAGE_KEY = 'renaissance.settings';

function read(): Settings {
  try {
    const raw = getItem(STORAGE_KEY);
    return raw ? parseSettings(JSON.parse(raw)) : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export const settingsStore = createStore<Settings>(defaultSettings);

/** Read the stored settings once the key-value store is hydrated. */
export function loadSettings(): void {
  settingsStore.set(read());
}

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set((s) => parseSettings({ ...s, ...patch }));
}

settingsStore.subscribe((settings) => {
  setItem(STORAGE_KEY, JSON.stringify(settings));
});
