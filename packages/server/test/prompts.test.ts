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
    const fighterDesign = {
      ...design,
      archetype: 'fighter',
      heroConcept: 'A cobalt tournament coat with gold cuffs and black split-toe boots',
      fighterArtDirection: {
        aesthetic: 'stylized',
        proportions: 'Six-head athletic adults with normally sized expressive faces',
        rendering: 'Dark one-pixel outlines and restrained three-step cel shading',
      },
    } as DesignDoc;
    const levels = buildLevelsPrompt('fighter', fighterDesign);
    const levelSchema = levels.jsonSchema as {
      required: string[];
      $defs: Record<string, { required?: string[] }>;
    };
    expect(levelSchema.required).toEqual(['player', 'levels']);
    expect(levelSchema.$defs.fighter!.required).toContain('outfit');
    expect(levels.system).toContain('`wrestler`');
    expect(levels.system).toContain("Copy the design document's `heroConcept` VERBATIM");
    expect(levels.user).toContain('Six-head athletic adults');

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
    expect(system).toContain('city_*');
    expect(system).toContain('circuitry_*');
    expect(system).toContain('industrial_*');
    expect(system).toContain('automatically rendered at high density');

    const adventure = buildEntitiesPrompt(
      'adventure',
      { ...design, archetype: 'adventure' } as DesignDoc,
      false,
    ).system;
    expect(adventure).not.toContain('city_*');
    expect(adventure).toContain('automatically renders the selected core family');
    expect(adventure).toContain('top-down connected edges and spatial variation');
  });

  it('keeps Adventure bosses readable instead of turning them into endurance fights', () => {
    const prompt = buildEntitiesPrompt(
      'adventure',
      { ...design, archetype: 'adventure' } as DesignDoc,
      false,
    );
    const schema = prompt.jsonSchema as {
      $defs: { boss: { properties: { hp: { maximum: number } } } };
    };
    expect(prompt.system).toContain('named B-button primary melee equipment');
    expect(prompt.system).toContain('Keep HP between 18 and 32');
    expect(schema.$defs.boss.properties.hp.maximum).toBe(36);
  });

  it('teaches H-scroll art generation the shared high-density connected terrain contract', () => {
    const hshooterDesign = { ...design, archetype: 'hshooter' } as DesignDoc;
    const system = buildEntitiesPrompt('hshooter', hshooterDesign, false).system;

    expect(system).toContain('tile_solid, tile_solid_inner, tile_hazard, tile_deco');
    expect(system).toContain('CONNECTED SOLID PAIR');
    expect(system).toContain('`tile_solid_inner` is the buried fill');
    expect(system).toContain('city_*');
    expect(system).toContain('spaceship_*');
    expect(system).toContain('automatically rendered at high density');
    expect(system).toContain('stable likeness-free fallbacks');
    expect(system).not.toContain('all take the generated likeness head in the canopy');
  });

  it('keeps image-generated platformer characters on lightweight library fallbacks', () => {
    const system = buildEntitiesPrompt('platformer', design, false).system;

    expect(system).toContain('IMAGE-FIRST CHARACTER FALLBACKS');
    expect(system).toContain('`boss`, `walker`, `flyer`, `shooter`, and `chaser`');
    expect(system).toContain('do NOT draw custom sprites for those roles');
    expect(system).toContain('custom-pixel budget on terrain or a gameplay object');
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
