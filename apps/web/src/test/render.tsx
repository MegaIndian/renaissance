import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router';

import { i18n } from '../lib/i18n';
import { routes } from '../router';

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** The whole app at one route, in the real router, query client and i18n instance. */
export function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

/** One component with i18n, a query client and a router around it (links need one). */
export function renderWithI18n(element: ReactElement, path = '/') {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}
