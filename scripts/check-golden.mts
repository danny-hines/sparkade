// Dev-time checker for golden games (and any game.json).
// Usage: npx tsx scripts/check-golden.mts [platformer|shooter|adventure|path.json ...]
// Runs the FULL validation gauntlet a generated game faces: JSON Schema (ajv) →
// security scan → custom-sprite checks → archetype lint (incl. content floors,
// reachability/topology and the five-minute duration rule).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchetypeId, GameSpec } from '@sparkade/shared';
import { archetypes } from '@sparkade/archetypes';
import {
  applySpriteFallbacks,
  securityScan,
  spriteProblem,
  validateGameSchema,
} from '../packages/server/src/pipeline/validate';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const targets = (args.length ? args : ['platformer', 'shooter', 'adventure', 'hshooter', 'fighter']).map((a) =>
  a.endsWith('.json') ? a : join(root, 'packages', 'generation', 'golden', `golden-${a}.json`),
);

let failed = false;
for (const path of targets) {
  console.log(`\n== ${path}`);
  let spec: GameSpec;
  try {
    spec = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`  PARSE ERROR: ${(e as Error).message}`);
    failed = true;
    continue;
  }
  const archetype = spec.archetype as ArchetypeId;
  const problems: string[] = [];

  for (const e of validateGameSchema(archetype, spec)) problems.push(`[SCHEMA] ${e.path}: ${e.message}`);
  if (problems.length === 0) {
    for (const e of securityScan(spec)) problems.push(`[${e.code}] ${e.path}: ${e.message}`);
    // Goldens must not rely on fallbacks: every custom sprite must be clean.
    for (const [id, sprite] of Object.entries(spec.sprites.custom)) {
      const p = spriteProblem(sprite);
      if (p) problems.push(`[SPRITE] custom "${id}": ${p} (goldens may not need fallbacks)`);
    }
    const { downgraded } = applySpriteFallbacks(spec);
    for (const d of downgraded) problems.push(`[SPRITE] would downgrade: ${d}`);
    for (const e of archetypes[archetype].lint(spec)) problems.push(`[${e.code}] ${e.path}: ${e.message}`);
    const duration = archetypes[archetype].estimateDurationS(spec);
    console.log(`  estimated interactive duration: ${Math.round(duration)}s (must be ≥ 300, target 360-540)`);
  }

  if (problems.length) {
    failed = true;
    console.error(`  ${problems.length} problem(s):`);
    for (const p of problems) console.error('   - ' + p);
  } else {
    console.log('  OK — passes every gate with zero repairs');
  }
}
process.exit(failed ? 1 : 0);
