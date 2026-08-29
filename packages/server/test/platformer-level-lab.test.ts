import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  PLATFORMER_LEVEL_LAB_COLORS,
  PLATFORMER_LEVEL_LAB_HEIGHT,
  PLATFORMER_LEVEL_LAB_IMAGE_HEIGHT,
  PLATFORMER_LEVEL_LAB_IMAGE_WIDTH,
  PLATFORMER_LEVEL_LAB_WIDTH,
  parseAndRepairPlatformerLevelLayout,
  processPlatformerLevelHydration,
  validatePlatformerLabLevel,
} from '../src/assets/platformer-level-lab';

describe('platformer level design lab', () => {
  it('registers and parses a framed Muse-style color map into a valid level', async () => {
    const image = await framedLayoutFixture(false);
    const parsed = await parseAndRepairPlatformerLevelLayout(image, 'Fixture Run');

    expect(parsed.metrics.registration).toBe('frame');
    expect(parsed.metrics.confidentCellRatio).toBe(1);
    expect(parsed.level.tiles).toHaveLength(PLATFORMER_LEVEL_LAB_HEIGHT);
    expect(parsed.level.tiles.every((row) => row.length === PLATFORMER_LEVEL_LAB_WIDTH)).toBe(true);
    expect(parsed.level.playerSpawn).toEqual({ x: 3, y: 16 });
    expect(parsed.level.exit).toEqual({ x: 92, y: 16 });
    expect(parsed.level.entities.some((entity) => entity.type === 'coin')).toBe(true);
    expect(parsed.level.entities.some((entity) => entity.type === 'powerup')).toBe(true);
    expect(validatePlatformerLabLevel(parsed.level)).toEqual([]);
    await expect(sharp(parsed.repairedPng).metadata()).resolves.toMatchObject({
      width: PLATFORMER_LEVEL_LAB_IMAGE_WIDTH,
      height: PLATFORMER_LEVEL_LAB_IMAGE_HEIGHT,
    });
    const hydrationGuide = await sharp(parsed.guidePng).removeAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
    const spawnOffset =
      ((parsed.level.playerSpawn.y * 16 + 8) * hydrationGuide.info.width +
        parsed.level.playerSpawn.x * 16 +
        8) *
      hydrationGuide.info.channels;
    expect([...hydrationGuide.data.subarray(spawnOffset, spawnOffset + 3)]).toEqual([255, 255, 255]);
  });

  it('bridges an impossible gap and records the deterministic repair', async () => {
    const image = await framedLayoutFixture(true);
    const parsed = await parseAndRepairPlatformerLevelLayout(image, 'Broken Fixture');

    expect(parsed.metrics.issuesBefore).toContain('exit is unreachable');
    expect(parsed.metrics.repairs.join(' ')).toMatch(/bridged|safety route/);
    expect(parsed.metrics.changedCells).toBeGreaterThan(0);
    expect(parsed.metrics.issuesAfter).toEqual([]);
    expect(validatePlatformerLabLevel(parsed.level)).toEqual([]);
  });

  it('rejects decorative palette usage even when route repair makes it playable', async () => {
    const image = await framedLayoutFixture(false, true);
    const parsed = await parseAndRepairPlatformerLevelLayout(image, 'Palette Chaos');

    expect(validatePlatformerLabLevel(parsed.level)).toEqual([]);
    expect(parsed.metrics.markerCounts.spawn).toBeGreaterThan(4);
    expect(parsed.metrics.markerCounts.exit).toBeGreaterThan(4);
    expect(parsed.metrics.issuesAfter.join(' ')).toMatch(/marker density is implausible/);
    expect(parsed.metrics.score).toBeLessThan(60);
  });

  it('clips untrusted hydrated paint to the canonical collision mask', async () => {
    const parsed = await parseAndRepairPlatformerLevelLayout(
      await framedLayoutFixture(false),
      'Hydration Fixture',
    );
    const paintedEverywhere = await sharp({
      create: {
        width: 900,
        height: 400,
        channels: 3,
        background: '#315a78',
      },
    })
      .png()
      .toBuffer();
    const result = await processPlatformerLevelHydration(paintedEverywhere, parsed.level);
    const safe = await sharp(result.safeTerrain).raw().toBuffer({ resolveWithObject: true });
    const exact = await sharp(result.exactTerrain).raw().toBuffer({ resolveWithObject: true });
    const outline = await sharp(result.darkOutline).raw().toBuffer({ resolveWithObject: true });
    const airOffset = (0 * safe.info.width + 0) * safe.info.channels;
    const groundOffset =
      ((PLATFORMER_LEVEL_LAB_HEIGHT - 1) * 16 * safe.info.width + 3 * 16) * safe.info.channels;
    const groundTop = (PLATFORMER_LEVEL_LAB_HEIGHT - 1) * 16;
    const fringeOffset = ((groundTop - 2) * safe.info.width + 10 * 16) * safe.info.channels;
    const beyondFringeOffset =
      ((groundTop - 6) * safe.info.width + 10 * 16) * safe.info.channels;
    const outlineOffset = ((groundTop - 5) * safe.info.width + 10 * 16) * safe.info.channels;

    expect(safe.info.channels).toBe(4);
    expect(safe.data[airOffset + 3]).toBe(0);
    expect(safe.data[groundOffset + 3]).toBe(255);
    expect(exact.data[fringeOffset + 3]).toBe(0);
    expect(safe.data[fringeOffset + 3]).toBe(255);
    expect(safe.data[beyondFringeOffset + 3]).toBe(0);
    expect(outline.data[outlineOffset + 3]).toBeGreaterThan(0);
    expect(result.metrics.falsePositiveRatio).toBeGreaterThan(0.9);
    expect(result.metrics.fringeUsageRatio).toBe(1);
    expect(result.metrics.fringe).toEqual({ topPx: 4, sidePx: 1, bottomPx: 2 });
    expect(result.metrics.exactCollisionMask).toBe(true);
  });

  it('replaces untouched white matte inside collision with a generated-palette underfill', async () => {
    const parsed = await parseAndRepairPlatformerLevelLayout(
      await framedLayoutFixture(false),
      'Incomplete Hydration Fixture',
    );
    const width = PLATFORMER_LEVEL_LAB_IMAGE_WIDTH;
    const height = PLATFORMER_LEVEL_LAB_IMAGE_HEIGHT;
    const groundTop = (PLATFORMER_LEVEL_LAB_HEIGHT - 1) * 16;
    const bronzeStrip = await sharp({
      create: { width, height: 4, channels: 3, background: '#9a6135' },
    })
      .png()
      .toBuffer();
    const incompleteTerrain = await sharp({
      create: { width, height, channels: 3, background: '#ffffff' },
    })
      .composite([{ input: bronzeStrip, left: 0, top: groundTop }])
      .png()
      .toBuffer();

    const result = await processPlatformerLevelHydration(incompleteTerrain, parsed.level);
    const safe = await sharp(result.safeTerrain).raw().toBuffer({ resolveWithObject: true });
    const airOffset = (3 * safe.info.width + 3) * safe.info.channels;
    const filledOffset = ((groundTop + 12) * safe.info.width + 12 * 16) * safe.info.channels;
    const filledRgb = [...safe.data.subarray(filledOffset, filledOffset + 3)];

    expect(safe.data[airOffset + 3]).toBe(0);
    expect(safe.data[filledOffset + 3]).toBe(255);
    expect(filledRgb).not.toEqual([255, 255, 255]);
    expect(Math.max(...filledRgb)).toBeLessThan(220);
    expect(result.metrics.missingTerrainRatio).toBeGreaterThan(0.5);
  });

  it('moves bottom-anchored one-way platform art to the collision surface', async () => {
    const parsed = await parseAndRepairPlatformerLevelLayout(
      await framedLayoutFixture(false),
      'Platform Alignment Fixture',
    );
    let platformY = -1;
    let platformStartX = -1;
    for (let y = 0; y < parsed.level.tiles.length && platformY < 0; y++) {
      const row = parsed.level.tiles[y]!;
      for (let x = 0; x < row.length; x++) {
        if (parsed.level.legend[row[x]!] === 'platform') {
          platformY = y;
          platformStartX = x;
          break;
        }
      }
    }
    expect(platformY).toBeGreaterThanOrEqual(0);
    expect(platformStartX).toBeGreaterThanOrEqual(0);
    let platformEndX = platformStartX;
    const platformRow = parsed.level.tiles[platformY]!;
    while (
      platformEndX + 1 < platformRow.length &&
      parsed.level.legend[platformRow[platformEndX + 1]!] === 'platform'
    ) {
      platformEndX++;
    }

    const width = PLATFORMER_LEVEL_LAB_IMAGE_WIDTH;
    const height = PLATFORMER_LEVEL_LAB_IMAGE_HEIGHT;
    const left = platformStartX * 16;
    const top = platformY * 16;
    const strip = await sharp({
      create: {
        width: (platformEndX - platformStartX + 1) * 16,
        height: 4,
        channels: 3,
        background: '#2e82d2',
      },
    })
      .png()
      .toBuffer();
    const bottomAnchored = await sharp({
      create: { width, height, channels: 3, background: '#ffffff' },
    })
      .composite([{ input: strip, left, top: top + 12 }])
      .png()
      .toBuffer();

    const result = await processPlatformerLevelHydration(bottomAnchored, parsed.level);
    const safe = await sharp(result.safeTerrain).raw().toBuffer({ resolveWithObject: true });
    const surfaceOffset = (top * width + left + 8) * safe.info.channels;
    const formerBottomOffset = ((top + 14) * width + left + 8) * safe.info.channels;

    expect([...safe.data.subarray(surfaceOffset, surfaceOffset + 3)]).toEqual([46, 130, 210]);
    expect([...safe.data.subarray(formerBottomOffset, formerBottomOffset + 3)]).not.toEqual([
      46, 130, 210,
    ]);
    expect(result.metrics.surfaceAlignment.runsShifted).toBeGreaterThanOrEqual(1);
    expect(result.metrics.surfaceAlignment.meanShiftPx).toBeGreaterThanOrEqual(8);
  });
});

async function framedLayoutFixture(impossibleGap: boolean, paletteChaos = false): Promise<Buffer> {
  const width = PLATFORMER_LEVEL_LAB_WIDTH + 2;
  const height = PLATFORMER_LEVEL_LAB_HEIGHT + 2;
  const cells: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => PLATFORMER_LEVEL_LAB_COLORS.empty),
  );
  for (let x = 0; x < width; x++) {
    cells[0]![x] = PLATFORMER_LEVEL_LAB_COLORS.frame;
    cells[height - 1]![x] = PLATFORMER_LEVEL_LAB_COLORS.frame;
  }
  for (let y = 0; y < height; y++) {
    cells[y]![0] = PLATFORMER_LEVEL_LAB_COLORS.frame;
    cells[y]![width - 1] = PLATFORMER_LEVEL_LAB_COLORS.frame;
  }
  for (let x = 1; x < width - 1; x++) {
    const logicalX = x - 1;
    if (!impossibleGap || logicalX < 26 || logicalX > 44) {
      cells[PLATFORMER_LEVEL_LAB_HEIGHT]![x] = PLATFORMER_LEVEL_LAB_COLORS.solid;
    }
  }
  cells[17]![4] = PLATFORMER_LEVEL_LAB_COLORS.spawn;
  cells[17]![93] = PLATFORMER_LEVEL_LAB_COLORS.exit;
  cells[17]![49] = PLATFORMER_LEVEL_LAB_COLORS.checkpoint;
  cells[15]![18] = PLATFORMER_LEVEL_LAB_COLORS.coin;
  cells[14]![72] = PLATFORMER_LEVEL_LAB_COLORS.powerup;
  cells[16]![30] = PLATFORMER_LEVEL_LAB_COLORS.platform;
  cells[16]![31] = PLATFORMER_LEVEL_LAB_COLORS.platform;
  cells[16]![32] = PLATFORMER_LEVEL_LAB_COLORS.platform;
  if (paletteChaos) {
    for (let y = 2; y < 7; y++) {
      for (let x = 12; x < 44; x++) {
        cells[y]![x] =
          (x + y) % 2 === 0
            ? PLATFORMER_LEVEL_LAB_COLORS.spawn
            : PLATFORMER_LEVEL_LAB_COLORS.exit;
      }
    }
  }

  const cellSize = 8;
  const raw = Buffer.alloc(width * cellSize * height * cellSize * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = hexRgb(cells[y]![x]!);
      for (let py = y * cellSize; py < (y + 1) * cellSize; py++) {
        for (let px = x * cellSize; px < (x + 1) * cellSize; px++) {
          const offset = (py * width * cellSize + px) * 3;
          raw[offset] = rgb.r;
          raw[offset + 1] = rgb.g;
          raw[offset + 2] = rgb.b;
        }
      }
    }
  }
  return sharp(raw, {
    raw: { width: width * cellSize, height: height * cellSize, channels: 3 },
  })
    .png()
    .toBuffer();
}

function hexRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}
