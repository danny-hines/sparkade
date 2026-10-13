// Lab helpers for procedural in-between frames: PNG decoding and encoding for
// the gait review page, the shared pixel-shift morph the runtime plays, and a
// dither smear kept for comparison. Both only move or interleave existing
// pixels, so they add no new colors and keep hard pixel edges.
import sharp from 'sharp';
import { runInbetween } from '@sparkade/shared';

export interface RgbaSprite {
  data: Buffer;
  width: number;
  height: number;
}

/** Decode sprites onto one canvas: widths padded symmetrically, feet on the
 * bottom row, matching how the runtime centers each generated pose. */
export async function alignSprites(pngs: readonly Buffer[]): Promise<RgbaSprite[]> {
  const decoded = await Promise.all(
    pngs.map((png) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  const width = Math.max(...decoded.map((d) => d.info.width));
  const height = Math.max(...decoded.map((d) => d.info.height));
  return decoded.map(({ data, info }) => {
    const out = Buffer.alloc(width * height * 4);
    const left = Math.floor((width - info.width) / 2);
    const top = height - info.height;
    for (let y = 0; y < info.height; y++)
      data.copy(out, ((y + top) * width + left) * 4, y * info.width * 4, (y + 1) * info.width * 4);
    return { data: out, width, height };
  });
}

export function encodeSprite(sprite: RgbaSprite): Promise<Buffer> {
  return sharp(sprite.data, { raw: { width: sprite.width, height: sprite.height, channels: 4 } })
    .png()
    .toBuffer();
}

const opaque = (s: RgbaSprite, p: number) => s.data[p * 4 + 3]! > 8;

/** Checkerboard interleave of two frames: where both are opaque, alternate
 * pixels; where only one is, keep every other pixel of it. At animation speed
 * this reads as a motion smear. */
export function ditherInbetween(a: RgbaSprite, b: RgbaSprite): RgbaSprite {
  const out = Buffer.alloc(a.data.length);
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const p = y * a.width + x;
      const pickA = (x + y) % 2 === 0;
      const inA = opaque(a, p);
      const inB = opaque(b, p);
      const source = inA && inB ? (pickA ? a : b) : inA && pickA ? a : inB && !pickA ? b : null;
      if (source) source.data.copy(out, p * 4, p * 4, p * 4 + 4);
    }
  return { data: out, width: a.width, height: a.height };
}

/** Pixel-shift morph from the shared runtime implementation, so lab pages
 * show exactly what the game plays. */
export function flowInbetween(a: RgbaSprite, b: RgbaSprite, t = 0.5): RgbaSprite {
  const out = runInbetween(a, b, t);
  return {
    data: Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength),
    width: out.width,
    height: out.height,
  };
}
