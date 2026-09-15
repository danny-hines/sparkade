import { panoramaLandmarkX, packResidualLean, VIS_LEAN_MAX } from '../src/racing/art';
import { describe, expect, it } from 'vitest';
import { animatedAtlasCell, locomotionFrame } from '../src/racing/locomotion';
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

describe('animated atlas steering', () => {
  it('reads the rear row-0 cell at rest, brake, and air — never an off-axis bank', () => {
    for (const state of ['idle', 'brake', 'air'] as const) {
      const frame = locomotionFrame('stride', 10, 40, state);
      expect(frame).toBeNull();
      // sx 0 is the rear identity cell: no bank slot, no mirror, no swap.
      expect(animatedAtlasCell(frame)).toEqual({ sx: 0, sy: 0 });
    }
  });

  it('addresses all six motion rows distinctly in temporal order', () => {
    expect([0, 1, 2, 3, 4, 5].map(animatedAtlasCell)).toEqual(
      [0, 1, 2, 3, 4, 5].map(racingMotionCell),
    );
  });

  it('leans full against rear with no baked deduction', () => {
    expect(packResidualLean(1, 'rear')).toBeCloseTo(VIS_LEAN_MAX, 12);
    expect(packResidualLean(-1, 'rear')).toBeCloseTo(-VIS_LEAN_MAX, 12);
    expect(packResidualLean(0, 'rear')).toBe(0);
  });
});

it('renders neutral fallback with full lean while legacy bank cells retain their compensation', async () => {
  const { racingCraftStripKind } = await import('@sparkade/shared');
  const { packCraftSource } = await import('../src/racing/art');
  const neutral = racingCraftStripKind(64, 64);
  const legacy = racingCraftStripKind(192, 64);
  const animated = racingCraftStripKind(192, 192);
  expect(racingCraftStripKind(128, 64)).toBeNull();
  for (const pose of ['bankLeft', 'bankRight'] as const) {
    const n = packCraftSource(neutral, pose, 4);
    expect(n).toEqual({ sx: 0, sy: 0, leanPose: 'rear' });
    expect(packResidualLean(1, n.leanPose)).toBeCloseTo(VIS_LEAN_MAX);
    const bank = packCraftSource(legacy, pose, 4);
    expect(bank).toEqual({ sx: pose === 'bankLeft' ? 64 : 128, sy: 0, leanPose: pose });
    expect(packResidualLean(1, bank.leanPose)).not.toBeCloseTo(VIS_LEAN_MAX);
    expect(packCraftSource(animated, pose, 4)).toEqual({ sx: 64, sy: 128, leanPose: 'rear' });
  }
});
