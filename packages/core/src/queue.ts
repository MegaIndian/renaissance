/**
 * Queue: a pure state machine. Every transition returns a new state so apps can store it anywhere.
 * Shuffle and repeat semantics are fixed here once for web and mobile.
 */
import type { Track } from './models';

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  /** Tracks in play order; `index` points into this list. */
  items: Track[];
  index: number;
  history: Track[];
  shuffle: boolean;
  repeat: RepeatMode;
}

export const emptyQueue: QueueState = {
  items: [],
  index: -1,
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

export function replace(state: QueueState, tracks: Track[], startAt = 0): QueueState {
  return { ...state, items: [...tracks], index: tracks.length ? startAt : -1 };
}

export function playNext(state: QueueState, tracks: Track[]): QueueState {
  const at = state.index + 1;
  const items = [...state.items.slice(0, at), ...tracks, ...state.items.slice(at)];
  return { ...state, items, index: state.index < 0 && tracks.length ? 0 : state.index };
}

export function addToEnd(state: QueueState, tracks: Track[]): QueueState {
  const items = [...state.items, ...tracks];
  return { ...state, items, index: state.index < 0 && tracks.length ? 0 : state.index };
}

export function clear(state: QueueState): QueueState {
  return { ...emptyQueue, shuffle: state.shuffle, repeat: state.repeat };
}

export function setRepeat(state: QueueState, repeat: RepeatMode): QueueState {
  return { ...state, repeat };
}

/**
 * Deterministic Fisher-Yates with an injected random source so tests are stable.
 * Keeps the current track first.
 */
export function setShuffle(
  state: QueueState,
  shuffle: boolean,
  random: () => number = Math.random,
): QueueState {
  if (!shuffle || state.items.length < 2) return { ...state, shuffle };
  const playing = current(state);
  const rest = state.items.filter((t) => t !== playing);
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

export function next(state: QueueState): QueueState {
  const playing = current(state);
  const history = playing ? [...state.history, playing].slice(-200) : state.history;
  if (state.repeat === 'one' && playing) return { ...state, history };
  const last = state.items.length - 1;
  if (state.index < last) return { ...state, index: state.index + 1, history };
  if (state.repeat === 'all' && state.items.length) return { ...state, index: 0, history };
  return { ...state, history };
}

export function previous(state: QueueState): QueueState {
  if (state.index > 0) return { ...state, index: state.index - 1 };
  if (state.repeat === 'all' && state.items.length)
    return { ...state, index: state.items.length - 1 };
  return state;
}
