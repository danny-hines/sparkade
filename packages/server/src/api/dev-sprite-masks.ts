import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpriteMaskComparison, SpriteMaskStrategy, SpriteMaskVariant } from '@sparkade/shared';
import { maskGeneratedFighterPose, type MaskedSpriteImage } from '../assets/fighter-pose';
import {
  normalizeMaskedPlatformerPose,
  processGeneratedPlatformerPose,
} from '../assets/platformer-pose';
import {
  applySamMask,
  decodeSpriteSource,
  despillSpriteBoundary,
  encodeSpritePixels,
  hybridSpriteMask,
  spriteAlphaPng,
  SPRITE_MASK_PROCESSOR_VERSION,
} from '../assets/sprite-mask';
import {
  MetaSamAdapter,
  META_SAM_MODEL,
  META_SAM_PRICE_PER_IMAGE_USD,
  type SpriteSegmentation,
} from '../providers/meta-sam';
import { apiKeyFor } from '../providers/base';
import type { ConfigStore } from '../storage/config';
import { atomicWriteFile, ensureDir } from '../util';

const ROOT = '/api/dev/platformer-poses/mask-comparisons';
const MAX_BYTES = 10 * 1024 * 1024;
const STRATEGIES: SpriteMaskStrategy[] = ['chroma', 'sam', 'sam-despill', 'sam-hybrid'];
export interface DevSpriteMaskOptions {
  segmentImage?: (
    image: Buffer,
    concept: string,
    signal: AbortSignal,
  ) => Promise<SpriteSegmentation>;
}

/** Saved-input experiments only. Production generation continues to use chroma keying. */
export function registerDevSpriteMaskRoutes(
  app: FastifyInstance,
  configStore: ConfigStore,
  dataDir: string,
  options: DevSpriteMaskOptions = {},
): void {
  const root = ensureDir(join(dataDir, 'experiments', 'sprite-masks'));
  const active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  const dirFor = (id: string): string | null =>
    /^[a-f0-9-]{36}$/.test(id) ? join(root, id) : null;
  const read = (id: string): SpriteMaskComparison | null => {
    const dir = dirFor(id);
    if (!dir || !existsSync(join(dir, 'manifest.json'))) return null;
    const run = JSON.parse(
      readFileSync(join(dir, 'manifest.json'), 'utf8'),
    ) as SpriteMaskComparison;
    if (run.status === 'running' && !active.has(id)) {
      run.status = 'failed';
      run.error = 'Comparison interrupted by a server restart. Start a new comparison to retry.';
    }
    return run;
  };
  const save = (run: SpriteMaskComparison): void => {
    atomicWriteFile(join(root, run.id, 'manifest.json'), JSON.stringify(run, null, 2) + '\n');
  };
  const asset = (id: string, name: string, bytes: Buffer | string): string => {
    atomicWriteFile(join(root, id, name), bytes);
    return `${ROOT}/${id}/assets/${name}`;
  };

  app.post(ROOT, async (req, reply) => {
    if (active.size >= 2)
      return reply.code(429).send({ error: 'Two mask comparisons are already running' });
    let image: Buffer | undefined;
    let concept = '';
    for await (const part of req.parts({ limits: { fileSize: MAX_BYTES, files: 1, fields: 1 } })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'image')
          return reply.code(400).send({ error: 'Expected an image upload' });
        image = await part.toBuffer();
      } else if (part.fieldname === 'concept') concept = String(part.value).trim();
    }
    if (!image?.length || !concept || concept.length > 160 || /[\r\n]/.test(concept)) {
      return reply
        .code(400)
        .send({ error: 'Upload a raw sprite and name one subject (1–160 characters)' });
    }
    const config = configStore.get().imageGeneration;
    if (!options.segmentImage) {
      if (process.env.SPARKADE_PROVIDER === 'mock') {
        return reply.code(409).send({
          error: 'SAM comparisons require a live provider; mock masks are not a quality comparison',
        });
      }
      try {
        apiKeyFor(config.apiKeyEnv, 'meta-sam');
      } catch {
        return reply
          .code(503)
          .send({ error: `SAM needs the configured ${config.apiKeyEnv} credential` });
      }
    }
    let pixels: MaskedSpriteImage;
    try {
      pixels = await decodeSpriteSource(image);
    } catch {
      return reply.code(400).send({ error: 'Invalid image or image exceeds 4096 × 4096 pixels' });
    }
    // Canonicalize once; every strategy sees identical oriented, unscaled pixels.
    const source = await encodeSpritePixels(pixels);
    if (active.size >= 2)
      return reply.code(429).send({ error: 'Two mask comparisons are already running' });
    return reply.code(202).send(startComparison(source, pixels, concept, image));
  });

  const startComparison = (
    source: Buffer,
    pixels: MaskedSpriteImage,
    concept: string,
    image: Buffer,
    reuse?: { id: string; segmentation: SpriteSegmentation },
  ): SpriteMaskComparison => {
    const id = randomUUID();
    ensureDir(join(root, id));
    asset(id, 'upload.bin', image);
    const run: SpriteMaskComparison = {
      id,
      status: 'running',
      createdAt: new Date().toISOString(),
      concept,
      sourceUrl: asset(id, 'source.png', source),
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      processorVersion: SPRITE_MASK_PROCESSOR_VERSION,
      reusedFrom: reuse?.id,
      model: META_SAM_MODEL,
      variants: [],
      segmentationCalls: 0,
      estimatedCostUsd: reuse ? 0 : null,
    };
    save(run);
    const controller = new AbortController();
    const adapter = new MetaSamAdapter(configStore.get().imageGeneration);
    const segment =
      options.segmentImage ??
      ((input, text, signal) => adapter.segmentImage(input, text, { signal }));
    const execute = async (): Promise<void> => {
      const variant = async (
        strategy: SpriteMaskStrategy,
        masked: MaskedSpriteImage,
        changedPixels = 0,
        hybrid?: SpriteMaskVariant['hybrid'],
      ) => {
        const started = Date.now();
        const result: SpriteMaskVariant = {
          strategy,
          status: 'failed',
          elapsedMs: 0,
          changedPixels,
          hybrid,
        };
        try {
          result.maskUrl = asset(id, `${strategy}-mask.png`, await spriteAlphaPng(masked));
          result.cutoutUrl = asset(id, `${strategy}-cutout.png`, await encodeSpritePixels(masked));
          const normalized =
            strategy === 'chroma'
              ? await processGeneratedPlatformerPose(source)
              : await normalizeMaskedPlatformerPose(masked);
          result.spriteUrl = asset(id, `${strategy}-sprite.png`, normalized.png);
          result.metrics = normalized.metrics;
          result.status = 'complete';
        } catch (error) {
          result.error = message(error);
        }
        result.elapsedMs = Date.now() - started;
        run.variants.push(result);
        save(run);
      };
      try {
        await variant('chroma', await maskGeneratedFighterPose(source, { removeGreenSpill: true }));
      } catch (error) {
        run.variants.push({
          strategy: 'chroma',
          status: 'failed',
          elapsedMs: 0,
          error: message(error),
        });
        save(run);
      }
      const started = Date.now();
      run.segmentationCalls = reuse ? 0 : 1;
      save(run);
      try {
        const segmentation =
          reuse?.segmentation ?? (await segment(source, concept, controller.signal));
        run.segmentationMs = reuse ? 0 : Date.now() - started;
        run.responseId = segmentation.responseId;
        run.estimatedCostUsd = reuse || options.segmentImage ? 0 : META_SAM_PRICE_PER_IMAGE_USD;
        asset(id, 'sam-response.json', JSON.stringify(segmentation, null, 2));
        if (segmentation.masks.length !== 1) {
          throw new Error(
            segmentation.masks.length === 0
              ? 'SAM found no matching subject. Try a simpler concept.'
              : `SAM found ${segmentation.masks.length} subjects. Use a more specific concept or a single-sprite source.`,
          );
        }
        const masked = await applySamMask(pixels, segmentation.masks[0]!);
        await variant('sam', masked);
        const cleaned = despillSpriteBoundary(masked);
        await variant('sam-despill', cleaned.image, cleaned.changedPixels);
        try {
          const hybrid = hybridSpriteMask(pixels, masked);
          await variant('sam-hybrid', hybrid.image, 0, hybrid.hybrid);
        } catch (error) {
          run.variants.push({
            strategy: 'sam-hybrid',
            status: 'failed',
            elapsedMs: 0,
            error: message(error),
          });
        }
        run.status = run.variants.some((v) => v.strategy === 'sam' && v.status === 'complete')
          ? 'complete'
          : 'failed';
      } catch (error) {
        run.segmentationMs = Date.now() - started;
        run.status = 'failed';
        run.error = message(error);
        for (const strategy of ['sam', 'sam-despill', 'sam-hybrid'] as const) {
          if (!run.variants.some((v) => v.strategy === strategy)) {
            run.variants.push({ strategy, status: 'failed', elapsedMs: 0, error: run.error });
          }
        }
      }
      save(run);
    };
    const promise = execute()
      .catch((error: unknown) => {
        run.status = 'failed';
        run.error = message(error);
        save(run);
      })
      .finally(() => active.delete(id));
    active.set(id, { controller, promise });
    return run;
  };

  app.post(`${ROOT}/:id/reprocess`, async (req, reply) => {
    if (active.size >= 2)
      return reply.code(429).send({ error: 'Two mask comparisons are already running' });
    const previous = read((req.params as { id: string }).id);
    if (!previous) return reply.code(404).send({ error: 'Unknown mask comparison' });
    if (previous.status === 'running')
      return reply.code(409).send({ error: 'Wait for the comparison to finish' });
    const dir = dirFor(previous.id)!;
    if (!existsSync(join(dir, 'sam-response.json')))
      return reply.code(409).send({ error: 'This comparison has no saved SAM response to reuse' });
    try {
      const source = readFileSync(join(dir, 'source.png'));
      if (createHash('sha256').update(source).digest('hex') !== previous.sourceSha256)
        return reply.code(409).send({ error: 'Saved source no longer matches this comparison' });
      const segmentation = JSON.parse(
        readFileSync(join(dir, 'sam-response.json'), 'utf8'),
      ) as SpriteSegmentation;
      if (!Array.isArray(segmentation.masks) || segmentation.model !== META_SAM_MODEL)
        return reply.code(409).send({ error: 'Saved SAM response cannot be reused' });
      const pixels = await decodeSpriteSource(source);
      if (active.size >= 2)
        return reply.code(429).send({ error: 'Two mask comparisons are already running' });
      return reply.code(202).send(
        startComparison(source, pixels, previous.concept, source, {
          id: previous.id,
          segmentation,
        }),
      );
    } catch (error) {
      return reply.code(409).send({ error: `Could not reuse saved comparison: ${message(error)}` });
    }
  });

  app.get(`${ROOT}/:id`, async (req, reply) => {
    const run = read((req.params as { id: string }).id);
    return run ?? reply.code(404).send({ error: 'Unknown mask comparison' });
  });
  app.get(`${ROOT}/:id/assets/:name`, async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const dir = dirFor(id);
    if (
      !dir ||
      !/^(source|(?:chroma|sam|sam-despill|sam-hybrid)-(?:mask|cutout|sprite))\.png$/.test(name) ||
      !existsSync(join(dir, name))
    )
      return reply.code(404).send({ error: 'Unknown comparison asset' });
    return reply.type('image/png').send(readFileSync(join(dir, name)));
  });
  app.post(`${ROOT}/:id/verdict`, async (req, reply) => {
    const run = read((req.params as { id: string }).id);
    if (!run) return reply.code(404).send({ error: 'Unknown mask comparison' });
    if (run.status === 'running')
      return reply.code(409).send({ error: 'Wait for the comparison to finish' });
    const body = req.body as { preferred?: SpriteMaskStrategy | 'none'; notes?: string } | null;
    if (
      !body ||
      ![...STRATEGIES, 'none'].includes(body.preferred ?? '') ||
      typeof body.notes !== 'string' ||
      body.notes.length > 2000 ||
      (body.preferred !== 'none' &&
        !run.variants.some((v) => v.strategy === body.preferred && v.status === 'complete'))
    ) {
      return reply
        .code(400)
        .send({ error: 'Choose a completed strategy or none, with notes up to 2000 characters' });
    }
    run.verdict = { preferred: body.preferred!, notes: body.notes, at: new Date().toISOString() };
    save(run);
    return run;
  });
  app.addHook('onClose', async () => {
    const pending = [...active.values()];
    for (const task of pending) task.controller.abort();
    await Promise.allSettled(pending.map((task) => task.promise));
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
