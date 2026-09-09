import {
  PLATFORMER_ENCOUNTERS,
  PLATFORMER_ENCOUNTER_IDS,
  encounterModifiers,
  platformerMechanics,
  type EncounterEnemy,
  type PlatformerEncounterRoute,
  type PlatformerSpec,
} from '@sparkade/shared';

/** Deterministic compositions exercise the production compiler during zero-cost tests. */
export function mockEncounterLevels(spec: PlatformerSpec) {
  const style = spec.playStyle ?? 'acrobat',
    kit = platformerMechanics(spec);
  return [0, 1, 2].map((li) => {
    const orientation =
      kit.structure === 'tower' || (kit.structure === 'mixed' && li === 1) ? 'tower' : 'horizontal';
    const patterns = PLATFORMER_ENCOUNTER_IDS.filter(
      (id) =>
        PLATFORMER_ENCOUNTERS[id].styles.includes(style) &&
        PLATFORMER_ENCOUNTERS[id].orientation === orientation,
    );
    const encounterRoute: PlatformerEncounterRoute = {
      orientation,
      direction: li % 2 ? 'left' : 'right',
      sections: Array.from({ length: 6 }, (_, i) => {
        const pattern = patterns[(i + li) % patterns.length]!,
          p = PLATFORMER_ENCOUNTERS[pattern];
        const desired: EncounterEnemy = (['walker', 'flyer', 'shooter', 'chaser'] as const)[
          (i + li * 2) % 4
        ]!;
        return {
          pattern,
          variant: ((i + li) % 3) as 0 | 1 | 2,
          modifier:
            i % 2
              ? 'none'
              : (encounterModifiers(pattern)[
                  1 + ((i + li) % Math.max(1, encounterModifiers(pattern).length - 1))
                ] ?? 'none'),
          challenge: i === 0 ? 'introduce' : i === 5 ? 'test' : 'develop',
          enemy: p.enemies.includes(desired) ? desired : p.enemies[1]!,
          reward:
            i === 1
              ? (spec.abilityLoadout?.[li % Math.max(1, spec.abilityLoadout.length)]?.kind ??
                'projectile')
              : i === 4
                ? 'heart'
                : 'coins',
        };
      }),
    };
    return { name: `Encounter ${li + 1}`, musicSong: 'theme', encounterRoute };
  });
}
