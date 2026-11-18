import { emptyQueue, replace } from '@renaissance/core';
import type { AudioEvent } from '@renaissance/core';
import { describe, expect, it, vi } from 'vitest';

import { tracks } from '../test/fakes';
import { DomAudioPort, loadQueue, saveQueue } from './player';

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
});

describe('queue persistence', () => {
  it('round-trips the queue per user and ignores garbage', () => {
    const queue = replace(emptyQueue, tracks, 1);
    saveQueue('u1', queue, 42);
    expect(loadQueue('u1')).toEqual({ queue, position: 42 });
    expect(loadQueue('u2')).toBeNull();
    localStorage.setItem('renaissance.queue.u3', '{bad json');
    expect(loadQueue('u3')).toBeNull();
    localStorage.setItem('renaissance.queue.u4', JSON.stringify({ queue: { items: [] } }));
    expect(loadQueue('u4')).toBeNull();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => saveQueue('u1', queue, 1)).not.toThrow();
    spy.mockRestore();
  });
});
