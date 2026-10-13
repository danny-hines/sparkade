import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  alignSprites,
  ditherInbetween,
  flowInbetween,
  type RgbaSprite,
} from '../src/assets/platformer-inbetween';

/** A two-color 16x40 figure (red top, blue bottom) at `left` on a 64x48 canvas. */
async function figure(left: number, width = 64): Promise<Buffer> {
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48" shape-rendering="crispEdges"><rect x="${left}" y="8" width="16" height="20" fill="#c0392b"/><rect x="${left}" y="28" width="16" height="20" fill="#2e4b8f"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}

function stats(sprite: RgbaSprite) {
  let count = 0;
  let sumX = 0;
  let left = sprite.width;
  let right = -1;
  const colors = new Set<string>();
  for (let y = 0; y < sprite.height; y++)
    for (let x = 0; x < sprite.width; x++) {
      const o = (y * sprite.width + x) * 4;
      if (sprite.data[o + 3]! <= 8) continue;
      count++;
      sumX += x;
      left = Math.min(left, x);
      right = Math.max(right, x);
      colors.add(`${sprite.data[o]},${sprite.data[o + 1]},${sprite.data[o + 2]}`);
    }
  return { count, centerX: sumX / count, left, right, colors };
}

describe('procedural in-between frames', () => {
  it('aligns sprites of different widths centered on one bottom-anchored canvas', async () => {
    const [narrow, wide] = await alignSprites([await figure(4, 32), await figure(24, 64)]);
    expect(narrow!.width).toBe(64);
    expect(wide!.width).toBe(64);
    expect(stats(narrow!).left).toBe(16 + 4);
  });

  it('moves pixels halfway with the original colors and no holes', async () => {
    const [a, b] = await alignSprites([await figure(10), await figure(30)]);
    const half = flowInbetween(a!, b!);
    const s = stats(half);
    expect(Math.abs(s.centerX - 27.5)).toBeLessThanOrEqual(1);
    expect(s.count).toBe(16 * 40);
    expect([...s.colors].sort()).toEqual([...stats(a!).colors].sort());
  });

  it('interleaves two frames on a checkerboard without new colors', async () => {
    const [a, b] = await alignSprites([await figure(10), await figure(18)]);
    const smear = ditherInbetween(a!, b!);
    const s = stats(smear);
    expect(s.left).toBe(10);
    expect(s.right).toBe(18 + 15);
    expect(s.count).toBeLessThan(stats(a!).count + stats(b!).count);
    for (const color of s.colors) expect(stats(a!).colors.has(color)).toBe(true);
  });
});
