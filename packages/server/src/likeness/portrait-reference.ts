import sharp from 'sharp';

/** One shared reference for both portrait expressions. Keep the source photo
 * authoritative for likeness and the game's key art authoritative for style. */
export async function buildPortraitIdentityReference(
  photo: Buffer,
  keyArt: Buffer,
): Promise<Buffer> {
  const background = '#10131f';
  const panel = (image: Buffer) =>
    sharp(image).rotate().resize(480, 880, { fit: 'contain', background }).png().toBuffer();
  const [identity, style] = await Promise.all([panel(photo), panel(keyArt)]);
  const labels = Buffer.from(
    '<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><text x="256" y="48" text-anchor="middle" fill="#f5f7ff" font-family="monospace" font-size="22" font-weight="bold">LEFT · PHOTO · HEAD IDENTITY</text><text x="768" y="48" text-anchor="middle" fill="#f5f7ff" font-family="monospace" font-size="22" font-weight="bold">RIGHT · KEY ART · GAME STYLE</text></svg>',
  );
  return sharp({ create: { width: 1024, height: 1024, channels: 3, background } })
    .composite([
      { input: identity, left: 16, top: 80 },
      { input: style, left: 528, top: 80 },
      { input: labels, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}
