// Dev-only "Likeness Lab" endpoints (registered only when SPARKADE_DEV=1). Let
// the avatar / photo-bake be iterated in isolation, without generating a whole
// game: render an avatar straight from hand-set FaceFeatures (free, instant), or
// drop a photo to run the real vision analysis + render both styles for compare.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { drawAvatarLikeness, drawAvatarSizes } from '../likeness/avatar';
import { bakeLikeness, type LikenessArtifacts } from '../likeness/likeness';
import { buildFaceAnalysisPrompt, buildPortraitPalette, type FaceFeatures } from '../likeness/features';
import { generatePortrait } from '../likeness/portrait-gen';
import { parseModelJson } from '../pipeline/prompts';
import { stageProvider } from '../providers/index';
import type { ConfigStore } from '../storage/config';

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
// Candidate in-game head sizes for the "how big should the head be?" comparison.
const COMPARE_SIZES = [12, 16, 20, 24, 28, 32, 48];

const png = (b: Buffer): string => `data:image/png;base64,${b.toString('base64')}`;
function toDataUris(a: LikenessArtifacts): { portrait: string; head16: string; head12: string } {
  return { portrait: png(a.portrait), head16: png(a.head16), head12: png(a.head12) };
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
    if (!feat || typeof feat !== 'object') return reply.code(400).send({ error: 'features required' });
    const detailAt = typeof body?.detailAt === 'number' ? body.detailAt : 16;
    const [avatar, heads] = await Promise.all([drawAvatarLikeness(feat), headsUris(feat, detailAt)]);
    return { avatar: toDataUris(avatar), heads };
  });

  // Photo → real vision analysis → detected features + BOTH renders (avatar +
  // photo bake) + the source photo, so the whole likeness path can be compared
  // on one screen. Costs one provider call (uses the design stage's provider).
  app.post('/api/dev/likeness/analyze', async (req, reply) => {
    const file = await (req as FastifyRequest & { file: () => Promise<MultipartFile | undefined> }).file();
    if (!file) return reply.code(400).send({ error: 'no photo uploaded' });
    const photo = await file.toBuffer();
    if (photo.length > MAX_PHOTO_BYTES) return reply.code(413).send({ error: 'photo too large' });

    const config = configStore.get();
    const { provider, model } = stageProvider(config, 'design');
    const prompt = buildFaceAnalysisPrompt();
    let features: FaceFeatures;
    try {
      const res = await provider.complete(
        {
          system: prompt.system,
          user: prompt.user,
          maxTokens: prompt.maxTokens,
          ...(provider.capabilities.structuredOutput ? { jsonSchema: prompt.jsonSchema } : {}),
          ...(provider.capabilities.imageIn ? { image: photo } : {}),
        },
        { model },
      );
      features = parseModelJson(res.text) as FaceFeatures;
    } catch (e) {
      return reply.code(502).send({ error: `vision analysis failed: ${e instanceof Error ? e.message : String(e)}` });
    }

    const [avatar, bake, heads] = await Promise.all([
      drawAvatarLikeness(features),
      bakeLikeness(photo, buildPortraitPalette(features), 10),
      headsUris(features, 16),
    ]);
    return {
      features,
      avatar: toDataUris(avatar),
      bake: toDataUris(bake),
      heads,
      photo: `data:image/jpeg;base64,${photo.toString('base64')}`,
    };
  });

  // Photo + features → an image-model-generated portrait, for prototyping the
  // experimental portraitGen path before enabling it in the pipeline. Uses the
  // configured portraitGen block regardless of its `enabled` flag; needs its
  // API key set (OPENAI_API_KEY for the default OpenAI placeholder).
  app.post('/api/dev/likeness/generate', async (req, reply) => {
    let photo: Buffer | undefined;
    let features: FaceFeatures | undefined;
    for await (const part of (req as FastifyRequest & { parts: () => AsyncIterable<Record<string, unknown>> }).parts()) {
      if (part.type === 'file' && part.fieldname === 'photo') photo = await (part as { toBuffer: () => Promise<Buffer> }).toBuffer();
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
      return reply.code(502).send({ error: `portrait gen failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
}
