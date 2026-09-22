import { buildCharacterArtReference } from '../assets/character-reference';

/** Compatibility entry point for portrait callers; gameplay uses the same board. */
export function buildPortraitIdentityReference(photo: Buffer, keyArt: Buffer): Promise<Buffer> {
  return buildCharacterArtReference(keyArt, photo);
}
