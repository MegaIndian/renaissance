import { defaultSettings } from '@renaissance/core';
import { describe, expect, it } from 'vitest';

import { detectNetwork, networkFor } from './network';
import { relativeTime } from './time';
import { i18n } from './i18n';

describe('detectNetwork', () => {
  it('reads the connection API, falls back by pointer type, and honours offline', () => {
    expect(detectNetwork({ type: 'wifi' }, true, true)).toBe('wifi');
    expect(detectNetwork({ type: 'ethernet' }, true, true)).toBe('wifi');
    expect(detectNetwork({ type: 'cellular' }, false, true)).toBe('cellular');
    expect(detectNetwork({ type: 'none' }, false, true)).toBe('offline');
    expect(detectNetwork({ effectiveType: '3g' }, false, true)).toBe('cellular');
    expect(detectNetwork({ effectiveType: '4g' }, false, true)).toBe('wifi');
    expect(detectNetwork(undefined, false, true)).toBe('wifi');
    expect(detectNetwork(undefined, true, true)).toBe('unknown');
    expect(detectNetwork({ type: 'wifi' }, false, false)).toBe('offline');
  });

  it('settings can pin the class', () => {
    expect(networkFor({ ...defaultSettings, network: 'wifi' })).toBe('wifi');
    expect(networkFor({ ...defaultSettings, network: 'cellular' })).toBe('cellular');
    expect(['wifi', 'cellular', 'unknown', 'offline']).toContain(networkFor(defaultSettings));
  });
});

describe('relativeTime', () => {
  it('is coarse and translated', async () => {
    await i18n.changeLanguage('en');
    const now = Date.parse('2026-11-18T12:00:00.000Z');
    const t = i18n.t.bind(i18n);
    expect(relativeTime('2026-11-18T11:59:50.000Z', t, now)).toBe('just now');
    expect(relativeTime('2026-11-18T11:59:00.000Z', t, now)).toBe('a minute ago');
    expect(relativeTime('2026-11-18T11:30:00.000Z', t, now)).toBe('30 minutes ago');
    expect(relativeTime('2026-11-18T09:00:00.000Z', t, now)).toBe('3 hours ago');
    expect(relativeTime('2026-11-17T12:00:00.000Z', t, now)).toBe('yesterday');
    expect(relativeTime('2026-11-10T12:00:00.000Z', t, now)).toBe('8 days ago');
  });
});
