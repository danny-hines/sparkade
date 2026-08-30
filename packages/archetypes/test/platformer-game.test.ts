import { describe, expect, it } from 'vitest';
import { resolvePlatformerMovement } from '@sparkade/shared';
import {
  completeGeneratedPlatformerPoses,
  generatedPlatformerGaitFrame,
  generatedPlatformerGaitRate,
  generatedPlatformerBossDrawRect,
  generatedPlatformerEnemyDrawRect,
  generatedPlatformerPlayerDrawRect,
  generatedPlatformerPoseDrawSize,
  generatedPlatformerPropDrawRect,
  platformerSpringDrawRect,
  stepPlatformerHorizontalVelocity,
} from '../src/platformer/game';

describe('platformer movement profiles', () => {
  it('makes precision accelerate and stop faster while momentum preserves speed', () => {
    const balanced = resolvePlatformerMovement('balanced');
    const precision = resolvePlatformerMovement('precision');
    const momentum = resolvePlatformerMovement('momentum');

    const accelerate = (movement: typeof balanced) =>
      stepPlatformerHorizontalVelocity(0, 1, 142 * movement.speed, 0.1, true, movement);
    expect(accelerate(precision)).toBeGreaterThan(accelerate(balanced));

    const release = (movement: typeof balanced) =>
      stepPlatformerHorizontalVelocity(100, 0, 142 * movement.speed, 0.1, true, movement);
    expect(release(precision)).toBeLessThan(release(balanced));
    expect(release(momentum)).toBeGreaterThan(release(balanced));
  });

  it('makes precision air correction stronger than momentum air correction', () => {
    const precision = resolvePlatformerMovement('precision');
    const momentum = resolvePlatformerMovement('momentum');
    const correct = (movement: typeof precision) =>
      stepPlatformerHorizontalVelocity(80, -1, 142 * movement.speed, 0.1, false, movement);
    expect(correct(precision)).toBeLessThan(correct(momentum));
  });
});

describe('generated platformer player poses', () => {
  it('activates only one complete five-frame identity set', () => {
    const image = {} as CanvasImageSource;
    expect(
      completeGeneratedPlatformerPoses({
        idle: image,
        sideIdle: image,
        walk1: image,
        walk2: image,
        jump: image,
      }),
    ).toEqual({ idle: image, sideIdle: image, walk1: image, walk2: image, jump: image });
    expect(completeGeneratedPlatformerPoses({ idle: image, walk1: image, jump: image })).toBeNull();
    expect(completeGeneratedPlatformerPoses(null)).toBeNull();
  });

  it('visually overlaps the tile cap without changing the collision body', () => {
    const rect = generatedPlatformerPlayerDrawRect(100, 50, 12, 28);
    expect(rect).toEqual({ x: 94, y: 48, w: 24, h: 32 });
    expect(rect.y + rect.h).toBe(50 + 28 + 2);
  });

  it('keeps legacy density-2 and new density-4 art in the same logical footprint', () => {
    expect(generatedPlatformerPoseDrawSize(56, 64)).toEqual({ w: 28, h: 32 });
    expect(generatedPlatformerPoseDrawSize(112, 128)).toEqual({ w: 28, h: 32 });
    expect(generatedPlatformerPoseDrawSize(48, 64)).toEqual({ w: 24, h: 32 });
  });

  it('uses a speed-driven contact, side-idle, contact, side-idle gait', () => {
    expect(generatedPlatformerGaitRate(88)).toBeCloseTo(8.21, 2);
    expect(generatedPlatformerGaitRate(142)).toBeCloseTo(13.25, 2);
    expect([0, 1, 2, 3, 4, 5].map(generatedPlatformerGaitFrame)).toEqual([
      { pose: 'walk1', compression: 0 },
      { pose: 'walk1', compression: 0 },
      { pose: 'sideIdle', compression: 0 },
      { pose: 'walk2', compression: 0 },
      { pose: 'walk2', compression: 0 },
      { pose: 'sideIdle', compression: 0 },
    ]);
    const compressed = generatedPlatformerPlayerDrawRect(100, 50, 12, 28, 28, 32, 1);
    expect(compressed).toEqual({ x: 92, y: 49, w: 28, h: 31 });
    expect(compressed.y + compressed.h).toBe(50 + 28 + 2);
  });

  it('centers the larger generated boss over the stable collision body and ground line', () => {
    const rect = generatedPlatformerBossDrawRect(200, 90, 26, 30);
    expect(rect).toEqual({ x: 189, y: 74, w: 48, h: 48 });
    expect(rect.y + rect.h).toBe(90 + 30 + 2);
  });

  it('centers generated enemies over their stable behavior colliders', () => {
    const walker = generatedPlatformerEnemyDrawRect('walker', 100, 50, 14, 14);
    expect(walker).toEqual({ x: 95, y: 41, w: 24, h: 24 });
    expect(walker.y + walker.h).toBe(50 + 14 + 1);

    const flyer = generatedPlatformerEnemyDrawRect('flyer', 100, 50, 14, 14);
    expect(flyer).toEqual({ x: 94, y: 43, w: 26, h: 22 });
  });

  it('renders density-four springs at the original one-tile gameplay size', () => {
    const rect = platformerSpringDrawRect(101, 81, 14, 14);
    expect(rect).toEqual({ x: 100, y: 79, w: 16, h: 16 });
    expect(rect.y + rect.h).toBe(81 + 14);
  });

  it('animates generated pickups inside their unchanged collision footprint', () => {
    const coin = generatedPlatformerPropDrawRect('coin', 100, 50, 12, 12, 0);
    expect(coin).toEqual({ x: 100, y: 49.25, w: 12, h: 12 });

    const heart = generatedPlatformerPropDrawRect('heart', 100, 50, 12, 12, Math.PI / 8);
    expect(heart.x).toBe(100);
    expect(heart.w).toBe(12);
    expect(heart.h).toBeGreaterThan(12);

    const powerup = generatedPlatformerPropDrawRect('powerup', 100, 50, 12, 12, 0);
    expect(powerup).toEqual({ x: 100, y: 48.5, w: 12, h: 12 });
  });
});
