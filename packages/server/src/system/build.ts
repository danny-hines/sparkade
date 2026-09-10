import { spawnSync } from 'node:child_process';
import { repoRoot } from '../util';

declare const __SPARKADE_BUILD_COMMIT__: string | null;

/** Production embeds this at build time: a later git pull cannot relabel a running binary. */
export function readBuildCommit(): string | null {
  if (typeof __SPARKADE_BUILD_COMMIT__ !== 'undefined') return __SPARKADE_BUILD_COMMIT__;
  const result = spawnSync('git', ['-C', repoRoot(), 'rev-parse', '--verify', 'HEAD'], {
    encoding: 'utf8',
    timeout: 2_000,
  });
  const value = result.stdout?.trim();
  return result.status === 0 && /^[a-f0-9]{40,64}$/i.test(value ?? '') ? value : null;
}
