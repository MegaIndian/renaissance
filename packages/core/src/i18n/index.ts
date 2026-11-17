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

export const resources = {
  en: { translation: en },
  gu: { translation: gu },
} as const;

export function isLanguage(value: string): value is Language {
  return (supportedLanguages as readonly string[]).includes(value);
}

export function createI18n(language: Language = 'en'): I18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng: language,
    fallbackLng: 'en',
    resources,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}
