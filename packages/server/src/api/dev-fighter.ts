// Dev-only editor backend for procedural fighter appearances. Fighter bodies
// are not bitmap library sprites: this endpoint changes only the authored
// appearance fields that the runtime renderer consumes, preserving HP and
// every gameplay stat. The complete result is schema-validated before any
// file is replaced.
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { lintFighter } from '@sparkade/archetypes';
import type {
  FighterBuild,
  FighterOutfit,
  FighterSpec,
} from '@sparkade/shared';
import { validateGameSchema } from '../pipeline/validate';
import type { Db } from '../storage/db';
import type { GameFiles } from '../storage/files';
import { atomicWriteFile, repoRoot } from '../util';

const BUILDS = new Set<FighterBuild>(['nimble', 'balanced', 'heavy']);
const OUTFITS = new Set<FighterOutfit>([
  'gi',
  'boxer',
  'wrestler',
  'street',
  'robe',
  'armor',
]);
const GOLDEN_REL = 'packages/generation/golden';

export type FighterEditTarget =
  | { kind: 'player' }
  | { kind: 'opponent'; index: number }
  | { kind: 'boss' };

export interface FighterAppearance {
  name: string;
  build: FighterBuild;
  outfit: FighterOutfit;
  colorSlot: number;
}

export interface FighterAppearanceEdit {
  target: FighterEditTarget;
  appearance: FighterAppearance;
}

export type FighterPatchResult =
  | { ok: true; spec: FighterSpec }
  | { ok: false; error: string };

interface DevFighterOptions {
  /** Test seam; production goldens live under packages/generation/golden. */
  goldenDir?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function parseEdit(body: unknown, opponentCount: number):
  | { ok: true; edit: FighterAppearanceEdit }
  | { ok: false; error: string } {
  if (!isRecord(body) || !hasExactKeys(body, ['target', 'appearance'])) {
    return { ok: false, error: 'body must contain exactly target and appearance' };
  }
  const target = body.target;
  if (!isRecord(target) || typeof target.kind !== 'string') {
    return { ok: false, error: 'target.kind is required' };
  }

  let parsedTarget: FighterEditTarget;
  if (target.kind === 'opponent') {
    if (!hasExactKeys(target, ['kind', 'index'])) {
      return { ok: false, error: 'opponent target must contain exactly kind and index' };
    }
    if (!Number.isInteger(target.index)) {
      return { ok: false, error: 'opponent target index must be an integer' };
    }
    const index = target.index as number;
    if (index < 0 || index >= opponentCount) {
      return { ok: false, error: `opponent target index must be between 0 and ${opponentCount - 1}` };
    }
    parsedTarget = { kind: 'opponent', index };
  } else if (target.kind === 'player' || target.kind === 'boss') {
    if (!hasExactKeys(target, ['kind'])) {
      return { ok: false, error: `${target.kind} target must contain only kind` };
    }
    parsedTarget = { kind: target.kind };
  } else {
    return { ok: false, error: 'target.kind must be player, opponent, or boss' };
  }

  const appearance = body.appearance;
  if (
    !isRecord(appearance) ||
    !hasExactKeys(appearance, ['name', 'build', 'outfit', 'colorSlot'])
  ) {
    return {
      ok: false,
      error: 'appearance must contain exactly name, build, outfit, and colorSlot',
    };
  }
  if (
    typeof appearance.name !== 'string' ||
    appearance.name.length < 1 ||
    appearance.name.length > 24 ||
    appearance.name.trim().length === 0 ||
    !/^[ -~]+$/.test(appearance.name)
  ) {
    return { ok: false, error: 'appearance.name must be 1-24 printable ASCII characters' };
  }
  if (typeof appearance.build !== 'string' || !BUILDS.has(appearance.build as FighterBuild)) {
    return { ok: false, error: 'appearance.build must be nimble, balanced, or heavy' };
  }
  if (typeof appearance.outfit !== 'string' || !OUTFITS.has(appearance.outfit as FighterOutfit)) {
    return {
      ok: false,
      error: 'appearance.outfit must be gi, boxer, wrestler, street, robe, or armor',
    };
  }
  const maxSlot = parsedTarget.kind === 'boss' ? 11 : 10;
  if (
    !Number.isInteger(appearance.colorSlot) ||
    (appearance.colorSlot as number) < 5 ||
    (appearance.colorSlot as number) > maxSlot
  ) {
    return {
      ok: false,
      error: `appearance.colorSlot must be an integer between 5 and ${maxSlot}`,
    };
  }

  return {
    ok: true,
    edit: {
      target: parsedTarget,
      appearance: {
        name: appearance.name,
        build: appearance.build as FighterBuild,
        outfit: appearance.outfit as FighterOutfit,
        colorSlot: appearance.colorSlot as number,
      },
    },
  };
}

/** Pure, immutable appearance patch used by both the route and unit tests. */
export function patchFighterAppearance(
  spec: FighterSpec,
  body: unknown,
): FighterPatchResult {
  const parsed = parseEdit(body, spec.levels.length);
  if (!parsed.ok) return parsed;
  const { target, appearance } = parsed.edit;

  if (target.kind === 'player') {
    return {
      ok: true,
      spec: {
        ...spec,
        player: {
          ...(spec.player ?? { hp: 100 }),
          ...appearance,
        },
      },
    };
  }
  if (target.kind === 'opponent') {
    return {
      ok: true,
      spec: {
        ...spec,
        levels: spec.levels.map((level, index) =>
          index === target.index
            ? { ...level, opponent: { ...level.opponent, ...appearance } }
            : level,
        ),
      },
    };
  }
  return {
    ok: true,
    spec: {
      ...spec,
      boss: { ...spec.boss, ...appearance },
    },
  };
}

export function registerDevFighterRoutes(
  app: FastifyInstance,
  files: GameFiles,
  db: Pick<Db, 'getGame'>,
  options: DevFighterOptions = {},
): void {
  app.put('/api/dev/fighter/games/:id/character', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.getGame(id);
    if (!row) return reply.code(404).send({ error: 'unknown game' });

    const current = files.readSpec(id);
    if (!current) return reply.code(404).send({ error: 'game spec not found' });
    if (current.archetype !== 'fighter') {
      return reply.code(409).send({ error: 'game is not a fighter' });
    }

    const patched = patchFighterAppearance(current, req.body);
    if (!patched.ok) return reply.code(400).send({ error: patched.error });

    const schemaErrors = validateGameSchema('fighter', patched.spec);
    if (schemaErrors.length > 0) {
      return reply.code(422).send({
        error: 'edited fighter spec failed validation',
        details: schemaErrors,
      });
    }

    const serialized = `${JSON.stringify(patched.spec, null, 2)}\n`;
    let file = `games/${id}/game.json`;
    if (row.golden) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        return reply.code(500).send({ error: 'golden game id cannot map to a source file' });
      }
      const goldenDir = options.goldenDir ?? join(repoRoot(), 'packages', 'generation', 'golden');
      atomicWriteFile(join(goldenDir, `${id}.json`), serialized);
      file = `${GOLDEN_REL}/${id}.json`;
    }
    files.writeSpec(id, patched.spec);

    return {
      ok: true,
      spec: patched.spec,
      file,
      warnings: lintFighter(patched.spec),
    };
  });
}
