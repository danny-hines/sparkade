import sharp from 'sharp';

export const RACING_PLAYER_PHOTO_PROMPT =
  'PLAYER PHOTO IDENTITY: the reference photo is the exact player, not a pose or outfit reference. Preserve the visible identity from the neck up in the required REAR view: head shape, skin tone, hair length and texture, hairline, ears, and especially the same cap, hat, glasses, and other head accessories. Keep photographed headwear even when the written outfit does not mention it. Never replace a cap with exposed hair or invent long hair under it. Use the authored game outfit below the neck. Do not turn toward the camera to show a face; match the rear-visible identity while obeying the required pose and camera.';

export const RACING_PLAYER_PHOTO_REVIEW =
  "PLAYER PHOTO IDENTITY CHECK: the TOP PANEL is the source player photo; the BOTTOM PANEL contains the labeled TARGET gameplay art. The photo is identity truth, not another racer or a target to score for distinctness. Reject player identity drift visible from behind: missing or changed cap/headwear, invented longer hair, changed head shape, skin tone, or head accessories. A rear-facing character does not need to show a face, but must retain the photo's rear-visible identity. A missing photographed cap is fatal, even when the text concept omits it. Report identity faults in fatalIssues and request a player repaint, never a banking-only correction. The authored outfit below the neck may differ from the photo.";

/** Keep the entire source head visible; a landscape cover crop can cut off a cap. */
export async function buildRacingPhotoReviewReference(
  photo: Buffer,
  targets: Buffer,
): Promise<Buffer> {
  const background = { r: 13, g: 19, b: 31, alpha: 1 };
  const panel = (input: Buffer, pixelArt: boolean) =>
    sharp(input)
      .resize(1024, 512, {
        fit: 'contain',
        background,
        kernel: pixelArt ? sharp.kernel.nearest : sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer();
  const [source, board] = await Promise.all([panel(photo, false), panel(targets, true)]);
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background } })
    .composite([
      { input: source, top: 0, left: 0 },
      { input: board, top: 512, left: 0 },
    ])
    .png()
    .toBuffer();
}
