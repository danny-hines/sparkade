import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { describeVisibleTraits, extractGeneratedHead } from '../src/likeness/portrait-gen';
import type { FaceFeatures } from '../src/likeness/features';

describe('generated likeness heads', () => {
  it('describes occluded hair without inventing baldness', () => {
    const features = {
      hairStyle: 'hidden',
      hairColor: '#2a2320',
      headwear: true,
      facialHair: 'stubble',
      glasses: true,
    } as FaceFeatures;
    const phrase = describeVisibleTraits(features);
    expect(phrase).toContain('scalp hair fully hidden');
    expect(phrase).not.toMatch(/\bbald\b/);
    expect(phrase).toContain('stubble');
    expect(phrase).toContain('glasses');
  });

  it('removes all generated green-screen regions, including enclosed ones', async () => {
    const width = 64;
    const height = 64;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const inHead = x >= 16 && x <= 47 && y >= 10 && y <= 53;
        raw[offset] = inHead ? 201 : 0;
        raw[offset + 1] = inHead ? 143 : 255;
        raw[offset + 2] = inHead ? 107 : 0;
        raw[offset + 3] = 255;
      }
    }
    // Models sometimes surround a patch of background with their outline, so
    // the key removal cannot depend on edge connectivity.
    const interior = (30 * width + 30) * 4;
    raw[interior] = 0;
    raw[interior + 1] = 255;
    raw[interior + 2] = 0;

    const source = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const cutout = await extractGeneratedHead(source);
    const image = sharp(cutout);
    const meta = await image.metadata();
    expect(meta.width).toBe(meta.height);
    expect(meta.width).toBeGreaterThan(44);
    const pixels = await image.ensureAlpha().raw().toBuffer();
    expect(pixels[3]).toBe(0);
    let opaqueGreen = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 0 && pixels[i + 1] === 255 && pixels[i + 2] === 0 && pixels[i + 3] === 255) opaqueGreen++;
    }
    expect(opaqueGreen).toBe(0);
  });
});
