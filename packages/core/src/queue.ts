/**
 * Queue: a pure state machine. Every transition returns a new state so apps can store it anywhere.
 * Shuffle and repeat semantics are fixed here once for web and mobile.
 *
 * `items` is the play order; `order` is the order the tracks were added, kept so turning shuffle off
 * restores it. Every queued copy of a track gets its own key (`keys` runs alongside `items`,
 * `orderKeys` alongside `order`), and history, shuffle and "play next" bookkeeping compare keys, never
 * track objects, so the same track may sit in the queue twice and a fresh copy of a track is never
 * mistaken for the one that played.
 */
import type { Track } from './models';

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  /** Tracks in play order; `index` points into this list. */
  items: Track[];
  index: number;
  /** The same tracks in the order they were added; what `setShuffle(false)` restores. */
  order: Track[];
  /** One key per queued copy, aligned with `items`. */
  keys: number[];
  /** The same keys aligned with `order`. */
  orderKeys: number[];
  /** Keys of the copies that finished or were skipped by `next`, oldest first, capped at 200. */
  history: number[];
  /** The next unused key. */
  nextKey: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

const HISTORY_LIMIT = 200;

export const emptyQueue: QueueState = {
  items: [],
  index: -1,
  order: [],
  keys: [],
  orderKeys: [],
  history: [],
  nextKey: 0,
  shuffle: false,
  repeat: 'off',
};

export function current(state: QueueState): Track | undefined {
  return state.items[state.index];
}

export function upNext(state: QueueState): Track[] {
  return state.index < 0 ? state.items : state.items.slice(state.index + 1);
}

/** The tracks `history` refers to, oldest first; a key whose copy was removed is skipped. */
export function playedBefore(state: QueueState): Track[] {
  return state.history.flatMap((key) => {
    const track = state.items[state.keys.indexOf(key)];
    return track ? [track] : [];
  });
}

function mint(state: QueueState, count: number): { keys: number[]; nextKey: number } {
  const keys = Array.from({ length: count }, (_, i) => state.nextKey + i);
  return { keys, nextKey: state.nextKey + count };
}

/**
 * Replace the whole queue. Shuffle stays on if it was on; the chosen track still plays first. The
 * history is the old queue's, so it is dropped: nothing in the new queue has played yet.
 */
export function replace(
  state: QueueState,
  tracks: Track[],
  startAt = 0,
  random: () => number = Math.random,
): QueueState {
  const { keys, nextKey } = mint(state, tracks.length);
  const next: QueueState = {
    ...state,
    items: [...tracks],
    order: [...tracks],
    keys,
    orderKeys: [...keys],
    history: [],
    nextKey,
    index: tracks.length ? Math.min(Math.max(startAt, 0), tracks.length - 1) : -1,
  };
  return state.shuffle ? shuffleItems(next, random) : next;
}

function splice<T>(list: T[], at: number, inserted: T[]): T[] {
  return [...list.slice(0, at), ...inserted, ...list.slice(at)];
}

/** Insert after the current track in both the play order and the added order. */
export function playNext(state: QueueState, tracks: Track[]): QueueState {
  if (tracks.length === 0) return state;
  const { keys, nextKey } = mint(state, tracks.length);
  const at = state.index + 1;
  const playingKey = state.keys[state.index];
  const orderAt = playingKey === undefined ? 0 : state.orderKeys.indexOf(playingKey) + 1;
  return {
    ...state,
    items: splice(state.items, at, tracks),
    keys: splice(state.keys, at, keys),
    order: splice(state.order, orderAt, tracks),
    orderKeys: splice(state.orderKeys, orderAt, keys),
    nextKey,
    index: state.index < 0 ? 0 : state.index,
  };
}

export function addToEnd(state: QueueState, tracks: Track[]): QueueState {
  if (tracks.length === 0) return state;
  const { keys, nextKey } = mint(state, tracks.length);
  return {
    ...state,
    items: [...state.items, ...tracks],
    keys: [...state.keys, ...keys],
    order: [...state.order, ...tracks],
    orderKeys: [...state.orderKeys, ...keys],
    nextKey,
    index: state.index < 0 ? 0 : state.index,
  };
}

/** Empty the queue, history included; only the modes survive. */
export function clear(state: QueueState): QueueState {
  return { ...emptyQueue, shuffle: state.shuffle, repeat: state.repeat };
}

export function setRepeat(state: QueueState, repeat: RepeatMode): QueueState {
  return { ...state, repeat };
}

/** Deterministic Fisher-Yates over every position but the current one, which stays first. */
function shuffleItems(state: QueueState, random: () => number): QueueState {
  const positions = state.items.map((_, i) => i).filter((i) => i !== state.index);
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = positions[i];
    const b = positions[j];
    if (a !== undefined && b !== undefined) {
      positions[i] = b;
      positions[j] = a;
    }
  }
  const playing = state.index >= 0 ? [state.index] : [];
  const rest = [...playing, ...positions];
  return {
    ...state,
    items: rest.map((i) => state.items[i] as Track),
    keys: rest.map((i) => state.keys[i] as number),
    index: playing.length ? 0 : -1,
    shuffle: true,
  };
}

/**
 * Shuffle on: the current track stays first and the rest are shuffled with the injected random
 * source so tests are stable. Shuffle off: the added order comes back with the same copy playing.
 */
export function setShuffle(
  state: QueueState,
  shuffle: boolean,
  random: () => number = Math.random,
): QueueState {
  if (shuffle === state.shuffle) return state;
  if (shuffle) return shuffleItems(state, random);
  const playingKey = state.keys[state.index];
  const index = playingKey === undefined ? -1 : state.orderKeys.indexOf(playingKey);
  return { ...state, items: [...state.order], keys: [...state.orderKeys], index, shuffle: false };
}

function remember(history: number[], key: number): number[] {
  return [...history, key].slice(-HISTORY_LIMIT);
}

export interface NextOptions {
  /**
   * True when the user pressed Next, false (the default) when the track ended. Repeat one holds the
   * track only at the end of the track; a press always moves on.
   */
  manual?: boolean;
}

/**
 * Advance. Returns the same state when nothing advances: an empty queue, the end with repeat off, or
 * repeat one when the track ended on its own.
 */
export function next(state: QueueState, { manual = false }: NextOptions = {}): QueueState {
  const playingKey = state.keys[state.index];
  if (playingKey === undefined || (state.repeat === 'one' && !manual)) return state;
  const last = state.items.length - 1;
  if (state.index < last) {
    return { ...state, index: state.index + 1, history: remember(state.history, playingKey) };
  }
  if (state.repeat === 'all')
    return { ...state, index: 0, history: remember(state.history, playingKey) };
  return state;
}

/**
 * Go back. The last copy in `history` wins when it is still queued (so shuffle and "play next" go
 * back to what actually played); otherwise the previous position; with repeat all, the end.
 */
export function previous(state: QueueState): QueueState {
  const lastKey = state.history[state.history.length - 1];
  if (lastKey !== undefined) {
    const index = state.keys.indexOf(lastKey);
    if (index >= 0 && index !== state.index) {
      return { ...state, index, history: state.history.slice(0, -1) };
    }
  }
  if (state.index > 0) return { ...state, index: state.index - 1 };
  if (state.repeat === 'all' && state.items.length) {
    return { ...state, index: state.items.length - 1 };
  }
  return state;
}
