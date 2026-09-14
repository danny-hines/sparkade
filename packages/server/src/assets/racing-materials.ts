import sharp from 'sharp';
import {
  RACING_MATERIAL_ATLAS_SIZE,
  RACING_MATERIAL_SLOTS,
  RACING_MATERIAL_TILE,
  type RacingSpec,
} from '@sparkade/shared';
import { FighterPoseImageError } from './fighter-pose';
import { GameAssetWorkspace, imagePromptHash } from './manifest';

export const RACING_MATERIALS_PROMPT_VERSION = 'racing-materials-v1';
/** Jetski materials fingerprint; hover keeps v1 byte-identical. */
export const RACING_JETSKI_MATERIALS_PROMPT_VERSION = 'racing-jetski-materials-v1';
/**
 * Jetski per-tile generation fingerprint. The single-sheet v1 prompt cannot
 * be trusted to honor a 2x2 grid (live attempt 4 painted one continuous
 * shoreline scene), so jetski tiles are generated independently and
 * assembled deterministically. Hover keeps the single-sheet path untouched.
 */
export const RACING_JETSKI_MATERIAL_TILES_VERSION = 'racing-jetski-material-tiles-v1';

export type RacingMaterialsDiscipline = 'hover' | 'jetski';
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
  /** Omitted (or 'hover') preserves the exact legacy asphalt/curb prompt. */
  discipline?: RacingMaterialsDiscipline;
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
  const jetski = options.discipline === 'jetski';
  const world =
    clean(options.worldConcept, 280) ??
    (jetski ? 'a distinctive jet-ski racing waterscape' : 'a distinctive hover-racing world');
  const env = clean(options.envContext, 280) ?? 'a distinctive racing locale';
  const colors = clean(options.colors, 300);
  const retry = clean(options.retryGuidance, 320);
  const m = options.materials;
  if (jetski) {
    return [
      'Create exactly ONE top-down seamless material sheet: FOUR equal square texture tiles in a 2-by-2 grid, left to right, top to bottom: open-water surface, shallows-bank water, shore-edge waterline, boost-surface water treatment.',
      artDirection ? `IMMUTABLE ROSTER-WIDE ART DIRECTION: ${artDirection}` : '',
      `These water materials belong to this world: ${world}. This course runs through ${env}: grow the water chop, shallows grain, shoreline waterline, and boost-surface treatment out of that locale.`,
      `Material palette roots: open water ${clean(m.road, 7) ?? '#888888'}, shallows bank ${clean(m.ground, 7) ?? '#888888'}, shore edge ${clean(m.curb, 7) ?? '#888888'}, boost surface ${clean(m.pad, 7) ?? '#888888'}. Differentiate the four tiles through locale-grown chop, foam, ripple, or sandy-shell structure — never through flat recolors.`,
      colors ? `Use this limited game color direction with strong contrast: ${colors}.` : '',
      'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, no antialiasing, blur, gradients, or photorealism.',
      'Top-down orthographic texture swatches filling each quadrant edge to edge with wraparound-safe tiling. No perspective, horizon, text, letters, numbers, logos, watermark, signature, UI, border, lane lines, asphalt stripes, curbs, guardrails, arrows, scenery, objects, vehicles, people, wakes, shading vignette, or frame.',
      'The image must be FULLY OPAQUE edge to edge: no transparency and no green screen of any kind.',
      options.candidateId ? `Generate independent materials candidate ${clean(options.candidateId, 12) ?? 'A'} for evaluation. Do not render this label.` : '',
      retry ? `ART DIRECTOR CORRECTION: ${retry}. Apply only this correction while preserving material identity, quadrant order, and pixel technique.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
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

/**
 * One independent top-down seamless texture tile per material slot, in
 * RACING_MATERIAL_SLOTS order (road, ground, curb, boost). Each prompt
 * fills its own frame edge to edge so grid compliance is structural — the
 * model can no longer smear one shoreline scene across quadrants.
 */
export function racingJetskiMaterialTilePrompts(spec: RacingSpec): string[] {
  const identity = spec.identity!;
  const subjects = [
    `open-water surface: rolling top-down water chop rooted at ${spec.levels[0]?.materials?.road ?? '#2fa8b8'}`,
    `shallows-bank water: pale rippled shallows with sandy grain rooted at ${spec.levels[0]?.materials?.ground ?? '#7fd4c1'}`,
    `shore-edge waterline: foamy waterline lace over sand rooted at ${spec.levels[0]?.materials?.curb ?? '#e8d8a0'}`,
    identity.boost.mode === 'pickups'
      ? `boost-surface water treatment: charged sparkling water carrying the ${identity.boost.displayName} energy`
      : `boost-surface water treatment: glowing water-lane treatment for the cup's boost supply`,
  ];
  return subjects.map((subject, index) =>
    [
      `Create exactly ONE square top-down seamless water texture tile filling the frame edge to edge: ${subject}. Tile ${index + 1} of 4 in the cup material atlas.`,
      `World identity: ${identity.worldConcept}. Art direction: ${identity.artDirection}. Palette: ${spec.palette.join(', ')}.`,
      'Orthographic top-down texture only, wraparound-safe tiling with matching left/right and top/bottom edges. No perspective, horizon, sky, shoreline scene, beach, text, letters, numbers, logos, watermark, signature, UI, border, lane lines, arrows, scenery, objects, vehicles, people, buoys, wakes, or frame.',
      'Crisp 16-bit pixel art, readable chop and grain with real per-pixel texture — never a flat recolor.',
      'The image must be FULLY OPAQUE edge to edge: no transparency and no green screen of any kind.',
    ].join(' '),
  );
}

/**
 * Normalize one generated jetski material tile: square opaque input of at
 * least RACING_MATERIALS_SOURCE_MIN, resampled to the runtime tile with
 * nearest sampling. A flat tile (solid fill, no texture) fails instead of
 * shipping — same gate as the sheet quadrants.
 */
export async function normalizeRacingJetskiMaterialTile(
  raw: Buffer,
  slot: string,
): Promise<Buffer> {
  let metadata;
  try {
    metadata = await sharp(raw).metadata();
  } catch (error) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing jetski material tile ${slot} is not decodable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height || width !== height || width < RACING_MATERIALS_SOURCE_MIN) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing jetski material tile ${slot} must be a square at least ${RACING_MATERIALS_SOURCE_MIN}px (got ${width}x${height})`,
    );
  }
  const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    if (data[pixel * 4 + 3]! < 250) {
      throw new FighterPoseImageError(
        'invalid-image',
        `racing jetski material tile ${slot} must be fully opaque (no transparency or green screen)`,
      );
    }
  }
  const tile = await sharp(raw)
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
      `racing jetski material tile ${slot} is a flat fill, not a texture (variance ${variance.toFixed(1)})`,
    );
  }
  return tile;
}

/**
 * Deterministic 2x2 assembly of four normalized tiles in
 * RACING_MATERIAL_SLOTS order. Same fixed geometry and encoding as the
 * sheet path, so the stored-atlas validator cannot tell them apart.
 */
export async function assembleRacingJetskiMaterialAtlas(
  tiles: readonly [Buffer, Buffer, Buffer, Buffer],
): Promise<Buffer> {
  return sharp({
    create: {
      width: RACING_MATERIAL_ATLAS_SIZE,
      height: RACING_MATERIAL_ATLAS_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(
      tiles.map((input, index) => ({
        input,
        left: (index % 2) * RACING_MATERIAL_TILE,
        top: Math.floor(index / 2) * RACING_MATERIAL_TILE,
      })),
    )
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

/**
 * Jetski material pack: four independent tile generations drained together,
 * normalized through the same gates as the sheet quadrants, assembled
 * locally into the fixed atlas. Mirrors generateRacingSceneryPack: the
 * finished atlas is cached under the tiles version plus the combined
 * prompt hash, so a retry after success is free. Tile intermediates are
 * intentionally not checkpointed (no spare private roles exist) — a failed
 * attempt regenerates at most 4 tiles x 2 tries, still bounded.
 */
export async function generateRacingJetskiMaterialsPack(options: {
  spec: RacingSpec;
  workspace: GameAssetWorkspace;
  generate(prompt: string, slot: number): Promise<Buffer>;
  checkActive(): void;
  validationFailure(role: string): void;
}): Promise<Buffer> {
  const { workspace } = options;
  const prompts = racingJetskiMaterialTilePrompts(options.spec);
  const hash = imagePromptHash(JSON.stringify(prompts));
  const cached = workspace.load('racingMaterialAtlas', RACING_JETSKI_MATERIAL_TILES_VERSION, hash);
  if (cached) return cached;
  // Drain failures before reporting them: no generation remains in flight on retry.
  const outcomes = await Promise.allSettled(
    prompts.map(async (prompt, index) => {
      const slot = RACING_MATERIAL_SLOTS[index]!;
      for (let attempt = 0; attempt < 2; attempt++) {
        options.checkActive();
        const raw = await options.generate(
          prompt +
            (attempt
              ? ' CORRECTION: one seamless texture tile only, filling the frame edge to edge with real grain, no scene.'
              : ''),
          index,
        );
        try {
          return await normalizeRacingJetskiMaterialTile(raw, slot);
        } catch (error) {
          options.checkActive();
          options.validationFailure(`racing-material-tile-${slot}`);
          if (attempt === 1) throw error;
        }
      }
      throw new Error(`Missing material tile ${slot}`);
    }),
  );
  const failed = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failed?.status === 'rejected') {
    throw failed.reason;
  }
  const tiles = outcomes.map(
    (outcome) => (outcome as PromiseFulfilledResult<Buffer>).value,
  ) as unknown as [Buffer, Buffer, Buffer, Buffer];
  const atlas = await assembleRacingJetskiMaterialAtlas(tiles);
  await workspace.store('racingMaterialAtlas', atlas, RACING_JETSKI_MATERIAL_TILES_VERSION, hash);
  return atlas;
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
