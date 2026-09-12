import { afterAll, expect, it } from 'vitest';
import { loadGolden } from '@sparkade/generation';
import {
  FIGHTER_COMBAT_PROFILES,
  FIGHTER_PROJECTILE_KINDS,
  fighterProjectile,
  stageSchema,
  fighterStyleExample,
  type DesignDoc,
  type FighterSpec,
} from '@sparkade/shared';
import {
  buildDesignPrompt,
  buildLevelsPrompt,
  buildEntitiesPrompt,
  buildRepairPrompt,
} from '../src/pipeline/prompts';
import { MockProvider } from '../src/providers/mock';
import {
  validateDesignSchema,
  validateGameSchema,
  validateAgainst,
} from '../src/pipeline/validate';

const previousFast = process.env.SPARKADE_MOCK_FAST;
process.env.SPARKADE_MOCK_FAST = '1';
afterAll(() => {
  if (previousFast === undefined) delete process.env.SPARKADE_MOCK_FAST;
  else process.env.SPARKADE_MOCK_FAST = previousFast;
});

it.each(FIGHTER_COMBAT_PROFILES)(
  'preserves %s through design, roster, boss and scoped repair',
  async (style) => {
    const provider = new MockProvider('test');
    const design = JSON.parse(
      (
        await provider.complete(
          buildDesignPrompt({
            promptText: `A ${style === 'counter' ? 'counter fighter' : style} hero in a rooftop tournament`,
            hasPhoto: false,
            describeInStory: false,
            antiCollision: [],
            creationBrief: { version: 1, archetype: 'fighter' },
          }),
        )
      ).text,
    ) as DesignDoc;
    expect(validateDesignSchema(design)).toEqual([]);
    expect(design.fighterStyle).toBe(style);
    const roster = JSON.parse((await provider.complete(buildLevelsPrompt('fighter', design))).text);
    const entitiesPrompt = buildEntitiesPrompt('fighter', design, false);
    const entities = JSON.parse((await provider.complete(entitiesPrompt)).text);
    const spec = {
      ...fighterStyleExample(loadGolden('fighter') as FighterSpec, style),
      ...roster,
      ...entities,
    } as FighterSpec;
    expect(validateGameSchema('fighter', spec)).toEqual([]);
    expect(spec.player.combatProfile).toBe(style);
    for (const character of [spec.player, ...spec.levels.map((l) => l.opponent), spec.boss])
      if (character.combatProfile === 'rangedControl')
        expect(character.projectile?.kind).toBeTruthy();
    expect(entitiesPrompt.user).toContain(`COMMITTED FIGHTER STYLE: ${style}`);
    expect(
      buildRepairPrompt(
        'fighter',
        spec,
        [{ code: 'FIGHT_MATCHUP_VARIETY', path: '/levels', message: 'Missing counter matchup' }],
        'levels',
      ).user,
    ).toContain(`COMMITTED FIGHTER STYLE: ${style}`);
  },
);

it.each(FIGHTER_PROJECTILE_KINDS)(
  'accepts a named %s and rejects model-authored damage',
  (kind) => {
    const spec = fighterStyleExample(loadGolden('fighter') as FighterSpec, 'rangedControl');
    spec.player.projectile = { kind, name: 'Forge Flare' };
    expect(validateGameSchema('fighter', spec)).toEqual([]);
    const invalid = structuredClone(spec) as any;
    invalid.player.projectile.damage = 1000;
    expect(validateGameSchema('fighter', invalid).map((e) => e.path)).toContain(
      '/player/projectile/damage',
    );
  },
);

it('requires a projectile in new roster/boss generation while keeping old saved ranged games valid', () => {
  const spec = fighterStyleExample(loadGolden('fighter') as FighterSpec, 'rangedControl');
  delete spec.player.projectile;
  expect(validateGameSchema('fighter', spec)).toEqual([]);
  expect(fighterProjectile(spec.player)).toEqual({ kind: 'energyBlast', name: 'Energy blast' });
  expect(
    validateAgainst('fighter-projectile-roster-test', stageSchema('fighter', 'levels'), {
      player: spec.player,
      levels: spec.levels,
    }).map((e) => e.path),
  ).toContain('/player/projectile');
  spec.boss.combatProfile = 'rangedControl';
  delete spec.boss.projectile;
  expect(
    validateAgainst('fighter-projectile-boss-test', stageSchema('fighter', 'entities'), {
      sprites: spec.sprites,
      boss: spec.boss,
    }).map((e) => e.path),
  ).toContain('/boss/projectile');
});

it('bounds names and retains the story-specific projectile in repair context', () => {
  const spec = fighterStyleExample(loadGolden('fighter') as FighterSpec, 'rangedControl');
  spec.player.projectile = { kind: 'fireball', name: 'Phoenix Flare' };
  const repair = buildRepairPrompt(
    'fighter',
    spec,
    [{ code: 'FIGHT_MATCHUP_VARIETY', path: '/levels', message: 'Missing counter matchup' }],
    'levels',
  );
  expect(repair.user).toContain('Phoenix Flare');
  expect(repair.user).toContain('fireball');
  spec.player.projectile.name = 'A hugely overlong magical projectile name';
  expect(validateGameSchema('fighter', spec).map((e) => e.path)).toContain(
    '/player/projectile/name',
  );
});
