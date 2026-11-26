import { describe, expect, it } from 'vitest';

import { ServerError, UnreachableError } from '@renaissance/core';

import { tracks } from '../test/fakes';
import { overlayUserData, retryUnlessNotFound } from './queries';

describe('retryUnlessNotFound', () => {
  it('asks again twice after a timeout or a server fault, never after a 404 (prod AM)', () => {
    const timeout = new UnreachableError('/Items/x', 'timeout');
    expect(retryUnlessNotFound(0, timeout)).toBe(true);
    expect(retryUnlessNotFound(1, timeout)).toBe(true);
    expect(retryUnlessNotFound(2, timeout)).toBe(false);
    expect(retryUnlessNotFound(0, new ServerError(500, '/Items/x'))).toBe(true);
    expect(retryUnlessNotFound(0, new ServerError(404, '/Items/x'))).toBe(false);
  });
});

describe('overlayUserData', () => {
  const base = { ...tracks[0]!, isFavorite: false, playCount: 1 };
  const strip = (t: typeof base) => {
    const { lastPlayed: _lastPlayed, ...rest } = t;
    return rest;
  };

  it('keeps the later last play, and a side without one counts as never played', () => {
    const server = { ...strip(base), lastPlayed: '2026-11-19T20:00:00.000Z' };
    const local = {
      ...strip(base),
      isFavorite: true,
      playCount: 4,
      lastPlayed: '2026-11-20T01:00:00.000Z',
    };
    expect(overlayUserData(server, local)).toMatchObject({
      isFavorite: true,
      playCount: 4,
      lastPlayed: '2026-11-20T01:00:00.000Z',
    });
    // The server row has no last play: the cache's value stays.
    expect(overlayUserData(strip(base), local).lastPlayed).toBe('2026-11-20T01:00:00.000Z');
    // The cache has none: the server's stays.
    expect(overlayUserData(server, strip(base)).lastPlayed).toBe('2026-11-19T20:00:00.000Z');
    // Neither has one: the row carries none.
    expect('lastPlayed' in overlayUserData(strip(base), strip(base))).toBe(false);
    // An unparseable date counts as never played too.
    expect(overlayUserData({ ...server, lastPlayed: 'soon' }, local).lastPlayed).toBe(
      '2026-11-20T01:00:00.000Z',
    );
  });
});
