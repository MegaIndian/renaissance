import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';

import { lazyRoute } from './lib/lazy';
import { Home } from './routes/Home';
import { NotFound } from './routes/NotFound';
import { Root } from './routes/Root';

/**
 * Home and the shell load with the page; every other screen is its own chunk so the first load stays
 * under the 200 kB budget (vite.config.ts, scripts/check-bundle-size.mjs). A chunk that fails to load
 * offline raises `OfflineError`, which the error page names and retries when the connection returns.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    Component: Root,
    ErrorBoundary: NotFound,
    HydrateFallback: () => null,
    children: [
      { index: true, Component: Home },
      {
        path: 'library',
        lazy: lazyRoute(
          () => import('./routes/Library'),
          (m) => m.Library,
        ),
      },
      {
        path: 'album/:id',
        lazy: lazyRoute(
          () => import('./routes/Album'),
          (m) => m.AlbumPage,
        ),
      },
      {
        path: 'artist/:id',
        lazy: lazyRoute(
          () => import('./routes/Artist'),
          (m) => m.ArtistPage,
        ),
      },
      {
        path: 'playlist/:id',
        lazy: lazyRoute(
          () => import('./routes/Playlist'),
          (m) => m.PlaylistPage,
        ),
      },
      {
        path: 'favorites',
        lazy: lazyRoute(
          () => import('./routes/Favorites'),
          (m) => m.Favorites,
        ),
      },
      {
        path: 'search',
        lazy: lazyRoute(
          () => import('./routes/Search'),
          (m) => m.Search,
        ),
      },
      {
        path: 'queue',
        lazy: lazyRoute(
          () => import('./routes/Queue'),
          (m) => m.Queue,
        ),
      },
      {
        path: 'now-playing',
        lazy: lazyRoute(
          () => import('./routes/NowPlaying'),
          (m) => m.NowPlaying,
        ),
      },
      {
        path: 'lyrics',
        lazy: lazyRoute(
          () => import('./routes/Lyrics'),
          (m) => m.LyricsPage,
        ),
      },
      {
        path: 'settings',
        lazy: lazyRoute(
          () => import('./routes/Settings'),
          (m) => m.Settings,
        ),
      },
      {
        path: 'requests',
        lazy: lazyRoute(
          () => import('./routes/Requests'),
          (m) => m.Requests,
        ),
      },
      {
        path: 'sign-in',
        lazy: lazyRoute(
          () => import('./routes/SignIn'),
          (m) => m.SignIn,
        ),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
