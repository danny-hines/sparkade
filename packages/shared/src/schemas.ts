// Schema access + per-stage schema extraction.
// The .json files in ./schemas are the single source of truth — they are used by
// the ajv validator AND embedded verbatim into the LLM prompt templates.

import platformerSchemaJson from './schemas/platformer.schema.json';
import shooterSchemaJson from './schemas/shooter.schema.json';
import adventureSchemaJson from './schemas/adventure.schema.json';
import hshooterSchemaJson from './schemas/hshooter.schema.json';
import fighterSchemaJson from './schemas/fighter.schema.json';
import designSchemaJson from './schemas/design.schema.json';
import type { ArchetypeId } from './constants';

export const ARCHETYPE_SCHEMAS: Record<ArchetypeId, Record<string, unknown>> = {
  platformer: platformerSchemaJson as Record<string, unknown>,
  shooter: shooterSchemaJson as Record<string, unknown>,
  adventure: adventureSchemaJson as Record<string, unknown>,
  hshooter: hshooterSchemaJson as Record<string, unknown>,
  fighter: fighterSchemaJson as Record<string, unknown>,
};

export const DESIGN_SCHEMA = designSchemaJson as Record<string, unknown>;

export type SpecStage = 'levels' | 'entities' | 'music';

/** Which top-level game.json properties each spec stage produces. */
export const STAGE_PROPERTIES: Record<SpecStage, { required: string[]; optional: string[] }> = {
  levels: { required: ['levels'], optional: [] },
  entities: { required: ['sprites', 'boss'], optional: ['sfx', 'backdrop', 'weather', 'lighting', 'juice'] },
  music: { required: ['music'], optional: [] },
};

/**
 * Build a self-contained JSON Schema for one spec stage of one archetype:
 * the relevant top-level properties plus every $def from the archetype schema
 * (all internal `#/$defs/...` refs stay valid). Used both for the provider's
 * native structured-output mode and for stage-level validation.
 */
export function stageSchema(archetype: ArchetypeId, stage: SpecStage): Record<string, unknown> {
  const full = ARCHETYPE_SCHEMAS[archetype] as {
    properties: Record<string, unknown>;
    $defs: Record<string, unknown>;
  };
  const { required, optional } = STAGE_PROPERTIES[stage];
  const properties: Record<string, unknown> = {};
  for (const key of [...required, ...optional]) {
    const prop = full.properties[key];
    if (prop === undefined) throw new Error(`schema for ${archetype} is missing property ${key}`);
    properties[key] = prop;
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `Sparkade ${archetype} — ${stage} stage output`,
    type: 'object',
    properties,
    required,
    additionalProperties: false,
    $defs: structuredClone(full.$defs),
  };
}

/** The list of $defs that must stay byte-identical across the three archetype schemas. */
export const COMMON_DEF_NAMES = [
  'hexColor',
  'palette',
  'text',
  'shortName',
  'spriteRef',
  'sprite',
  'meta',
  'story',
  'spritesBlock',
  'pulseInstrument',
  'bassInstrument',
  'drumInstrument',
  'instruments',
  'noteStep',
  'drumStep',
  'noteChannel',
  'drumChannel',
  'pattern',
  'songRefList',
  'music',
  'sfxParams',
  'sfx',
  'scoring',
] as const;
