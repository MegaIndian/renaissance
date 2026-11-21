import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider } from 'react-router';

import { startApp } from './lib/app';
import { i18n, i18nReady } from './lib/i18n';
import { applyDocumentAttributes } from './lib/settings';
import './styles.css';
import { router } from './router';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

applyDocumentAttributes();
startApp(queryClient);

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// The chosen language's strings first (one small chunk for Gujarati, nothing for English), then paint.
void i18nReady.then(() => {
  createRoot(container).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>
    </StrictMode>,
  );
});
