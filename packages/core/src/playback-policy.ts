/**
 * PlaybackPolicy: decides direct play or transcode and the bitrate cap for the network class.
 * Pure; the audio engines only call this.
 */
import type { Track } from './models';
import type { StreamQuality } from './server-adapter';

export type NetworkClass = 'wifi' | 'cellular' | 'offline' | 'unknown';

export interface PlaybackSettings {
  /** Codecs the current device can play directly, lower case, for example ["flac", "mp3", "aac"]. */
  directPlayCodecs: string[];
  /** Bitrate cap in bits per second on cellular; 0 means no cap. */
  cellularMaxBitrate: number;
  /** Bitrate cap on Wi-Fi; 0 means lossless, no cap. */
  wifiMaxBitrate: number;
}

export const defaultPlaybackSettings: PlaybackSettings = {
  directPlayCodecs: ['flac', 'mp3', 'aac', 'alac', 'opus', 'vorbis', 'm4a', 'ogg'],
  cellularMaxBitrate: 320_000,
  wifiMaxBitrate: 0,
};

export interface PlaybackDecision {
  method: 'direct' | 'transcode';
  quality: StreamQuality;
}

export function decidePlayback(
  track: Track,
  network: NetworkClass,
  settings: PlaybackSettings = defaultPlaybackSettings,
): PlaybackDecision {
  const cap = network === 'cellular' ? settings.cellularMaxBitrate : settings.wifiMaxBitrate;
  const codec = track.codec?.toLowerCase();
  const codecOk = codec !== undefined && settings.directPlayCodecs.includes(codec);
  const bitrateOk = cap === 0 || track.bitrate === undefined || track.bitrate <= cap;
  if (codecOk && bitrateOk) return { method: 'direct', quality: 'original' };
  return { method: 'transcode', quality: cap === 0 ? 'original' : { maxBitrate: cap } };
}
