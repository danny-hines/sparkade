import type { LikenessAssets } from '@sparkade/engine';
import { GENERATED_GAME_ASSET_FILES, type GeneratedGameAssetRole } from '@sparkade/shared';
import { api, type GameDetail } from './api';

export const FIGHTER_POSE_ASSETS = [
  ['idle', 'fighterIdle'],
  ['walk', 'fighterWalk'],
  ['crouch', 'fighterCrouch'],
  ['jump', 'fighterJump'],
  ['punchHigh', 'fighterPunchHigh'],
  ['punchLow', 'fighterPunchLow'],
  ['kickHigh', 'fighterKickHigh'],
  ['kickLow', 'fighterKickLow'],
  ['block', 'fighterBlock'],
  ['hit', 'fighterHit'],
  ['ko', 'fighterKo'],
] as const satisfies readonly (readonly [string, GeneratedGameAssetRole])[];

export type FighterPoseName = (typeof FIGHTER_POSE_ASSETS)[number][0];

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Load all runtime game art in parallel. Fighter poses are intentionally
 * all-or-nothing: one failed/missing pose keeps the procedural fighter active
 * for the whole session instead of visibly changing styles mid-match.
 */
export async function loadLikenessAssets(
  gameId: string,
  assets: GameDetail['assets'],
): Promise<LikenessAssets | null> {
  const hasCompleteFighterSet = FIGHTER_POSE_ASSETS.every(([, role]) => assets[role]);
  if (
    !assets.head12 &&
    !assets.head16 &&
    !assets.portrait &&
    !assets.generatedPortraitDefeat &&
    !assets.storyIntro &&
    !assets.storyBoss &&
    !assets.storyVictory &&
    !assets.storyDefeat &&
    !hasCompleteFighterSet
  ) {
    return null;
  }

  const likenessPromise = Promise.all([
    assets.head12 ? loadImage(api.assetUrl(gameId, 'head12.png')) : null,
    assets.head12Side ? loadImage(api.assetUrl(gameId, 'head12-side.png')) : null,
    assets.head12Back ? loadImage(api.assetUrl(gameId, 'head12-back.png')) : null,
    assets.head16 ? loadImage(api.assetUrl(gameId, 'head16.png')) : null,
    assets.head16Side ? loadImage(api.assetUrl(gameId, 'head16-side.png')) : null,
    assets.head16Back ? loadImage(api.assetUrl(gameId, 'head16-back.png')) : null,
    assets.portrait ? loadImage(api.assetUrl(gameId, 'portrait.png')) : null,
    assets.generatedPortraitDefeat
      ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES.generatedPortraitDefeat))
      : null,
  ]);
  const storyPromise = Promise.all([
    assets.storyIntro
      ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES.storyIntro))
      : null,
    assets.storyBoss ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES.storyBoss)) : null,
    assets.storyVictory
      ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES.storyVictory))
      : null,
    assets.storyDefeat
      ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES.storyDefeat))
      : null,
  ]);
  const fighterPromise: Promise<Record<FighterPoseName, HTMLImageElement> | null> =
    hasCompleteFighterSet
      ? Promise.all(
          FIGHTER_POSE_ASSETS.map(([, role]) =>
            loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[role])),
          ),
        ).then((images) => {
          if (images.some((image) => image === null)) return null;
          return Object.fromEntries(
            FIGHTER_POSE_ASSETS.map(([pose], index) => [pose, images[index]!]),
          ) as Record<FighterPoseName, HTMLImageElement>;
        })
      : Promise.resolve(null);

  const [
    [head12, head12Side, head12Back, head16, head16Side, head16Back, portrait, portraitDefeat],
    [storyIntro, storyBoss, storyVictory, storyDefeat],
    fighterPoses,
  ] = await Promise.all([likenessPromise, storyPromise, fighterPromise]);

  return {
    head12,
    head12Side,
    head12Back,
    head16,
    head16Side,
    head16Back,
    portrait,
    portraitDefeat,
    storyIntro,
    storyBoss,
    storyVictory,
    storyDefeat,
    fighterPoses,
  };
}
