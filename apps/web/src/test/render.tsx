import type { HubClient } from '@renaissance/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router';

import { HubProvider } from '../lib/hub';
import { i18n } from '../lib/i18n';
import { routes } from '../router';

function providers(element: ReactElement, hub: HubClient | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <HubProvider client={hub}>{element}</HubProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

/** The whole app at one route, in the real router and i18n instance. `hub` is null (signed out) unless given. */
export function renderApp(path = '/', hub: HubClient | null = null) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(providers(<RouterProvider router={router} />, hub));
}

/** One component with i18n, a query client, the hub and a router around it (links need one). */
export function renderWithI18n(element: ReactElement, hub: HubClient | null = null) {
  return render(providers(<MemoryRouter>{element}</MemoryRouter>, hub));
}
