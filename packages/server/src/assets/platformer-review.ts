import sharp from 'sharp';

/** Review every pose at one canvas aspect so a wider stride is not squeezed or
 * rendered at a smaller body scale than its identity anchor. Bottom anchoring
 * also gives the reviewer a consistent ground line. */
export async function platformerReviewSprite(
  sprite: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const meta = await sharp(sprite).metadata();
  const canvasWidth = Math.max(meta.width!, Math.ceil((meta.height! * 224) / 128));
  const padding = canvasWidth - meta.width!;
  // Materialize padding first: Sharp otherwise applies resize before extend.
  const padded = await sharp(sprite)
    .extend({
      left: Math.floor(padding / 2),
      right: Math.ceil(padding / 2),
      top: 0,
      bottom: 0,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp(padded)
    .resize(width, height, {
      fit: 'contain',
      position: 'bottom',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}
