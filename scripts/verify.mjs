// `npm run verify` — typecheck + lint + unit tests + full build. Must pass cleanly.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { run } from './proc.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const steps = [
  ['typecheck', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']],
  ['lint', 'npx', ['eslint', '.']],
  ['unit tests', 'npx', ['vitest', 'run']],
  ['build', 'node', ['scripts/build.mjs']],
];

for (const [name, cmd, args] of steps) {
  console.log(`\nverify: ${name}`);
  await run(cmd, args, { cwd: root });
}
console.log('\nverify: all green ✔');
