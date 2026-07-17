// Dev-only source editor for the procedural fighter outfit rigs. Unlike a
// character appearance edit, this changes a global renderer definition: every
// saved game that references the outfit id picks up the new silhouette. The
// source file is revision-guarded and replaced atomically so stale editor tabs
// cannot silently clobber one another or leave half-written JSON behind.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  FIGHTER_OUTFIT_IDS,
  validateFighterOutfitRig,
  validateFighterOutfitRigDocument,
  type FighterOutfitRig,
  type FighterOutfitRigDocument,
  type FighterOutfitRigMap,
} from '@sparkade/archetypes';
import { atomicWriteFile, repoRoot } from '../util';

const SOURCE_REL = 'packages/archetypes/src/fighter/outfits.json';
const REVISION_RE = /^[a-f0-9]{64}$/;

export interface DevFighterOutfitOptions {
  /** Test seam. Production always writes the renderer-owned source JSON. */
  sourcePath?: string;
}

type SourceResult =
  | {
      ok: true;
      revision: string;
      document: FighterOutfitRigDocument;
    }
  | { ok: false; error: string; details?: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** SHA-256 of the exact source bytes, including formatting and final newline. */
export function fighterOutfitRevision(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function readSource(path: string): SourceResult {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, error: 'fighter outfit source could not be read' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'fighter outfit source is not valid JSON' };
  }
  const validated = validateFighterOutfitRigDocument(parsed);
  if (!validated.ok) {
    return {
      ok: false,
      error: 'fighter outfit source is invalid',
      details: validated.errors,
    };
  }
  return {
    ok: true,
    revision: fighterOutfitRevision(raw),
    document: validated.value,
  };
}

function sourceError(reply: FastifyReply, source: Extract<SourceResult, { ok: false }>) {
  return reply.code(500).send({
    error: source.error,
    ...(source.details ? { details: source.details } : {}),
  });
}

export function registerDevFighterOutfitRoutes(
  app: FastifyInstance,
  options: DevFighterOutfitOptions = {},
): void {
  // sourcePath is deliberately injectable only at route-registration time;
  // request data can never select an arbitrary file on disk.
  const sourcePath =
    options.sourcePath ??
    join(repoRoot(), 'packages', 'archetypes', 'src', 'fighter', 'outfits.json');

  app.get('/api/dev/fighter/outfits', async (_req, reply) => {
    const source = readSource(sourcePath);
    if (!source.ok) return sourceError(reply, source);
    return {
      ok: true,
      file: SOURCE_REL,
      version: source.document.version,
      revision: source.revision,
      outfits: source.document.outfits,
    };
  });

  app.put('/api/dev/fighter/outfits/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(FIGHTER_OUTFIT_IDS as readonly string[]).includes(id)) {
      return reply.code(404).send({ error: 'unknown fighter outfit' });
    }

    const body = req.body;
    if (!isRecord(body) || !hasExactKeys(body, ['revision', 'style'])) {
      return reply.code(400).send({ error: 'body must contain exactly revision and style' });
    }
    if (typeof body.revision !== 'string' || !REVISION_RE.test(body.revision)) {
      return reply.code(400).send({ error: 'revision must be a SHA-256 hex digest' });
    }

    const source = readSource(sourcePath);
    if (!source.ok) return sourceError(reply, source);
    const outfit = id as keyof FighterOutfitRigMap;
    if (body.revision !== source.revision) {
      return reply.code(409).send({
        error: 'fighter outfit source changed; reload before saving',
        revision: source.revision,
        outfit,
        style: source.document.outfits[outfit],
      });
    }

    const style = validateFighterOutfitRig(body.style, 'style');
    if (!style.ok) {
      return reply.code(422).send({
        error: 'fighter outfit style is invalid',
        details: style.errors,
      });
    }
    const candidate: FighterOutfitRigDocument = {
      version: 1,
      outfits: {
        ...source.document.outfits,
        [outfit]: style.value,
      },
    };
    // Validate the merged document too: a successful save must always leave a
    // complete, exact six-outfit source file, even if validation evolves later.
    const complete = validateFighterOutfitRigDocument(candidate);
    if (!complete.ok) {
      return reply.code(422).send({
        error: 'edited fighter outfit source is invalid',
        details: complete.errors,
      });
    }
    candidate.outfits = complete.value.outfits;

    const serialized = `${JSON.stringify(candidate, null, 2)}\n`;
    try {
      atomicWriteFile(sourcePath, serialized);
    } catch (error) {
      req.log.error({ error }, 'failed to save fighter outfit source');
      return reply.code(500).send({ error: 'fighter outfit source could not be saved' });
    }

    return {
      ok: true,
      file: SOURCE_REL,
      version: candidate.version,
      revision: fighterOutfitRevision(serialized),
      outfit,
      style: complete.value.outfits[outfit] as FighterOutfitRig,
    };
  });
}
