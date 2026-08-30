import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERATED_GAME_ASSET_FILES, type GeneratedGameAssetRole } from '@sparkade/shared';
import type { GameDetail } from '../src/api';
import {
  FIGHTER_ARENA_ASSET,
  FIGHTER_ROSTER_ATLAS_ASSETS,
  HSHOOTER_PLAYER_CRAFT_ASSET,
  PLATFORMER_BACKDROP_ASSETS,
  PLATFORMER_ENEMY_ASSETS,
  PLATFORMER_POSE_ASSETS,
  PLATFORMER_PROP_ASSETS,
  loadLikenessAssets,
} from '../src/likeness-assets';

const requested: string[] = [];
const failing = new Set<string>();

class FakeImage {
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event | string) => void) | null = null;
  private value = '';

  get src(): string {
    return this.value;
  }

  set src(value: string) {
    this.value = value;
    requested.push(value);
    queueMicrotask(() => {
      if (failing.has(value)) this.onerror?.('failed');
      else this.onload?.(new Event('load'));
    });
  }
}

const unavailableGeneratedAssets = Object.fromEntries(
  (Object.keys(GENERATED_GAME_ASSET_FILES) as GeneratedGameAssetRole[]).map((role) => [
    role,
    false,
  ]),
) as Record<GeneratedGameAssetRole, boolean>;

const legacyAssets: GameDetail['assets'] = {
  head12: true,
  head12Side: false,
  head12Back: false,
  head16: true,
  head16Side: false,
  head16Back: false,
  portrait: true,
  ...unavailableGeneratedAssets,
};

describe('loadLikenessAssets', () => {
  beforeEach(() => {
    requested.length = 0;
    failing.clear();
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads legacy front assets without requesting missing directional files', async () => {
    const result = await loadLikenessAssets('old-game', legacyAssets);

    expect(result).not.toBeNull();
    expect(result?.head12Side).toBeNull();
    expect(result?.head16Back).toBeNull();
    expect(requested).toEqual([
      '/api/games/old-game/assets/head12.png',
      '/api/games/old-game/assets/head16.png',
      '/api/games/old-game/assets/portrait.png',
    ]);
  });

  it('loads every available directional view under its stable filename', async () => {
    await loadLikenessAssets('new-game', {
      ...legacyAssets,
      head12Side: true,
      head12Back: true,
      head16Side: true,
      head16Back: true,
    });

    expect(requested).toEqual([
      '/api/games/new-game/assets/head12.png',
      '/api/games/new-game/assets/head12-side.png',
      '/api/games/new-game/assets/head12-back.png',
      '/api/games/new-game/assets/head16.png',
      '/api/games/new-game/assets/head16-side.png',
      '/api/games/new-game/assets/head16-back.png',
      '/api/games/new-game/assets/portrait.png',
    ]);
  });

  it('loads generated story scenes alongside likeness assets', async () => {
    const result = await loadLikenessAssets('story-game', {
      ...legacyAssets,
      storyIntro: true,
      storyBoss: true,
      storyVictory: true,
      storyDefeat: true,
      generatedPortraitDefeat: true,
    });

    expect(result?.storyIntro).not.toBeNull();
    expect(result?.storyBoss).not.toBeNull();
    expect(result?.storyVictory).not.toBeNull();
    expect(result?.storyDefeat).not.toBeNull();
    expect(result?.portraitDefeat).not.toBeNull();
    expect(requested).toContain('/api/games/story-game/assets/story-intro.png');
    expect(requested).toContain('/api/games/story-game/assets/story-boss.png');
    expect(requested).toContain('/api/games/story-game/assets/story-victory.png');
    expect(requested).toContain('/api/games/story-game/assets/story-defeat.png');
    expect(requested).toContain('/api/games/story-game/assets/portrait-defeat.png');
  });

  it('loads a generated H-scroll craft without requiring likeness heads', async () => {
    const result = await loadLikenessAssets('hscroll-game', {
      head12: false,
      head12Side: false,
      head12Back: false,
      head16: false,
      head16Side: false,
      head16Back: false,
      portrait: false,
      ...unavailableGeneratedAssets,
      [HSHOOTER_PLAYER_CRAFT_ASSET]: true,
    });

    expect(result?.hshooterPlayerCraft).not.toBeNull();
    expect(requested).toEqual([
      `/api/games/hscroll-game/assets/${GENERATED_GAME_ASSET_FILES.hshooterPlayerCraft}`,
    ]);
  });

  it('loads the complete generated fighter roster as five stable identity atlases', async () => {
    const rosterAvailability = Object.fromEntries(
      FIGHTER_ROSTER_ATLAS_ASSETS.map((role) => [role, true]),
    );
    const result = await loadLikenessAssets('roster-fighter', {
      ...legacyAssets,
      ...rosterAvailability,
    });

    expect(result?.fighterAtlases).toHaveLength(5);
    expect(requested.filter((url) => url.includes('-atlas.png'))).toEqual(
      FIGHTER_ROSTER_ATLAS_ASSETS.map(
        (role) => `/api/games/roster-fighter/assets/${GENERATED_GAME_ASSET_FILES[role]}`,
      ),
    );
  });

  it('loads the generated Fighter ladder and boss arena atlas independently', async () => {
    const result = await loadLikenessAssets('arena-fighter', {
      ...legacyAssets,
      [FIGHTER_ARENA_ASSET]: true,
    });

    expect(result?.fighterArenaAtlas).not.toBeNull();
    expect(requested).toContain(
      `/api/games/arena-fighter/assets/${GENERATED_GAME_ASSET_FILES[FIGHTER_ARENA_ASSET]}`,
    );
  });

  it('does not expose a partially loaded fighter roster', async () => {
    const rosterAvailability = Object.fromEntries(
      FIGHTER_ROSTER_ATLAS_ASSETS.map((role) => [role, true]),
    );
    failing.add(
      `/api/games/broken-roster/assets/${GENERATED_GAME_ASSET_FILES.fighterOpponent2Atlas}`,
    );

    const result = await loadLikenessAssets('broken-roster', {
      ...legacyAssets,
      ...rosterAvailability,
    });

    expect(result?.fighterAtlases).toBeNull();
    expect(requested.filter((url) => url.includes('-atlas.png'))).toHaveLength(5);
  });

  it('exposes platformer poses only after the complete five-frame set loads', async () => {
    const availability = Object.fromEntries(PLATFORMER_POSE_ASSETS.map(([, role]) => [role, true]));
    const result = await loadLikenessAssets('platformer-game', {
      ...legacyAssets,
      ...availability,
    });

    expect(Object.keys(result?.platformerPoses ?? {})).toEqual(
      PLATFORMER_POSE_ASSETS.map(([pose]) => pose),
    );
    for (const [, role] of PLATFORMER_POSE_ASSETS) {
      expect(requested).toContain(
        `/api/games/platformer-game/assets/${GENERATED_GAME_ASSET_FILES[role]}`,
      );
    }
  });

  it('rejects the entire platformer set when one pose fails to load', async () => {
    const availability = Object.fromEntries(PLATFORMER_POSE_ASSETS.map(([, role]) => [role, true]));
    failing.add(
      `/api/games/broken-platformer/assets/${GENERATED_GAME_ASSET_FILES.platformerWalk2}`,
    );

    const result = await loadLikenessAssets('broken-platformer', {
      ...legacyAssets,
      ...availability,
    });

    expect(result?.platformerPoses).toBeNull();
    expect(requested.filter((url) => url.includes('/assets/platformer-player-'))).toHaveLength(5);
  });

  it('loads a generated platformer boss independently from player likeness art', async () => {
    const result = await loadLikenessAssets('boss-game', {
      head12: false,
      head12Side: false,
      head12Back: false,
      head16: false,
      head16Side: false,
      head16Back: false,
      portrait: false,
      ...unavailableGeneratedAssets,
      platformerBoss: true,
    });

    expect(result?.platformerBoss).not.toBeNull();
    expect(requested).toEqual(['/api/games/boss-game/assets/platformer-boss.png']);
  });

  it('loads each available generated platformer enemy independently', async () => {
    const result = await loadLikenessAssets('enemy-game', {
      head12: false,
      head12Side: false,
      head12Back: false,
      head16: false,
      head16Side: false,
      head16Back: false,
      portrait: false,
      ...unavailableGeneratedAssets,
      platformerEnemyWalker: true,
      platformerEnemyChaser: true,
    });

    expect(Object.keys(result?.platformerEnemies ?? {})).toEqual(['walker', 'chaser']);
    expect(result?.platformerEnemies?.walker).not.toBeNull();
    expect(result?.platformerEnemies?.flyer).toBeUndefined();
    expect(requested).toEqual(
      PLATFORMER_ENEMY_ASSETS.filter(([role]) => role === 'walker' || role === 'chaser').map(
        ([, assetRole]) => `/api/games/enemy-game/assets/${GENERATED_GAME_ASSET_FILES[assetRole]}`,
      ),
    );
  });

  it('loads each available generated platformer prop independently', async () => {
    const result = await loadLikenessAssets('prop-game', {
      head12: false,
      head12Side: false,
      head12Back: false,
      head16: false,
      head16Side: false,
      head16Back: false,
      portrait: false,
      ...unavailableGeneratedAssets,
      platformerPropCollectible: true,
      platformerPropPowerup: true,
      platformerPropEnemyProjectile: true,
    });

    expect(Object.keys(result?.platformerProps ?? {})).toEqual([
      'collectible',
      'powerup',
      'enemyProjectile',
    ]);
    expect(result?.platformerProps?.collectible).not.toBeNull();
    expect(result?.platformerProps?.health).toBeUndefined();
    expect(requested).toEqual(
      PLATFORMER_PROP_ASSETS.filter(
        ([role]) => role === 'collectible' || role === 'powerup' || role === 'enemyProjectile',
      ).map(
        ([, assetRole]) => `/api/games/prop-game/assets/${GENERATED_GAME_ASSET_FILES[assetRole]}`,
      ),
    );
  });

  it('loads each available generated platformer background independently', async () => {
    const result = await loadLikenessAssets('backdrop-game', {
      head12: false,
      head12Side: false,
      head12Back: false,
      head16: false,
      head16Side: false,
      head16Back: false,
      portrait: false,
      ...unavailableGeneratedAssets,
      platformerBackdropLevel1: true,
      platformerBackdropLevel3: true,
      platformerBackdropBoss: true,
    });

    expect(Object.keys(result?.platformerBackdrops ?? {})).toEqual(['level1', 'level3', 'boss']);
    expect(result?.platformerBackdrops?.level1).not.toBeNull();
    expect(result?.platformerBackdrops?.level2).toBeUndefined();
    expect(requested).toEqual(
      PLATFORMER_BACKDROP_ASSETS.filter(
        ([role]) => role === 'level1' || role === 'level3' || role === 'boss',
      ).map(
        ([, assetRole]) =>
          `/api/games/backdrop-game/assets/${GENERATED_GAME_ASSET_FILES[assetRole]}`,
      ),
    );
  });
});
