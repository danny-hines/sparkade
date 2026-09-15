import { panoramaLandmarkX } from '../src/racing/art';
import { describe, expect, it } from 'vitest';
import { locomotionFrame } from '../src/racing/locomotion';
import { resolveTraversal, racingMotionCell, BICYCLE_TRAVERSAL } from '@sparkade/shared';
describe('shared racing locomotion', () => {
  it('keeps old traversal contracts exact and rejects unsupported motion', () => {
    expect(resolveTraversal(BICYCLE_TRAVERSAL)).toEqual(BICYCLE_TRAVERSAL);
    expect(() => resolveTraversal({ ...BICYCLE_TRAVERSAL, motion: 'fly' })).toThrow();
    expect(resolveTraversal({ ...BICYCLE_TRAVERSAL, motion: 'pedal' })?.motion).toBe('pedal');
  });
  it('advances all six frames with distance, independent of speed changes or repeated rendering', () => {
    expect(
      Array.from({ length: 6 }, (_, i) => locomotionFrame('pedal', i * 7 + 0.1, 35, 'effort')),
    ).toEqual([0, 1, 2, 3, 4, 5]);
    expect(locomotionFrame('pedal', 15, 20, 'effort')).toBe(
      locomotionFrame('pedal', 15, 80, 'cruise'),
    );
    expect(racingMotionCell(0)).toEqual({ sx: 0, sy: 64, size: 64 });
    expect(racingMotionCell(5)).toEqual({ sx: 128, sy: 128, size: 64 });
    expect(racingMotionCell(6)).toEqual(racingMotionCell(0));
  });
  it('rests on stopped, braking, airborne and push-coasting states', () => {
    for (const state of ['idle', 'brake', 'air'] as const)
      expect(locomotionFrame('stride', 10, 40, state)).toBeNull();
    expect(locomotionFrame('pedal', 10, 0, 'effort')).toBeNull();
    expect(locomotionFrame('push', 10, 40, 'cruise')).toBeNull();
    expect(locomotionFrame('push', 10, 40, 'effort')).not.toBeNull();
    expect(locomotionFrame(undefined, 10, 40, 'effort')).toBeNull();
  });
});

it('keeps parallax landmarks periodic without reversing on long turns', () => {
  for (const theta of [-20, -3, 0, 0.3, 4, 30])
    for (const period of [1250, 1750]) {
      expect(panoramaLandmarkX(theta + 2 * Math.PI, 430, period, 2)).toBeCloseTo(
        panoramaLandmarkX(theta, 430, period, 2),
        8,
      );
      expect(panoramaLandmarkX(theta, 430, period, 2)).toBeGreaterThanOrEqual(0);
      expect(panoramaLandmarkX(theta, 430, period, 2)).toBeLessThan(period);
    }
  expect(panoramaLandmarkX(0.1, 430, 1250, 2)).toBeLessThan(panoramaLandmarkX(0, 430, 1250, 2));
});
