import { emptyQueue, replace } from '@renaissance/core';
import type { AudioEvent, Track } from '@renaissance/core';
import { describe, expect, it, vi } from 'vitest';

import { fakeAdapter, session, track, tracks } from '../test/fakes';
import { DomAudioPort, getPlayer, loadQueue, resetPlayerForTests, saveQueue } from './player';
import { sessionStore } from './session';
import { toastStore } from './toast';

const lookup = (id: string): Track | undefined => tracks.find((t) => t.id === id);

function fakeElement(): HTMLAudioElement {
  const el = document.createElement('audio');
  Object.defineProperty(el, 'duration', { value: 120, configurable: true });
  Object.defineProperty(el, 'readyState', { value: 4, configurable: true });
  return el;
}

describe('DomAudioPort', () => {
  it('loads into the current slot, preloads into the spare one, and hands over on takeOver', () => {
    const a = fakeElement();
    const b = fakeElement();
    const slots = [a, b];
    const port = new DomAudioPort(() => slots.shift() as HTMLAudioElement);
    const events: AudioEvent[] = [];
    port.on((e) => events.push(e));
    port.load('http://x/Audio/1/universal', 30);
    expect(a.src).toBe('http://x/Audio/1/universal');
    a.dispatchEvent(new Event('loadedmetadata'));
    expect(a.currentTime).toBe(30);
    port.preload('http://x/Audio/2/universal');
    expect(b.src).toBe('http://x/Audio/2/universal');
    expect(port.takeOver('http://x/Audio/9/universal')).toBe(false);
    expect(port.takeOver('http://x/Audio/2/universal')).toBe(true);
    expect(a.hasAttribute('src')).toBe(false);
    b.dispatchEvent(new Event('playing'));
    b.dispatchEvent(new Event('ended'));
    a.dispatchEvent(new Event('playing'));
    expect(events.map((e) => e.type)).toEqual(['playing', 'ended']);
    expect(port.duration()).toBe(120);
    port.setVolume(0.4);
    expect(b.volume).toBe(0.4);
    port.seek(10);
    expect(b.currentTime).toBe(10);
    port.preload(null);
    expect(a.hasAttribute('src')).toBe(false);
    port.destroy();
    b.dispatchEvent(new Event('playing'));
    expect(events).toHaveLength(2);
  });

  it('fetches nothing until a stream is loaded or preloaded on purpose (a restored queue starts no transcode)', () => {
    const a = fakeElement();
    const b = fakeElement();
    const slots = [a, b];
    const port = new DomAudioPort(() => slots.shift() as HTMLAudioElement);
    expect(a.preload).toBe('none');
    expect(b.preload).toBe('none');
    port.load('http://x/Audio/1/universal', 0);
    expect(a.preload).toBe('auto');
    expect(b.preload).toBe('none');
    port.preload('http://x/Audio/2/universal');
    expect(b.preload).toBe('auto');
    port.preload(null);
    expect(b.preload).toBe('none');
    expect(b.hasAttribute('src')).toBe(false);
  });

  it('forwards time, pause, waiting and error events from the current element', () => {
    const a = fakeElement();
    const port = new DomAudioPort(() => (a.isConnected ? fakeElement() : a));
    const events: AudioEvent[] = [];
    port.on((e) => events.push(e));
    a.dispatchEvent(new Event('timeupdate'));
    a.dispatchEvent(new Event('pause'));
    a.dispatchEvent(new Event('waiting'));
    a.dispatchEvent(new Event('error'));
    expect(events.map((e) => e.type)).toEqual(['time', 'paused', 'waiting', 'error']);
    expect(port.position()).toBe(0);
  });

  it('refuses to take over a spare whose stream failed, so the next track is loaded fresh (func AB)', () => {
    const a = fakeElement();
    const b = fakeElement();
    const slots = [a, b];
    const port = new DomAudioPort(() => slots.shift() as HTMLAudioElement);
    port.load('http://x/Audio/1/universal');
    port.preload('http://x/Audio/2/universal');
    Object.defineProperty(b, 'error', {
      value: { code: 2, message: 'network' },
      configurable: true,
    });
    expect(port.takeOver('http://x/Audio/2/universal')).toBe(false);
    expect(a.src).toBe('http://x/Audio/1/universal');
  });
});

describe('queue persistence', () => {
  it('round-trips the queue per user and ignores garbage', () => {
    const queue = replace(emptyQueue, tracks, 1);
    expect(saveQueue('u1', queue, 42)).toBe(true);
    expect(loadQueue('u1', lookup)).toEqual({ queue, position: 42 });
    expect(loadQueue('u2', lookup)).toBeNull();
    localStorage.setItem('renaissance.queue.u3', '{bad json');
    expect(loadQueue('u3', lookup)).toBeNull();
    localStorage.setItem('renaissance.queue.u4', JSON.stringify({ queue: { items: [] } }));
    expect(loadQueue('u4', lookup)).toBeNull();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(saveQueue('u1', queue, 1)).toBe(false);
    spy.mockRestore();
  });

  it('stores ids, not songs: a 20,000-song queue fits in localStorage and comes back from the library (func AA)', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => track(`s${i}`, { title: `Song ${i}` }));
    const byId = new Map(many.map((t) => [t.id, t]));
    const queue = replace(emptyQueue, many, 7);
    expect(saveQueue('u1', queue, 3)).toBe(true);
    const raw = localStorage.getItem('renaissance.queue.u1') ?? '';
    expect(raw).not.toContain('artistName');
    // Well inside a 5 M character quota; the old shape needed about 16 M for this queue.
    expect(raw.length).toBeLessThan(1_500_000);
    const loaded = loadQueue('u1', (id) => byId.get(id));
    expect(loaded?.queue).toEqual(queue);
    expect(loaded?.position).toBe(3);
  });

  it('a song the library no longer holds is dropped on restore and the index follows the current song (func AA)', () => {
    const queue = replace(emptyQueue, tracks, 2);
    saveQueue('u1', queue, 10);
    const without = (gone: string) => (id: string) => (id === gone ? undefined : lookup(id));
    const loaded = loadQueue('u1', without('t2'));
    expect(loaded?.queue.items.map((t) => t.id)).toEqual(['t1', 't3', 't4']);
    expect(loaded?.queue.index).toBe(1);
    expect(loaded?.queue.keys).toEqual([0, 2, 3]);
    expect(loaded?.queue.orderKeys).toEqual([0, 2, 3]);
    expect(loaded?.position).toBe(10);
    // The current song itself is gone: the one after it is current, from the start.
    const next = loadQueue('u1', without('t3'));
    expect(next?.queue.items.map((t) => t.id)).toEqual(['t1', 't2', 't4']);
    expect(next?.queue.index).toBe(2);
    expect(next?.position).toBe(0);
    expect(loadQueue('u1', () => undefined)).toBeNull();
    // A record written before this round, with whole songs in it, is still read.
    localStorage.setItem(
      'renaissance.queue.u1',
      JSON.stringify({ userId: 'u1', queue, position: 4 }),
    );
    expect(loadQueue('u1', () => undefined)).toEqual({ queue, position: 4 });
  });

  it('a save that fails is said once, in a toast, and the queue lasts the session (func AA)', () => {
    resetPlayerForTests();
    sessionStore.set({
      status: 'signedIn',
      session,
      adapter: fakeAdapter().adapter,
      vault: 'encrypted',
      reason: null,
    });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      const player = getPlayer();
      player.restore(replace(emptyQueue, tracks, 0), 0);
      expect(toastStore.get()?.message).toBe(
        'The queue could not be saved in this browser. It lasts until this tab closes.',
      );
      toastStore.set(null);
      player.next();
      expect(player.snapshot.queue.index).toBe(1);
      expect(toastStore.get()).toBeNull();
    } finally {
      spy.mockRestore();
      resetPlayerForTests();
    }
  });
});
