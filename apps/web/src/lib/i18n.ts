import { createI18n, isLanguage } from '@renaissance/core/i18n';
import { initReactI18next } from 'react-i18next';

function detectLanguage(): 'en' | 'gu' {
  const stored = safeGet('renaissance.language');
  if (stored && isLanguage(stored)) return stored;
  const fromBrowser = navigator.language.split('-')[0] ?? 'en';
  return isLanguage(fromBrowser) ? fromBrowser : 'en';
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const i18n = createI18n(detectLanguage());
i18n.use(initReactI18next);
void i18n.init();

export function setLanguage(language: 'en' | 'gu'): void {
  void i18n.changeLanguage(language);
  try {
    localStorage.setItem('renaissance.language', language);
  } catch {
    /* private window: the choice lasts the session */
  }
  document.documentElement.lang = language;
}
