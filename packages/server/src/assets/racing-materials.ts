import sharp from 'sharp';
import {
  RACING_MATERIAL_ATLAS_SIZE,
  RACING_MATERIAL_SLOTS,
  RACING_MATERIAL_TILE,
} from '@sparkade/shared';
import { FighterPoseImageError } from './fighter-pose';

export const RACING_MATERIALS_PROMPT_VERSION = 'racing-materials-v1';
export const RACING_MATERIALS_SOURCE_MIN = 256;
/** Minimum per-channel stddev inside a quadrant; rejects flat fills. */
export const RACING_MATERIALS_MIN_VARIANCE = 6;

export interface RacingMaterialsPromptOptions {
  /** Immutable roster-wide art direction. */
  artDirection: string;
  /** Cup world concept: what these materials belong to. */
  worldConcept: string;
  /** Course environment context (envConcept plus which surfaces it implies). */
  envContext: string;
  /** Authored track-material hex palette for this course. */
  materials: { road: string; ground: string; curb: string; edge: string; pad: string };
  /** pads mode paints the boost tile from pad; pickups mode still needs it stored. */
  boostMode: 'pads' | 'pickups' | 'none';
  colors?: string;
  candidateId?: string;
  retryGuidance?: string;
}

function clean(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

/**
 * One opaque 2x2 top-down material sheet: road asphalt, offroad ground, curb
 * barrier, and boost-surface textures as four equal seamless tiles. Texture
 * character comes from the authored palette; the runtime keeps its own edge
 * markings and physical boundaries.
 */
export function buildRacingMaterialsPrompt(options: RacingMaterialsPromptOptions): string {
  const artDirection = clean(options.artDirection, 280);
  const world = clean(options.worldConcept, 280) ?? 'a distinctive hover-racing world';
  const env = clean(options.envContext, 280) ?? 'a distinctive racing locale';
  const colors = clean(options.colors, 300);
  const retry = clean(options.retryGuidance, 320);
  const m = options.materials;
  return [
    'Create exactly ONE top-down seamless material sheet: FOUR equal square texture tiles in a 2-by-2 grid, left to right, top to bottom: road surface, offroad ground, curb/barrier material, boost-surface material.',
    artDirection ? `IMMUTABLE ROSTER-WIDE ART DIRECTION: ${artDirection}` : '',
    `These materials belong to this world: ${world}. This course runs through ${env}: grow the road aggregate, ground grain, curb construction, and boost-surface treatment out of that locale.`,
    `Material palette roots: road ${clean(m.road, 7) ?? '#888888'}, offroad ground ${clean(m.ground, 7) ?? '#888888'}, curb ${clean(m.curb, 7) ?? '#888888'}, boost surface ${clean(m.pad, 7) ?? '#888888'}. Differentiate the four tiles through locale-grown grain, aggregate, tread, weave, or crystalline structure — never through flat recolors.`,
    colors ? `Use this limited game color direction with strong contrast: ${colors}.` : '',
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, no antialiasing, blur, gradients, or photorealism.',
    'Top-down orthographic texture swatches filling each quadrant edge to edge with wraparound-safe tiling. No perspective, horizon, text, letters, numbers, logos, watermark, signature, UI, border, lane lines, arrows, scenery, objects, vehicles, people, shading vignette, or frame.',
    'The image must be FULLY OPAQUE edge to edge: no transparency and no green screen of any kind.',
    options.candidateId ? `Generate independent materials candidate ${clean(options.candidateId, 12) ?? 'A'} for evaluation. Do not render this label.` : '',
    retry ? `ART DIRECTOR CORRECTION: ${retry}. Apply only this correction while preserving material identity, quadrant order, and pixel technique.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Per-quadrant texture variance from raw RGBA pixels. */
async function quadrantVariance(tile: Buffer, size: number): Promise<number> {
  const { data } = await sharp(tile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = size * size;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let pixel = 0; pixel < n; pixel++) {
    sr += data[pixel * 4]!;
    sg += data[pixel * 4 + 1]!;
    sb += data[pixel * 4 + 2]!;
  }
  const mr = sr / n;
  const mg = sg / n;
  const mb = sb / n;
  let vr = 0;
  let vg = 0;
  let vb = 0;
  for (let pixel = 0; pixel < n; pixel++) {
    vr += (data[pixel * 4]! - mr) ** 2;
    vg += (data[pixel * 4 + 1]! - mg) ** 2;
    vb += (data[pixel * 4 + 2]! - mb) ** 2;
  }
  return Math.sqrt((vr + vg + vb) / (3 * n));
}

/**
 * Normalize a generated material sheet to the fixed atlas: square opaque
 * input, quadrants resampled to runtime tiles with nearest sampling. A flat
 * quadrant (solid fill, no texture) fails instead of shipping.
 */
export async function processGeneratedRacingMaterials(image: Buffer): Promise<Buffer> {
  let metadata;
  try {
    metadata = await sharp(image).metadata();
  } catch (error) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing materials sheet is not decodable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height || width !== height || width < RACING_MATERIALS_SOURCE_MIN) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing materials sheet must be a square at least ${RACING_MATERIALS_SOURCE_MIN}px (got ${width}x${height})`,
    );
  }
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    if (data[pixel * 4 + 3]! < 250) {
      throw new FighterPoseImageError(
        'invalid-image',
        'racing materials sheet must be fully opaque (no transparency or green screen)',
      );
    }
  }
  const half = Math.floor(width / 2);
  const tiles: Buffer[] = [];
  for (const [index, slot] of RACING_MATERIAL_SLOTS.entries()) {
    const tile = await sharp(image)
      .extract({
        left: (index % 2) * half,
        top: Math.floor(index / 2) * half,
        width: half,
        height: half,
      })
      .resize(RACING_MATERIAL_TILE, RACING_MATERIAL_TILE, {
        fit: 'fill',
        kernel: sharp.kernel.nearest,
      })
      .png()
      .toBuffer();
    const variance = await quadrantVariance(tile, RACING_MATERIAL_TILE);
    if (variance < RACING_MATERIALS_MIN_VARIANCE) {
      throw new FighterPoseImageError(
        'invalid-image',
        `racing materials quadrant ${slot} is a flat fill, not a texture (variance ${variance.toFixed(1)})`,
      );
    }
    tiles.push(tile);
  }
  return sharp({
    create: {
      width: RACING_MATERIAL_ATLAS_SIZE,
      height: RACING_MATERIAL_ATLAS_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(
      (tiles as [Buffer, Buffer, Buffer, Buffer]).map((input, index) => ({
        input,
        left: (index % 2) * RACING_MATERIAL_TILE,
        top: Math.floor(index / 2) * RACING_MATERIAL_TILE,
      })),
    )
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

/** Fixed-geometry + opacity gate for a stored material atlas. */
export async function validateRacingMaterialAtlas(atlas: Buffer): Promise<void> {
  let metadata;
  try {
    metadata = await sharp(atlas).metadata();
  } catch (error) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing material atlas is not decodable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    metadata.format !== 'png' ||
    metadata.width !== RACING_MATERIAL_ATLAS_SIZE ||
    metadata.height !== RACING_MATERIAL_ATLAS_SIZE
  ) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing material atlas must be a ${RACING_MATERIAL_ATLAS_SIZE}x${RACING_MATERIAL_ATLAS_SIZE} PNG`,
    );
  }
  const { data, info } = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    if (data[pixel * 4 + 3]! < 250) {
      throw new FighterPoseImageError('invalid-image', 'racing material atlas must be fully opaque');
    }
  }
}
