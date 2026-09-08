import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DesignDoc, PlatformerSpec } from '@sparkade/shared';
import { mechanicalFingerprint } from '@sparkade/shared';
import { loadGolden } from '@sparkade/generation';
import { platformerStyleExample } from '@sparkade/archetypes';
import { designOutputDiagnostics } from '../src/pipeline/runner';
import {
  buildDesignPrompt,
  buildEntitiesPrompt,
  buildLevelsPrompt,
  buildLevelRegenerationPrompt,
} from '../src/pipeline/prompts';
import { repairPlatformerExitRoutes, validateGameSchema } from '../src/pipeline/validate';
import { assertPatchTargetsOwner } from '../src/pipeline/repair-policy';
import { MockProvider } from '../src/providers/mock';

const previousFast = process.env.SPARKADE_MOCK_FAST;
beforeAll(() => {
  process.env.SPARKADE_MOCK_FAST = '1';
});
afterAll(() => {
  if (previousFast === undefined) delete process.env.SPARKADE_MOCK_FAST;
  else process.env.SPARKADE_MOCK_FAST = previousFast;
});

async function mockDesign(
  promptText: string,
  recent = [] as ReturnType<typeof mechanicalFingerprint>[],
): Promise<DesignDoc> {
  const prompt = buildDesignPrompt({
    promptText,
    hasPhoto: false,
    describeInStory: false,
    antiCollision: [],
    recentMechanics: recent,
    extraNote: 'REQUIRED ARCHETYPE: platformer',
  });
  const result = await new MockProvider('styles-test').complete({ ...prompt });
  return JSON.parse(result.text) as DesignDoc;
}

describe('generation package contracts', () => {
  it('accepts bottom spawns and entities beyond row 63 in a tall tower', () => {
    const tower = platformerStyleExample(
      loadGolden('platformer') as PlatformerSpec,
      'towerClimber',
    );
    for (const level of tower.levels) {
      level.tiles = [...Array<string>(32).fill('.'.repeat(32)), ...level.tiles];
      level.playerSpawn.y += 32;
      level.exit.y += 32;
      for (const entity of level.entities) entity.y += 32;
    }
    expect(validateGameSchema('platformer', tower)).toEqual([]);
  });
  it('checks incompatible loadouts during design, before level or image work', async () => {
    const design = await mockDesign('A platformer with a blaster');
    expect(design.playStyle).toBe('runAndGun');
    expect(designOutputDiagnostics(design)).toEqual([]);
    expect(
      designOutputDiagnostics({
        ...design,
        abilityLoadout: [{ kind: 'shield', name: 'Shield', visualConcept: 'A bright shield' }],
      }),
    ).toContainEqual(expect.objectContaining({ code: 'PLAT_STYLE_LOADOUT' }));
    expect(
      designOutputDiagnostics({ ...design, playStyle: 'towerClimber', movementProfile: 'floaty' }),
    ).toContainEqual(expect.objectContaining({ code: 'PLAT_STYLE_MOVEMENT' }));
  });

  it('uses history as a preference while preserving explicit requested mechanics', async () => {
    const recent = [
      mechanicalFingerprint(
        platformerStyleExample(loadGolden('platformer') as PlatformerSpec, 'runAndGun'),
      ),
    ];
    expect((await mockDesign('A platformer about a chef', recent)).playStyle).toBe('acrobat');
    expect((await mockDesign('A platformer with a blaster', recent)).playStyle).toBe('runAndGun');
  });

  it('keeps the tower brief in level generation, regeneration and boss authoring', async () => {
    const design = await mockDesign('A wall-jumping tower platformer');
    expect(design.playStyle).toBe('towerClimber');
    expect(buildLevelsPrompt('platformer', design).user).toContain('at least 24 rows above');
    expect(buildEntitiesPrompt('platformer', design, false).user).toContain('exposed side walls');
    expect(buildLevelRegenerationPrompt('platformer', design, 0, [], []).user).toContain(
      'towerClimber',
    );
  });

  it('prevents both patch repair and corridor fallback from erasing the selected style', () => {
    expect(() =>
      assertPatchTargetsOwner(
        [{ op: 'replace', path: '/playStyle', value: 'acrobat' }],
        'document',
        [{ code: 'X', path: '/playStyle', message: 'bad' }],
      ),
    ).toThrow('preserve');
    const tower = platformerStyleExample(
      loadGolden('platformer') as PlatformerSpec,
      'towerClimber',
    );
    const before = structuredClone(tower);
    const fallback = repairPlatformerExitRoutes(tower, [0]);
    expect(fallback.spec).toEqual(before);
    expect(fallback.fixes).toEqual([]);
  });
});
