import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror apps/site/tsconfig.json "@/*" so server actions can be tested.
    alias: { '@': path.resolve(__dirname, 'apps/site') },
  },
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
