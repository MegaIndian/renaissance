import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the built app (`pnpm --filter web build` first): what jsdom cannot measure,
 * the rendered focus outline and the size of every control (accessibility.spec.ts), and the phase 1
 * exit test against a real Jellyfin (demo.spec.ts, skipped without the RENAISSANCE_DEMO_* variables;
 * see docs/testing.md). CI runs this after the web build.
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
  webServer: {
    command: 'pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
});
