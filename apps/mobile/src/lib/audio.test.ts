import type { AudioEvent } from '@renaissance/core';
import TrackPlayer from 'react-native-track-player';

import { RntpAudioPort, setupPlayer } from './audio';

// The in-memory RNTP from jest.setup.js.
const rntp = jest.requireMock('react-native-track-player') as {
  Event: {
    PlaybackState: string;
    PlaybackError: string;
    PlaybackQueueEnded: string;
    PlaybackActiveTrackChanged: string;
    PlaybackProgressUpdated: string;
  };
  State: { Playing: string; Paused: string; Buffering: string; None: string };
  emit: (event: string, payload?: unknown) => void;
  state: { queue: { url: string }[]; active: number | undefined; calls: unknown[][] };
  resetMock: () => void;
};

/** Let the port's chain of RNTP calls drain. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function port() {
  const events: AudioEvent[] = [];
  const audio = new RntpAudioPort(
    (url) => ({ title: `title of ${url}` }),
    () => Promise.resolve(),
  );
  audio.on((e) => events.push(e));
  return { audio, events };
}

describe('RntpAudioPort', () => {
  beforeEach(() => rntp.resetMock());

  it('sets the player up once, and lives with a player a reload left behind', async () => {
    (TrackPlayer.setupPlayer as jest.Mock).mockRejectedValueOnce(
      new Error('The player has already been initialized via setupPlayer.'),
    );
    await setupPlayer();
    await setupPlayer();
    expect(TrackPlayer.setupPlayer).toHaveBeenCalledTimes(1);
    expect(TrackPlayer.updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({ progressUpdateEventInterval: 1 }),
    );
  });

  it('loads one stream with its title, seeks to the start position, plays, pauses, sets volume', async () => {
    const { audio } = port();
    audio.load('u1', 30);
    await audio.play();
    audio.pause();
    audio.seek(12);
    audio.setVolume(0.5);
    await flush();
    expect(rntp.state.calls).toEqual([
      ['reset'],
      ['add', 'u1'],
      ['seek', 30],
      ['play'],
      ['pause'],
      ['seek', 12],
      ['volume', 0.5],
    ]);
    expect(TrackPlayer.add).toHaveBeenCalledWith({ id: 'u1', url: 'u1', title: 'title of u1' });
    expect(audio.position()).toBe(12);
  });

  it('preloads the next stream behind the current one and replaces it when the next changes', async () => {
    const { audio } = port();
    audio.preload('ignored before a load');
    audio.load('u1');
    audio.preload('u2');
    audio.preload('u2');
    audio.preload('u3');
    audio.preload(null);
    await flush();
    expect(rntp.state.calls).toEqual([
      ['reset'],
      ['add', 'u1'],
      ['removeUpcoming'],
      ['add', 'u2'],
      ['removeUpcoming'],
      ['add', 'u3'],
      ['removeUpcoming'],
    ]);
  });

  it("RNTP moving onto the preloaded stream by itself is the song's end; takeOver adopts it", async () => {
    const { audio, events } = port();
    audio.load('u1');
    audio.preload('u2');
    await flush();
    rntp.state.active = 1;
    rntp.emit(rntp.Event.PlaybackActiveTrackChanged, {
      lastTrack: { url: 'u1' },
      track: { url: 'u2' },
      lastPosition: 100,
    });
    expect(events).toEqual([{ type: 'ended' }]);
    expect(audio.takeOver('u2')).toBe(true);
    await flush();
    // No skip: RNTP is already on it; the finished item is dropped.
    expect(rntp.state.calls.slice(-1)).toEqual([['remove', [0]]]);
    expect(rntp.state.queue.map((t) => t.url)).toEqual(['u2']);
  });

  it('Next with the next song buffered skips onto it; anything else is not adopted', async () => {
    const { audio } = port();
    expect(audio.takeOver('u2')).toBe(false);
    audio.load('u1');
    audio.preload('u2');
    expect(audio.takeOver('u3')).toBe(false);
    expect(audio.takeOver('u2')).toBe(true);
    await flush();
    expect(rntp.state.calls.slice(-2)).toEqual([['skipToNext'], ['remove', [0]]]);
  });

  it('maps progress, state and errors to core events; a queue end counts only at the end of the song', async () => {
    const { audio, events } = port();
    audio.load('u1');
    await flush();
    rntp.emit(rntp.Event.PlaybackQueueEnded, {});
    expect(events).toEqual([]);
    rntp.emit(rntp.Event.PlaybackProgressUpdated, { position: 99, duration: 100 });
    rntp.emit(rntp.Event.PlaybackState, { state: rntp.State.Playing });
    rntp.emit(rntp.Event.PlaybackState, { state: rntp.State.Buffering });
    rntp.emit(rntp.Event.PlaybackState, { state: rntp.State.Paused });
    rntp.emit(rntp.Event.PlaybackState, { state: rntp.State.None });
    rntp.emit(rntp.Event.PlaybackQueueEnded, {});
    rntp.emit(rntp.Event.PlaybackError, { code: 'x', message: '' });
    expect(events).toEqual([
      { type: 'time', position: 99, duration: 100 },
      { type: 'playing' },
      { type: 'waiting' },
      { type: 'paused' },
      { type: 'ended' },
      { type: 'error', message: 'x' },
    ]);
    expect(audio.duration()).toBe(100);
  });

  it('a stream without a duration ends at the length the song is known to have', async () => {
    const events: AudioEvent[] = [];
    const audio = new RntpAudioPort(
      () => ({ duration: 60 }),
      () => Promise.resolve(),
    );
    audio.on((e) => events.push(e));
    audio.load('u1');
    await flush();
    rntp.emit(rntp.Event.PlaybackProgressUpdated, { position: 59, duration: 0 });
    rntp.emit(rntp.Event.PlaybackQueueEnded, {});
    expect(events.at(-1)).toEqual({ type: 'ended' });
  });

  it('a change of track it did not preload is not reported as an ending', async () => {
    const { audio, events } = port();
    audio.load('u1');
    audio.preload('u2');
    await flush();
    rntp.emit(rntp.Event.PlaybackActiveTrackChanged, {
      lastTrack: { url: 'other' },
      track: { url: 'u2' },
    });
    rntp.emit(rntp.Event.PlaybackActiveTrackChanged, {
      lastTrack: { url: 'u1' },
      track: { url: 'u9' },
    });
    expect(events).toEqual([]);
  });

  it('destroy stops listening and resets the player', async () => {
    const { audio, events } = port();
    audio.load('u1');
    audio.destroy();
    await flush();
    rntp.emit(rntp.Event.PlaybackState, { state: rntp.State.Playing });
    expect(events).toEqual([]);
    expect(rntp.state.calls.at(-1)).toEqual(['reset']);
  });

  it('a failed RNTP call does not stop the calls after it', async () => {
    const { audio } = port();
    (TrackPlayer.pause as jest.Mock).mockRejectedValueOnce(new Error('nope'));
    audio.load('u1');
    audio.pause();
    await audio.play();
    expect(rntp.state.calls.at(-1)).toEqual(['play']);
  });
});
