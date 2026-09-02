import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/site/test/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    environment: 'node',
    // Unit tests are pure logic (validators, parsers, math) — no canvas, no network.
    testTimeout: 20_000,
  },
});
