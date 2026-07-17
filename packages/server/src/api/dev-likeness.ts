// Dev-only "Likeness Lab" endpoints (registered only when SPARKADE_DEV=1). Let
// the avatar / photo-bake be iterated in isolation, without generating a whole
// game: render an avatar straight from hand-set FaceFeatures (free, instant), or
// drop a photo to run the real vision analysis + render both styles for compare.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { MAX_PHOTO_DIM } from '@sparkade/shared';
import { drawAvatarLikeness, drawAvatarSizes } from '../likeness/avatar';
import { bakeLikeness, type LikenessArtifacts } from '../likeness/likeness';
import {
  FACE_ANALYSIS_PROMPT_VERSION,
  buildFaceAnalysisPrompt,
  buildPortraitPalette,
  normalizeFaceFeatures,
  type FaceFeatures,
} from '../likeness/features';
import {
  GENERATED_HEAD_PROMPT_VERSION,
  generateHeadSprites,
  generatePortrait,
  type GeneratedHeadSprites,
} from '../likeness/portrait-gen';
import {
  DIRECT_PIXEL_PROMPT_VERSION,
  generateDirectPixelLikeness,
  type DirectPixelLikeness,
} from '../likeness/direct-pixels';
import {
  PHOTO_HEAD_PROMPT_VERSION,
  generatePhotoHeadLikeness,
  type PhotoHeadLikeness,
} from '../likeness/photo-head';
import { parseModelJson } from '../pipeline/prompts';
import { stageProvider } from '../providers/index';
import type { ConfigStore } from '../storage/config';

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
// Candidate in-game head sizes for the "how big should the head be?" comparison.
const COMPARE_SIZES = [12, 16, 20, 24, 28, 32, 48];
const directPixelCache = new Map<string, DirectPixelLikeness>();
const directPixelInFlight = new Map<string, Promise<DirectPixelLikeness>>();
const photoHeadCache = new Map<string, PhotoHeadLikeness>();
const photoHeadInFlight = new Map<string, Promise<PhotoHeadLikeness>>();
const generatedHeadCache = new Map<string, GeneratedHeadSprites>();
const generatedHeadInFlight = new Map<string, Promise<GeneratedHeadSprites>>();

const png = (b: Buffer): string => `data:image/png;base64,${b.toString('base64')}`;
function toDataUris(a: LikenessArtifacts): {
  portrait: string;
  head16: string;
  head12: string;
  head12Side?: string;
  head12Back?: string;
  head16Side?: string;
  head16Back?: string;
} {
  return {
    portrait: png(a.portrait),
    head16: png(a.head16),
    head12: png(a.head12),
    ...(a.head12Side ? { head12Side: png(a.head12Side) } : {}),
    ...(a.head12Back ? { head12Back: png(a.head12Back) } : {}),
    ...(a.head16Side ? { head16Side: png(a.head16Side) } : {}),
    ...(a.head16Back ? { head16Back: png(a.head16Back) } : {}),
  };
}
async function headsUris(feat: FaceFeatures, detailAt: number): Promise<Record<number, string>> {
  const bufs = await drawAvatarSizes(feat, COMPARE_SIZES, detailAt);
  return Object.fromEntries(Object.entries(bufs).map(([s, b]) => [s, png(b)]));
}

export function registerDevLikenessRoutes(app: FastifyInstance, configStore: ConfigStore): void {
  // Hand-set FaceFeatures → drawn avatar. Deterministic and free; the lab calls
  // this on every control change for live iteration.
  app.post('/api/dev/likeness/render', async (req, reply) => {
    const body = req.body as { features?: FaceFeatures; detailAt?: number } | null;
    const feat = body?.features;
    if (!feat || typeof feat !== 'object')
      return reply.code(400).send({ error: 'features required' });
    const detailAt = typeof body?.detailAt === 'number' ? body.detailAt : 16;
    const [avatar, heads] = await Promise.all([
      drawAvatarLikeness(feat),
      headsUris(feat, detailAt),
    ]);
    return { avatar: toDataUris(avatar), heads };
  });

  // Photo → real vision analysis → detected features + BOTH renders (avatar +
  // photo bake) + the source photo, so the whole likeness path can be compared
  // on one screen. Costs one provider call (uses the design stage's provider).
  app.post('/api/dev/likeness/analyze', async (req, reply) => {
    const file = await (
      req as FastifyRequest & { file: () => Promise<MultipartFile | undefined> }
    ).file();
    if (!file) return reply.code(400).send({ error: 'no photo uploaded' });
    const upload = await file.toBuffer();
    if (upload.length > MAX_PHOTO_BYTES) return reply.code(413).send({ error: 'photo too large' });
    let photo: Buffer;
    try {
      // Provider adapters send image bytes as image/jpeg. Normalize arbitrary
      // lab uploads first so PNG/WebP bytes are never mislabeled upstream.
      photo = await sharp(upload)
        .rotate()
        .resize(MAX_PHOTO_DIM, MAX_PHOTO_DIM, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 92 })
        .toBuffer();
    } catch {
      return reply.code(400).send({ error: 'unsupported or invalid image' });
    }

    const config = configStore.get();
    const { provider, model } = stageProvider(config, 'design');
    if (!provider.capabilities.imageIn) {
      return reply
        .code(400)
        .send({ error: 'the configured design provider does not support image input' });
    }
    const prompt = buildFaceAnalysisPrompt();
    let features: FaceFeatures;
    let rawFeatures: unknown;
    try {
      const res = await provider.complete(
        {
          system: prompt.system,
          user: prompt.user,
          maxTokens: prompt.maxTokens,
          temperature: 0,
          ...(provider.capabilities.structuredOutput ? { jsonSchema: prompt.jsonSchema } : {}),
          ...(provider.capabilities.imageIn ? { image: photo } : {}),
        },
        { model },
      );
      rawFeatures = parseModelJson(res.text);
      features = normalizeFaceFeatures(rawFeatures);
    } catch (e) {
      return reply
        .code(502)
        .send({ error: `vision analysis failed: ${e instanceof Error ? e.message : String(e)}` });
    }

    const [avatar, bake, heads] = await Promise.all([
      drawAvatarLikeness(features),
      bakeLikeness(photo, buildPortraitPalette(features), 10),
      headsUris(features, 16),
    ]);
    return {
      features,
      rawFeatures,
      analysisVersion: FACE_ANALYSIS_PROMPT_VERSION,
      avatar: toDataUris(avatar),
      bake: toDataUris(bake),
      heads,
      photo: `data:image/jpeg;base64,${photo.toString('base64')}`,
    };
  });

  // Photo + analyzed topology -> one Muse-authored semantic 28px master. Local
  // code derives the smaller candidates, and an in-memory content cache keeps
  // this explicit paid action from being repeated by an accidental double-click.
  app.post('/api/dev/likeness/pixels', async (req, reply) => {
    let upload: Buffer | undefined;
    let suppliedFeatures: FaceFeatures | undefined;
    for await (const part of (
      req as FastifyRequest & { parts: () => AsyncIterable<Record<string, unknown>> }
    ).parts()) {
      if (part.type === 'file' && part.fieldname === 'photo') {
        upload = await (part as { toBuffer: () => Promise<Buffer> }).toBuffer();
      } else if (part.type === 'field' && part.fieldname === 'features') {
        try {
          suppliedFeatures = normalizeFaceFeatures(
            JSON.parse(String((part as { value: unknown }).value)),
          );
        } catch {
          return reply.code(400).send({ error: 'invalid face features' });
        }
      }
    }
    if (!upload) return reply.code(400).send({ error: 'no photo uploaded' });
    if (!suppliedFeatures)
      return reply.code(400).send({ error: 'analyzed face features required' });
    const features = normalizeFaceFeatures(suppliedFeatures);
    if (upload.length > MAX_PHOTO_BYTES) return reply.code(413).send({ error: 'photo too large' });
    try {
      await sharp(upload).metadata();
    } catch {
      return reply.code(400).send({ error: 'unsupported or invalid image' });
    }

    const config = configStore.get();
    const { provider, providerName, model } = stageProvider(config, 'design');
    if (!provider.capabilities.imageIn || !provider.capabilities.structuredOutput) {
      return reply
        .code(400)
        .send({ error: 'direct pixels require image input and structured output' });
    }
    const key = createHash('sha256')
      .update(upload)
      .update(providerName)
      .update(model)
      .update(JSON.stringify(features))
      .update(DIRECT_PIXEL_PROMPT_VERSION)
      .digest('hex');
    const fresh = (req.query as { fresh?: string } | null)?.fresh === '1';
    const hit = fresh ? undefined : directPixelCache.get(key);

    try {
      let result = hit;
      if (!result) {
        let pending = fresh ? undefined : directPixelInFlight.get(key);
        if (!pending) {
          pending = generateDirectPixelLikeness(upload, features, provider, model);
          if (!fresh) directPixelInFlight.set(key, pending);
        }
        try {
          result = await pending;
        } finally {
          if (!fresh) directPixelInFlight.delete(key);
        }
        directPixelCache.set(key, result);
        if (directPixelCache.size > 32) {
          const oldest = directPixelCache.keys().next().value;
          if (oldest) directPixelCache.delete(oldest);
        }
      }
      return {
        identityCues: result.document.identityCues,
        palette: result.document.palette,
        sprites: Object.fromEntries(
          Object.entries(result.pngs).map(([size, buffer]) => [size, png(buffer)]),
        ),
        validation: result.document.validation,
        usage: result.usage,
        model,
        cached: !!hit,
      };
    } catch (e) {
      return reply
        .code(502)
        .send({ error: `direct pixels failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  // Photo + previously analyzed Muse traits -> a dedicated Muse box/landmark
  // pass -> deterministic segmentation and pixelization of the real source.
  // Muse does visual measurement, but never has to spell a colored raster.
  app.post('/api/dev/likeness/photo-head', async (req, reply) => {
    let upload: Buffer | undefined;
    let suppliedFeatures: FaceFeatures | undefined;
    for await (const part of (
      req as FastifyRequest & { parts: () => AsyncIterable<Record<string, unknown>> }
    ).parts()) {
      if (part.type === 'file' && part.fieldname === 'photo') {
        upload = await (part as { toBuffer: () => Promise<Buffer> }).toBuffer();
      } else if (part.type === 'field' && part.fieldname === 'features') {
        try {
          suppliedFeatures = normalizeFaceFeatures(
            JSON.parse(String((part as { value: unknown }).value)),
          );
        } catch {
          return reply.code(400).send({ error: 'invalid face features' });
        }
      }
    }
    if (!upload) return reply.code(400).send({ error: 'no photo uploaded' });
    if (!suppliedFeatures)
      return reply.code(400).send({ error: 'analyzed face features required' });
    const features = normalizeFaceFeatures(suppliedFeatures);
    if (upload.length > MAX_PHOTO_BYTES) return reply.code(413).send({ error: 'photo too large' });
    try {
      await sharp(upload).metadata();
    } catch {
      return reply.code(400).send({ error: 'unsupported or invalid image' });
    }

    const config = configStore.get();
    const { provider, providerName, model } = stageProvider(config, 'design');
    if (!provider.capabilities.imageIn || !provider.capabilities.structuredOutput) {
      return reply
        .code(400)
        .send({ error: 'Muse-guided photo heads require image input and structured output' });
    }
    const key = createHash('sha256')
      .update(upload)
      .update(providerName)
      .update(model)
      .update(JSON.stringify(features))
      .update(PHOTO_HEAD_PROMPT_VERSION)
      .digest('hex');
    const fresh = (req.query as { fresh?: string } | null)?.fresh === '1';
    const hit = fresh ? undefined : photoHeadCache.get(key);

    try {
      let result = hit;
      if (!result) {
        let pending = fresh ? undefined : photoHeadInFlight.get(key);
        if (!pending) {
          pending = generatePhotoHeadLikeness(upload, features, provider, model);
          if (!fresh) photoHeadInFlight.set(key, pending);
        }
        try {
          result = await pending;
        } finally {
          if (!fresh) photoHeadInFlight.delete(key);
        }
        photoHeadCache.set(key, result);
        if (photoHeadCache.size > 32) {
          const oldest = photoHeadCache.keys().next().value;
          if (oldest) photoHeadCache.delete(oldest);
        }
      }
      return {
        features: result.features,
        geometry: result.geometry,
        sprites: Object.fromEntries(
          Object.entries(result.pngs).map(([size, buffer]) => [size, png(buffer)]),
        ),
        usage: result.usage,
        model,
        cached: !!hit,
      };
    } catch (e) {
      return reply
        .code(502)
        .send({
          error: `Muse-guided photo head failed: ${e instanceof Error ? e.message : String(e)}`,
        });
    }
  });

  // Photo + detected traits -> an image-model-authored head master, followed by
  // deterministic local reduction. This tests whether a true image generator
  // preserves identity better than either Muse text grids or generic geometry.
  app.post('/api/dev/likeness/generated-heads', async (req, reply) => {
    let photo: Buffer | undefined;
    let features: FaceFeatures | undefined;
    for await (const part of (
      req as FastifyRequest & { parts: () => AsyncIterable<Record<string, unknown>> }
    ).parts()) {
      if (part.type === 'file' && part.fieldname === 'photo')
        photo = await (part as { toBuffer: () => Promise<Buffer> }).toBuffer();
      else if (part.type === 'field' && part.fieldname === 'features') {
        try {
          features = normalizeFaceFeatures(JSON.parse(String((part as { value: unknown }).value)));
        } catch {
          /* fall through to normalized defaults */
        }
      }
    }
    if (!photo) return reply.code(400).send({ error: 'no photo uploaded' });
    if (photo.length > MAX_PHOTO_BYTES) return reply.code(413).send({ error: 'photo too large' });
    const pg = configStore.get().likeness.portraitGen;
    if (!pg) return reply.code(400).send({ error: 'likeness.portraitGen is not configured' });
    const normalizedFeatures = normalizeFaceFeatures(features ?? {});
    const key = createHash('sha256')
      .update(photo)
      .update(JSON.stringify(normalizedFeatures))
      .update(pg.baseUrl)
      .update(pg.model)
      .update(pg.size ?? '')
      .update(GENERATED_HEAD_PROMPT_VERSION)
      .digest('hex');
    const fresh = (req.query as { fresh?: string } | null)?.fresh === '1';
    const hit = fresh ? undefined : generatedHeadCache.get(key);
    try {
      let result = hit;
      if (!result) {
        let pending = fresh ? undefined : generatedHeadInFlight.get(key);
        if (!pending) {
          pending = generateHeadSprites(photo, normalizedFeatures, pg);
          if (!fresh) generatedHeadInFlight.set(key, pending);
        }
        try {
          result = await pending;
        } finally {
          if (!fresh) generatedHeadInFlight.delete(key);
        }
        generatedHeadCache.set(key, result);
        if (generatedHeadCache.size > 16) {
          const oldest = generatedHeadCache.keys().next().value;
          if (oldest) generatedHeadCache.delete(oldest);
        }
      }
      return {
        master: png(result.master),
        heads: Object.fromEntries(
          Object.entries(result.heads).map(([size, buffer]) => [size, png(buffer)]),
        ),
        model: pg.model,
        cached: !!hit,
      };
    } catch (e) {
      return reply
        .code(502)
        .send({ error: `generated heads failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  // Photo + features → an image-model-generated portrait, for prototyping the
  // experimental portraitGen path before enabling it in the pipeline. Uses the
  // configured portraitGen block regardless of its `enabled` flag; needs its
  // API key set (OPENAI_API_KEY for the default OpenAI placeholder).
  app.post('/api/dev/likeness/generate', async (req, reply) => {
    let photo: Buffer | undefined;
    let features: FaceFeatures | undefined;
    for await (const part of (
      req as FastifyRequest & { parts: () => AsyncIterable<Record<string, unknown>> }
    ).parts()) {
      if (part.type === 'file' && part.fieldname === 'photo')
        photo = await (part as { toBuffer: () => Promise<Buffer> }).toBuffer();
      else if (part.type === 'field' && part.fieldname === 'features') {
        try {
          features = JSON.parse(String((part as { value: unknown }).value)) as FaceFeatures;
        } catch {
          /* ignore malformed features; generatePortrait tolerates a bare object */
        }
      }
    }
    if (!photo) return reply.code(400).send({ error: 'no photo uploaded' });
    const pg = configStore.get().likeness.portraitGen;
    if (!pg) return reply.code(400).send({ error: 'likeness.portraitGen is not configured' });
    try {
      const buf = await generatePortrait(photo, features ?? ({} as FaceFeatures), pg);
      return { portrait: `data:image/png;base64,${buf.toString('base64')}` };
    } catch (e) {
      return reply
        .code(502)
        .send({ error: `portrait gen failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
}
