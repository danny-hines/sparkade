import sharp from 'sharp';
import {
  platformerReachabilityBlockage,
  reachableCells,
} from '@sparkade/archetypes';
import type {
  Coord,
  PlatformerEntity,
  PlatformerLevel,
  PlatformerTileType,
} from '@sparkade/shared';

export const PLATFORMER_LEVEL_LAB_PROMPT_VERSION = 'platformer-level-layout-v1';
export const PLATFORMER_LEVEL_HYDRATION_PROMPT_VERSION = 'platformer-level-hydration-v2';
export const PLATFORMER_LEVEL_LAB_WIDTH = 96;
export const PLATFORMER_LEVEL_LAB_HEIGHT = 18;
export const PLATFORMER_LEVEL_LAB_TILE_SIZE = 16;
export const PLATFORMER_LEVEL_LAB_IMAGE_WIDTH =
  PLATFORMER_LEVEL_LAB_WIDTH * PLATFORMER_LEVEL_LAB_TILE_SIZE;
export const PLATFORMER_LEVEL_LAB_IMAGE_HEIGHT =
  PLATFORMER_LEVEL_LAB_HEIGHT * PLATFORMER_LEVEL_LAB_TILE_SIZE;

export const PLATFORMER_LEVEL_LAB_COLORS = {
  empty: '#ffffff',
  solid: '#000000',
  platform: '#0055ff',
  hazard: '#ff2020',
  coin: '#16d94b',
  powerup: '#19dce8',
  checkpoint: '#a855f7',
  spawn: '#facc15',
  exit: '#ff7a00',
  frame: '#888888',
} as const;

export type PlatformerLevelLabCell = keyof typeof PLATFORMER_LEVEL_LAB_COLORS;

export interface PlatformerLevelLabMetrics {
  registration: 'frame' | 'content';
  crop: { left: number; top: number; width: number; height: number };
  confidentCellRatio: number;
  meanWinnerShare: number;
  meanColorDistance: number;
  changedCells: number;
  repairs: string[];
  issuesBefore: string[];
  issuesAfter: string[];
  reachableStandingCells: number;
  markerCounts: Record<'spawn' | 'exit' | 'checkpoint', number>;
  tileCounts: Record<string, number>;
  score: number;
}

export interface ParsedPlatformerLevelLabCandidate {
  level: PlatformerLevel;
  metrics: PlatformerLevelLabMetrics;
  parsedPng: Buffer;
  repairedPng: Buffer;
  guidePng: Buffer;
}

export interface PlatformerLevelHydrationResult {
  normalized: Buffer;
  exactTerrain: Buffer;
  safeTerrain: Buffer;
  visualMask: Buffer;
  darkOutline: Buffer;
  lightOutline: Buffer;
  mismatch: Buffer;
  metrics: {
    paintOutsideCollisionRatio: number;
    paintOutsideVisualMaskRatio: number;
    falsePositiveRatio: number;
    missingTerrainRatio: number;
    fringeUsageRatio: number;
    rejectedPaintRatio: number;
    acceptedPaintRatio: number;
    collisionCoverageRatio: number;
    surfaceAlignment: {
      runsDetected: number;
      runsShifted: number;
      meanShiftPx: number;
    };
    exactCollisionMask: true;
    fringe: PlatformerLevelFringeOptions;
  };
}

export interface PlatformerLevelFringeOptions {
  topPx: number;
  sidePx: number;
  bottomPx: number;
}

export const DEFAULT_PLATFORMER_LEVEL_FRINGE: PlatformerLevelFringeOptions = {
  topPx: 4,
  sidePx: 1,
  bottomPx: 2,
};

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface ClassifiedCell {
  kind: PlatformerLevelLabCell;
  winnerShare: number;
  meanDistance: number;
}

const COLOR_ENTRIES = Object.entries(PLATFORMER_LEVEL_LAB_COLORS).map(([kind, hex]) => ({
  kind: kind as PlatformerLevelLabCell,
  rgb: hexRgb(hex),
}));

const CELL_TO_CHAR: Partial<Record<PlatformerLevelLabCell, string>> = {
  solid: '#',
  platform: '=',
  hazard: '^',
  checkpoint: 'C',
};

const LEGEND: Record<string, PlatformerTileType> = {
  '#': 'solid',
  '=': 'platform',
  '^': 'hazard',
  C: 'checkpoint',
};

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildPlatformerLevelLayoutPrompt(
  concept: string,
  candidateId: string,
): string {
  const composition =
    candidateId === 'L1'
      ? 'Use a readable rolling route with a gentle opening, one memorable ascent, and a strong final approach.'
      : candidateId === 'L2'
        ? 'Use layered upper and lower routes, a vertical middle section, and optional-risk collectible branches.'
        : 'Use a rhythmic sequence of short gaps, varied platform heights, and a dramatic but fair final third.';
  return [
    'Generate a MACHINE-READABLE COLOR-BLOCK MAP for one side-scrolling platformer level. This is data, not illustration.',
    `Level concept: ${clean(concept || 'A colorful adventurous 16-bit platformer stage')}. Candidate ${candidateId}. ${composition}`,
    `The playable grid is EXACTLY ${PLATFORMER_LEVEL_LAB_WIDTH} columns wide by ${PLATFORMER_LEVEL_LAB_HEIGHT} rows high. Every logical tile must be one equal-size, perfectly axis-aligned, solid-color rectangle.`,
    `Surround the playable grid with one unbroken one-tile calibration frame colored ${PLATFORMER_LEVEL_LAB_COLORS.frame}. The frame encloses exactly ${PLATFORMER_LEVEL_LAB_WIDTH}×${PLATFORMER_LEVEL_LAB_HEIGHT} playable cells and is not part of the level.`,
    'Use only these exact flat RGB colors with no substitutions:',
    `${PLATFORMER_LEVEL_LAB_COLORS.empty} empty air; ${PLATFORMER_LEVEL_LAB_COLORS.solid} solid ground; ${PLATFORMER_LEVEL_LAB_COLORS.platform} one-way floating platform; ${PLATFORMER_LEVEL_LAB_COLORS.hazard} hazard; ${PLATFORMER_LEVEL_LAB_COLORS.coin} coin; ${PLATFORMER_LEVEL_LAB_COLORS.powerup} powerup; ${PLATFORMER_LEVEL_LAB_COLORS.checkpoint} checkpoint; ${PLATFORMER_LEVEL_LAB_COLORS.spawn} player spawn; ${PLATFORMER_LEVEL_LAB_COLORS.exit} level exit; ${PLATFORMER_LEVEL_LAB_COLORS.frame} calibration frame.`,
    'GAMEPLAY RULES: the player is two tiles tall; leave two clear rows along every route. Start near the left and exit near the right. Put both on supported open cells. Include one checkpoint near the middle, 8-16 coins, 1-2 powerups, multiple hazards, and several one-way platforms. Maximum unsupported horizontal jump gap is 4 tiles. Maximum upward jump is 3 tiles. Do not create unavoidable hazards.',
    'The bottom may contain pits, but every pit on the required route must be at most 4 tiles wide or have a reachable platform crossing it. Keep all required progress connected from spawn to exit.',
    'No text, labels, legend, numbers, grid lines, gradients, antialiasing, outlines, shadows, texture, scenery, characters, icons, perspective, isometric view, curved lines, rounded corners, or decorative border. Outside the calibration frame use pure white.',
  ].join(' ');
}

export function buildPlatformerLevelHydrationPrompt(concept: string): string {
  return [
    'The attached image is a machine-registered platformer level guide. Preserve its exact canvas, geometry, block positions, edges, gaps, and scale.',
    `Hydrate the terrain into polished high-density 16-bit pixel art for this level concept: ${clean(concept || 'a colorful adventurous platformer world')}.`,
    'The guide colors are semantic masks only, not the desired final palette. Translate them fully into materials and colors appropriate to the level concept; do not leave flat black, blue, red, or purple guide blocks in the finished art.',
    `Paint ONLY the black solid-ground cells, blue one-way-platform cells, red hazard cells, and purple checkpoint cells. Keep every white air cell pure ${PLATFORMER_LEVEL_LAB_COLORS.empty}, flat, empty, and undecorated.`,
    'Completely fill every occupied guide cell edge-to-edge with finished terrain material. White is reserved for empty air: never leave white holes, white rectangles, or untouched guide background inside any occupied ground, platform, hazard, or checkpoint cell.',
    'For every exposed black ground cell and blue one-way-platform cell, place the walkable surface directly on the TOP edge of the cell. Terrain thickness and supports must extend downward inside the occupied cell. Never place a walkable surface on the bottom edge of its cell.',
    'Every visible ground edge must remain on the exact guide boundary. Never expand terrain into white, close a gap, open a new gap, move a platform, round a corner outside its cell, add a ledge, or paint background scenery.',
    'Small non-solid surface detail such as grass blades, moss, snow tufts, sparks, or dangling vines may extend a few pixels beyond an exposed terrain edge. Keep this fringe thin and visibly decorative—never make it resemble another platform, wall, or bridge.',
    'Use material detail, surface trim, embedded props, cracks, vegetation, machinery, or architecture inside the occupied blocks to make the level feel handcrafted and unique. Preserve clear visual differences between solid ground, one-way platforms, hazards, and checkpoint.',
    'No player, character, enemy, creature, collectible, exit door, text, letters, UI, watermark, perspective, blur, vector art, 3D rendering, frame, or border.',
  ].join(' ');
}

export async function parseAndRepairPlatformerLevelLayout(
  image: Buffer,
  name = 'Muse Image Lab Level',
): Promise<ParsedPlatformerLevelLabCandidate> {
  const decoded = await sharp(image)
    .rotate()
    .flatten({ background: PLATFORMER_LEVEL_LAB_COLORS.empty })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (width < 64 || height < 32 || channels < 3) {
    throw new Error(`level layout image is too small (${width}x${height})`);
  }

  const classified = classifyPixels(decoded.data, width, height, channels);
  const registration = findRegistration(classified.kinds, width, height);
  const cells: ClassifiedCell[][] = [];
  for (let y = 0; y < PLATFORMER_LEVEL_LAB_HEIGHT; y++) {
    const row: ClassifiedCell[] = [];
    for (let x = 0; x < PLATFORMER_LEVEL_LAB_WIDTH; x++) {
      row.push(
        classifyCell(
          decoded.data,
          width,
          height,
          channels,
          registration.crop,
          x,
          y,
        ),
      );
    }
    cells.push(row);
  }

  const parsed = levelFromClassifiedCells(cells, name);
  const parsedPng = await renderPlatformerLevelGuide(parsed.level);
  const repaired = repairPlatformerLevel(parsed.level);
  const repairedPng = await renderPlatformerLevelGuide(repaired.level);
  const guidePng = await renderPlatformerLevelGuide(repaired.level, false);
  const allCells = cells.flat();
  const confidentCellRatio =
    allCells.filter((cell) => cell.winnerShare >= 0.55 && cell.meanDistance <= 120).length /
    allCells.length;
  const meanWinnerShare = mean(allCells.map((cell) => cell.winnerShare));
  const meanColorDistance = mean(allCells.map((cell) => cell.meanDistance));
  const reachableStandingCells = reachableCells(repaired.level, 2).size;
  const tileCounts = countLevelContents(repaired.level);
  const parseQualityIssues = validateParsedMapQuality(
    parsed.markerCounts,
    tileCounts,
    meanColorDistance,
  );
  const issuesAfter = [...validatePlatformerLabLevel(repaired.level), ...parseQualityIssues];
  const variety = ['platform', 'hazard', 'checkpoint', 'coin', 'powerup'].filter(
    (kind) => (tileCounts[kind] ?? 0) > 0,
  ).length;
  const score = clamp(
    Math.round(
      confidentCellRatio * 42 +
        meanWinnerShare * 18 +
        (issuesAfter.length === 0 ? 28 : 0) +
        variety * 3 -
        Math.min(36, meanColorDistance * 0.85) -
        parseQualityIssues.length * 18 -
        Math.min(24, repaired.changedCells * 0.35),
    ),
    0,
    100,
  );

  return {
    level: repaired.level,
    parsedPng,
    repairedPng,
    guidePng,
    metrics: {
      registration: registration.mode,
      crop: registration.crop,
      confidentCellRatio,
      meanWinnerShare,
      meanColorDistance,
      changedCells: repaired.changedCells,
      repairs: [...parsed.notes, ...repaired.repairs],
      issuesBefore: [...validatePlatformerLabLevel(parsed.level), ...parseQualityIssues],
      issuesAfter,
      reachableStandingCells,
      markerCounts: parsed.markerCounts,
      tileCounts,
      score,
    },
  };
}

export function validatePlatformerLabLevel(level: PlatformerLevel): string[] {
  const issues: string[] = [];
  if (level.tiles.length !== PLATFORMER_LEVEL_LAB_HEIGHT) {
    issues.push(`height is ${level.tiles.length}; expected ${PLATFORMER_LEVEL_LAB_HEIGHT}`);
  }
  if (level.tiles.some((row) => row.length !== PLATFORMER_LEVEL_LAB_WIDTH)) {
    issues.push(`one or more rows are not ${PLATFORMER_LEVEL_LAB_WIDTH} tiles wide`);
  }
  const kind = levelKind(level);
  const supportedOpen = (point: Coord): boolean =>
    point.x >= 0 &&
    point.x < PLATFORMER_LEVEL_LAB_WIDTH &&
    point.y >= 1 &&
    point.y < PLATFORMER_LEVEL_LAB_HEIGHT - 1 &&
    !isSolidLike(kind(point.x, point.y)) &&
    !isSolidLike(kind(point.x, point.y - 1)) &&
    isSolidLike(kind(point.x, point.y + 1));
  if (!supportedOpen(level.playerSpawn)) issues.push('spawn is not grounded with two-tile headroom');
  if (!supportedOpen(level.exit)) issues.push('exit is not grounded with two-tile headroom');
  if (!level.tiles.some((row) => [...row].some((char) => level.legend[char] === 'checkpoint'))) {
    issues.push('checkpoint missing');
  }
  if (supportedOpen(level.playerSpawn) && supportedOpen(level.exit)) {
    const reachable = reachableCells(level, 2);
    if (!reachable.has(`${level.exit.x},${level.exit.y}`)) issues.push('exit is unreachable');
  }
  return issues;
}

export async function renderPlatformerLevelGuide(
  level: PlatformerLevel,
  includeGameplayMarkers = true,
): Promise<Buffer> {
  const width = PLATFORMER_LEVEL_LAB_IMAGE_WIDTH;
  const height = PLATFORMER_LEVEL_LAB_IMAGE_HEIGHT;
  const output = Buffer.alloc(width * height * 3, 255);
  const entities = new Map(level.entities.map((entity) => [`${entity.x},${entity.y}`, entity.type]));
  const kind = levelKind(level);
  for (let ty = 0; ty < PLATFORMER_LEVEL_LAB_HEIGHT; ty++) {
    for (let tx = 0; tx < PLATFORMER_LEVEL_LAB_WIDTH; tx++) {
      let cell: PlatformerLevelLabCell = tileKindToCell(kind(tx, ty));
      if (includeGameplayMarkers) {
        const entity = entities.get(`${tx},${ty}`);
        if (entity === 'coin') cell = 'coin';
        if (entity === 'powerup') cell = 'powerup';
        if (level.playerSpawn.x === tx && level.playerSpawn.y === ty) cell = 'spawn';
        if (level.exit.x === tx && level.exit.y === ty) cell = 'exit';
      }
      fillRawRect(
        output,
        width,
        tx * PLATFORMER_LEVEL_LAB_TILE_SIZE,
        ty * PLATFORMER_LEVEL_LAB_TILE_SIZE,
        PLATFORMER_LEVEL_LAB_TILE_SIZE,
        PLATFORMER_LEVEL_LAB_TILE_SIZE,
        hexRgb(PLATFORMER_LEVEL_LAB_COLORS[cell]),
      );
    }
  }
  return sharp(output, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9, palette: true, colors: 16, dither: 0 })
    .toBuffer();
}

/** Lightweight deterministic fixture for the dev lab when the whole app uses
 * the mock provider. It still exercises frame registration, parsing, repair,
 * persistence, hydration, and the browser preview. */
export async function mockPlatformerLevelLayoutImage(candidateId: string): Promise<Buffer> {
  const logicalWidth = PLATFORMER_LEVEL_LAB_WIDTH + 2;
  const logicalHeight = PLATFORMER_LEVEL_LAB_HEIGHT + 2;
  const cellSize = 6;
  const width = logicalWidth * cellSize;
  const height = logicalHeight * cellSize;
  const output = Buffer.alloc(width * height * 3, 255);
  const paint = (x: number, y: number, kind: PlatformerLevelLabCell): void => {
    fillRawRect(
      output,
      width,
      x * cellSize,
      y * cellSize,
      cellSize,
      cellSize,
      hexRgb(PLATFORMER_LEVEL_LAB_COLORS[kind]),
    );
  };
  for (let x = 0; x < logicalWidth; x++) {
    paint(x, 0, 'frame');
    paint(x, logicalHeight - 1, 'frame');
  }
  for (let y = 0; y < logicalHeight; y++) {
    paint(0, y, 'frame');
    paint(logicalWidth - 1, y, 'frame');
  }
  const variant = Math.max(0, Number.parseInt(candidateId.replace(/\D/g, ''), 10) - 1) % 3;
  for (let x = 1; x < logicalWidth - 1; x++) {
    const logicalX = x - 1;
    const gap =
      (logicalX >= 22 + variant * 2 && logicalX <= 24 + variant * 2) ||
      (logicalX >= 61 - variant && logicalX <= 63 - variant);
    if (!gap) paint(x, PLATFORMER_LEVEL_LAB_HEIGHT, 'solid');
  }
  for (const x of [23 + variant * 2, 24 + variant * 2, 62 - variant, 63 - variant]) {
    paint(x + 1, PLATFORMER_LEVEL_LAB_HEIGHT - 2, 'platform');
  }
  for (let x = 34; x <= 41; x++) paint(x + 1, 14 - variant, 'platform');
  for (let x = 72; x <= 78; x++) paint(x + 1, 12 + variant, 'platform');
  paint(4, 17, 'spawn');
  paint(93, 17, 'exit');
  paint(49, 17, 'checkpoint');
  for (const x of [12, 18, 29, 38, 55, 69, 76, 86]) paint(x + 1, 15, 'coin');
  paint(44, 12, 'powerup');
  paint(58, 17, 'hazard');
  paint(59, 17, 'hazard');
  return sharp(output, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

export async function processPlatformerLevelHydration(
  image: Buffer,
  level: PlatformerLevel,
  fringeOptions: PlatformerLevelFringeOptions = DEFAULT_PLATFORMER_LEVEL_FRINGE,
): Promise<PlatformerLevelHydrationResult> {
  const width = PLATFORMER_LEVEL_LAB_IMAGE_WIDTH;
  const height = PLATFORMER_LEVEL_LAB_IMAGE_HEIGHT;
  const fringe = {
    topPx: clamp(Math.round(fringeOptions.topPx), 0, 8),
    sidePx: clamp(Math.round(fringeOptions.sidePx), 0, 4),
    bottomPx: clamp(Math.round(fringeOptions.bottomPx), 0, 6),
  };
  const normalized = await sharp(image)
    .rotate()
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const raw = await sharp(normalized).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sourceBackground = detectHydrationBackground(
    raw.data,
    width,
    height,
    raw.info.channels,
  );
  const aligned = alignExposedTerrainRuns(
    raw.data,
    sourceBackground,
    raw.info.channels,
    width,
    height,
    level,
  );
  const terrainClasses = hydrationTerrainClasses(level, width, height);
  const underfill = buildTerrainUnderfill(
    aligned.data,
    raw.info.channels,
    width,
    height,
    terrainClasses,
    aligned.background,
  );
  const exact = Buffer.alloc(width * height * 4);
  const safe = Buffer.alloc(width * height * 4);
  const visualMask = Buffer.alloc(width * height * 4);
  const mismatch = Buffer.alloc(width * height * 4);
  const kind = levelKind(level);
  let outsideCollisionPaint = 0;
  let outsideCollisionPixels = 0;
  let outsideVisualPaint = 0;
  let outsideVisualPixels = 0;
  let paintedFringe = 0;
  let fringePixels = 0;
  let missingPaint = 0;
  let terrainPixels = 0;
  let sourcePaintedPixels = 0;
  let collisionPaintedPixels = 0;
  let rejectedPaintedPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceOffset = (y * width + x) * raw.info.channels;
      const targetOffset = (y * width + x) * 4;
      const pixelIndex = y * width + x;
      const r = aligned.data[sourceOffset]!;
      const g = aligned.data[sourceOffset + 1]!;
      const b = aligned.data[sourceOffset + 2]!;
      const tx = Math.floor(x / PLATFORMER_LEVEL_LAB_TILE_SIZE);
      const ty = Math.floor(y / PLATFORMER_LEVEL_LAB_TILE_SIZE);
      const collision = isHydratedForeground(kind(tx, ty));
      const allowedFringe =
        !collision && isVisualFringePixel(x, y, kind, fringe);
      const renderable = collision || allowedFringe;
      const painted = aligned.background[pixelIndex] === 0;
      if (painted) sourcePaintedPixels++;
      if (collision) {
        terrainPixels++;
        if (!painted) missingPaint++;
        else collisionPaintedPixels++;
        const fillOffset = pixelIndex * 3;
        exact[targetOffset] = painted ? r : underfill[fillOffset]!;
        exact[targetOffset + 1] = painted ? g : underfill[fillOffset + 1]!;
        exact[targetOffset + 2] = painted ? b : underfill[fillOffset + 2]!;
        exact[targetOffset + 3] = 255;
        visualMask[targetOffset] = 48;
        visualMask[targetOffset + 1] = 114;
        visualMask[targetOffset + 2] = 255;
        visualMask[targetOffset + 3] = 190;
      } else {
        outsideCollisionPixels++;
        if (painted) outsideCollisionPaint++;
      }
      if (allowedFringe) {
        fringePixels++;
        if (painted) paintedFringe++;
        visualMask[targetOffset] = 255;
        visualMask[targetOffset + 1] = 196;
        visualMask[targetOffset + 2] = 0;
        visualMask[targetOffset + 3] = 215;
      }
      if (collision || (allowedFringe && painted)) {
        const fillOffset = pixelIndex * 3;
        safe[targetOffset] = painted ? r : underfill[fillOffset]!;
        safe[targetOffset + 1] = painted ? g : underfill[fillOffset + 1]!;
        safe[targetOffset + 2] = painted ? b : underfill[fillOffset + 2]!;
        safe[targetOffset + 3] = 255;
      } else {
        outsideVisualPixels++;
        if (painted) {
          outsideVisualPaint++;
          rejectedPaintedPixels++;
        }
      }
      if (collision && !painted) {
        mismatch[targetOffset] = 255;
        mismatch[targetOffset + 1] = 196;
        mismatch[targetOffset + 2] = 0;
        mismatch[targetOffset + 3] = 210;
      } else if (allowedFringe && painted) {
        mismatch[targetOffset] = 25;
        mismatch[targetOffset + 1] = 220;
        mismatch[targetOffset + 2] = 235;
        mismatch[targetOffset + 3] = 185;
      } else if (!renderable && painted) {
        mismatch[targetOffset] = 255;
        mismatch[targetOffset + 1] = 48;
        mismatch[targetOffset + 2] = 72;
        mismatch[targetOffset + 3] = 210;
      }
    }
  }
  const exactTerrain = await sharp(exact, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const safeTerrain = await sharp(safe, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const visualMaskPng = await sharp(visualMask, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const outlines = await renderTerrainOutlines(safe, width, height);
  const mismatchPng = await sharp(mismatch, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return {
    normalized,
    exactTerrain,
    safeTerrain,
    visualMask: visualMaskPng,
    darkOutline: outlines.dark,
    lightOutline: outlines.light,
    mismatch: mismatchPng,
    metrics: {
      paintOutsideCollisionRatio: outsideCollisionPixels
        ? outsideCollisionPaint / outsideCollisionPixels
        : 0,
      paintOutsideVisualMaskRatio: outsideVisualPixels
        ? outsideVisualPaint / outsideVisualPixels
        : 0,
      falsePositiveRatio: outsideCollisionPixels
        ? outsideCollisionPaint / outsideCollisionPixels
        : 0,
      missingTerrainRatio: terrainPixels ? missingPaint / terrainPixels : 0,
      fringeUsageRatio: fringePixels ? paintedFringe / fringePixels : 0,
      rejectedPaintRatio: sourcePaintedPixels
        ? rejectedPaintedPixels / sourcePaintedPixels
        : 0,
      acceptedPaintRatio: sourcePaintedPixels
        ? (collisionPaintedPixels + paintedFringe) / sourcePaintedPixels
        : 0,
      collisionCoverageRatio: terrainPixels ? collisionPaintedPixels / terrainPixels : 0,
      surfaceAlignment: aligned.metrics,
      exactCollisionMask: true,
      fringe,
    },
  };
}

function classifyPixels(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
): { kinds: Uint8Array } {
  const kinds = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index++) {
    const offset = index * channels;
    kinds[index] = nearestColorIndex({
      r: data[offset]!,
      g: data[offset + 1]!,
      b: data[offset + 2]!,
    });
  }
  return { kinds };
}

function findRegistration(
  kinds: Uint8Array,
  width: number,
  height: number,
): {
  mode: 'frame' | 'content';
  crop: { left: number; top: number; width: number; height: number };
} {
  const frameIndex = COLOR_ENTRIES.findIndex(({ kind }) => kind === 'frame');
  const rowCounts = new Array<number>(height).fill(0);
  const colCounts = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (kinds[y * width + x] !== frameIndex) continue;
      rowCounts[y] = rowCounts[y]! + 1;
      colCounts[x] = colCounts[x]! + 1;
    }
  }
  const frameRows = rowCounts
    .map((count, index) => ({ count, index }))
    .filter(({ count }) => count >= width * 0.2)
    .map(({ index }) => index);
  const frameCols = colCounts
    .map((count, index) => ({ count, index }))
    .filter(({ count }) => count >= height * 0.12)
    .map(({ index }) => index);
  if (frameRows.length >= 2 && frameCols.length >= 2) {
    const outerLeft = Math.min(...frameCols);
    const outerRight = Math.max(...frameCols);
    const outerTop = Math.min(...frameRows);
    const outerBottom = Math.max(...frameRows);
    const cellW = (outerRight - outerLeft + 1) / (PLATFORMER_LEVEL_LAB_WIDTH + 2);
    const cellH = (outerBottom - outerTop + 1) / (PLATFORMER_LEVEL_LAB_HEIGHT + 2);
    const crop = clampCrop(
      {
        left: Math.round(outerLeft + cellW),
        top: Math.round(outerTop + cellH),
        width: Math.round(cellW * PLATFORMER_LEVEL_LAB_WIDTH),
        height: Math.round(cellH * PLATFORMER_LEVEL_LAB_HEIGHT),
      },
      width,
      height,
    );
    if (crop.width >= PLATFORMER_LEVEL_LAB_WIDTH && crop.height >= PLATFORMER_LEVEL_LAB_HEIGHT) {
      return { mode: 'frame', crop };
    }
  }

  const emptyIndex = COLOR_ENTRIES.findIndex(({ kind }) => kind === 'empty');
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const kind = kinds[y * width + x];
      if (kind === emptyIndex || kind === frameIndex) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const contentWidth = maxX >= minX ? maxX - minX + 1 : Math.round(width * 0.9);
  const cropWidth = Math.min(width, Math.max(PLATFORMER_LEVEL_LAB_WIDTH, Math.round(contentWidth * 1.04)));
  const cropHeight = Math.min(
    height,
    Math.max(
      PLATFORMER_LEVEL_LAB_HEIGHT,
      Math.round((cropWidth * PLATFORMER_LEVEL_LAB_HEIGHT) / PLATFORMER_LEVEL_LAB_WIDTH),
    ),
  );
  const centerX = maxX >= minX ? (minX + maxX) / 2 : width / 2;
  const bottom = maxY >= 0 ? Math.min(height, maxY + Math.max(1, Math.round(cropHeight / 18))) : height;
  return {
    mode: 'content',
    crop: clampCrop(
      {
        left: Math.round(centerX - cropWidth / 2),
        top: Math.round(bottom - cropHeight),
        width: cropWidth,
        height: cropHeight,
      },
      width,
      height,
    ),
  };
}

function classifyCell(
  data: Buffer,
  imageWidth: number,
  imageHeight: number,
  channels: number,
  crop: { left: number; top: number; width: number; height: number },
  cellX: number,
  cellY: number,
): ClassifiedCell {
  const left = crop.left + (cellX * crop.width) / PLATFORMER_LEVEL_LAB_WIDTH;
  const right = crop.left + ((cellX + 1) * crop.width) / PLATFORMER_LEVEL_LAB_WIDTH;
  const top = crop.top + (cellY * crop.height) / PLATFORMER_LEVEL_LAB_HEIGHT;
  const bottom = crop.top + ((cellY + 1) * crop.height) / PLATFORMER_LEVEL_LAB_HEIGHT;
  const insetX = Math.max(0, (right - left) * 0.18);
  const insetY = Math.max(0, (bottom - top) * 0.18);
  const x0 = clamp(Math.floor(left + insetX), 0, imageWidth - 1);
  const x1 = clamp(Math.ceil(right - insetX), x0 + 1, imageWidth);
  const y0 = clamp(Math.floor(top + insetY), 0, imageHeight - 1);
  const y1 = clamp(Math.ceil(bottom - insetY), y0 + 1, imageHeight);
  const counts = new Array<number>(COLOR_ENTRIES.length).fill(0);
  const distances = new Array<number>(COLOR_ENTRIES.length).fill(0);
  let samples = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * imageWidth + x) * channels;
      const rgb = { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]! };
      const index = nearestColorIndex(rgb);
      counts[index] = counts[index]! + 1;
      distances[index] =
        distances[index]! + colorDistance(rgb, COLOR_ENTRIES[index]!.rgb);
      samples++;
    }
  }
  let winner = 0;
  for (let index = 1; index < counts.length; index++) {
    if (counts[index]! > counts[winner]!) winner = index;
  }
  return {
    kind: COLOR_ENTRIES[winner]!.kind === 'frame' ? 'empty' : COLOR_ENTRIES[winner]!.kind,
    winnerShare: samples ? counts[winner]! / samples : 0,
    meanDistance: counts[winner] ? distances[winner]! / counts[winner]! : 255,
  };
}

function levelFromClassifiedCells(
  cells: ClassifiedCell[][],
  name: string,
): {
  level: PlatformerLevel;
  notes: string[];
  markerCounts: Record<'spawn' | 'exit' | 'checkpoint', number>;
} {
  const spawnMarkers: Coord[] = [];
  const exitMarkers: Coord[] = [];
  const entities: PlatformerEntity[] = [];
  const tiles = cells.map((row, y) =>
    row
      .map((cell, x) => {
        if (cell.kind === 'spawn') spawnMarkers.push({ x, y });
        if (cell.kind === 'exit') exitMarkers.push({ x, y });
        if (cell.kind === 'coin') entities.push({ type: 'coin', x, y });
        if (cell.kind === 'powerup') {
          entities.push({ type: 'powerup', x, y, props: { kind: 'doubleJump' } });
        }
        return CELL_TO_CHAR[cell.kind] ?? '.';
      })
      .join(''),
  );
  const notes: string[] = [];
  if (spawnMarkers.length !== 1) notes.push(`parsed ${spawnMarkers.length} spawn markers`);
  if (exitMarkers.length !== 1) notes.push(`parsed ${exitMarkers.length} exit markers`);
  const checkpointMarkers = cells.flat().filter((cell) => cell.kind === 'checkpoint').length;
  return {
    level: {
      name: clean(name, 48) || 'Muse Image Lab Level',
      musicSong: 'theme',
      tiles,
      legend: { ...LEGEND },
      entities,
      playerSpawn: spawnMarkers.sort((a, b) => a.x - b.x)[0] ?? { x: 3, y: 15 },
      exit: exitMarkers.sort((a, b) => b.x - a.x)[0] ?? {
        x: PLATFORMER_LEVEL_LAB_WIDTH - 4,
        y: 15,
      },
    },
    notes,
    markerCounts: {
      spawn: spawnMarkers.length,
      exit: exitMarkers.length,
      checkpoint: checkpointMarkers,
    },
  };
}

function validateParsedMapQuality(
  markers: Record<'spawn' | 'exit' | 'checkpoint', number>,
  tileCounts: Record<string, number>,
  meanColorDistance: number,
): string[] {
  const issues: string[] = [];
  if (meanColorDistance > 18) {
    issues.push(
      `palette fidelity is too low for reliable machine parsing (mean distance ${meanColorDistance.toFixed(1)})`,
    );
  }
  if (markers.spawn > 4 || markers.exit > 4 || markers.checkpoint > 4) {
    issues.push(
      `marker density is implausible (${markers.spawn} spawn, ${markers.exit} exit, ${markers.checkpoint} checkpoint cells)`,
    );
  }
  if ((tileCounts.coin ?? 0) > 32 || (tileCounts.powerup ?? 0) > 6) {
    issues.push(
      `collectible density is implausible (${tileCounts.coin ?? 0} coins, ${tileCounts.powerup ?? 0} powerups)`,
    );
  }
  return issues;
}

function repairPlatformerLevel(level: PlatformerLevel): {
  level: PlatformerLevel;
  changedCells: number;
  repairs: string[];
} {
  const grid = level.tiles.map((row) => [...row]);
  const before = grid.map((row) => row.join(''));
  const repairs: string[] = [];
  const width = PLATFORMER_LEVEL_LAB_WIDTH;
  const height = PLATFORMER_LEVEL_LAB_HEIGHT;
  const charKind = (x: number, y: number): PlatformerTileType => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 'empty';
    return level.legend[grid[y]![x]!] ?? 'empty';
  };
  const standable = (x: number, y: number): boolean =>
    y >= 1 &&
    y < height - 1 &&
    !isSolidLike(charKind(x, y)) &&
    !isSolidLike(charKind(x, y - 1)) &&
    isSolidLike(charKind(x, y + 1));
  const makeLanding = (point: Coord): Coord => {
    const x = clamp(Math.round(point.x), 1, width - 2);
    const y = clamp(Math.round(point.y), 2, height - 2);
    grid[y - 1]![x] = '.';
    grid[y]![x] = '.';
    grid[y + 1]![x] = '#';
    return { x, y };
  };
  const standingCells = (): Coord[] => {
    const out: Coord[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 0; x < width; x++) if (standable(x, y)) out.push({ x, y });
    }
    return out;
  };

  let candidates = standingCells();
  if (candidates.length < 2) {
    for (let x = 0; x < width; x++) grid[height - 1]![x] = '#';
    repairs.push('added a base floor because the parsed map had no usable standing route');
    candidates = standingCells();
  }

  const chooseNear = (targetX: number): Coord | undefined =>
    [...candidates].sort(
      (a, b) => Math.abs(a.x - targetX) - Math.abs(b.x - targetX) || b.y - a.y,
    )[0];
  let spawn = standable(level.playerSpawn.x, level.playerSpawn.y)
    ? { ...level.playerSpawn }
    : (chooseNear(4) ?? { x: 3, y: height - 2 });
  let exit = standable(level.exit.x, level.exit.y)
    ? { ...level.exit }
    : (chooseNear(width - 5) ?? { x: width - 4, y: height - 2 });
  if (spawn.x > exit.x) [spawn, exit] = [exit, spawn];
  spawn = makeLanding({ x: Math.min(spawn.x, Math.floor(width * 0.2)), y: spawn.y });
  exit = makeLanding({ x: Math.max(exit.x, Math.ceil(width * 0.8)), y: exit.y });
  if (spawn.x === exit.x) exit = makeLanding({ x: width - 4, y: exit.y });

  let repairedLevel = levelWithGrid(level, grid, spawn, exit);
  if (!reachableCells(repairedLevel, 2).has(`${exit.x},${exit.y}`)) {
    repairs.push('bridged disconnected route segments using the four-across / three-up jump limits');
    for (let attempt = 0; attempt < 10; attempt++) {
      repairedLevel = levelWithGrid(level, grid, spawn, exit);
      if (reachableCells(repairedLevel, 2).has(`${exit.x},${exit.y}`)) break;
      const blockage = platformerReachabilityBlockage(repairedLevel, 2);
      if (!blockage) break;
      bridgeRoute(grid, blockage.frontier, blockage.landing);
    }
  }
  repairedLevel = levelWithGrid(level, grid, spawn, exit);
  if (!reachableCells(repairedLevel, 2).has(`${exit.x},${exit.y}`)) {
    repairs.push('installed a final deterministic safety route after local bridging was insufficient');
    bridgeRoute(grid, spawn, exit, true);
  }

  const checkpointCells: Coord[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((level.legend[grid[y]![x]!] ?? 'empty') === 'checkpoint' && standable(x, y)) {
        checkpointCells.push({ x, y });
      } else if ((level.legend[grid[y]![x]!] ?? 'empty') === 'checkpoint') {
        grid[y]![x] = '.';
      }
    }
  }
  if (checkpointCells.length === 0) {
    const midpoint = Math.round((spawn.x + exit.x) / 2);
    const mid = standingCells().sort(
      (a, b) => Math.abs(a.x - midpoint) - Math.abs(b.x - midpoint),
    )[0];
    if (mid) {
      grid[mid.y]![mid.x] = 'C';
      repairs.push('placed a grounded midpoint checkpoint');
    }
  }

  repairedLevel = levelWithGrid(level, grid, spawn, exit);
  const reachable = reachableCells(repairedLevel, 2);
  const entities = level.entities.filter((entity) => {
    if (entity.x < 0 || entity.x >= width || entity.y < 0 || entity.y >= height) return false;
    if (isSolidLike(charKind(entity.x, entity.y))) return false;
    if (entity.type === 'coin' || entity.type === 'powerup') {
      const nearestStanding = [...reachable].some((key) => {
        const [x, y] = key.split(',').map(Number);
        return Math.abs(x! - entity.x) <= 4 && Math.abs(y! - entity.y) <= 4;
      });
      return nearestStanding;
    }
    return true;
  });
  repairedLevel = { ...repairedLevel, entities };
  const after = grid.map((row) => row.join(''));
  let changedCells = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (before[y]![x] !== after[y]![x]) changedCells++;
  }
  return { level: repairedLevel, changedCells, repairs };
}

function bridgeRoute(grid: string[][], from: Coord, to: Coord, full = false): void {
  const direction = Math.sign(to.x - from.x) || 1;
  const distance = Math.abs(to.x - from.x);
  let footY = clamp(from.y, 2, PLATFORMER_LEVEL_LAB_HEIGHT - 2);
  for (let step = 0; step <= distance; step++) {
    const x = from.x + step * direction;
    if (x < 0 || x >= PLATFORMER_LEVEL_LAB_WIDTH) continue;
    const targetY = Math.round(from.y + ((to.y - from.y) * step) / Math.max(1, distance));
    if (step % 3 === 0 || full) footY += clamp(targetY - footY, -1, 1);
    footY = clamp(footY, 2, PLATFORMER_LEVEL_LAB_HEIGHT - 2);
    grid[footY - 1]![x] = '.';
    grid[footY]![x] = '.';
    const supportY = footY + 1;
    if (supportY < PLATFORMER_LEVEL_LAB_HEIGHT) grid[supportY]![x] = '=';
  }
}

function levelWithGrid(
  source: PlatformerLevel,
  grid: string[][],
  playerSpawn: Coord,
  exit: Coord,
): PlatformerLevel {
  return {
    ...source,
    tiles: grid.map((row) => row.join('')),
    playerSpawn: { ...playerSpawn },
    exit: { ...exit },
  };
}

function countLevelContents(level: PlatformerLevel): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of level.tiles) {
    for (const char of row) {
      const kind = level.legend[char] ?? 'empty';
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  for (const entity of level.entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1;
  return counts;
}

function levelKind(level: PlatformerLevel): (x: number, y: number) => PlatformerTileType {
  return (x, y) => {
    if (x < 0 || y < 0 || y >= level.tiles.length || x >= (level.tiles[y]?.length ?? 0)) {
      return 'empty';
    }
    const char = level.tiles[y]![x]!;
    return char === '.' ? 'empty' : (level.legend[char] ?? 'empty');
  };
}

function isSolidLike(kind: PlatformerTileType): boolean {
  return kind === 'solid' || kind === 'platform';
}

function isHydratedForeground(kind: PlatformerTileType): boolean {
  return kind === 'solid' || kind === 'platform' || kind === 'hazard' || kind === 'checkpoint';
}

function alignExposedTerrainRuns(
  data: Buffer,
  background: Uint8Array,
  channels: number,
  width: number,
  height: number,
  level: PlatformerLevel,
): {
  data: Buffer;
  background: Uint8Array;
  metrics: { runsDetected: number; runsShifted: number; meanShiftPx: number };
} {
  const output = Buffer.from(data);
  const outputBackground = Uint8Array.from(background);
  const kind = levelKind(level);
  const tileSize = PLATFORMER_LEVEL_LAB_TILE_SIZE;
  let runsDetected = 0;
  let runsShifted = 0;
  let totalShift = 0;

  for (let ty = 0; ty < PLATFORMER_LEVEL_LAB_HEIGHT; ty++) {
    let tx = 0;
    while (tx < PLATFORMER_LEVEL_LAB_WIDTH) {
      const runKind = kind(tx, ty);
      const exposed =
        (runKind === 'solid' || runKind === 'platform') &&
        !isHydratedForeground(kind(tx, ty - 1));
      if (!exposed) {
        tx++;
        continue;
      }
      const startTx = tx;
      while (
        tx + 1 < PLATFORMER_LEVEL_LAB_WIDTH &&
        kind(tx + 1, ty) === runKind &&
        !isHydratedForeground(kind(tx + 1, ty - 1))
      ) {
        tx++;
      }
      const endTx = tx;
      tx++;
      runsDetected++;

      const left = startTx * tileSize;
      const right = Math.min(width, (endTx + 1) * tileSize);
      const top = ty * tileSize;
      const searchBottom = Math.min(height, top + tileSize * 3);
      const rowPaint = new Uint32Array(searchBottom - top);
      for (let y = top; y < searchBottom; y++) {
        for (let x = left; x < right; x++) {
          if (
            kind(
              Math.floor(x / tileSize),
              Math.floor(y / tileSize),
            ) !== runKind
          ) {
            continue;
          }
          if (background[y * width + x]) continue;
          rowPaint[y - top] = rowPaint[y - top]! + 1;
        }
      }
      const significantRowPaint = Math.max(8, Math.ceil((right - left) * 0.18));
      const surfaceRow = rowPaint.findIndex((count) => count >= significantRowPaint);
      if (surfaceRow < 4) continue;

      const shift = Math.min(tileSize * 2, surfaceRow);
      const sourceBottom = Math.min(searchBottom, top + shift + tileSize);
      for (let y = top; y < sourceBottom; y++) {
        for (let x = left; x < right; x++) {
          if (
            kind(
              Math.floor(x / tileSize),
              Math.floor(y / tileSize),
            ) !== runKind
          ) {
            continue;
          }
          const targetIndex = y * width + x;
          const targetOffset = targetIndex * channels;
          output[targetOffset] = 255;
          output[targetOffset + 1] = 255;
          output[targetOffset + 2] = 255;
          outputBackground[targetIndex] = 1;
        }
      }
      for (let y = top; y < sourceBottom; y++) {
        const targetY = y - shift;
        if (targetY < top) continue;
        for (let x = left; x < right; x++) {
          if (
            kind(
              Math.floor(x / tileSize),
              Math.floor(y / tileSize),
            ) !== runKind
          ) {
            continue;
          }
          const sourceIndex = y * width + x;
          if (background[sourceIndex]) continue;
          const targetIndex = targetY * width + x;
          const sourceOffset = sourceIndex * channels;
          const targetOffset = targetIndex * channels;
          output[targetOffset] = data[sourceOffset]!;
          output[targetOffset + 1] = data[sourceOffset + 1]!;
          output[targetOffset + 2] = data[sourceOffset + 2]!;
          outputBackground[targetIndex] = 0;
        }
      }
      runsShifted++;
      totalShift += shift;
    }
  }

  return {
    data: output,
    background: outputBackground,
    metrics: {
      runsDetected,
      runsShifted,
      meanShiftPx: runsShifted ? totalShift / runsShifted : 0,
    },
  };
}

function hydrationTerrainClass(kind: PlatformerTileType): number {
  if (kind === 'solid') return 1;
  if (kind === 'platform') return 2;
  if (kind === 'hazard') return 3;
  if (kind === 'checkpoint') return 4;
  return 0;
}

function hydrationTerrainClasses(
  level: PlatformerLevel,
  width: number,
  height: number,
): Uint8Array {
  const classes = new Uint8Array(width * height);
  const kind = levelKind(level);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      classes[y * width + x] = hydrationTerrainClass(
        kind(
          Math.floor(x / PLATFORMER_LEVEL_LAB_TILE_SIZE),
          Math.floor(y / PLATFORMER_LEVEL_LAB_TILE_SIZE),
        ),
      );
    }
  }
  return classes;
}

/** Finds the blank matte without deleting small white highlights inside the art.
 * Large near-white islands count as untouched background even when the model
 * encloses one inside a platform outline. */
function detectHydrationBackground(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const pixels = width * height;
  const nearWhite = new Uint8Array(pixels);
  const visited = new Uint8Array(pixels);
  const background = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  for (let index = 0; index < pixels; index++) {
    const offset = index * channels;
    const distance = colorDistance(
      { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]! },
      { r: 255, g: 255, b: 255 },
    );
    if (distance <= 46) nearWhite[index] = 1;
  }

  for (let start = 0; start < pixels; start++) {
    if (!nearWhite[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let touchesCanvasEdge = false;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesCanvasEdge = true;
      }
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (let direction = 0; direction < neighbors.length; direction++) {
        if ((direction === 0 && x === 0) || (direction === 1 && x === width - 1)) continue;
        const neighbor = neighbors[direction]!;
        if (neighbor < 0 || neighbor >= pixels || visited[neighbor] || !nearWhite[neighbor]) {
          continue;
        }
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (touchesCanvasEdge || tail >= 24) {
      for (let index = 0; index < tail; index++) background[queue[index]!] = 1;
    }
  }
  return background;
}

/** Builds a generated-palette undercoat for guide cells Muse left blank. This
 * keeps collision visually solid without ever compositing the white matte. */
function buildTerrainUnderfill(
  data: Buffer,
  channels: number,
  width: number,
  height: number,
  terrainClasses: Uint8Array,
  background: Uint8Array,
): Buffer {
  const pixels = width * height;
  const source = new Int32Array(pixels);
  source.fill(-1);
  const queue = new Int32Array(pixels);
  const sums = Array.from({ length: 5 }, () => ({ r: 0, g: 0, b: 0, count: 0 }));
  let tail = 0;
  for (let index = 0; index < pixels; index++) {
    const terrainClass = terrainClasses[index]!;
    if (terrainClass === 0 || background[index]) continue;
    source[index] = index;
    queue[tail++] = index;
    const offset = index * channels;
    const sum = sums[terrainClass]!;
    sum.r += data[offset]!;
    sum.g += data[offset + 1]!;
    sum.b += data[offset + 2]!;
    sum.count++;
  }

  let head = 0;
  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    const terrainClass = terrainClasses[index]!;
    const neighbors = [index - 1, index + 1, index - width, index + width];
    for (let direction = 0; direction < neighbors.length; direction++) {
      if ((direction === 0 && x === 0) || (direction === 1 && x === width - 1)) continue;
      const neighbor = neighbors[direction]!;
      if (
        neighbor < 0 ||
        neighbor >= pixels ||
        source[neighbor]! >= 0 ||
        terrainClasses[neighbor] !== terrainClass
      ) {
        continue;
      }
      source[neighbor] = source[index]!;
      queue[tail++] = neighbor;
    }
  }

  const fallbacks: Rgb[] = [
    { r: 70, g: 62, b: 54 },
    { r: 92, g: 72, b: 54 },
    { r: 58, g: 92, b: 146 },
    { r: 176, g: 50, b: 58 },
    { r: 126, g: 80, b: 174 },
  ];
  const bases = sums.map((sum, terrainClass) =>
    sum.count
      ? {
          r: Math.round(sum.r / sum.count),
          g: Math.round(sum.g / sum.count),
          b: Math.round(sum.b / sum.count),
        }
      : fallbacks[terrainClass]!,
  );
  const output = Buffer.alloc(pixels * 3);
  for (let index = 0; index < pixels; index++) {
    const terrainClass = terrainClasses[index]!;
    if (terrainClass === 0) continue;
    const nearest = source[index]!;
    const sourceOffset = nearest >= 0 ? nearest * channels : -1;
    const base = bases[terrainClass]!;
    const x = index % width;
    const y = Math.floor(index / width);
    const texture = ((x * 13 + y * 7) % 7) - 3;
    const depthShade = -Math.round(((y % PLATFORMER_LEVEL_LAB_TILE_SIZE) / 15) * 10);
    const outputOffset = index * 3;
    for (let channel = 0; channel < 3; channel++) {
      const baseValue = channel === 0 ? base.r : channel === 1 ? base.g : base.b;
      const nearbyValue = sourceOffset >= 0 ? data[sourceOffset + channel]! : baseValue;
      output[outputOffset + channel] = clamp(
        Math.round(baseValue * 0.72 + nearbyValue * 0.28 + texture + depthShade),
        0,
        255,
      );
    }
  }
  return output;
}

function tileKindToCell(kind: PlatformerTileType): PlatformerLevelLabCell {
  if (kind === 'solid') return 'solid';
  if (kind === 'platform') return 'platform';
  if (kind === 'hazard') return 'hazard';
  if (kind === 'checkpoint') return 'checkpoint';
  return 'empty';
}

function isVisualFringePixel(
  x: number,
  y: number,
  kind: (x: number, y: number) => PlatformerTileType,
  fringe: PlatformerLevelFringeOptions,
): boolean {
  const tileSize = PLATFORMER_LEVEL_LAB_TILE_SIZE;
  const tx = Math.floor(x / tileSize);
  const ty = Math.floor(y / tileSize);
  const localX = x % tileSize;
  const localY = y % tileSize;
  const current = isHydratedForeground(kind(tx, ty));
  if (current) return false;
  const above = isHydratedForeground(kind(tx, ty - 1));
  const below = isHydratedForeground(kind(tx, ty + 1));
  const left = isHydratedForeground(kind(tx - 1, ty));
  const right = isHydratedForeground(kind(tx + 1, ty));
  return (
    (fringe.topPx > 0 && below && localY >= tileSize - fringe.topPx) ||
    (fringe.bottomPx > 0 && above && localY < fringe.bottomPx) ||
    (fringe.sidePx > 0 && right && localX >= tileSize - fringe.sidePx) ||
    (fringe.sidePx > 0 && left && localX < fringe.sidePx)
  );
}

async function renderTerrainOutlines(
  terrain: Buffer,
  width: number,
  height: number,
): Promise<{ dark: Buffer; light: Buffer }> {
  const edge = Buffer.alloc(width * height * 4);
  const alphaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return terrain[(y * width + x) * 4 + 3]!;
  };
  const thickness = 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alphaAt(x, y) > 0) continue;
      let nearTerrain = false;
      for (let oy = -thickness; oy <= thickness && !nearTerrain; oy++) {
        for (let ox = -thickness; ox <= thickness; ox++) {
          if (Math.abs(ox) + Math.abs(oy) > thickness) continue;
          if (alphaAt(x + ox, y + oy) > 0) {
            nearTerrain = true;
            break;
          }
        }
      }
      if (!nearTerrain) continue;
      edge[(y * width + x) * 4 + 3] = 235;
    }
  }
  const tint = async (rgb: Rgb): Promise<Buffer> => {
    const output = Buffer.from(edge);
    for (let offset = 0; offset < output.length; offset += 4) {
      output[offset] = rgb.r;
      output[offset + 1] = rgb.g;
      output[offset + 2] = rgb.b;
    }
    return sharp(output, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  };
  return {
    dark: await tint({ r: 7, g: 9, b: 18 }),
    light: await tint({ r: 255, g: 238, b: 194 }),
  };
}

function nearestColorIndex(rgb: Rgb): number {
  let winner = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < COLOR_ENTRIES.length; index++) {
    const distance = colorDistance(rgb, COLOR_ENTRIES[index]!.rgb);
    if (distance < best) {
      best = distance;
      winner = index;
    }
  }
  return winner;
}

function colorDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function hexRgb(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function fillRawRect(
  output: Buffer,
  outputWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgb,
): void {
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) {
      const offset = (py * outputWidth + px) * 3;
      output[offset] = color.r;
      output[offset + 1] = color.g;
      output[offset + 2] = color.b;
    }
  }
}

function clampCrop(
  crop: { left: number; top: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): { left: number; top: number; width: number; height: number } {
  const left = clamp(crop.left, 0, imageWidth - 1);
  const top = clamp(crop.top, 0, imageHeight - 1);
  return {
    left,
    top,
    width: clamp(crop.width, 1, imageWidth - left),
    height: clamp(crop.height, 1, imageHeight - top),
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
