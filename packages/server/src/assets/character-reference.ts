import sharp from 'sharp';

/** Shared by gameplay foundations and portraits. Photo owns likeness; key art
 * owns the game-world wardrobe and rendering style. No new generation call. */
export async function buildCharacterArtReference(keyArt: Buffer, photo?: Buffer): Promise<Buffer> {
  if (!photo) return keyArt;
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

/** Legacy photo-only callers remain supported by the pose labs. */
export type CharacterReferenceKind = 'photo' | 'key-art' | 'character-art';

export function characterReferenceLabel(kind: CharacterReferenceKind): string {
  return kind === 'character-art'
    ? 'CHARACTER ART BOARD'
    : kind === 'key-art'
      ? 'SOURCE KEY ART'
      : 'SOURCE PHOTO';
}

export function characterReferenceInstruction(kind: CharacterReferenceKind): string {
  if (kind === 'photo')
    return 'SOURCE PHOTO is immutable identity truth from the neck up; its clothing below the neck is not wardrobe truth.';
  const identity =
    kind === 'character-art'
      ? 'The attached CHARACTER ART BOARD has two panels. LEFT is the exact player photo and immutable neck-up identity truth: preserve apparent age, facial geometry, skin tone, hair, facial hair, glasses, headwear and visible head accessories. RIGHT is the canonical key-art PLAYER HERO and immutable game-world wardrobe and rendering-style truth. Source-photo clothing must not replace the game outfit.'
      : 'SOURCE KEY ART is the canonical PLAYER HERO identity, game-world wardrobe and rendering-style truth. Isolate the player hero, never a villain or background figure.';
  return (
    identity +
    ' Match the same garment types, sleeves, colors, materials, footwear and body-worn accessories, plus adult proportions, pixel technique, outline weight and shading. Translate this same character into the requested sprite pose and resolution; do not redesign them, make them younger or more cartoonish, or copy the reference panel layout or scenery. The written concept describes this character; it must not invent a competing outfit.'
  );
}
