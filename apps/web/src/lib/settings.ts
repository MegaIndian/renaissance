/**
 * Settings (F67 subset, F84): one store, persisted in localStorage, applied to the document as
 * `data-mode` and `data-theme` so tokens.css scales and themes the whole page. `?mode=` and `?theme=`
 * in the URL override for one visit (screenshots and e2e) without being stored.
 */
import { createStore, defaultSettings, parseSettings } from '@renaissance/core';
import type { Settings } from '@renaissance/core';

const STORAGE_KEY = 'renaissance.settings';

function read(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseSettings(JSON.parse(raw)) : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export const settingsStore = createStore<Settings>(read());

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set((s) => parseSettings({ ...s, ...patch }));
}

settingsStore.subscribe((settings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private window: the choice lasts the session */
  }
  applyDocumentAttributes(settings);
});

/** Overrides for this visit from the URL, read once. */
function urlOverrides(search: string): { mode?: Settings['mode']; theme?: Settings['theme'] } {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  const theme = params.get('theme');
  return {
    ...(mode === 'advanced' || mode === 'simple' ? { mode } : {}),
    ...(theme === 'dark' || theme === 'light' ? { theme } : {}),
  };
}

export function applyDocumentAttributes(
  settings: Settings = settingsStore.get(),
  search: string = typeof window === 'undefined' ? '' : window.location.search,
): { mode: Settings['mode']; theme: Settings['theme'] } {
  const overrides = urlOverrides(search);
  const mode = overrides.mode ?? settings.mode;
  const theme = overrides.theme ?? settings.theme;
  document.documentElement.dataset['mode'] = mode;
  if (theme === 'system') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = theme;
  return { mode, theme };
}

/** The mode in force on this visit (URL override included), for screens that branch on it. */
export function effectiveMode(
  settings: Settings = settingsStore.get(),
  search: string = typeof window === 'undefined' ? '' : window.location.search,
): Settings['mode'] {
  return urlOverrides(search).mode ?? settings.mode;
}
