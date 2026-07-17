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
 * New likeness platformers use the full 16x32 visual as their collision body.
 * The explicit spec marker keeps existing saved games with one-tile passages
 * on their legacy 10x14 physics, and the presentation check avoids an
 * invisible tall collider when a sprite could not be upgraded at runtime.
 */
export function platformerPlayerBody(
  playerHeightTiles: 2 | undefined,
  tallPresentationApplied: boolean,
): Readonly<PlatformerPlayerBody> {
  return playerHeightTiles === 2 && tallPresentationApplied
    ? TALL_PLATFORMER_PLAYER_BODY
    : LEGACY_PLATFORMER_PLAYER_BODY;
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
