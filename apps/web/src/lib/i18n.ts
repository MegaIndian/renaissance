import { addCatalog, createI18n, hasCatalog, isLanguage } from '@renaissance/core/i18n';
import type { Language } from '@renaissance/core/i18n';

import { swallow } from './log';
import { toast } from './toast';

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

/** Where each catalog chunk comes from; a test may swap a loader to hold it back or fail it. */
export const catalogLoaders: Record<'gu', () => Promise<{ default: object }>> = {
  gu: () => import('@renaissance/core/locales/gu'),
};

/** Resolves once this language's strings are in the instance. English always is. */
export function ensureCatalog(language: Language): Promise<void> {
  if (language === 'en' || hasCatalog(i18n, language)) return Promise.resolve();
  let pending = loading.get(language);
  if (!pending) {
    pending = catalogLoaders[language]()
      .then((module) => addCatalog(i18n, language, module.default as never))
      .finally(() => loading.delete(language));
    loading.set(language, pending);
  }
  return pending;
}

/** main.tsx renders after this, so a Gujarati visit never flashes English. */
export const i18nReady: Promise<void> = ensureCatalog(
  isLanguage(i18n.language) ? i18n.language : 'en',
).catch(swallow('catalog load failed'));

/** `html lang` follows the active language from the first paint (design F, functionality G). */
export function applyLanguage(language: string): void {
  document.documentElement.lang = language;
}

function store(language: string | null): void {
  try {
    if (language) localStorage.setItem(STORAGE_KEY, language);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private window: the choice lasts the session */
  }
}

/**
 * Switch the language. `html lang`, the strings and the stored choice change together, once the
 * catalog is in (at once when it already is), so a screen reader never speaks English under a
 * Gujarati `lang`. Resolves `true` when the strings are shown; when the chunk cannot be fetched
 * (offline on a first switch, a stale deploy), everything stays as it was, one toast says so, and
 * it resolves `false`. It never rejects.
 */
export function setLanguage(language: Language): Promise<boolean> {
  const show = (): void => {
    store(language);
    applyLanguage(language);
    void i18n.changeLanguage(language);
  };
  if (hasCatalog(i18n, language) || language === 'en') {
    show();
    return Promise.resolve(true);
  }
  return ensureCatalog(language).then(
    () => {
      show();
      return true;
    },
    () => {
      toast(i18n.t('error.failed'), { tone: 'danger' });
      return false;
    },
  );
}
