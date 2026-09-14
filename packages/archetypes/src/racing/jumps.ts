// Bounded jump ramps for racing circuits: optional deterministic takeoff zones.
//
// When a circuit compiles with jumps 'ramps', 1-2 centered JumpRamp zones are
// placed by a bounded deterministic search around ~0.18/~0.62 of the lap —
// away from the grid/start/finish, checkpoint gates, and severe curves, with
// no runtime randomness (placement is a pure function of the compiled track).
// Omission (or 'none') compiles zero ramps and the circuit object keeps its
// exact legacy shape (the `ramps` key stays absent).
//
// A ramp is a painted zone [s, s+length] with a takeoff lip at s+length. The
// simulation launches a grounded racer whose forward sweep crosses the lip
// with lateral overlap at speed; flight itself integrates in simulation.ts.
// The renderer draws ramps from themed ramp/wave markers — no image assets.
import type { RacingJumps } from '@sparkade/shared';
import type { CompiledTrack } from './track';

export type { RacingJumps };

/** One compiled jump-ramp zone (all distances in track units). */
export interface JumpRamp {
  /** Zone start, wrapped into [0, trackLength). The lip sits at s+length. */
  s: number;
  /** Zone length along the centerline (lip at s+length). */
  length: number;
  /** Lateral center of the ramp lane (0 = road center). */
  x: number;
  /** Lateral half-width of the launch lane around x. */
  halfWidth: number;
}

/** Takeoff lip: forward speed at or above this launches (units/s). */
export const JUMP_TAKEOFF_MIN_SPEED = 25;
/** Downward acceleration while airborne (units/s^2). */
export const JUMP_GRAVITY = 14;
/** Launch impulse bounds (units/s): speed-mapped within [min, max]. */
export const JUMP_IMPULSE_MIN = 5;
export const JUMP_IMPULSE_MAX = 8;
/** Height above ground that counts as clearly airborne (surface/contact gates). */
export const JUMP_AIRBORNE_HEIGHT = 0.5;
/** Grounded air-steering authority scale (≈40% reduction while airborne). */
export const JUMP_AIR_STEER_SCALE = 0.6;
/** Retrigger blackout after takeoff/landing (seconds, dt-integrated). */
export const JUMP_COOLDOWN = 1.0;
/** Landing-cue visibility window for the renderer (seconds, dt-integrated). */
export const JUMP_LANDING_CUE = 0.45;

/** Ramp zone length along the centerline (track units). */
export const JUMP_RAMP_LENGTH = 30;
/**
 * Launch-lane half-width: 2.4 units = 60% of the 4.0 road half-width, so the
 * centered lane covers ~60% of the road width and leaves an avoidance line
 * on each side. Mirrors the pad-lane convention (same overlap test shape).
 */
export const JUMP_RAMP_HALF_WIDTH = 2.4;
/** Lateral center of every ramp lane (road center). */
export const JUMP_RAMP_X = 0;

/** Lap fractions the bounded search centers on (two independent zones). */
export const JUMP_FRACTIONS = [0.18, 0.62] as const;
/** Keep-out distance around the start/finish line and checkpoint gates. */
export const JUMP_KEEPOUT = 120;
/** Max |curvature| tolerated over a ramp zone plus its approach margin. */
export const JUMP_CURVE_MAX = 0.0035;
/** Search half-window around each fraction center (track units). */
export const JUMP_SEARCH_HALF = 260;

/**
 * Validate an authored jumps option. Omission (or explicit 'none') resolves
 * to undefined — the caller compiles the exact legacy circuit with no ramps.
 * Any other value throws rather than racing the wrong layout.
 */
export function resolveJumps(value: unknown): 'ramps' | undefined {
  if (value === undefined || value === 'none') return undefined;
  if (value === 'ramps') return value;
  throw new Error(`unknown racing jumps "${String(value)}" (expected none | ramps)`);
}

/**
 * Bounded speed-dependent launch impulse: 5 units/s at the takeoff floor,
 * easing to 8 units/s at open-road pace. Pure, total, and allocation-free.
 */
export function jumpImpulseFor(speed: number): number {
  const t = Math.min(
    1,
    Math.max(0, (speed - JUMP_TAKEOFF_MIN_SPEED) / (80 - JUMP_TAKEOFF_MIN_SPEED)),
  );
  return JUMP_IMPULSE_MIN + (JUMP_IMPULSE_MAX - JUMP_IMPULSE_MIN) * t;
}

/** Wrapped takeoff-lip position for one ramp on a lap of trackLength. */
export function jumpLipS(ramp: JumpRamp, trackLength: number): number {
  const m = (ramp.s + ramp.length) % trackLength;
  return m < 0 ? m + trackLength : m;
}

/** True when the wrapped distance w lies inside the ramp's painted zone. */
export function jumpZoneContains(ramp: JumpRamp, w: number, trackLength: number): boolean {
  let d = w - ramp.s;
  if (d < 0) d += trackLength;
  return d >= 0 && d <= ramp.length;
}

/**
 * Deterministic record-key layout for one ramp set (rounded integers, stable
 * across sessions for the same compiled circuit).
 */
export function jumpLayoutKey(ramps: readonly JumpRamp[]): string {
  return ramps
    .map((r) => `${Math.round(r.s)}+${Math.round(r.length)}@${r.x}x${r.halfWidth}`)
    .join(',');
}

interface JumpSearchTrack {
  readonly length: number;
  wrap(s: number): number;
  curvatureAt(s: number): number;
}

function wrappedDist(a: number, b: number, length: number): number {
  let d = Math.abs(a - b) % length;
  if (d > length / 2) d = length - d;
  return d;
}

/** Gate positions (start/finish plus checkpoints) for keep-out checks. */
function gatePositions(length: number): number[] {
  return [0, 0.25 * length, 0.5 * length, 0.75 * length];
}

function zoneClear(track: JumpSearchTrack, s: number, gates: number[]): boolean {
  if (s <= 0 || s + JUMP_RAMP_LENGTH >= track.length) return false;
  for (const g of gates) {
    if (wrappedDist(s, g, track.length) < JUMP_KEEPOUT) return false;
    if (wrappedDist(s + JUMP_RAMP_LENGTH, g, track.length) < JUMP_KEEPOUT) return false;
  }
  const margin = 60;
  for (let k = s - margin; k <= s + JUMP_RAMP_LENGTH + margin; k += 5) {
    if (Math.abs(track.curvatureAt(k)) > JUMP_CURVE_MAX) return false;
  }
  return true;
}

/**
 * Compile the bounded ramp layout for a track: one candidate per fraction in
 * JUMP_FRACTIONS, each settled by a bounded deterministic scan (whole lap,
 * 5-unit steps, closest safe position wins — no runtime randomness). A
 * fraction with no safe position is skipped. Never force a ramp into a
 * checkpoint or severe corner just to satisfy an authored request.
 */
export function rampsFor(track: CompiledTrack): JumpRamp[] {
  const gates = gatePositions(track.length);
  const out: JumpRamp[] = [];
  for (const f of JUMP_FRACTIONS) {
    const center = f * track.length;
    let placed: number | null = null;
    let closest = Infinity;
    // Scan the whole bounded lap: a preferred fraction can sit entirely in
    // bends, even though a safe straight exists elsewhere on the course.
    for (let s = 5; s < track.length; s += 5) {
      if (out.some((r) => wrappedDist(s, r.s, track.length) < JUMP_KEEPOUT * 2)) continue;
      const distance = wrappedDist(s, center, track.length);
      if (distance >= closest || !zoneClear(track, s, gates)) continue;
      closest = distance;
      placed = s;
    }
    if (placed !== null)
      out.push({
        s: placed,
        length: JUMP_RAMP_LENGTH,
        x: JUMP_RAMP_X,
        halfWidth: JUMP_RAMP_HALF_WIDTH,
      });
  }
  return out;
}
