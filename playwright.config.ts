import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

// e2e runs against demo mode (mock provider) with an isolated data dir so the
// library always starts as exactly the three golden games. Dev/CI only — never on the Pi.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8098',
    viewport: { width: 1024, height: 600 },
    trace: 'retain-on-failure',
  },
  webServer: {
    // Wipes .e2e-data first (fresh library = exactly the three golden games).
    command: 'node tests/e2e/e2e-server.mjs --fresh',
    url: 'http://127.0.0.1:8098/api/system/info',
    timeout: 300_000,
    reuseExistingServer: false,
    cwd: root,
    env: {
      SPARKADE_DATA: join(root, '.e2e-data'),
      SPARKADE_PORT: '8098',
      SPARKADE_PROVIDER: 'mock',
      // Speed up mock stage delays so the suite stays fast.
      SPARKADE_MOCK_FAST: '1',
    },
  },
});
