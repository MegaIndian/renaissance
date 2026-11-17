import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';

import { Home } from './routes/Home';
import { Library } from './routes/Library';
import { Requests } from './routes/Requests';
import { Root } from './routes/Root';
import { SignIn } from './routes/SignIn';

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: Root,
    children: [
      { index: true, Component: Home },
      { path: 'library', Component: Library },
      { path: 'requests', Component: Requests },
      { path: 'sign-in', Component: SignIn },
    ],
  },
];

export const router = createBrowserRouter(routes);
