import { afterAll, describe, expect, it } from 'vitest';
import { loadGolden } from '@sparkade/generation';
import { SHOOTER_PLAY_STYLES, type DesignDoc, type ShooterSpec } from '@sparkade/shared';
import { shooterStyleExample } from '@sparkade/archetypes';
import {
  buildDesignPrompt,
  buildLevelsPrompt,
  buildEntitiesPrompt,
  buildRepairPrompt,
} from '../src/pipeline/prompts';
import { MockProvider } from '../src/providers/mock';
import { validateDesignSchema, validateGameSchema } from '../src/pipeline/validate';
import { lintShooter } from '../../archetypes/src/shooter/lint';

const previousFast = process.env.SPARKADE_MOCK_FAST;
process.env.SPARKADE_MOCK_FAST = '1';
afterAll(() => {
  if (previousFast === undefined) delete process.env.SPARKADE_MOCK_FAST;
  else process.env.SPARKADE_MOCK_FAST = previousFast;
});

describe('shooter generation contract', () => {
  it.each(SHOOTER_PLAY_STYLES)(
    'preserves %s from design through stage authoring and repair context',
    async (style) => {
      const provider = new MockProvider('test');
      const prompt = buildDesignPrompt({
        promptText: `Vertical shooter with shooterStyle ${style}`,
        hasPhoto: false,
        describeInStory: false,
        antiCollision: [],
        creationBrief: { version: 1, archetype: 'shooter' },
      });
      const response = await provider.complete(prompt);
      const design = JSON.parse(response.text) as DesignDoc;
      expect(validateDesignSchema(design)).toEqual([]);
      expect(design.shooterStyle).toBe(style);
      const levelsPrompt = buildLevelsPrompt('shooter', design);
      const levels = JSON.parse((await provider.complete(levelsPrompt)).text);
      const spec = {
        ...shooterStyleExample(loadGolden('shooter') as ShooterSpec, style),
        levels: levels.levels,
      };
      expect(validateGameSchema('shooter', spec)).toEqual([]);
      expect(lintShooter(spec)).toEqual([]);
      expect(buildEntitiesPrompt('shooter', design, false).user).toContain(
        `COMMITTED SHOOTER KIT: ${style}`,
      );
      expect(
        buildRepairPrompt(
          'shooter',
          spec,
          [
            {
              code: 'SHOOT_STYLE_ENCOUNTERS',
              path: '/levels/0/waves',
              message: 'Missing signature',
            },
          ],
          'levels',
        ).user,
      ).toContain(`COMMITTED SHOOTER KIT: ${style}`);
    },
  );
});
