import { mockEncounterLevels } from '../src/providers/mock-encounters';
import { describe, expect, it } from 'vitest';
import { loadGolden } from '@sparkade/generation';
import { compilePlatformerEncounterRoute, platformerStyleExample } from '@sparkade/archetypes';
import {
  PLATFORMER_ENCOUNTERS,
  PLATFORMER_ENCOUNTER_IDS,
  encounterPreference,
  mechanicalFingerprint,
  type PlatformerEncounterId,
  type PlatformerEncounterRoute,
  type PlatformerSpec,
} from '@sparkade/shared';
import { lintPlatformer, analyzePlatformerTraversal } from '../../archetypes/src/platformer/lint';
import { compileTileRunsStage, compactLevelsStageSchema } from '../src/pipeline/tile-runs';
import {
  validateAgainst,
  normalizeGeneratedSpec,
  validateGameSchema,
} from '../src/pipeline/validate';

function route(
  pattern: PlatformerEncounterId,
  variant: 0 | 1 | 2,
  direction: 'left' | 'right',
): PlatformerEncounterRoute {
  const p = PLATFORMER_ENCOUNTERS[pattern];
  const others = PLATFORMER_ENCOUNTER_IDS.filter(
    (id) =>
      id !== pattern &&
      PLATFORMER_ENCOUNTERS[id].orientation === p.orientation &&
      PLATFORMER_ENCOUNTERS[id].styles.includes(p.styles[0]!),
  );
  return {
    orientation: p.orientation,
    direction,
    sections: [pattern, others[0]!, others[1]!, pattern, others[0]!, others[1]!].map((id, i) => ({
      pattern: id,
      variant,
      challenge: i === 0 ? 'introduce' : i === 5 ? 'test' : 'develop',
      enemy:
        PLATFORMER_ENCOUNTERS[id].enemies[
          (i % (PLATFORMER_ENCOUNTERS[id].enemies.length - 1)) + 1
        ]!,
      reward: 'coins',
    })),
  };
}

describe('compiled platformer encounters', () => {
  it.each(['acrobat', 'runAndGun', 'towerClimber', 'meleeAction', 'armedClimber'] as const)(
    'validates a complete three-level %s composition',
    (style) => {
      const spec = platformerStyleExample(loadGolden('platformer') as PlatformerSpec, style);
      spec.encounterVersion = 1;
      spec.levels = (
        compileTileRunsStage('platformer', { levels: mockEncounterLevels(spec) }) as unknown as {
          levels: PlatformerSpec['levels'];
        }
      ).levels;
      expect(validateGameSchema('platformer', spec)).toEqual([]);
      const normalized = normalizeGeneratedSpec(spec);
      expect(
        lintPlatformer(normalized.spec as PlatformerSpec),
        JSON.stringify(normalized.fixes),
      ).toEqual([]);
    },
  );
  it.each(
    PLATFORMER_ENCOUNTER_IDS.flatMap((pattern) =>
      [0, 1, 2].flatMap((variant) =>
        ['left', 'right'].map((direction) => ({
          pattern,
          variant: variant as 0 | 1 | 2,
          direction: direction as 'left' | 'right',
        })),
      ),
    ),
  )(
    '$pattern variant $variant $direction has a connected route and stable provenance',
    ({ pattern, variant, direction }) => {
      const r = route(pattern, variant, direction);
      const level = {
        name: 'Encounter test',
        musicSong: 'theme',
        ...compilePlatformerEncounterRoute(r),
      };
      const style = PLATFORMER_ENCOUNTERS[pattern].styles[0]!;
      const result = analyzePlatformerTraversal(level, 2, { playStyle: style });
      expect(
        result.reachable.has(`${level.exit.x},${level.exit.y}`),
        JSON.stringify({ pattern, variant, direction }),
      ).toBe(true);
      if (r.orientation === 'tower')
        expect(
          analyzePlatformerTraversal(level, 2).reachable.has(`${level.exit.x},${level.exit.y}`),
        ).toBe(false);
      const spec = platformerStyleExample(loadGolden('platformer') as PlatformerSpec, style);
      spec.encounterVersion = 1;
      spec.levels = [level];
      if (spec.mechanics?.structure === 'mixed') spec.mechanics.structure = r.orientation;
      spec.abilityLoadout = undefined;
      const normalization = normalizeGeneratedSpec(spec);
      const normalized = normalization.spec as PlatformerSpec;
      // This fixture isolates geometry, not the across-game enemy/powerup quotas.
      const errors = lintPlatformer(normalized).filter(
        (e) =>
          ![
            'DURATION_TOO_SHORT',
            'PLAT_FLOOR_ENEMY_TYPES',
            'PLAT_FLOOR_POWERUP',
            'PLAT_STYLE_LOADOUT',
          ].includes(e.code),
      );
      expect(errors, JSON.stringify(normalization.fixes)).toEqual([]);
    },
    20000,
  );
  it('keeps variants physically distinct, not just different labels', () => {
    for (const id of PLATFORMER_ENCOUNTER_IDS) {
      const maps = [0, 1, 2].map((v) =>
        compilePlatformerEncounterRoute(route(id, v as 0 | 1 | 2, 'right')).tiles.join('\n'),
      );
      expect(new Set(maps).size, id).toBe(3);
    }
  });
  it('rejects unsafe edits and stale or removed provenance', () => {
    const spec = platformerStyleExample(loadGolden('platformer') as PlatformerSpec, 'runAndGun');
    spec.encounterVersion = 1;
    spec.levels = [
      {
        name: 'Safety',
        musicSong: 'theme',
        ...compilePlatformerEncounterRoute(route('cover-advance', 0, 'right')),
      },
    ];
    const level = spec.levels[0]!;
    level.entities.push({ type: 'shooter', ...level.playerSpawn, props: { fireIntervalMs: 300 } });
    expect(lintPlatformer(spec).map((e) => e.code)).toEqual(
      expect.arrayContaining([
        'PLAT_ENCOUNTER_DRIFT',
        'PLAT_ENCOUNTER_UNSAFE_ANCHOR',
        'PLAT_ENCOUNTER_VOLLEY',
      ]),
    );
    delete level.encounters;
    expect(lintPlatformer(spec).map((e) => e.code)).toContain('PLAT_ENCOUNTER_MISSING');
  });
  it('compiles the generation schema and rejects mixed raw geometry', () => {
    const raw = {
      levels: Array.from({ length: 3 }, () => ({
        name: 'Compiled',
        musicSong: 'theme',
        encounterRoute: route('high-low', 1, 'left'),
      })),
    };
    expect(
      validateAgainst('encounters-only-test', compactLevelsStageSchema('platformer', true), raw),
    ).toEqual([]);
    const compiled = compileTileRunsStage('platformer', raw) as unknown as {
      levels: PlatformerSpec['levels'];
    };
    const spec = loadGolden('platformer') as PlatformerSpec;
    spec.encounterVersion = 1;
    spec.levels = compiled.levels;
    expect(validateGameSchema('platformer', spec)).toEqual([]);
    expect(() =>
      compileTileRunsStage('platformer', { levels: [{ ...raw.levels[0], tiles: ['bad'] }] }),
    ).toThrow('cannot be combined');
    expect(raw.levels[0]).not.toHaveProperty('encounters');
    expect(compiled.levels[0]).toHaveProperty('encounters.version', 1);
  });
  it('uses delivered pattern and variant history in generation preferences', () => {
    const spec = loadGolden('platformer') as PlatformerSpec;
    spec.levels = [
      {
        name: 'Past',
        musicSong: 'theme',
        ...compilePlatformerEncounterRoute(route('bounce-run', 1, 'right')),
      },
    ];
    const fingerprint = mechanicalFingerprint(spec);
    expect(fingerprint.encounters).toContain('pattern:bounce-run');
    expect(fingerprint.encounters).toContain('variant:bounce-run:1');
    expect(encounterPreference('acrobat', [fingerprint])[0]).not.toBe('bounce-run');
  });
});
