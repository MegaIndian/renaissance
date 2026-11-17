import { createI18n, isLanguage } from '@renaissance/core/i18n';
import type { Language } from '@renaissance/core/i18n';

const STORAGE_KEY = 'renaissance.language';

/**
 * The language for this visit: `?lang=` in the URL (used by screenshots and e2e), then the stored
 * choice, then the browser. Exported so the test can drive it.
 */
export function detectLanguage(
  search: string = window.location.search,
  stored: string | null = safeGet(STORAGE_KEY),
  browser: string = navigator.language,
): Language {
  const fromUrl = new URLSearchParams(search).get('lang');
  if (fromUrl && isLanguage(fromUrl)) return fromUrl;
  if (stored && isLanguage(stored)) return stored;
  const fromBrowser = browser.split('-')[0] ?? 'en';
  return isLanguage(fromBrowser) ? fromBrowser : 'en';
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** One instance, initialised once by core; React reads it through I18nextProvider in main.tsx. */
export const i18n = createI18n(detectLanguage());
applyLanguage(i18n.language);

/** `html lang` follows the active language from the first paint (design F, functionality G). */
export function applyLanguage(language: string): void {
  document.documentElement.lang = language;
}

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language);
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* private window: the choice lasts the session */
  }
  applyLanguage(language);
}
