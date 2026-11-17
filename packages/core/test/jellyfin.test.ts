import { describe, expect, it } from 'vitest';

import { JellyfinAdapter, NotImplementedError } from '../src/adapters/jellyfin';
import type { Server, Track } from '../src/models';
import type { Session } from '../src/server-adapter';

const server: Server = { id: 's1', kind: 'jellyfin', name: 'Demo', url: 'http://localhost:8096' };
const adapter = new JellyfinAdapter(server, {
  deviceName: 'Test',
  deviceId: 'dev-1',
  version: '0.0.0',
});
const session: Session = { server, userId: 'u1', userName: 'demo', token: 'tok' };
const track: Track = {
  id: 'abc',
  title: 'Song',
  artistIds: [],
  artistName: 'Artist',
  duration: 100,
  isFavorite: false,
};

describe('JellyfinAdapter', () => {
  it('builds the MediaBrowser authorization header', () => {
    expect(adapter.authorizationHeader('tok')).toBe(
      'MediaBrowser Client="Renaissance", Device="Test", DeviceId="dev-1", Version="0.0.0", Token="tok"',
    );
  });

  it('builds a universal stream URL with a bitrate cap', () => {
    const url = new URL(adapter.streamUrl(session, track, { maxBitrate: 320_000 }));
    expect(url.pathname).toBe('/Audio/abc/universal');
    expect(url.searchParams.get('MaxStreamingBitrate')).toBe('320000');
    expect(url.searchParams.get('api_key')).toBe('tok');
  });

  it('omits the cap for original quality', () => {
    const url = new URL(adapter.streamUrl(session, track, 'original'));
    expect(url.searchParams.has('MaxStreamingBitrate')).toBe(false);
  });

  it('refuses a non-Jellyfin server', () => {
    expect(
      () =>
        new JellyfinAdapter(
          { ...server, kind: 'subsonic' },
          { deviceName: 'x', deviceId: 'y', version: 'z' },
        ),
    ).toThrow();
  });

  it('marks unfinished methods clearly', async () => {
    await expect(adapter.signIn({ userName: 'a', password: 'b' })).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});
