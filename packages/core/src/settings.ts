/**
 * Settings (F67 shape, phase 1 subset), one schema for both apps; each app persists it in its own
 * store and parses it on the way back in, so a corrupt or old value falls back to the defaults.
 */
import { z } from 'zod';

import { supportedLanguages } from './i18n';
import type { PlaybackSettings } from './playback-policy';
import { defaultPlaybackSettings } from './playback-policy';

/** Streaming quality steps (F27); `lossless` means no cap and the original file when the device can play it. */
export const StreamingQuality = z.enum(['lossless', 'high', 'medium', 'low']);
export type StreamingQuality = z.infer<typeof StreamingQuality>;

/** Bits per second for each step; 0 is no cap. */
export const qualityBitrate: Record<StreamingQuality, number> = {
  lossless: 0,
  high: 320_000,
  medium: 192_000,
  low: 128_000,
};

export const Settings = z.object({
  /** Simple mode is the default for every profile (F84); advanced is this switch. */
  mode: z.enum(['simple', 'advanced']).default('simple'),
  theme: z.enum(['system', 'dark', 'light']).default('system'),
  language: z.enum(supportedLanguages).optional(),
  wifiQuality: StreamingQuality.default('lossless'),
  cellularQuality: StreamingQuality.default('high'),
  /** Override the detected network class; `auto` trusts the platform. */
  network: z.enum(['auto', 'wifi', 'cellular']).default('auto'),
  albumAwareShuffle: z.boolean().default(false),
});
export type Settings = z.infer<typeof Settings>;

export const defaultSettings: Settings = Settings.parse({});

/** Reads stored settings; anything unparseable becomes the defaults (fields are independent). */
export function parseSettings(raw: unknown): Settings {
  const parsed = Settings.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (raw && typeof raw === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const field = Settings.shape[key as keyof Settings];
      if (field && field.safeParse(value).success) out[key] = value;
    }
    return Settings.parse(out);
  }
  return defaultSettings;
}

/** The playback policy's input for these settings. */
export function playbackSettingsFrom(settings: Settings): PlaybackSettings {
  return {
    ...defaultPlaybackSettings,
    wifiMaxBitrate: qualityBitrate[settings.wifiQuality],
    cellularMaxBitrate: qualityBitrate[settings.cellularQuality],
  };
}
