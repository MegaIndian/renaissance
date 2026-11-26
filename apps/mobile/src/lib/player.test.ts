import * as Q from '@renaissance/core';
import type { Track } from '@renaissance/core';

import { getItem, resetKvForTests } from './kv';
import { forgetQueue, loadQueue, savePosition, saveQueue } from './player';

const track = (id: string): Track => ({
  id,
  title: id,
  artistIds: [],
  artistName: '',
  duration: 60,
  isFavorite: false,
  playCount: 0,
  genres: [],
});

describe('queue persistence on the phone', () => {
  beforeEach(() => resetKvForTests());

  it('saves song ids per user, restores them from the library, and forgets them on sign-out', () => {
    const tracks = [track('a'), track('b')];
    const queue = Q.replace(Q.emptyQueue, tracks, 1);
    saveQueue('u1', queue, 12.7);
    savePosition('u1', 40.2);
    const record = JSON.parse(getItem('renaissance.queue.u1') ?? '{}') as { ids: string[] };
    expect(record.ids).toEqual(['a', 'b']);
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const back = loadQueue('u1', (id) => byId.get(id));
    expect(back?.queue.index).toBe(1);
    expect(back?.position).toBe(40);
    expect(loadQueue('u2', (id) => byId.get(id))).toBeNull();
    forgetQueue('u1');
    expect(loadQueue('u1', (id) => byId.get(id))).toBeNull();
  });
});
