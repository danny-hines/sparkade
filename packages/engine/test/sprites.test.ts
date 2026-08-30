import { describe, expect, it } from 'vitest';
import { outlineRgbaPixels } from '../src/sprites';

describe('sprite visibility treatments', () => {
  it('adds one crisp 8-connected contour pixel while preserving the authored sprite', () => {
    const source = new Uint8ClampedArray(5 * 5 * 4);
    const center = (2 * 5 + 2) * 4;
    source.set([224, 176, 128, 255], center);

    const outlined = outlineRgbaPixels(source, 5, 5, '#090c18');
    const opaque: Array<{ x: number; y: number; rgba: number[] }> = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const offset = (y * 5 + x) * 4;
        if (outlined[offset + 3] === 0) continue;
        opaque.push({ x, y, rgba: Array.from(outlined.slice(offset, offset + 4)) });
      }
    }

    expect(opaque).toHaveLength(9);
    expect(opaque.find(({ x, y }) => x === 2 && y === 2)?.rgba).toEqual([224, 176, 128, 255]);
    expect(opaque.find(({ x, y }) => x === 1 && y === 1)?.rgba).toEqual([9, 12, 24, 255]);
    expect(opaque.some(({ x, y }) => x === 0 || y === 0 || x === 4 || y === 4)).toBe(false);
  });
});
