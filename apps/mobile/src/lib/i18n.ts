import AsyncStorage from '@react-native-async-storage/async-storage';
import { createI18n, isLanguage } from '@renaissance/core/i18n';
import type { Language } from '@renaissance/core/i18n';
import { getLocales } from 'expo-localization';

const STORAGE_KEY = 'renaissance.language';

/** The device locale, used until the stored choice (if any) is read. */
function detectLanguage(): Language {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return isLanguage(code) ? code : 'en';
}

/** One instance, initialised once by core; React reads it through I18nextProvider in app/_layout.tsx. */
export const i18n = createI18n(detectLanguage());

/**
 * The stored choice wins over the device locale, as on web (`localStorage` there). Resolves once the
 * store has been read, so the root layout can hold the first paint until the right language is set.
 */
export async function restoreLanguage(): Promise<Language> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && isLanguage(stored) && stored !== i18n.language) {
      await i18n.changeLanguage(stored);
    }
  } catch {
    /* storage unavailable: the device locale stands for this launch */
  }
  return isLanguage(i18n.language) ? i18n.language : 'en';
}

/** Switch now and remember it for the next launch. */
export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language);
  AsyncStorage.setItem(STORAGE_KEY, language).catch(() => {
    /* storage unavailable: the choice lasts the session */
  });
}
