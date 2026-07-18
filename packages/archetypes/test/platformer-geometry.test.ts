import { describe, expect, it } from 'vitest';
import { moveAABB, type TileGrid } from '@sparkade/engine';
import {
  LEGACY_PLATFORMER_PLAYER_BODY,
  MOVING_PLATFORM_BODY,
  TALL_PLATFORMER_PLAYER_BODY,
  platformerDoorRect,
  platformerHeroPresentation,
  platformerPlayerBody,
} from '../src/platformer/geometry';

describe('platformer player geometry', () => {
  it('makes the explicit height marker authoritative while legacy saves stay native-sized', () => {
    expect(platformerPlayerBody(2)).toEqual(TALL_PLATFORMER_PLAYER_BODY);
    expect(platformerPlayerBody(undefined)).toEqual(LEGACY_PLATFORMER_PLAYER_BODY);
    expect(platformerHeroPresentation(2)).toBe('tall-humanoid');
    expect(platformerHeroPresentation(undefined)).toBe('native');
  });

  it('treats an exit coordinate as the foot tile of a two-tile door', () => {
    expect(platformerDoorRect({ x: 7, y: 12 })).toEqual({ x: 112, y: 176, w: 16, h: 32 });
  });

  it('uses the stock platform art footprint as the moving ride surface', () => {
    expect(MOVING_PLATFORM_BODY).toEqual({ w: 24, h: 8 });
  });

  it('makes a low ceiling collide with the tall visual body while legacy saves still pass', () => {
    const grid: TileGrid = {
      cols: 6,
      rows: 4,
      tileSize: 16,
      solidityAt: (x, y) => (y === 3 || (x === 3 && y === 1) ? 'solid' : 'empty'),
    };
    const tall = moveAABB(grid, { x: 16, y: 16, ...TALL_PLATFORMER_PLAYER_BODY }, 40, 0);
    const legacy = moveAABB(grid, { x: 19, y: 34, ...LEGACY_PLATFORMER_PLAYER_BODY }, 40, 0);

    expect(tall.hitX).toBe(true);
    expect(tall.x).toBeLessThan(33);
    expect(legacy.hitX).toBe(false);
    expect(legacy.x).toBe(59);
  });
});
