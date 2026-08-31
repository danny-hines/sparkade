import sharp from 'sharp';
import type { GeneratedGameAssetRole } from '@sparkade/shared';

export const GENERATED_SHOOTER_BACKDROPS = ['level1', 'level2', 'level3', 'boss'] as const;
export type GeneratedShooterBackdrop = (typeof GENERATED_SHOOTER_BACKDROPS)[number];

export const SHOOTER_BACKDROP_ASSET_ROLES = {
  level1: 'shooterBackdropLevel1',
  level2: 'shooterBackdropLevel2',
  level3: 'shooterBackdropLevel3',
  boss: 'shooterBackdropBoss',
} as const satisfies Record<GeneratedShooterBackdrop, GeneratedGameAssetRole>;

export const SHOOTER_BACKDROP_WIDTH = 960;
export const SHOOTER_BACKDROP_HEIGHT = 1536;
export const SHOOTER_BACKDROP_ASPECT_HINT = '1024x1536';
export const SHOOTER_BACKDROP_PROMPT_VERSION = 'shooter-backdrop-v1';

export interface ShooterBackdropPromptOptions {
  gameTitle: string;
  tagline: string;
  role: GeneratedShooterBackdrop;
  sceneName: string;
  sceneBeat: string;
  backdrop: string;
  colors: string;
}

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildShooterBackdropPrompt(options: ShooterBackdropPromptOptions): string {
  const finale = options.role === 'boss';
  return [
    'Create one tall portrait BACKGROUND FLYOVER PLATE for a continuously upward-flying vertical arcade shooter. This is distant top-down environment art only, with no foreground subject.',
    "Use the attached key art only for the world's era, architecture, materials, atmosphere, palette, and crisp pixel-art technique. Ignore every pilot, character, villain, creature, vehicle, craft, face, silhouette, weapon, projectile, or other subject in the reference.",
    `Game: ${clean(options.gameTitle, 80)} — ${clean(options.tagline, 120)}.`,
    finale
      ? 'Final boss-arena flyover. Express the climax only through environment, weather, lighting, scale, and atmosphere. Never depict or imply the boss or player craft.'
      : `Flight stage ${options.role.slice(-1)}: ${clean(options.sceneName, 100)}. Environmental beat: ${clean(options.sceneBeat, 360)}.`,
    `Authored environment family: ${clean(options.backdrop, 80)}. Color direction: ${clean(options.colors, 300)}.`,
    'Compose one continuous tall travel plate from a strict TOP-DOWN overhead camera that reads from bottom toward top: distant ground, water, cloud, city, canyon, asteroid field, or void layers beneath the craft; a few broad landmarks; restrained atmospheric depth; and clear continuity across the full height.',
    'GAMEPLAY READABILITY IS MANDATORY ACROSS THE FULL WIDTH: keep the central combat field dark, subdued, low contrast, and made from broad low-frequency shapes. Avoid bright pinpoints, tiny high-contrast objects, projectile-like streaks, dense repeated texture, or fake pickups anywhere.',
    'All scenery is non-colliding and far below or behind the action. No near-camera wall, corridor, ceiling, floor, tunnel, platform, ledge, hazard, doorway, terrain boundary, or alternate playable route.',
    'Make this location distinct from the other stages while preserving one coherent world. Use richer detail only at broad edges and large landmarks; never create a fixed safe lane.',
    'Polished high-density 16-bit SNES-era pixel art with crisp square pixel clusters, hard edges, limited flat color ramps, deliberate dithering, and no photorealism, blur, smooth vector shapes, or 3D rendering.',
    'Environment only. No player, pilot, person, face, character, creature, enemy, boss, spacecraft, submarine, vehicle, gameplay sprite, pickup, projectile, exhaust trail, text, title, logo, caption, UI, HUD, watermark, signature, frame, border, checkerboard, or green screen.',
    'Fill the complete canvas with opaque scenery. This is one portrait background image, not a sprite sheet, collage, concept-art page, or multi-panel layout.',
  ].join(' ');
}

export async function normalizeShooterBackdrop(image: Buffer): Promise<Buffer> {
  const decoded = sharp(image).rotate();
  const metadata = await decoded.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('generated vertical-shooter backdrop is not a decodable image');
  }
  if (metadata.height / metadata.width < 1.2) {
    throw new Error(
      `generated vertical-shooter backdrop is not portrait (${metadata.width}x${metadata.height})`,
    );
  }
  return decoded
    .resize(SHOOTER_BACKDROP_WIDTH, SHOOTER_BACKDROP_HEIGHT, {
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: '#10131f' })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colors: 128, dither: 0 })
    .toBuffer();
}
