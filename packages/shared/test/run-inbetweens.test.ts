import { describe, expect, it } from 'vitest';
import {
  RUN_INBETWEEN_T,
  alignRgbaFrames,
  buildRunInbetweens,
  runInbetween,
  type RgbaFrame,
} from '../src/run-inbetweens';

/** A 16x40 two-color figure (red top, blue bottom) at `left` on a `width`x48 canvas. */
function figure(left: number, width = 64): RgbaFrame {
  const data = new Uint8ClampedArray(width * 48 * 4);
  for (let y = 8; y < 48; y++)
    for (let x = left; x < left + 16; x++)
      data.set(y < 28 ? [192, 57, 43, 255] : [46, 75, 143, 255], (y * width + x) * 4);
  return { data, width, height: 48 };
}

function stats(frame: RgbaFrame) {
  let count = 0;
  let sumX = 0;
  const colors = new Set<string>();
  for (let p = 0; p < frame.width * frame.height; p++) {
    if (frame.data[p * 4 + 3]! <= 8) continue;
    count++;
    sumX += p % frame.width;
    colors.add(Array.from(frame.data.subarray(p * 4, p * 4 + 3)).join());
  }
  return { count, centerX: sumX / count, colors };
}

describe('run in-betweens', () => {
  it('pads frames to one canvas, centered with feet on the bottom row', () => {
    const [narrow] = alignRgbaFrames([figure(4, 32), figure(24, 64)]);
    expect(narrow!.width).toBe(64);
    expect(stats(narrow!).centerX).toBeCloseTo(16 + 4 + 7.5);
  });

  it('moves pixels the requested fraction of the way with original colors and no holes', () => {
    // An 18px move, within the 20px search: a third of it is 6px.
    const [from, to] = alignRgbaFrames([figure(10), figure(28)]);
    const third = runInbetween(from!, to!);
    expect(RUN_INBETWEEN_T).toBeCloseTo(1 / 3);
    expect(Math.abs(stats(third).centerX - (17.5 + 6))).toBeLessThanOrEqual(1);
    expect(stats(third).count).toBe(16 * 40);
    expect([...stats(third).colors].sort()).toEqual([...stats(from!).colors].sort());
  });

  it('builds both in-betweens deterministically on the shared canvas', () => {
    const frames = { walk1: figure(4, 48), sideIdle: figure(24, 64), walk2: figure(44, 64) };
    const first = buildRunInbetweens(frames);
    const second = buildRunInbetweens(frames);
    expect(first.runMid1.width).toBe(64);
    expect(first.runMid2.width).toBe(64);
    expect(Array.from(first.runMid1.data)).toEqual(Array.from(second.runMid1.data));
    // Each in-between leans from its contact toward the side idle.
    expect(stats(first.runMid1).centerX).toBeGreaterThan(
      stats(alignRgbaFrames([frames.walk1, frames.sideIdle])[0]!).centerX,
    );
    expect(stats(first.runMid2).centerX).toBeLessThan(44 + 7.5);
  });
});
