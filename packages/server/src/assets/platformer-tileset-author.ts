import sharp, { type Sharp } from 'sharp';
import { FighterPoseImageError, processGeneratedFighterPose } from './fighter-pose';

export const PLATFORMER_TILESET_FIXTURE_ROLES = [
  'hazard',
  'checkpoint',
  'exit',
  'deco',
  'movingPlatform',
  'spring',
] as const;

export type PlatformerTilesetFixtureRole = (typeof PLATFORMER_TILESET_FIXTURE_ROLES)[number];

export const PLATFORMER_TILESET_AUTHOR_PROMPT_VERSION = 'platformer-tileset-author-v5';

const FIXTURE_DIRECTIONS: Record<PlatformerTilesetFixtureRole, string> = {
  hazard:
    'one connected row of unmistakably dangerous spikes, flames, thorns, teeth, electricity, or equivalent danger, spanning most of the width and grounded at the bottom',
  checkpoint:
    'one compact upright checkpoint marker, beacon, flag, shrine, terminal, or equivalent save marker, grounded and clearly distinct from enemies and hazards',
  exit: 'one tall front-facing exit doorway, portal, gate, hatch, elevator, or equivalent destination, grounded with a strong readable opening',
  deco: 'one low noninteractive foreground scenery prop native to the theme, grounded and clearly not a pickup, hazard, enemy, checkpoint, or doorway',
  movingPlatform:
    'one wide moving-platform vehicle or slab with a perfectly flat rideable top and a sturdy visible body, no hanging supports, rider, cargo, floor, or scenery',
  spring:
    'one compact spring-loaded jump pad with an unmistakable compressible coil, bellows, piston, mushroom cap, or bounce mechanism, grounded at the bottom and readable as something the hero should land on',
};

const SAFE_FIXTURE_DIRECTIONS: Record<PlatformerTilesetFixtureRole, string> = {
  hazard:
    'one connected row of non-living, abstract triangular obstacle markers, spanning most of the width and grounded at the bottom',
  checkpoint:
    'one compact upright progress marker or illuminated waypoint, grounded and clearly readable',
  exit: 'one tall front-facing destination doorway or illuminated gate, grounded with a strong readable opening',
  deco: 'one low noninteractive foreground scenery prop native to the attached material, grounded and compact',
  movingPlatform:
    'one wide floating platform slab with a perfectly flat rideable top and a sturdy visible body, with no supports, cargo, or surrounding scene',
  spring:
    'one compact spring-loaded jump pad with an obvious compressible bounce mechanism, grounded and clearly readable',
};

const FIXTURE_DIMENSIONS: Record<PlatformerTilesetFixtureRole, { width: number; height: number }> =
  {
    hazard: { width: 64, height: 64 },
    checkpoint: { width: 64, height: 64 },
    exit: { width: 64, height: 128 },
    deco: { width: 64, height: 64 },
    movingPlatform: { width: 96, height: 32 },
    spring: { width: 64, height: 64 },
  };

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildPlatformerTilesetTerrainPrompt(theme: string, concept: string): string {
  return [
    `Create one square, fully opaque terrain-material study for the ${clean(theme, 60)} platformer theme.`,
    `Theme direction: ${clean(concept)}.`,
    'The perfectly flat walkable surface begins at the very top row and occupies roughly the upper quarter; below it, continue into a large uninterrupted body of the exact same material.',
    'The result is a continuous macrotexture, not a collection of separate blocks, panels, tiles, frames, compartments, or samples. Below the surface cap, keep brightness and texture density uniform all the way to the bottom: absolutely no full-width divider, shadow, border, horizon, layer, or dark band.',
    'The below-surface body will be repeated as a seamless square texture. Its left and right boundaries must continue into each other, and its upper and lower body boundaries must continue into each other without a visible join. Prefer evenly distributed small and medium details; do not let a large root, crack, beam, or diagonal stroke terminate at an edge.',
    'Fill every pixel edge-to-edge. Make the full image left and right edges compatible when repeated. No transparency, margin, checkerboard, green screen, border, text, UI, characters, creatures, or objects.',
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, deliberate texture, no antialiasing, blur, gradients, photorealism, or 3D rendering.',
  ].join(' ');
}

export function buildPlatformerTilesetBodyPrompt(theme: string, concept: string): string {
  return [
    'Use case: stylized-concept. Asset type: seamless tileable game texture.',
    'Use the attached interior-only material crop as the exact palette, pixel-density, and rendering-style reference. It is a texture swatch, not terrain geometry.',
    `Create one square all-over buried solid-body texture for the ${clean(theme, 60)} platformer theme. Theme direction: ${clean(concept)}.`,
    'This is only the material seen inside a deep mass, viewed perfectly straight-on. Fill every pixel edge-to-edge with uniform texture density. Every 64-by-64 crop must read as interior material, never as a surface.',
    'The square has no top, bottom, up, down, ground, or sky. It should remain equally plausible after a 90-degree rotation.',
    'There must be no walkable surface, top cap, frosting or snow cap, grass lip, ledge, rim, platform, shelf, horizon, exposed edge, border, outline, horizontal layer, divider band, or directional top lighting. Do not arrange stones, gears, frosting, snow, chitin, crystals, or other details into horizontal rows or stripes.',
    'Make it genuinely seamless on both axes: left continues into right and top continues into bottom without a visible join. Use an evenly distributed, direction-neutral field of small and medium details with no focal object or large feature terminating at an edge.',
    'Return one continuous texture, not separate blocks, panels, tiles, frames, compartments, samples, or a gameplay scene.',
    'No transparency, margin, checkerboard, green screen, text, UI, characters, creatures, or objects.',
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, deliberate texture, no antialiasing, blur, gradients, photorealism, or 3D rendering.',
  ].join(' ');
}

/** Remove the authored surface before asking Muse to derive the buried-body texture. */
export async function buildPlatformerTilesetBodyStyleReference(image: Buffer): Promise<Buffer> {
  const decoded = sharp(image).rotate();
  const metadata = await decoded.metadata();
  if (!metadata.width || !metadata.height) {
    throw new FighterPoseImageError('invalid-image', 'terrain study is not decodable');
  }
  const top = Math.round(metadata.height * 0.4);
  const size = Math.min(metadata.width, metadata.height - top);
  const left = Math.floor((metadata.width - size) / 2);
  return decoded
    .extract({ left, top, width: size, height: size })
    .resize(1024, 1024, { fit: 'fill', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
}

export function buildPlatformerTilesetFixturePrompt(
  theme: string,
  concept: string,
  role: PlatformerTilesetFixtureRole,
): string {
  return [
    `Using the attached terrain-material study as the exact style, material, palette, lighting, and pixel-density reference, create exactly ${FIXTURE_DIRECTIONS[role]}.`,
    `This belongs to the ${clean(theme, 60)} platformer theme. Theme direction: ${clean(concept)}.`,
    role === 'movingPlatform'
      ? 'The visible body must occupy at least half of the short output height and must never become a hairline, wire, rope, or single-pixel stroke.'
      : '',
    'Use a crisp dark outer edge and stronger local contrast than distant scenery.',
    'Create exactly one isolated asset, not a sprite sheet, collage, multiple alternatives, gameplay screenshot, or scene.',
    'The entire background must be perfectly flat solid #00ff00, including every enclosed gap. Do not use #00ff00 or a near-neon imitation in the asset.',
    'No player, person, creature, enemy, boss, face, hand, text, letters, numbers, logo, watermark, signature, UI, frame, border, scenery, floor, or cast shadow.',
    'Polished high-density 16-bit SNES-era pixel art with crisp square pixel clusters, hard edges, limited flat color ramps, no antialiasing, blur, gradients, photorealism, or 3D rendering.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildPlatformerTilesetFixturePolicyFallbackPrompt(
  role: PlatformerTilesetFixtureRole,
): string {
  return [
    `Using the attached terrain-material study only as a material, palette, lighting, and pixel-art reference, create exactly ${SAFE_FIXTURE_DIRECTIONS[role]}.`,
    role === 'movingPlatform'
      ? 'The visible body must occupy at least half of the short output height and must not become a hairline, wire, rope, or single-pixel stroke.'
      : '',
    'This is a benign, family-friendly environment fixture for an all-ages retro platform game.',
    'Create exactly one isolated non-living asset, not a sprite sheet, collage, gameplay screenshot, or scene.',
    'The entire background must be perfectly flat solid #00ff00, including every enclosed gap. Do not use #00ff00 in the asset.',
    'No characters, living subjects, text, logo, watermark, UI, frame, floor, scenery, or cast shadow.',
    'Polished high-density 16-bit console pixel art with crisp square pixel clusters, hard edges, limited flat color ramps, and no antialiasing, blur, gradients, photorealism, or 3D rendering.',
  ]
    .filter(Boolean)
    .join(' ');
}

export async function processPlatformerTilesetTerrain(
  image: Buffer,
  bodyImage?: Buffer,
): Promise<{ solidCap: Buffer; solidInner: Buffer }> {
  const decoded = sharp(image).rotate();
  const metadata = await decoded.metadata();
  if (!metadata.width || !metadata.height) {
    throw new FighterPoseImageError('invalid-image', 'terrain study is not decodable');
  }
  // The prompt reserves the upper quarter for the walkable cap. Starting the
  // repeating body below that transition avoids baking a horizontal horizon
  // into the macrotexture (which becomes a seam every four tiles).
  const bodyTop = Math.round(metadata.height * 0.25);
  const encode = (pipeline: Sharp) =>
    pipeline
      .flatten({ background: '#24202b' })
      .png({
        palette: true,
        colours: 48,
        dither: 0,
        compressionLevel: 9,
        adaptiveFiltering: false,
      })
      .toBuffer();
  const bodyPipeline = bodyImage
    ? sharp(bodyImage).rotate().resize(256, 256, { fit: 'cover', position: 'centre' })
    : decoded
        .clone()
        .extract({
          left: 0,
          top: bodyTop,
          width: metadata.width,
          height: metadata.height - bodyTop,
        })
        .resize(256, 256, { fit: 'cover', position: 'centre' });
  const [solidCap, solidInner] = await Promise.all([
    encode(decoded.clone().resize(256, 64, { fit: 'cover', position: 'north' })),
    encode(bodyPipeline),
  ]);
  return { solidCap, solidInner };
}

async function fitHorizontalSurface(image: Buffer, minimumHeight: number): Promise<Buffer> {
  const decoded = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (decoded.data[(y * width + x) * 4 + 3]! <= 8) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (top === height || right < left || bottom < top) return image;
  const sourceHeight = bottom - top + 1;
  const fittedHeight = Math.min(height, Math.max(sourceHeight, minimumHeight));
  return sharp(decoded.data, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: right - left + 1, height: sourceHeight })
    .resize(width, fittedHeight, { fit: 'fill', kernel: sharp.kernel.nearest })
    .extend({
      left: 0,
      right: 0,
      top: 0,
      bottom: height - fittedHeight,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ palette: true, colours: 48, dither: 0, compressionLevel: 9 })
    .toBuffer();
}

async function fitExit(image: Buffer): Promise<Buffer> {
  const decoded = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = decoded.info;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (decoded.data[(y * width + x) * 4 + 3]! <= 8) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (top === height || right < left || bottom < top) return image;
  return sharp(decoded.data, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize(width - 4, height - 4, { fit: 'fill', kernel: sharp.kernel.nearest })
    .extend({
      left: 2,
      right: 2,
      top: 2,
      bottom: 2,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ palette: true, colours: 48, dither: 0, compressionLevel: 9 })
    .toBuffer();
}

export async function processPlatformerTilesetFixture(
  image: Buffer,
  role: PlatformerTilesetFixtureRole,
): Promise<Buffer> {
  const dimensions = FIXTURE_DIMENSIONS[role];
  const horizontal = role === 'movingPlatform';
  const processed = await processGeneratedFighterPose(image, {
    width: dimensions.width,
    height: dimensions.height,
    padding: horizontal ? 0 : 2,
    bottomPadding: 0,
    removeGreenSpill: true,
    colors: 48,
    minSubjectFraction: 0.002,
    maxSubjectFraction: 0.9,
    minSubjectSpanFraction: 0.035,
  });
  if (role === 'movingPlatform') return fitHorizontalSurface(processed.png, 18);
  if (role === 'exit') return fitExit(processed.png);
  return processed.png;
}
