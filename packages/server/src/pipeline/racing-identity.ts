import { isDeepStrictEqual } from 'node:util';
import type { DesignDoc, GameSpec, LintError } from '@sparkade/shared';

/** Stable roster slots own names; generated course abbreviations cannot rename them. */
export function alignRacingCast(spec: GameSpec): GameSpec {
  if (spec.archetype !== 'racing' || !spec.identity || !Array.isArray(spec.levels)) return spec;
  const names = spec.identity.rivalCrafts.map((craft) => craft.name);
  return {
    ...spec,
    levels: spec.levels.map((level) =>
      level && Array.isArray(level.rivals)
        ? {
            ...level,
            rivals: level.rivals.map((rival, i) =>
              rival && typeof names[i] === 'string' ? { ...rival, name: names[i]! } : rival,
            ),
          }
        : level,
    ),
    boss:
      spec.boss && typeof names[spec.boss.rivalIndex - 1] === 'string'
        ? { ...spec.boss, name: names[spec.boss.rivalIndex - 1]! }
        : spec.boss,
  };
}

/** Repair may fix a course, but cannot replace the game's committed identity. */
export function racingIdentityProblems(spec: GameSpec, design: DesignDoc): LintError[] {
  // Legacy validated checkpoints have no identity; newly authored racing
  // designs require it through the design schema.
  if (spec.archetype !== 'racing' || !design.racingIdentity) return [];
  if (isDeepStrictEqual(spec.identity, design.racingIdentity)) return [];
  return [
    {
      code: 'RACING_IDENTITY_CHANGED',
      path: '/identity',
      message:
        'The validated racing game must preserve the design-selected pilot, world, vehicles, sound and boost supply.',
    },
  ];
}
