import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider } from 'react-router';

import { applyDocumentAttributes } from './lib/document';
import { HubProvider } from './lib/hub';
import { i18n } from './lib/i18n';
import './styles.css';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

applyDocumentAttributes();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <HubProvider>
          <RouterProvider router={router} />
        </HubProvider>
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
);
