// `npm run build` — production build:
//   1. web shell     → packages/web/dist          (browser bundle, served by Fastify)
//   2. server        → packages/server/dist       (single Node ESM bundle; native deps external)
//   3. cli           → packages/cli/dist          (single Node ESM bundle)
// Engine/archetypes/shared/generation are bundled into their consumers; prompts and golden
// games are read from the repo at runtime (the Pi runs from /opt/sparkade).
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { run } from './proc.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

console.log('build 1/3: web shell');
await run('npx', ['vite', 'build'], { cwd: join(root, 'packages', 'web') });

console.log('build 2/3: server');
await run('npx', ['vite', 'build'], { cwd: join(root, 'packages', 'server') });

console.log('build 3/3: cli');
await run('npx', ['vite', 'build'], { cwd: join(root, 'packages', 'cli') });

console.log('build: done');
