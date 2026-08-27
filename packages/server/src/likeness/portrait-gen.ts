// Muse Image likeness assets. This module owns prompts and deterministic image
// post-processing, while its caller owns the actual Meta API adapter. Keeping
// that edit call injectable lets the pipeline record usage/cost and apply its
// retry policy without coupling likeness rendering to job storage.
import sharp from 'sharp';
import { PORTRAIT_SIZE } from '@sparkade/shared';
import type {
  MetaImageCallOptions,
  MetaImageEditRequest,
  MetaImageResult,
} from '../providers/meta-image';
import type { FaceFeatures } from './features';

/** Runner-injectable seam around MetaImageAdapter.edit(). */
export type LikenessImageEdit = (
  request: MetaImageEditRequest,
  options?: MetaImageCallOptions,
) => Promise<MetaImageResult>;

export interface LikenessImageGenerationOptions {
  /** Muse Image output size/aspect-ratio hint. */
  size?: string;
  /** Stable request owner, when the caller wants Meta-side attribution. */
  user?: string;
  /** Model, timeout, and abort controls forwarded to MetaImageAdapter.edit(). */
  callOptions?: MetaImageCallOptions;
  /** View authored for directional in-game head slots. Defaults to front. */
  direction?: GeneratedHeadDirection;
}

export const GENERATED_PORTRAIT_PROMPT_VERSION = 'generated-portrait-v1';

export function describeVisibleTraits(feat: FaceFeatures | null): string {
  if (!feat) {
    return 'every visible identity trait in the reference, including skin tone, hair texture and style, accessories, head shape, and facial proportions';
  }
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

async function requestImageEdit(
  photo: Buffer,
  prompt: string,
  edit: LikenessImageEdit,
  options: LikenessImageGenerationOptions,
): Promise<MetaImageResult> {
  // Normalize the input so arbitrary uploads are never mislabeled upstream.
  const png = await sharp(photo).rotate().resize(512, 512, { fit: 'cover' }).png().toBuffer();
  return edit(
    {
      prompt,
      image: png,
      imageMimeType: 'image/png',
      imageFilename: 'player-photo.png',
      outputFormat: 'png',
      size: options.size ?? '1024x1024',
      ...(options.user ? { user: options.user } : {}),
    },
    options.callOptions,
  );
}

/** Generate one stylised portrait from the photo; returns a PORTRAIT_SIZE PNG. */
export async function generatePortrait(
  photo: Buffer,
  feat: FaceFeatures | null,
  edit: LikenessImageEdit,
  options: LikenessImageGenerationOptions = {},
): Promise<Buffer> {
  const prompt = [
    'Redraw the person in this photo as a friendly 16-bit pixel-art arcade video-game character —',
    'a front-facing head-and-shoulders portrait bust.',
    `Preserve their likeness: ${describeVisibleTraits(feat)}, their skin tone, and their expression.`,
    'Clean flat colours, a bold dark outline, a simple plain dark background.',
    'Cheerful retro SNES game art, stylised and characterful, NOT photorealistic.',
  ].join(' ');

  const generated = await requestImageEdit(photo, prompt, edit, options);
  // Into the retro portrait slot the story card already renders (pixelated).
  return sharp(generated.image)
    .resize(PORTRAIT_SIZE, PORTRAIT_SIZE, { fit: 'cover', kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

export const GENERATED_HEAD_SIZES = [12, 16, 20, 24, 28] as const;
export type GeneratedHeadSize = (typeof GENERATED_HEAD_SIZES)[number];
export type GeneratedHeadDirection = 'front' | 'side' | 'back';
export const GENERATED_HEAD_PROMPT_VERSION = 'generated-heads-v2';

export interface GeneratedHeadSprites {
  /** Full-resolution, square, transparent-background source for inspection. */
  master: Buffer;
  heads: Record<GeneratedHeadSize, Buffer>;
}

/**
 * Remove near-neon green-screen pixels, including regions that the model
 * accidentally encloses behind its dark outline. The narrow key preserves
 * emerald/dark-green hair and accessories while the exact #00ff00 prompt keeps
 * the background separable. The remaining head is cropped into a padded square.
 */
export async function extractGeneratedHead(image: Buffer, padding = 0.1): Promise<Buffer> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const count = width * height;
  const isGreenScreen = (pixel: number): boolean => {
    const offset = pixel * 4;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    return g >= 190 && r <= 90 && b <= 90 && g - r >= 120 && g - b >= 120;
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
  if (removed < count * 0.05)
    throw new Error('generated head did not contain a removable green background');
  if (maxX < minX || maxY < minY)
    throw new Error('generated head became empty after background removal');

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
  feat: FaceFeatures | null,
  edit: LikenessImageEdit,
  options: LikenessImageGenerationOptions = {},
): Promise<GeneratedHeadSprites> {
  const direction = options.direction ?? 'front';
  const directionInstruction =
    direction === 'side'
      ? 'Strict RIGHT-facing profile view: show exactly one eye, the nose and mouth silhouette, one ear when visible, the profile placement of facial hair, and one lens plus the temple arm for glasses. Do not show a three-quarter or front-facing face.'
      : direction === 'back'
        ? 'Strict view from directly BEHIND the head: show the back silhouette of hair, scalp, ears, glasses arms, and headwear as applicable. Show no eyes, nose, mouth, beard front, or front-facing facial features.'
        : 'Strict FRONT-facing view with a symmetrical, clearly readable face. Glasses must frame two separate visible eyes, and facial hair must preserve upper-lip, chin, and jaw coverage separately.';
  const prompt = [
    `Redraw the exact person in the reference photo as one isolated ${direction}-view pixel-art HEAD sprite.`,
    directionInstruction,
    `Preserve their recognizable visible identity, not a generic character: ${describeVisibleTraits(feat)}, their actual skin and hair colors, head proportions, glasses shape, headwear, and direction-appropriate identity cues.`,
    'Never invent hair hidden by headwear.',
    'HEAD ONLY from the top of hair/scalp/headwear through the bottom of the head, including ears. Absolutely no neck, shoulders, torso, collar, or clothing.',
    'Center the head and fill about 82 percent of the square without clipping.',
    'Polished SNES-era native 32x32 sprite art enlarged cleanly: deliberate square pixel clusters, crisp hard edges, limited flat colors, and a readable direction-specific silhouette.',
    'No antialiasing, blur, dithering, gradients, photorealism, text, watermark, or extra objects.',
    'The background must be perfectly flat solid #00ff00 with no shadow, glow, texture, or color variation. Do not use #00ff00 in the head.',
  ].join(' ');
  const generated = await requestImageEdit(photo, prompt, edit, options);
  const master = await extractGeneratedHead(generated.image);
  const heads = Object.fromEntries(
    await Promise.all(
      GENERATED_HEAD_SIZES.map(
        async (size) =>
          [
            size,
            await sharp(master)
              .resize(size, size, { fit: 'fill', kernel: 'nearest' })
              .png({ palette: true, colours: 16, dither: 0 })
              .toBuffer(),
          ] as const,
      ),
    ),
  ) as unknown as Record<GeneratedHeadSize, Buffer>;
  return { master, heads };
}
