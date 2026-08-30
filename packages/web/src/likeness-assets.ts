import type { LikenessAssets } from '@sparkade/engine';
import { GENERATED_GAME_ASSET_FILES, type GeneratedGameAssetRole } from '@sparkade/shared';
import { api, type GameDetail } from './api';

/** Published in the same stable order used by Fighter identity slots. */
export const FIGHTER_ROSTER_ATLAS_ASSETS = [
  'fighterPlayerAtlas',
  'fighterOpponent1Atlas',
  'fighterOpponent2Atlas',
  'fighterOpponent3Atlas',
  'fighterBossAtlas',
] as const satisfies readonly GeneratedGameAssetRole[];

export const PLATFORMER_POSE_ASSETS = [
  ['idle', 'platformerIdle'],
  ['sideIdle', 'platformerSideIdle'],
  ['walk1', 'platformerWalk1'],
  ['walk2', 'platformerWalk2'],
  ['jump', 'platformerJump'],
] as const satisfies readonly (readonly [string, GeneratedGameAssetRole])[];

export type PlatformerPoseName = (typeof PLATFORMER_POSE_ASSETS)[number][0];

export const PLATFORMER_ENEMY_ASSETS = [
  ['walker', 'platformerEnemyWalker'],
  ['flyer', 'platformerEnemyFlyer'],
  ['shooter', 'platformerEnemyShooter'],
  ['chaser', 'platformerEnemyChaser'],
] as const satisfies readonly (readonly [string, GeneratedGameAssetRole])[];

export type PlatformerEnemyName = (typeof PLATFORMER_ENEMY_ASSETS)[number][0];

export const PLATFORMER_PROP_ASSETS = [
  ['collectible', 'platformerPropCollectible'],
  ['health', 'platformerPropHealth'],
  ['powerup', 'platformerPropPowerup'],
  ['heroProjectile', 'platformerPropHeroProjectile'],
  ['enemyProjectile', 'platformerPropEnemyProjectile'],
] as const satisfies readonly (readonly [string, GeneratedGameAssetRole])[];

export type PlatformerPropName = (typeof PLATFORMER_PROP_ASSETS)[number][0];

export const PLATFORMER_BACKDROP_ASSETS = [
  ['level1', 'platformerBackdropLevel1'],
  ['level2', 'platformerBackdropLevel2'],
  ['level3', 'platformerBackdropLevel3'],
  ['boss', 'platformerBackdropBoss'],
] as const satisfies readonly (readonly [string, GeneratedGameAssetRole])[];

export type PlatformerBackdropName = (typeof PLATFORMER_BACKDROP_ASSETS)[number][0];

export const HSHOOTER_PLAYER_CRAFT_ASSET =
  'hshooterPlayerCraft' as const satisfies GeneratedGameAssetRole;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Load runtime game art in parallel. Fighter atlases activate only as one
 * complete five-character roster; the Fighter runtime rejects anything less. */
export async function loadLikenessAssets(
  gameId: string,
  assets: GameDetail['assets'],
): Promise<LikenessAssets | null> {
  const hasCompleteFighterRoster = FIGHTER_ROSTER_ATLAS_ASSETS.every((role) => assets[role]);
  const hasCompletePlatformerSet = PLATFORMER_POSE_ASSETS.every(([, role]) => assets[role]);
  if (
    !assets.head12 &&
    !assets.head16 &&
    !assets.portrait &&
    !assets.generatedPortraitDefeat &&
    !assets.storyIntro &&
    !assets.storyBoss &&
    !assets.storyVictory &&
    !assets.storyDefeat &&
    !assets.hshooterPlayerCraft &&
    !assets.platformerBoss &&
    !PLATFORMER_ENEMY_ASSETS.some(([, role]) => assets[role]) &&
    !PLATFORMER_PROP_ASSETS.some(([, role]) => assets[role]) &&
    !PLATFORMER_BACKDROP_ASSETS.some(([, role]) => assets[role]) &&
    !hasCompleteFighterRoster &&
    !hasCompletePlatformerSet
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
  const hshooterPlayerCraftPromise = assets.hshooterPlayerCraft
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES.hshooterPlayerCraft))
    : Promise.resolve(null);
  const fighterRosterPromise: Promise<readonly HTMLImageElement[] | null> = hasCompleteFighterRoster
    ? Promise.all(
        FIGHTER_ROSTER_ATLAS_ASSETS.map((role) =>
          loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[role])),
        ),
      ).then((images) =>
        images.some((image) => image === null) ? null : (images as HTMLImageElement[]),
      )
    : Promise.resolve(null);
  const platformerPromise: Promise<Record<PlatformerPoseName, HTMLImageElement> | null> =
    hasCompletePlatformerSet
      ? Promise.all(
          PLATFORMER_POSE_ASSETS.map(([, role]) =>
            loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[role])),
          ),
        ).then((images) => {
          if (images.some((image) => image === null)) return null;
          return Object.fromEntries(
            PLATFORMER_POSE_ASSETS.map(([pose], index) => [pose, images[index]!]),
          ) as Record<PlatformerPoseName, HTMLImageElement>;
        })
      : Promise.resolve(null);
  const platformerBossPromise = assets.platformerBoss
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES.platformerBoss))
    : Promise.resolve(null);
  const platformerEnemiesPromise = Promise.all(
    PLATFORMER_ENEMY_ASSETS.map(async ([role, assetRole]) => {
      if (!assets[assetRole]) return [role, null] as const;
      return [
        role,
        await loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[assetRole])),
      ] as const;
    }),
  ).then((entries) => {
    const loaded = entries.filter(
      (entry): entry is readonly [PlatformerEnemyName, HTMLImageElement] => entry[1] !== null,
    );
    return loaded.length ? Object.fromEntries(loaded) : null;
  });
  const platformerPropsPromise = Promise.all(
    PLATFORMER_PROP_ASSETS.map(async ([role, assetRole]) => {
      if (!assets[assetRole]) return [role, null] as const;
      return [
        role,
        await loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[assetRole])),
      ] as const;
    }),
  ).then((entries) => {
    const loaded = entries.filter(
      (entry): entry is readonly [PlatformerPropName, HTMLImageElement] => entry[1] !== null,
    );
    return loaded.length ? Object.fromEntries(loaded) : null;
  });
  const platformerBackdropsPromise = Promise.all(
    PLATFORMER_BACKDROP_ASSETS.map(async ([role, assetRole]) => {
      if (!assets[assetRole]) return [role, null] as const;
      return [
        role,
        await loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[assetRole])),
      ] as const;
    }),
  ).then((entries) => {
    const loaded = entries.filter(
      (entry): entry is readonly [PlatformerBackdropName, HTMLImageElement] => entry[1] !== null,
    );
    return loaded.length ? Object.fromEntries(loaded) : null;
  });

  const [
    [head12, head12Side, head12Back, head16, head16Side, head16Back, portrait, portraitDefeat],
    [storyIntro, storyBoss, storyVictory, storyDefeat],
    fighterAtlases,
    platformerPoses,
    platformerBoss,
    platformerEnemies,
    platformerProps,
    platformerBackdrops,
    hshooterPlayerCraft,
  ] = await Promise.all([
    likenessPromise,
    storyPromise,
    fighterRosterPromise,
    platformerPromise,
    platformerBossPromise,
    platformerEnemiesPromise,
    platformerPropsPromise,
    platformerBackdropsPromise,
    hshooterPlayerCraftPromise,
  ]);

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
    fighterAtlases,
    platformerPoses,
    platformerBoss,
    platformerEnemies,
    platformerProps,
    platformerBackdrops,
    hshooterPlayerCraft,
  };
}
