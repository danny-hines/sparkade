import type { SpritePresentation } from '@sparkade/engine';
import { TILE_SIZE, type Coord } from '@sparkade/shared';

export interface PlatformerPlayerBody {
  w: number;
  h: number;
}

export interface PlatformerRect extends PlatformerPlayerBody {
  x: number;
  y: number;
}

export const LEGACY_PLATFORMER_PLAYER_BODY: Readonly<PlatformerPlayerBody> = {
  w: 10,
  h: 14,
};

export const TALL_PLATFORMER_PLAYER_BODY: Readonly<PlatformerPlayerBody> = {
  w: TILE_SIZE,
  h: TILE_SIZE * 2,
};

/** Canonical one-way ride surface used by authored moving-platform entities. */
export const MOVING_PLATFORM_BODY: Readonly<PlatformerPlayerBody> = {
  w: 24,
  h: 8,
};

/**
 * Marked platformers use the full 16x32 visual as their collision body. Sprite
 * resolution guarantees the matching 16x32 presentation; the explicit marker
 * keeps existing saved games with one-tile passages on legacy 10x14 physics.
 */
export function platformerPlayerBody(
  playerHeightTiles: 2 | undefined,
): Readonly<PlatformerPlayerBody> {
  return playerHeightTiles === 2
    ? TALL_PLATFORMER_PLAYER_BODY
    : LEGACY_PLATFORMER_PLAYER_BODY;
}

/** Legacy specs retain their authored sprite dimensions; only marked games opt in. */
export function platformerHeroPresentation(
  playerHeightTiles: 2 | undefined,
): SpritePresentation {
  return playerHeightTiles === 2 ? 'tall-humanoid' : 'native';
}

/** Exit coordinates are the lower (feet) tile of a two-tile-tall door. */
export function platformerDoorRect(exit: Coord): PlatformerRect {
  return {
    x: exit.x * TILE_SIZE,
    y: (exit.y - 1) * TILE_SIZE,
    w: TILE_SIZE,
    h: TILE_SIZE * 2,
  };
}
