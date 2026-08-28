import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERATED_GAME_ASSET_FILES, type GeneratedGameAssetRole } from '@sparkade/shared';
import type { GameDetail } from '../src/api';
import {
  FIGHTER_POSE_ASSETS,
  PLATFORMER_POSE_ASSETS,
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
});
