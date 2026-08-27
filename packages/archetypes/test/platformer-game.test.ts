import { describe, expect, it } from 'vitest';
import {
  completeGeneratedPlatformerPoses,
  generatedPlatformerPlayerDrawRect,
} from '../src/platformer/game';

describe('generated platformer player poses', () => {
  it('activates only one complete four-frame identity set', () => {
    const image = {} as CanvasImageSource;
    expect(
      completeGeneratedPlatformerPoses({
        idle: image,
        walk1: image,
        walk2: image,
        jump: image,
      }),
    ).toEqual({ idle: image, walk1: image, walk2: image, jump: image });
    expect(
      completeGeneratedPlatformerPoses({ idle: image, walk1: image, jump: image }),
    ).toBeNull();
    expect(completeGeneratedPlatformerPoses(null)).toBeNull();
  });

  it('visually overlaps the tile cap without changing the collision body', () => {
    const rect = generatedPlatformerPlayerDrawRect(100, 50, 12, 28);
    expect(rect).toEqual({ x: 94, y: 48, w: 24, h: 32 });
    expect(rect.y + rect.h).toBe(50 + 28 + 2);
  });
});
