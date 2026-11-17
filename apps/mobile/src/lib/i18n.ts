import { createI18n, isLanguage } from '@renaissance/core/i18n';
import { getLocales } from 'expo-localization';
import { initReactI18next } from 'react-i18next';

function detectLanguage(): 'en' | 'gu' {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return isLanguage(code) ? code : 'en';
}

export const i18n = createI18n(detectLanguage());
i18n.use(initReactI18next);
void i18n.init();
