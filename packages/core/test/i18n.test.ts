import { describe, expect, it } from 'vitest';

import { createI18n, resources } from '../src/i18n/index';

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

  it('translates in both languages', () => {
    expect(createI18n('en').t('nav.home')).toBe('Home');
    expect(createI18n('gu').t('nav.home')).toBe('હોમ');
  });

  it('interpolates names in Latin letters', () => {
    expect(createI18n('gu').t('home.greeting', { name: 'Sahil' })).toContain('Sahil');
  });
});
