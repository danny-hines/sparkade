import sharp from 'sharp';

/**
 * Complete generated-pose contract for the current procedural fighter.
 * `block` and `hit` deliberately use the names from
 * packages/archetypes/src/fighter/figure.ts (the player-facing concepts are
 * guard and hurt), allowing the engine to select generated art without a
 * translation layer or a visible fallback during movement.
 */
export const GENERATED_FIGHTER_POSES = [
  'idle',
  'walk',
  'crouch',
  'jump',
  'punchHigh',
  'punchLow',
  'kickHigh',
  'kickLow',
  'block',
  'hit',
  'ko',
] as const;

export type GeneratedFighterPose = (typeof GENERATED_FIGHTER_POSES)[number];

export const GENERATED_FIGHTER_POSE_SIZE = 64;
export const GENERATED_FIGHTER_POSE_PADDING = 4;
export const GENERATED_FIGHTER_POSE_PROMPT_VERSION = 'fighter-pose-v1';

const GENERATED_FIGHTER_POSE_SET = new Set<string>(GENERATED_FIGHTER_POSES);

const POSE_DIRECTIONS: Record<GeneratedFighterPose, string> = {
  idle: 'a neutral ready fighting stance, standing upright with both fists raised and both feet planted',
  walk: 'one clear mid-stride frame of a guarded walk toward the right, torso upright, fists raised, front foot stepping forward and rear foot pushing off',
  crouch:
    'a low stationary crouching fighting stance, both knees deeply bent, center of gravity lowered, fists raised, and both feet on the ground',
  jump: 'a compact airborne fighting pose rising upward, both feet clearly off the ground, knees bent, fists raised, and no attack in progress',
  block:
    'a defensive guard pose, torso tucked back slightly with both forearms protecting the face and chest',
  punchHigh:
    'the impact frame of a high straight punch, front fist fully extended at head height and the other fist guarding',
  punchLow:
    'the impact frame of a low body punch, front fist fully extended at waist height and the other fist guarding',
  kickHigh:
    'the impact frame of a high side kick, front leg fully extended at chest-to-head height with a stable readable silhouette',
  kickLow:
    'the impact frame of a low sweeping kick, front leg fully extended near ankle height with a stable readable silhouette',
  hit: 'a hurt recoil pose, leaning backward from an impact with arms thrown back but still standing on the ground',
  ko: 'a knocked-out pose lying horizontally on their back, eyes closed, with the complete body visible',
};

export interface FighterPosePromptOptions {
  /** Optional generated-game costume; keep it concise and visually concrete. */
  outfit?: string;
  /** Optional generated-game palette guidance. Green is always forbidden. */
  colors?: string;
  /** Optional identity details that are visible in the reference photo. */
  identity?: string;
}

function cleanPromptFragment(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 500) : null;
}

export function isGeneratedFighterPose(value: unknown): value is GeneratedFighterPose {
  return typeof value === 'string' && GENERATED_FIGHTER_POSE_SET.has(value);
}

/** Build one edit prompt for a right-facing pose sourced from a player photo. */
export function buildFighterPosePrompt(
  pose: GeneratedFighterPose,
  options: FighterPosePromptOptions = {},
): string {
  if (!isGeneratedFighterPose(pose))
    throw new Error(`unsupported generated fighter pose: ${String(pose)}`);

  const outfit = cleanPromptFragment(options.outfit);
  const colors = cleanPromptFragment(options.colors);
  const identity = cleanPromptFragment(options.identity);
  const details = [
    identity ? `Identity details to retain: ${identity}.` : null,
    outfit ? `Costume: ${outfit}.` : null,
    colors ? `Costume colors: ${colors}.` : null,
  ].filter((line): line is string => line !== null);

  return [
    'Create exactly ONE isolated, full-body fighting-game sprite of the exact person or character in the attached reference image.',
    'Preserve their recognizable identity: face shape, skin tone, hair, facial hair, glasses, headwear, costume, and body proportions visible in the reference. Do not turn them into a generic character.',
    ...details,
    `Pose: ${POSE_DIRECTIONS[pose]}. The fighter faces toward the RIGHT side of the image.`,
    'Show the complete silhouette from the top of the hair or headwear through every hand and both feet. Nothing may be cropped.',
    'Polished 16-bit SNES-era arcade fighter pixel art, designed at a native 64x64 sprite scale and enlarged cleanly: crisp square pixel clusters, hard edges, bold readable silhouette, limited flat colors, and no antialiasing, blur, gradients, or photorealism.',
    'This is one sprite in one pose, NOT a sprite sheet, turnaround, sequence, collage, or character-select card.',
    'No text, letters, numbers, logos, watermark, signature, UI, border, scenery, floor, platform, shadow, glow, particles, weapons, held props, extra objects, or second character.',
    'The entire background must be perfectly flat solid #00ff00, including every gap enclosed by arms and legs. No texture or color variation. Do not use the exact #00ff00 key color or a near-neon imitation in the fighter; preserve darker natural or dyed greens when they are part of the person.',
  ].join(' ');
}

/** Normalize and persist the rich generated idle image as a stable edit
 * reference. Every remaining pose hashes and edits these exact bytes, so a
 * resumed job cannot drift or fall back to an upscaled 64px runtime sprite. */
export async function prepareGeneratedFighterReference(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .rotate()
    .resize(1024, 1024, {
      fit: 'contain',
      kernel: 'nearest',
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    })
    .png()
    .toBuffer();
}

export type FighterPoseImageErrorCode =
  | 'invalid-options'
  | 'invalid-image'
  | 'missing-green-background'
  | 'empty-subject'
  | 'multiple-subjects'
  | 'subject-too-small'
  | 'subject-too-large'
  | 'inconsistent-scale'
  | 'insufficient-pose-change';

export class FighterPoseImageError extends Error {
  constructor(
    readonly code: FighterPoseImageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FighterPoseImageError';
  }
}

export interface FighterPoseImageOptions {
  /** Final transparent sprite canvas. Defaults to the current ~48-58px fighter scale. */
  width?: number;
  height?: number;
  /** Transparent top and horizontal inset around the normalized subject. */
  padding?: number;
  /** Transparent inset below the subject. Defaults to `padding`. */
  bottomPadding?: number;
  /** Remove green chroma spill connected to the keyed background at source and output scale. */
  removeGreenSpill?: boolean;
  /** Maximum indexed PNG palette size. */
  colors?: number;
  /** Validation thresholds are fractions of the decoded source canvas. */
  minGreenFraction?: number;
  minSubjectFraction?: number;
  maxSubjectFraction?: number;
  minSubjectSpanFraction?: number;
}

export interface PixelBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FighterPoseImageMetrics {
  sourceWidth: number;
  sourceHeight: number;
  sourceBounds: PixelBounds;
  outputBounds: PixelBounds;
  greenFraction: number;
  sourceSubjectFraction: number;
  outputSubjectFraction: number;
}

export interface ProcessedFighterPose {
  /** Fixed-size, indexed, transparent PNG ready for serving to the engine. */
  png: Buffer;
  metrics: FighterPoseImageMetrics;
}

interface ResolvedFighterPoseImageOptions {
  width: number;
  height: number;
  padding: number;
  bottomPadding: number;
  removeGreenSpill: boolean;
  colors: number;
  minGreenFraction: number;
  minSubjectFraction: number;
  maxSubjectFraction: number;
  minSubjectSpanFraction: number;
}

function fractionOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > 1) {
    throw new FighterPoseImageError('invalid-options', `${name} must be between 0 and 1`);
  }
  return resolved;
}

function integerOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new FighterPoseImageError('invalid-options', `${name} must be a positive integer`);
  }
  return resolved;
}

function resolveOptions(options: FighterPoseImageOptions): ResolvedFighterPoseImageOptions {
  const padding = options.padding ?? GENERATED_FIGHTER_POSE_PADDING;
  const resolved = {
    width: integerOption(options.width, GENERATED_FIGHTER_POSE_SIZE, 'width'),
    height: integerOption(options.height, GENERATED_FIGHTER_POSE_SIZE, 'height'),
    padding,
    bottomPadding: options.bottomPadding ?? padding,
    removeGreenSpill: options.removeGreenSpill ?? false,
    colors: integerOption(options.colors, 32, 'colors'),
    minGreenFraction: fractionOption(options.minGreenFraction, 0.05, 'minGreenFraction'),
    minSubjectFraction: fractionOption(options.minSubjectFraction, 0.005, 'minSubjectFraction'),
    maxSubjectFraction: fractionOption(options.maxSubjectFraction, 0.8, 'maxSubjectFraction'),
    minSubjectSpanFraction: fractionOption(
      options.minSubjectSpanFraction,
      0.06,
      'minSubjectSpanFraction',
    ),
  };
  if (!Number.isSafeInteger(resolved.padding) || resolved.padding < 0) {
    throw new FighterPoseImageError('invalid-options', 'padding must be a non-negative integer');
  }
  if (!Number.isSafeInteger(resolved.bottomPadding) || resolved.bottomPadding < 0) {
    throw new FighterPoseImageError(
      'invalid-options',
      'bottomPadding must be a non-negative integer',
    );
  }
  if (
    resolved.padding * 2 >= resolved.width ||
    resolved.padding + resolved.bottomPadding >= resolved.height
  ) {
    throw new FighterPoseImageError('invalid-options', 'padding leaves no room for the fighter');
  }
  if (resolved.colors < 2 || resolved.colors > 256) {
    throw new FighterPoseImageError('invalid-options', 'colors must be between 2 and 256');
  }
  if (resolved.minSubjectFraction >= resolved.maxSubjectFraction) {
    throw new FighterPoseImageError(
      'invalid-options',
      'minSubjectFraction must be less than maxSubjectFraction',
    );
  }
  return resolved;
}

/**
 * Key near-neon green pixels rather than flood-filling from the edges. Muse can
 * enclose background between limbs; the narrow range removes those regions
 * while preserving darker green hair, clothing, and accessories.
 */
function isGreenScreenPixel(r: number, g: number, b: number): boolean {
  return g >= 190 && r <= 90 && b <= 90 && g - r >= 120 && g - b >= 120;
}

/** Muse can darken the green screen at silhouette edges. Remove only nearly
 * pure-green pixels that are spatially connected to transparency; blue-green
 * hair or clothing remains because it is not chroma-key spill. */
function removeConnectedGreenSpill(data: Buffer, width: number, height: number): number {
  const queued = new Uint8Array(width * height);
  const queue: number[] = [];
  const isSpill = (pixel: number): boolean => {
    const offset = pixel * 4;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    return (
      data[offset + 3]! > 8 &&
      g >= 72 &&
      r <= g * 0.25 &&
      b <= g * 0.25 &&
      g - r >= 60 &&
      g - b >= 60
    );
  };
  const touchesTransparency = (pixel: number): boolean => {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const neighbor = (y + dy) * width + x + dx;
        if (data[neighbor * 4 + 3]! <= 8) return true;
      }
    }
    return false;
  };
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (!isSpill(pixel) || !touchesTransparency(pixel)) continue;
    queued[pixel] = 1;
    queue.push(pixel);
  }
  let removed = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const pixel = queue[cursor]!;
    const offset = pixel * 4;
    if (data[offset + 3]! <= 8) continue;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
    removed++;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (
          (dx === 0 && dy === 0) ||
          x + dx < 0 ||
          x + dx >= width ||
          y + dy < 0 ||
          y + dy >= height
        ) {
          continue;
        }
        const neighbor = (y + dy) * width + x + dx;
        if (queued[neighbor] || !isSpill(neighbor)) continue;
        queued[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }
  return removed;
}

/** Downscaling can preserve a few dark green edge samples that are too mixed
 * with the subject color for the conservative source-scale key above. At the
 * final sprite scale those isolated pixels are conspicuous, so remove only
 * small green-dominant components that still touch transparency. A real green
 * garment or hairstyle forms a larger component and remains intact. */
function removeSmallOutputGreenSpill(data: Buffer, width: number, height: number): number {
  const maxComponentPixels = Math.max(12, Math.round((12 * width * height) / (56 * 64)));
  const candidate = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    if (
      data[offset + 3]! > 8 &&
      g >= 56 &&
      r <= g * 0.45 &&
      b <= g * 0.4 &&
      g - r >= 40 &&
      g - b >= 40
    ) {
      candidate[pixel] = 1;
    }
  }

  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const component: number[] = [];
  let removed = 0;
  for (let start = 0; start < width * height; start++) {
    if (!candidate[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    component.length = 0;
    let touchesTransparency = false;
    while (stack.length) {
      const pixel = stack.pop()!;
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesTransparency = true;
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (data[neighbor * 4 + 3]! <= 8) touchesTransparency = true;
          if (!candidate[neighbor] || seen[neighbor]) continue;
          seen[neighbor] = 1;
          stack.push(neighbor);
        }
      }
    }
    if (!touchesTransparency || component.length > maxComponentPixels) continue;
    for (const pixel of component) {
      const offset = pixel * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
      removed++;
    }
  }
  return removed;
}

/** Nearest-neighbor resampling does not guarantee that the last opaque source
 * row is sampled, even when the requested output rectangle reaches the ground
 * line. Re-anchor from the pixels that actually survived processing so feet do
 * not float by one or two pixels in the final sprite. */
function bottomAlignOpaquePixels(
  data: Buffer,
  width: number,
  height: number,
  bottomPadding: number,
): number {
  let maxY = -1;
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (data[pixel * 4 + 3]! > 8) maxY = Math.floor(pixel / width);
  }
  if (maxY < 0) return 0;

  const targetBottom = height - bottomPadding - 1;
  const shift = targetBottom - maxY;
  if (shift <= 0) return 0;

  const stride = width * 4;
  data.copyWithin(shift * stride, 0, (height - shift) * stride);
  data.fill(0, 0, shift * stride);
  return shift;
}

function subjectComponentSizes(data: Buffer, width: number, height: number): number[] {
  const seen = new Uint8Array(width * height);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || data[start * 4 + 3]! <= 8) continue;
    seen[start] = 1;
    stack.push(start);
    let size = 0;
    while (stack.length) {
      const pixel = stack.pop()!;
      size++;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (
            (dx === 0 && dy === 0) ||
            x + dx < 0 ||
            x + dx >= width ||
            y + dy < 0 ||
            y + dy >= height
          ) {
            continue;
          }
          const next = (y + dy) * width + x + dx;
          if (seen[next] || data[next * 4 + 3]! <= 8) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

async function decodeFighterPoseImage(image: Buffer) {
  try {
    return await sharp(image)
      .rotate()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new FighterPoseImageError(
      'invalid-image',
      `could not decode generated fighter image: ${detail}`,
    );
  }
}

/**
 * Convert a Muse Image green-screen result into a fixed 64x64-style fighter
 * canvas. The subject is horizontally centered and bottom-aligned so every
 * upright pose shares the engine's feet-origin convention; KO remains on the
 * same ground line. All resizing uses nearest-neighbor sampling.
 */
export async function processGeneratedFighterPose(
  image: Buffer,
  options: FighterPoseImageOptions = {},
): Promise<ProcessedFighterPose> {
  const cfg = resolveOptions(options);
  const { data, info } = await decodeFighterPoseImage(image);
  const { width: sourceWidth, height: sourceHeight } = info;
  const pixelCount = sourceWidth * sourceHeight;
  let greenCount = 0;

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const offset = pixel * 4;
    const alpha = data[offset + 3]!;
    if (alpha > 8 && isGreenScreenPixel(data[offset]!, data[offset + 1]!, data[offset + 2]!)) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
      greenCount++;
      continue;
    }
    if (alpha <= 8) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
      continue;
    }
  }

  if (cfg.removeGreenSpill) {
    greenCount += removeConnectedGreenSpill(data, sourceWidth, sourceHeight);
  }

  let subjectCount = 0;
  let minX = sourceWidth;
  let minY = sourceHeight;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (data[pixel * 4 + 3]! <= 8) continue;
    subjectCount++;
    const x = pixel % sourceWidth;
    const y = Math.floor(pixel / sourceWidth);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const greenFraction = greenCount / pixelCount;
  if (greenFraction < cfg.minGreenFraction) {
    throw new FighterPoseImageError(
      'missing-green-background',
      `generated fighter has too little removable green background (${greenFraction.toFixed(3)})`,
    );
  }
  if (subjectCount === 0 || maxX < minX || maxY < minY) {
    throw new FighterPoseImageError(
      'empty-subject',
      'generated fighter became empty after green-screen removal',
    );
  }
  const components = subjectComponentSizes(data, sourceWidth, sourceHeight);
  const secondLargest = components[1] ?? 0;
  if (secondLargest >= Math.max(16, subjectCount * 0.08)) {
    throw new FighterPoseImageError(
      'multiple-subjects',
      'generated fighter contains more than one significant disconnected subject',
    );
  }

  const sourceSubjectFraction = subjectCount / pixelCount;
  const sourceBounds: PixelBounds = {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
  const widthSpan = sourceBounds.width / sourceWidth;
  const heightSpan = sourceBounds.height / sourceHeight;
  if (
    sourceSubjectFraction < cfg.minSubjectFraction ||
    widthSpan < cfg.minSubjectSpanFraction ||
    heightSpan < cfg.minSubjectSpanFraction
  ) {
    throw new FighterPoseImageError(
      'subject-too-small',
      `generated fighter subject is too small (${sourceSubjectFraction.toFixed(3)} coverage)`,
    );
  }
  if (sourceSubjectFraction > cfg.maxSubjectFraction) {
    throw new FighterPoseImageError(
      'subject-too-large',
      `generated fighter subject covers too much of the source (${sourceSubjectFraction.toFixed(3)})`,
    );
  }

  const availableWidth = cfg.width - cfg.padding * 2;
  const availableHeight = cfg.height - cfg.padding - cfg.bottomPadding;
  const scale = Math.min(
    availableWidth / sourceBounds.width,
    availableHeight / sourceBounds.height,
  );
  const outputWidth = Math.min(availableWidth, Math.max(1, Math.round(sourceBounds.width * scale)));
  const outputHeight = Math.min(
    availableHeight,
    Math.max(1, Math.round(sourceBounds.height * scale)),
  );
  const outputBounds: PixelBounds = {
    left: Math.floor((cfg.width - outputWidth) / 2),
    top: cfg.height - cfg.bottomPadding - outputHeight,
    width: outputWidth,
    height: outputHeight,
  };

  const resized = await sharp(data, {
    raw: { width: sourceWidth, height: sourceHeight, channels: 4 },
  })
    .extract(sourceBounds)
    .resize(outputBounds.width, outputBounds.height, {
      fit: 'fill',
      kernel: sharp.kernel.nearest,
    })
    .extend({
      left: outputBounds.left,
      right: cfg.width - outputBounds.left - outputBounds.width,
      top: outputBounds.top,
      bottom: cfg.height - outputBounds.top - outputBounds.height,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (cfg.removeGreenSpill) {
    removeSmallOutputGreenSpill(resized.data, cfg.width, cfg.height);
  }
  bottomAlignOpaquePixels(resized.data, cfg.width, cfg.height, cfg.bottomPadding);

  const png = await sharp(resized.data, {
    raw: { width: cfg.width, height: cfg.height, channels: 4 },
  })
    .png({
      palette: true,
      colours: cfg.colors,
      dither: 0,
      compressionLevel: 9,
      adaptiveFiltering: false,
    })
    .toBuffer();

  return {
    png,
    metrics: {
      sourceWidth,
      sourceHeight,
      sourceBounds,
      outputBounds,
      greenFraction,
      sourceSubjectFraction,
      outputSubjectFraction: (subjectCount * scale * scale) / (cfg.width * cfg.height),
    },
  };
}
