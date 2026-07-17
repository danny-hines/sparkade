import { describe, expect, it } from 'vitest';
import type { DesignDoc } from '@sparkade/shared';
import { buildEntitiesPrompt, buildLevelsPrompt } from '../src/pipeline/prompts';

const design = {
  title: 'Likeness Test',
  archetype: 'platformer',
} as DesignDoc;

describe('entities prompt likeness casting', () => {
  it('reserves compatible built-in hero bodies for photo platformers', () => {
    const withPhoto = buildEntitiesPrompt('platformer', design, true).user;
    expect(withPhoto).toContain('LIKENESS BODY REQUIREMENT');
    expect(withPhoto).toContain('sprites.assign.hero');
    expect(withPhoto).toContain('lib:hero_*');

    expect(buildEntitiesPrompt('platformer', design, false).user).not.toContain(
      'LIKENESS BODY REQUIREMENT',
    );
    expect(buildEntitiesPrompt('adventure', design, true).user).not.toContain(
      'LIKENESS BODY REQUIREMENT',
    );
  });

  it('requires new fighter rosters to include a styled player and a slot-11 boss', () => {
    const fighterDesign = { ...design, archetype: 'fighter' } as DesignDoc;
    const levels = buildLevelsPrompt('fighter', fighterDesign);
    const levelSchema = levels.jsonSchema as {
      required: string[];
      $defs: Record<string, { required?: string[] }>;
    };
    expect(levelSchema.required).toEqual(['player', 'levels']);
    expect(levelSchema.$defs.fighter!.required).toContain('outfit');
    expect(levels.system).toContain('`wrestler`');

    const entitySchema = buildEntitiesPrompt('fighter', fighterDesign, true).jsonSchema as {
      $defs: Record<string, { properties?: Record<string, { const?: number }> }>;
    };
    expect(entitySchema.$defs.boss!.properties!.colorSlot?.const).toBe(11);
  });
});
