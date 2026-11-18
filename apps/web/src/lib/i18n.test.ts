import { defaultSettings } from '@renaissance/core';
import { describe, expect, it } from 'vitest';

import { detectLanguage, i18n, setLanguage } from './i18n';
import { applyDocumentAttributes, effectiveMode } from './settings';

describe('language detection', () => {
  it('prefers the URL, then storage, then the browser, and falls back to English', () => {
    expect(detectLanguage('?lang=gu', 'en', 'en-US')).toBe('gu');
    expect(detectLanguage('', 'gu', 'en-US')).toBe('gu');
    expect(detectLanguage('', null, 'gu-IN')).toBe('gu');
    expect(detectLanguage('', null, 'fr-FR')).toBe('en');
    expect(detectLanguage('?lang=xx', 'yy', 'zz')).toBe('en');
  });

  it('sets html lang on load and on change, and fetches the Gujarati catalog once when switched', async () => {
    expect(document.documentElement.lang).toBe(i18n.language);
    const switched = setLanguage('gu');
    expect(document.documentElement.lang).toBe('gu');
    await switched;
    expect(i18n.t('nav.home')).toBe('હોમ');
    await setLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.t('nav.home')).toBe('Home');
    // Already loaded: switching back is immediate.
    void setLanguage('gu');
    expect(i18n.t('nav.home')).toBe('હોમ');
    await setLanguage('en');
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
