import { decodeMaskToRaster, type SegmentationMaskRecord } from '@meta-sam/parser';
import sharp from 'sharp';
import { isFighterGreenScreenPixel, type MaskedSpriteImage } from './fighter-pose';

export const SPRITE_MASK_PROCESSOR_VERSION = 'sprite-mask-v4';
export const MAX_SPRITE_SOURCE_PIXELS = 4096 * 4096;

export async function decodeSpriteSource(image: Buffer): Promise<MaskedSpriteImage> {
  const { data, info } = await sharp(image, { limitInputPixels: MAX_SPRITE_SOURCE_PIXELS })
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function encodeSpritePixels(image: MaskedSpriteImage): Promise<Buffer> {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .png()
    .toBuffer();
}

/** The parser converts SAM's inclusive wire box into a half-open source box.
 * The raster covers that box, not the full image. Never place it at wire x=y=0. */
export async function applySamMask(
  source: MaskedSpriteImage,
  record: SegmentationMaskRecord,
): Promise<MaskedSpriteImage> {
  const { left, top, right, bottom } = record.bounds;
  if (
    ![left, top, right, bottom].every(Number.isSafeInteger) ||
    left < 0 ||
    top < 0 ||
    right > source.width ||
    bottom > source.height ||
    right <= left ||
    bottom <= top
  )
    throw new Error('SAM mask lies outside the source image');
  const raster = decodeMaskToRaster(record.mask);
  const mask = await sharp(Buffer.from(raster.map((value) => value * 255)), {
    raw: { width: record.mask.width, height: record.mask.height, channels: 1 },
  })
    .resize(right - left, bottom - top, { kernel: sharp.kernel.nearest, fit: 'fill' })
    .toColourspace('b-w')
    .raw()
    .toBuffer();
  const data = Buffer.from(source.data);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const offset = (y * source.width + x) * 4;
      const keep =
        x >= left &&
        x < right &&
        y >= top &&
        y < bottom &&
        mask[(y - top) * (right - left) + x - left]! > 0;
      if (!keep || data[offset + 3]! <= 8) data.fill(0, offset, offset + 4);
    }
  }
  return { ...source, data };
}

/** Experimental color-only repair in a fixed one-pixel inner boundary band.
 * It never erodes alpha or follows a green component into hair/clothing. */
export function despillSpriteBoundary(source: MaskedSpriteImage): {
  image: MaskedSpriteImage;
  changedPixels: number;
} {
  const { width, height } = source;
  const data = Buffer.from(source.data);
  let changedPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3]! <= 8) continue;
      const r = data[offset]!;
      const g = data[offset + 1]!;
      const b = data[offset + 2]!;
      if (g - Math.max(r, b) < 40) continue;
      let boundary = false;
      for (let dy = -1; dy <= 1 && !boundary; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx < 0 ||
            ny < 0 ||
            nx >= width ||
            ny >= height ||
            source.data[(ny * width + nx) * 4 + 3]! <= 8
          ) {
            boundary = true;
            break;
          }
        }
      }
      if (boundary) {
        data[offset + 1] = Math.max(r, b);
        changedPixels++;
      }
    }
  }
  return { image: { ...source, data }, changedPixels };
}

/** A trimap: preserve SAM's interior, key a narrow band on either side of its
 * boundary, discard everything farther outside. Original RGB can recover fine
 * strands omitted by SAM. This is binary keying, not soft-alpha hair matting. */
export function hybridSpriteMask(
  source: MaskedSpriteImage,
  sam: MaskedSpriteImage,
  options: { radius?: number } = {},
): {
  image: MaskedSpriteImage;
  hybrid: {
    radius: number;
    removedPixels: number;
    restoredPixels: number;
    despilledPixels: number;
    protectedGreenPixels: number;
  };
} {
  const { width, height } = source;
  if (
    width !== sam.width ||
    height !== sam.height ||
    source.data.length !== width * height * 4 ||
    sam.data.length !== source.data.length
  )
    throw new Error('Hybrid source and SAM mask dimensions must match');
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  let borderPixels = 0,
    greenBorderPixels = 0;
  const isKey = (offset: number): boolean => {
    const [r, g, b] = [source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!];
    return (
      isFighterGreenScreenPixel(r, g, b) ||
      (g >= 72 && r <= g * 0.25 && b <= g * 0.25 && g - r >= 60 && g - b >= 60)
    );
  };
  // Only offer this recipe for a green-screen source. Plain SAM still works on
  // arbitrary backgrounds and must not inherit this recipe's assumptions.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (sam.data[offset + 3]! > 8) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
      if (
        (x === 0 || y === 0 || x === width - 1 || y === height - 1) &&
        source.data[offset + 3]! > 8
      ) {
        borderPixels++;
        if (isKey(offset)) greenBorderPixels++;
      }
    }
  }
  if (right < left) throw new Error('SAM mask has no foreground');
  if (borderPixels === 0 || greenBorderPixels / borderPixels < 0.5)
    throw new Error('Hybrid cleanup needs a green-screen source (mostly green outer border)');
  // Approximately one game pixel on either side, bounded to limit recovery of
  // unrelated nearby content. This is a heuristic, recorded with each result.
  const radius =
    options.radius ??
    Math.min(24, Math.max(1, Math.ceil(Math.max(right - left + 1, bottom - top + 1) / 112)));
  if (!Number.isInteger(radius) || radius < 1 || radius > 24)
    throw new Error('Hybrid radius must be an integer from 1 to 24');
  // Summed-area table makes square erosion/dilation O(width * height), even for
  // large source images. Transparent pixels and space beyond the image are background.
  const stride = width + 1;
  const sums = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      if (sam.data[(y * width + x) * 4 + 3]! > 8) row++;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1]! + row;
    }
  }
  const data = Buffer.alloc(source.data.length);
  const hybrid = {
    radius,
    removedPixels: 0,
    restoredPixels: 0,
    despilledPixels: 0,
    protectedGreenPixels: 0,
  };
  const fullArea = (2 * radius + 1) ** 2;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius),
      y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius),
        x1 = Math.min(width, x + radius + 1);
      const count =
        sums[y1 * stride + x1]! -
        sums[y0 * stride + x1]! -
        sums[y1 * stride + x0]! +
        sums[y0 * stride + x0]!;
      const offset = (y * width + x) * 4;
      const inside = sam.data[offset + 3]! > 8;
      const protectedInterior = count === fullArea;
      const key = isKey(offset);
      const keep = source.data[offset + 3]! > 8 && count > 0 && (protectedInterior || !key);
      if (keep) {
        source.data.copy(data, offset, offset, offset + 4);
        // Mixed foreground/background colors are not safely keyed to transparent.
        // Suppress their green excess only inside the uncertain boundary band.
        const neutralGreen = Math.max(data[offset]!, data[offset + 2]!);
        if (!protectedInterior && data[offset + 1]! - neutralGreen >= 40) {
          data[offset + 1] = neutralGreen;
          hybrid.despilledPixels++;
        }
      }
      if (inside && !keep) hybrid.removedPixels++;
      if (!inside && keep) hybrid.restoredPixels++;
      if (keep && protectedInterior && key) hybrid.protectedGreenPixels++;
    }
  }
  return { image: { ...source, data }, hybrid };
}

export async function spriteAlphaPng(image: MaskedSpriteImage): Promise<Buffer> {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .extractChannel(3)
    .png()
    .toBuffer();
}
