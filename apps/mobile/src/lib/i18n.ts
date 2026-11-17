import { createI18n, isLanguage } from '@renaissance/core/i18n';
import type { Language } from '@renaissance/core/i18n';
import { getLocales } from 'expo-localization';

function detectLanguage(): Language {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return isLanguage(code) ? code : 'en';
}

/** One instance, initialised once by core; React reads it through I18nextProvider in app/_layout.tsx. */
export const i18n = createI18n(detectLanguage());

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language);
}
