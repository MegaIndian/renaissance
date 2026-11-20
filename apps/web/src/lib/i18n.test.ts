import { defaultSettings } from '@renaissance/core';
import { hasCatalog } from '@renaissance/core/i18n';
import { afterEach, describe, expect, it } from 'vitest';

import { catalogLoaders, detectLanguage, i18n, setLanguage } from './i18n';
import { applyDocumentAttributes, effectiveMode } from './settings';
import { toastStore } from './toast';

const realLoader = catalogLoaders.gu;

describe('language detection', () => {
  it('prefers the URL, then storage, then the browser, and falls back to English', () => {
    expect(detectLanguage('?lang=gu', 'en', 'en-US')).toBe('gu');
    expect(detectLanguage('', 'gu', 'en-US')).toBe('gu');
    expect(detectLanguage('', null, 'gu-IN')).toBe('gu');
    expect(detectLanguage('', null, 'fr-FR')).toBe('en');
    expect(detectLanguage('?lang=xx', 'yy', 'zz')).toBe('en');
  });

  afterEach(async () => {
    catalogLoaders.gu = realLoader;
    await setLanguage('en');
    toastStore.set(null);
  });

  it('html lang, the strings and the stored choice change together once the Gujarati chunk is in', async () => {
    expect(document.documentElement.lang).toBe(i18n.language);
    // Hold the chunk back: nothing changes until it lands, so no English is spoken under lang="gu".
    let release: () => void = () => undefined;
    catalogLoaders.gu = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => realLoader());
    const switched = setLanguage('gu');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('renaissance.language')).not.toBe('gu');
    expect(i18n.t('nav.home')).toBe('Home');
    release();
    await expect(switched).resolves.toBe(true);
    expect(document.documentElement.lang).toBe('gu');
    expect(localStorage.getItem('renaissance.language')).toBe('gu');
    expect(i18n.t('nav.home')).toBe('હોમ');
    await setLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.t('nav.home')).toBe('Home');
    // Already loaded: switching back is immediate.
    void setLanguage('gu');
    expect(i18n.t('nav.home')).toBe('હોમ');
    expect(document.documentElement.lang).toBe('gu');
  });

  it('a chunk that cannot be fetched leaves lang, strings and the stored choice alone and says so once', async () => {
    catalogLoaders.gu = () =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
    // An earlier test fetched the catalog: drop it so this switch has to fetch and fails.
    if (hasCatalog(i18n, 'gu')) i18n.removeResourceBundle('gu', 'translation');
    await setLanguage('en');
    localStorage.setItem('renaissance.language', 'en');
    const result = setLanguage('gu');
    await expect(result).resolves.toBe(false);
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('renaissance.language')).toBe('en');
    expect(i18n.t('nav.home')).toBe('Home');
    expect(toastStore.get()?.message).toBe('That did not work. Try again.');
    expect(toastStore.get()?.tone).toBe('danger');
  });
});

describe('document attributes', () => {
  it('defaults to simple mode and the system theme; the URL overrides for one visit', () => {
    expect(applyDocumentAttributes(defaultSettings, '')).toEqual({
      mode: 'simple',
      theme: 'system',
    });
    expect(document.documentElement.dataset['mode']).toBe('simple');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(applyDocumentAttributes(defaultSettings, '?theme=light&mode=advanced')).toEqual({
      mode: 'advanced',
      theme: 'light',
    });
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(
      applyDocumentAttributes({ ...defaultSettings, mode: 'advanced', theme: 'dark' }, ''),
    ).toEqual({
      mode: 'advanced',
      theme: 'dark',
    });
    expect(effectiveMode({ ...defaultSettings, mode: 'advanced' }, '?mode=simple')).toBe('simple');
    expect(effectiveMode(defaultSettings, '?mode=bogus')).toBe('simple');
  });
});
