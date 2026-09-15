// Uploaded-photo processing for the New Game wizard. Mirrors the camera
// capture path (square center-crop, capped at MAX_PHOTO_DIM, JPEG blob) so an
// uploaded file flows into the existing photoBlob/photoUrl preview/use/retake
// flow unchanged. Pure helpers stay DOM-free for Node tests; only
// decodePhotoFileToJpeg touches browser APIs.
import { MAX_PHOTO_DIM } from '@sparkade/shared';

/** Mirrors the server's photo size guard (routes.ts MAX_PHOTO_BYTES). */
export const MAX_UPLOAD_PHOTO_BYTES = 4 * 1024 * 1024;

/** Image types browsers reliably decode to canvas for re-encoding. */
export const SUPPORTED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export class PhotoUploadError extends Error {
  readonly cancelled: boolean;
  constructor(message: string, cancelled = false) {
    super(message);
    this.name = 'PhotoUploadError';
    this.cancelled = cancelled;
  }
}

/** Meta-only check (type + size) so oversized/unsupported picks fail fast. */
export function validatePhotoFileMeta(file: { type: string; size: number }): string | null {
  if (!(SUPPORTED_PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'That file is not a supported photo. Choose a JPEG, PNG, or WebP image.';
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return 'That file looks empty. Choose another photo.';
  }
  if (file.size > MAX_UPLOAD_PHOTO_BYTES) {
    return 'That photo is too large. Choose an image under 4 MB.';
  }
  return null;
}

/** Centered square crop of a decoded image, in source pixels. */
export function squareCrop(
  naturalWidth: number,
  naturalHeight: number,
): { sx: number; sy: number; side: number } {
  const side = Math.min(naturalWidth, naturalHeight);
  return { sx: (naturalWidth - side) / 2, sy: (naturalHeight - side) / 2, side };
}

/** Output edge length: same cap the camera path applies via MAX_PHOTO_DIM. */
export function uploadOutputSize(cropSide: number): number {
  return Math.max(1, Math.min(MAX_PHOTO_DIM, Math.floor(cropSide)));
}

export interface DecodedImage {
  /** Directly drawable source: bitmap where available, <img> otherwise. */
  readonly source: ImageBitmap | HTMLImageElement;
  readonly width: number;
  readonly height: number;
  /** Releases the decoded pixels (closes the bitmap or revokes the object URL). */
  close(): void;
}

export interface PhotoDecodeDeps {
  createImageBitmap?: (file: Blob) => Promise<ImageBitmap>;
  createImage: () => HTMLImageElement;
  createObjectURL: (file: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

function defaultDecodeDeps(): PhotoDecodeDeps {
  return {
    createImageBitmap:
      typeof globalThis.createImageBitmap === 'function'
        ? globalThis.createImageBitmap.bind(globalThis)
        : undefined,
    createImage: () => new Image(),
    createObjectURL: (file) => URL.createObjectURL(file),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

/**
 * Decode an image blob into a drawable source. Prefers createImageBitmap;
 * without it, decodes via <img> and draws the element directly. The object
 * URL is revoked by close() after a successful decode, or immediately when
 * decoding fails — never left pending.
 */
export async function decodeToDecodedImage(
  file: Blob,
  deps: PhotoDecodeDeps = defaultDecodeDeps(),
): Promise<DecodedImage> {
  if (deps.createImageBitmap) {
    try {
      const bitmap = await deps.createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      throw new PhotoUploadError('Could not read that image. Choose another photo.');
    }
  }
  // Fallback for browsers without createImageBitmap: decode via <img> and
  // draw the element itself — never touch the missing API here.
  const url = deps.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = deps.createImage();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      close: () => deps.revokeObjectURL(url),
    };
  } catch {
    deps.revokeObjectURL(url);
    throw new PhotoUploadError('Could not read that image. Choose another photo.');
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new PhotoUploadError('Could not process that image. Choose another.'));
        else resolve(blob);
      },
      'image/jpeg',
      0.85,
    );
  });
}

/**
 * Decode an uploaded image file into a JPEG blob matching the camera capture
 * shape (square, capped at MAX_PHOTO_DIM). Throws PhotoUploadError with a
 * user-facing message on invalid input; throws a cancelled PhotoUploadError
 * when isCancelled() is true so unmounted/stale decodes stay silent.
 */
export async function decodePhotoFileToJpeg(
  file: Blob,
  opts: { isCancelled?: () => boolean } = {},
): Promise<Blob> {
  const metaError = validatePhotoFileMeta(file);
  if (metaError) throw new PhotoUploadError(metaError);
  const decoded = await decodeToDecodedImage(file);
  try {
    if (opts.isCancelled?.()) throw new PhotoUploadError('cancelled', true);
    if (!decoded.width || !decoded.height) {
      throw new PhotoUploadError('Could not read that image. Choose another photo.');
    }
    const crop = squareCrop(decoded.width, decoded.height);
    const size = uploadOutputSize(crop.side);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoUploadError('Could not process that image. Choose another.');
    ctx.drawImage(decoded.source, crop.sx, crop.sy, crop.side, crop.side, 0, 0, size, size);
    if (opts.isCancelled?.()) throw new PhotoUploadError('cancelled', true);
    return await canvasToJpeg(canvas);
  } finally {
    decoded.close();
  }
}
