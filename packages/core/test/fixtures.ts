import type { Album, Artist, Playlist, Track } from '../src/models';
import type { Session } from '../src/server-adapter';

export const server = {
  id: 's1',
  kind: 'jellyfin',
  name: 'Demo',
  url: 'http://localhost:8096',
} as const;

export const session: Session = { server, userId: 'u1', userName: 'demo', token: 'tok' };

export function track(id: string, extra: Partial<Track> = {}): Track {
  return {
    id,
    title: `Track ${id}`,
    artistIds: ['a1'],
    artistName: 'Artist',
    duration: 180,
    isFavorite: false,
    playCount: 0,
    genres: [],
    ...extra,
  };
}

export function album(id: string, extra: Partial<Album> = {}): Album {
  return {
    id,
    title: `Album ${id}`,
    artistIds: ['a1'],
    artistName: 'Artist',
    genres: [],
    isFavorite: false,
    playCount: 0,
    ...extra,
  };
}

export function artist(id: string, extra: Partial<Artist> = {}): Artist {
  return { id, name: `Artist ${id}`, isFavorite: false, playCount: 0, ...extra };
}

export function playlist(id: string, extra: Partial<Playlist> = {}): Playlist {
  return { id, name: `Playlist ${id}`, trackCount: 0, isFavorite: false, playCount: 0, ...extra };
}

/** A Jellyfin BaseItemDto for an audio item, close to what the demo server answers. */
export function jfAudio(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    Id: id,
    Name: name,
    Type: 'Audio',
    Container: 'mp3',
    RunTimeTicks: 1366204250,
    ProductionYear: 2010,
    Genres: ['Contemporary'],
    DateCreated: '2026-11-18T03:08:05.6769796Z',
    DateLastSaved: '2026-11-18T03:09:00.0000000Z',
    Artists: ['Kevin MacLeod'],
    ArtistItems: [{ Name: 'Kevin MacLeod', Id: 'art1' }],
    Album: 'Royalty Free',
    AlbumArtist: 'Kevin MacLeod',
    AlbumArtists: [{ Name: 'Kevin MacLeod', Id: 'art1' }],
    ImageTags: {},
    MediaStreams: [{ Type: 'Audio', Codec: 'mp3', BitRate: 320000, SampleRate: 44100 }],
    UserData: { PlaybackPositionTicks: 0, PlayCount: 2, IsFavorite: true, Played: true },
    ...extra,
  };
}

export type Call = { method: string; url: URL; body: unknown };

/**
 * A fake `fetch` for the adapter: routes by method and path, records every call. Handlers may return
 * a JSON value, a `Response`, or throw; an unmatched call answers 404.
 */
export function fakeFetch(
  routes: Record<string, (url: URL, body: unknown, call: Call) => unknown>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: Call = { method, url, body };
    calls.push(call);
    const handler = routes[`${method} ${url.pathname}`] ?? routes[`* ${url.pathname}`];
    if (!handler) return new Response('not found', { status: 404 });
    const result = await handler(url, body, call);
    if (result instanceof Response) return result;
    if (result === undefined) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: impl as typeof fetch, calls };
}
