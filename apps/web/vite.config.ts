import { readFileSync } from 'node:fs';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

/**
 * The shell must stay under 200 kB gzipped (scripts/check-bundle-size.mjs enforces it after a build):
 * routes are lazy, and the vendor code is split so React, the router, the query client and the
 * catalogs each cache on their own.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 5173 },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'react';
          }
          if (id.includes('node_modules/react-router')) return 'router';
          if (id.includes('node_modules/@tanstack')) return 'query';
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) {
            return 'i18n';
          }
          if (id.includes('node_modules/zod')) return 'zod';
          return undefined;
        },
      },
    },
  },
});
