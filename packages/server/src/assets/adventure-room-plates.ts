import sharp from 'sharp';
import {
  ADVENTURE_ROOM_COLUMNS,
  ADVENTURE_ROOM_HEIGHT,
  ADVENTURE_ROOM_ROWS,
  ADVENTURE_ROOM_WIDTH,
  DISPLAY_SCALE,
} from '@sparkade/shared';

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
export const ADVENTURE_ROOM_PLATE_PROMPT_VERSION = 'adventure-room-plates-v6';

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
    "Use the attached key art only as a reference for the world's era, materials, atmosphere, color family, and stylized pixel technique. The room surface must be substantially calmer and less contrasty than the key art. Ignore and never reproduce any hero, enemy, boss, creature, vehicle, face, silhouette, item, or text from the reference.",
    `Game: ${clean(options.gameTitle, 80)} — ${clean(options.tagline, 120)}.`,
    `Environment family: ${clean(options.backdrop, 100)}. Color direction: ${clean(options.colors, 300)}.`,
    'LAYOUT IS EXACT: four equal borderless rectangular panels in two columns and two rows, filling the whole canvas with no gutters, frames, captions, seams, margins, or padding. Every panel is a straight-down orthographic 2:1 room surface. Top-left is ENTRANCE, top-right is ORDINARY, bottom-left is DEEP, bottom-right is FINALE.',
    'All four panels belong to one coherent material family, with controlled progression: entrance is welcoming and relatively clean; ordinary is gently worn; deep is older and moodier; finale is the most dramatic. Express progression through restrained shifts in base hue, value, material age, surface treatment, and wear—not by adding objects, symbols, glowing accents, dramatic cracks, clutter, or lighting hotspots.',
    'VISUAL-HIERARCHY CONTRACT: the entire panel is a subordinate gameplay underlay. Roughly 65–75 percent of every panel should read as calm, continuous walkable material; the remaining richness must still be low-contrast, noninteractive surface variation rather than object-like decoration. Use low-to-moderate saturation and no focal point. Reserve the darkest outlines, brightest lights, warm danger colors, saturated accents, and sharpest edges for runtime players, enemies, hazards, pickups, switches, projectiles, doors, and combat telegraphs that will be drawn later. The generated surface must never compete with those layers.',
    'MATERIAL-RICHNESS CONTRACT: each panel should feel deliberately authored at three scales. First, use three to five broad, overlapping, low-contrast tonal fields or directional material flows spanning several gameplay cells. Second, add medium-scale shallow wear, sediment, grain direction, fibers, mineral veining, brushed marks, or softly stepped material changes appropriate to this world; these must merge into the floor without dark outlines or cast shadows. Third, add restrained high-density pixel texture made from small CONNECTED irregular runs and clusters. The result should have layered surface character and visible craft even when no gameplay fixtures are present.',
    'Each panel must read as one continuous flat floor or ground plane, not a repeated tile texture and not a collection of distinct objects. Never use uniformly scattered square flecks, isolated single-pixel confetti, evenly spaced dots, random block noise, coarse stippling, or repeated same-size marks. Microtexture must connect into short irregular material grain and vary in direction, length, density, and color while remaining close in value to the base. Use no freestanding environmental accents. Avoid any mark or cluster at player, enemy, pickup, projectile, switch, key, spike, treasure, or doorway scale. Keep the center and all four doorway approach bands especially quiet and readable because gameplay actors may occupy them.',
    'FLATNESS CONTRACT: nothing in the surface may appear raised, recessed, interactive, dangerous, collectible, or traversable as a separate feature. No dark outer contours, sprite-like silhouettes, cast shadows, contact shadows, rim lights, glow, specular sparkles, bright pinpoints, luminous lines, projectile-like streaks, outlined patches, high-contrast seams, branching crack networks, holes, sockets, embedded objects, footprints, tracks, trails, or repeated emblem-like motifs. Material boundaries must be soft-edged or gently stepped and remain close in value to both neighboring materials.',
    'READABILITY TEST: when viewed at gameplay size or as a small thumbnail, no individual background shape should attract attention or be nameable as an object. The eye should register one coherent floor material first; every future actor and engine-authored fixture must be able to read immediately anywhere over it.',
    `SCALE CONTRACT: every panel represents a ${ADVENTURE_ROOM_COLUMNS}-by-${ADVENTURE_ROOM_ROWS}-cell gameplay room. One cell is exactly one ${ordinalDenominator(ADVENTURE_ROOM_COLUMNS)} of the panel width and one ${ordinalDenominator(ADVENTURE_ROOM_ROWS)} of its height; use that only as an invisible scale yardstick and never paint a grid. Do not delineate individual paving stones, slabs, leaves, puddles, cracks, brush strokes, or decorative shapes at gameplay-cell scale. Material grain must remain much smaller than one gameplay cell, connected rather than scattered, irregular rather than repeated, and too subtle to resemble a sprite or collision feature.`,
    'Do not paint collision or gameplay state into any panel: no walls, raised borders, cliffs, pits, holes, chasms, doors, gates, stairs, bridges, platforms, hazards, spikes, switches, blocks, treasure, pickups, weapons, furniture, tall props, characters, creatures, enemies, bosses, bodies, shadows of subjects, or UI.',
    'STYLE TARGET: modern high-density pixel-art-inspired game art with a clear retro character, viewed from directly overhead. Preserve deliberate pixel placement, crisp stepped edges, small intentional pixel clusters, controlled color ramps, selective fine dithering, and clean sprite-compatible material rendering. It should unmistakably feel pixel-art-esque, but richer and denser than an authentic SNES-era background rather than technically constrained by that hardware.',
    'Render at the full native output resolution with deliberate pixel placement. Fine one-to-three-output-pixel marks are allowed only as connected, low-contrast material grain—not isolated squares—and should combine into denser local texture without becoming a sprite-like cluster. Detail density does not mean more objects, more outlines, or more highlights. Use nuanced true-color ramps inside a restrained value range. This must not look like a low-resolution image enlarged with nearest-neighbor scaling: no macro-pixels, chunky pixel blocks, oversized square clusters, giant featureless regions, coarse mosaic treatment, simulated retro screen resolution, or a flat base covered in random square noise. Absolutely no photorealism, photographic textures, realistic camera lighting, blur, antialiased digital painting, loose brushwork, smooth vector shapes, perspective horizon, isometric view, or 3D rendering.',
    'No words, letters, numbers, labels, title, logo, caption, watermark, signature, checkerboard, concept-art page, or mockup. Opaque artwork edge to edge.',
  ].join(' ');
}

function ordinalDenominator(value: number): string {
  const ones = value % 10;
  const suffix =
    value % 100 >= 11 && value % 100 <= 13
      ? 'th'
      : ones === 1
        ? 'st'
        : ones === 2
          ? 'nd'
          : ones === 3
            ? 'rd'
            : 'th';
  return `${value}${suffix}`;
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
