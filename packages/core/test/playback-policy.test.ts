import { describe, expect, it } from 'vitest';

import type { Track } from '../src/models';
import { decidePlayback } from '../src/playback-policy';

const flac: Track = {
  id: 't1',
  title: 'Lossless',
  artistIds: [],
  artistName: 'Artist',
  duration: 200,
  codec: 'flac',
  bitrate: 900_000,
  isFavorite: false,
};

describe('decidePlayback', () => {
  it('direct plays a supported codec on Wi-Fi', () => {
    expect(decidePlayback(flac, 'wifi')).toEqual({ method: 'direct', quality: 'original' });
  });

  it('transcodes with a cap on cellular when the bitrate is over the cap', () => {
    expect(decidePlayback(flac, 'cellular')).toEqual({
      method: 'transcode',
      quality: { maxBitrate: 320_000 },
    });
  });

  it('treats an unknown network like cellular', () => {
    expect(decidePlayback(flac, 'unknown')).toEqual({
      method: 'transcode',
      quality: { maxBitrate: 320_000 },
    });
    expect(decidePlayback({ ...flac, bitrate: 256_000 }, 'unknown').method).toBe('direct');
  });

  it('offline plays the cached file without a cap; the caller picks what is cached', () => {
    expect(decidePlayback(flac, 'offline')).toEqual({ method: 'direct', quality: 'original' });
  });

  it('transcodes an unsupported codec', () => {
    const wma = { ...flac, codec: 'wma', bitrate: 128_000 };
    expect(decidePlayback(wma, 'wifi').method).toBe('transcode');
  });
});
