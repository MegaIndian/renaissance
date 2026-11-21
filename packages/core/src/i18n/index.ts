/**
 * Shared message catalogs. Both apps call `createI18n` and bind their own React layer.
 * English and Gujarati ship in v1 (F66). Figures and names stay in Latin letters in both.
 */
import i18next from 'i18next';
import type { i18n as I18n } from 'i18next';

import en from './locales/en.json';
import gu from './locales/gu.json';

export const supportedLanguages = ['en', 'gu'] as const;
export type Language = (typeof supportedLanguages)[number];

/** One language's strings, the shape of `en.json`; `gu.json` has the same keys (tested). */
export type Catalog = typeof en;

/** Every catalog, for a platform that bundles them all (mobile) and for the key-set test. */
export const catalogs: Record<Language, Catalog> = { en, gu };

export const resources = {
  en: { translation: en },
  gu: { translation: gu },
} as const;

export function isLanguage(value: string): value is Language {
  return (supportedLanguages as readonly string[]).includes(value);
}

/**
 * An i18next instance with English built in. Other catalogs come through `catalogs` here or
 * `addCatalog` later, so a platform can keep them out of its first load (web fetches Gujarati
 * before the first paint when it is the chosen language, and on demand when switched).
 */
export function createI18n(
  language: Language = 'en',
  options: { catalogs?: Partial<Record<Language, Catalog>> } = {},
): I18n {
  const instance = i18next.createInstance();
  const resources: Record<string, { translation: Catalog }> = { en: { translation: en } };
  for (const [lng, catalog] of Object.entries(options.catalogs ?? {})) {
    if (catalog) resources[lng] = { translation: catalog };
  }
  void instance.init({
    lng: language,
    fallbackLng: 'en',
    resources,
    // Counts are written `{{count, number}}` in the catalogs: i18next's built-in formatter prints
    // them with `Intl.NumberFormat` for the active language ("20,000"; "20,00,000" in Gujarati,
    // Latin digits in both). Years and status codes stay plain `{{year}}`.
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}

/** Add a catalog to a running instance (a language fetched after the first paint). */
export function addCatalog(instance: I18n, language: Language, catalog: Catalog): void {
  instance.addResourceBundle(language, 'translation', catalog, true, true);
}

export function hasCatalog(instance: I18n, language: Language): boolean {
  return instance.hasResourceBundle(language, 'translation');
}
