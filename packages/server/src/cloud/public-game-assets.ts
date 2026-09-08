import sharp from 'sharp';
import { PUBLIC_GAME_ASSET_MAX_BYTES } from '@sparkade/shared';
export { PUBLIC_GAME_ASSET_MAX_BYTES } from '@sparkade/shared';
import type { PublicGameAsset } from '../storage/files';

/** Lossless upload copy. Never changes the accepted local file or its manifest. */
export async function preparePublicGameAsset(asset: PublicGameAsset): Promise<PublicGameAsset> {
  if (asset.content.byteLength <= PUBLIC_GAME_ASSET_MAX_BYTES) return asset;
  const content = await sharp(asset.content)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  if (content.byteLength > PUBLIC_GAME_ASSET_MAX_BYTES) {
    throw new Error(
      `Cannot publish ${asset.filename}: losslessly compressed PNG still exceeds the 4 MiB upload limit`,
    );
  }
  return { ...asset, content };
}
