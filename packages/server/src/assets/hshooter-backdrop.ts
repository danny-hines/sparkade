import sharp from 'sharp';
import type { GeneratedGameAssetRole } from '@sparkade/shared';

export const GENERATED_HSHOOTER_BACKDROPS = ['level1', 'level2', 'level3', 'boss'] as const;
export type GeneratedHShooterBackdrop = (typeof GENERATED_HSHOOTER_BACKDROPS)[number];

export const HSHOOTER_BACKDROP_ASSET_ROLES = {
  level1: 'hshooterBackdropLevel1',
  level2: 'hshooterBackdropLevel2',
  level3: 'hshooterBackdropLevel3',
  boss: 'hshooterBackdropBoss',
} as const satisfies Record<GeneratedHShooterBackdrop, GeneratedGameAssetRole>;

export const HSHOOTER_BACKDROP_WIDTH = 1536;
export const HSHOOTER_BACKDROP_HEIGHT = 600;
export const HSHOOTER_BACKDROP_ASPECT_HINT = '2048x1024';
export const HSHOOTER_BACKDROP_PROMPT_VERSION = 'hshooter-backdrop-v1';

export interface HShooterBackdropPromptOptions {
  gameTitle: string;
  tagline: string;
  role: GeneratedHShooterBackdrop;
  sceneName: string;
  sceneBeat: string;
  backdrop: string;
  colors: string;
}

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildHShooterBackdropPrompt(options: HShooterBackdropPromptOptions): string {
  const finale = options.role === 'boss';
  return [
    'Create one extra-wide panoramic BACKGROUND PLATE for a continuously auto-scrolling horizontal shooter. This is distant environment art only, with no foreground subject.',
    "Use the attached key art only for the world's era, architecture, materials, atmosphere, palette, and crisp pixel-art technique. Ignore every pilot, character, villain, creature, vehicle, ship, face, silhouette, weapon, projectile, or other subject in the reference. Never copy or hide one of those subjects in the scenery.",
    `Game: ${clean(options.gameTitle, 80)} — ${clean(options.tagline, 120)}.`,
    finale
      ? 'Final boss-arena environment. Express the climax only through vast architecture, terrain, weather, lighting, scale, and atmosphere. Do not depict or visually reference the boss or player craft.'
      : `Flight stage ${options.role.slice(-1)}: ${clean(options.sceneName, 100)}. Environmental beat: ${clean(options.sceneBeat, 360)}.`,
    `Authored environment family: ${clean(options.backdrop, 80)}. Color direction: ${clean(options.colors, 300)}.`,
    'Make this location clearly distinct from the other stages while preserving one coherent game world.',
    'Compose one continuous very-wide landscape with layered DISTANT depth: a broad sky, sea, cavern, city, or void field; large far landmarks; a muted middle-distance silhouette; and sparse atmospheric detail. Keep important landmarks away from the extreme left and right crop edges.',
    'GAMEPLAY READABILITY IS MANDATORY ACROSS ALMOST THE ENTIRE IMAGE: the ship can fly freely from near the ceiling to near the floor. Keep the central 80 percent of the full image height dark, subdued, low contrast, and built from broad low-frequency shapes. Avoid bright pinpoints, glowing dots, tiny high-contrast objects, projectile-like streaks, dense texture, or busy repeated patterns anywhere in the flight corridor.',
    'Any richer architecture or terrain must remain distant and weighted toward the outer top and bottom margins. Do not paint near-camera ceiling, floor, wall, tunnel mouth, platform, ledge, hazard, doorway, collision geometry, or anything that implies a different playable route.',
    finale
      ? 'Leave the combat plane empty. No central subject or character-shaped landmark: no giant figure, eye, face, head, body, statue, monument, mural, portrait, hologram, shadow, constellation, cloud formation, plant, machine, or architecture resembling a living being or either combatant.'
      : 'Express travel and escalation through the environment alone without depicting story characters or vehicles.',
    'Polished high-density 16-bit SNES-era pixel art with crisp square pixel clusters, hard edges, limited flat color ramps, deliberate dithering, and no photorealism, blur, smooth vector shapes, or 3D rendering.',
    'Environment only. No player, pilot, person, face, character, creature, enemy, boss, spacecraft, submarine, vehicle, gameplay sprite, pickup, projectile, exhaust trail, text, letters, numbers, title, logo, caption, UI, HUD, watermark, signature, frame, border, or checkerboard.',
    'Fill the complete canvas with opaque scenery. This is one panoramic background image, not a sprite sheet, collage, concept-art page, or multi-panel layout.',
  ].join(' ');
}

/** Normalize one free-form Muse landscape into the fixed wide runtime plate. */
export async function normalizeHShooterBackdrop(image: Buffer): Promise<Buffer> {
  const decoded = sharp(image).rotate();
  const metadata = await decoded.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('generated H-scroll backdrop is not a decodable image');
  }
  if (metadata.width / metadata.height < 1.2) {
    throw new Error(
      `generated H-scroll backdrop is not landscape (${metadata.width}x${metadata.height})`,
    );
  }

  return decoded
    .resize(HSHOOTER_BACKDROP_WIDTH, HSHOOTER_BACKDROP_HEIGHT, {
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: '#10131f' })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colors: 128, dither: 0 })
    .toBuffer();
}
