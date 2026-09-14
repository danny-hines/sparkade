// Dedicated connected-component tests for splitRacingStripCells: three major
// craft silhouettes ordered left-to-right, robust to banking tips that share
// X ranges at different Y. Synthetic SVG fixtures only, plus the must-pass
// live provider strips (skipped when absent).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { splitRacingStripCells } from '../src/assets/racing-craft';
import { isFighterGreenScreenPixel } from '../src/assets/fighter-pose';

const LIVE_NEON = join(
  __dirname,
  '..',
  '..',
  '..',
  'data',
  'experiments',
  'racing-identity',
  'live',
  'neon',
);

async function svgStrip(width: number, height: number, bodies: string): Promise<Buffer> {
  return sharp(
    Buffer.from(
      `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#00ff00"/>${bodies}</svg>`,
    ),
  )
    .png()
    .toBuffer();
}

const rect = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

interface SubjectStats {
  count: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
}

/** Subject-pixel bbox/centroid of a cell under the production key predicate. */
async function subjectStats(cell: Buffer): Promise<SubjectStats> {
  const { data, info } = await sharp(cell)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stats: SubjectStats = {
    count: 0,
    left: info.width,
    top: info.height,
    right: -1,
    bottom: -1,
    cx: 0,
  };
  let sumX = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * 4;
      if (data[o + 3]! <= 8) continue;
      if (isFighterGreenScreenPixel(data[o]!, data[o + 1]!, data[o + 2]!)) continue;
      stats.count++;
      sumX += x;
      if (x < stats.left) stats.left = x;
      if (x > stats.right) stats.right = x;
      if (y < stats.top) stats.top = y;
      if (y > stats.bottom) stats.bottom = y;
    }
  }
  stats.cx = stats.count ? sumX / stats.count : 0;
  return stats;
}

describe('splitRacingStripCells connected components', () => {
  it('separates poses whose X ranges overlap at different Y, preserving full tips', async () => {
    const source = await svgStrip(
      600,
      200,
      rect(30, 20, 150, 90, '#334488') +
        rect(150, 120, 150, 70, '#883344') +
        rect(400, 50, 150, 110, '#448833'),
    );
    const { cells, bounds } = await splitRacingStripCells(source);
    expect(cells).toHaveLength(3);
    const stats = await Promise.all(cells.map((c) => subjectStats(c)));
    // Left-to-right order by image-space centroid.
    const imageCx = stats.map((s, i) => bounds[i]!.left + s.cx);
    expect(imageCx[0]).toBeLessThan(imageCx[1]!);
    expect(imageCx[1]).toBeLessThan(imageCx[2]!);
    // Full tips: exact source spans, no neighbor bleed, no invented pixels.
    expect(stats[0]!.right - stats[0]!.left + 1).toBe(150);
    expect(stats[0]!.bottom - stats[0]!.top + 1).toBe(90);
    expect(stats[0]!.count).toBe(150 * 90);
    expect(stats[1]!.count).toBe(150 * 70);
    expect(stats[2]!.count).toBe(150 * 110);
    // Neighbor pixels inside an expanded margin are masked back to green:
    // cell 0 spans past x=150 in the image but holds no middle-pose pixels.
    const meta0 = await sharp(cells[0]!).metadata();
    expect(meta0.width!).toBeGreaterThan(150);
  });

  it('orders exactly three separated components left-to-right', async () => {
    const source = await svgStrip(
      600,
      200,
      rect(430, 40, 120, 100, '#334488') +
        rect(30, 60, 120, 100, '#883344') +
        rect(240, 50, 120, 100, '#448833'),
    );
    const { cells, bounds } = await splitRacingStripCells(source);
    expect(cells).toHaveLength(3);
    const stats = await Promise.all(cells.map((c) => subjectStats(c)));
    const imageCx = stats.map((s, i) => bounds[i]!.left + s.cx);
    expect(imageCx).toEqual([...imageCx].sort((a, b) => a - b));
    for (const s of stats) expect(s.count).toBe(120 * 100);
  });

  it('rejects a subject touching the sheet edge as cropped', async () => {
    const source = await svgStrip(
      600,
      200,
      rect(0, 60, 120, 100, '#334488') +
        rect(240, 50, 120, 100, '#883344') +
        rect(430, 40, 120, 100, '#448833'),
    );
    await expect(splitRacingStripCells(source)).rejects.toThrow(/sheet edge/);
  });

  it('rejects pixel-merged poses with no clear gutter', async () => {
    const source = await svgStrip(
      600,
      200,
      rect(100, 60, 150, 100, '#334488') +
        rect(200, 60, 150, 100, '#883344') +
        rect(420, 40, 120, 100, '#448833'),
    );
    await expect(splitRacingStripCells(source)).rejects.toThrow(/no clear gutter/);
  });

  it('pads a missing pose with green instead of substituting', async () => {
    const source = await svgStrip(
      600,
      200,
      rect(30, 60, 120, 100, '#334488') +
        rect(240, 50, 120, 100, '#883344'),
    );
    const { cells } = await splitRacingStripCells(source);
    expect(cells).toHaveLength(3);
    const stats = await Promise.all(cells.map((c) => subjectStats(c)));
    expect(stats[0]!.count).toBe(120 * 100);
    expect(stats[1]!.count).toBe(120 * 100);
    expect(stats[2]!.count).toBe(0);
  });

  it('ignores disconnected tiny glow specks', async () => {
    const source = await svgStrip(
      600,
      200,
      rect(30, 60, 120, 100, '#334488') +
        rect(240, 50, 120, 100, '#883344') +
        rect(430, 40, 120, 100, '#448833') +
        rect(180, 10, 3, 3, '#7af0ff') +
        rect(395, 180, 4, 4, '#7af0ff') +
        rect(300, 10, 2, 2, '#ffd21f'),
    );
    const { cells } = await splitRacingStripCells(source);
    expect(cells).toHaveLength(3);
    const stats = await Promise.all(cells.map((c) => subjectStats(c)));
    expect(stats.map((s) => s.count)).toEqual([120 * 100, 120 * 100, 120 * 100]);
  });

  it('reassociates a nearby meaningful island with its silhouette', async () => {
    const source = await svgStrip(
      600,
      200,
      rect(30, 60, 120, 100, '#334488') +
        rect(240, 50, 120, 100, '#883344') +
        rect(430, 40, 120, 100, '#448833') +
        rect(363, 80, 12, 12, '#883344'),
    );
    const { cells } = await splitRacingStripCells(source);
    expect(cells).toHaveLength(3);
    const stats = await Promise.all(cells.map((c) => subjectStats(c)));
    // Middle cell keeps the craft plus the 12x12 island 3px off its edge.
    expect(stats[1]!.count).toBe(120 * 100 + 12 * 12);
    expect(stats[1]!.right - stats[1]!.left + 1).toBe(135);
  });

  it.each([
    ['raw-attempt-4/3.png', 'attempt-4 #3 banked hauler'],
    ['raw-attempt-2/3.png', 'attempt-2 #3 finned courier'],
    ['raw-attempt-2/4.png', 'attempt-2 #4 finned courier'],
  ])('segments live %s into three ordered non-empty cells', async (file) => {
    const path = join(LIVE_NEON, file);
    if (!existsSync(path)) return;
    const { cells, bounds } = await splitRacingStripCells(await readFile(path));
    expect(cells).toHaveLength(3);
    expect(bounds).toHaveLength(3);
    const stats = await Promise.all(cells.map((c) => subjectStats(c)));
    for (const s of stats) expect(s.count).toBeGreaterThan(1000);
    const imageCx = stats.map((s, i) => bounds[i]!.left + s.cx);
    expect(imageCx[0]).toBeLessThan(imageCx[1]!);
    expect(imageCx[1]).toBeLessThan(imageCx[2]!);
  });
});
