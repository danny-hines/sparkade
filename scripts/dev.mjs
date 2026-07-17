// `npm run dev` — Fastify server via tsx watch + Vite dev server for the shell (proxying /api).
// Keyboard controls, mock-free by default; set SPARKADE_PROVIDER=mock yourself if you want.
import { launch, superviseAll } from './proc.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const server = launch(
  'npx',
  [
    'tsx',
    'watch',
    '--exclude',
    'packages/archetypes/src/fighter/outfits.json',
    'packages/server/src/index.ts',
  ],
  {
    cwd: root,
    env: {
      SPARKADE_DEV: '1',
      SPARKADE_DATA: process.env.SPARKADE_DATA ?? 'data',
    },
  },
);

const web = launch('npx', ['vite', 'dev'], {
  cwd: `${root}/packages/web`,
});

superviseAll([server, web]);
console.log('\n  Sparkade dev: shell on http://127.0.0.1:5173  ·  API on http://127.0.0.1:8080\n');
