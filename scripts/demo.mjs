// `npm run demo` — full end-to-end flow against the MOCK provider: no API key, no network.
// Builds the shell (if needed), then starts the real server serving it on :8080.
// The mock provider travels through the same durable pipeline, validators, SSE and cost ledger.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { run, launch, superviseAll } from './proc.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webDist = join(root, 'packages', 'web', 'dist', 'index.html');

const fresh = process.argv.includes('--fresh') || !existsSync(webDist);
if (fresh) {
  console.log('demo: building web shell…');
  await run('npx', ['vite', 'build'], { cwd: join(root, 'packages', 'web') });
}

const server = launch('npx', ['tsx', 'packages/server/src/index.ts'], {
  cwd: root,
  env: {
    SPARKADE_PROVIDER: 'mock',
    SPARKADE_DATA: process.env.SPARKADE_DATA ?? 'data',
    SPARKADE_SERVE_STATIC: '1',
  },
});

superviseAll([server]);
console.log('\n  Sparkade demo (mock provider): http://127.0.0.1:8080\n');
