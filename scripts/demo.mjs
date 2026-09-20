// `npm run demo` — mock flow; --live-voice opts only transcription into the configured provider.
// Builds the shell (if needed), then starts the real server serving it on :8080.
// The mock provider travels through the same durable pipeline, validators, SSE and cost ledger.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { run, launch, superviseAll } from './proc.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webDist = join(root, 'packages', 'web', 'dist', 'index.html');
const liveVoice = process.argv.includes('--live-voice');

const fresh = process.argv.includes('--fresh') || !existsSync(webDist);
if (fresh) {
  console.log('demo: building web shell…');
  await run('npx', ['vite', 'build'], { cwd: join(root, 'packages', 'web') });
}

const server = launch('npx', ['tsx', 'packages/server/src/index.ts'], {
  cwd: root,
  env: {
    SPARKADE_PROVIDER: 'mock',
    // Explicit opt-in only: inherited environment must not make ordinary demos/E2E call STT.
    SPARKADE_DEMO_LIVE_VOICE: liveVoice ? '1' : '0',
    SPARKADE_DATA: process.env.SPARKADE_DATA ?? 'data',
    SPARKADE_SERVE_STATIC: '1',
  },
});

superviseAll([server]);
console.log(
  `\n  Sparkade demo (${liveVoice ? 'mock games, LIVE voice transcription' : 'mock provider'}): http://127.0.0.1:${process.env.SPARKADE_PORT ?? '8080'}\n`,
);
