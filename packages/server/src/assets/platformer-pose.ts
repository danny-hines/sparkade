import {
  prepareGeneratedFighterReference,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

/** Complete generated-player contract for the side-scrolling platformer. */
export const GENERATED_PLATFORMER_POSES = ['idle', 'walk1', 'walk2', 'jump'] as const;

export type GeneratedPlatformerPose = (typeof GENERATED_PLATFORMER_POSES)[number];

export const GENERATED_PLATFORMER_POSE_WIDTH = 48;
export const GENERATED_PLATFORMER_POSE_HEIGHT = 64;
export const GENERATED_PLATFORMER_POSE_PROMPT_VERSION = 'platformer-pose-v3';

const POSE_DIRECTIONS: Record<GeneratedPlatformerPose, string> = {
  idle:
    'a neutral FRONT-FACING idle pose with a relaxed but ready expression, both feet planted, and arms held clearly away from the torso',
  walk1:
    'the first clear mid-stride walking frame toward the RIGHT, left foot forward, right foot back, opposite arm swing, and torso upright',
  walk2:
    'the contrasting second mid-stride walking frame toward the RIGHT, right foot forward, left foot back, opposite arm swing, and torso upright',
  jump:
    'a readable airborne platforming pose facing RIGHT, both feet off the ground, knees bent, arms balancing the jump, and no attack in progress',
};

export interface PlatformerPosePromptOptions {
  /** Design-stage hero concept/costume, kept concise and visually concrete. */
  heroConcept?: string;
  /** Generated-game palette guidance. Green is always forbidden. */
  colors?: string;
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
    'Preserve their recognizable identity: face shape, skin tone, hair texture and style, facial hair, glasses, headwear, accessories, and body proportions visible in the reference. Never invent glasses or accessories that are absent from the reference, and never remove ones that are present.',
    heroConcept ? `Game-world hero design and costume: ${heroConcept}.` : '',
    colors ? `Costume color direction: ${colors}.` : '',
    `Pose: ${POSE_DIRECTIONS[pose]}.`,
    'Show the complete silhouette from the top of the hair or headwear through every hand and both feet. Nothing may be cropped.',
    'Polished 16-bit SNES-era platformer pixel art authored for a native 48x64 player sprite: crisp square pixel clusters, hard edges, expressive readable silhouette, limited flat colors, and no antialiasing, blur, gradients, or photorealism.',
    'Keep the character centered and consistently proportioned so this frame can animate with the other poses at the same size and ground line.',
    'This is one sprite in one pose, NOT a sprite sheet, turnaround, sequence, collage, portrait, or character-select card.',
    'No text, letters, numbers, logos, watermark, signature, UI, border, scenery, floor, platform, shadow, glow, particles, weapons, held props, extra objects, or second character.',
    'The entire background must be perfectly flat solid #00ff00, including every gap enclosed by arms and legs. No texture or color variation. Do not use the exact #00ff00 key color or a near-neon imitation in the character; preserve darker natural or dyed greens when they are part of the person.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Stable high-resolution idle edit reference for the remaining poses. */
export const prepareGeneratedPlatformerReference = prepareGeneratedFighterReference;

/** Key, validate, crop, quantize, and foot-anchor one native 48x64 pose. */
export function processGeneratedPlatformerPose(image: Buffer): Promise<ProcessedFighterPose> {
  return processGeneratedFighterPose(image, {
    width: GENERATED_PLATFORMER_POSE_WIDTH,
    height: GENERATED_PLATFORMER_POSE_HEIGHT,
    padding: 3,
    bottomPadding: 0,
    colors: 32,
  });
}
