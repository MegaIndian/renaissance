import { describe, expect, it } from 'vitest';

import { addCatalog, catalogs, createI18n, hasCatalog, resources } from '../src/i18n/index';

function keysOf(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? keysOf(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('i18n catalogs', () => {
  it('gu has every key en has', () => {
    expect(keysOf(resources.gu.translation).sort()).toEqual(
      keysOf(resources.en.translation).sort(),
    );
  });

  it('translates in both languages; a catalog can also arrive after the instance exists', () => {
    expect(createI18n('en').t('nav.home')).toBe('Home');
    expect(createI18n('gu', { catalogs }).t('nav.home')).toBe('હોમ');
    // English only until Gujarati is added: the fallback shows English, then the real strings.
    const late = createI18n('gu');
    expect(hasCatalog(late, 'gu')).toBe(false);
    expect(late.t('nav.home')).toBe('Home');
    addCatalog(late, 'gu', catalogs.gu);
    expect(hasCatalog(late, 'gu')).toBe(true);
    expect(late.t('nav.home')).toBe('હોમ');
  });

  it('interpolates names in Latin letters', () => {
    const gu = createI18n('gu', { catalogs });
    expect(
      gu.t('home.greetingWithName', { greeting: gu.t('home.greetingEvening'), name: 'Sahil' }),
    ).toBe('શુભ સાંજ, Sahil');
  });

  it('groups counts for the language, Latin digits in both, and still picks the plural form', () => {
    const en = createI18n('en');
    expect(en.t('library.tracksCount', { count: 20000 })).toBe('20,000 songs');
    expect(en.t('library.tracksCount', { count: 1 })).toBe('1 song');
    expect(en.t('library.syncing', { done: 12000, total: 20000, kind: 'songs' })).toContain(
      '12,000',
    );
    const gu = createI18n('gu', { catalogs });
    expect(gu.t('library.albumsCount', { count: 2000000 })).toContain('20,00,000');
    expect(gu.t('library.artistsCount', { count: 1 })).toContain('1 ');
    expect(en.t('library.yearTracks', { year: 2014 })).not.toContain('2,014');
  });
});
