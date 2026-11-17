import { describe, expect, it } from 'vitest';

import type { Track } from '../src/models';
import {
  addToEnd,
  clear,
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
const ids = (list: Track[]): string[] => list.map((t) => t.id);

describe('queue', () => {
  it('starts empty and stays empty on next and previous', () => {
    expect(current(emptyQueue)).toBeUndefined();
    expect(upNext(emptyQueue)).toEqual([]);
    expect(next(emptyQueue)).toBe(emptyQueue);
    expect(previous(emptyQueue)).toBe(emptyQueue);
  });

  it('replaces and walks forward', () => {
    let q = replace(emptyQueue, tracks);
    expect(current(q)?.id).toBe('1');
    q = next(q);
    expect(current(q)?.id).toBe('2');
    expect(ids(upNext(q))).toEqual(['3', '4']);
    expect(ids(q.history)).toEqual(['1']);
  });

  it('clamps the start position', () => {
    expect(replace(emptyQueue, tracks, 99).index).toBe(3);
    expect(replace(emptyQueue, tracks, -5).index).toBe(0);
    expect(replace(emptyQueue, []).index).toBe(-1);
  });

  it('stops at the end with repeat off and wraps with repeat all', () => {
    let q = replace(emptyQueue, tracks, 3);
    expect(current(next(q))?.id).toBe('4');
    q = setRepeat(q, 'all');
    expect(current(next(q))?.id).toBe('1');
    expect(current(previous(replace(q, tracks, 0)))?.id).toBe('4');
  });

  it('at the end with repeat off, next returns the same state and history does not grow', () => {
    const q = replace(emptyQueue, tracks, 3);
    const again = next(q);
    expect(again).toBe(q);
    expect(next(next(again)).history).toEqual([]);
  });

  it('repeat one stays put without touching history', () => {
    const q = setRepeat(replace(emptyQueue, tracks, 1), 'one');
    expect(next(q)).toBe(q);
    expect(current(next(q))?.id).toBe('2');
  });

  it('play next inserts after the current track; add to end appends; both keep the added order', () => {
    let q = replace(emptyQueue, tracks.slice(0, 2));
    q = playNext(q, [track('9')]);
    expect(ids(q.items)).toEqual(['1', '9', '2']);
    expect(ids(q.order)).toEqual(['1', '9', '2']);
    q = addToEnd(q, [track('8')]);
    expect(ids(q.items)).toEqual(['1', '9', '2', '8']);
    expect(ids(q.order)).toEqual(['1', '9', '2', '8']);
    expect(playNext(q, [])).toBe(q);
    expect(addToEnd(q, [])).toBe(q);
  });

  it('adding to an empty queue starts at the first track', () => {
    expect(current(addToEnd(emptyQueue, [track('5')]))?.id).toBe('5');
    expect(current(playNext(emptyQueue, [track('6')]))?.id).toBe('6');
  });

  it('shuffle keeps the current track first and every track once', () => {
    const q = setShuffle(replace(emptyQueue, tracks, 2), true, () => 0.5);
    expect(current(q)?.id).toBe('3');
    expect([...ids(q.items)].sort()).toEqual(['1', '2', '3', '4']);
    expect(q.shuffle).toBe(true);
    expect(ids(q.order)).toEqual(['1', '2', '3', '4']);
  });

  it('shuffle off restores the added order with the same track playing', () => {
    let q = setShuffle(replace(emptyQueue, tracks, 2), true, () => 0.1);
    q = next(q);
    const playing = current(q);
    q = setShuffle(q, false);
    expect(ids(q.items)).toEqual(['1', '2', '3', '4']);
    expect(current(q)).toBe(playing);
    expect(q.shuffle).toBe(false);
    expect(setShuffle(q, false)).toBe(q);
  });

  it('keeps a track that is queued twice when shuffling', () => {
    const twice = [tracks[0], tracks[1], tracks[0]] as Track[];
    const q = setShuffle(replace(emptyQueue, twice, 0), true, () => 0);
    expect(q.items).toHaveLength(3);
    expect(ids(q.items).filter((id) => id === '1')).toHaveLength(2);
  });

  it('replacing while shuffled shuffles the new list and keeps the chosen track first', () => {
    const shuffled = setShuffle(replace(emptyQueue, tracks), true, () => 0.3);
    const q = replace(shuffled, tracks.slice(0, 3), 1, () => 0.7);
    expect(current(q)?.id).toBe('2');
    expect(q.shuffle).toBe(true);
    expect([...ids(q.items)].sort()).toEqual(['1', '2', '3']);
  });

  it('previous goes back through what actually played, then by position', () => {
    let q = replace(emptyQueue, tracks);
    q = next(next(q));
    expect(current(q)?.id).toBe('3');
    q = previous(q);
    expect(current(q)?.id).toBe('2');
    expect(ids(q.history)).toEqual(['1']);
    q = previous(q);
    expect(current(q)?.id).toBe('1');
    expect(q.history).toEqual([]);
    expect(previous(q)).toBe(q);
  });

  it('previous follows history across a shuffle', () => {
    let q = replace(emptyQueue, tracks);
    q = next(q);
    q = setShuffle(q, true, () => 0.9);
    q = next(q);
    const before = current(q);
    q = previous(q);
    expect(current(q)?.id).toBe('2');
    expect(current(q)).not.toBe(before);
  });

  it('clear keeps the modes only', () => {
    const q = clear(
      setRepeat(
        setShuffle(replace(emptyQueue, tracks), true, () => 0),
        'all',
      ),
    );
    expect(q.items).toEqual([]);
    expect(q.order).toEqual([]);
    expect(q.shuffle).toBe(true);
    expect(q.repeat).toBe('all');
  });
});
