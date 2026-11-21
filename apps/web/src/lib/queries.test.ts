import { describe, expect, it } from 'vitest';

import { tracks } from '../test/fakes';
import { overlayUserData } from './queries';

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
