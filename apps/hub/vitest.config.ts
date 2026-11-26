import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // The process entry point only wires loadConfig and buildApp to listen(); CI smoke-tests it.
      exclude: ['src/server.ts'],
      reporter: ['text-summary', 'lcov'],
      // The hub holds the keys and the pipeline: 90 % on lines, functions and statements, 80 % on branches.
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
});
