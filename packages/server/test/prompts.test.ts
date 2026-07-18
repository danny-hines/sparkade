import { describe, expect, it } from 'vitest';
import type { DesignDoc } from '@sparkade/shared';
import {
  buildEntitiesPrompt,
  buildLevelRegenerationPrompt,
  buildLevelsPrompt,
  buildRepairPrompt,
} from '../src/pipeline/prompts';

const design = {
  title: 'Likeness Test',
  archetype: 'platformer',
} as DesignDoc;

describe('entities prompt likeness casting', () => {
  it('reserves compatible built-in hero bodies for photo platformers', () => {
    const prompt = buildEntitiesPrompt('platformer', design, true);
    const withPhoto = prompt.user;
    expect(withPhoto).toContain('LIKENESS BODY REQUIREMENT');
    expect(withPhoto).toContain('sprites.assign.hero');
    expect(withPhoto).toContain('lib:hero_*');
    expect(prompt.timeoutMs).toBe(120_000);

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

  it('teaches platformer art generation the engine-selected solid cap and inner pair', () => {
    const system = buildEntitiesPrompt('platformer', design, false).system;

    expect(system).toContain('tile_solid, tile_solid_inner');
    expect(system).toContain('`tile_solid` is the exposed cap');
    expect(system).toContain('`tile_solid_inner` is the buried fill');
    expect(system).toContain('Each custom cap and inner sprite must be EXACTLY 16×16');
    expect(system).toContain('Level generation still authors only semantic `solid` cells');
    expect(system).toContain('the engine selects the cap');
  });

  it('uses compact run rows for large generated tile grids', () => {
    const prompt = buildLevelsPrompt('platformer', design);
    const level = (prompt.jsonSchema as { $defs: Record<string, { required: string[] }> }).$defs[
      'level'
    ]!;

    expect(level.required).toContain('tileRuns');
    expect(level.required).not.toContain('tiles');
    expect(prompt.system).toContain('Compact tile rows');
    expect(prompt.system).toContain('at most 6 tuples per row on average');
    expect(prompt.system).toContain('trace one continuous route');
    expect(prompt.system).toContain('must never be required to make the exit reachable');
    expect(prompt.maxTokens).toBe(9000);
  });

  it('uses the vertical-shooter backdrop vocabulary instead of side-view ids', () => {
    const shooterDesign = { ...design, archetype: 'shooter' } as DesignDoc;
    const system = buildEntitiesPrompt('shooter', shooterDesign, false).system;
    expect(system).toContain('deepspace');
    expect(system).toContain('Do not use the side-view backdrop names starfield, circuit');
  });

  it('projects repairs to one owner and can regenerate one level', () => {
    const currentLevels = [
      { name: 'One', tiles: ['....'] },
      { name: 'Two', tiles: ['..##'] },
      { name: 'Three', tiles: ['####'] },
    ];
    const diagnostics = [{ code: 'ROW_WIDTH', path: '/levels/1/tiles/0', message: 'row is short' }];
    const repair = buildRepairPrompt(
      'platformer',
      { levels: currentLevels, music: { enormousUnrelatedPayload: 'do-not-send' } },
      diagnostics,
      'levels',
    );
    expect(repair.user).toContain('"levelsByOriginalIndex":{"1"');
    expect(repair.user).not.toContain('do-not-send');
    expect(repair.maxTokens).toBe(4000);

    const replacement = buildLevelRegenerationPrompt(
      'platformer',
      design,
      1,
      currentLevels,
      diagnostics,
    );
    expect((replacement.jsonSchema as { required: string[] }).required).toEqual(['level']);
    expect(replacement.system).toContain('replaces ONLY zero-based level 1');
  });
});
