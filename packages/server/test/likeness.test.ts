// Likeness bake: geometry, palette fidelity, oval mask, outline. Uses a
// synthetic face positioned exactly in the capture guide (LIKENESS_OVAL).
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { HEAD_SPRITE_SIZES, PORTRAIT_SIZE } from '@sparkade/shared';
import { bakeLikeness } from '../src/likeness/likeness';
import { buildPortraitPalette, type FaceFeatures } from '../src/likeness/features';

const PALETTE = [
  '#000000', '#1a1c2c', '#29366f', '#3b5dc9', '#41a6f6', '#38b764', '#a7f070', '#ffcd75',
  '#b13e53', '#ef7d57', '#5d275d', '#e04040', '#ffa300', '#ffd75e', '#94b0c2', '#f4f4f4',
];

async function testFace(): Promise<Buffer> {
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" fill="#607080"/>
    <ellipse cx="256" cy="230" rx="105" ry="140" fill="#dda877"/>
    <circle cx="216" cy="215" r="14" fill="#222222"/>
    <circle cx="296" cy="215" r="14" fill="#222222"/>
    <rect x="215" y="300" width="82" height="14" rx="7" fill="#8f4a3d"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

describe('likeness bake', () => {
  it('produces correctly sized PNGs with an oval mask and outline', async () => {
    const baked = await bakeLikeness(await testFace(), PALETTE);
    for (const [buf, size] of [
      [baked.head12, HEAD_SPRITE_SIZES[0]],
      [baked.head16, HEAD_SPRITE_SIZES[1]],
      [baked.portrait, PORTRAIT_SIZE],
    ] as const) {
      const img = sharp(buf);
      const meta = await img.metadata();
      expect(meta.width).toBe(size);
      expect(meta.height).toBe(size);
      const raw = await img.ensureAlpha().raw().toBuffer();
      // corners transparent (outside the oval), center opaque
      const alphaAt = (x: number, y: number) => raw[(y * size + x) * 4 + 3]!;
      expect(alphaAt(0, 0)).toBe(0);
      expect(alphaAt(size - 1, size - 1)).toBe(0);
      expect(alphaAt(Math.floor(size / 2), Math.floor(size / 2))).toBe(255);
      // every opaque pixel is exactly a palette color (indices 1..15)
      const paletteSet = new Set(PALETTE.slice(1).map((h) => h.toLowerCase()));
      for (let i = 0; i < size * size; i++) {
        if (raw[i * 4 + 3] === 0) continue;
        const hex = `#${[raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2]]
          .map((v) => v!.toString(16).padStart(2, '0'))
          .join('')}`;
        expect(paletteSet.has(hex), `pixel ${i} color ${hex}`).toBe(true);
      }
      // the outline color (palette[1]) appears on the oval rim
      const topEdgeIsOutline = (() => {
        for (let x = 0; x < size; x++) {
          for (let y = 0; y < size; y++) {
            if (alphaAt(x, y) === 255) {
              const i = (y * size + x) * 4;
              const hex = `#${[raw[i], raw[i + 1], raw[i + 2]].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
              return hex === PALETTE[1];
            }
          }
        }
        return false;
      })();
      expect(topEdgeIsOutline).toBe(true);
    }
  });

  it('the face fills the crop: skin tones dominate the portrait interior', async () => {
    const baked = await bakeLikeness(await testFace(), PALETTE);
    const size = PORTRAIT_SIZE;
    const raw = await sharp(baked.portrait).ensureAlpha().raw().toBuffer();
    // Sample the middle band; warm (skin-mapped) pixels should outnumber cool
    // (background-mapped) ones by a wide margin — the old crop failed this.
    let warm = 0;
    let cool = 0;
    for (let y = 20; y < 44; y++) {
      for (let x = 16; x < 48; x++) {
        const i = (y * size + x) * 4;
        if (raw[i + 3] === 0) continue;
        if (raw[i]! > raw[i + 2]!) warm++;
        else cool++;
      }
    }
    expect(warm).toBeGreaterThan(cool * 3);
  });
});

const face: FaceFeatures = {
  skinTone: '#c98f6b',
  hairColor: '#3a2a1e',
  facialHairColor: 'none',
  glasses: false,
  facialHair: 'none',
  headwear: false,
  headwearColor: 'none',
};

describe('buildPortraitPalette', () => {
  it('centers the palette on the detected skin + hair, all valid hex', () => {
    const p = buildPortraitPalette(face);
    expect(p).toHaveLength(16);
    expect(p[4]).toBe('#c98f6b'); // skin base
    expect(p[7]).toBe('#3a2a1e'); // hair base
    expect(p[0]).toBe('#000000'); // unused transparent slot
    expect(p.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });

  it('normalizes shorthand/uppercase hex and falls back on garbage', () => {
    const p = buildPortraitPalette({ ...face, skinTone: 'ABC', hairColor: 'not-a-color' });
    expect(p[4]).toBe('#aabbcc'); // 'ABC' → #aabbcc
    expect(p[7]).toBe('#2a2320'); // hair fallback
  });

  it('derives hair from skin when bald instead of using the fallback brown', () => {
    const p = buildPortraitPalette({ ...face, skinTone: '#8d5524', hairColor: 'none' });
    expect(p[7]).toMatch(/^#[0-9a-f]{6}$/);
    expect(p[7]).not.toBe('#2a2320');
  });

  it('uses the headwear colour only when headwear is present', () => {
    const off = buildPortraitPalette({ ...face, headwear: false, headwearColor: '#ff0000' });
    const on = buildPortraitPalette({ ...face, headwear: true, headwearColor: '#ff0000' });
    expect(off[11]).toBe(off[7]); // no headwear → slot mirrors hair
    expect(on[11]).toBe('#ff0000');
  });

  it('never throws on empty/garbage input (graceful for the mock provider)', () => {
    const p = buildPortraitPalette({} as FaceFeatures);
    expect(p).toHaveLength(16);
    expect(p.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });
});
