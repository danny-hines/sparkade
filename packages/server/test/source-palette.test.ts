import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  buildSourcePalette,
  indexImageToSourcePalette,
} from '../src/assets/source-palette';

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function near(palette: readonly string[], target: [number, number, number]): boolean {
  return palette.some((color) => {
    const value = rgb(color);
    return Math.hypot(value[0] - target[0], value[1] - target[1], value[2] - target[2]) < 24;
  });
}

describe('source-color sprite palettes', () => {
  it('retains saturated colors from equally weighted source roles', async () => {
    const image = (background: string) =>
      sharp({ create: { width: 32, height: 32, channels: 4, background } }).png().toBuffer();
    const palette = await buildSourcePalette([
      await image('#f02050'),
      await image('#20d070'),
      await image('#2080f0'),
    ]);

    expect(palette).toHaveLength(16);
    expect(palette[0]).toBe('#000000');
    expect(near(palette.slice(1), [240, 32, 80])).toBe(true);
    expect(near(palette.slice(1), [32, 208, 112])).toBe(true);
    expect(near(palette.slice(1), [32, 128, 240])).toBe(true);
  });

  it('indexes opaque pixels locally while preserving transparent pixels', async () => {
    const image = await sharp({
      create: { width: 2, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 1, height: 1, channels: 4, background: '#f02050' },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const palette = [
      '#000000',
      '#101010',
      '#f02050',
      ...Array(13).fill('#ffffff'),
    ];

    const indexed = await indexImageToSourcePalette(image, palette);
    expect(indexed).toEqual({ w: 2, h: 1, rows: ['2.'] });
  });
});
