import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_DIM } from '@sparkade/shared';
import {
  decodeToDecodedImage,
  MAX_UPLOAD_PHOTO_BYTES,
  PhotoUploadError,
  squareCrop,
  uploadOutputSize,
  validatePhotoFileMeta,
  type PhotoDecodeDeps,
} from '../src/photo-upload';

interface FakeImage {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  width: number;
  height: number;
}

function fallbackDeps(images: FakeImage[], revoked: string[]): PhotoDecodeDeps {
  return {
    createImageBitmap: undefined,
    createImage: () => {
      const img: FakeImage = {
        onload: null,
        onerror: null,
        src: '',
        naturalWidth: 640,
        naturalHeight: 480,
        width: 640,
        height: 480,
      };
      images.push(img);
      return img as unknown as HTMLImageElement;
    },
    createObjectURL: () => 'blob:fake-upload',
    revokeObjectURL: (url) => {
      revoked.push(url);
    },
  };
}

const pngFile = () => new Blob(['fake-png-bytes'], { type: 'image/png' });

describe('photo upload validation', () => {
  it('accepts supported types under the size limit', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validatePhotoFileMeta({ type, size: 1024 })).toBeNull();
    }
  });

  it('rejects unsupported types', () => {
    expect(validatePhotoFileMeta({ type: 'image/gif', size: 1024 })).toMatch(/not a supported photo/);
    expect(validatePhotoFileMeta({ type: 'application/pdf', size: 1024 })).toMatch(
      /not a supported photo/,
    );
    expect(validatePhotoFileMeta({ type: '', size: 1024 })).toMatch(/not a supported photo/);
  });

  it('rejects empty and oversized files', () => {
    expect(validatePhotoFileMeta({ type: 'image/jpeg', size: 0 })).toMatch(/empty/);
    expect(validatePhotoFileMeta({ type: 'image/png', size: MAX_UPLOAD_PHOTO_BYTES + 1 })).toMatch(
      /too large/,
    );
    expect(validatePhotoFileMeta({ type: 'image/png', size: MAX_UPLOAD_PHOTO_BYTES })).toBeNull();
  });
});

describe('photo upload geometry', () => {
  it('center-crops landscape and portrait sources to a square', () => {
    expect(squareCrop(800, 600)).toEqual({ sx: 100, sy: 0, side: 600 });
    expect(squareCrop(600, 800)).toEqual({ sx: 0, sy: 100, side: 600 });
    expect(squareCrop(512, 512)).toEqual({ sx: 0, sy: 0, side: 512 });
  });

  it('caps the output edge at MAX_PHOTO_DIM like the camera path', () => {
    expect(uploadOutputSize(4000)).toBe(MAX_PHOTO_DIM);
    expect(uploadOutputSize(512)).toBe(MAX_PHOTO_DIM);
    expect(uploadOutputSize(300)).toBe(300);
    expect(uploadOutputSize(0)).toBe(1);
  });
});

describe('no-createImageBitmap fallback decode', () => {
  it('decodes via <img> without touching the missing API and revokes the URL on close', async () => {
    const images: FakeImage[] = [];
    const revoked: string[] = [];
    const pending = decodeToDecodedImage(pngFile(), fallbackDeps(images, revoked));
    expect(images).toHaveLength(1);
    expect(images[0]!.src).toBe('blob:fake-upload');
    // A broken fallback would leave this promise pending forever: firing
    // onload must settle it with a directly drawable source.
    images[0]!.onload!();
    const decoded = await pending;
    expect(decoded.source).toBe(images[0]);
    expect(decoded.width).toBe(640);
    expect(decoded.height).toBe(480);
    expect(revoked).toEqual([]);
    decoded.close();
    expect(revoked).toEqual(['blob:fake-upload']);
  });

  it('revokes the URL and raises a user-facing error when the image fails', async () => {
    const images: FakeImage[] = [];
    const revoked: string[] = [];
    const pending = decodeToDecodedImage(pngFile(), fallbackDeps(images, revoked));
    images[0]!.onerror!();
    await expect(pending).rejects.toBeInstanceOf(PhotoUploadError);
    expect(revoked).toEqual(['blob:fake-upload']);
  });

  it('prefers createImageBitmap and closes the bitmap when present', async () => {
    let closed = false;
    const bitmap = { width: 100, height: 200, close: () => (closed = true) };
    const deps: PhotoDecodeDeps = {
      createImageBitmap: async () => bitmap as unknown as ImageBitmap,
      createImage: () => {
        throw new Error('must not create <img> when the bitmap API exists');
      },
      createObjectURL: () => {
        throw new Error('must not mint an object URL when the bitmap API exists');
      },
      revokeObjectURL: () => {},
    };
    const decoded = await decodeToDecodedImage(pngFile(), deps);
    expect(decoded.width).toBe(100);
    expect(decoded.height).toBe(200);
    decoded.close();
    expect(closed).toBe(true);
  });
});
