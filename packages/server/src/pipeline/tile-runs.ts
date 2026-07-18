import { stageSchema, type ArchetypeId } from '@sparkade/shared';

/** Archetypes whose generated levels contain large ASCII tile grids. */
export type TileRunsArchetype = Extract<ArchetypeId, 'platformer' | 'hshooter'>;

/** One compact run encoded as `[tile, count]` to minimize generated JSON. */
export type TileRun = [tile: string, count: number];

interface TileGridBounds {
  minRows: number;
  maxRows: number;
  minCols: number;
  maxCols: number;
}

type JsonObject = Record<string, unknown>;

/** A compact-row schema or payload could not be derived/compiled safely. */
export class TileRunsError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'TileRunsError';
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (!isObject(value)) throw new TileRunsError(path, 'expected an object');
  return value;
}

function positiveIntegerAt(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TileRunsError(path, 'expected a positive integer');
  }
  return value as number;
}

function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolve a local JSON-Schema reference, including chains through `$defs`. */
function resolveSchemaNode(root: JsonObject, node: JsonObject, path: string): JsonObject {
  const seen = new Set<string>();
  let current = node;
  let currentPath = path;

  while (typeof current['$ref'] === 'string') {
    const ref = current['$ref'];
    if (!ref.startsWith('#/')) {
      throw new TileRunsError(currentPath, `unsupported non-local schema reference ${ref}`);
    }
    if (seen.has(ref)) throw new TileRunsError(currentPath, `cyclic schema reference ${ref}`);
    seen.add(ref);

    let resolved: unknown = root;
    for (const rawSegment of ref.slice(2).split('/')) {
      const segment = unescapePointerSegment(rawSegment);
      const container = objectAt(resolved, ref);
      if (!own(container, segment)) {
        throw new TileRunsError(currentPath, `schema reference ${ref} does not resolve`);
      }
      resolved = container[segment];
    }
    current = objectAt(resolved, ref);
    currentPath = ref;
  }

  return current;
}

function levelSchemaFromStage(root: JsonObject): JsonObject {
  const properties = objectAt(root['properties'], '#/properties');
  const levels = objectAt(properties['levels'], '#/properties/levels');
  const items = objectAt(levels['items'], '#/properties/levels/items');
  return resolveSchemaNode(root, items, '#/properties/levels/items');
}

function boundsFromLevelSchema(level: JsonObject): TileGridBounds {
  const properties = objectAt(level['properties'], 'level.properties');
  const tiles = objectAt(properties['tiles'], 'level.properties.tiles');
  const row = objectAt(tiles['items'], 'level.properties.tiles.items');
  const minRows = positiveIntegerAt(tiles['minItems'], 'level.properties.tiles.minItems');
  const maxRows = positiveIntegerAt(tiles['maxItems'], 'level.properties.tiles.maxItems');
  const minCols = positiveIntegerAt(row['minLength'], 'level.properties.tiles.items.minLength');
  const maxCols = positiveIntegerAt(row['maxLength'], 'level.properties.tiles.items.maxLength');
  if (minRows > maxRows)
    throw new TileRunsError('level.properties.tiles', 'minItems exceeds maxItems');
  if (minCols > maxCols) {
    throw new TileRunsError('level.properties.tiles.items', 'minLength exceeds maxLength');
  }
  return { minRows, maxRows, minCols, maxCols };
}

function canonicalLevelSchema(archetype: TileRunsArchetype): JsonObject {
  return levelSchemaFromStage(stageSchema(archetype, 'levels'));
}

/**
 * Clone an existing levels-stage schema and replace its canonical `tiles`
 * property with compact `tileRuns`. The level may be inline or reached through
 * a local `$defs` reference; every unrelated schema field remains unchanged.
 */
export function deriveTileRunsStageSchema(source: JsonObject): JsonObject {
  const derived = structuredClone(source) as JsonObject;
  const level = levelSchemaFromStage(derived);
  const properties = objectAt(level['properties'], 'level.properties');
  if (own(properties, 'tileRuns')) {
    throw new TileRunsError('level.properties.tileRuns', 'schema is already compact');
  }
  const bounds = boundsFromLevelSchema(level);
  const required = level['required'];
  if (!Array.isArray(required) || !required.every((key) => typeof key === 'string')) {
    throw new TileRunsError('level.required', 'expected an array of property names');
  }
  if (!required.includes('tiles')) {
    throw new TileRunsError('level.required', 'canonical level must require tiles');
  }

  const tileRuns = {
    description:
      `Compact tile rows, top to bottom. Each row is a left-to-right list of [tile,count] runs. ` +
      `Expanded rows must all have the same width (${bounds.minCols}-${bounds.maxCols} characters).`,
    type: 'array',
    minItems: bounds.minRows,
    maxItems: bounds.maxRows,
    items: {
      type: 'array',
      minItems: 1,
      maxItems: bounds.maxCols,
      items: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        prefixItems: [
          {
            description: "One printable ASCII tile character; '.' means empty.",
            type: 'string',
            minLength: 1,
            maxLength: 1,
            pattern: '^[ -~]$',
          },
          { type: 'integer', minimum: 1, maximum: bounds.maxCols },
        ],
        items: false,
      },
    },
  };

  const nextProperties: JsonObject = {};
  for (const [key, value] of Object.entries(properties)) {
    nextProperties[key === 'tiles' ? 'tileRuns' : key] = key === 'tiles' ? tileRuns : value;
  }
  level['properties'] = nextProperties;
  level['required'] = required.map((key) => (key === 'tiles' ? 'tileRuns' : key));
  return derived;
}

/** Build the opt-in compact generation schema for one tile-grid archetype. */
export function compactLevelsStageSchema(archetype: TileRunsArchetype): JsonObject {
  return deriveTileRunsStageSchema(stageSchema(archetype, 'levels'));
}

function compileRows(
  value: unknown,
  bounds: TileGridBounds,
  path: string,
  normalizeWidths: boolean,
): string[] {
  if (!Array.isArray(value)) throw new TileRunsError(path, 'expected an array of compact rows');
  if (value.length < bounds.minRows || value.length > bounds.maxRows) {
    throw new TileRunsError(
      path,
      `expected ${bounds.minRows}-${bounds.maxRows} rows, received ${value.length}`,
    );
  }

  const expandedRows = value.map((rowValue, rowIndex) => {
    const rowPath = `${path}[${rowIndex}]`;
    if (!Array.isArray(rowValue) || rowValue.length === 0) {
      throw new TileRunsError(rowPath, 'expected at least one tile run');
    }
    if (rowValue.length > bounds.maxCols) {
      throw new TileRunsError(rowPath, `has too many runs (maximum ${bounds.maxCols})`);
    }

    let width = 0;
    let expanded = '';
    rowValue.forEach((runValue, runIndex) => {
      const runPath = `${rowPath}[${runIndex}]`;
      if (!Array.isArray(runValue) || runValue.length !== 2) {
        throw new TileRunsError(runPath, 'expected exactly two items: tile and count');
      }
      const tile = runValue[0];
      if (typeof tile !== 'string' || !/^[ -~]$/.test(tile)) {
        throw new TileRunsError(`${runPath}[0]`, 'expected one printable ASCII character');
      }
      const count = runValue[1];
      if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > bounds.maxCols) {
        throw new TileRunsError(
          `${runPath}[1]`,
          `expected an integer between 1 and ${bounds.maxCols}`,
        );
      }
      width += count as number;
      if (width > bounds.maxCols) {
        throw new TileRunsError(rowPath, `expanded width exceeds ${bounds.maxCols} characters`);
      }
      expanded += tile.repeat(count as number);
    });

    if (width < bounds.minCols && !normalizeWidths) {
      throw new TileRunsError(
        rowPath,
        `expanded width ${width} is below minimum ${bounds.minCols}`,
      );
    }
    return { expanded, width, rowPath };
  });
  const targetWidth = Math.max(bounds.minCols, ...expandedRows.map((row) => row.width));
  if (!normalizeWidths) {
    const expectedWidth = expandedRows[0]!.width;
    const mismatch = expandedRows.find((row) => row.width !== expectedWidth);
    if (mismatch) {
      throw new TileRunsError(
        mismatch.rowPath,
        `expanded width ${mismatch.width} does not match the first row width ${expectedWidth}`,
      );
    }
  }
  return expandedRows.map(({ expanded }) =>
    normalizeWidths ? expanded.padEnd(targetWidth, '.') : expanded,
  );
}

/**
 * Compile a compact generation payload into canonical level `tiles`. Accepts
 * either the full stage object (`{ levels: [...] }`) or the levels array itself.
 * The input is never mutated and every `tileRuns` property is removed. Callers
 * handling model output may opt into safe right-padding with `.` when run sums
 * differ; strict mode remains the default for general callers.
 */
export function compileTileRunsStage<T>(
  archetype: TileRunsArchetype,
  stageOutput: T,
  opts: { normalizeWidths?: boolean } = {},
): T {
  const compiled = structuredClone(stageOutput) as T;
  let levels: unknown;
  let levelsPath: string;
  if (Array.isArray(compiled)) {
    levels = compiled;
    levelsPath = '$';
  } else if (isObject(compiled)) {
    levels = compiled['levels'];
    levelsPath = '$.levels';
  } else {
    throw new TileRunsError('$', 'expected a levels stage object or levels array');
  }
  if (!Array.isArray(levels)) throw new TileRunsError(levelsPath, 'expected an array');

  const bounds = boundsFromLevelSchema(canonicalLevelSchema(archetype));
  levels.forEach((levelValue, levelIndex) => {
    const levelPath = `${levelsPath}[${levelIndex}]`;
    const level = objectAt(levelValue, levelPath);
    if (!own(level, 'tileRuns')) return;
    if (own(level, 'tiles')) {
      throw new TileRunsError(levelPath, 'cannot contain both tiles and tileRuns');
    }
    level['tiles'] = compileRows(
      level['tileRuns'],
      bounds,
      `${levelPath}.tileRuns`,
      opts.normalizeWidths ?? false,
    );
    delete level['tileRuns'];
  });
  return compiled;
}
