import { createBrowserRouter } from 'react-router';

import { Home } from './routes/Home';
import { Placeholder } from './routes/Placeholder';
import { Root } from './routes/Root';
import { SignIn } from './routes/SignIn';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    children: [
      { index: true, Component: Home },
      { path: 'library', element: <Placeholder titleKey="nav.library" /> },
      { path: 'requests', element: <Placeholder titleKey="nav.requests" /> },
      { path: 'sign-in', Component: SignIn },
    ],
  },
]);
