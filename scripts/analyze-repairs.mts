// Read-only reliability report for generated games, durable repair events and
// raw stage checkpoints.
// Usage: npm run analyze:repairs -- [--data path] [--json]
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeRepairData,
  formatRepairAnalysis,
} from '../packages/server/src/pipeline/repair-analysis';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
let selectedDir = process.env.SPARKADE_DATA ?? join(root, 'data');
let json = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === '--json') {
    json = true;
  } else if (arg === '--data') {
    const value = args[++i];
    if (!value) throw new Error('--data requires a path');
    selectedDir = value;
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: npm run analyze:repairs -- [--data path] [--json]');
    process.exit(0);
  } else {
    throw new Error(`unknown argument: ${arg}`);
  }
}

const dir = isAbsolute(selectedDir) ? selectedDir : resolve(root, selectedDir);
if (!existsSync(dir)) throw new Error(`Sparkade data directory does not exist: ${dir}`);

const report = analyzeRepairData(dir);
process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatRepairAnalysis(report));
