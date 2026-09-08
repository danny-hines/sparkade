import { describe, expect, it } from 'vitest';
import { loadGolden } from '@sparkade/generation';
import { platformerStyleExample } from '@sparkade/archetypes';
import type { PlatformerSpec } from '@sparkade/shared';
import { lintPlatformer, analyzePlatformerTraversal } from '../../archetypes/src/platformer/lint';
import { compileTowerRoute } from '../src/pipeline/tower-routes';
import { compileTileRunsStage, compactLevelsStageSchema } from '../src/pipeline/tile-runs';
import { validateAgainst, normalizeGeneratedSpec } from '../src/pipeline/validate';

function route(direction = 'right', count = 6, rise = 8, width = 4) {
  return {
    direction,
    sections: Array.from({ length: count }, (_, i) => ({
      rise,
      width,
      enemy: ['none', 'walker', 'flyer', 'shooter', 'chaser'][i % 5],
      reward: i === 1 ? 'shield' : 'coins',
    })),
  };
}

describe('compiled tower routes', () => {
  it.each(
    ['left', 'right'].flatMap((direction) =>
      [5, 8].flatMap((count) =>
        [6, 12].flatMap((rise) => [3, 5].map((width) => ({ direction, count, rise, width }))),
      ),
    ),
  )(
    'connects every climb and summit at the bounds: $direction $count x $rise/$width',
    ({ direction, count, rise, width }) => {
      const geometry = compileTowerRoute(route(direction, count, rise, width));
      const level = { name: 'Test Tower', musicSong: 'theme', ...geometry };
      const result = analyzePlatformerTraversal(level, 2, { playStyle: 'towerClimber' });
      expect(result.reachable.has(`${level.exit.x},${level.exit.y}`)).toBe(true);
      expect(
        analyzePlatformerTraversal(level, 2).reachable.has(`${level.exit.x},${level.exit.y}`),
      ).toBe(false);
    },
  );
  it('compiles the model representation to a valid ordinary game, including rewards and checkpoints', () => {
    const raw = {
      levels: [0, 1, 2].map((i) => ({
        name: `Tower ${i}`,
        musicSong: 'theme',
        towerRoute: route(i % 2 ? 'left' : 'right'),
      })),
    };
    expect(
      validateAgainst('tower-stage-test', compactLevelsStageSchema('platformer'), raw),
    ).toEqual([]);
    const compiled = compileTileRunsStage('platformer', raw) as unknown as {
      levels: PlatformerSpec['levels'];
    };
    const spec = platformerStyleExample(loadGolden('platformer') as PlatformerSpec, 'towerClimber');
    spec.levels = compiled.levels;
    const normalized = normalizeGeneratedSpec(spec).spec as PlatformerSpec;
    expect(lintPlatformer(normalized)).toEqual([]);
    expect(JSON.stringify(compiled)).not.toContain('towerRoute');
  });
  it('rejects conflicting geometry and invalid section bounds instead of silently replacing them', () => {
    expect(() => compileTowerRoute(route('right', 5, 30))).toThrow('invalid tower section');
    expect(() =>
      compileTileRunsStage('platformer', { levels: [{ towerRoute: route(), tiles: ['bad'] }] }),
    ).toThrow('cannot be combined');
  });
});
