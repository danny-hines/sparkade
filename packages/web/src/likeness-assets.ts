import type { LikenessAssets } from '@sparkade/engine';
import { api, type GameDetail } from './api';

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Load front assets for every likeness and directional views only when present. */
export async function loadLikenessAssets(
  gameId: string,
  assets: GameDetail['assets'],
): Promise<LikenessAssets | null> {
  if (!assets.head12 && !assets.head16 && !assets.portrait) return null;

  const [head12, head12Side, head12Back, head16, head16Side, head16Back, portrait] =
    await Promise.all([
      assets.head12 ? loadImage(api.assetUrl(gameId, 'head12.png')) : null,
      assets.head12Side ? loadImage(api.assetUrl(gameId, 'head12-side.png')) : null,
      assets.head12Back ? loadImage(api.assetUrl(gameId, 'head12-back.png')) : null,
      assets.head16 ? loadImage(api.assetUrl(gameId, 'head16.png')) : null,
      assets.head16Side ? loadImage(api.assetUrl(gameId, 'head16-side.png')) : null,
      assets.head16Back ? loadImage(api.assetUrl(gameId, 'head16-back.png')) : null,
      assets.portrait ? loadImage(api.assetUrl(gameId, 'portrait.png')) : null,
    ]);

  return {
    head12,
    head12Side,
    head12Back,
    head16,
    head16Side,
    head16Back,
    portrait,
  };
}
