// Likeness pipeline: deterministic local processing, no image-generation model.
// From one ≤512×512 JPEG (already EXIF-stripped by the shell's canvas re-encode):
//   - 12×12 and 16×16 head sprites: guide-matched face crop → contrast
//     normalize → downscale → quantize to the game's 16-color palette → oval
//     alpha mask → 1px dark outline
//   - a 64×64 portrait with the same treatment plus sharpening and 4×4 Bayer
//     ordered dithering (the classic SNES trick that keeps facial features
//     readable when a game palette has few skin tones)
// The crop derives from LIKENESS_OVAL — the same numbers that draw the
// wizard's on-screen guide, so what the player frames is what gets baked.
// Privacy: callers keep the raw photo only while the job is retryable; this
// module never logs image contents.
import sharp from 'sharp';
import { LIKENESS_OVAL } from '@sparkade/shared';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * Nearest palette color using the "redmean" perceptual distance — plain RGB
 * distance loves to collapse skin tones into a single blob; redmean keeps
 * luminance structure (eyes, mouth, hair line) separated. Index 0 excluded.
 */
function nearest(palette: Rgb[], r: number, g: number, b: number): Rgb {
  let best = palette[1]!;
  let bestD = Infinity;
  for (let i = 1; i < palette.length; i++) {
    const p = palette[i]!;
    const rMean = (p.r + r) / 2;
    const dr = p.r - r;
    const dg = p.g - g;
    const db = p.b - b;
    const d = (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** 4×4 Bayer threshold matrix, centered around 0 (−0.5 … +0.4375). */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => v / 16 - 0.5));

/**
 * Renders one size: crop the guide oval's bounding box, normalize contrast,
 * downscale, quantize (dithered at portrait size), oval mask, outline.
 * Returns a PNG buffer.
 */
async function bakeSize(
  photo: Buffer,
  palette: Rgb[],
  size: number,
  portraitDither: number,
): Promise<Buffer> {
  const img = sharp(photo).rotate(); // honor EXIF orientation defensively
  const meta = await img.metadata();
  const w = meta.width ?? 512;
  const h = meta.height ?? 512;

  // The wizard sends a centered square; recompute defensively for any input.
  const sq = Math.min(w, h);
  const sqLeft = Math.floor((w - sq) / 2);
  const sqTop = Math.floor((h - sq) / 2);
  // Crop exactly what the on-screen guide framed (its bounding box).
  const cropW = Math.floor(2 * LIKENESS_OVAL.rx * sq);
  const cropH = Math.floor(2 * LIKENESS_OVAL.ry * sq);
  const left = Math.max(
    0,
    Math.min(w - cropW, sqLeft + Math.floor(LIKENESS_OVAL.cx * sq - cropW / 2)),
  );
  const top = Math.max(
    0,
    Math.min(h - cropH, sqTop + Math.floor(LIKENESS_OVAL.cy * sq - cropH / 2)),
  );

  let chain = sharp(photo)
    .rotate()
    .extract({ left, top, width: cropW, height: cropH })
    .resize(size, size, { fit: 'fill', kernel: 'cubic' });
  if (size >= 32) {
    chain = chain.sharpen({ sigma: 1 }); // crisp features before quantization (portrait only)
  }
  const raw = await chain.removeAlpha().raw().toBuffer();

  const out = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const rx = size / 2 - 0.5;
  const ry = size / 2 - 0.2; // slightly taller oval
  const outlineColor = palette[1]!;
  // Ordered dithering fakes gradients with few colors — valuable for the
  // game-palette fallback (one or two skin-ish tones), but on a rich vision-
  // derived skin palette a heavy dither just reads as muddy speckle, so callers
  // pass a lower amp for that path. Off entirely for the tiny heads (at 12px it
  // is pure noise).
  const ditherAmp = size >= 32 ? portraitDither : 0;

  const opaque: boolean[] = new Array(size * size).fill(false);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      opaque[y * size + x] = true;
    }
  }

  // Face-region contrast stretch: measure the luminance spread over ONLY the
  // oval (face) pixels — not the masked-out background — so a bright window or a
  // dim room can't skew the histogram and crush the face into one tonal blob
  // (the old whole-crop .normalize() did exactly that). Map the face's 5th–95th
  // luminance percentile to a healthy range; clamp the gain so flat, evenly-lit
  // faces aren't over-amplified into JPEG noise. Same affine map on every
  // channel, so skin hue is preserved — only exposure/contrast changes.
  const lums: number[] = [];
  for (let p = 0; p < size * size; p++) {
    if (!opaque[p]) continue;
    const si = p * 3;
    lums.push(0.299 * raw[si]! + 0.587 * raw[si + 1]! + 0.114 * raw[si + 2]!);
  }
  lums.sort((a, b) => a - b);
  const lo = lums.length ? lums[Math.floor(lums.length * 0.05)]! : 0;
  const hi = lums.length ? lums[Math.floor(lums.length * 0.95)]! : 255;
  const TARGET_LO = 30;
  const TARGET_HI = 236;
  const gain = Math.max(1, Math.min(3.5, (TARGET_HI - TARGET_LO) / Math.max(1, hi - lo)));
  const stretch = (v: number) => (v - lo) * gain + TARGET_LO;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!opaque[y * size + x]) continue;
      const si = (y * size + x) * 3;
      const dither = ditherAmp * BAYER4[y % 4]![x % 4]!;
      const q = nearest(
        palette,
        Math.max(0, Math.min(255, stretch(raw[si]!) + dither)),
        Math.max(0, Math.min(255, stretch(raw[si + 1]!) + dither)),
        Math.max(0, Math.min(255, stretch(raw[si + 2]!) + dither)),
      );
      out[i] = q.r;
      out[i + 1] = q.g;
      out[i + 2] = q.b;
      out[i + 3] = 255;
    }
  }
  // 1px outline just inside the oval edge
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!opaque[y * size + x]) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === size - 1 ||
        y === size - 1 ||
        !opaque[y * size + x - 1] ||
        !opaque[y * size + x + 1] ||
        !opaque[(y - 1) * size + x] ||
        !opaque[(y + 1) * size + x];
      if (edge) {
        const i = (y * size + x) * 4;
        out[i] = outlineColor.r;
        out[i + 1] = outlineColor.g;
        out[i + 2] = outlineColor.b;
        out[i + 3] = 255;
      }
    }
  }
  return sharp(out, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}

export interface LikenessArtifacts {
  head12: Buffer;
  /** Right-facing view; the engine mirrors it for left-facing frames. */
  head12Side?: Buffer;
  /** Rear view for movement away from the camera. */
  head12Back?: Buffer;
  head16: Buffer;
  /** Right-facing view; the engine mirrors it for left-facing frames. */
  head16Side?: Buffer;
  /** Rear view for movement away from the camera. */
  head16Back?: Buffer;
  portrait: Buffer;
}

/** Stable on-disk/API names. Legacy `head12`/`head16` remain the front view. */
export const LIKENESS_ASSET_FILES = {
  head12: 'head12.png',
  head12Side: 'head12-side.png',
  head12Back: 'head12-back.png',
  head16: 'head16.png',
  head16Side: 'head16-side.png',
  head16Back: 'head16-back.png',
  portrait: 'portrait.png',
} as const satisfies Record<keyof LikenessArtifacts, string>;

export type LikenessAssetFilename =
  (typeof LIKENESS_ASSET_FILES)[keyof typeof LIKENESS_ASSET_FILES];

/** Enumerate only artifacts that were actually generated (directional views are optional). */
export function likenessAssetBuffers(
  artifacts: LikenessArtifacts,
): Array<readonly [LikenessAssetFilename, Buffer]> {
  const result: Array<readonly [LikenessAssetFilename, Buffer]> = [];
  for (const key of Object.keys(LIKENESS_ASSET_FILES) as Array<keyof LikenessArtifacts>) {
    const buffer = artifacts[key];
    if (buffer) result.push([LIKENESS_ASSET_FILES[key], buffer]);
  }
  return result;
}

/**
 * @param portraitDither ordered-dither strength for the 64px portrait. Default 30
 *   suits the game-palette fallback (few skin tones); pass ~10 when quantizing
 *   against a rich vision-derived skin palette so the face reads clean, not muddy.
 */
export async function bakeLikeness(
  photo: Buffer,
  paletteHex: string[],
  portraitDither = 30,
): Promise<LikenessArtifacts> {
  const palette = paletteHex.map(hexToRgb);
  const [head12, head16, portrait] = await Promise.all([
    bakeSize(photo, palette, 12, portraitDither),
    bakeSize(photo, palette, 16, portraitDither),
    bakeSize(photo, palette, 64, portraitDither),
  ]);
  return { head12, head16, portrait };
}
