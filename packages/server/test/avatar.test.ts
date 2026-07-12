// Feature-driven avatar: draws a pixel face from FaceFeatures alone (no photo).
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { HEAD_SPRITE_SIZES, PORTRAIT_SIZE } from '@sparkade/shared';
import { drawAvatarLikeness } from '../src/likeness/avatar';
import type { FaceFeatures } from '../src/likeness/features';

const base: FaceFeatures = {
  skinTone: '#c98f6b',
  hairColor: '#2a2320',
  glasses: false,
  facialHair: false,
  headwear: false,
  headwearColor: 'none',
};

describe('drawAvatarLikeness', () => {
  it('produces correctly sized, oval-masked PNGs from traits alone (no photo)', async () => {
    const a = await drawAvatarLikeness(base);
    for (const [buf, size] of [
      [a.head12, HEAD_SPRITE_SIZES[0]],
      [a.head16, HEAD_SPRITE_SIZES[1]],
      [a.portrait, PORTRAIT_SIZE],
    ] as const) {
      const img = sharp(buf);
      const meta = await img.metadata();
      expect(meta.width).toBe(size);
      expect(meta.height).toBe(size);
      const raw = await img.ensureAlpha().raw().toBuffer();
      const alphaAt = (x: number, y: number) => raw[(y * size + x) * 4 + 3]!;
      expect(alphaAt(0, 0)).toBe(0); // corner transparent — oval mask
      expect(alphaAt(size - 1, size - 1)).toBe(0);
      expect(alphaAt(Math.floor(size / 2), Math.floor(size / 2))).toBe(255); // face centre opaque
    }
  });

  it('shows the detected skin tone on the cheek (warm: red > blue)', async () => {
    const size = PORTRAIT_SIZE;
    const raw = await sharp((await drawAvatarLikeness({ ...base, skinTone: '#8d5a34' })).portrait)
      .ensureAlpha()
      .raw()
      .toBuffer();
    // a cheek pixel: left of centre, below the eyes but above the mouth
    const x = Math.round(size * 0.34);
    const y = Math.round(size * 0.6);
    const i = (y * size + x) * 4;
    expect(raw[i + 3]).toBe(255);
    expect(raw[i]!).toBeGreaterThan(raw[i + 2]!);
  });

  it('varies with traits (glasses + headwear change the pixels)', async () => {
    const plain = await drawAvatarLikeness(base);
    const decorated = await drawAvatarLikeness({ ...base, glasses: true, headwear: true, headwearColor: '#33445e' });
    expect(Buffer.compare(plain.portrait, decorated.portrait)).not.toBe(0);
  });

  it('never throws on empty/garbage features (graceful for the mock provider)', async () => {
    await expect(drawAvatarLikeness({} as FaceFeatures)).resolves.toBeTruthy();
  });
});
