import sharp from 'sharp';
import { ADVENTURE_ROOM_HEIGHT, ADVENTURE_ROOM_WIDTH, DISPLAY_SCALE } from '@sparkade/shared';

export const ADVENTURE_ROOM_PLATE_ROLE = 'adventureRoomPlates' as const;
export const ADVENTURE_ROOM_PLATE_NAMES = ['entrance', 'ordinary', 'deep', 'finale'] as const;
export type AdventureRoomPlateName = (typeof ADVENTURE_ROOM_PLATE_NAMES)[number];

export const ADVENTURE_ROOM_PLATE_COLUMNS = 2;
export const ADVENTURE_ROOM_PLATE_ROWS = 2;
/** Store one source pixel for every physical display pixel. The runtime draws
 * these into the logical room footprint under the engine's 2× transform, so
 * generated detail remains 1:1 instead of being nearest-neighbor doubled. */
export const ADVENTURE_ROOM_PLATE_WIDTH = ADVENTURE_ROOM_WIDTH * DISPLAY_SCALE;
export const ADVENTURE_ROOM_PLATE_HEIGHT = ADVENTURE_ROOM_HEIGHT * DISPLAY_SCALE;
export const ADVENTURE_ROOM_PLATE_ATLAS_WIDTH =
  ADVENTURE_ROOM_PLATE_COLUMNS * ADVENTURE_ROOM_PLATE_WIDTH;
export const ADVENTURE_ROOM_PLATE_ATLAS_HEIGHT =
  ADVENTURE_ROOM_PLATE_ROWS * ADVENTURE_ROOM_PLATE_HEIGHT;
export const ADVENTURE_ROOM_PLATE_ASPECT_HINT = '2048x1024';
export const ADVENTURE_ROOM_PLATE_PROMPT_VERSION = 'adventure-room-plates-v4';

export interface AdventureRoomPlatePromptOptions {
  gameTitle: string;
  tagline: string;
  backdrop: string;
  colors: string;
}

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** One call authors a coherent environmental progression while the engine
 * remains authoritative for every piece of collision and interactive state. */
export function buildAdventureRoomPlatePrompt(options: AdventureRoomPlatePromptOptions): string {
  return [
    'Create one wide 2-by-2 ROOM-SURFACE ATLAS for a top-down adventure game. This is environment-only gameplay art, not a scene illustration.',
    "Use the attached key art only as a reference for the world's era, materials, atmosphere, color language, and dense stylized game-art technique. Ignore and never reproduce any hero, enemy, boss, creature, vehicle, face, silhouette, item, or text from the reference.",
    `Game: ${clean(options.gameTitle, 80)} — ${clean(options.tagline, 120)}.`,
    `Environment family: ${clean(options.backdrop, 100)}. Color direction: ${clean(options.colors, 300)}.`,
    'LAYOUT IS EXACT: four equal borderless rectangular panels in two columns and two rows, filling the whole canvas with no gutters, frames, captions, seams, margins, or padding. Every panel is a straight-down orthographic 2:1 room surface. Top-left is ENTRANCE, top-right is ORDINARY, bottom-left is DEEP, bottom-right is FINALE.',
    'All four panels belong to one coherent material family, with controlled progression: entrance is welcoming and relatively clean; ordinary has slightly richer wear and environmental storytelling; deep is older, stranger, and moodier; finale is the most dramatic through material, color, lighting, and atmosphere alone.',
    'Each panel must read as one continuous authored floor or ground plane, not a repeated tile texture. Preserve large-scale compositional clarity while filling every material with rich fine-grained surface variation, small environmental accents, restrained irregular wear, and subtle pathways or material transitions. Quiet gameplay zones must be low contrast, not empty or low detail. Keep the center and the four doorway approach bands especially readable so actors, projectiles, pickups, switches, and combat telegraphs remain unmistakable.',
    'SCALE CONTRACT: every panel represents a 28-by-14-cell gameplay room. One cell is exactly one twenty-eighth of the panel width and one fourteenth of its height; use that only as an invisible scale yardstick and never paint a grid. Ground motifs must feel human-scale: use many small and medium material units. No single paving stone, slab, leaf, puddle, crack, brush stroke, or decorative shape may dominate a substantial fraction of a panel.',
    'Do not paint collision or gameplay state into any panel: no walls, raised borders, cliffs, pits, holes, chasms, doors, gates, stairs, bridges, platforms, hazards, spikes, switches, blocks, treasure, pickups, weapons, furniture, tall props, characters, creatures, enemies, bosses, bodies, shadows of subjects, or UI.',
    'STYLE TARGET: modern high-density pixel-art-inspired game art with a clear retro character, viewed from directly overhead. Preserve deliberate pixel placement, crisp stepped edges, small intentional pixel clusters, controlled color ramps, selective fine dithering, and clean sprite-compatible material rendering. It should unmistakably feel pixel-art-esque, but richer and denser than an authentic SNES-era background rather than technically constrained by that hardware.',
    'Render at the full native output resolution, matching the detail density of richly authored character and fixture sprites. Use crisp one-to-three-output-pixel texture marks, nuanced true-color material ramps, precise small edges, and layered micro-detail. This must not look like a low-resolution image enlarged with nearest-neighbor scaling: no macro-pixels, chunky pixel blocks, oversized square clusters, giant flat color regions, coarse mosaic treatment, or simulated retro screen resolution. Absolutely no photorealism, photographic textures, realistic camera lighting, blur, antialiased digital painting, loose brushwork, smooth vector shapes, perspective horizon, isometric view, or 3D rendering.',
    'No words, letters, numbers, labels, title, logo, caption, watermark, signature, checkerboard, concept-art page, or mockup. Opaque artwork edge to edge.',
  ].join(' ');
}

/** Normalize Muse's free-form landscape into four exact display-density room
 * plates. Each panel stays 2× the logical world footprint so the renderer can
 * place generated detail at native backing-store resolution. */
export async function normalizeAdventureRoomPlates(image: Buffer): Promise<Buffer> {
  const decoded = sharp(image).rotate();
  const metadata = await decoded.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('generated Adventure room-plate atlas is not a decodable image');
  }
  if (metadata.width / metadata.height < 1.2) {
    throw new Error(
      `generated Adventure room-plate atlas is not landscape (${metadata.width}x${metadata.height})`,
    );
  }

  return (
    decoded
      .resize(ADVENTURE_ROOM_PLATE_ATLAS_WIDTH, ADVENTURE_ROOM_PLATE_ATLAS_HEIGHT, {
        fit: 'cover',
        position: 'centre',
        kernel: sharp.kernel.lanczos3,
      })
      .flatten({ background: '#10131f' })
      // Preserve Muse's full RGB material variation. Palette quantization was
      // flattening subtle texture and making the plate read like enlarged legacy art.
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer()
  );
}
