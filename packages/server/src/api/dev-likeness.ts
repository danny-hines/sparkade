// Dev-only "Likeness Lab" endpoints (registered only when SPARKADE_DEV=1). Let
// the avatar / photo-bake be iterated in isolation, without generating a whole
// game: render an avatar straight from hand-set FaceFeatures (free, instant), or
// drop a photo to run the real vision analysis + render both styles for compare.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { drawAvatarLikeness } from '../likeness/avatar';
import { bakeLikeness, type LikenessArtifacts } from '../likeness/likeness';
import { buildFaceAnalysisPrompt, buildPortraitPalette, type FaceFeatures } from '../likeness/features';
import { parseModelJson } from '../pipeline/prompts';
import { stageProvider } from '../providers/index';
import type { ConfigStore } from '../storage/config';

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

function toDataUris(a: LikenessArtifacts): { portrait: string; head16: string; head12: string } {
  const png = (b: Buffer): string => `data:image/png;base64,${b.toString('base64')}`;
  return { portrait: png(a.portrait), head16: png(a.head16), head12: png(a.head12) };
}

export function registerDevLikenessRoutes(app: FastifyInstance, configStore: ConfigStore): void {
  // Hand-set FaceFeatures → drawn avatar. Deterministic and free; the lab calls
  // this on every control change for live iteration.
  app.post('/api/dev/likeness/render', async (req, reply) => {
    const feat = (req.body as { features?: FaceFeatures } | null)?.features;
    if (!feat || typeof feat !== 'object') return reply.code(400).send({ error: 'features required' });
    const avatar = await drawAvatarLikeness(feat);
    return { avatar: toDataUris(avatar) };
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

    const [avatar, bake] = await Promise.all([
      drawAvatarLikeness(features),
      bakeLikeness(photo, buildPortraitPalette(features), 10),
    ]);
    return {
      features,
      avatar: toDataUris(avatar),
      bake: toDataUris(bake),
      photo: `data:image/jpeg;base64,${photo.toString('base64')}`,
    };
  });
}
