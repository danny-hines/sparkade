import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mechanicalFingerprint,
  type PlatformerSpec,
  type PresentationFamily,
} from '@sparkade/shared';
import { atomicWriteFile } from '../util';
import type { GameFiles } from './files';

/** A conservative theme-based choice for saves created before presentation families. */
export function migratedPresentationFamily(spec: PlatformerSpec): PresentationFamily {
  const premise = `${spec.meta.title} ${spec.meta.tagline} ${spec.meta.heroConcept ?? ''} ${spec.story.intro.join(' ')}`;
  if (
    /\b(robot|robotic|cyber|reactor|spaceship|space station|galactic|laser|android|circuit)\b/i.test(
      premise,
    )
  )
    return 'tech';
  if (
    /\b(fairy|fairies|enchanted|magic|magical|wizard|witch|forest|storybook|lantern|dragon)\b/i.test(
      premise,
    )
  )
    return 'storybook';
  if (spec.backdrop === 'circuit' || spec.backdrop === 'factory' || spec.backdrop === 'starfield')
    return 'tech';
  if (spec.backdrop === 'hills' || spec.backdrop === 'candy') return 'storybook';
  return 'arcade';
}

/** Idempotent boot migration. Only presentation metadata changes; game IDs and scores stay put. */
export function migratePlatformerPresentations(
  files: GameFiles,
  games: readonly { id: string; status: string }[],
): { migrated: number; failed: string[] } {
  let migrated = 0;
  const failed: string[] = [];
  for (const game of games) {
    if (game.status !== 'ready') continue;
    try {
      const spec = files.readSpec(game.id);
      if (spec?.archetype !== 'platformer') continue;
      const dir = files.gameDir(game.id);
      const backup = join(dir, 'presentation-before-v1.json');
      if (!spec.presentationFamily) {
        // Keep exact original bytes for recovery, and never replace the first backup.
        if (!existsSync(backup)) atomicWriteFile(backup, readFileSync(join(dir, 'game.json')));
        spec.presentationFamily = migratedPresentationFamily(spec);
        files.writeSpec(game.id, spec);
        migrated++;
      }
      // A retry after a power cut between these two atomic writes repairs the fingerprint.
      if (existsSync(backup))
        atomicWriteFile(
          join(dir, 'mechanics.json'),
          `${JSON.stringify(mechanicalFingerprint(spec), null, 2)}\n`,
        );
    } catch {
      failed.push(game.id);
    }
  }
  return { migrated, failed };
}
