import type { RacingMotion } from '@sparkade/shared';

export type LocomotionState = 'idle' | 'cruise' | 'effort' | 'brake' | 'air';

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
