// Bounded elevation profiles for racing circuits: optional periodic height
// over lap progress. Profiles are cheap analytic sine series in the lap
// fraction u = s / length with integer harmonics only, so value AND slope
// are smooth at the wrap by construction, heightAt(0) is exactly 0 (no
// start-line step), and the shape is independent of mirroring (a function
// of s only — horizontal geometry mirrors, height does not).
//
// Hand-authored constants only; no model-authored control points. Grade
// stays well under ~0.12 and amplitude under 20 track units across the
// whole rescale band (2800-3600). Queries are pure arithmetic on scalars —
// no allocations per call. Track flight is not included: these profiles
// feed the renderer's ground height plus a modest grade pull in physics.
import type { RacingElevation } from '@sparkade/shared';

export type { RacingElevation };
export type ElevatedKind = 'rolling' | 'ridge';

/** Compiled elevation metadata attached to a non-flat track. */
export interface ElevationProfile {
  readonly kind: ElevatedKind;
  /** Max |height| in track units (hand-authored bound, <= 20). */
  readonly amplitude: number;
  /** Max |grade| bound over the rescale band (<= 0.12). */
  readonly maxGrade: number;
}

// Rolling: readable paired rises over the full lap (fundamental plus one
// octave for character). Amplitude <= 17; |dh/du| <= (12+10)*2*pi, so grade
// <= ~0.05 at the shortest lap.
const ROLLING_A1 = 12;
const ROLLING_A2 = 5;

// Ridge: one dominant climb per lap with a mild third-harmonic shoulder.
// Amplitude <= 18; |dh/du| <= (15+9)*2*pi, so grade <= ~0.054 at the
// shortest lap.
const RIDGE_B1 = 15;
const RIDGE_B2 = 3;

const TAU = Math.PI * 2;

export const ROLLING_PROFILE: ElevationProfile = { kind: 'rolling', amplitude: 17, maxGrade: 0.06 };
export const RIDGE_PROFILE: ElevationProfile = { kind: 'ridge', amplitude: 18, maxGrade: 0.06 };

/**
 * Validate an authored elevation option. Omission (or explicit 'flat')
 * resolves to undefined — the caller compiles legacy flat geometry. Any
 * other value throws rather than racing the wrong profile.
 */
export function resolveElevation(value: unknown): ElevatedKind | undefined {
  if (value === undefined || value === 'flat') return undefined;
  if (value === 'rolling' || value === 'ridge') return value;
  throw new Error(`unknown racing elevation "${String(value)}" (expected flat | rolling | ridge)`);
}

/** Compiled profile metadata for a validated non-flat kind. */
export function elevationProfileFor(kind: ElevatedKind): ElevationProfile {
  return kind === 'ridge' ? RIDGE_PROFILE : ROLLING_PROFILE;
}

function lapFraction(s: number, length: number): number {
  const m = s % length;
  const w = m < 0 ? m + length : m;
  return w / length;
}

/** Height (track units) at distance s for a non-flat kind. */
export function elevationHeight(kind: ElevatedKind, s: number, length: number): number {
  const a = TAU * lapFraction(s, length);
  if (kind === 'ridge') return RIDGE_B1 * Math.sin(a) + RIDGE_B2 * Math.sin(3 * a);
  return ROLLING_A1 * Math.sin(a) + ROLLING_A2 * Math.sin(2 * a);
}

/** Grade dh/ds (rise per forward unit, signed) at distance s. */
export function elevationGrade(kind: ElevatedKind, s: number, length: number): number {
  const a = TAU * lapFraction(s, length);
  const k = TAU / length;
  if (kind === 'ridge') return k * (RIDGE_B1 * Math.cos(a) + 3 * RIDGE_B2 * Math.cos(3 * a));
  return k * (ROLLING_A1 * Math.cos(a) + 2 * ROLLING_A2 * Math.cos(2 * a));
}

/** Minimal surface a height/grade query needs; legacy tracks omit both. */
export interface Elevatable {
  readonly length: number;
  readonly heightAt?: (s: number) => number;
  readonly gradeAt?: (s: number) => number;
}

/** Ground height at s; exactly 0 for legacy tracks without elevation. */
export function trackHeightAt(track: Elevatable, s: number): number {
  return track.heightAt !== undefined ? track.heightAt(s) : 0;
}

/** Grade at s; exactly 0 for legacy tracks without elevation. */
export function trackGradeAt(track: Elevatable, s: number): number {
  return track.gradeAt !== undefined ? track.gradeAt(s) : 0;
}
