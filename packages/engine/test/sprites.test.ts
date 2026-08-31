import { describe, expect, it } from 'vitest';
import { outlineRgbaPixels, silhouetteAuraRgbaBands } from '../src/sprites';

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

  it('builds padded, exact silhouette distance bands without including the sprite', () => {
    const source = new Uint8ClampedArray(3 * 3 * 4);
    source[(1 * 3 + 1) * 4 + 3] = 255;

    const aura = silhouetteAuraRgbaBands(source, 3, 3, '#e0f8ff', 2);
    expect(aura).toMatchObject({ width: 7, height: 7, padding: 2 });

    const opaquePoints = (band: Uint8ClampedArray) => {
      const points: string[] = [];
      for (let y = 0; y < aura.height; y++) {
        for (let x = 0; x < aura.width; x++) {
          if (band[(y * aura.width + x) * 4 + 3]) points.push(`${x},${y}`);
        }
      }
      return points;
    };

    const inner = opaquePoints(aura.bands[0]!);
    const outer = opaquePoints(aura.bands[1]!);
    expect(inner).toHaveLength(8);
    expect(outer).toHaveLength(16);
    expect(inner).toContain('2,2');
    expect(outer).toContain('1,1');
    expect(inner).not.toContain('3,3');
    expect(outer).not.toContain('3,3');
    expect(
      Array.from(aura.bands[0]!.slice((2 * aura.width + 2) * 4, (2 * aura.width + 2) * 4 + 4)),
    ).toEqual([224, 248, 255, 255]);
  });
});
