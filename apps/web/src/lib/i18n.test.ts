import { describe, expect, it } from 'vitest';

import { applyDocumentAttributes } from './document';
import { detectLanguage, i18n, setLanguage } from './i18n';

describe('language detection', () => {
  it('prefers the URL, then storage, then the browser, and falls back to English', () => {
    expect(detectLanguage('?lang=gu', 'en', 'en-US')).toBe('gu');
    expect(detectLanguage('', 'gu', 'en-US')).toBe('gu');
    expect(detectLanguage('', null, 'gu-IN')).toBe('gu');
    expect(detectLanguage('', null, 'fr-FR')).toBe('en');
    expect(detectLanguage('?lang=xx', 'yy', 'zz')).toBe('en');
  });

  it('sets html lang on load and on change', () => {
    expect(document.documentElement.lang).toBe(i18n.language);
    setLanguage('gu');
    expect(document.documentElement.lang).toBe('gu');
    setLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('document attributes', () => {
  it('defaults to simple mode and the system theme; URL overrides for screenshots', () => {
    expect(applyDocumentAttributes('')).toEqual({ mode: 'simple', theme: 'system' });
    expect(document.documentElement.dataset['mode']).toBe('simple');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(applyDocumentAttributes('?theme=light&mode=advanced')).toEqual({
      mode: 'advanced',
      theme: 'light',
    });
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});
