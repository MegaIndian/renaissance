import { describe, expect, it } from 'vitest';

import { buildQueries, cleanArtist, cleanTitle, dropLil } from '../src/fetch/clean.js';
import { hasGujarati, luceneEscape, normalize, tokenOverlap } from '../src/text.js';

describe('text helpers', () => {
  it('normalizes accents, case and punctuation', () => {
    expect(normalize('Beyoncé – Déjà Vu (feat. Jay-Z)')).toBe('beyonce deja vu feat jay z');
    expect(normalize('Taylor’s Version')).toBe('taylors version');
    expect(tokenOverlap('fireman', '03 - Fireman.mp3')).toBe(1);
    expect(tokenOverlap('', 'x')).toBe(0);
    expect(hasGujarati('ગીત વગાડ')).toBe(true);
    expect(hasGujarati('gaana vagad')).toBe(false);
    expect(luceneEscape('AC/DC: Back (in) Black?')).toBe('AC\\/DC\\: Back \\(in\\) Black\\?');
  });
});

describe('query cleaning', () => {
  it('strips features, remaster tags and punctuation from titles', () => {
    expect(cleanTitle('Fireman (feat. Nobody) - 2008 Remaster')).toBe('fireman');
    expect(cleanTitle('Drowning (Water) [Explicit]')).toBe('drowning water');
    expect(cleanTitle("Love Story (Taylor's Version)")).toBe('love story');
    expect(cleanTitle('Hello!')).toBe('hello');
  });

  it('keeps the first named artist', () => {
    expect(cleanArtist('A Boogie Wit da Hoodie feat. Kodak Black')).toBe('a boogie wit da hoodie');
    expect(cleanArtist('Simon & Garfunkel')).toBe('simon');
    expect(cleanArtist('Lil Wayne')).toBe('lil wayne');
  });

  it('drops a leading Lil', () => {
    expect(dropLil('lil wayne')).toBe('wayne');
    expect(dropLil("Lil' Kim")).toBe('kim');
    expect(dropLil('Lily Allen')).toBeUndefined();
    expect(dropLil('Wayne')).toBeUndefined();
  });

  it('builds the alternatives in order: artist title, no-Lil, title album, title alone', () => {
    expect(buildQueries({ title: 'Fireman', artist: 'Lil Wayne', album: 'Tha Carter II' })).toEqual(
      ['lil wayne fireman', 'wayne fireman', 'fireman tha carter ii', 'fireman'],
    );
    expect(buildQueries({ title: 'Drowning', artist: 'A Boogie Wit da Hoodie' })).toEqual([
      'a boogie wit da hoodie drowning',
      'drowning',
    ]);
    // Album named like the title adds nothing new.
    expect(buildQueries({ title: 'Fearless', artist: 'Taylor Swift', album: 'Fearless' })).toEqual([
      'taylor swift fearless',
      'fearless',
    ]);
  });
});
