import { addCatalog, createI18n, hasCatalog, isLanguage } from '@renaissance/core/i18n';
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

/**
 * One instance, initialised once by core with English built in; React reads it through
 * I18nextProvider in main.tsx. Gujarati is its own chunk, kept out of the first load: fetched
 * before the first paint when it is the chosen language (`i18nReady`), on demand when switched.
 */
export const i18n = createI18n(detectLanguage());
applyLanguage(i18n.language);

const loading = new Map<Language, Promise<void>>();

/** Resolves once this language's strings are in the instance. English always is. */
export function ensureCatalog(language: Language): Promise<void> {
  if (language === 'en' || hasCatalog(i18n, language)) return Promise.resolve();
  let pending = loading.get(language);
  if (!pending) {
    pending = import('@renaissance/core/locales/gu')
      .then((module) => addCatalog(i18n, language, module.default))
      .finally(() => loading.delete(language));
    loading.set(language, pending);
  }
  return pending;
}

/** main.tsx renders after this, so a Gujarati visit never flashes English. */
export const i18nReady: Promise<void> = ensureCatalog(
  isLanguage(i18n.language) ? i18n.language : 'en',
).catch(() => undefined);

/** `html lang` follows the active language from the first paint (design F, functionality G). */
export function applyLanguage(language: string): void {
  document.documentElement.lang = language;
}

/** Switch the language; resolves once its strings are shown (at once when they are already loaded). */
export function setLanguage(language: Language): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* private window: the choice lasts the session */
  }
  applyLanguage(language);
  if (hasCatalog(i18n, language) || language === 'en') {
    void i18n.changeLanguage(language);
    return Promise.resolve();
  }
  return ensureCatalog(language).then(() => {
    void i18n.changeLanguage(language);
  });
}
