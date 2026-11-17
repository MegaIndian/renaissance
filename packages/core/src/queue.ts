/**
 * Queue: a pure state machine. Every transition returns a new state so apps can store it anywhere.
 * Shuffle and repeat semantics are fixed here once for web and mobile.
 *
 * `items` is the play order; `order` is the order the tracks were added, kept so turning shuffle off
 * restores it. Tracks are compared by position, never by identity, so the same track may sit in the
 * queue twice.
 */
import type { Track } from './models';

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  /** Tracks in play order; `index` points into this list. */
  items: Track[];
  index: number;
  /** The same tracks in the order they were added; what `setShuffle(false)` restores. */
  order: Track[];
  /** Tracks that finished or were skipped by `next`, oldest first, capped at 200. */
  history: Track[];
  shuffle: boolean;
  repeat: RepeatMode;
}

const HISTORY_LIMIT = 200;

export const emptyQueue: QueueState = {
  items: [],
  index: -1,
  order: [],
  history: [],
  shuffle: false,
  repeat: 'off',
};

export function current(state: QueueState): Track | undefined {
  return state.items[state.index];
}

export function upNext(state: QueueState): Track[] {
  return state.index < 0 ? state.items : state.items.slice(state.index + 1);
}

/** Replace the whole queue. Shuffle stays on if it was on; the chosen track still plays first. */
export function replace(
  state: QueueState,
  tracks: Track[],
  startAt = 0,
  random: () => number = Math.random,
): QueueState {
  const next: QueueState = {
    ...state,
    items: [...tracks],
    order: [...tracks],
    index: tracks.length ? Math.min(Math.max(startAt, 0), tracks.length - 1) : -1,
  };
  return state.shuffle ? shuffleItems(next, random) : next;
}

export function playNext(state: QueueState, tracks: Track[]): QueueState {
  if (tracks.length === 0) return state;
  const at = state.index + 1;
  const items = [...state.items.slice(0, at), ...tracks, ...state.items.slice(at)];
  const playing = current(state);
  const orderAt = playing ? state.order.indexOf(playing) + 1 : 0;
  const order = [...state.order.slice(0, orderAt), ...tracks, ...state.order.slice(orderAt)];
  return { ...state, items, order, index: state.index < 0 ? 0 : state.index };
}

export function addToEnd(state: QueueState, tracks: Track[]): QueueState {
  if (tracks.length === 0) return state;
  return {
    ...state,
    items: [...state.items, ...tracks],
    order: [...state.order, ...tracks],
    index: state.index < 0 ? 0 : state.index,
  };
}

export function clear(state: QueueState): QueueState {
  return { ...emptyQueue, shuffle: state.shuffle, repeat: state.repeat };
}

export function setRepeat(state: QueueState, repeat: RepeatMode): QueueState {
  return { ...state, repeat };
}

/** Deterministic Fisher-Yates over every position but the current one, which stays first. */
function shuffleItems(state: QueueState, random: () => number): QueueState {
  const playing = current(state);
  const rest = state.items.filter((_, i) => i !== state.index);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = rest[i];
    const b = rest[j];
    if (a !== undefined && b !== undefined) {
      rest[i] = b;
      rest[j] = a;
    }
  }
  const items = playing ? [playing, ...rest] : rest;
  return { ...state, items, index: playing ? 0 : -1, shuffle: true };
}

/**
 * Shuffle on: the current track stays first and the rest are shuffled with the injected random
 * source so tests are stable. Shuffle off: the added order comes back with the same track playing.
 */
export function setShuffle(
  state: QueueState,
  shuffle: boolean,
  random: () => number = Math.random,
): QueueState {
  if (shuffle === state.shuffle) return state;
  if (shuffle) return shuffleItems(state, random);
  const playing = current(state);
  const index = playing ? state.order.indexOf(playing) : -1;
  return { ...state, items: [...state.order], index, shuffle: false };
}

function remember(history: Track[], track: Track): Track[] {
  return [...history, track].slice(-HISTORY_LIMIT);
}

/** Advance. Returns the same state when nothing advances (empty, repeat one, or the end with repeat off). */
export function next(state: QueueState): QueueState {
  const playing = current(state);
  if (!playing || state.repeat === 'one') return state;
  const last = state.items.length - 1;
  if (state.index < last) {
    return { ...state, index: state.index + 1, history: remember(state.history, playing) };
  }
  if (state.repeat === 'all')
    return { ...state, index: 0, history: remember(state.history, playing) };
  return state;
}

/**
 * Go back. The last track in `history` wins when it is still queued (so shuffle and "play next" go
 * back to what actually played); otherwise the previous position; with repeat all, the end.
 */
export function previous(state: QueueState): QueueState {
  const last = state.history[state.history.length - 1];
  if (last) {
    const index = state.items.lastIndexOf(last);
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
