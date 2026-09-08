import { describe, expect, it } from 'vitest';
import { moveAABB, type TileGrid } from '@sparkade/engine';
import {
  LEGACY_PLATFORMER_PLAYER_BODY,
  HEROIC_PLATFORMER_PLAYER_BODY,
  MOVING_PLATFORM_BODY,
  TALL_PLATFORMER_PLAYER_BODY,
  platformerDoorRect,
  platformerHeroPresentation,
  platformerMovingPlatformOutlineRect,
  platformerPlayerBody,
  platformerProjectileTargetRect,
  platformerWorldScale,
} from '../src/platformer/geometry';

describe('platformer player geometry', () => {
  it('fits projectile targets to opaque artwork and mirrors asymmetric padding', () => {
    const body = { x: 100, y: 100, w: 14, h: 14 };
    const draw = { x: 95, y: 91, w: 24, h: 24 };
    const bounds = { left: 0.25, right: 1, top: 0.25, bottom: 0.75 };
    expect(platformerProjectileTargetRect(body, draw, bounds, false)).toEqual({
      x: 100,
      y: 97,
      w: 19,
      h: 17,
    });
    expect(platformerProjectileTargetRect(body, draw, bounds, true)).toEqual({
      x: 95,
      y: 97,
      w: 19,
      h: 17,
    });
    expect(body).toEqual({ x: 100, y: 100, w: 14, h: 14 });
  });

  it('makes the explicit height marker authoritative while legacy saves stay native-sized', () => {
    expect(platformerPlayerBody(2)).toEqual(TALL_PLATFORMER_PLAYER_BODY);
    expect(platformerPlayerBody(2, 'heroic')).toEqual(HEROIC_PLATFORMER_PLAYER_BODY);
    expect(platformerPlayerBody(undefined)).toEqual(LEGACY_PLATFORMER_PLAYER_BODY);
    expect(platformerHeroPresentation(2)).toBe('tall-humanoid');
    expect(platformerHeroPresentation(undefined)).toBe('native');
  });

  it('opts only explicit two-tile heroic games into the close camera', () => {
    expect(platformerWorldScale(2, 'heroic')).toBe(2);
    expect(platformerWorldScale(2, 'compact')).toBe(1);
    expect(platformerWorldScale(2, undefined)).toBe(1);
    expect(platformerWorldScale(undefined, 'heroic')).toBe(1);
  });

  it('treats an exit coordinate as the foot tile of a two-tile door', () => {
    expect(platformerDoorRect({ x: 7, y: 12 })).toEqual({ x: 112, y: 176, w: 16, h: 32 });
  });

  it('uses the stock platform art footprint as the moving ride surface', () => {
    expect(MOVING_PLATFORM_BODY).toEqual({ w: 24, h: 8 });
  });

  it('keeps a padded moving-platform outline locked to its display-snapped artwork', () => {
    const normal = platformerMovingPlatformOutlineRect(10.24, 20.24, 0.5, 0.5, 1);
    expect(normal).toEqual({ x: 9.5, y: 19.5, w: 25, h: 9 });
    expect(normal.x + 0.5).toBe(10);
    expect(normal.y + 0.5).toBe(20);

    const nextDisplayPixel = platformerMovingPlatformOutlineRect(10.26, 20.26, 0.5, 0.5, 1);
    expect(nextDisplayPixel.x + 0.5).toBe(10.5);
    expect(nextDisplayPixel.y + 0.5).toBe(20.5);

    const heroic = platformerMovingPlatformOutlineRect(10.13, 20.13, 0.5, 0.5, 2);
    expect(heroic.x + 0.5).toBe(10.25);
    expect(heroic.y + 0.5).toBe(20.25);
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
