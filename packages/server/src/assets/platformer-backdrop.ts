import sharp from 'sharp';
import type { GeneratedGameAssetRole } from '@sparkade/shared';

export const GENERATED_PLATFORMER_BACKDROPS = ['level1', 'level2', 'level3', 'boss'] as const;
export type GeneratedPlatformerBackdrop = (typeof GENERATED_PLATFORMER_BACKDROPS)[number];

export const PLATFORMER_BACKDROP_ASSET_ROLES = {
  level1: 'platformerBackdropLevel1',
  level2: 'platformerBackdropLevel2',
  level3: 'platformerBackdropLevel3',
  boss: 'platformerBackdropBoss',
} as const satisfies Record<GeneratedPlatformerBackdrop, GeneratedGameAssetRole>;

export const PLATFORMER_BACKDROP_WIDTH = 1536;
export const PLATFORMER_BACKDROP_HEIGHT = 600;
export const PLATFORMER_BACKDROP_ASPECT_HINT = '2048x1024';
export const PLATFORMER_BACKDROP_PROMPT_VERSION = 'platformer-backdrop-v2';

export interface PlatformerBackdropPromptOptions {
  gameTitle: string;
  tagline: string;
  role: GeneratedPlatformerBackdrop;
  sceneName: string;
  sceneBeat: string;
  backdrop: string;
  colors: string;
}

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildPlatformerBackdropPrompt(options: PlatformerBackdropPromptOptions): string {
  const finale = options.role === 'boss';
  return [
    'Create an extra-wide panoramic BACKGROUND PLATE for side-scrolling platform gameplay. This must be a completely empty environment with no foreground subject.',
    'Use the attached key art only as a visual reference for the environment\'s era, architecture, materials, atmosphere, palette, and crisp pixel-art technique. Ignore every hero, villain, creature, vehicle, face, silhouette, or other subject in the reference. Never copy, repeat, enlarge, memorialize, or allude to one of those subjects in the scenery.',
    `Game: ${clean(options.gameTitle, 80)} — ${clean(options.tagline, 120)}.`,
    finale
      ? 'Final-stage arena environment. Build the climax entirely from dramatic weather, lighting, architecture, terrain, scale, and atmospheric effects. Do not depict or visually reference the opponent.'
      : `Level ${options.role.slice(-1)} backdrop: ${clean(options.sceneName, 100)}. Scene direction: ${clean(options.sceneBeat, 360)}.`,
    `Authored environment family: ${clean(options.backdrop, 80)}. Color direction: ${clean(options.colors, 300)}.`,
    'Match the key art world while making this location visually distinct from the other stages.',
    'Compose a continuous very-wide landscape with rich DISTANT scenery and clear depth: sky or ceiling, far landmarks, a middle-distance skyline or ridgeline, atmospheric details, and occasional background objects. Keep all important landmarks away from the extreme left and right crop edges.',
    finale
      ? 'Leave the actual combat plane empty. No central subject or character-shaped landmark: no giant figure, eye, face, head, body, statue, monument, mural, portrait, hologram, shadow, constellation, cloud formation, plant, machine, or architecture resembling a living being or the opponent.'
      : 'Express this level beat through the environment alone; create a strong sense of travel and discovery without depicting the story characters.',
    'GAMEPLAY READABILITY IS MANDATORY: keep the lower third simpler, darker, and lower contrast than the upper scenery so bright collision tiles, the player, enemies, pickups, projectiles, and HUD remain immediately readable. Do not paint a playable floor, foreground platform, ledge, bridge, wall, hazard, doorway, or collision geometry near the camera.',
    'Polished high-density 16-bit SNES-era pixel art with crisp square pixel clusters, hard edges, limited flat color ramps, deliberate dithering, and no photorealism, blur, smooth vector shapes, or 3D rendering.',
    'Environment only. No player hero, face, character, person, creature, enemy, boss, vehicle, detached item, gameplay sprite, shadow-casting foreground subject, text, letters, numbers, title, logo, caption, UI, watermark, signature, frame, border, or checkerboard.',
    'Fill the entire canvas with opaque scenery. This is one panoramic background image, not a sprite sheet, collage, concept-art page, or multi-panel layout.',
  ].join(' ');
}

/** Normalize Muse's free-form landscape output into the fixed panoramic plate
 * consumed by the renderer. The extra horizontal room lets the camera pan
 * gently without tiling or revealing a seam. */
export async function normalizePlatformerBackdrop(image: Buffer): Promise<Buffer> {
  const decoded = sharp(image).rotate();
  const metadata = await decoded.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('generated platformer backdrop is not a decodable image');
  }
  if (metadata.width / metadata.height < 1.2) {
    throw new Error(
      `generated platformer backdrop is not landscape (${metadata.width}x${metadata.height})`,
    );
  }

  return decoded
    .resize(PLATFORMER_BACKDROP_WIDTH, PLATFORMER_BACKDROP_HEIGHT, {
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: '#10131f' })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colors: 128, dither: 0 })
    .toBuffer();
}
