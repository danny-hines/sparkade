// Composable traversal audio math for the racing archetype.
//
// Pure data and math only: no WebAudio nodes are created here, so this
// module is deterministic and unit-testable without an AudioContext.
// It voices the presentation-only propulsion/rider axes plus the surface
// axis for water integration. Label, handling, and sport identity are
// never consulted — there is no sport-name branching.
//
// Legacy rule: an absent traversal (undefined/null) keeps the exact
// pre-traversal hover/jetski mix; every helper below is only consulted
// when a traversal is present.
import type { RacingDiscipline, RacingTraversal } from '@sparkade/shared';
import { JETSKI_WATER_GAIN_CAP } from './sound-profile';

export type TraversalPropulsion = 'motor' | 'human' | 'magic';
export type TraversalSurface = 'ground' | 'water';
export type TraversalRider = 'none' | 'seated' | 'standing' | 'onFoot';

/** Speed norm at or below which human/magic movement stays fully silent. */
export const TRAVERSAL_REST_NORM = 0.02;

/** Hard ceiling on human movement noise: quiet rolling/footfall, never a motor. */
export const HUMAN_GAIN_CAP = 0.22;
/** Hard ceiling on the magic tonal voice: restrained, never a loud idle buzz. */
export const MAGIC_TONE_CAP = 0.12;
/** Hard ceiling on the magic wind swell. */
export const MAGIC_WIND_CAP = 0.3;

const PROPULSIONS: readonly string[] = ['motor', 'human', 'magic'];
const SURFACES: readonly string[] = ['ground', 'water'];
const RIDERS: readonly string[] = ['none', 'seated', 'standing', 'onFoot'];

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** Lenient propulsion for audio: invalid values fall back to motor, never throw. */
export function traversalPropulsion(traversal?: RacingTraversal | null): TraversalPropulsion {
  const p = (traversal as { propulsion?: unknown } | null | undefined)?.propulsion;
  return p === 'human' || p === 'magic' || p === 'motor'
    ? (p as TraversalPropulsion)
    : 'motor';
}

/** Lenient rider for audio: invalid values fall back to seated, never throw. */
export function traversalRider(traversal?: RacingTraversal | null): TraversalRider {
  const r = (traversal as { rider?: unknown } | null | undefined)?.rider;
  return r === 'none' || r === 'seated' || r === 'standing' || r === 'onFoot'
    ? (r as TraversalRider)
    : 'seated';
}

/**
 * Effective audio surface. A present traversal drives the surface engine
 * (ground → hover mix, water → jetski mix, mirroring movementForTraversal);
 * an absent traversal keeps the discipline mix exactly.
 */
export function traversalSurface(
  traversal?: RacingTraversal | null,
  discipline?: RacingDiscipline | null,
): TraversalSurface {
  const s = (traversal as { surface?: unknown } | null | undefined)?.surface;
  if (s === 'ground' || s === 'water') return s;
  if (traversal === undefined || traversal === null) {
    return discipline === 'jetski' ? 'water' : 'ground';
  }
  return 'ground';
}

/** True when no traversal was supplied (exact legacy hover/jetski path). */
export function isLegacyTraversal(traversal?: RacingTraversal | null): boolean {
  return traversal === undefined || traversal === null;
}

/** Effective watercraft flag for a motor voice with traversal. */
export function traversalOnWater(
  traversal?: RacingTraversal | null,
  discipline?: RacingDiscipline | null,
): boolean {
  return traversalSurface(traversal, discipline) === 'water';
}

function riderDrive(rider: TraversalRider): number {
  // Bounded per-rider exertion color; onFoot steps read slightly louder,
  // none (vehicle with no visible rider) stays softest. Small multipliers
  // only — never a mode switch.
  switch (rider) {
    case 'onFoot':
      return 1.15;
    case 'standing':
      return 1.05;
    case 'seated':
      return 1;
    case 'none':
      return 0.9;
  }
}

/**
 * Human movement-noise gain from live craft state: silent at rest, swelling
 * with speed, exertion rise under throttle/accel, extra push under boost.
 * Filtered rolling/footfall texture — never an engine hum or burner.
 */
export function humanDriveGain(
  speedNorm: number,
  throttle: boolean,
  boosting: boolean,
  rider: TraversalRider = 'seated',
): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  if (!boosting && norm <= TRAVERSAL_REST_NORM) return 0;
  const cruise = norm * 0.13 * riderDrive(rider);
  const exertion = throttle && norm > TRAVERSAL_REST_NORM ? 0.045 * riderDrive(rider) : 0;
  const push = boosting ? 0.06 : 0;
  return Math.min(HUMAN_GAIN_CAP, cruise + exertion + push);
}

/** Human movement-noise filter cutoff: dark roll, brightening with speed/boost. */
export function humanDriveCutoff(
  speedNorm: number,
  boosting: boolean,
  rider: TraversalRider = 'seated',
): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  const riderBright = rider === 'onFoot' ? 150 : rider === 'none' ? -60 : 0;
  return 380 + norm * 1150 + (boosting ? 420 : 0) + riderBright;
}

/** Step/roll cadence in Hz from speed: faster craft cycle faster. */
export function humanCadenceHz(speedNorm: number, rider: TraversalRider = 'seated'): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  const base = rider === 'onFoot' ? 2.6 : 1.8;
  return base + norm * (rider === 'onFoot' ? 7 : 5.5);
}

/**
 * Cadence multiplier from monotonic audio time: ±20% roll/footfall swell
 * with no per-step allocation (caller passes ctx.currentTime).
 */
export function applyCadence(baseGain: number, time: number, cadenceHz: number): number {
  if (!(baseGain > 0) || !Number.isFinite(time) || !(cadenceHz > 0)) return baseGain;
  const phase = (time * cadenceHz) % 1;
  return baseGain * (0.8 + 0.2 * Math.sin(phase * Math.PI * 2));
}

/**
 * Standalone water wash for human/magic craft on surface water: silent at
 * rest, swelling with speed, extra wash while carving, surging under boost.
 * Same cap as the jetski rush so the pair never clips the motor/music bus.
 */
export function traversalWaterGain(
  speedNorm: number,
  carving: boolean,
  boosting: boolean,
): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  if (!boosting && norm <= TRAVERSAL_REST_NORM) return 0;
  const cruise = norm * 0.24;
  const wake = carving && norm > 0.05 ? 0.06 : 0;
  const thrust = boosting ? 0.32 : 0;
  return Math.min(JETSKI_WATER_GAIN_CAP, cruise + wake + thrust);
}

/** Water-wash filter cutoff for human/magic craft. */
export function traversalWaterCutoff(speedNorm: number, boosting: boolean): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  return 1250 + norm * 750 + (boosting ? 550 : 0);
}

/**
 * Magic tonal-voice gain: restrained soft swell, silent at rest, never a
 * loud idle buzz. Always well under motor peaks.
 */
export function magicToneGain(speedNorm: number, boosting: boolean): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  if (!boosting && norm <= TRAVERSAL_REST_NORM) return 0;
  return Math.min(MAGIC_TONE_CAP, 0.018 + norm * 0.062 + (boosting ? 0.03 : 0));
}

/** Magic tonal pitch: soft low shimmer rising gently with speed (never a bell). */
export function magicToneHz(speedNorm: number, boosting: boolean): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  return (108 + norm * 96) * (boosting ? 0.94 : 1);
}

/** Magic wind-swell gain: soft rushing air under motion, whoosh under boost. */
export function magicWindGain(
  speedNorm: number,
  boosting: boolean,
  onWater: boolean,
): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  if (!boosting && norm <= TRAVERSAL_REST_NORM) return 0;
  const air = norm * 0.14 + (boosting ? 0.16 : 0);
  const wet = onWater ? traversalWaterGain(norm, false, boosting) * 0.5 : 0;
  return Math.min(MAGIC_WIND_CAP, air + wet);
}

/** Magic wind filter cutoff. */
export function magicWindCutoff(speedNorm: number, boosting: boolean): number {
  const norm = clamp(speedNorm, 0, 1, 0);
  return 700 + norm * 900 + (boosting ? 700 : 0);
}

/**
 * Nearby human-rival gain: quiet rolling/footfall proportional to distance
 * envelope and rival motion, stereo-panned by the caller. Zero at rest —
 * human rivals never idle engines.
 */
export function rivalHumanGain(envelope: number, motion: number, onWater: boolean): number {
  if (!(envelope > 0) || !(motion > 0)) return 0;
  const roll = envelope * motion * 0.085;
  const wet = onWater ? envelope * motion * 0.03 : 0;
  return Math.min(HUMAN_GAIN_CAP, roll + wet);
}

/**
 * Nearby magic-rival gain: restrained shimmer proportional to distance and
 * motion. Zero at rest — no idle buzz.
 */
export function rivalMagicGain(envelope: number, motion: number, onWater: boolean): number {
  if (!(envelope > 0) || !(motion > 0)) return 0;
  const shimmer = envelope * motion * 0.06;
  const wet = onWater ? envelope * motion * 0.025 : 0;
  return Math.min(MAGIC_TONE_CAP, shimmer + wet);
}

export const __traversalTables = { PROPULSIONS, SURFACES, RIDERS };
