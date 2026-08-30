import { describe, expect, it } from 'vitest';
import {
  ARCHETYPE_SCHEMAS,
  BACKDROP_VARIANTS,
  COMMON_DEF_NAMES,
  DESIGN_SCHEMA,
  LIGHTING_MODES,
  SHOOTER_BACKDROP_VARIANTS,
  stageSchema,
  WEATHER_KINDS,
} from '@sparkade/shared';

describe('archetype schemas', () => {
  it('share byte-identical common $defs (prompt/validator sync guard)', () => {
    const [plat, shoot, adv] = [
      ARCHETYPE_SCHEMAS.platformer,
      ARCHETYPE_SCHEMAS.shooter,
      ARCHETYPE_SCHEMAS.adventure,
    ].map((s) => (s as { $defs: Record<string, unknown> }).$defs);
    for (const name of COMMON_DEF_NAMES) {
      expect(JSON.stringify(plat![name]), `def ${name} platformer vs shooter`).toBe(
        JSON.stringify(shoot![name]),
      );
      expect(JSON.stringify(plat![name]), `def ${name} platformer vs adventure`).toBe(
        JSON.stringify(adv![name]),
      );
    }
  });

  it('declare every contract field with bounds', () => {
    for (const [id, schema] of Object.entries(ARCHETYPE_SCHEMAS)) {
      const s = schema as { properties: Record<string, unknown>; required: string[] };
      for (const key of [
        'specVersion',
        'archetype',
        'seed',
        'meta',
        'palette',
        'story',
        'sprites',
        'levels',
        'boss',
        'music',
        'scoring',
      ]) {
        expect(s.properties[key], `${id}.${key}`).toBeDefined();
        expect(s.required, `${id} requires ${key}`).toContain(key);
      }
      // sfx is optional by contract (omit = engine defaults)
      expect(s.properties['sfx']).toBeDefined();
      expect(s.required).not.toContain('sfx');
    }
  });

  it('backdrop enum matches the engine variant list (schema/engine sync guard)', () => {
    for (const [id, schema] of Object.entries(ARCHETYPE_SCHEMAS)) {
      const s = schema as { properties: Record<string, { enum?: string[] }>; required: string[] };
      // The shooter is a vertical scroller and uses its own top-down variant set;
      // platformer/adventure use the shared horizontal list.
      const expected = id === 'shooter' ? [...SHOOTER_BACKDROP_VARIANTS] : [...BACKDROP_VARIANTS];
      expect(s.properties['backdrop']?.enum, `${id}.backdrop enum`).toEqual(expected);
      expect(s.required, `${id} must keep backdrop optional`).not.toContain('backdrop');
    }
  });

  it('weather enum matches the engine kind list (schema/engine sync guard)', () => {
    for (const [id, schema] of Object.entries(ARCHETYPE_SCHEMAS)) {
      const s = schema as { properties: Record<string, { enum?: string[] }>; required: string[] };
      expect(s.properties['weather']?.enum, `${id}.weather enum`).toEqual([...WEATHER_KINDS]);
      expect(s.required, `${id} must keep weather optional`).not.toContain('weather');
    }
  });

  it('lighting enum matches the engine mode list (schema/engine sync guard)', () => {
    for (const [id, schema] of Object.entries(ARCHETYPE_SCHEMAS)) {
      const s = schema as { properties: Record<string, { enum?: string[] }>; required: string[] };
      expect(s.properties['lighting']?.enum, `${id}.lighting enum`).toEqual([...LIGHTING_MODES]);
      expect(s.required, `${id} must keep lighting optional`).not.toContain('lighting');
    }
  });

  it('palette is exactly 16 colors', () => {
    const def = (
      ARCHETYPE_SCHEMAS.platformer as { $defs: { palette: { minItems: number; maxItems: number } } }
    ).$defs.palette;
    expect(def.minItems).toBe(16);
    expect(def.maxItems).toBe(16);
  });

  it('persists the canonical hero concept in optional saved-game metadata', () => {
    for (const [id, schema] of Object.entries(ARCHETYPE_SCHEMAS)) {
      const meta = (
        schema as {
          $defs: { meta: { properties: Record<string, unknown>; required: string[] } };
        }
      ).$defs.meta;
      expect(meta.properties['heroConcept'], `${id}.meta.heroConcept`).toBeDefined();
      expect(meta.required, `${id} keeps legacy metadata compatible`).not.toContain('heroConcept');
    }
  });

  it('keeps the two-tile platformer layout marker optional for saved-game compatibility', () => {
    const schema = ARCHETYPE_SCHEMAS.platformer as {
      properties: Record<string, { const?: number }>;
      required: string[];
    };
    expect(schema.properties['playerHeightTiles']?.const).toBe(2);
    expect(schema.required).not.toContain('playerHeightTiles');
  });

  it('keeps platformer scale bounded and optional for saved-game compatibility', () => {
    const schema = ARCHETYPE_SCHEMAS.platformer as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    };
    expect(schema.properties['platformerScale']?.enum).toEqual(['compact', 'heroic']);
    expect(schema.required).not.toContain('platformerScale');
  });

  it('keeps platformer art density bounded and optional for saved-game compatibility', () => {
    const schema = ARCHETYPE_SCHEMAS.platformer as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    };
    expect(schema.properties['platformerArtDensity']?.enum).toEqual(['chunky', 'detailed']);
    expect(schema.required).not.toContain('platformerArtDensity');
  });

  it('keeps platformer movement profiles bounded and optional for saved-game compatibility', () => {
    const schema = ARCHETYPE_SCHEMAS.platformer as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    };
    expect(schema.properties['movementProfile']?.enum).toEqual([
      'balanced',
      'precision',
      'momentum',
      'floaty',
      'heavy',
    ]);
    expect(schema.required).not.toContain('movementProfile');
  });

  it('keeps H-scroll art density bounded and optional for saved-game compatibility', () => {
    const schema = ARCHETYPE_SCHEMAS.hshooter as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    };
    expect(schema.properties['hshooterArtDensity']?.enum).toEqual(['chunky', 'detailed']);
    expect(schema.required).not.toContain('hshooterArtDensity');
  });

  it('requires the H-scroll craft identity for generated player art', () => {
    const schema = ARCHETYPE_SCHEMAS.hshooter as {
      properties: Record<string, { properties?: Record<string, unknown> }>;
      required: string[];
    };
    expect(schema.properties['playerCraft']?.properties?.['visualConcept']).toBeDefined();
    expect(schema.required).toContain('playerCraft');
  });

  it('uses the expanded 28×14 single-screen Adventure room contract', () => {
    const defs = (
      ARCHETYPE_SCHEMAS.adventure as {
        $defs: {
          room: {
            properties: {
              tiles: {
                minItems: number;
                maxItems: number;
                items: { minLength: number; maxLength: number };
              };
            };
          };
          entity: {
            properties: {
              x: { maximum: number };
              y: { maximum: number };
            };
          };
        };
      }
    ).$defs;

    expect(defs.room.properties.tiles).toMatchObject({
      minItems: 14,
      maxItems: 14,
      items: { minLength: 28, maxLength: 28 },
    });
    expect(defs.entity.properties.x.maximum).toBe(27);
    expect(defs.entity.properties.y.maximum).toBe(13);
  });

  it('bounds Adventure boss health to a readable fight length', () => {
    const boss = (
      ARCHETYPE_SCHEMAS.adventure as {
        $defs: { boss: { properties: { hp: { minimum: number; maximum: number } } } };
      }
    ).$defs.boss;
    expect(boss.properties.hp).toEqual({ type: 'integer', minimum: 12, maximum: 36 });
  });

  it('requires a bounded story-specific Adventure combat kit', () => {
    const schema = ARCHETYPE_SCHEMAS.adventure as {
      required: string[];
      properties: { combatKit: { $ref: string } };
      $defs: {
        combatKit: {
          required: string[];
          properties: {
            primary: { properties: { profile: { enum: string[] } } };
            secondary: { properties: { behavior: { enum: string[] } } };
          };
        };
      };
    };
    expect(schema.required).toContain('combatKit');
    expect(schema.properties.combatKit.$ref).toBe('#/$defs/combatKit');
    expect(schema.$defs.combatKit.required).toEqual(['primary', 'secondary']);
    expect(schema.$defs.combatKit.properties.primary.properties.profile.enum).toEqual([
      'close',
      'sweep',
      'reach',
    ]);
    expect(schema.$defs.combatKit.properties.secondary.properties.behavior.enum).toEqual([
      'shot',
      'returning',
      'blast',
    ]);

    const design = DESIGN_SCHEMA as {
      allOf: Array<{
        if: { properties: { archetype: { const: string } } };
        then: { required: string[] };
      }>;
    };
    expect(
      design.allOf.find(({ if: condition }) => condition.properties.archetype.const === 'adventure')
        ?.then.required,
    ).toContain('combatKit');
  });

  it('music channels are exactly 16 steps with the documented syntax', () => {
    const defs = (
      ARCHETYPE_SCHEMAS.shooter as {
        $defs: Record<string, { minItems?: number; maxItems?: number; pattern?: string }>;
      }
    ).$defs;
    expect(defs.noteChannel!.minItems).toBe(16);
    expect(defs.noteChannel!.maxItems).toBe(16);
    const re = new RegExp(defs.noteStep!.pattern!);
    for (const good of ['-', 'C4:2', 'Eb3:4', 'F#5:1', 'A7:16', 'G1:9']) expect(good).toMatch(re);
    for (const bad of ['C4', 'H4:2', 'C8:2', 'C4:0', 'C4:17', 'c4:2', ''])
      expect(bad).not.toMatch(re);
  });

  it('stageSchema extracts self-contained per-stage schemas', () => {
    for (const archetype of ['platformer', 'shooter', 'adventure'] as const) {
      for (const stage of ['levels', 'entities', 'music'] as const) {
        const s = stageSchema(archetype, stage) as {
          properties: Record<string, unknown>;
          required: string[];
          $defs: Record<string, unknown>;
        };
        expect(Object.keys(s.properties).length).toBeGreaterThan(0);
        expect(s.$defs).toBeDefined();
        if (stage === 'music') expect(s.required).toEqual(['music']);
        if (stage === 'levels') expect(s.required).toEqual(['levels']);
        if (stage === 'entities') expect(s.required).toEqual(['sprites', 'boss']);
      }
    }
  });

  it('requires a complete authored roster in persisted specs and generation stages', () => {
    const full = ARCHETYPE_SCHEMAS.fighter as {
      required: string[];
      $defs: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
    };
    expect(full.required).toContain('player');
    expect(full.required).toContain('artDirection');
    expect(full.$defs.fighterArtDirection!.required).toEqual([
      'aesthetic',
      'proportions',
      'rendering',
    ]);
    expect(full.$defs.fighter!.required).toEqual(
      expect.arrayContaining(['visualConcept', 'outfit']),
    );
    expect(full.$defs.boss!.required).toEqual(expect.arrayContaining(['visualConcept', 'outfit']));

    const levels = stageSchema('fighter', 'levels') as {
      properties: Record<string, unknown>;
      required: string[];
      $defs: Record<string, { required?: string[] }>;
    };
    expect(Object.keys(levels.properties)).toEqual(['player', 'levels']);
    expect(levels.required).toEqual(['player', 'levels']);
    expect(levels.$defs.fighter!.required).toContain('outfit');

    const entities = stageSchema('fighter', 'entities') as {
      $defs: Record<
        string,
        { required?: string[]; properties?: Record<string, { const?: number }> }
      >;
    };
    expect(entities.$defs.boss!.required).toContain('outfit');
    expect(entities.$defs.boss!.properties!.colorSlot).toEqual(
      expect.objectContaining({ const: 11 }),
    );
  });

  it('design schema exists and demands the full doc', () => {
    const s = DESIGN_SCHEMA as { required: string[] };
    for (const key of [
      'title',
      'archetype',
      'palette',
      'story',
      'levelPlan',
      'cast',
      'musicBrief',
      'scoring',
      'difficulty',
    ]) {
      expect(s.required).toContain(key);
    }
    expect(
      (DESIGN_SCHEMA as { properties: Record<string, unknown> }).properties.vehicleConcept,
    ).toBeDefined();
    expect(s.required).not.toContain('vehicleConcept');
    expect(
      (DESIGN_SCHEMA as { properties: Record<string, unknown> }).properties.fighterArtDirection,
    ).toBeDefined();
  });
});
