import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

// e2e runs against demo mode (mock provider) with an isolated data dir so the
// library always starts as exactly the five golden games. Dev/CI only — never on the Pi.
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
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: [
    {
      // Wipes .e2e-data first (fresh library = exactly the five golden games).
      command: 'node tests/e2e/e2e-server.mjs --fresh',
      url: 'http://127.0.0.1:8098/api/system/info',
      timeout: 300_000,
      reuseExistingServer: false,
      cwd: root,
      env: {
        SPARKADE_DATA: join(root, '.e2e-data'),
        SPARKADE_PORT: '8098',
        SPARKADE_PROVIDER: 'mock',
        SPARKADE_FORCE_PI: '1',
        // E2E is strictly local and must never publish mock games to the live site.
        SPARKADE_PUBLIC_ORIGIN: '',
        SPARKADE_KIOSK_API_KEY: '',
        // Speed up mock stage delays so the suite stays fast.
        SPARKADE_MOCK_FAST: '1',
      },
    },
    {
      // The controlled combat harness is deliberately unavailable in production.
      // Give it a separate dev shell backed by the same isolated mock API.
      command: 'npx vite --host 127.0.0.1 --port 5198 --strictPort',
      url: 'http://127.0.0.1:5198',
      cwd: join(root, 'packages', 'web'),
      reuseExistingServer: false,
      env: { SPARKADE_API_TARGET: 'http://127.0.0.1:8098' },
    },
  ],
});
