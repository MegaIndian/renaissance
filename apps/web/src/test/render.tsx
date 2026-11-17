import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router';

import { i18n } from '../lib/i18n';
import { routes } from '../router';

/** The whole app at one route, in the real router and i18n instance. */
export function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

/** One component with i18n and a router around it (links need one). */
export function renderWithI18n(element: ReactElement) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{element}</MemoryRouter>
    </I18nextProvider>,
  );
}
