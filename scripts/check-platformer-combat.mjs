import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkPlatformerCombat,
  checkAuthoredPlatformerTargets,
} from '../tests/helpers/platformer-combat.js';

const batchPath = process.argv[2];
if (!batchPath)
  throw new Error(
    'Usage: node scripts/check-platformer-combat.mjs <batch.json> [output-directory]',
  );
const output = resolve(process.argv[3] ?? 'data/experiments/platformer-combat');
mkdirSync(output, { recursive: true });
const session = `platformer-combat-${process.pid}`;
const run = (args, input) =>
  execFileSync('agent-browser', ['--session', session, ...args], {
    encoding: 'utf8',
    timeout: 45000,
    ...(input ? { input } : {}),
  });
const checks = [];
try {
  let first = true;
  for (const game of JSON.parse(readFileSync(batchPath, 'utf8')).games.filter(
    (g) => g.status === 'done',
  )) {
    run([...(first ? ['--args', '--mute-audio'] : []), 'open', game.localUrl]);
    first = false;
    run(['wait', '--fn', '!!window.sparkadePlaytest?.instance']);
    const check = JSON.parse(run(['eval', '--stdin'], `(${checkPlatformerCombat.toString()})()`));
    if (process.argv.includes('--authored'))
      check.authored = JSON.parse(
        run(['eval', '--stdin'], `(${checkAuthoredPlatformerTargets.toString()})()`),
      );
    check.gameId = game.gameId;
    check.browserErrors = run(['errors']);
    writeFileSync(resolve(output, `${game.gameId}.json`), JSON.stringify(check, null, 2) + '\n');
    checks.push(check);
    console.log(
      JSON.stringify({
        gameId: game.gameId,
        title: check.title,
        passed: check.results.filter((r) => r.pass).length,
        total: check.results.length,
        failures: check.results.filter((r) => !r.pass),
        authored: check.authored
          ? {
              total: check.authored.results.length,
              failures: check.authored.results.filter((r) => !r.pass),
            }
          : undefined,
      }),
    );
  }
} finally {
  try {
    run(['close']);
  } catch {
    /* Session may already have exited. */
  }
}
writeFileSync(resolve(output, 'summary.json'), JSON.stringify(checks, null, 2) + '\n');
if (
  checks.some(
    (c) =>
      c.browserErrors || c.results.some((r) => !r.pass) || c.authored?.results.some((r) => !r.pass),
  )
)
  process.exitCode = 1;
