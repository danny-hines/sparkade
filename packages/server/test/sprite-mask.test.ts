import { describe, expect, it } from 'vitest';
import { formats, recordsOfKind } from '@meta-sam/parser';
import { applySamMask, despillSpriteBoundary, hybridSpriteMask } from '../src/assets/sprite-mask';
import { normalizeMaskedPlatformerPose } from '../src/assets/platformer-pose';
import fixture from './fixtures/sam/curly-silhouette.json';
import sharp from 'sharp';

export function curlyMask() {
  const parser = formats.segmentation.image().createParser();
  parser.push(fixture.wire);
  return recordsOfKind(parser.finish({ status: 'completed' }).result.records, 'mask')[0]!;
}

describe('sprite mask application and normalization', () => {
  it('maps the entire raster to its returned box without cover-cropping a differing aspect ratio', async () => {
    const source = { data: Buffer.alloc(28 * 24 * 4, 255), width: 28, height: 24 };
    const result = await applySamMask(source, {
      ...curlyMask(),
      bounds: { left: 3, top: 4, right: 23, bottom: 20 },
    });
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 28; x++) {
        const expected = x >= 3 && x < 23 && fixture.rows[y - 4]?.[Math.floor((x - 3) / 2)] === '#';
        expect(result.data[(y * 28 + x) * 4 + 3], `${x},${y}`).toBe(expected ? 255 : 0);
      }
    }
  });

  it('places the crop at the source offset and retains wisps, holes, green pixels and existing alpha', async () => {
    const data = Buffer.alloc(24 * 24 * 4);
    for (let p = 0; p < 24 * 24; p++) data.set([0, 255, 0, 255], p * 4);
    data[(5 * 24 + 8) * 4 + 3] = 120;
    const result = await applySamMask({ data, width: 24, height: 24 }, curlyMask());
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const foreground = fixture.rows[y - 4]?.[x - 7] === '#';
        const alpha = result.data[(y * 24 + x) * 4 + 3];
        expect(alpha, `${x},${y}`).toBe(foreground ? (x === 8 && y === 5 ? 120 : 255) : 0);
      }
    const normalized = await normalizeMaskedPlatformerPose(result);
    const { data: output } = await sharp(normalized.png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...output].filter((_v, i) => i % 4 === 3 && output[i]! > 0).length).toBeGreaterThan(
      100,
    );
    expect(
      [...output].some((_v, i) => i % 4 === 0 && output[i + 1] === 255 && output[i + 3]! > 0),
    ).toBe(true);
  });
  it('recolors only a one-pixel boundary without shrinking curls or removing interior green', async () => {
    const data = Buffer.alloc(24 * 24 * 4);
    for (let p = 0; p < 24 * 24; p++) data.set([35, 110, 20, 255], p * 4);
    const masked = await applySamMask({ data, width: 24, height: 24 }, curlyMask());
    const { image, changedPixels } = despillSpriteBoundary(masked);
    expect(changedPixels).toBeGreaterThan(0);
    expect(image.data[(4 * 24 + 9) * 4 + 1]).toBe(35); // thin curl at the top
    expect(image.data[(9 * 24 + 12) * 4 + 1]).toBe(110); // protected interior
    for (let i = 3; i < data.length; i += 4) expect(image.data[i]).toBe(masked.data[i]);
    expect(masked.data[(4 * 24 + 9) * 4 + 1]).toBe(110); // input is immutable
  });
  it('rejects empty foreground and masks outside the image', async () => {
    const source = { data: Buffer.alloc(24 * 24 * 4), width: 24, height: 24 };
    await expect(normalizeMaskedPlatformerPose(source)).rejects.toMatchObject({
      code: 'empty-subject',
    });
    await expect(
      applySamMask(source, { ...curlyMask(), bounds: { left: 0, top: 0, right: 25, bottom: 24 } }),
    ).rejects.toThrow('outside');
  });
});

describe('SAM-guided chroma boundary', () => {
  function example() {
    const source = { data: Buffer.alloc(32 * 32 * 4), width: 32, height: 32 };
    const sam = { ...source, data: Buffer.alloc(source.data.length) };
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        source.data.set([0, 255, 0, 255], (y * 32 + x) * 4);
        if (x >= 6 && x <= 25 && y >= 6 && y <= 25) {
          sam.data.set([60, 30, 10, 255], (y * 32 + x) * 4);
          source.data.set([60, 30, 10, 255], (y * 32 + x) * 4);
        }
      }
    return { source, sam };
  }
  const offset = (x: number, y: number) => (y * 32 + x) * 4;

  it('preserves an interior neon logo and alpha while removing bright and dark green in the edge band', () => {
    const { source, sam } = example();
    source.data.set([0, 255, 0, 180], offset(16, 16)); // shirt logo
    source.data.set([0, 255, 0, 255], offset(6, 10)); // bright background included by SAM
    source.data.set([10, 100, 5, 255], offset(7, 10)); // darker spill
    source.data.set([60, 165, 25, 120], offset(7, 12)); // mixed fringe: recolor, retain alpha
    const before = Buffer.from(source.data);
    const result = hybridSpriteMask(source, sam, { radius: 2 });
    expect([...result.image.data.subarray(offset(16, 16), offset(16, 16) + 4)]).toEqual([
      0, 255, 0, 180,
    ]);
    expect(result.image.data[offset(6, 10) + 3]).toBe(0);
    expect(result.image.data[offset(7, 10) + 3]).toBe(0);
    expect([...result.image.data.subarray(offset(7, 12), offset(7, 12) + 4)]).toEqual([
      60, 60, 25, 120,
    ]);
    expect(result.hybrid).toEqual({
      radius: 2,
      removedPixels: 2,
      restoredPixels: 0,
      despilledPixels: 1,
      protectedGreenPixels: 1,
    });
    expect(source.data).toEqual(before);
  });

  it('recovers clipped brown curls nearby, clears green gaps, and excludes distant content', () => {
    const { source, sam } = example();
    source.data.set([60, 30, 10, 120], offset(4, 10)); // clipped strand in outer band
    source.data.set([60, 30, 10, 255], offset(3, 10)); // outside recovery band
    sam.data.fill(0, offset(10, 10), offset(10, 10) + 4); // internal hole
    source.data.set([0, 255, 0, 255], offset(10, 10));
    source.data.set([0, 255, 0, 255], offset(11, 10)); // green beside hole, inside SAM
    const result = hybridSpriteMask(source, sam, { radius: 2 });
    expect(result.image.data[offset(4, 10) + 3]).toBe(120);
    for (const [x, y] of [
      [3, 10],
      [10, 10],
      [11, 10],
      [0, 0],
    ]) {
      expect(result.image.data[offset(x!, y!) + 3], `${x},${y}`).toBe(0);
    }
    expect(result.hybrid.restoredPixels).toBe(1);
    expect(result.hybrid.removedPixels).toBe(1);
  });

  it('matches a direct neighborhood oracle including the image border and multiple radii', () => {
    const { source, sam } = example();
    // Irregular mask with holes and disconnected strands, including on the image edge.
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        if ((x * 17 + y * 13) % 7 === 0) sam.data[offset(x, y) + 3] = 255;
        if ((x * 11 + y * 5) % 13 === 0) sam.data[offset(x, y) + 3] = 0;
      }
    for (const radius of [1, 2, 5, 24]) {
      const result = hybridSpriteMask(source, sam, { radius });
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          let any = false,
            all = true;
          for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++) {
              const foreground =
                x + dx >= 0 &&
                y + dy >= 0 &&
                x + dx < 32 &&
                y + dy < 32 &&
                sam.data[offset(x + dx, y + dy) + 3]! > 8;
              any ||= foreground;
              all &&= foreground;
            }
          const green = source.data[offset(x, y) + 1] === 255;
          expect(result.image.data[offset(x, y) + 3], `${radius}:${x},${y}`).toBe(
            any && (all || !green) ? 255 : 0,
          );
        }
    }
  });

  it('rejects non-green backgrounds and invalid radius or dimensions', () => {
    const { source, sam } = example();
    expect(() => hybridSpriteMask(source, sam, { radius: 0 })).toThrow('radius');
    expect(() => hybridSpriteMask(source, { ...sam, width: 31 })).toThrow('dimensions');
    for (let i = 0; i < source.data.length; i += 4) source.data.set([255, 255, 255, 255], i);
    expect(() => hybridSpriteMask(source, sam)).toThrow('green-screen');
  });
});
