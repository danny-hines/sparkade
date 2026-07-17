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
      for (const key of ['specVersion', 'archetype', 'seed', 'meta', 'palette', 'story', 'sprites', 'levels', 'boss', 'music', 'scoring']) {
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
    const def = (ARCHETYPE_SCHEMAS.platformer as { $defs: { palette: { minItems: number; maxItems: number } } })
      .$defs.palette;
    expect(def.minItems).toBe(16);
    expect(def.maxItems).toBe(16);
  });

  it('music channels are exactly 16 steps with the documented syntax', () => {
    const defs = (ARCHETYPE_SCHEMAS.shooter as { $defs: Record<string, { minItems?: number; maxItems?: number; pattern?: string } > }).$defs;
    expect(defs.noteChannel!.minItems).toBe(16);
    expect(defs.noteChannel!.maxItems).toBe(16);
    const re = new RegExp(defs.noteStep!.pattern!);
    for (const good of ['-', 'C4:2', 'Eb3:4', 'F#5:1', 'A7:16', 'G1:9']) expect(good).toMatch(re);
    for (const bad of ['C4', 'H4:2', 'C8:2', 'C4:0', 'C4:17', 'c4:2', '']) expect(bad).not.toMatch(re);
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

  it('requires a complete authored roster for new fighter stages without breaking old specs', () => {
    const full = ARCHETYPE_SCHEMAS.fighter as {
      required: string[];
      $defs: Record<string, { required?: string[] }>;
    };
    // Persisted pre-roster/pre-outfit specs keep their engine fallbacks.
    expect(full.required).not.toContain('player');
    expect(full.$defs.fighter!.required).not.toContain('outfit');
    expect(full.$defs.boss!.required).not.toContain('outfit');

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
    for (const key of ['title', 'archetype', 'palette', 'story', 'levelPlan', 'cast', 'musicBrief', 'scoring', 'difficulty']) {
      expect(s.required).toContain(key);
    }
  });
});
