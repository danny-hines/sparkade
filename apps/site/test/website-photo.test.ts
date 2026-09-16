import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizeWebsitePhoto } from '../lib/website-photo';
import { MAX_WEBSITE_PHOTO_BYTES } from '../lib/website-photo-limits';

async function photo(format: 'jpeg' | 'png' | 'webp') {
  const bytes = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#38e5ff' },
  })
    .toFormat(format)
    .withMetadata({ orientation: 6 })
    .toBuffer();
  return new File([new Uint8Array(bytes)], `photo.${format}`, { type: `image/${format}` });
}
describe('website photo validation', () => {
  it('allows an omitted photo', async () => {
    expect(await normalizeWebsitePhoto()).toBeUndefined();
    expect(await normalizeWebsitePhoto(null)).toBeUndefined();
  });
  it.each(['jpeg', 'png', 'webp'] as const)(
    'normalizes %s pixels to a bounded JPEG without metadata',
    async (format) => {
      const input = await photo(format);
      const a = await normalizeWebsitePhoto(input);
      const b = await normalizeWebsitePhoto(input);
      expect(a!.equals(b!)).toBe(true);
      const meta = await sharp(a).metadata();
      expect(meta).toMatchObject({ format: 'jpeg', width: 512, height: 512 });
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect(a!.length).toBeLessThan(MAX_WEBSITE_PHOTO_BYTES);
    },
  );
  it('rejects empty, oversize, corrupt, and disguised non-image files', async () => {
    for (const file of [
      new File([], 'empty.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array(MAX_WEBSITE_PHOTO_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' }),
      new File(['not an image'], 'fake.jpg', { type: 'image/jpeg' }),
      new File(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'], 'fake.png', {
        type: 'image/png',
      }),
      new File(['hello'], 'text.txt', { type: 'text/plain' }),
    ])
      await expect(normalizeWebsitePhoto(file)).rejects.toThrow();
    await expect(normalizeWebsitePhoto('https://example.com/photo.jpg')).rejects.toThrow(
      'photo file',
    );
  });
  it('rejects a decompression bomb before resizing', async () => {
    const bytes = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    expect(bytes.length).toBeLessThan(MAX_WEBSITE_PHOTO_BYTES);
    await expect(
      normalizeWebsitePhoto(new File([new Uint8Array(bytes)], 'large.png', { type: 'image/png' })),
    ).rejects.toThrow('Could not read');
  });
});
