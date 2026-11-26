import { describe, expect, it } from 'vitest';

import { parseRules } from '../src/fetch/rules.js';

describe('parseRules', () => {
  it('turns "no live versions" into an exclusion', () => {
    expect(parseRules(['No live versions'])).toEqual({
      exclude: ['live'],
      preferLossless: false,
      preferSmall: false,
      unknown: [],
    });
  });

  it('reads several words and phrasings', () => {
    const p = parseRules([
      "I don't want remixes or karaoke tracks",
      'skip the sped up ones',
      'prefer flac',
      'mp3 is fine',
    ]);
    expect(p.exclude).toEqual(['remix', 'karaoke', 'sped up']);
    expect(p.preferLossless).toBe(true);
    expect(p.preferSmall).toBe(true);
    expect(p.unknown).toEqual([]);
  });

  it('keeps rules it cannot read as unknown', () => {
    const p = parseRules(['Dad likes the 80s Bollywood ones', 'live']);
    expect(p.exclude).toEqual([]);
    expect(p.unknown).toEqual(['Dad likes the 80s Bollywood ones', 'live']);
  });
});
