import type { PlatformerAbility } from '@sparkade/shared';
import sharp from 'sharp';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const GENERATED_PLATFORMER_PROPS = [
  'collectible',
  'health',
  'powerup',
  'powerupDoubleJump',
  'powerupProjectile',
  'powerupShield',
  'heroProjectile',
  'enemyProjectile',
] as const;

export type GeneratedPlatformerProp = (typeof GENERATED_PLATFORMER_PROPS)[number];

export const PLATFORMER_PROP_PROMPT_VERSION = 'platformer-prop-v2';
export const PLATFORMER_PROP_PIPELINE_PROMPT_VERSION = 'platformer-prop-pipeline-v3';

export interface PlatformerPropPromptOptions {
  gameTitle: string;
  tagline: string;
  premise: string;
  role: GeneratedPlatformerProp;
  colors: string;
  ability?: PlatformerAbility;
}

const ROLE_DIRECTION: Record<GeneratedPlatformerProp, string> = {
  collectible:
    'Design one small signature collectible that expresses this game’s specific quest, setting, or hero. It must read as valuable at a glance without resembling health or a weapon.',
  health:
    'Design one unmistakable restorative pickup native to this world: a heart, life vessel, food, medicine, repair cell, or equivalent. It must read as health at a glance.',
  powerup:
    'Design one rare, unmistakably powerful upgrade pickup native to this world: a glowing tool, talisman, module, potion, or equivalent. Keep it distinct from health and the ordinary collectible.',
  powerupDoubleJump:
    'Design the rare upgrade pickup that grants the hero a second airborne jump. Its silhouette should suggest lift, rebound, wings, boots, propulsion, or another premise-specific upward impulse.',
  powerupProjectile:
    'Design the rare upgrade pickup that grants the hero a ranged shot. Show the compact tool, charge, ammunition source, or magical focus as one pickup, never the fired projectile itself.',
  powerupShield:
    'Design the rare upgrade pickup that grants a one-hit protective barrier. Its silhouette should suggest a ward, shell, lens, field generator, charm, or another premise-specific defense.',
  heroProjectile:
    'Design one compact projectile fired by the hero toward the RIGHT. Use a horizontal, fast-moving silhouette and a friendly palette accent. Do not show the weapon, hand, trail, or character that fires it.',
  enemyProjectile:
    'Design one compact hostile projectile traveling toward the LEFT. Use a horizontal, dangerous silhouette and a strong warning-color accent. Do not show the enemy, weapon, hand, trail, or muzzle that fires it.',
};

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Fixed slots keep request identity stable when a replay restores some props. */
export function platformerPropBoardLayout(count: number) {
  if (!Number.isInteger(count) || count < 2 || count > GENERATED_PLATFORMER_PROPS.length)
    throw new RangeError('A platformer prop board requires 2–8 roles');
  return { columns: 3, rows: count <= 6 ? 2 : 3, width: count <= 6 ? 1536 : 1024, height: 1024 };
}

export function buildPlatformerPropBoardPrompt(
  options: readonly PlatformerPropPromptOptions[],
): string {
  const { columns, rows } = platformerPropBoardLayout(options.length);
  const first = options[0]!;
  return [
    `PLATFORMER PROP BOARD: exactly ${columns} columns and ${rows} equal rows, read left-to-right then top-to-bottom.`,
    `Game: ${clean(first.gameTitle, 80)} — ${clean(first.tagline, 120)}. Premise: ${clean(first.premise, 240)}.`,
    'Use the attached key art as visual direction for world, materials, shapes, era, mood and rendering style.',
    'Each occupied cell contains exactly ONE complete isolated item, centered inside the middle 60% of its cell. Leave generous flat green gutters; nothing may cross a cell boundary.',
    ...options.map(
      (option, index) =>
        `Cell ${index + 1} (row ${Math.floor(index / columns) + 1}, column ${(index % columns) + 1}), asset role ${option.role}: ${ROLE_DIRECTION[option.role]}${option.ability ? ` Ability identity: ${clean(option.ability.name, 40)}. Ability visual contract: ${clean(option.ability.visualConcept, 220)}.` : ''}`,
    ),
    ...(options.length < columns * rows
      ? [`Leave cells ${options.length + 1} through ${columns * rows} empty.`]
      : []),
    'Do not draw labels, text, numbers, grid lines, borders, shadows, scenery, people or extra objects.',
    `Color direction: ${clean(first.colors)}. Make each silhouette distinct and readable at 12x12 gameplay pixels (projectiles at 8x8).`,
    'Polished high-density 16-bit SNES pixel art: crisp square clusters, hard edges, limited flat color ramps, strong outline separation, no blur, gradients or photorealism.',
    'The entire background, gutters and enclosed gaps must be perfectly flat #00ff00. Never use neon green inside an object.',
  ].join(' ');
}

/** Validate each crop independently; bad cells get the existing single-image retry. */
export async function processGeneratedPlatformerPropBoard(
  image: Buffer,
  roles: readonly GeneratedPlatformerProp[],
) {
  const { columns, rows, width, height } = platformerPropBoardLayout(roles.length);
  const board = await sharp(image).resize(width, height, { fit: 'fill' }).png().toBuffer();
  return Promise.all(
    roles.map(async (role, index) => {
      try {
        const left = Math.floor(((index % columns) * width) / columns);
        const top = Math.floor((Math.floor(index / columns) * height) / rows);
        const cellWidth = Math.floor((((index % columns) + 1) * width) / columns) - left;
        const cellHeight = Math.floor(((Math.floor(index / columns) + 1) * height) / rows) - top;
        const crop = await sharp(board)
          .extract({ left, top, width: cellWidth, height: cellHeight })
          .png()
          .toBuffer();
        const processed = await processGeneratedPlatformerProp(crop, role);
        const bounds = processed.metrics.sourceBounds;
        const margin = Math.ceil(Math.min(cellWidth, cellHeight) * 0.025);
        if (
          bounds.left < margin ||
          bounds.top < margin ||
          bounds.left + bounds.width > cellWidth - margin ||
          bounds.top + bounds.height > cellHeight - margin
        )
          throw new Error('Prop touches its cell boundary');
        return { role, png: processed.png };
      } catch (error) {
        return { role, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

export function buildPlatformerPropPrompt(options: PlatformerPropPromptOptions): string {
  const projectile = options.role === 'heroProjectile' || options.role === 'enemyProjectile';
  return [
    'Create exactly ONE isolated gameplay item sprite for the platform game shown by the attached key art.',
    `Game: ${clean(options.gameTitle, 80)} — ${clean(options.tagline, 120)}.`,
    `Premise: ${clean(options.premise, 240)}.`,
    `Asset role: ${options.role}. ${ROLE_DIRECTION[options.role]}`,
    ...(options.ability
      ? [
          `Ability identity: ${clean(options.ability.name, 40)}.`,
          `Ability visual contract: ${clean(options.ability.visualConcept, 220)}. Preserve this identity in the pickup${options.role === 'heroProjectile' ? ' and fired shot' : ''}.`,
        ]
      : []),
    'Use the attached key art only as visual direction. Match its world, materials, shapes, era, mood, and rendering style without copying a complete character or scene.',
    projectile
      ? 'The projectile must remain bold and legible when displayed at 8x8 world pixels.'
      : 'The pickup must remain bold and legible when displayed at 12x12 world pixels.',
    `Use this game color direction while preserving strong gameplay contrast: ${clean(options.colors)}.`,
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, strong outline separation, no antialiasing, blur, gradients, or photorealism.',
    'This is one object in one state, NOT a sprite sheet, animation sequence, collage, icon grid, inventory screen, card, or gameplay scene.',
    'No player, person, creature, enemy, boss, face, hand, text, letters, numbers, logo, watermark, signature, UI, border, scenery, floor, platform, shadow, or second object.',
    'The complete silhouette must be visible and centered with room around it. Nothing may be cropped.',
    'The entire background must be perfectly flat solid #00ff00, including every enclosed gap. Do not use #00ff00 or a near-neon imitation in the object itself; darker natural greens are allowed.',
  ].join(' ');
}

/** Key, normalize, and quantize one small per-game platformer prop. */
export async function processGeneratedPlatformerProp(
  image: Buffer,
  role: GeneratedPlatformerProp,
): Promise<ProcessedFighterPose> {
  const projectile = role === 'heroProjectile' || role === 'enemyProjectile';
  const size = projectile ? 32 : 48;
  const processed = await processGeneratedFighterPose(image, {
    width: size,
    height: size,
    padding: projectile ? 2 : 3,
    bottomPadding: projectile ? 2 : 3,
    removeGreenSpill: true,
    colors: 32,
    minSubjectFraction: 0.002,
    maxSubjectFraction: 0.86,
    minSubjectSpanFraction: 0.025,
  });
  const minimum = projectile ? 6 : 10;
  if (
    processed.metrics.outputBounds.width < minimum ||
    processed.metrics.outputBounds.height < minimum
  ) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated ${role} prop is too small (${processed.metrics.outputBounds.width}x${processed.metrics.outputBounds.height})`,
    );
  }
  return processed;
}
