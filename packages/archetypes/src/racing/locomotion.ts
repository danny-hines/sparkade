import { racingMotionCell, type RacingMotion } from '@sparkade/shared';

export type LocomotionState = 'idle' | 'cruise' | 'effort' | 'brake' | 'air';

/**
 * Source cell for an animated (height-192) atlas: the live motion frame,
 * else the rear row-0 identity cell. Rest, brake, and air states resolve to
 * the rear cell — never an off-axis bank — while the engine applies full
 * continuous lean against rear. Legacy height-64 strips keep their
 * generated bank cells via craftPoseSourceX.
 */
export function animatedAtlasCell(frame: number | null): { sx: number; sy: number } {
  if (frame === null) return { sx: 0, sy: 0 };
  return racingMotionCell(frame);
}

/** Distance-driven cycles never jump phase when speed changes or advance on pause. */
export function locomotionFrame(
  motion: RacingMotion | undefined,
  distance: number,
  speed: number,
  state: LocomotionState,
): number | null {
  if (
    !motion ||
    motion === 'static' ||
    Math.abs(speed) < 1 ||
    state === 'idle' ||
    state === 'brake' ||
    state === 'air'
  )
    return null;
  if (motion === 'push' && state !== 'effort') return null;
  const cycleDistance = motion === 'stride' ? 28 : motion === 'push' ? 70 : 42;
  const phase = (((distance / cycleDistance) % 1) + 1) % 1;
  return Math.floor(phase * 6);
}
