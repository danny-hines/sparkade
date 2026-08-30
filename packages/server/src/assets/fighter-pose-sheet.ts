import sharp from 'sharp';
import type { FighterPose } from '@sparkade/shared';
import {
  GENERATED_FIGHTER_POSE_DIRECTIONS,
  isFighterGreenScreenPixel,
  processGeneratedFighterPose,
  type FighterPoseImageMetrics,
  type FighterPosePromptOptions,
  type GeneratedFighterPose,
} from './fighter-pose';

export const FIGHTER_POSE_SHEET_PROMPT_VERSION = 'fighter-pose-sheet-v2';
export const FIGHTER_POSE_SHEET_SIZE = 1024;
export const FIGHTER_POSE_SHEET_COLUMNS = 3;
export const FIGHTER_POSE_SHEET_ROWS = 2;
/** A pose may cross its nominal cell edge by this many source pixels. Pixels
 * remain owned by their full-sheet foreground component, not by the hard grid. */
export const FIGHTER_POSE_SHEET_BLEED_TOLERANCE = 64;
export const FIGHTER_POSE_SHEET_RECOVERY_GUIDANCE =
  'The grouped sheet cell failed deterministic extraction. Return one complete uncropped silhouette on perfectly uniform #00ff00 and make the requested pose unmistakable.';
export const FIGHTER_POSE_SHEET_RECOVERY_ATTEMPTS = [
  {
    suffix: 'A2',
    guidance: FIGHTER_POSE_SHEET_RECOVERY_GUIDANCE,
  },
  {
    suffix: 'A3',
    guidance: `${FIGHTER_POSE_SHEET_RECOVERY_GUIDANCE} The previous isolated repair also failed. Simplify the silhouette and keep any defeat or reaction state clearly non-violent, peaceful, uninjured, and free of wounds, blood, bruises, impact marks, or distress.`,
  },
] as const;

export type FighterPoseSheetGroupId = 'mobility' | 'attacks';

export interface FighterPoseSheetGroup {
  id: FighterPoseSheetGroupId;
  label: string;
  poses: readonly [
    GeneratedFighterPose,
    GeneratedFighterPose,
    GeneratedFighterPose,
    GeneratedFighterPose,
    GeneratedFighterPose,
    GeneratedFighterPose,
  ];
}

export const FIGHTER_POSE_SHEET_GROUPS: readonly FighterPoseSheetGroup[] = [
  {
    id: 'mobility',
    label: 'Mobility, defense, and reactions',
    poses: ['walk', 'crouch', 'jump', 'block', 'hit', 'ko'],
  },
  {
    id: 'attacks',
    label: 'Ground and aerial attacks',
    poses: ['punchHigh', 'punchLow', 'kickHigh', 'kickLow', 'airPunch', 'airKick'],
  },
] as const;

export interface FighterPoseSheetCellRect {
  index: number;
  row: number;
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FighterPoseSheetCellResult {
  id: string;
  pose: GeneratedFighterPose;
  rect: FighterPoseSheetCellRect;
  raw: Buffer;
  processed?: Buffer;
  metrics?: FighterPoseImageMetrics;
  segmentation: FighterPoseSheetSegmentationMetrics;
  error?: string;
}

export interface FighterPoseSheetSegmentationMetrics {
  ownedComponentCount: number;
  reclaimedBleedPixels: number;
  excludedNeighborPixels: number;
  bleed: { left: number; top: number; right: number; bottom: number };
}

function clean(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 500) : null;
}

export function fighterPoseSheetCellRect(index: number): FighterPoseSheetCellRect {
  if (!Number.isInteger(index) || index < 0 || index >= 6) {
    throw new RangeError('fighter pose sheet cell index must be between 0 and 5');
  }
  const column = index % FIGHTER_POSE_SHEET_COLUMNS;
  const row = Math.floor(index / FIGHTER_POSE_SHEET_COLUMNS);
  const left = Math.floor((column * FIGHTER_POSE_SHEET_SIZE) / FIGHTER_POSE_SHEET_COLUMNS);
  const right = Math.floor(((column + 1) * FIGHTER_POSE_SHEET_SIZE) / FIGHTER_POSE_SHEET_COLUMNS);
  const top = Math.floor((row * FIGHTER_POSE_SHEET_SIZE) / FIGHTER_POSE_SHEET_ROWS);
  const bottom = Math.floor(((row + 1) * FIGHTER_POSE_SHEET_SIZE) / FIGHTER_POSE_SHEET_ROWS);
  return { index, row, column, left, top, width: right - left, height: bottom - top };
}

/** Tile one selected identity into the exact board geometry Muse must preserve.
 * Repeating the same normalized seed gives every edit cell direct identity,
 * costume, scale, facing, and grounding evidence. */
export async function buildFighterPoseSheetSeed(identityAnchor: Buffer): Promise<Buffer> {
  const first = fighterPoseSheetCellRect(0);
  const inset = 14;
  const identity = await processGeneratedFighterPose(identityAnchor, {
    width: first.width - inset * 2,
    height: first.height - inset * 2,
    padding: 12,
    bottomPadding: 12,
    colors: 256,
    removeGreenSpill: true,
  });
  const overlays = Array.from({ length: 6 }, (_, index): sharp.OverlayOptions => {
    const rect = fighterPoseSheetCellRect(index);
    return { input: identity.png, left: rect.left + inset, top: rect.top + inset };
  });
  return sharp({
    create: {
      width: FIGHTER_POSE_SHEET_SIZE,
      height: FIGHTER_POSE_SHEET_SIZE,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(overlays)
    .png()
    .toBuffer();
}

export function buildFighterPoseSheetPrompt(
  group: FighterPoseSheetGroup,
  options: FighterPosePromptOptions = {},
): string {
  const identity = clean(options.identity);
  const outfit = clean(options.outfit);
  const colors = clean(options.colors);
  const candidateId = clean(options.candidateId) ?? group.id;
  const cells = group.poses
    .map(
      (pose, index) =>
        `Cell ${index + 1} (row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}) — ${pose}: ${GENERATED_FIGHTER_POSE_DIRECTIONS[pose]}.`,
    )
    .join(' ');
  return [
    `FIGHTER POSE SHEET CONTRACT: ${group.id} [${group.poses.join(',')}].`,
    `Edit the attached fixed 3-column by 2-row board into exactly SIX isolated full-body fighting-game sprites of the same character, candidate ${candidateId}.`,
    'The attached board already repeats the exact identity once in every cell. Preserve the cell boundaries, character identity, face, hair, costume construction, colors, body proportions, right-facing direction, scale, and ground line.',
    identity ? `Identity details to retain in every cell: ${identity}.` : '',
    outfit ? `Costume direction shared by every cell: ${outfit}.` : '',
    colors ? `Costume colors shared by every cell: ${colors}.` : '',
    `Use this exact row-major order and do not swap, omit, duplicate, or merge states. ${cells}`,
    'Keep one and only one complete character inside each cell with generous green clearance on every edge. No body part may cross into another cell.',
    'Every background pixel, every gutter, and every gap enclosed by the body must remain perfectly flat solid #00ff00. Do not draw grid lines, borders, labels, text, letters, numbers, UI, scenery, floor, shadows, effects, props, or weapons.',
    'Use polished native 16-bit SNES arcade-fighter pixel art with crisp square clusters, hard edges, limited flat colors, expressive faces, and readable silhouettes. No blur, antialiasing, gradients, photorealism, or style changes between cells.',
  ]
    .filter(Boolean)
    .join(' ');
}

interface SheetForegroundComponent {
  id: number;
  pixels: number[];
  overlaps: [number, number, number, number, number, number];
  bounds: FighterPoseSheetCellRect;
  centerX: number;
  centerY: number;
  owner: number;
}

function sheetCellAt(x: number, y: number): number {
  const column = Math.min(
    FIGHTER_POSE_SHEET_COLUMNS - 1,
    Math.floor((x * FIGHTER_POSE_SHEET_COLUMNS) / FIGHTER_POSE_SHEET_SIZE),
  );
  const row = Math.min(
    FIGHTER_POSE_SHEET_ROWS - 1,
    Math.floor((y * FIGHTER_POSE_SHEET_ROWS) / FIGHTER_POSE_SHEET_SIZE),
  );
  return row * FIGHTER_POSE_SHEET_COLUMNS + column;
}

function sheetForegroundComponents(
  data: Buffer,
  width: number,
  height: number,
): { components: SheetForegroundComponent[]; componentAt: Int32Array } {
  const pixelCount = width * height;
  const componentAt = new Int32Array(pixelCount);
  componentAt.fill(-1);
  const seen = new Uint8Array(pixelCount);
  const stack: number[] = [];
  const components: SheetForegroundComponent[] = [];
  const isForeground = (pixel: number): boolean => {
    const offset = pixel * 4;
    return (
      data[offset + 3]! > 8 &&
      !isFighterGreenScreenPixel(data[offset]!, data[offset + 1]!, data[offset + 2]!)
    );
  };

  for (let start = 0; start < pixelCount; start++) {
    if (seen[start] || !isForeground(start)) continue;
    const id = components.length;
    seen[start] = 1;
    stack.push(start);
    const pixels: number[] = [];
    const overlaps: SheetForegroundComponent['overlaps'] = [0, 0, 0, 0, 0, 0];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;
    while (stack.length) {
      const pixel = stack.pop()!;
      componentAt[pixel] = id;
      pixels.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const cell = sheetCellAt(x, y);
      overlaps[cell] = (overlaps[cell] ?? 0) + 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || !isForeground(next)) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    const maxOverlap = Math.max(...overlaps);
    const possibleOwners = overlaps.flatMap((count, index) =>
      count === maxOverlap ? [index] : [],
    );
    let owner = possibleOwners[0] ?? 0;
    if (possibleOwners.length > 1) {
      owner = sheetCellAt(sumX / pixels.length, sumY / pixels.length);
    }
    components.push({
      id,
      pixels,
      overlaps,
      bounds: {
        index: id,
        row: 0,
        column: 0,
        left: minX,
        top: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
      centerX: sumX / pixels.length,
      centerY: sumY / pixels.length,
      owner,
    });
  }
  return { components, componentAt };
}

function componentBleed(
  bounds: FighterPoseSheetCellRect,
  rect: FighterPoseSheetCellRect,
): FighterPoseSheetSegmentationMetrics['bleed'] {
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  return {
    left: Math.max(0, rect.left - bounds.left),
    top: Math.max(0, rect.top - bounds.top),
    right: Math.max(0, right - (rect.left + rect.width)),
    bottom: Math.max(0, bottom - (rect.top + rect.height)),
  };
}

async function buildOwnedSheetCell(
  data: Buffer,
  componentAt: Int32Array,
  components: readonly SheetForegroundComponent[],
  index: number,
): Promise<{ raw: Buffer; segmentation: FighterPoseSheetSegmentationMetrics; overflow: boolean }> {
  const rect = fighterPoseSheetCellRect(index);
  const tolerance = FIGHTER_POSE_SHEET_BLEED_TOLERANCE;
  const width = rect.width + tolerance * 2;
  const height = rect.height + tolerance * 2;
  const owned = components
    .filter(({ owner }) => owner === index)
    .sort((a, b) => b.overlaps[index]! - a.overlaps[index]!);
  const primary = owned[0];
  const bleed = primary
    ? componentBleed(primary.bounds, rect)
    : { left: 0, top: 0, right: 0, bottom: 0 };
  const overflow = Object.values(bleed).some((value) => value > tolerance);
  const ownedIds = new Set(owned.map(({ id }) => id));
  const raw = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    raw[offset + 1] = 255;
    raw[offset + 3] = 255;
  }

  let reclaimedBleedPixels = 0;
  for (const component of owned) {
    for (const pixel of component.pixels) {
      const x = pixel % FIGHTER_POSE_SHEET_SIZE;
      const y = Math.floor(pixel / FIGHTER_POSE_SHEET_SIZE);
      const localX = x - rect.left + tolerance;
      const localY = y - rect.top + tolerance;
      if (localX < 0 || localX >= width || localY < 0 || localY >= height) continue;
      const sourceOffset = pixel * 4;
      const targetOffset = (localY * width + localX) * 4;
      data.copy(raw, targetOffset, sourceOffset, sourceOffset + 4);
      if (
        x < rect.left ||
        x >= rect.left + rect.width ||
        y < rect.top ||
        y >= rect.top + rect.height
      ) {
        reclaimedBleedPixels++;
      }
    }
  }

  let excludedNeighborPixels = 0;
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) {
      const component = componentAt[y * FIGHTER_POSE_SHEET_SIZE + x]!;
      if (component >= 0 && !ownedIds.has(component)) excludedNeighborPixels++;
    }
  }

  return {
    raw: await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    segmentation: {
      ownedComponentCount: owned.length,
      reclaimedBleedPixels,
      excludedNeighborPixels,
      bleed,
    },
    overflow,
  };
}

/** Split at deterministic coordinates and validate every crop independently.
 * Full-sheet components own their pixels even across a nearby grid boundary;
 * callers retain valid cells and repair only rejected poses. */
export async function splitGeneratedFighterPoseSheet(
  image: Buffer,
  group: FighterPoseSheetGroup,
): Promise<FighterPoseSheetCellResult[]> {
  const normalized = await sharp(image)
    .rotate()
    .resize(FIGHTER_POSE_SHEET_SIZE, FIGHTER_POSE_SHEET_SIZE, {
      fit: 'fill',
      kernel: sharp.kernel.nearest,
    })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { components, componentAt } = sheetForegroundComponents(
    normalized.data,
    normalized.info.width,
    normalized.info.height,
  );
  return Promise.all(
    group.poses.map(async (pose, index): Promise<FighterPoseSheetCellResult> => {
      const rect = fighterPoseSheetCellRect(index);
      const owned = await buildOwnedSheetCell(normalized.data, componentAt, components, index);
      const raw = owned.raw;
      const id = `${pose}-S`;
      if (owned.overflow) {
        return {
          id,
          pose,
          rect,
          raw,
          segmentation: owned.segmentation,
          error: `owned fighter exceeds the ${FIGHTER_POSE_SHEET_BLEED_TOLERANCE}px sheet-cell bleed tolerance`,
        };
      }
      try {
        const processed = await processGeneratedFighterPose(raw, {
          removeGreenSpill: true,
          isolatePrimarySubject: true,
        });
        return {
          id,
          pose,
          rect,
          raw,
          processed: processed.png,
          metrics: processed.metrics,
          segmentation: owned.segmentation,
        };
      } catch (error) {
        return {
          id,
          pose,
          rect,
          raw,
          segmentation: owned.segmentation,
          error: error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800),
        };
      }
    }),
  );
}

export function actionPosesFromSheets(): readonly FighterPose[] {
  return FIGHTER_POSE_SHEET_GROUPS.flatMap(({ poses }) => poses);
}

/** Try each rejected cell independently. A provider or local-validation miss
 * on A2 gets one policy-safe A3 attempt; successful cells never spend A3. */
export async function recoverRejectedFighterSheetCells<T>(
  poses: readonly GeneratedFighterPose[],
  generate: (
    pose: GeneratedFighterPose,
    suffix: (typeof FIGHTER_POSE_SHEET_RECOVERY_ATTEMPTS)[number]['suffix'],
    guidance: string,
  ) => Promise<T | null>,
): Promise<Awaited<T>[]> {
  const recovered = await Promise.all(
    poses.map(async (pose): Promise<T | null> => {
      for (const attempt of FIGHTER_POSE_SHEET_RECOVERY_ATTEMPTS) {
        const candidate = await generate(pose, attempt.suffix, attempt.guidance);
        if (candidate) return candidate;
      }
      return null;
    }),
  );
  const valid: Awaited<T>[] = [];
  for (const candidate of recovered) {
    if (candidate !== null) valid.push(candidate);
  }
  return valid;
}
