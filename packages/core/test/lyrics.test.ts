import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  LYRICS_RESUME_MS,
  LyricsFollow,
  activeLyricIndex,
  hasLrcTimings,
  lyricsFromText,
  parseLrc,
  toLyrics,
} from '../src/lyrics';

describe('parseLrc', () => {
  it('reads every time-tag form and sorts by start', () => {
    const parsed = parseLrc(
      [
        '[00:05.5]tenths',
        '[00:01.20]hundredths',
        '[00:02.345]milliseconds',
        '[00:03]whole seconds',
        '[00:04:50]colon hundredths',
        '[1:00.00]one minute',
        '[100:00.00]long mix',
      ].join('\n'),
    );
    expect(parsed.synced).toBe(true);
    expect(parsed.lines).toEqual([
      { start: 1200, text: 'hundredths' },
      { start: 2345, text: 'milliseconds' },
      { start: 3000, text: 'whole seconds' },
      { start: 4500, text: 'colon hundredths' },
      { start: 5500, text: 'tenths' },
      { start: 60_000, text: 'one minute' },
      { start: 6_000_000, text: 'long mix' },
    ]);
  });

  it('sings a line with several time tags at each of them, keeping file order on ties', () => {
    const parsed = parseLrc(
      ['[00:10.00][00:30.00]chorus', '[00:20.00]verse', '[00:30.00]after the chorus'].join('\r\n'),
    );
    expect(parsed.lines).toEqual([
      { start: 10_000, text: 'chorus' },
      { start: 20_000, text: 'verse' },
      { start: 30_000, text: 'chorus' },
      { start: 30_000, text: 'after the chorus' },
    ]);
  });

  it('applies [offset:] in both directions and never starts before zero', () => {
    const sooner = parseLrc('[offset:+500]\n[00:00.20]a\n[00:02.00]b');
    expect(sooner.offsetMs).toBe(500);
    expect(sooner.lines).toEqual([
      { start: 0, text: 'a' },
      { start: 1500, text: 'b' },
    ]);
    const later = parseLrc('[offset: -250]\r[00:01.00]a');
    expect(later.offsetMs).toBe(-250);
    expect(later.lines).toEqual([{ start: 1250, text: 'a' }]);
    expect(parseLrc('[offset:soon]\n[00:01.00]a').offsetMs).toBe(0);
  });

  it('drops ID tags, untimed lines in a timed file and word timings; keeps empty breaks', () => {
    const parsed = parseLrc(
      [
        '[ar:Someone]',
        '[ti:A song]',
        '[length: 03:20]',
        '[by:me][re:editor]',
        'stray untimed line',
        '[00:01.00]<00:01.00>word <00:01.50>by <00:02.00>word',
        '[00:03.00]',
        '[00:04.00]  spaced   out  ',
      ].join('\n'),
    );
    expect(parsed.lines).toEqual([
      { start: 1000, text: 'word by word' },
      { start: 3000, text: '' },
      { start: 4000, text: 'spaced out' },
    ]);
  });

  it('keeps bracketed text that is not a tag, and invalid times, as text', () => {
    const parsed = parseLrc('[Chorus]\n[Verse 1: someone]\n[00:75.00]not a time');
    expect(parsed.synced).toBe(false);
    expect(parsed.lines.map((l) => l.text)).toEqual([
      '[Chorus]',
      '[Verse 1: someone]',
      '[00:75.00]not a time',
    ]);
  });

  it('passes plain text through unsynced', () => {
    expect(parseLrc('one\n\ntwo')).toEqual({
      synced: false,
      offsetMs: 0,
      lines: [{ text: 'one' }, { text: '' }, { text: 'two' }],
    });
  });
});

describe('hasLrcTimings', () => {
  it('is true only when a line starts with a time tag', () => {
    expect(hasLrcTimings('[ar:x]\n  [00:01.00]a')).toBe(true);
    expect(hasLrcTimings('[ar:x]\nplain [00:01.00]')).toBe(false);
    expect(hasLrcTimings('[Chorus]\nla la')).toBe(false);
  });
});

describe('toLyrics and lyricsFromText', () => {
  it('is null when no line has text', () => {
    expect(toLyrics('t', false, [])).toBeNull();
    expect(toLyrics('t', true, [{ start: 0, text: '  ' }])).toBeNull();
    expect(lyricsFromText('t', '[ar:x]\n\n')).toBeNull();
  });

  it('trims unsynced text and keeps one blank line between verses', () => {
    expect(lyricsFromText('t', '\n\n one \n\n\n two\n\n')).toEqual({
      trackId: 't',
      synced: false,
      lines: [{ text: 'one' }, { text: '' }, { text: 'two' }],
    });
  });

  it('sorts synced lines and gives a missing start zero', () => {
    expect(
      toLyrics('t', true, [
        { start: 2000, text: ' b ' },
        { text: 'a' },
        { start: 2000, text: 'c' },
      ]),
    ).toEqual({
      trackId: 't',
      synced: true,
      lines: [
        { start: 0, text: 'a' },
        { start: 2000, text: 'b' },
        { start: 2000, text: 'c' },
      ],
    });
  });

  it('turns LRC text into synced lyrics', () => {
    const lyrics = lyricsFromText('t', '[00:02.00]b\n[00:01.00]a');
    expect(lyrics?.synced).toBe(true);
    expect(lyrics?.lines.map((l) => l.text)).toEqual(['a', 'b']);
  });
});

describe('activeLyricIndex', () => {
  const lyrics = toLyrics('t', true, [
    { start: 1000, text: 'a' },
    { start: 2000, text: 'b' },
    { start: 2000, text: 'b2' },
    { start: 5000, text: 'c' },
  ]);

  it('is the last line that has started', () => {
    expect(activeLyricIndex(lyrics, 0)).toBe(-1);
    expect(activeLyricIndex(lyrics, 999)).toBe(-1);
    expect(activeLyricIndex(lyrics, 1000)).toBe(0);
    expect(activeLyricIndex(lyrics, 1999)).toBe(0);
    expect(activeLyricIndex(lyrics, 2000)).toBe(2);
    expect(activeLyricIndex(lyrics, 4999)).toBe(2);
    expect(activeLyricIndex(lyrics, 60_000)).toBe(3);
  });

  it('is -1 for unsynced or missing lyrics', () => {
    expect(activeLyricIndex(lyricsFromText('t', 'a\nb'), 10_000)).toBe(-1);
    expect(activeLyricIndex(null, 10_000)).toBe(-1);
    expect(activeLyricIndex(undefined, 10_000)).toBe(-1);
  });
});

describe('LyricsFollow', () => {
  it('follows until the listener scrolls, then resumes a few seconds after the last scroll', () => {
    const follow = new LyricsFollow();
    expect(follow.resumeAfterMs).toBe(LYRICS_RESUME_MS);
    expect(follow.following(0)).toBe(true);
    expect(follow.resumesIn(0)).toBe(0);
    follow.pause(1000);
    expect(follow.following(1000 + LYRICS_RESUME_MS - 1)).toBe(false);
    expect(follow.resumesIn(2000)).toBe(LYRICS_RESUME_MS - 1000);
    // Another scroll restarts the wait.
    follow.pause(3000);
    expect(follow.following(1000 + LYRICS_RESUME_MS)).toBe(false);
    expect(follow.following(3000 + LYRICS_RESUME_MS)).toBe(true);
    expect(follow.resumesIn(3000 + LYRICS_RESUME_MS)).toBe(0);
  });

  it('resumes at once when asked, and the wait never goes below zero', () => {
    const follow = new LyricsFollow(100);
    follow.pause(0);
    expect(follow.resumesIn(500)).toBe(0);
    follow.resume();
    expect(follow.following(1)).toBe(true);
  });
});

describe('the demo library lyrics (docker/demo/music)', () => {
  const file = (name: string) =>
    readFileSync(new URL(`../../../docker/demo/music/${name}`, import.meta.url), 'utf8');

  it('Carefree is synced, in order, inside the song (205 s)', () => {
    const lyrics = lyricsFromText('carefree', file('Kevin MacLeod - Carefree.lrc'));
    expect(lyrics?.synced).toBe(true);
    const starts = lyrics?.lines.map((l) => l.start ?? -1) ?? [];
    expect(starts.length).toBeGreaterThan(20);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts.at(-1)).toBeLessThan(205_000);
    expect(lyrics?.lines[0]).toEqual({ start: 4000, text: 'Window open, morning light' });
  });

  it('Fluffing a Duck is plain text in three verses', () => {
    const lyrics = lyricsFromText('duck', file('Kevin MacLeod - Fluffing a Duck.txt'));
    expect(lyrics?.synced).toBe(false);
    expect(lyrics?.lines.filter((l) => !l.text)).toHaveLength(2);
  });
});
