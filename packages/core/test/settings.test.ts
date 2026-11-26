import { describe, expect, it } from 'vitest';

import {
  defaultSettings,
  parseSettings,
  playbackSettingsFrom,
  qualityBitrate,
} from '../src/settings';
import { createStore } from '../src/store';

describe('settings', () => {
  it('defaults to simple mode, the system theme, lossless on Wi-Fi and high on cellular', () => {
    expect(defaultSettings).toEqual({
      mode: 'simple',
      theme: 'system',
      wifiQuality: 'lossless',
      cellularQuality: 'high',
      network: 'auto',
      albumAwareShuffle: false,
      listeningLog: true,
    });
  });

  it('parses stored values field by field, dropping what is invalid', () => {
    expect(
      parseSettings({ mode: 'advanced', theme: 'neon', wifiQuality: 'low', extra: 1 }),
    ).toEqual({
      ...defaultSettings,
      mode: 'advanced',
      wifiQuality: 'low',
    });
    expect(parseSettings('garbage')).toEqual(defaultSettings);
    expect(parseSettings(null)).toEqual(defaultSettings);
    expect(parseSettings({ language: 'gu' }).language).toBe('gu');
  });

  it('turns quality steps into bitrate caps for the playback policy', () => {
    const p = playbackSettingsFrom({
      ...defaultSettings,
      wifiQuality: 'medium',
      cellularQuality: 'low',
    });
    expect(p.wifiMaxBitrate).toBe(192_000);
    expect(p.cellularMaxBitrate).toBe(128_000);
    expect(qualityBitrate.lossless).toBe(0);
    expect(p.directPlayCodecs).toContain('flac');
  });
});

describe('createStore', () => {
  it('notifies subscribers on change only and supports updaters', () => {
    const store = createStore({ n: 1 });
    const seen: number[] = [];
    const stop = store.subscribe((v) => seen.push(v.n));
    store.set({ n: 2 });
    store.set((s) => ({ n: s.n + 1 }));
    const same = store.get();
    store.set(same);
    stop();
    store.set({ n: 9 });
    expect(seen).toEqual([2, 3]);
    expect(store.get().n).toBe(9);
  });
});
