import { afterAll, expect, it } from 'vitest';
import { loadGolden } from '@sparkade/generation';
import {
  FIGHTER_COMBAT_PROFILES,
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
import { validateDesignSchema, validateGameSchema } from '../src/pipeline/validate';

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
