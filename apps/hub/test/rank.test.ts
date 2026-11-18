import { describe, expect, it } from 'vitest';

import { baseName, extensionOf, parentName, rank, score } from '../src/fetch/rank.js';
import type { Candidate } from '../src/fetch/rank.js';
import { emptyPolicy, parseRules } from '../src/fetch/rules.js';
import { toCandidates } from '../src/fetch/slskd.js';

const base: Candidate = {
  username: 'u',
  filename: '@@abc\\Music\\Lil Wayne\\Tha Carter II\\03 - Fireman.flac',
  size: 30_000_000,
  extension: 'flac',
  length: 183,
  hasFreeUploadSlot: true,
  queueLength: 0,
  uploadSpeed: 2_000_000,
};
const want = { title: 'Fireman', artist: 'Lil Wayne', duration: 183, policy: emptyPolicy() };

describe('path helpers', () => {
  it('splits slskd paths on backslashes and slashes', () => {
    expect(baseName(base.filename)).toBe('03 - Fireman.flac');
    expect(parentName(base.filename)).toBe('Tha Carter II');
    expect(parentName('solo.mp3')).toBe('');
    const { extension: _ext, ...noExtension } = base;
    expect(extensionOf({ ...noExtension, filename: 'a/b/x.MP3' })).toBe('mp3');
  });
});

describe('score', () => {
  it('rewards a matching lossless file with a free slot', () => {
    const r = score(base, want).scored!;
    expect(r.score).toBe(15 + 40 + 25 + 15 + 3 + 10);
    expect(r.reasons).toEqual([
      'title 100% in name',
      'duration matches',
      'flac',
      'free slot',
      'artist in path',
    ]);
  });

  it('grades mp3 by bitrate and penalises queues', () => {
    expect(score({ ...base, extension: 'mp3', bitRate: 320 }, want).scored!.score).toBe(
      15 + 40 + 20 + 15 + 3 + 10,
    );
    expect(
      score(
        {
          ...base,
          extension: 'mp3',
          bitRate: 256,
          hasFreeUploadSlot: false,
          queueLength: 50,
          uploadSpeed: 0,
        },
        want,
      ).scored!.score,
    ).toBe(15 + 40 + 12 - 20 + 10);
    expect(score({ ...base, extension: 'mp3', bitRate: 192 }, want).scored!.score).toBe(
      15 + 40 + 5 + 15 + 3 + 10,
    );
    expect(score({ ...base, extension: 'mp3', bitRate: 128 }, want).scored!.score).toBe(
      15 + 40 - 10 + 15 + 3 + 10,
    );
    expect(score({ ...base, extension: 'mp3' }, want).scored!.reasons).toContain('mp3');
  });

  it('excludes locked, non-audio, wrong-title and far-off durations', () => {
    expect(score({ ...base, isLocked: true }, want).excluded).toBe('locked');
    expect(score({ ...base, extension: 'jpg' }, want).excluded).toMatch(/not audio/);
    expect(
      score({ ...base, filename: 'x\\Tha Carter II\\04 - Hustler Musik.flac' }, want).excluded,
    ).toBe('title not in file name');
    expect(score({ ...base, length: 200 }, want).excluded).toBe('duration off by 17 s');
    expect(score({ ...base, length: 190 }, want).scored!.reasons).toContain('duration off by 7 s');
    expect(score({ ...base, length: 0 }, want).scored!.reasons).not.toContain('duration matches');
  });

  it('penalises live, remix and sped up versions unless asked for, and excludes them under a rule', () => {
    const live = { ...base, filename: 'x\\Lil Wayne\\03 - Fireman (Live).flac' };
    expect(score(live, want).scored!.score).toBe(15 + 40 + 25 + 15 + 3 + 10 - 30);
    expect(score(live, { ...want, policy: parseRules(['no live versions']) }).excluded).toBe(
      'rule: no live',
    );
    expect(score(live, { ...want, title: 'Fireman Live' }).scored!.reasons).not.toContain(
      'live in name',
    );
    const explicit = { ...base, filename: 'x\\Lil Wayne\\03 - Fireman (Explicit).flac' };
    expect(score(explicit, want).scored!.score).toBe(15 + 40 + 25 + 15 + 3 + 10);
  });

  it('follows the lossless and small-file preferences', () => {
    expect(
      score(base, { ...want, policy: { ...emptyPolicy(), preferLossless: true } }).scored!.score,
    ).toBe(15 + 40 + 35 + 15 + 3 + 10);
    expect(
      score(base, { ...want, policy: { ...emptyPolicy(), preferSmall: true } }).scored!.score,
    ).toBe(15 + 40 + 5 + 15 + 3 + 10);
    expect(
      score(
        { ...base, extension: 'mp3', bitRate: 320 },
        { ...want, policy: { ...emptyPolicy(), preferSmall: true } },
      ).scored!.score,
    ).toBe(15 + 40 + 25 + 15 + 3 + 10);
  });
});

describe('rank', () => {
  it('orders by score, then size, then name, and reports exclusions', () => {
    const mp3 = { ...base, filename: 'x\\Lil Wayne\\Fireman.mp3', extension: 'mp3', bitRate: 320 };
    const bigger = { ...base, size: base.size + 1, filename: 'x\\Lil Wayne\\b - Fireman.flac' };
    const locked = { ...base, isLocked: true, filename: 'x\\Fireman.flac' };
    const { ranked, excluded } = rank([mp3, base, locked, bigger], want);
    expect(ranked.map((r) => r.candidate.filename)).toEqual([
      bigger.filename,
      base.filename,
      mp3.filename,
    ]);
    expect(excluded).toEqual([{ filename: locked.filename, reason: 'locked' }]);
  });

  it('flattens slskd responses into candidates', () => {
    const c = toCandidates([
      {
        username: 'a',
        hasFreeUploadSlot: true,
        uploadSpeed: 1,
        queueLength: 0,
        files: [
          {
            filename: 'f.flac',
            size: 1,
            extension: 'flac',
            bitRate: 900,
            length: 10,
            isLocked: false,
          },
        ],
      },
      {
        username: 'b',
        hasFreeUploadSlot: false,
        uploadSpeed: 1,
        queueLength: 2,
        files: [{ filename: 'g.mp3', size: 2 }],
      },
    ]);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({
      username: 'a',
      extension: 'flac',
      bitRate: 900,
      length: 10,
      isLocked: false,
    });
    expect(c[1]).toEqual({
      username: 'b',
      filename: 'g.mp3',
      size: 2,
      hasFreeUploadSlot: false,
      queueLength: 2,
      uploadSpeed: 1,
    });
  });
});
