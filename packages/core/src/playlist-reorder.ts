/**
 * Playlist reorder against Jellyfin (F13). `POST /Playlists/{id}/Items/{entry}/Move/{index}` does
 * not land where it says on 10.10: measured on 10.10.7 (and read in its `PlaylistManager.MoveItemAsync`),
 * the server inserts the entry *after* the item currently at `index` when moving down and after the
 * item at `index - 1` (floored at 0) when moving up. So moving down lands one slot too far, moving to
 * the top lands at 1, and position 0 and "one slot down" cannot be reached in a single call. 10.11
 * changed the arithmetic. The adapter therefore reads the playlist back after a move and, when the
 * order is not what was asked, plans compensating moves under this model and reads back again.
 */

/** Where the entry at `from` lands on a 10.10 server asked to move it to `to`, in a list of `n`. */
export function landingIndex10_10(from: number, to: number, n: number): number {
  if (to === from) return from;
  if (to > from) return Math.min(to + 1, n - 1);
  return Math.max(to, 1);
}

/** The list with the item at `from` moved so that it sits at `to`. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const [item] = out.splice(from, 1);
  if (item === undefined) return out;
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
  return out;
}

export interface PlannedMove {
  entryId: string;
  /** The index to send to the server. */
  index: number;
}

/**
 * The server calls that take the entry at `from` to `to` on a 10.10 server, with their effect
 * simulated so every intermediate list is known. At most three calls; one in the common case.
 */
export function planMoves10_10(
  entryIds: readonly string[],
  from: number,
  to: number,
): PlannedMove[] {
  const n = entryIds.length;
  const moves: PlannedMove[] = [];
  let list = [...entryIds];
  const send = (f: number, index: number): void => {
    const entryId = list[f];
    if (entryId === undefined) return;
    moves.push({ entryId, index });
    list = reorder(list, f, landingIndex10_10(f, index, n));
  };
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return [];
  if (to > from) {
    if (to === from + 1 && to < n - 1) {
      // One slot down overshoots; move the next item up instead, or go past and come back from the top row.
      if (from >= 1) send(from + 1, from);
      else {
        send(0, 1);
        send(2, 1);
      }
    } else {
      // Down by two or more lands one past the index sent; the last slot is reached by sending it.
      send(from, to >= n - 1 ? to : to - 1);
    }
  } else if (to >= 1) {
    send(from, to);
  } else {
    // Position 0 is unreachable directly: land at 1, then move the old first item down to 1.
    if (from !== 1) send(from, 0);
    if (n === 2) send(0, 1);
    else {
      send(0, 1);
      send(2, 1);
    }
  }
  return moves;
}
