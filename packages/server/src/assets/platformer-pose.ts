import { characterReferenceInstruction, type CharacterReferenceKind } from './character-reference';
import sharp from 'sharp';
import {
  FighterPoseImageError,
  normalizeMaskedFighterPose,
  prepareGeneratedFighterReference,
  processGeneratedFighterPose,
  type PixelBounds,
  type ProcessedFighterPose,
  type MaskedSpriteImage,
} from './fighter-pose';

/** Complete generated-player contract for the side-scrolling platformer. */
export const GENERATED_PLATFORMER_POSES = ['idle', 'sideIdle', 'walk1', 'walk2', 'jump'] as const;

export type GeneratedPlatformerPose = (typeof GENERATED_PLATFORMER_POSES)[number];

export const GENERATED_PLATFORMER_POSE_WIDTH = 112;
export const GENERATED_PLATFORMER_POSE_HEIGHT = 128;
export const GENERATED_PLATFORMER_POSE_PROMPT_VERSION = 'platformer-pose-v8';
export const GENERATED_PLATFORMER_POSE_CANVAS_WIDTHS = [112, 160, 192, 224] as const;

const PLATFORMER_RUN_LOWER_BODY_TOP = 72;
const PLATFORMER_RUN_MAX_LOWER_BODY_IOU = 0.72;
const PLATFORMER_RUN_MIN_LOWER_TO_UPPER_CHANGE_RATIO = 0.7;
const PLATFORMER_TARGET_POSE_HEIGHT = 112;

const POSE_DIRECTIONS: Record<GeneratedPlatformerPose, string> = {
  idle: 'a neutral FRONT-FACING idle pose with a relaxed but ready expression, both feet planted, and arms held clearly away from the torso',
  sideIdle:
    'a neutral standing pose in strict RIGHT-facing side profile, with both feet planted close beneath the hips, upright torso, and relaxed arms at the sides',
  walk1:
    'the first clear running contact frame toward the RIGHT, left foot reaching forward, right foot pushing back, opposite arm swing, and torso leaning slightly into the run',
  walk2:
    'the contrasting second running contact frame toward the RIGHT, right foot reaching forward, left foot pushing back, opposite arm swing, and the exact same side-view torso and head angle as the reference',
  jump: 'a readable airborne platforming pose facing RIGHT, both feet off the ground, knees bent, arms balancing the jump, and no attack in progress',
};

export interface PlatformerPosePromptOptions {
  sourceKind?: CharacterReferenceKind;
  /** Design-stage hero concept/costume, kept concise and visually concrete. */
  heroConcept?: string;
  /** Generated-game palette guidance. Green is always forbidden. */
  colors?: string;
}

export interface PlatformerRunRegionMetrics {
  intersectionPixels: number;
  unionPixels: number;
  differentPixels: number;
  iou: number;
  changeFraction: number;
}

export interface PlatformerRunPairMetrics {
  upperBody: PlatformerRunRegionMetrics;
  lowerBody: PlatformerRunRegionMetrics;
}

export interface PlatformerGreenPanelRecovery {
  image: Buffer;
  recovered: boolean;
  crop?: PixelBounds;
}

function cleanPromptFragment(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 500) : null;
}

export function buildPlatformerPosePrompt(
  pose: GeneratedPlatformerPose,
  options: PlatformerPosePromptOptions = {},
): string {
  const heroConcept = cleanPromptFragment(options.heroConcept);
  const colors = cleanPromptFragment(options.colors);
  return [
    'Create exactly ONE isolated, full-body platform-game sprite of the exact person or character in the attached reference image.',
    options.sourceKind && options.sourceKind !== 'photo'
      ? characterReferenceInstruction(options.sourceKind)
      : 'Preserve their recognizable identity from the neck up: apparent adult age, face and head shape, skin tone, hair texture and style, facial hair, glasses, headwear, and visible head accessories in the reference. Never invent glasses or head accessories that are absent, and never remove ones that are present. The canonical costume contract below is wardrobe truth and overrides any conflicting clothing in the reference.',
    heroConcept
      ? `Canonical game-world costume contract: ${heroConcept}. Dress the character in these garments, footwear, colors, and body-worn costume details from the neck down in every pose. Ignore any action, pose, tool, light, weapon, artifact, or held/carried object mentioned in that concept; both hands must remain empty.`
      : '',
    colors ? `Costume color direction: ${colors}.` : '',
    `Pose: ${POSE_DIRECTIONS[pose]}.`,
    'Show the complete silhouette from the top of the hair or headwear through every hand and both feet. Nothing may be cropped.',
    'Polished 16-bit SNES-era platformer pixel art authored for a native 112x128 high-density player sprite canvas: crisp square pixel clusters, hard edges, expressive readable silhouette, limited flat colors, and no antialiasing, blur, gradients, or photorealism.',
    'Keep the character centered and consistently proportioned so this frame can animate with the other poses at the same size and ground line.',
    'Preserve natural proportions for round robots, broad animals, tails and wings. The canvas may widen to 160, 192 or 224 pixels while retaining the same character height; never stretch a broad character into a tall narrow body. Keep the head and torso scale consistent across poses.',
    'This is one sprite in one pose, NOT a sprite sheet, turnaround, sequence, collage, portrait, or character-select card.',
    'No text, letters, numbers, logos, watermark, signature, UI, border, scenery, floor, platform, shadow, glow, particles, weapons, held props, extra objects, or second character.',
    'The entire background must be perfectly flat solid #00ff00, including every gap enclosed by arms and legs. No texture or color variation. Do not use the exact #00ff00 key color or a near-neon imitation in the character; preserve darker natural or dyed greens when they are part of the person.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** One deliberately narrow edit from the neutral identity/costume reference
 * after a pair-level validator finds that the side reference locked Muse into
 * the previous leg contact. */
export function buildPlatformerRunCorrectionPrompt(
  options: PlatformerPosePromptOptions = {},
): string {
  return [
    buildPlatformerPosePrompt('walk2', options),
    'RETRY CORRECTION: The attached neutral reference establishes identity and costume ONLY, not pose. Replace its pose completely with a right-facing running contact. Put the RIGHT foot at least one head-width ahead of the hips toward the right edge and the LEFT foot clearly behind toward the left edge, with a wide flat-green triangular gap separating the legs. Do not reuse the reference leg positions.',
    'Keep the exact same face, costume, body proportions, scale, and ground line. Use a low natural opposite arm swing with both hands visibly empty; neither hand may be raised above the shoulder. Remove and do not add any lantern, light, tool, weapon, bag, artifact, or other object.',
  ].join(' ');
}

/** Stable high-resolution idle edit reference for the remaining poses. */
export const prepareGeneratedPlatformerReference = prepareGeneratedFighterReference;

function isPlatformerGreenScreenPixel(r: number, g: number, b: number): boolean {
  return g >= 190 && r <= 90 && b <= 90 && g - r >= 120 && g - b >= 120;
}

/**
 * Muse occasionally places the requested green screen inside symmetric white
 * side or top/bottom panels. The generic pose normalizer correctly treats
 * those opaque panels as extra subjects. Before discarding an otherwise good
 * generation, recover only the unambiguous case where the green panel spans
 * one full axis, is inset symmetrically on the other, and still occupies most
 * of the source. Anything less regular continues through the normal fail-closed
 * path.
 */
export async function recoverGeneratedPlatformerGreenPanel(
  image: Buffer,
): Promise<PlatformerGreenPanelRecovery> {
  const decoded = await sharp(image)
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    if (
      decoded.data[offset + 3]! <= 8 ||
      !isPlatformerGreenScreenPixel(
        decoded.data[offset]!,
        decoded.data[offset + 1]!,
        decoded.data[offset + 2]!,
      )
    ) {
      continue;
    }
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX < minX || maxY < minY) return { image, recovered: false };

  const left = minX;
  const right = width - maxX - 1;
  const top = minY;
  const bottom = height - maxY - 1;
  const symmetric = (first: number, second: number, span: number): boolean =>
    Math.abs(first - second) <= Math.max(4, Math.round(span * 0.03));
  const verticalPanel =
    minY <= 1 &&
    maxY >= height - 2 &&
    left >= width * 0.02 &&
    right >= width * 0.02 &&
    symmetric(left, right, width) &&
    maxX - minX + 1 >= width * 0.5;
  const horizontalPanel =
    minX <= 1 &&
    maxX >= width - 2 &&
    top >= height * 0.02 &&
    bottom >= height * 0.02 &&
    symmetric(top, bottom, height) &&
    maxY - minY + 1 >= height * 0.5;
  if (!verticalPanel && !horizontalPanel) return { image, recovered: false };

  const crop: PixelBounds = {
    left: verticalPanel ? minX : 0,
    top: horizontalPanel ? minY : 0,
    width: verticalPanel ? maxX - minX + 1 : width,
    height: horizontalPanel ? maxY - minY + 1 : height,
  };
  return {
    image: await sharp(image).rotate().extract(crop).png().toBuffer(),
    recovered: true,
    crop,
  };
}

/** Key and validate before choosing a wider canvas; preserve the source aspect
 * ratio at a common subject height instead of stretching width-limited poses. */
export async function processGeneratedPlatformerPose(
  image: Buffer,
  options: { width?: number } = {},
): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: GENERATED_PLATFORMER_POSE_CANVAS_WIDTHS.at(-1)!,
    height: GENERATED_PLATFORMER_POSE_HEIGHT,
    padding: 6,
    bottomPadding: 0,
    removeGreenSpill: true,
    colors: 32,
  });
  return fitPlatformerPose(processed, options);
}

export async function normalizeMaskedPlatformerPose(
  image: MaskedSpriteImage,
  options: { width?: number } = {},
): Promise<ProcessedFighterPose> {
  const processed = await normalizeMaskedFighterPose(image, {
    width: GENERATED_PLATFORMER_POSE_CANVAS_WIDTHS.at(-1)!,
    height: GENERATED_PLATFORMER_POSE_HEIGHT,
    padding: 6,
    bottomPadding: 0,
    colors: 32,
  });
  return fitPlatformerPose(processed, options);
}

async function fitPlatformerPose(
  processed: ProcessedFighterPose,
  options: { width?: number },
): Promise<ProcessedFighterPose> {
  const bounds = processed.metrics.outputBounds;
  const targetWidth = Math.round((bounds.width * PLATFORMER_TARGET_POSE_HEIGHT) / bounds.height);
  const width = GENERATED_PLATFORMER_POSE_CANVAS_WIDTHS.find(
    (value) =>
      value >= (options.width ?? GENERATED_PLATFORMER_POSE_WIDTH) && value >= targetWidth + 12,
  );
  if (!width) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated platformer pose exceeds the 224px canvas at consistent scale (${targetWidth}x${PLATFORMER_TARGET_POSE_HEIGHT}); keep extreme appendages closer without changing body proportions`,
    );
  }
  const targetBounds = {
    left: Math.floor((width - targetWidth) / 2),
    width: targetWidth,
    top: GENERATED_PLATFORMER_POSE_HEIGHT - PLATFORMER_TARGET_POSE_HEIGHT,
    height: PLATFORMER_TARGET_POSE_HEIGHT,
  };
  const png = await sharp(processed.png)
    .extract(bounds)
    .resize(targetBounds.width, targetBounds.height, {
      fit: 'fill',
      kernel: sharp.kernel.nearest,
    })
    .extend({
      left: targetBounds.left,
      right: width - targetBounds.left - targetBounds.width,
      top: targetBounds.top,
      bottom: 0,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({
      palette: true,
      colours: 32,
      dither: 0,
      compressionLevel: 9,
      adaptiveFiltering: false,
    })
    .toBuffer();
  return {
    png,
    metrics: {
      ...processed.metrics,
      outputBounds: targetBounds,
      outputSubjectFraction:
        processed.metrics.outputSubjectFraction *
        (targetBounds.height / bounds.height) ** 2 *
        (GENERATED_PLATFORMER_POSE_CANVAS_WIDTHS.at(-1)! / width),
    },
  };
}

/** One character gets one base canvas. Padding changes; pixels never rescale. */
export async function alignGeneratedPlatformerPoseCanvases(
  poses: Readonly<Record<GeneratedPlatformerPose, Buffer>>,
): Promise<Record<GeneratedPlatformerPose, Buffer>> {
  const dimensions = await Promise.all(
    GENERATED_PLATFORMER_POSES.map(async (pose) => ({
      pose,
      ...(await sharp(poses[pose]).metadata()),
    })),
  );
  const width = Math.max(...dimensions.map((d) => d.width ?? 0));
  if (
    !GENERATED_PLATFORMER_POSE_CANVAS_WIDTHS.some((w) => w === width) ||
    dimensions.some(
      (d) =>
        d.height !== GENERATED_PLATFORMER_POSE_HEIGHT ||
        !GENERATED_PLATFORMER_POSE_CANVAS_WIDTHS.some((w) => w === d.width),
    )
  )
    throw new FighterPoseImageError(
      'inconsistent-scale',
      'generated platformer set has unsupported canvas dimensions',
    );
  const entries = await Promise.all(
    dimensions.map(async (d) => {
      const padding = width - d.width!;
      const png = padding
        ? await sharp(poses[d.pose])
            .extend({
              left: Math.floor(padding / 2),
              right: Math.ceil(padding / 2),
              top: 0,
              bottom: 0,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png({ palette: true, colours: 32, dither: 0 })
            .toBuffer()
        : poses[d.pose];
      return [d.pose, png] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<GeneratedPlatformerPose, Buffer>;
}

function runRegionMetrics(
  first: Buffer,
  second: Buffer,
  width: number,
  yStart: number,
  yEnd: number,
): PlatformerRunRegionMetrics {
  let intersectionPixels = 0;
  let unionPixels = 0;
  let differentPixels = 0;
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const firstOpaque = first[pixel * 4 + 3]! > 8;
      const secondOpaque = second[pixel * 4 + 3]! > 8;
      if (firstOpaque && secondOpaque) intersectionPixels++;
      if (firstOpaque || secondOpaque) unionPixels++;
      if (firstOpaque !== secondOpaque) differentPixels++;
    }
  }
  const iou = unionPixels > 0 ? intersectionPixels / unionPixels : 1;
  return {
    intersectionPixels,
    unionPixels,
    differentPixels,
    iou,
    changeFraction: unionPixels > 0 ? differentPixels / unionPixels : 0,
  };
}

/** Measure where the two run contacts differ. Color is deliberately ignored:
 * animation readability comes from silhouette motion, not palette flicker. */
export async function measureGeneratedPlatformerRunPair(
  walk1: Buffer,
  walk2: Buffer,
): Promise<PlatformerRunPairMetrics> {
  const decoded = await Promise.all([
    sharp(walk1).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(walk2).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const [first, second] = decoded;
  for (const { info } of decoded) {
    if (
      !GENERATED_PLATFORMER_POSE_CANVAS_WIDTHS.some((w) => w === info.width) ||
      info.width !== first.info.width ||
      info.height !== GENERATED_PLATFORMER_POSE_HEIGHT
    ) {
      throw new FighterPoseImageError(
        'inconsistent-scale',
        `generated run pose has an unexpected ${info.width}x${info.height} canvas`,
      );
    }
  }
  return {
    upperBody: runRegionMetrics(
      first.data,
      second.data,
      first.info.width,
      0,
      PLATFORMER_RUN_LOWER_BODY_TOP,
    ),
    lowerBody: runRegionMetrics(
      first.data,
      second.data,
      first.info.width,
      PLATFORMER_RUN_LOWER_BODY_TOP,
      GENERATED_PLATFORMER_POSE_HEIGHT,
    ),
  };
}

export async function validateGeneratedPlatformerRunPair(
  walk1: Buffer,
  walk2: Buffer,
): Promise<PlatformerRunPairMetrics> {
  const metrics = await measureGeneratedPlatformerRunPair(walk1, walk2);
  const upperChange = metrics.upperBody.changeFraction;
  const lowerChange = metrics.lowerBody.changeFraction;
  if (
    metrics.lowerBody.iou > PLATFORMER_RUN_MAX_LOWER_BODY_IOU ||
    (upperChange > 0 && lowerChange < upperChange * PLATFORMER_RUN_MIN_LOWER_TO_UPPER_CHANGE_RATIO)
  ) {
    throw new FighterPoseImageError(
      'insufficient-pose-change',
      `generated run frames did not alternate the lower-body stride (leg overlap ${metrics.lowerBody.iou.toFixed(3)}, lower change ${lowerChange.toFixed(3)}, upper change ${upperChange.toFixed(3)})`,
    );
  }
  return metrics;
}

/** A generated run cycle must keep one body scale after per-frame keying. */
export async function validateGeneratedPlatformerPoseSet(
  poses: Readonly<Record<GeneratedPlatformerPose, Buffer>>,
  options: { strictMotion?: boolean } = {},
): Promise<void> {
  const dimensions = await Promise.all(
    GENERATED_PLATFORMER_POSES.map(async (pose) => {
      const { data, info } = await sharp(poses[pose])
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (
        !GENERATED_PLATFORMER_POSE_CANVAS_WIDTHS.some((w) => w === info.width) ||
        info.height !== GENERATED_PLATFORMER_POSE_HEIGHT
      ) {
        throw new FighterPoseImageError(
          'inconsistent-scale',
          `generated platformer ${pose} pose has an unexpected ${info.width}x${info.height} canvas`,
        );
      }
      let top = info.height;
      let bottom = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * 4 + 3]! <= 8) continue;
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      if (bottom !== info.height - 1) {
        throw new FighterPoseImageError(
          'inconsistent-scale',
          `generated platformer ${pose} pose is not foot-anchored`,
        );
      }
      return { pose, height: bottom - top + 1, width: info.width };
    }),
  );
  if (new Set(dimensions.map((d) => d.width)).size !== 1)
    throw new FighterPoseImageError(
      'inconsistent-scale',
      'generated platformer base poses need one shared canvas',
    );
  if (options.strictMotion === false) return;
  const walk1 = dimensions.find(({ pose }) => pose === 'walk1')!;
  const walk2 = dimensions.find(({ pose }) => pose === 'walk2')!;
  if (Math.abs(walk1.height - walk2.height) > 6) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated run frames change player height (${walk1.height}px vs ${walk2.height}px)`,
    );
  }
  await validateGeneratedPlatformerRunPair(poses.walk1, poses.walk2);
}
