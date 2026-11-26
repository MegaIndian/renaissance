import { Player } from '@renaissance/core';
import type { PlayEvent } from '@renaissance/core';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeAudio, fakeAdapter, listen, session, tracks } from '../test/fakes';
import {
  IndexedDbListeningLogStore,
  attachHistory,
  clearHistory,
  restoreHistory,
  getListeningLog,
  historyDbName,
  historyStore,
  openHistoryStore,
  recordListen,
  resetHistoryForTests,
  setListeningSync,
  startHistory,
  stopHistory,
} from './history';

afterEach(() => {
  resetHistoryForTests();
});

describe('IndexedDbListeningLogStore', () => {
  it('lists newest first inside a window, skips records that do not parse, counts and removes', async () => {
    const name = `h-${Math.random()}`;
    const store = new IndexedDbListeningLogStore(name);
    const a = listen({ at: '2026-11-18T10:00:00.000Z' });
    const b = listen({ at: '2026-11-19T10:00:00.000Z' });
    const c = listen({ at: '2026-11-20T10:00:00.000Z' });
    await store.add([a, b, c]);
    // An older shape written by hand: read past, never fatal.
    const raw = await openDB(name);
    await raw.put('listens', { id: 'zz-bad', at: '2026-11-21T00:00:00.000Z' });
    raw.close();
    expect((await store.list()).map((e) => e.id)).toEqual([c.id, b.id, a.id]);
    expect(await store.list({ limit: 1 })).toEqual([c]);
    const from = new Date('2026-11-19T00:00:00.000Z');
    const to = new Date('2026-11-20T00:00:00.000Z');
    expect((await store.list({ from, to })).map((e) => e.id)).toEqual([b.id]);
    expect((await store.list({ from })).map((e) => e.id)).toEqual([c.id, b.id]);
    expect((await store.list({ to })).map((e) => e.id)).toEqual([b.id, a.id]);
    expect(await store.count()).toBe(4);
    await store.remove(['zz-bad']);
    expect(await store.count()).toBe(3);
    await store.close();
  });

  it('keeps sync bookkeeping and clears with what it removed', async () => {
    const store = new IndexedDbListeningLogStore(`h-${Math.random()}`);
    const a = listen({ at: '2026-11-18T10:00:00.000Z' });
    const b = listen({ at: '2026-11-19T10:00:00.000Z' });
    await store.add([b, a]);
    expect((await store.unsynced(10)).map((e) => e.id)).toEqual([a.id, b.id]);
    expect(await store.unsynced(1)).toHaveLength(1);
    await store.markSynced([a.id, 'missing'], '2026-11-21T00:00:00.000Z');
    expect((await store.unsynced(10)).map((e) => e.id)).toEqual([b.id]);
    const removed = await store.clear();
    expect(removed.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(await store.count()).toBe(0);
  });

  it('falls back to memory when the browser refuses IndexedDB', async () => {
    const spy = vi.spyOn(globalThis, 'indexedDB', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const { store, persisted } = await openHistoryStore('blocked');
    spy.mockRestore();
    expect(persisted).toBe(false);
    await store.add([listen()]);
    expect(await store.count()).toBe(1);
  });
});

describe('the web listening log', () => {
  it('opens one log per user, records plays into it, and closes on sign-out', async () => {
    await startHistory(session);
    expect(historyStore.get()).toMatchObject({ key: 'demo:u1', ready: true, count: 0 });
    const push = vi.fn(() => Promise.resolve([]));
    setListeningSync({ push });
    await recordListen(listen());
    expect(historyStore.get().count).toBe(1);
    expect(push).toHaveBeenCalledOnce();
    expect(await getListeningLog()?.playsOf('t1')).toBe(1);
    // A second start for the same user is the same log.
    await startHistory(session);
    expect(historyStore.get().count).toBe(1);
    stopHistory();
    expect(historyStore.get()).toMatchObject({ key: null, ready: false });
    expect(getListeningLog()).toBeNull();
  });

  it('a play that ends after sign-out goes to the database of the user who started it', async () => {
    const other = { ...session, userId: 'u2' };
    await startHistory(other);
    await recordListen(listen({ id: 'late', userId: 'u1' }));
    expect(historyStore.get().count).toBe(0);
    const store = new IndexedDbListeningLogStore(historyDbName('demo', 'u1'));
    expect((await store.list()).map((e) => e.id)).toContain('late');
    await store.close();
  });

  it('a record that arrives while the log is opening waits for it', async () => {
    const opening = startHistory({ ...session, userId: 'u3' });
    const recorded = recordListen(listen({ userId: 'u3' }));
    await Promise.all([opening, recorded]);
    expect(historyStore.get().count).toBe(1);
  });

  it('clear history resolves with what went, and restoring puts it back', async () => {
    await startHistory({ ...session, userId: 'u4' });
    await recordListen(listen({ userId: 'u4' }));
    await recordListen(listen({ userId: 'u4' }));
    const removed = await clearHistory();
    expect(removed).toHaveLength(2);
    expect(historyStore.get().count).toBe(0);
    await restoreHistory(removed ?? []);
    expect(historyStore.get().count).toBe(2);
  });

  it('with nothing open, clear and restore do nothing; a refused clear rejects', async () => {
    expect(await clearHistory()).toBeNull();
    await restoreHistory([listen()]);
    expect(historyStore.get().count).toBe(0);
    await startHistory({ ...session, userId: 'u5' });
    const log = getListeningLog();
    vi.spyOn(log?.store as IndexedDbListeningLogStore, 'clear').mockRejectedValueOnce(
      new Error('x'),
    );
    await expect(clearHistory()).rejects.toThrow('x');
  });

  it('follows the Player: a play is logged with this device, and nothing while the setting is off', async () => {
    const signedIn = { ...session, userId: 'u6' };
    const { adapter } = fakeAdapter();
    await startHistory(signedIn);
    const audio = new FakeAudio();
    const player = new Player({ audio, adapter, session: () => signedIn, reporter: null });
    let enabled = true;
    const onError = vi.fn();
    const detach = attachHistory(player, {
      context: () => ({ serverId: 'demo', userId: 'u6', device: 'Chrome on Mac' }),
      enabled: () => enabled,
      onError,
    });
    player.playTracks(tracks, 0, { kind: 'album', id: 'al1' });
    for (let p = 0; p <= 10; p += 0.5) audio.emit({ type: 'time', position: p, duration: 120 });
    player.next();
    await vi.waitFor(() => expect(historyStore.get().count).toBe(1));
    const [event] = (await getListeningLog()?.events()) ?? [];
    expect(event).toMatchObject({
      trackId: 't1',
      skipped: true,
      listened: 10,
      source: { kind: 'album', id: 'al1' },
      userId: 'u6',
      device: 'Chrome on Mac',
    });

    enabled = false;
    for (let p = 0; p <= 60; p += 0.5) audio.emit({ type: 'time', position: p, duration: 120 });
    player.next();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(historyStore.get().count).toBe(1);
    expect(onError).not.toHaveBeenCalled();
    detach();
  });

  it('plays the shell held while this chunk loaded are applied first', async () => {
    await startHistory({ ...session, userId: 'u7' });
    const audio = new FakeAudio();
    const { adapter } = fakeAdapter();
    const player = new Player({ audio, adapter, session: () => session, reporter: null });
    const early: PlayEvent[] = [];
    const hold = player.onPlay((e) => early.push(e));
    player.playTracks(tracks, 0);
    hold();
    attachHistory(player, {
      context: () => ({ serverId: 'demo', userId: 'u7', device: 'd' }),
      enabled: () => true,
      earlier: early,
    });
    for (let p = 0; p <= 40; p += 0.5) audio.emit({ type: 'time', position: p, duration: 120 });
    player.next();
    await vi.waitFor(() => expect(historyStore.get().count).toBe(1));
    expect((await getListeningLog()?.events())?.[0]).toMatchObject({ trackId: 't1', listened: 40 });
  });

  it('a play cut short by the page going away is stashed and lands in the log on the next start', async () => {
    const audio = new FakeAudio();
    const { adapter } = fakeAdapter();
    const player = new Player({ audio, adapter, session: () => session, reporter: null });
    const detach = attachHistory(player, {
      context: () => ({ serverId: 'demo', userId: 'u8', device: 'd' }),
      enabled: () => true,
    });
    player.playTracks(tracks, 0);
    for (let p = 0; p <= 20; p += 0.5) audio.emit({ type: 'time', position: p, duration: 120 });
    window.dispatchEvent(new Event('pagehide'));
    detach();
    // Another user's stashed play and garbage stay out of this user's log.
    const stashed = JSON.parse(localStorage.getItem('renaissance.history.pending') ?? '[]');
    localStorage.setItem(
      'renaissance.history.pending',
      JSON.stringify([...stashed, { ...stashed[0], id: 'other', userId: 'u9' }, { junk: true }]),
    );
    await startHistory({ ...session, userId: 'u8' });
    expect(historyStore.get().count).toBe(1);
    expect((await getListeningLog()?.events())?.[0]).toMatchObject({
      endReason: 'stopped',
      listened: 20,
      skipped: false,
    });
    const left = JSON.parse(localStorage.getItem('renaissance.history.pending') ?? '[]');
    expect(left.map((e: { id: string }) => e.id)).toEqual(['other']);
    stopHistory();
    await startHistory({ ...session, userId: 'u9' });
    expect(historyStore.get().count).toBe(1);
    expect(localStorage.getItem('renaissance.history.pending')).toBeNull();
  });
});
