import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';

import { Home } from './routes/Home';
import { NotFound } from './routes/NotFound';
import { Root } from './routes/Root';

/**
 * Home and the shell load with the page; every other screen is its own chunk so the first load stays
 * under the 200 kB budget (vite.config.ts, scripts/check-bundle-size.mjs).
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
        lazy: () => import('./routes/Library').then((m) => ({ Component: m.Library })),
      },
      {
        path: 'album/:id',
        lazy: () => import('./routes/Album').then((m) => ({ Component: m.AlbumPage })),
      },
      {
        path: 'artist/:id',
        lazy: () => import('./routes/Artist').then((m) => ({ Component: m.ArtistPage })),
      },
      {
        path: 'playlist/:id',
        lazy: () => import('./routes/Playlist').then((m) => ({ Component: m.PlaylistPage })),
      },
      {
        path: 'favorites',
        lazy: () => import('./routes/Favorites').then((m) => ({ Component: m.Favorites })),
      },
      {
        path: 'search',
        lazy: () => import('./routes/Search').then((m) => ({ Component: m.Search })),
      },
      { path: 'queue', lazy: () => import('./routes/Queue').then((m) => ({ Component: m.Queue })) },
      {
        path: 'now-playing',
        lazy: () => import('./routes/NowPlaying').then((m) => ({ Component: m.NowPlaying })),
      },
      {
        path: 'settings',
        lazy: () => import('./routes/Settings').then((m) => ({ Component: m.Settings })),
      },
      {
        path: 'requests',
        lazy: () => import('./routes/Requests').then((m) => ({ Component: m.Requests })),
      },
      {
        path: 'sign-in',
        lazy: () => import('./routes/SignIn').then((m) => ({ Component: m.SignIn })),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
