import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the built app (`pnpm --filter web build` first): what jsdom cannot measure,
 * the rendered focus outline and the size of every control (accessibility.spec.ts), the phase 1
 * exit test against a real Jellyfin (demo.spec.ts, skipped without the RENAISSANCE_DEMO_* variables;
 * see docs/testing.md), and the one search box against the real hub (search-box.spec.ts; the hub
 * runs `apps/hub/scripts/e2e-hub.mjs`, stand-ins for every outside service, on the web app's
 * default hub port). CI runs this after the web build.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    colorScheme: 'dark',
    // Media must start without a gesture so the demo test can press Play.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: [
    {
      command: 'pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
    },
    {
      // The web app finds the hub at the host it is served from, port 8787: this one must own it.
      command: 'node --disable-warning=ExperimentalWarning --import tsx scripts/e2e-hub.mjs',
      // tsx is the hub's own dev dependency: resolve it from there.
      cwd: '../hub',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
