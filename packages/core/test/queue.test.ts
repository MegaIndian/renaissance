import { describe, expect, it } from 'vitest';

import type { Track } from '../src/models';
import {
  addToEnd,
  current,
  emptyQueue,
  next,
  playNext,
  previous,
  replace,
  setRepeat,
  setShuffle,
  upNext,
} from '../src/queue';

const track = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artistIds: ['a1'],
  artistName: 'Artist',
  duration: 180,
  isFavorite: false,
});

const tracks = ['1', '2', '3', '4'].map(track);

describe('queue', () => {
  it('starts empty', () => {
    expect(current(emptyQueue)).toBeUndefined();
    expect(upNext(emptyQueue)).toEqual([]);
  });

  it('replaces and walks forward', () => {
    let q = replace(emptyQueue, tracks);
    expect(current(q)?.id).toBe('1');
    q = next(q);
    expect(current(q)?.id).toBe('2');
    expect(upNext(q).map((t) => t.id)).toEqual(['3', '4']);
    expect(q.history.map((t) => t.id)).toEqual(['1']);
  });

  it('stops at the end with repeat off and wraps with repeat all', () => {
    let q = replace(emptyQueue, tracks, 3);
    expect(current(next(q))?.id).toBe('4');
    q = setRepeat(q, 'all');
    expect(current(next(q))?.id).toBe('1');
    expect(current(previous(replace(q, tracks, 0)))?.id).toBe('4');
  });

  it('repeat one stays put', () => {
    const q = setRepeat(replace(emptyQueue, tracks, 1), 'one');
    expect(current(next(q))?.id).toBe('2');
  });

  it('play next inserts after the current track; add to end appends', () => {
    let q = replace(emptyQueue, tracks.slice(0, 2));
    q = playNext(q, [track('9')]);
    expect(q.items.map((t) => t.id)).toEqual(['1', '9', '2']);
    q = addToEnd(q, [track('8')]);
    expect(q.items.map((t) => t.id)).toEqual(['1', '9', '2', '8']);
  });

  it('shuffle keeps the current track first and every track once', () => {
    const q = setShuffle(replace(emptyQueue, tracks, 2), true, () => 0.5);
    expect(current(q)?.id).toBe('3');
    expect([...q.items].map((t) => t.id).sort()).toEqual(['1', '2', '3', '4']);
    expect(q.shuffle).toBe(true);
  });
});
