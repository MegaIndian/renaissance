import { resources } from '@renaissance/core/i18n';
import { describe, expect, it } from 'vitest';

describe('web i18n wiring', () => {
  it('ships both languages', () => {
    expect(Object.keys(resources)).toEqual(['en', 'gu']);
  });
});
