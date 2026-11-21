import { describe, expect, it } from 'vitest';

import {
  QueueStateSchema,
  emptyQueue,
  jumpTo,
  move,
  next,
  parseQueue,
  peekNext,
  previous,
  removeAt,
  replace,
  setRepeat,
  setShuffle,
} from '../src/queue';
import { track } from './fixtures';

const ids = (state: { items: { id: string }[] }) => state.items.map((t) => t.id);
const base = replace(
  emptyQueue,
  ['1', '2', '3', '4'].map((id) => track(id)),
);

describe('jumpTo', () => {
  it('moves to a position and remembers where it came from', () => {
    const jumped = jumpTo(base, 2);
    expect(jumped.index).toBe(2);
    expect(previous(jumped).index).toBe(0);
    expect(jumpTo(base, 9)).toBe(base);
    expect(jumpTo(base, 0)).toBe(base);
  });
});

describe('removeAt', () => {
  it('removes a later, earlier and the current copy, keeping the index on the same track', () => {
    const at2 = jumpTo(base, 2);
    expect(ids(removeAt(at2, 3))).toEqual(['1', '2', '3']);
    expect(removeAt(at2, 3).index).toBe(2);
    const earlier = removeAt(at2, 0);
    expect(ids(earlier)).toEqual(['2', '3', '4']);
    expect(earlier.index).toBe(1);
    const current = removeAt(at2, 2);
    expect(ids(current)).toEqual(['1', '2', '4']);
    expect(current.index).toBe(2);
    expect(current.history).toEqual([0]);
    const last = removeAt(jumpTo(base, 3), 3);
    expect(last.index).toBe(2);
    expect(removeAt(base, 7)).toBe(base);
    expect(removeAt(removeAt(removeAt(removeAt(base, 0), 0), 0), 0).index).toBe(-1);
  });

  it('keeps order and orderKeys aligned', () => {
    const removed = removeAt(base, 1);
    expect(removed.order.map((t) => t.id)).toEqual(['1', '3', '4']);
    expect(removed.orderKeys).toEqual(removed.keys);
  });
});

describe('move', () => {
  it('reorders the play order and the added order when shuffle is off', () => {
    const moved = move(jumpTo(base, 1), 3, 0);
    expect(ids(moved)).toEqual(['4', '1', '2', '3']);
    expect(moved.order.map((t) => t.id)).toEqual(['4', '1', '2', '3']);
    expect(moved.index).toBe(2);
    expect(move(base, 0, 0)).toBe(base);
    expect(move(base, -1, 2)).toBe(base);
    expect(move(base, 1, 9)).toBe(base);
  });

  it('with shuffle on only the shuffled order changes, and shuffle off restores the added order', () => {
    const shuffled = setShuffle(base, true, () => 0);
    const moved = move(shuffled, 1, 3);
    expect(moved.order.map((t) => t.id)).toEqual(['1', '2', '3', '4']);
    expect(ids(setShuffle(moved, false))).toEqual(['1', '2', '3', '4']);
  });
});

describe('album-aware shuffle', () => {
  const albums = replace(emptyQueue, [
    track('a1', { albumId: 'A' }),
    track('a2', { albumId: 'A' }),
    track('a3', { albumId: 'A' }),
    track('b1', { albumId: 'B' }),
    track('b2', { albumId: 'B' }),
    track('s', {}),
    track('c1', { albumId: 'C' }),
  ]);

  it('finishes the current album in order, then deals whole albums', () => {
    const shuffled = setShuffle(jumpTo(albums, 1), true, () => 0.99, { albumAware: true });
    const order = ids(shuffled);
    expect(order[0]).toBe('a2');
    expect(order[1]).toBe('a3');
    expect(order.at(-1)).toBe('a1');
    const middle = order.slice(2, -1);
    const bIndex = middle.indexOf('b1');
    expect(middle[bIndex + 1]).toBe('b2');
    expect(middle).toContain('s');
    expect(middle).toContain('c1');
    expect(shuffled.albumAware).toBe(true);
  });

  it('turning album-aware on while already shuffled reshuffles; off keeps the flag', () => {
    const plain = setShuffle(albums, true, () => 0);
    const aware = setShuffle(plain, true, () => 0, { albumAware: true });
    expect(aware).not.toBe(plain);
    expect(aware.albumAware).toBe(true);
    const off = setShuffle(aware, false);
    expect(off.albumAware).toBe(true);
    expect(ids(off)).toEqual(ids(albums));
    expect(setShuffle(off, false)).toBe(off);
    const flagOnly = setShuffle(albums, false, () => 0, { albumAware: true });
    expect(flagOnly.shuffle).toBe(false);
    expect(flagOnly.albumAware).toBe(true);
  });

  it('a queue with nothing playing shuffles everything', () => {
    const shuffled = setShuffle(albums, true, () => 0.5, { albumAware: true });
    expect(ids(shuffled).sort()).toEqual(ids(albums).sort());
  });
});

describe('peekNext', () => {
  it('is what next lands on, the same track under repeat one, nothing at the end', () => {
    expect(peekNext(base)?.id).toBe('2');
    expect(peekNext(jumpTo(base, 3))).toBeUndefined();
    expect(peekNext(setRepeat(jumpTo(base, 3), 'all'))?.id).toBe('1');
    expect(peekNext(setRepeat(base, 'one'))?.id).toBe('1');
    expect(next(emptyQueue)).toBe(emptyQueue);
  });
});

describe('persistence', () => {
  it('round-trips through JSON and rejects inconsistent or garbage input', () => {
    const state = setRepeat(jumpTo(base, 2), 'all');
    const parsed = parseQueue(JSON.parse(JSON.stringify(state)));
    expect(parsed).toEqual(state);
    expect(QueueStateSchema.safeParse(state).success).toBe(true);
    expect(parseQueue(null)).toBe(emptyQueue);
    expect(parseQueue({ ...state, keys: [1] })).toBe(emptyQueue);
    expect(parseQueue({ ...state, index: 99 })).toBe(emptyQueue);
    // A stored history longer than the cap keeps its newest entries (func AA).
    const long = Array.from({ length: 500 }, (_, i) => i);
    expect(parseQueue({ ...state, history: long }).history).toEqual(long.slice(-200));
    const old = { ...state } as Record<string, unknown>;
    delete old['albumAware'];
    expect(parseQueue(old).albumAware).toBe(false);
  });
});
