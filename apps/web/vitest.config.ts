import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/lib/**', 'src/components/**', 'src/routes/**'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
      reporter: ['text-summary'],
      // The floor measured in phase 1 rework round 5; raised with each phase, never lowered.
      thresholds: { statements: 82, branches: 77, functions: 77, lines: 84 },
    },
  },
});
