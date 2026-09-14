import sharp from 'sharp';
import { splitRacingStripCells } from './racing-craft';
import {
  RACING_PANORAMA_HEIGHT,
  RACING_PANORAMA_WIDTH,
  RACING_SCENERY_ATLAS_HEIGHT,
  RACING_SCENERY_ATLAS_WIDTH,
  RACING_SCENERY_CELL,
  RACING_SCENERY_CELLS,
  RACING_SCENERY_COLUMNS,
  RACING_SCENERY_SLOTS,
  type RacingScenerySlot,
} from '@sparkade/shared';
import {
  FighterPoseImageError,
  isFighterGreenScreenPixel,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const RACING_PANORAMA_PROMPT_VERSION = 'racing-panorama-v3';
/** Generated plates at least this wide are accepted and cover-cropped. */
export const RACING_PANORAMA_MIN_ASPECT = 1.6;
export const RACING_SCENERY_PROMPT_VERSION = 'racing-scenery-atlas-v2';
/** Accepted generated-sheet aspect window around the 3:2 slot grid. */
export const RACING_SCENERY_SHEET_ASPECT_MIN = 1.2;
export const RACING_SCENERY_SHEET_ASPECT_MAX = 1.8;
export const RACING_SCENERY_SHEET_MIN_WIDTH = 300;

export interface RacingPanoramaPromptOptions {
  courseName: string;
  /** Immutable roster-wide art direction. */
  artDirection: string;
  /** Cup world concept shared by all three panoramas. */
  worldConcept: string;
  /** Per-course environment concept for this race index. */
  envConcept: string;
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
 * One opaque wide panorama: the distant world ABOVE the road horizon for a
 * single cup race. Never paint anything the runtime owns or places.
 */
export function buildRacingPanoramaPrompt(options: RacingPanoramaPromptOptions): string {
  const course = clean(options.courseName, 24) ?? 'Course';
  const artDirection = clean(options.artDirection, 280);
  const world = clean(options.worldConcept, 280) ?? 'a distinctive hover-racing world';
  const env = clean(options.envConcept, 280) ?? 'a distinctive racing locale';
  const colors = clean(options.colors, 300);
  const retry = clean(options.retryGuidance, 320);
  return [
    `Create exactly ONE wide panoramic backdrop for the hover-cup course ${course}: the distant world seen ABOVE the road horizon. Camera looks toward the horizon at eye level; sky, far ridgelines, and landmark silhouettes fill the frame.`,
    artDirection ? `IMMUTABLE ROSTER-WIDE ART DIRECTION: ${artDirection}` : '',
    `World identity: ${world}. This course locale: ${env}. Root every shape and color in that locale, distinct from the other two cup courses.`,
    colors ? `Use this limited game color direction with strong contrast: ${colors}.` : '',
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, no antialiasing, blur, gradients, or photorealism.',
    'This is a distant-world panorama plate, NOT a screenshot, race scene, map, diagram, turnaround, collage, or story illustration. No painted road, track, lane, vehicle, craft, person, pilot, face, crowd, building interior, HUD, text, letters, numbers, logo, watermark, signature, UI, border, or frame.',
    'Composition: distinctive skyline and landmarks must fill the lower two thirds, with a modest sky band above. This will be cropped to a very wide 3.2:1 strip anchored at the BOTTOM; do not put all world detail in a tiny strip at the bottom or leave the center as empty sky.',
    'The image must be a FULLY OPAQUE painting edge to edge: sky meets land across the whole frame with no transparency, no solid-color backdrop, and no green screen of any kind.',
    options.candidateId
      ? `Generate independent panorama candidate ${clean(options.candidateId, 12) ?? 'A'} for evaluation. Do not render this label.`
      : '',
    retry
      ? `ART DIRECTOR CORRECTION: ${retry}. Apply only this correction while preserving world identity, locale, and pixel technique.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export type RacingBoostSlotKind = 'collectible' | 'padTrim' | 'landmark';

export interface RacingSceneryPromptOptions {
  /** Immutable roster-wide art direction. */
  artDirection: string;
  /** Cup world concept the model invents scenery from. */
  worldConcept: string;
  /** Boost slot in pickups mode: the named bankable collectible. */
  boostDisplayName?: string;
  boostAppearanceConcept?: string;
  /** pickups = collectible object; pads = themed pad trim; none = landmark. */
  boostSlot: RacingBoostSlotKind;
  colors?: string;
  candidateId?: string;
  retryGuidance?: string;
}

/**
 * One 6-slot roadside atlas sheet: two large landmarks, three small dressing
 * objects, and the boost slot — each isolated on green in a 3x2 grid, left
 * to right, top to bottom. The model invents premise-relevant scenery; the
 * fixed scenery families (posts/pines/crystals) are never mentioned.
 */
export function buildRacingSceneryPrompt(options: RacingSceneryPromptOptions): string {
  const artDirection = clean(options.artDirection, 280);
  const world = clean(options.worldConcept, 280) ?? 'a distinctive hover-racing world';
  const colors = clean(options.colors, 300);
  const retry = clean(options.retryGuidance, 320);
  const boostCell =
    options.boostSlot === 'collectible'
      ? `Slot 6 (bottom-right) is the bankable boost collectible ${clean(options.boostDisplayName, 24) ?? 'cell'}: ${clean(options.boostAppearanceConcept, 280) ?? 'a small floating energy object the craft flies through'}. It must read as one grabbable object at distance.`
      : options.boostSlot === 'padTrim'
        ? 'Slot 6 (bottom-right) is a piece of themed boost-pad track trim: a flat decorative chevron plate that lies on the road surface, no floating object.'
        : 'Slot 6 (bottom-right) is a third landmark in the same world language: no collectible, no track trim, nothing boost-shaped.';
  return [
    'Create exactly ONE roadside-object sheet: SIX isolated objects on green in a 3-by-2 grid, left to right, top to bottom. Slots 1-2 are LARGE landmarks, slots 3-5 are SMALL dressing objects.',
    boostCell,
    artDirection ? `IMMUTABLE ROSTER-WIDE ART DIRECTION: ${artDirection}` : '',
    `Invent every object from this world, never from a scenery menu: ${world}. All six share one material and silhouette language.`,
    colors ? `Use this limited game color direction with strong contrast: ${colors}.` : '',
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, no antialiasing, blur, gradients, or photorealism.',
    'This is an object sheet, NOT a scene, screenshot, turnaround, sequence, collage, story illustration, map, or icon set. No vehicle, craft, person, pilot, face, text, letters, numbers, logo, watermark, signature, UI, border, scenery backdrop, floor, or shadow under the objects.',
    'Each object must be complete, centered in its own grid cell, and fully visible. Keep generous green margins around the image and between every row and column, at least 15% of each cell. Nothing may be cropped and objects must not touch or overlap.',
    'The entire empty background, including every gap around or enclosed by each silhouette, must be perfectly flat solid #00ff00. No object may use #00ff00 or a near-neon imitation; darker natural greens are allowed.',
    options.candidateId
      ? `Generate independent sheet candidate ${clean(options.candidateId, 12) ?? 'A'} for evaluation. Do not render this label.`
      : '',
    retry
      ? `ART DIRECTOR CORRECTION: ${retry}. Apply only this correction while preserving world identity, object layout, and pixel technique.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Normalize one opaque generated panorama to fixed runtime geometry. */
export async function processGeneratedRacingPanorama(image: Buffer): Promise<Buffer> {
  let metadata;
  try {
    metadata = await sharp(image).metadata();
  } catch (error) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing panorama is not decodable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    throw new FighterPoseImageError('invalid-image', 'racing panorama has no dimensions');
  }
  const aspect = width / height;
  if (aspect < RACING_PANORAMA_MIN_ASPECT) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing panorama must be genuinely wide (at least ${RACING_PANORAMA_MIN_ASPECT}:1, got ${width}x${height})`,
    );
  }
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    if (data[pixel * 4 + 3]! < 250) {
      throw new FighterPoseImageError(
        'invalid-image',
        'racing panorama must be fully opaque (no transparency or green screen)',
      );
    }
  }
  // Anchor at the horizon-bearing bottom: center cropping removes the
  // skyline from ordinary provider-native 2:1 panoramas.
  return sharp(image)
    .resize(RACING_PANORAMA_WIDTH, RACING_PANORAMA_HEIGHT, {
      fit: 'cover',
      position: 'south',
      kernel: sharp.kernel.nearest,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

/** Fixed-geometry + opacity gate for a stored panorama. */
export async function validateRacingPanorama(panorama: Buffer): Promise<void> {
  let metadata;
  try {
    metadata = await sharp(panorama).metadata();
  } catch (error) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing panorama is not decodable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    metadata.format !== 'png' ||
    metadata.width !== RACING_PANORAMA_WIDTH ||
    metadata.height !== RACING_PANORAMA_HEIGHT
  ) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing panorama must be a ${RACING_PANORAMA_WIDTH}x${RACING_PANORAMA_HEIGHT} PNG`,
    );
  }
  const { data, info } = await sharp(panorama)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    if (data[pixel * 4 + 3]! < 250) {
      throw new FighterPoseImageError('invalid-image', 'racing panorama must be fully opaque');
    }
  }
}

export interface ProcessedRacingSceneryAtlas {
  /** Per-slot normalized cells in atlas order. */
  slots: Record<RacingScenerySlot, ProcessedFighterPose>;
  /** Assembled fixed-geometry atlas PNG. */
  png: Buffer;
}

/**
 * Split a generated 3x2 sheet, key and normalize every slot independently,
 * and assemble the fixed atlas. A missing, cropped, or merged slot fails the
 * sheet; slots are never synthesized from each other.
 */
export async function processGeneratedRacingSceneryAtlas(
  image: Buffer,
): Promise<ProcessedRacingSceneryAtlas> {
  const metadata = await sharp(image)
    .metadata()
    .catch((error) => {
      throw new FighterPoseImageError(
        'invalid-image',
        `racing scenery sheet is not decodable: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height || width < RACING_SCENERY_SHEET_MIN_WIDTH) {
    throw new FighterPoseImageError('invalid-image', 'racing scenery sheet is too small to split');
  }
  const aspect = width / height;
  if (aspect < RACING_SCENERY_SHEET_ASPECT_MIN || aspect > RACING_SCENERY_SHEET_ASPECT_MAX) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing scenery sheet must be roughly 3:2 (got ${width}x${height})`,
    );
  }
  // Landmark heights vary. Locate the real horizontal gap before splitting
  // each row at its own vertical gaps; one global grid can cut complete art.
  const { data } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const greenRows = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let green = 0;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (data[o + 3]! <= 8 || isFighterGreenScreenPixel(data[o]!, data[o + 1]!, data[o + 2]!))
        green++;
    }
    greenRows[y] = green / width;
  }
  const lo = Math.floor(height * 0.35),
    hi = Math.ceil(height * 0.65);
  let clearest = 0;
  for (let y = lo; y <= hi; y++) clearest = Math.max(clearest, greenRows[y]!);
  if (clearest < 0.98)
    throw new FighterPoseImageError(
      'multiple-subjects',
      'racing scenery rows are merged without a clear gap',
    );
  let bestStart = lo,
    bestLength = 0,
    runStart = -1;
  for (let y = lo; y <= hi + 1; y++) {
    if (y <= hi && greenRows[y]! >= clearest - 0.5 / width) {
      if (runStart < 0) runStart = y;
    } else if (runStart >= 0) {
      const span = y - runStart;
      if (
        span > bestLength ||
        (span === bestLength &&
          Math.abs(runStart + span / 2 - height / 2) <
            Math.abs(bestStart + bestLength / 2 - height / 2))
      ) {
        bestStart = runStart;
        bestLength = span;
      }
      runStart = -1;
    }
  }
  const cut = Math.floor(bestStart + bestLength / 2),
    overlap = Math.ceil(height * 0.025);
  const cells: Buffer[] = [];
  for (const [top, bottom] of [
    [0, cut + overlap],
    [cut - overlap, height],
  ]) {
    const row = await sharp(image)
      .extract({ left: 0, top: top!, width, height: bottom! - top! })
      .png()
      .toBuffer();
    cells.push(...(await splitRacingStripCells(row)).cells);
  }
  const slots = {} as Record<RacingScenerySlot, ProcessedFighterPose>;
  for (const [index, slot] of RACING_SCENERY_SLOTS.entries()) {
    const cell = cells[index]!;
    const cellMeta = await sharp(cell).metadata();
    const cellWidth = cellMeta.width!,
      cellHeight = cellMeta.height!;
    const processed = await processGeneratedFighterPose(cell, {
      width: RACING_SCENERY_CELL,
      height: RACING_SCENERY_CELL,
      padding: 6,
      bottomPadding: 6,
      removeGreenSpill: true,
      isolatePrimarySubject: true,
      colors: 40,
      minSubjectFraction: 0.015,
      maxSubjectFraction: 0.8,
      minSubjectSpanFraction: 0.1,
    }).catch((error) => {
      if (error instanceof FighterPoseImageError) {
        throw new FighterPoseImageError(
          error.code,
          `generated racing scenery slot ${slot} rejected: ${error.message}`,
        );
      }
      throw error;
    });
    const b = processed.metrics.sourceBounds;
    if (
      b.left <= 1 ||
      b.top <= 1 ||
      b.left + b.width >= cellWidth - 1 ||
      b.top + b.height >= cellHeight - 1
    ) {
      throw new FighterPoseImageError(
        'inconsistent-scale',
        `generated racing scenery slot ${slot} is cropped by its sheet cell`,
      );
    }
    slots[slot] = processed;
  }
  const png = await sharp({
    create: {
      width: RACING_SCENERY_ATLAS_WIDTH,
      height: RACING_SCENERY_ATLAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      RACING_SCENERY_SLOTS.map((slot, index) => ({
        input: slots[slot]!.png,
        left: (index % RACING_SCENERY_COLUMNS) * RACING_SCENERY_CELL,
        top: Math.floor(index / RACING_SCENERY_COLUMNS) * RACING_SCENERY_CELL,
      })),
    )
    .png({ palette: true, colours: 256, dither: 0, compressionLevel: 9 })
    .toBuffer();
  return { slots, png };
}

/** Fixed-geometry gate for a stored scenery atlas. */
export async function validateRacingSceneryAtlas(atlas: Buffer): Promise<void> {
  let metadata;
  try {
    metadata = await sharp(atlas).metadata();
  } catch (error) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing scenery atlas is not decodable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    metadata.format !== 'png' ||
    metadata.width !== RACING_SCENERY_ATLAS_WIDTH ||
    metadata.height !== RACING_SCENERY_ATLAS_HEIGHT
  ) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing scenery atlas must be a ${RACING_SCENERY_ATLAS_WIDTH}x${RACING_SCENERY_ATLAS_HEIGHT} PNG`,
    );
  }
  if (RACING_SCENERY_SLOTS.length !== RACING_SCENERY_CELLS) {
    throw new FighterPoseImageError('invalid-image', 'racing scenery slot contract drifted');
  }
}
