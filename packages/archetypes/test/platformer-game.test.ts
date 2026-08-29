import { describe, expect, it } from 'vitest';
import {
  completeGeneratedPlatformerPoses,
  generatedPlatformerGaitFrame,
  generatedPlatformerGaitRate,
  generatedPlatformerBossDrawRect,
  generatedPlatformerEnemyDrawRect,
  generatedPlatformerPlayerDrawRect,
  generatedPlatformerPoseDrawSize,
} from '../src/platformer/game';

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
});
