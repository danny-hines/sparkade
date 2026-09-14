// Bounded fork splits for racing circuits: one optional coplanar two-corridor
// fork per lap. When a circuit compiles with forks 'split', a single quiet
// interval becomes two lanes around a genuine physical island: a broad safe
// LEFT lane and a narrower rewarded RIGHT lane. Omission (or 'none') compiles
// zero fork state and the circuit object keeps its exact legacy shape (the
// `fork` key stays absent).
//
// Both lanes share the same centerline s (no per-route distances, no
// shortcut): curvature, elevation, lap gates, and positions all read the one
// compiled centerline. The island blocks crossing once committed (see
// simulation.ts); the renderer paints the same shape through
// forkCrossSection below — no image assets.
import type { RacingForks } from '@sparkade/shared';
import type { CompiledTrack, EnergyPickup } from './track';
import type { BoostPad } from './track';

export type { RacingForks };

/** One compiled fork zone (all distances in track units, never wrapping). */
export interface ForkLayout {
  /** Zone start, wrapped into [0, trackLength). Blend begins here. */
  start: number;
  /** Full zone length: entrance + full split + exit. */
  length: number;
}

/**
 * Allocation-free cross-section of the fork at one wrapped distance. The
 * renderer paints this exact shape; the simulation clamps to it. Outside the
 * zone blend is 0 and every bound converges to the legacy single road, so
 * the same query drives the smooth entrance/exit converge.
 */
export interface ForkSection {
  /** 0 = legacy single road, 1 = full two-corridor split. */
  blend: number;
  /** Outer asphalt edges (legacy -ROAD_HALF/+ROAD_HALF at blend 0). */
  roadLo: number;
  roadHi: number;
  /** Island bounds around the centerline (degenerate at blend 0). */
  islandLo: number;
  islandHi: number;
  /** True once the island has real width (physics blocks crossing). */
  islandActive: boolean;
  /** Left (safe, broad) lane bounds. */
  leftLo: number;
  leftHi: number;
  /** Right (narrow, rewarded) lane bounds. */
  rightLo: number;
  rightHi: number;
  /** Lane centers (both 0 at blend 0: natural exit converge). */
  leftCenter: number;
  rightCenter: number;
}

/** Full zone length along the centerline (track units). */
export const FORK_ZONE = 270;
/** Smooth entrance length (island grows from zero: no entry teleport). */
export const FORK_ENTER = 80;
/** Smooth exit length (lanes reconverge to the single road). */
export const FORK_EXIT = 80;
/** Full-split outer edges (world units): broad left, narrower right. */
export const FORK_OUTER_L = -8;
export const FORK_OUTER_R = 6;
/** Full-split island half-width (world units): the island is 2 wide. */
export const FORK_ISLAND_HALF = 1;
/** Lane centers at full split: left [-8,-1] -> -4.5, right [1,6] -> 3.5. */
export const FORK_LEFT_CENTER = -4.5;
export const FORK_RIGHT_CENTER = 3.5;
/** Preferred zone-center lap fraction (clear of jumps 0.18/0.62). */
export const FORK_FRACTION = 0.4;
/** Keep-out around the start/finish line and checkpoint gates. */
export const FORK_KEEPOUT = 120;
/** Keep-out around compiled ramp zones (approach + landing margin). */
export const FORK_RAMP_KEEPOUT = 150;
/** Max |curvature| tolerated over the zone plus its approach margin. */
export const FORK_CURVE_MAX = 0.0015;
/** Curvature approach margin past each zone end (track units). */
export const FORK_CURVE_MARGIN = 40;
/** Shoulder past the outer asphalt edge inside the fork (world units). */
export const FORK_SHOULDER = 2.2;

/**
 * Validate an authored forks option. Omission (or explicit 'none') resolves
 * to undefined — the caller compiles the exact legacy circuit with no fork.
 * Any other value throws rather than racing the wrong layout.
 */
export function resolveForks(value: unknown): 'split' | undefined {
  if (value === undefined || value === 'none') return undefined;
  if (value === 'split') return value;
  throw new Error(`unknown racing forks "${String(value)}" (expected none | split)`);
}

/** Stable branch side by racer index: even racers left, odd racers right. */
export function forkBranchSide(index: number): -1 | 1 {
  return index % 2 === 0 ? -1 : 1;
}

function smooth(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
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

interface ForkSearchTrack {
  readonly length: number;
  wrap(s: number): number;
  curvatureAt(s: number): number;
}

function zoneClear(
  track: ForkSearchTrack,
  s: number,
  gates: number[],
  ramps: readonly { s: number; length: number }[],
  pads: readonly BoostPad[],
): boolean {
  if (s <= 0 || s + FORK_ZONE >= track.length) return false;
  for (const g of gates) {
    if (g >= s && g <= s + FORK_ZONE) return false;
    if (wrappedDist(s, g, track.length) < FORK_KEEPOUT) return false;
    if (wrappedDist(s + FORK_ZONE, g, track.length) < FORK_KEEPOUT) return false;
  }
  for (const pad of pads) {
    if (pad.start < s + FORK_ZONE && pad.start + pad.length > s) return false;
  }
  for (const r of ramps) {
    const start = ((r.s % track.length) + track.length) % track.length;
    // Include the wrapped tail and a complete high-speed flight margin.
    for (const shift of [-track.length, 0, track.length]) {
      const lo = start + shift - FORK_RAMP_KEEPOUT;
      const hi = start + shift + r.length + FORK_RAMP_KEEPOUT;
      if (lo < s + FORK_ZONE && hi > s) return false;
    }
  }
  for (let k = s - FORK_CURVE_MARGIN; k <= s + FORK_ZONE + FORK_CURVE_MARGIN; k += 5) {
    if (Math.abs(track.curvatureAt(k)) > FORK_CURVE_MAX) return false;
  }
  return true;
}

/**
 * Compile the bounded fork layout for a track: at most ONE zone, settled by
 * a bounded deterministic scan (whole lap, 5-unit steps, the safe position
 * closest to FORK_FRACTION wins — no runtime randomness). Returns undefined
 * when no safe interval exists: the caller omits the fork rather than
 * falling back to an unsafe placement.
 */
export function forkFor(
  track: CompiledTrack,
  ramps?: readonly { s: number; length: number }[],
  retainedPads: readonly BoostPad[] = [],
): ForkLayout | undefined {
  const gates = gatePositions(track.length);
  const rampList = ramps ?? [];
  const center = FORK_FRACTION * track.length;
  let placed: number | null = null;
  let closest = Infinity;
  for (let s = 5; s < track.length; s += 5) {
    const distance = wrappedDist(s + FORK_ZONE / 2, center, track.length);
    if (distance >= closest || !zoneClear(track, s, gates, rampList, retainedPads)) continue;
    closest = distance;
    placed = s;
  }
  if (placed === null) return undefined;
  return { start: placed, length: FORK_ZONE };
}

/** Full-split middle (reward/supply anchor): start + entrance + split/2. */
export function forkCenterS(layout: ForkLayout): number {
  return layout.start + FORK_ENTER + (layout.length - FORK_ENTER - FORK_EXIT) / 2;
}

/** Deterministic record-key layout for one fork zone (rounded integers). */
export function forkLayoutKey(layout: ForkLayout): string {
  return `split1:${Math.round(layout.start)}+${Math.round(layout.length)}`;
}

function newSection(): ForkSection {
  return {
    blend: 0,
    roadLo: -4,
    roadHi: 4,
    islandLo: 0,
    islandHi: 0,
    islandActive: false,
    leftLo: -4,
    leftHi: 4,
    rightLo: -4,
    rightHi: 4,
    leftCenter: 0,
    rightCenter: 0,
  };
}

/**
 * Pure cross-section query at wrapped distance w. Writes into `out` when
 * provided (per-frame, allocation-free); allocates otherwise. The legacy
 * road half-width is passed by the caller (track ROAD_HALF) so this module
 * never hard-codes the single-road shape it blends from.
 */
export function forkCrossSection(
  layout: ForkLayout,
  w: number,
  roadHalf: number,
  out?: ForkSection,
): ForkSection {
  const sec = out ?? newSection();
  const d = w - layout.start;
  if (d < 0 || d > layout.length) {
    sec.blend = 0;
    sec.roadLo = -roadHalf;
    sec.roadHi = roadHalf;
    sec.islandLo = 0;
    sec.islandHi = 0;
    sec.islandActive = false;
    sec.leftLo = -roadHalf;
    sec.leftHi = roadHalf;
    sec.rightLo = -roadHalf;
    sec.rightHi = roadHalf;
    sec.leftCenter = 0;
    sec.rightCenter = 0;
    return sec;
  }
  const enter = smooth(d / FORK_ENTER);
  const exit = smooth((layout.length - d) / FORK_EXIT);
  const b = Math.min(enter, exit);
  sec.blend = b;
  sec.roadLo = -roadHalf + (FORK_OUTER_L + roadHalf) * b;
  sec.roadHi = roadHalf + (FORK_OUTER_R - roadHalf) * b;
  const half = FORK_ISLAND_HALF * b;
  sec.islandLo = -half;
  sec.islandHi = half;
  sec.islandActive = half > 0.05;
  sec.leftLo = sec.roadLo;
  sec.leftHi = sec.islandLo;
  sec.rightLo = sec.islandHi;
  sec.rightHi = sec.roadHi;
  sec.leftCenter = FORK_LEFT_CENTER * b;
  sec.rightCenter = FORK_RIGHT_CENTER * b;
  return sec;
}

/**
 * Clamp a lateral position to the fork cross-section, keeping the racer on
 * its committed side of the island. side is -1 (left), +1 (right), or 0
 * (uncommitted: nearest edge wins). Pure: the same rule serves live physics
 * and contact pushes. Outside the zone (or a degenerate island) the input
 * passes through untouched.
 */
export function clampForkX(
  layout: ForkLayout,
  w: number,
  roadHalf: number,
  x: number,
  side: number,
): number {
  const d = w - layout.start;
  if (d < 0 || d > layout.length) return x;
  const b = Math.min(smooth(d / FORK_ENTER), smooth((layout.length - d) / FORK_EXIT));
  const half = FORK_ISLAND_HALF * b;
  if (half <= 0.05) return x;
  if (x < -half || x > half) {
    // Outside the island: hold the established side, never flip across.
    const s = side !== 0 ? Math.sign(side) : x < 0 ? -1 : 1;
    if (s < 0) return Math.min(x, -half);
    return Math.max(x, half);
  }
  // Inside the island (entered while it grew, or shoved in): leave by the
  // committed side, or the nearer edge when uncommitted. Travel is at most
  // the island half-width, never a teleport.
  if (side !== 0) return side < 0 ? -half : half;
  return x < 0 ? -half : half;
}

/**
 * Relocate existing supplies into the narrow (right) branch: the first boost
 * pad keeps its length but moves to the fork middle with a branch-relative
 * lane (pad.x is backwards-compatible: omitted means road center), and the
 * energy pickup nearest the fork middle moves to the branch center. Only
 * relocates — never adds a pad or cell, never mixes modes. Inert when there
 * is nothing to move (empty pads/pickups stay empty: 'none' gains no boost).
 */
export function applyForkSupplies(
  pads: BoostPad[],
  pickups: EnergyPickup[],
  layout: ForkLayout,
  trackLength: number,
): void {
  const mid = forkCenterS(layout);
  if (pads.length > 0) {
    const pad = pads[0]!;
    pad.start = mid - pad.length / 2;
    if (pad.start < 0) pad.start = 0;
    if (pad.start + pad.length >= trackLength) pad.start = trackLength - pad.length - 1;
    pad.x = FORK_RIGHT_CENTER;
  }
  if (pickups.length > 0) {
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < pickups.length; k++) {
      const d = wrappedDist(pickups[k]!.s, mid, trackLength);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    pickups[best]!.s = mid;
    pickups[best]!.x = FORK_RIGHT_CENTER;
  }
}

/** Same painted and triggered pad interval, including a fork's inner/outer edges. */
export function forkPadLane(section: ForkSection, center: number, halfWidth: number, out: { lo: number; hi: number }): void {
  out.lo = center - halfWidth;
  out.hi = center + halfWidth;
  if (section.blend <= 0) return;
  out.lo = Math.max(out.lo, center >= 0 ? section.rightLo : section.leftLo);
  out.hi = Math.min(out.hi, center >= 0 ? section.rightHi : section.leftHi);
}
