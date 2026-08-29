import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERATED_GAME_ASSET_FILES, type GeneratedGameAssetRole } from '@sparkade/shared';
import type { GameDetail } from '../src/api';
import {
  FIGHTER_POSE_ASSETS,
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

  it('exposes fighter poses only after the complete 11-pose set loads', async () => {
    const fighterAvailability = Object.fromEntries(
      FIGHTER_POSE_ASSETS.map(([, role]) => [role, true]),
    );
    const result = await loadLikenessAssets('fighter-game', {
      ...legacyAssets,
      ...fighterAvailability,
    });

    expect(Object.keys(result?.fighterPoses ?? {})).toEqual(
      FIGHTER_POSE_ASSETS.map(([pose]) => pose),
    );
    for (const [, role] of FIGHTER_POSE_ASSETS) {
      expect(requested).toContain(
        `/api/games/fighter-game/assets/${GENERATED_GAME_ASSET_FILES[role]}`,
      );
    }
  });

  it('rejects the entire generated fighter set when one pose fails to load', async () => {
    const fighterAvailability = Object.fromEntries(
      FIGHTER_POSE_ASSETS.map(([, role]) => [role, true]),
    );
    failing.add(`/api/games/broken-fighter/assets/${GENERATED_GAME_ASSET_FILES.fighterHit}`);

    const result = await loadLikenessAssets('broken-fighter', {
      ...legacyAssets,
      ...fighterAvailability,
    });

    expect(result?.fighterPoses).toBeNull();
    expect(requested.filter((url) => url.includes('/assets/fighter-player-'))).toHaveLength(11);
  });

  it('does not start loading an incomplete fighter pose set', async () => {
    const fighterAvailability = Object.fromEntries(
      FIGHTER_POSE_ASSETS.map(([, role]) => [role, role !== 'fighterKo']),
    );

    const result = await loadLikenessAssets('partial-fighter', {
      ...legacyAssets,
      ...fighterAvailability,
    });

    expect(result?.fighterPoses).toBeNull();
    expect(requested.some((url) => url.includes('/assets/fighter-player-'))).toBe(false);
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
