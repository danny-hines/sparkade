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

export const FIGHTER_ARENA_ASSET = 'fighterArenaAtlas' as const satisfies GeneratedGameAssetRole;

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
  ['powerupDoubleJump', 'platformerPropPowerupDoubleJump'],
  ['powerupProjectile', 'platformerPropPowerupProjectile'],
  ['powerupShield', 'platformerPropPowerupShield'],
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

export const HSHOOTER_BACKDROP_ASSETS = [
  ['level1', 'hshooterBackdropLevel1'],
  ['level2', 'hshooterBackdropLevel2'],
  ['level3', 'hshooterBackdropLevel3'],
  ['boss', 'hshooterBackdropBoss'],
] as const satisfies readonly (readonly [string, GeneratedGameAssetRole])[];

export type HShooterBackdropName = (typeof HSHOOTER_BACKDROP_ASSETS)[number][0];

export const SHOOTER_BACKDROP_ASSETS = [
  ['level1', 'shooterBackdropLevel1'],
  ['level2', 'shooterBackdropLevel2'],
  ['level3', 'shooterBackdropLevel3'],
  ['boss', 'shooterBackdropBoss'],
] as const satisfies readonly (readonly [string, GeneratedGameAssetRole])[];

export type ShooterBackdropName = (typeof SHOOTER_BACKDROP_ASSETS)[number][0];

export const ADVENTURE_ROOM_PLATES_ASSET =
  'adventureRoomPlates' as const satisfies GeneratedGameAssetRole;

export const ADVENTURE_BOSS_ASSET = 'adventureBoss' as const satisfies GeneratedGameAssetRole;
export const ADVENTURE_ENEMY_ATLAS_ASSET =
  'adventureEnemyAtlas' as const satisfies GeneratedGameAssetRole;
export const ADVENTURE_OBJECT_ATLAS_ASSET =
  'adventureObjectAtlas' as const satisfies GeneratedGameAssetRole;

export const ADVENTURE_PLAYER_POSE_ASSETS = [
  ['downIdle', 'adventurePlayerDownIdle'],
  ['downWalk', 'adventurePlayerDownWalk'],
  ['upIdle', 'adventurePlayerUpIdle'],
  ['upWalk', 'adventurePlayerUpWalk'],
  ['sideIdle', 'adventurePlayerSideIdle'],
  ['sideWalk', 'adventurePlayerSideWalk'],
  ['downMelee', 'adventurePlayerDownMelee'],
  ['upMelee', 'adventurePlayerUpMelee'],
  ['sideMelee', 'adventurePlayerSideMelee'],
  ['downSecondary', 'adventurePlayerDownSecondary'],
  ['upSecondary', 'adventurePlayerUpSecondary'],
  ['sideSecondary', 'adventurePlayerSideSecondary'],
] as const satisfies readonly (readonly [string, GeneratedGameAssetRole])[];

export type AdventurePlayerPoseName = (typeof ADVENTURE_PLAYER_POSE_ASSETS)[number][0];

export const HSHOOTER_PLAYER_CRAFT_ASSET =
  'hshooterPlayerCraft' as const satisfies GeneratedGameAssetRole;
export const HSHOOTER_BOSS_ASSET = 'hshooterBoss' as const satisfies GeneratedGameAssetRole;
export const HSHOOTER_ENEMY_ATLAS_ASSET =
  'hshooterEnemyAtlas' as const satisfies GeneratedGameAssetRole;
export const SHOOTER_PLAYER_CRAFT_ASSET =
  'shooterPlayerCraft' as const satisfies GeneratedGameAssetRole;
export const SHOOTER_BOSS_ASSET = 'shooterBoss' as const satisfies GeneratedGameAssetRole;
export const SHOOTER_ENEMY_ATLAS_ASSET =
  'shooterEnemyAtlas' as const satisfies GeneratedGameAssetRole;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (typeof img.decode !== 'function') {
        resolve(img);
        return;
      }
      void img.decode().then(
        () => resolve(img),
        () => resolve(null),
      );
    };
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
  const hasCompleteAdventurePlayerSet = ADVENTURE_PLAYER_POSE_ASSETS.every(
    ([, role]) => assets[role],
  );
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
    !assets[HSHOOTER_BOSS_ASSET] &&
    !assets[HSHOOTER_ENEMY_ATLAS_ASSET] &&
    !assets.shooterPlayerCraft &&
    !assets[SHOOTER_BOSS_ASSET] &&
    !assets[SHOOTER_ENEMY_ATLAS_ASSET] &&
    !assets[FIGHTER_ARENA_ASSET] &&
    !assets.platformerBoss &&
    !assets.adventureRoomPlates &&
    !assets[ADVENTURE_BOSS_ASSET] &&
    !assets[ADVENTURE_ENEMY_ATLAS_ASSET] &&
    !assets[ADVENTURE_OBJECT_ATLAS_ASSET] &&
    !PLATFORMER_ENEMY_ASSETS.some(([, role]) => assets[role]) &&
    !PLATFORMER_PROP_ASSETS.some(([, role]) => assets[role]) &&
    !PLATFORMER_BACKDROP_ASSETS.some(([, role]) => assets[role]) &&
    !HSHOOTER_BACKDROP_ASSETS.some(([, role]) => assets[role]) &&
    !SHOOTER_BACKDROP_ASSETS.some(([, role]) => assets[role]) &&
    !hasCompleteFighterRoster &&
    !hasCompletePlatformerSet &&
    !hasCompleteAdventurePlayerSet
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
  const hshooterBossPromise = assets[HSHOOTER_BOSS_ASSET]
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[HSHOOTER_BOSS_ASSET]))
    : Promise.resolve(null);
  const hshooterEnemyAtlasPromise = assets[HSHOOTER_ENEMY_ATLAS_ASSET]
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[HSHOOTER_ENEMY_ATLAS_ASSET]))
    : Promise.resolve(null);
  const shooterPlayerCraftPromise = assets.shooterPlayerCraft
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES.shooterPlayerCraft))
    : Promise.resolve(null);
  const shooterBossPromise = assets[SHOOTER_BOSS_ASSET]
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[SHOOTER_BOSS_ASSET]))
    : Promise.resolve(null);
  const shooterEnemyAtlasPromise = assets[SHOOTER_ENEMY_ATLAS_ASSET]
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[SHOOTER_ENEMY_ATLAS_ASSET]))
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
  const fighterArenaPromise = assets[FIGHTER_ARENA_ASSET]
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[FIGHTER_ARENA_ASSET]))
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
  const hshooterBackdropsPromise = Promise.all(
    HSHOOTER_BACKDROP_ASSETS.map(async ([role, assetRole]) => {
      if (!assets[assetRole]) return [role, null] as const;
      return [
        role,
        await loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[assetRole])),
      ] as const;
    }),
  ).then((entries) => {
    const loaded = entries.filter(
      (entry): entry is readonly [HShooterBackdropName, HTMLImageElement] => entry[1] !== null,
    );
    return loaded.length ? Object.fromEntries(loaded) : null;
  });
  const shooterBackdropsPromise = Promise.all(
    SHOOTER_BACKDROP_ASSETS.map(async ([role, assetRole]) => {
      if (!assets[assetRole]) return [role, null] as const;
      return [
        role,
        await loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[assetRole])),
      ] as const;
    }),
  ).then((entries) => {
    const loaded = entries.filter(
      (entry): entry is readonly [ShooterBackdropName, HTMLImageElement] => entry[1] !== null,
    );
    return loaded.length ? Object.fromEntries(loaded) : null;
  });
  const adventureRoomPlatesPromise = assets[ADVENTURE_ROOM_PLATES_ASSET]
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[ADVENTURE_ROOM_PLATES_ASSET]))
    : Promise.resolve(null);
  const adventureBossPromise = assets[ADVENTURE_BOSS_ASSET]
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[ADVENTURE_BOSS_ASSET]))
    : Promise.resolve(null);
  const adventureEnemyAtlasPromise = assets[ADVENTURE_ENEMY_ATLAS_ASSET]
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[ADVENTURE_ENEMY_ATLAS_ASSET]))
    : Promise.resolve(null);
  const adventureObjectAtlasPromise = assets[ADVENTURE_OBJECT_ATLAS_ASSET]
    ? loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[ADVENTURE_OBJECT_ATLAS_ASSET]))
    : Promise.resolve(null);
  const adventurePlayerPromise: Promise<Record<AdventurePlayerPoseName, HTMLImageElement> | null> =
    hasCompleteAdventurePlayerSet
      ? Promise.all(
          ADVENTURE_PLAYER_POSE_ASSETS.map(([, role]) =>
            loadImage(api.assetUrl(gameId, GENERATED_GAME_ASSET_FILES[role])),
          ),
        ).then((images) => {
          if (images.some((image) => image === null)) return null;
          return Object.fromEntries(
            ADVENTURE_PLAYER_POSE_ASSETS.map(([pose], index) => [pose, images[index]!]),
          ) as Record<AdventurePlayerPoseName, HTMLImageElement>;
        })
      : Promise.resolve(null);

  const [
    [head12, head12Side, head12Back, head16, head16Side, head16Back, portrait, portraitDefeat],
    [storyIntro, storyBoss, storyVictory, storyDefeat],
    fighterAtlases,
    fighterArenaAtlas,
    platformerPoses,
    platformerBoss,
    platformerEnemies,
    platformerProps,
    platformerBackdrops,
    hshooterBackdrops,
    shooterBackdrops,
    adventureRoomPlates,
    adventureBoss,
    adventureEnemyAtlas,
    adventureObjectAtlas,
    adventurePlayerPoses,
    hshooterPlayerCraft,
    hshooterBoss,
    hshooterEnemyAtlas,
    shooterPlayerCraft,
    shooterBoss,
    shooterEnemyAtlas,
  ] = await Promise.all([
    likenessPromise,
    storyPromise,
    fighterRosterPromise,
    fighterArenaPromise,
    platformerPromise,
    platformerBossPromise,
    platformerEnemiesPromise,
    platformerPropsPromise,
    platformerBackdropsPromise,
    hshooterBackdropsPromise,
    shooterBackdropsPromise,
    adventureRoomPlatesPromise,
    adventureBossPromise,
    adventureEnemyAtlasPromise,
    adventureObjectAtlasPromise,
    adventurePlayerPromise,
    hshooterPlayerCraftPromise,
    hshooterBossPromise,
    hshooterEnemyAtlasPromise,
    shooterPlayerCraftPromise,
    shooterBossPromise,
    shooterEnemyAtlasPromise,
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
    fighterArenaAtlas,
    fighterArenaPresentationBaked: assets.fighterArenaPresentationBaked ?? false,
    platformerPoses,
    platformerBoss,
    platformerEnemies,
    platformerProps,
    platformerBackdrops,
    hshooterBackdrops,
    shooterBackdrops,
    adventureRoomPlates,
    adventureBoss,
    adventureEnemyAtlas,
    adventureObjectAtlas,
    adventurePlayerPoses,
    hshooterPlayerCraft,
    hshooterBoss,
    hshooterEnemyAtlas,
    shooterPlayerCraft,
    shooterBoss,
    shooterEnemyAtlas,
  };
}
