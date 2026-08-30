import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const SHOOTER_CRAFT_PROMPT_VERSION = 'shooter-player-craft-v1';
export const SHOOTER_CRAFT_SIZE = { width: 64, height: 96 } as const;
export const SHOOTER_CRAFT_REFERENCE_SIZE = { width: 512, height: 1024 } as const;

export interface ShooterCraftPromptOptions {
  gameTitle: string;
  tagline: string;
  visualConcept: string;
  colors: string;
  candidateId?: string;
  retryGuidance?: string;
}

function clean(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildShooterCraftPrompt(options: ShooterCraftPromptOptions): string {
  return [
    'Create exactly ONE isolated vertical-shooter player craft for gameplay.',
    `Candidate ${clean(options.candidateId ?? 'A', 12)}.`,
    `Game: ${clean(options.gameTitle, 80)} — ${clean(options.tagline, 120)}.`,
    `Canonical craft identity: ${clean(options.visualConcept, 240)}.`,
    'Show the craft in strict top-down view, nose pointing toward the TOP and engines toward the BOTTOM. Preserve a tall, instantly readable vertical silhouette.',
    'This vehicle identity is independent from the human pilot. Design a closed or dark readable canopy; do not show or imply the pilot inside it.',
    `Use this limited game color direction with strong contrast: ${clean(options.colors, 300)}.`,
    'Polished high-density retro pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, strong outline separation, no antialiasing, blur, gradients, or photorealism.',
    'This is one rigid vehicle in one neutral flight state, NOT a sprite sheet, turnaround, sequence, collage, story scene, icon, card, screenshot, or concept-art page.',
    'No person, pilot, rider, passenger, face, head, eyes, portrait, human body, initials, text, letters, numbers, logo, watermark, signature, UI, border, scenery, floor, shadow, projectile, exhaust trail, or second object.',
    'The complete craft must be visible and centered with generous room around it. Nothing may be cropped.',
    'The entire empty background, including every gap around or enclosed by the silhouette, must be perfectly flat solid #00ff00. The craft itself must not use #00ff00 or a near-neon imitation; darker natural greens are allowed.',
    options.retryGuidance
      ? `ART DIRECTOR CORRECTION: ${clean(options.retryGuidance, 320)}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export async function processGeneratedShooterCraft(image: Buffer): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: SHOOTER_CRAFT_SIZE.width,
    height: SHOOTER_CRAFT_SIZE.height,
    padding: 4,
    bottomPadding: 4,
    removeGreenSpill: true,
    colors: 40,
    minSubjectFraction: 0.01,
    maxSubjectFraction: 0.86,
    minSubjectSpanFraction: 0.08,
  });
  const { width, height } = processed.metrics.outputBounds;
  if (height < 48 || width < 20 || height / Math.max(1, width) < 1.25) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated vertical craft needs a tall top-down silhouette (${width}x${height})`,
    );
  }
  return processed;
}

export async function processGeneratedShooterCraftReference(image: Buffer): Promise<Buffer> {
  const processed = await processGeneratedFighterPose(image, {
    width: SHOOTER_CRAFT_REFERENCE_SIZE.width,
    height: SHOOTER_CRAFT_REFERENCE_SIZE.height,
    padding: 40,
    bottomPadding: 40,
    removeGreenSpill: true,
    colors: 128,
    minSubjectFraction: 0.01,
    maxSubjectFraction: 0.86,
    minSubjectSpanFraction: 0.08,
  });
  const { width, height } = processed.metrics.outputBounds;
  if (height < 480 || width < 100 || height / Math.max(1, width) < 1.25) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated vertical craft reference needs a tall detailed silhouette (${width}x${height})`,
    );
  }
  return processed.png;
}
