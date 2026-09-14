// Racing movement profiles: bounded runtime physics per discipline.
//
// This module owns ONLY simulation numbers (longitudinal pace, steering
// response, lateral inertia, surface resistance). Movement presentation —
// craft/track artwork, audio, exhaust — lives in art.ts / audio.ts and never
// in a profile here. Omission of a discipline selects hover with byte-for-byte
// legacy behavior: HOVER_MOVEMENT repeats the long-standing hover tuning
// unchanged (no retune), and the simulation keeps the exact legacy arithmetic
// on that path.
//
// Jet-ski differences (same boost reserve/modes, same lap gates, same contact
// and AI rules — those stay in simulation.ts):
// - lateral momentum: steering chases a target lateral velocity instead of
//   sliding the hull directly, so inputs settle with drag rather than stop
//   dead. No auto-steer: only lateral *velocity* decays, the line never
//   recenters itself.
// - smooth shallow-boundary resistance: the off-throttle water drag plus a
//   smoothstep-eased shallow band instead of the asphalt ramp, with a
//   relatively kinder deep cap and stronger shallow acceleration.
// - lower top pace with heavier longitudinal drag and extra off-throttle
//   coasting decay, so throttle control matters more than top speed.
import type { RacingDiscipline } from '@sparkade/shared';

/** Bounded runtime movement settings for one discipline. */
export interface MovementProfile {
  /** Which discipline this profile drives. */
  readonly discipline: RacingDiscipline;
  /** Open-water/road top speed (times the per-racer topScale). */
  readonly topSpeed: number;
  /** Top speed while a manual burn is active. */
  readonly boostTopSpeed: number;
  /** Deep-boundary pace cap (reached only at full penetration). */
  readonly shallowCap: number;
  /** Deep-boundary pace cap while boosting. */
  readonly shallowBoostCap: number;
  /** Longitudinal acceleration. */
  readonly accel: number;
  /** Longitudinal acceleration while a manual burn is active. */
  readonly boostAccel: number;
  /** Braking deceleration at pace. */
  readonly brakeDecel: number;
  /** Reversing deceleration from standstill. */
  readonly reverseDecel: number;
  /** Fastest reverse speed. */
  readonly maxReverse: number;
  /** Longitudinal drag (always active). */
  readonly drag: number;
  /** Extra off-throttle coasting decay (0 = legacy hover: none). */
  readonly coastDrag: number;
  /** Steering ramp rates (per second): attack, release, countersteer. */
  readonly steerAttack: number;
  readonly steerRelease: number;
  readonly steerCounter: number;
  /** Off-throttle/shallow acceleration scale past the curb band. */
  readonly shallowAccelScale: number;
  /** Offroad steering floor: a slowed craft can still steer home. */
  readonly authFloor: number;
  /**
   * Lateral chase rate toward the steered target velocity (per second).
   * 0 = legacy direct slide (hover): the smoothed input moves the hull
   * immediately with no momentum. Positive values add hull inertia whose
   * only decay is this chase (no position recentering, no auto-steer).
   */
  readonly lateralResponse: number;
  /**
   * Snap threshold: when no lateral target is steered and |latV| falls below
   * this, it zeroes exactly, so a stopped craft with released input rests
   * bit-stable instead of drifting on float residue.
   */
  readonly lateralSnap: number;
  /** True when the boundary penalty eases in with smoothstep (jet-ski). */
  readonly easedBoundary: boolean;
}

/** Legacy hover tuning, unchanged: the hover path stays behavior-equivalent. */
export const HOVER_MOVEMENT: MovementProfile = {
  discipline: 'hover',
  topSpeed: 80,
  boostTopSpeed: 128,
  shallowCap: 52,
  shallowBoostCap: 85,
  accel: 36,
  boostAccel: 66,
  brakeDecel: 70,
  reverseDecel: 18,
  maxReverse: -12,
  drag: 0.28,
  coastDrag: 0,
  steerAttack: 6.5,
  steerRelease: 8,
  steerCounter: 13,
  shallowAccelScale: 0.75,
  authFloor: 26,
  lateralResponse: 0,
  lateralSnap: 0,
  easedBoundary: false,
};

/** Jet-ski tuning: weightier, draggier, with hull momentum and a smooth edge. */
export const JETSKI_MOVEMENT: MovementProfile = {
  discipline: 'jetski',
  topSpeed: 76,
  boostTopSpeed: 120,
  shallowCap: 58,
  shallowBoostCap: 92,
  accel: 32,
  boostAccel: 60,
  brakeDecel: 60,
  reverseDecel: 18,
  maxReverse: -12,
  drag: 0.3,
  coastDrag: 0.45,
  steerAttack: 5.5,
  steerRelease: 7,
  steerCounter: 12,
  shallowAccelScale: 0.85,
  authFloor: 26,
  lateralResponse: 5,
  lateralSnap: 0.05,
  easedBoundary: true,
};

/** Resolve any authoring value to a profile. Omission (or hover) is legacy. */
export function movementFor(discipline?: RacingDiscipline): MovementProfile {
  if (discipline === undefined || discipline === 'hover') return HOVER_MOVEMENT;
  if (discipline === 'jetski') return JETSKI_MOVEMENT;
  throw new Error(`unknown racing discipline "${discipline}" (expected "hover" | "jetski")`);
}

/** Normalize an authoring value: omitted → hover, anything else validated. */
export function resolveDiscipline(value: unknown): RacingDiscipline {
  if (value === undefined) return 'hover';
  if (value === 'hover' || value === 'jetski') return value;
  throw new Error(`unknown racing discipline "${String(value)}" (expected "hover" | "jetski")`);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Boundary-eased pace cap: full pace through the curb band, easing to the
 * deep cap at the barrier. The hover path keeps the exact legacy linear ramp;
 * the jet-ski path smoothsteps the same span so shallow brushes cost less.
 */
export function boundaryCapTop(
  profile: MovementProfile,
  openTop: number,
  boosting: boolean,
  depth: number,
  roadHalf: number,
  curbWidth: number,
  barrierX: number,
): number {
  const deepCap = boosting ? profile.shallowBoostCap : profile.shallowCap;
  const span = Math.max(1e-6, barrierX - roadHalf - curbWidth);
  const f = clamp01((depth - curbWidth) / span);
  const eased = profile.easedBoundary ? f * f * (3 - 2 * f) : f;
  return Math.min(openTop, openTop + (deepCap - openTop) * eased);
}
