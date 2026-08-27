import type { SpritePresentation } from '@sparkade/engine';
import { TILE_SIZE, type Coord, type PlatformerScale } from '@sparkade/shared';

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

/** Heroic art keeps a forgiving foot-anchored hurtbox inside the 16x32 art. */
export const HEROIC_PLATFORMER_PLAYER_BODY: Readonly<PlatformerPlayerBody> = {
  w: 12,
  h: 28,
};

/** Canonical one-way ride surface used by authored moving-platform entities. */
export const MOVING_PLATFORM_BODY: Readonly<PlatformerPlayerBody> = {
  w: 24,
  h: 8,
};

/**
 * The explicit marker keeps existing saved games with one-tile passages on
 * legacy 10x14 physics. Compact games use their full 16x32 visual as collision;
 * heroic games inset that body so enlarged hair/shoulders do not snag terrain.
 */
export function platformerPlayerBody(
  playerHeightTiles: 2 | undefined,
  scale: PlatformerScale | undefined = 'compact',
): Readonly<PlatformerPlayerBody> {
  if (playerHeightTiles !== 2) return LEGACY_PLATFORMER_PLAYER_BODY;
  return scale === 'heroic' ? HEROIC_PLATFORMER_PLAYER_BODY : TALL_PLATFORMER_PLAYER_BODY;
}

/** Saved games omit the field and retain their original wide camera. */
export function platformerWorldScale(
  playerHeightTiles: 2 | undefined,
  scale: PlatformerScale | undefined,
): 1 | 2 {
  return playerHeightTiles === 2 && scale === 'heroic' ? 2 : 1;
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
