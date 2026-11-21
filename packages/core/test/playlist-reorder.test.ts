import { describe, expect, it } from 'vitest';

import { landingIndex10_10, planMoves10_10, reorder } from '../src/playlist-reorder';

/**
 * Jellyfin 10.10.7's `PlaylistManager.MoveItemAsync`, line for line, over a list of entry ids where
 * every item is visible to the caller. The planner is checked against this, not against the model.
 */
export function jellyfin10_10Move(list: string[], entryId: string, newIndex: number): string[] {
  const children = [...list];
  const accessible = [...list];
  const oldIndexAccessible = accessible.indexOf(entryId);
  if (oldIndexAccessible === newIndex) return children;
  const newPriorItemIndex =
    newIndex > oldIndexAccessible ? newIndex : newIndex - 1 < 0 ? 0 : newIndex - 1;
  const newPriorItemId = accessible[newPriorItemIndex];
  const newPriorItemIndexOnAllChildren = children.indexOf(newPriorItemId as string);
  const adjustedNewIndex = newPriorItemIndexOnAllChildren + 1;
  const newList = children.filter((id) => id !== entryId);
  if (newIndex >= newList.length) newList.push(entryId);
  else newList.splice(adjustedNewIndex, 0, entryId);
  return newList;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i}`);

describe('landingIndex10_10', () => {
  it('matches what the demo server (10.10.7) did for every pair measured', () => {
    // from -> to : landed, measured on a four-entry playlist.
    const measured: [number, number, number][] = [
      [1, 0, 1],
      [2, 0, 1],
      [0, 2, 3],
      [0, 3, 3],
      [2, 1, 1],
      [3, 0, 1],
      [0, 1, 2],
      [1, 2, 3],
      [2, 3, 3],
      [3, 2, 2],
      [1, 3, 3],
      [3, 1, 1],
    ];
    for (const [from, to, landed] of measured) {
      expect(landingIndex10_10(from, to, 4), `${from}->${to}`).toBe(landed);
    }
  });

  it('agrees with the server algorithm for every pair up to eight entries', () => {
    for (let n = 2; n <= 8; n++) {
      for (let from = 0; from < n; from++) {
        for (let to = 0; to < n; to++) {
          const list = ids(n);
          const after = jellyfin10_10Move(list, `e${from}`, to);
          expect(after.indexOf(`e${from}`), `n=${n} ${from}->${to}`).toBe(
            landingIndex10_10(from, to, n),
          );
        }
      }
    }
  });
});

describe('planMoves10_10', () => {
  it('reaches every target on a 10.10 server in at most three calls, one in the common case', () => {
    let worst = 0;
    for (let n = 2; n <= 8; n++) {
      for (let from = 0; from < n; from++) {
        for (let to = 0; to < n; to++) {
          const list = ids(n);
          const wanted = reorder(list, from, to);
          const plan = planMoves10_10(list, from, to);
          let state = list;
          for (const step of plan) state = jellyfin10_10Move(state, step.entryId, step.index);
          expect(state, `n=${n} ${from}->${to}: ${JSON.stringify(plan)}`).toEqual(wanted);
          if (from === to) expect(plan).toEqual([]);
          worst = Math.max(worst, plan.length);
        }
      }
    }
    expect(worst).toBe(3);
    expect(planMoves10_10(ids(4), 3, 1)).toEqual([{ entryId: 'e3', index: 1 }]);
    expect(planMoves10_10(ids(4), 0, 2)).toEqual([{ entryId: 'e0', index: 1 }]);
  });

  it('ignores indexes outside the list', () => {
    expect(planMoves10_10(ids(3), -1, 0)).toEqual([]);
    expect(planMoves10_10(ids(3), 0, 3)).toEqual([]);
  });
});

describe('reorder', () => {
  it('moves one item and clamps the target', () => {
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(reorder(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
    expect(reorder(['a'], 5, 0)).toEqual(['a']);
  });
});
