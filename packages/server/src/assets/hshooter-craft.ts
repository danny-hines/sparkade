import sharp from 'sharp';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const HSHOOTER_CRAFT_PROMPT_VERSION = 'hshooter-player-craft-v1';
export const HSHOOTER_CRAFT_SIZE = { width: 96, height: 64 } as const;

export interface HShooterCraftPromptOptions {
  gameTitle: string;
  tagline: string;
  visualConcept: string;
  colors: string;
}

function clean(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The craft is authored without a photo or player reference by design. */
export function buildHShooterCraftPrompt(options: HShooterCraftPromptOptions): string {
  return [
    'Create exactly ONE isolated horizontal-shooter player craft for gameplay.',
    `Game: ${clean(options.gameTitle, 80)} — ${clean(options.tagline, 120)}.`,
    `Canonical craft identity: ${clean(options.visualConcept, 240)}.`,
    'Show the craft in strict side profile, nose pointing toward the RIGHT and engines toward the LEFT. Preserve a long, instantly readable horizontal silhouette.',
    'This vehicle identity is independent from the human pilot. Design a closed or dark readable canopy; do not show or imply the pilot inside it.',
    `Use this limited game color direction with strong contrast: ${clean(options.colors, 300)}.`,
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, strong outline separation, no antialiasing, blur, gradients, or photorealism.',
    'This is one rigid vehicle in one neutral flight state, NOT a sprite sheet, turnaround, sequence, collage, story scene, icon, card, screenshot, or concept-art page.',
    'No person, pilot, rider, passenger, face, head, eyes, portrait, human body, initials, text, letters, numbers, logo, watermark, signature, UI, border, scenery, floor, shadow, projectile, exhaust trail, or second object.',
    'The complete craft must be visible and centered with generous room around it. Nothing may be cropped.',
    'The entire empty background, including every gap around or enclosed by the silhouette, must be perfectly flat solid #00ff00. The craft itself, including its canopy, must remain fully authored and must not use #00ff00 or a near-neon imitation; darker natural greens are allowed.',
  ].join(' ');
}

/** Key, normalize, and quantize one likeness-free side-view player craft. */
export async function processGeneratedHShooterCraft(image: Buffer): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: HSHOOTER_CRAFT_SIZE.width,
    height: HSHOOTER_CRAFT_SIZE.height,
    padding: 4,
    bottomPadding: 4,
    removeGreenSpill: true,
    colors: 40,
    minSubjectFraction: 0.01,
    maxSubjectFraction: 0.86,
    minSubjectSpanFraction: 0.08,
  });
  const { width, height } = processed.metrics.outputBounds;
  if (width < 48 || height < 20 || width / Math.max(1, height) < 1.25) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated H-scroll craft needs a broad side-view silhouette (${width}x${height})`,
    );
  }
  return processed;
}

/**
 * Muse Image accepts one reference image. Stack the human/key-art identity over
 * the exact gameplay craft so downstream prompts can preserve both without
 * ever deriving the vehicle from the player's face.
 */
export async function buildHShooterIdentityReference(
  primary: Buffer | undefined,
  craft: Buffer,
): Promise<Buffer> {
  const background = { r: 13, g: 19, b: 31, alpha: 1 };
  const craftPanel = await sharp(craft)
    .resize(880, primary ? 360 : 600, {
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const composites: sharp.OverlayOptions[] = [
    {
      input: craftPanel,
      left: 72,
      top: primary ? 624 : 212,
    },
  ];
  if (primary) {
    const primaryPanel = await sharp(primary)
      .resize(1024, 576, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    composites.unshift({ input: primaryPanel, left: 0, top: 0 });
  }
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background } })
    .composite(composites)
    .png()
    .toBuffer();
}
