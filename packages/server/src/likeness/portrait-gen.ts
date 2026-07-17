// Generated likeness portrait (experimental, OFF by default). An image model
// redraws the player's photo as a stylised arcade portrait for the story card
// (the large 64px slot). Uses an OpenAI-style images/edits endpoint as the
// placeholder; when Meta's Muse Image API ships it should drop in by changing
// only baseUrl/model/apiKeyEnv in config.likeness.portraitGen. Falls back to the
// pixel-photo bake on any failure (caller catches), so it never breaks a game.
import sharp from 'sharp';
import { PORTRAIT_SIZE } from '@sparkade/shared';
import { apiKeyFor, ProviderHttpError } from '../providers/base';
import type { FaceFeatures } from './features';

export interface PortraitGenConfig {
  enabled?: boolean;
  baseUrl: string; // e.g. https://api.openai.com/v1
  model: string; // e.g. gpt-image-1
  apiKeyEnv: string; // env var holding the key
  size?: string; // generation size, e.g. 1024x1024
}

export function describeVisibleTraits(feat: FaceFeatures): string {
  const bits: string[] = [];
  bits.push(
    feat.hairStyle === 'hidden'
      ? 'scalp hair fully hidden by the headwear; do not invent visible hair'
      : (feat.hairColor ?? '').trim().toLowerCase() === 'none' || feat.hairStyle === 'bald'
        ? 'bald'
        : `${feat.hairStyle ?? 'visible'} hair`,
  );
  if (feat.facialHair && feat.facialHair !== 'none') bits.push(`a ${feat.facialHair}`);
  if (feat.glasses) bits.push('glasses');
  if (feat.headwear) bits.push('their headwear');
  return bits.join(', ');
}

async function requestImageEdit(photo: Buffer, prompt: string, cfg: PortraitGenConfig): Promise<Buffer> {
  const key = apiKeyFor(cfg.apiKeyEnv, 'portraitGen');
  // Normalize the input to a square PNG the edit endpoint will accept.
  const png = await sharp(photo).rotate().resize(512, 512, { fit: 'cover' }).png().toBuffer();
  const form = new FormData();
  form.append('model', cfg.model);
  form.append('prompt', prompt);
  form.append('size', cfg.size ?? '1024x1024');
  form.append('n', '1');
  form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'photo.png');

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/images/edits`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) throw new Error(`portrait gen rejected the API key (HTTP ${res.status})`);
    throw new ProviderHttpError(`portrait gen HTTP ${res.status}: ${body.slice(0, 200)}`, res.status, null, body);
  }
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('portrait gen: no image in the response');
  return Buffer.from(b64, 'base64');
}

/** Generate one stylised portrait from the photo; returns a PORTRAIT_SIZE PNG. */
export async function generatePortrait(photo: Buffer, feat: FaceFeatures, cfg: PortraitGenConfig): Promise<Buffer> {
  const prompt = [
    'Redraw the person in this photo as a friendly 16-bit pixel-art arcade video-game character —',
    'a front-facing head-and-shoulders portrait bust.',
    `Preserve their likeness: ${describeVisibleTraits(feat)}, their skin tone, and their expression.`,
    'Clean flat colours, a bold dark outline, a simple plain dark background.',
    'Cheerful retro SNES game art, stylised and characterful, NOT photorealistic.',
  ].join(' ');

  const generated = await requestImageEdit(photo, prompt, cfg);
  // Into the retro portrait slot the story card already renders (pixelated).
  return sharp(generated)
    .resize(PORTRAIT_SIZE, PORTRAIT_SIZE, { fit: 'cover', kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

export const GENERATED_HEAD_SIZES = [16, 20, 24, 28] as const;
export const GENERATED_HEAD_PROMPT_VERSION = 'generated-heads-v1';

export interface GeneratedHeadSprites {
  /** Full-resolution, square, transparent-background source for inspection. */
  master: Buffer;
  heads: Record<string, Buffer>;
}

/**
 * Remove every green-screen pixel, including regions that the model accidentally
 * encloses behind its dark outline. The prompt forbids green in the subject, so
 * color-keying all green-dominant pixels is safer than an edge flood fill. The
 * remaining head is cropped into a padded transparent square before reduction.
 */
export async function extractGeneratedHead(image: Buffer, padding = 0.1): Promise<Buffer> {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const count = width * height;
  const isGreenScreen = (pixel: number): boolean => {
    const offset = pixel * 4;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    return g > 45 && g > r * 1.15 && g > b * 1.15;
  };
  let removed = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4;
    if (isGreenScreen(pixel)) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
      removed++;
    }
    if (data[offset + 3] === 0) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (removed < count * 0.05) throw new Error('generated head did not contain a removable green background');
  if (maxX < minX || maxY < minY) throw new Error('generated head became empty after background removal');

  const subjectW = maxX - minX + 1;
  const subjectH = maxY - minY + 1;
  const side = Math.ceil(Math.max(subjectW, subjectH) * (1 + padding));
  const extraX = side - subjectW;
  const extraY = side - subjectH;
  return sharp(data, { raw: info })
    .extract({ left: minX, top: minY, width: subjectW, height: subjectH })
    .extend({
      left: Math.floor(extraX / 2),
      right: Math.ceil(extraX / 2),
      top: Math.floor(extraY / 2),
      bottom: Math.ceil(extraY / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/** Generate one identity-preserving head master, then reduce it locally. */
export async function generateHeadSprites(
  photo: Buffer,
  feat: FaceFeatures,
  cfg: PortraitGenConfig,
): Promise<GeneratedHeadSprites> {
  const prompt = [
    'Redraw the exact person in the reference photo as one isolated front-facing pixel-art HEAD sprite.',
    `Preserve their recognizable visible identity, not a generic face: ${describeVisibleTraits(feat)}, their actual skin and hair colors, face proportions, expression, glasses shape, and facial-hair placement.`,
    'Glasses must frame two separate visible eyes. Facial hair must preserve upper-lip, chin, and jaw coverage separately. Never invent hair hidden by headwear.',
    'HEAD ONLY from the top of hair/scalp/headwear through the chin, including ears. Absolutely no neck, shoulders, torso, collar, or clothing.',
    'Center the head and fill about 82 percent of the square without clipping.',
    'Polished SNES-era native 32x32 sprite art enlarged cleanly: deliberate square pixel clusters, crisp hard edges, limited flat colors, and readable separate eyes, nose, mouth, and facial hair.',
    'No antialiasing, blur, dithering, gradients, photorealism, text, watermark, or extra objects.',
    'The background must be perfectly flat solid #00ff00 with no shadow, glow, texture, or color variation. Do not use #00ff00 in the head.',
  ].join(' ');
  const generated = await requestImageEdit(photo, prompt, cfg);
  const master = await extractGeneratedHead(generated);
  const heads = Object.fromEntries(
    await Promise.all(
      GENERATED_HEAD_SIZES.map(async (size) => [
        String(size),
        await sharp(master)
          .resize(size, size, { fit: 'fill', kernel: 'nearest' })
          .png({ palette: true, colours: 16, dither: 0 })
          .toBuffer(),
      ] as const),
    ),
  );
  return { master, heads };
}
