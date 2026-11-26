/* global jest */
/**
 * react-native-track-player in memory: a queue of items with an active index, the calls recorded,
 * and `emit` to fire the native events the port listens to.
 */
const listeners = new Map();
const state = { queue: [], active: undefined, calls: [] };

function record(name, ...args) {
  state.calls.push([name, ...args]);
}

const TrackPlayer = {
  setupPlayer: jest.fn(() => Promise.resolve()),
  updateOptions: jest.fn(() => Promise.resolve()),
  registerPlaybackService: jest.fn(),
  addEventListener: jest.fn((event, listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
    return { remove: () => listeners.get(event).delete(listener) };
  }),
  reset: jest.fn(() => {
    record('reset');
    state.queue = [];
    state.active = undefined;
    return Promise.resolve();
  }),
  add: jest.fn((track) => {
    record('add', track.url);
    state.queue.push(track);
    if (state.active === undefined) state.active = 0;
    return Promise.resolve();
  }),
  removeUpcomingTracks: jest.fn(() => {
    record('removeUpcoming');
    if (state.active !== undefined) state.queue = state.queue.slice(0, state.active + 1);
    return Promise.resolve();
  }),
  remove: jest.fn((indexes) => {
    record('remove', indexes);
    const drop = new Set(indexes);
    const activeTrack = state.queue[state.active];
    state.queue = state.queue.filter((_, i) => !drop.has(i));
    state.active = activeTrack ? state.queue.indexOf(activeTrack) : undefined;
    return Promise.resolve();
  }),
  skipToNext: jest.fn(() => {
    record('skipToNext');
    state.active = (state.active ?? -1) + 1;
    return Promise.resolve();
  }),
  getActiveTrackIndex: jest.fn(() => Promise.resolve(state.active)),
  play: jest.fn(() => {
    record('play');
    return Promise.resolve();
  }),
  pause: jest.fn(() => {
    record('pause');
    return Promise.resolve();
  }),
  seekTo: jest.fn((s) => {
    record('seek', s);
    return Promise.resolve();
  }),
  setVolume: jest.fn((v) => {
    record('volume', v);
    return Promise.resolve();
  }),
};

const Event = {
  PlaybackState: 'playback-state',
  PlaybackError: 'playback-error',
  PlaybackQueueEnded: 'playback-queue-ended',
  PlaybackActiveTrackChanged: 'playback-active-track-changed',
  PlaybackProgressUpdated: 'playback-progress-updated',
};

const State = {
  None: 'none',
  Ready: 'ready',
  Playing: 'playing',
  Paused: 'paused',
  Stopped: 'stopped',
  Loading: 'loading',
  Buffering: 'buffering',
  Error: 'error',
  Ended: 'ended',
};

function emit(event, payload) {
  for (const listener of listeners.get(event) ?? []) listener(payload);
}

function resetMock() {
  state.queue = [];
  state.active = undefined;
  state.calls = [];
}

module.exports = { __esModule: true, default: TrackPlayer, Event, State, emit, state, resetMock };
