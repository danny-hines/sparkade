import sharp from 'sharp';

export const RACING_PLAYER_PHOTO_PROMPT =
  'PLAYER PHOTO IDENTITY: the LEFT PANEL is the exact player photo and neck-up likeness reference. Preserve the visible identity in the required REAR view: head shape, skin tone, hair length and texture, hairline, ears, and especially the same cap, hat, glasses, and other head accessories. Keep photographed headwear even when the written outfit does not mention it. Never replace a cap with exposed hair or invent long hair under it. Do not turn toward the camera to show a face; match the rear-visible identity while obeying the required pose and camera.';

export function racingPlayerIdentityPrompt(hasPhoto: boolean): string {
  return [
    hasPhoto ? RACING_PLAYER_PHOTO_PROMPT : '',
    `CANONICAL CHARACTER ART: ${hasPhoto ? 'the RIGHT PANEL is' : 'the reference image is'} the established game character artwork. Translate that SAME player into the required rear gameplay pose. Copy their exact garment types, colors, trim, patterns, shoes, accessories, body proportions and pixel-art technique. Do not invent another outfit or copy source-photo clothing. The written wardrobe clarifies the same design; it does not replace this visual reference. Ignore scenery and other characters. Do not copy the reference pose, camera or panel layout.`,
  ].filter(Boolean).join(' ');
}

export function racingPlayerIdentityReview(hasPhoto: boolean): string {
  return [
    'PLAYER CHARACTER IDENTITY CHECK: the TOP PANEL contains the established character references; the BOTTOM PANEL contains the labeled TARGET gameplay art.',
    hasPhoto
      ? 'Within the TOP PANEL, LEFT is the source player photo (neck-up likeness truth) and RIGHT is the game character artwork (wardrobe, proportions and rendering-style truth). A missing photographed cap is fatal, even when the text concept omits it. Never invent hair hidden by headwear.'
      : 'The TOP PANEL is the established game character artwork: identity, wardrobe, proportions and rendering-style truth.',
    'Compare the target player to that artwork. A changed shirt type, color, trim, pattern, footwear or other outfit detail is fatal; a matching cap alone is not enough. These references depict the same player, not rivals to score for distinctness. Preserve rear-visible identity without demanding a face. Report identity or wardrobe faults in fatalIssues and request a player repaint, never a banking-only correction.',
  ].join(' ');
}

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
