/**
 * Server reads through TanStack Query, keyed per user so two household members never share a cache
 * entry (F86). Anything the local library snapshot already answers (lists, sorts, filters, search)
 * does not come through here; these are the per-item reads that need the server: album and playlist
 * tracks, an artist's biography, similar artists, and the home rows the server ranks.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { creditsArtist, findArtist, sortAlbumTracks } from '@renaissance/core';
import type { Album, Artist, PlaylistEntry, Track } from '@renaissance/core';

import { libraryStore } from './library';
import { sessionStore } from './session';
import { useStoreSlice, useStoreValue } from './useStore';

export function useSession() {
  return useStoreValue(sessionStore);
}

export function useLibrary() {
  return useStoreValue(libraryStore);
}

export function useSnapshot() {
  return useStoreSlice(libraryStore, (s) => s.snapshot);
}

function userKey(): string {
  const s = sessionStore.get().session;
  return s ? `${s.server.id}:${s.userId}` : 'anonymous';
}

export const queryKeys = {
  albumTracks: (albumId: string) => ['albumTracks', userKey(), albumId] as const,
  album: (albumId: string) => ['album', userKey(), albumId] as const,
  artist: (artistId: string) => ['artist', userKey(), artistId] as const,
  similarArtists: (artistId: string) => ['similarArtists', userKey(), artistId] as const,
  playlistTracks: (playlistId: string) => ['playlistTracks', userKey(), playlistId] as const,
  recentlyPlayed: () => ['recentlyPlayed', userKey()] as const,
};

function library() {
  const { adapter, session } = sessionStore.get();
  if (!adapter || !session) throw new Error('signed out');
  return adapter.library(session);
}

export function useAlbumTracks(albumId: string | undefined) {
  const all = useStoreSlice(libraryStore, (s) => s.snapshot.tracks);
  const cached = useMemo(
    () => (albumId ? sortAlbumTracks(all.filter((t) => t.albumId === albumId)) : []),
    [all, albumId],
  );
  const query = useQuery<Track[]>({
    queryKey: queryKeys.albumTracks(albumId ?? ''),
    queryFn: () => library().albumTracks(albumId ?? ''),
    enabled: !!albumId && sessionStore.get().status === 'signedIn',
  });
  return { ...query, tracks: query.data ?? cached, fromCache: !query.data };
}

export function useAlbum(albumId: string | undefined) {
  const cached = useStoreSlice(libraryStore, (s) =>
    s.snapshot.albums.find((a) => a.id === albumId),
  );
  const query = useQuery<Album>({
    queryKey: queryKeys.album(albumId ?? ''),
    queryFn: () => library().album(albumId ?? ''),
    enabled: !!albumId && !cached && sessionStore.get().status === 'signedIn',
  });
  return { ...query, album: cached ?? query.data };
}

/**
 * The artist behind a route id (F10). The snapshot's artists are merged by name, so the id may be
 * the server's `/Artists` id or the one tracks carry; both resolve. A route id the cache does not
 * know (a link from elsewhere) is fetched from the server and matched by name, so the page still
 * shows the cached songs; the server's record adds the biography.
 */
export function useArtist(artistId: string | undefined) {
  const artists = useStoreSlice(libraryStore, (s) => s.snapshot.artists);
  const byId = useMemo(() => findArtist(artists, artistId), [artists, artistId]);
  const query = useQuery<Artist>({
    queryKey: queryKeys.artist(artistId ?? ''),
    queryFn: () => library().artist(artistId ?? ''),
    enabled: !!artistId && sessionStore.get().status === 'signedIn',
  });
  const cached = byId ?? (query.data ? findArtist(artists, undefined, query.data.name) : undefined);
  const artist =
    cached && query.data
      ? { ...cached, ...query.data, id: cached.id, ids: cached.ids, isFavorite: cached.isFavorite }
      : (cached ?? query.data);
  return { ...query, artist };
}

/** The cached albums and songs credited to an artist under any of its ids or by name. */
export function useArtistItems(artist: Artist | undefined) {
  const tracks = useStoreSlice(libraryStore, (s) => s.snapshot.tracks);
  const albums = useStoreSlice(libraryStore, (s) => s.snapshot.albums);
  return useMemo(
    () => ({
      tracks: artist ? tracks.filter((t) => creditsArtist(t, artist)) : [],
      albums: artist ? albums.filter((a) => creditsArtist(a, artist)) : [],
    }),
    [artist, tracks, albums],
  );
}

export function useSimilarArtists(artistId: string | undefined) {
  return useQuery<Artist[]>({
    queryKey: queryKeys.similarArtists(artistId ?? ''),
    queryFn: () => library().similarArtists(artistId ?? '', 12),
    enabled: !!artistId && sessionStore.get().status === 'signedIn',
    staleTime: 10 * 60_000,
  });
}

export function usePlaylistTracks(playlistId: string | undefined) {
  return useQuery<PlaylistEntry[]>({
    queryKey: queryKeys.playlistTracks(playlistId ?? ''),
    queryFn: () => library().playlistTracks(playlistId ?? ''),
    enabled: !!playlistId && sessionStore.get().status === 'signedIn',
  });
}

/** The server's own "recently played" ranking, which knows about plays from other clients. */
export function useRecentlyPlayed(limit = 12) {
  const all = useStoreSlice(libraryStore, (s) => s.snapshot.tracks);
  const fromCache = useMemo(
    () =>
      all
        .filter((t) => t.lastPlayed)
        .sort((a, b) => Date.parse(b.lastPlayed ?? '') - Date.parse(a.lastPlayed ?? ''))
        .slice(0, limit),
    [all, limit],
  );
  const query = useQuery<Track[]>({
    queryKey: queryKeys.recentlyPlayed(),
    queryFn: () => library().recentlyPlayed(limit),
    enabled: sessionStore.get().status === 'signedIn',
    staleTime: 60_000,
  });
  return query.data && query.data.length >= fromCache.length ? query.data : fromCache;
}
