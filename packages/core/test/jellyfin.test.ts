import { describe, expect, it } from 'vitest';

import {
  JellyfinAdapter,
  NotImplementedError,
  headerSafe,
  serverBase,
} from '../src/adapters/jellyfin';
import { Server as ServerSchema } from '../src/models';
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

describe('JellyfinAdapter URL and header hygiene', () => {
  const slashServer: Server = { ...server, url: 'http://localhost:8096///' };
  const slashAdapter = new JellyfinAdapter(slashServer, {
    deviceName: 'Sahil\'s "Mac"\\\n',
    deviceId: 'dev-1',
    version: '0.0.0',
  });

  it('drops trailing slashes from the server URL', () => {
    expect(slashAdapter.server.url).toBe('http://localhost:8096');
    expect(slashAdapter.streamUrl(session, track, 'original')).toMatch(
      /^http:\/\/localhost:8096\/Audio\/abc\/universal\?/,
    );
    expect(slashAdapter.downloadUrl(session, track)).toBe(
      'http://localhost:8096/Items/abc/Download?api_key=tok',
    );
    expect(new URL(slashAdapter.imageUrl(session, 'img', 120)).pathname).toBe(
      '/Items/img/Images/Primary',
    );
  });

  it('escapes quotes, backslashes and control characters in the header', () => {
    expect(slashAdapter.authorizationHeader()).toBe(
      'MediaBrowser Client="Renaissance", Device="Sahil\'s Mac", DeviceId="dev-1", Version="0.0.0"',
    );
    expect(headerSafe('a"b\\c\u0000d')).toBe('abcd');
    expect(serverBase('https://x.test/')).toBe('https://x.test');
    expect(serverBase('/'.repeat(5000))).toBe('');
    expect(serverBase('http://a.test')).toBe('http://a.test');
  });

  it('the Server schema normalises the URL too', () => {
    expect(ServerSchema.parse({ ...server, url: 'https://music.example.com/' }).url).toBe(
      'https://music.example.com',
    );
    expect(ServerSchema.safeParse({ ...server, url: 'not a url' }).success).toBe(false);
  });
});
