import { describe, expect, it } from 'vitest';
import { stageSchema } from '@sparkade/shared';
import {
  TileRunsError,
  compactLevelsStageSchema,
  compileTileRunsStage,
  deriveTileRunsStageSchema,
  type TileRun,
} from '../src/pipeline/tile-runs';

type ObjectMap = Record<string, unknown>;

function object(value: unknown): ObjectMap {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as ObjectMap;
}

function referencedLevel(schema: ObjectMap): ObjectMap {
  return object(object(schema['$defs'])['level']);
}

function compactRows(rows = 10, width = 32): TileRun[][] {
  return Array.from({ length: rows }, (_, row): TileRun[] => [
    ['#', 2],
    [row % 2 === 0 ? '.' : ' ', width - 4],
    ['#', 2],
  ]);
}

function compactPlatformerLevel(): ObjectMap {
  return {
    name: 'Keep every field',
    musicSong: 'theme',
    tileRuns: compactRows(),
    legend: { '#': 'solid' },
    entities: [{ type: 'coin', x: 4, y: 5 }],
    playerSpawn: { x: 2, y: 8 },
    exit: { x: 29, y: 8 },
    generatorNote: { untouched: true },
  };
}

describe('compact tile-row generation schema', () => {
  it('derives the platformer schema through $defs without mutating canonical schema', () => {
    const canonical = stageSchema('platformer', 'levels');
    const before = structuredClone(canonical);
    const compact = deriveTileRunsStageSchema(canonical);

    expect(canonical).toEqual(before);
    expect(compact).not.toBe(canonical);

    const canonicalLevel = referencedLevel(canonical);
    const compactLevel = referencedLevel(compact);
    const canonicalProperties = object(canonicalLevel['properties']);
    const compactProperties = object(compactLevel['properties']);
    expect(compactProperties['tiles']).toBeUndefined();
    expect(compactProperties['tileRuns']).toBeDefined();
    expect(compactLevel['required']).toEqual(
      (canonicalLevel['required'] as string[]).map((key) => (key === 'tiles' ? 'tileRuns' : key)),
    );
    expect(compactProperties['legend']).toEqual(canonicalProperties['legend']);
    expect(object(compact['$defs'])['boss']).toEqual(object(canonical['$defs'])['boss']);

    const tileRuns = object(compactProperties['tileRuns']);
    expect(tileRuns['minItems']).toBe(10);
    expect(tileRuns['maxItems']).toBe(32);
    const compactRow = object(tileRuns['items']);
    expect(compactRow['maxItems']).toBe(256);
    const run = object(compactRow['items']);
    expect(run).toMatchObject({ type: 'array', minItems: 2, maxItems: 2, items: false });
    const tupleItems = run['prefixItems'] as unknown[];
    expect(tupleItems).toHaveLength(2);
    expect(object(tupleItems[0])).toMatchObject({ type: 'string', minLength: 1, maxLength: 1 });
    const count = object(tupleItems[1]);
    expect(count).toMatchObject({ type: 'integer', minimum: 1, maximum: 256 });
  });

  it('derives hshooter-specific row and width limits', () => {
    const compact = compactLevelsStageSchema('hshooter');
    const level = referencedLevel(compact);
    const tileRuns = object(object(level['properties'])['tileRuns']);
    expect(tileRuns).toMatchObject({ minItems: 12, maxItems: 20 });
    const row = object(tileRuns['items']);
    expect(row['maxItems']).toBe(340);
    const run = object(row['items']);
    const count = object((run['prefixItems'] as unknown[])[1]);
    expect(count['maximum']).toBe(340);
  });

  it('also transforms an inline level definition and preserves unrelated fields', () => {
    const inline = {
      type: 'object',
      properties: {
        levels: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', maxLength: 12 },
              tiles: {
                type: 'array',
                minItems: 2,
                maxItems: 4,
                items: { type: 'string', minLength: 3, maxLength: 8 },
              },
            },
            required: ['name', 'tiles'],
            additionalProperties: false,
          },
        },
      },
      required: ['levels'],
    } satisfies ObjectMap;

    const compact = deriveTileRunsStageSchema(inline);
    const level = object(object(object(compact['properties'])['levels'])['items']);
    const properties = object(level['properties']);
    expect(properties['name']).toEqual({ type: 'string', maxLength: 12 });
    expect(properties['tiles']).toBeUndefined();
    expect(object(properties['tileRuns'])).toMatchObject({ minItems: 2, maxItems: 4 });
    expect(inline.properties.levels.items.properties.tiles).toBeDefined();
  });
});

describe('compact tile-row compiler', () => {
  it('expands runs, removes compact fields, preserves everything else, and never mutates input', () => {
    const input = {
      player: { name: 'Still here' },
      levels: [compactPlatformerLevel()],
    };
    const before = structuredClone(input);
    const compiled = compileTileRunsStage('platformer', input) as {
      player: ObjectMap;
      levels: ObjectMap[];
    };

    expect(input).toEqual(before);
    expect(compiled).not.toBe(input);
    expect(compiled.player).toEqual(input.player);
    const level = compiled.levels[0]!;
    expect(level['tileRuns']).toBeUndefined();
    expect(level['tiles']).toEqual(
      compactRows().map((row) => row.map(([tile, count]) => tile.repeat(count)).join('')),
    );
    expect(level['name']).toBe('Keep every field');
    expect(level['legend']).toEqual({ '#': 'solid' });
    expect(level['entities']).toEqual([{ type: 'coin', x: 4, y: 5 }]);
    expect(level['generatorNote']).toEqual({ untouched: true });
  });

  it('accepts a direct hshooter levels array and leaves canonical levels alone', () => {
    const compact = [{ name: 'wide', tileRuns: compactRows(12, 40), scroll: 48 }];
    const compiled = compileTileRunsStage('hshooter', compact) as ObjectMap[];
    expect((compiled[0]!['tiles'] as string[])[0]).toHaveLength(40);
    expect(compiled[0]!['tileRuns']).toBeUndefined();

    const canonical = [{ name: 'already expanded', tiles: ['####'], marker: 7 }];
    expect(compileTileRunsStage('platformer', canonical)).toEqual(canonical);
  });

  it('rejects ambiguous, malformed, and unsafe run data with precise paths', () => {
    const both = compactPlatformerLevel();
    both['tiles'] = ['#'.repeat(32)];
    expect(() => compileTileRunsStage('platformer', { levels: [both] })).toThrow(
      /\$\.levels\[0\]: cannot contain both tiles and tileRuns/,
    );

    const badCount = compactPlatformerLevel();
    (badCount['tileRuns'] as TileRun[][])[0]![0]![1] = 0;
    expect(() => compileTileRunsStage('platformer', { levels: [badCount] })).toThrow(
      /\$\.levels\[0\]\.tileRuns\[0\]\[0\]\[1\]: expected an integer between 1 and 256/,
    );

    const badTile = compactPlatformerLevel();
    (badTile['tileRuns'] as TileRun[][])[0]![0]![0] = '##';
    expect(() => compileTileRunsStage('platformer', { levels: [badTile] })).toThrow(
      /\[0\]: expected one printable ASCII character/,
    );

    const legacyObject = compactPlatformerLevel();
    (legacyObject['tileRuns'] as unknown[][])[0]![0] = { tile: '#', count: 2 };
    expect(() => compileTileRunsStage('platformer', { levels: [legacyObject] })).toThrow(
      /tileRuns\[0\]\[0\]: expected exactly two items: tile and count/,
    );

    const extraItem = compactPlatformerLevel();
    (extraItem['tileRuns'] as unknown[][])[0]![0] = ['#', 2, 'extra'];
    expect(() => compileTileRunsStage('platformer', { levels: [extraItem] })).toThrow(
      /tileRuns\[0\]\[0\]: expected exactly two items: tile and count/,
    );

    expect(() =>
      compileTileRunsStage('platformer', {
        levels: [{ ...compactPlatformerLevel(), tileRuns: compactRows(9, 32) }],
      }),
    ).toThrow(/expected 10-32 rows, received 9/);
  });

  it('rejects short, oversized, and unequal expanded rows before allocating them', () => {
    expect(() =>
      compileTileRunsStage('platformer', {
        levels: [{ ...compactPlatformerLevel(), tileRuns: compactRows(10, 31) }],
      }),
    ).toThrow(/expanded width 31 is below minimum 32/);

    const oversized = compactRows();
    oversized[0] = [['#', 257]];
    expect(() =>
      compileTileRunsStage('platformer', {
        levels: [{ ...compactPlatformerLevel(), tileRuns: oversized }],
      }),
    ).toThrow(/\[1\]: expected an integer between 1 and 256/);

    const unequal = compactRows();
    unequal[1] = [['#', 33]];
    expect(() =>
      compileTileRunsStage('platformer', {
        levels: [{ ...compactPlatformerLevel(), tileRuns: unequal }],
      }),
    ).toThrow(/expanded width 33 does not match the first row width 32/);
  });

  it('can deterministically pad model-miscounted compact rows with empty tiles', () => {
    const unequal = compactRows();
    unequal[0] = [['#', 31]];
    unequal[1] = [['#', 33]];
    const compiled = compileTileRunsStage(
      'platformer',
      { levels: [{ ...compactPlatformerLevel(), tileRuns: unequal }] },
      { normalizeWidths: true },
    ) as unknown as { levels: { tiles: string[] }[] };

    expect(compiled.levels[0]!.tiles.every((row) => row.length === 33)).toBe(true);
    expect(compiled.levels[0]!.tiles[0]!.endsWith('.')).toBe(true);
  });

  it('uses a dedicated error type for invalid stage roots', () => {
    expect(() => compileTileRunsStage('platformer', null)).toThrow(TileRunsError);
    expect(() => compileTileRunsStage('platformer', { levels: 'not-an-array' })).toThrow(
      /\$\.levels: expected an array/,
    );
  });
});
