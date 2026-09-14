// Racing simulation: pure deterministic race logic with no DOM dependency.
//
// One player plus AI rivals share this exact step function — same physics,
// same boost resource, same lap/checkpoint gates. AI only differs in the
// input it computes (see aiInputFor); it never teleports.
//
// Lap integrity: each racer carries nextCp (index into CHECKPOINT_FRACTIONS,
// where CHECKPOINT_FRACTIONS.length means "finish gate armed"). Crossing a
// gate forward advances the gate; crossing backward steps it back. A lap only
// counts on a forward finish-line crossing while armed, so reversing over the
// line or sitting on it can never manufacture a lap.

import {
  BARRIER_X,
  CHECKPOINT_FRACTIONS,
  CURB_WIDTH,
  PAD_HALF_X,
  PICKUP_HALF_X,
  RACE_CIRCUITS,
  ROAD_HALF,
  type BoostPad,
  type CompiledTrack,
  type EnergyPickup,
  type RaceCircuit,
} from './track';
import { boundaryCapTop, movementForTraversal } from './movement';
import {
  FORK_SHOULDER,
  clampForkX,
  forkBranchSide,
  forkCrossSection,
  forkPadLane,
  type ForkSection,
} from './forks';
import { trackGradeAt, trackHeightAt } from './elevation';
import {
  JUMP_AIR_STEER_SCALE,
  JUMP_AIRBORNE_HEIGHT,
  JUMP_COOLDOWN,
  JUMP_GRAVITY,
  JUMP_LANDING_CUE,
  JUMP_TAKEOFF_MIN_SPEED,
  jumpImpulseFor,
} from './jumps';

export const RACE_LAPS = 3;
export const RACER_COUNT = 5;
export const PLAYER_INDEX = 0;
/** Cup points per place (1st..5th). Most total points wins the cup. */
export const CUP_POINTS = [9, 6, 4, 2, 1] as const;

/** Per-frame driver intent. steer is -1 (left) .. +1 (right). */
export interface RacerInput {
  steer: number;
  accel: boolean;
  brake: boolean;
  /** Manual boost (cabinet A button). Edge-triggered by the caller. */
  boost: boolean;
  /** Drift/airbrake (cabinet L/R): extra yaw at the cost of drag. */
  drift: boolean;
}

/**
 * Optional airborne state for jump ramps. Present only on ramp circuits
 * (attached by createRaceFor when circuit.ramps is non-empty); absent on
 * every legacy circuit so the racer shape stays exact. height tracks height
 * above the current ground; velocity is vertical speed; cooldown blocks
 * same-pass retrigger; landingT is a brief renderer touchdown cue.
 */
export interface RacerAirState {
  height: number;
  velocity: number;
  cooldown: number;
  landingT: number;
}

/** True while the racer is clearly airborne (above the surface-gate height). */
export function isAirborne(r: RacerState): boolean {
  return r.air !== undefined && r.air.height > JUMP_AIRBORNE_HEIGHT;
}

export interface RacerState {
  /** Unwrapped centerline distance (grows forward, shrinks reversing). */
  s: number;
  /** Lateral offset from centerline. 0 = center, + = right. */
  x: number;
  /**
   * Smoothed steering position (-1..1). Digital taps ramp toward the input
   * instead of applying full lock instantly, so a brief tap nudges the
   * craft while a held press still reaches full lateral authority.
   */
  steerPos: number;
  /**
   * Lateral velocity (world units/s). The hover discipline never reads it
   * (direct slide, legacy behavior); the jet-ski discipline integrates it so
   * steering carries momentum that settles with drag. Never recenters the
   * hull on its own — no auto-steer.
   */
  latV: number;
  /** Forward speed (negative only when reversing from standstill). */
  speed: number;
  /** Boost meter 0..1. */
  boost: number;
  /** Remaining manual-boost burn in seconds. */
  boostT: number;
  /** Regen blackout after a burn ends; no recovery while hot or burning. */
  boostDelay: number;
  /** Lane-aware pad latch: the entry kick fires once, lingering never re-arms. */
  padOn: boolean;
  /** Per-lap energy-cell bitmask (bit pi = pickup pi taken this lap). */
  pickMask: number;
  /** Lap index the pickMask belongs to; stale masks reset on lap bank. */
  pickLap: number;
  /** Lifetime cells collected (drives the pickup sfx cue). */
  pickupsTaken: number;
  /** Completed laps. */
  lap: number;
  /** Next checkpoint gate index; == CHECKPOINT_FRACTIONS.length when armed. */
  nextCp: number;
  /** Current lap start time (race clock). */
  lapStartT: number;
  /** Completed lap times. */
  lapTimes: number[];
  finished: boolean;
  finishT: number;
  /** Per-racer top-speed scale (AI handicap; player is 1). */
  topScale: number;
  offroad: boolean;
  /** Finish order (0-based) once finished. */
  place: number;
  /** Unwrapped s at the last gate change; anchors within-sector progress. */
  gateS: number;
  /** True while the driver holds drift/airbrake at speed (for DEV telemetry). */
  drifting: boolean;
  /**
   * Optional airborne state. Initialized only for ramp circuits; the key is
   * absent (not zeroed) on every legacy racer.
   */
  air?: RacerAirState;
  /**
   * Persistent fork commitment: -1 (left lane), +1 (right lane), 0
   * (uncommitted: outside the split or just entering). Initialized only for
   * fork circuits; the key is absent on every legacy racer. Committed from
   * the previous-x side at zone entry so tunneled input can never flip the
   * lane across the island; reset on zone exit.
   */
  forkSide?: number;
}

export interface RaceState {
  t: number;
  racers: RacerState[];
  countdown: number;
  over: boolean;
  finishOrder: number[];
  /** Per-race compiled circuit: geometry, pads, laps, timeout, AI scales. */
  circuit: RaceCircuit;
  /** True per racer once scored DNF (timeout with laps remaining). */
  dnf: boolean[];
  /** Snapshot of the winner's place assignments; equals finishOrder. */
}

export const PLAYER_TOP_SPEED = 80;
const BOOST_TOP_SPEED = 128;
/** Deep-shoulder pace cap (normal): reached only at full penetration. */
export const OFFROAD_TOP_SPEED = 52;
/** Deep-shoulder pace cap while boosting: reached only at full penetration. */
export const OFFROAD_BOOST_TOP_SPEED = 85;
/** Craft body length (track units) for contact resolution. */
const CRAFT_LENGTH = 6;
const CRAFT_SIDE = 1.7;
// Longitudinal pace, steering ramps, drag, and surface caps now live per
// discipline in movement.ts (HOVER_MOVEMENT repeats the legacy hover tuning
// unchanged). Only the values shared across disciplines stay here.
/** Base scale for the shared speed-dependent steering response. */
export const STEER_GAIN = 0.115;
/**
 * Quadratic outward load coefficient: the bend shove is curve * v * |v| *
 * CURVE_PUSH against speed-shaped steering authority (strongest near
 * corner-entry pace, easing toward full throttle), so cornering load
 * rises materially with pace. Sized so a tight bend (~0.019) at full
 * throttle overwhelms full ordinary lock (pushes wide) while the same
 * bend slowed holds at strong lock.
 */
export const CURVE_PUSH = 0.25;
/** Drift/airbrake: yaw multiplier, longitudinal drag, slide-out grip. */
const DRIFT_YAW = 2.1;
const DRIFT_DRAG = 0.38;
const DRIFT_SLIDE_GRIP = 0.6;
/** Shared braking model for AI corner planning (default; AI passes its own). */
const BRAKE_DECEL = 70;
/**
 * Grade pull: bounded gravity influence from the actual track grade for
 * grounded racers (same rule for player and AI). Uphill (grade > 0) scrubs
 * pace, downhill adds it. Profiles bound |grade| well under 0.12, and the
 * clamp keeps hand-built tracks honest too. Zero on legacy/flat tracks, so
 * the old trajectory arithmetic is untouched when height is omitted.
 */
const GRADE_GRAVITY = 40;
const GRADE_CLAMP = 0.15;
/**
 * One manual burst costs half the meter: a full meter holds roughly two
 * sustainable uses. Recovery is slow (0.04/s refills a burst in 12.5 s) and
 * blacked out for BOOST_REGEN_DELAY after each burn, with no recovery at
 * all while burning — boost is earned driving, not minted.
 */
export const BOOST_COST = 0.5;
const BOOST_DURATION = 1.1;
const BOOST_REGEN = 0.04;
/**
 * One energy cell banks this much manual meter (no immediate burn). Four
 * cells per lap ≈ 2.7 bursts per perfect lap — strategic, never infinite.
 */
export const PICKUP_YIELD = 0.34;
/** Passive trickle scale in pickups mode: cells stay the real supply. */
export const PICKUP_TRICKLE = 0.25;
/** Regen blackout after a burn ends (seconds) before trickle recovery resumes. */
export const BOOST_REGEN_DELAY = 2.5;
/**
 * Pad charge only counts while driving forward above this speed, so parking,
 * crawling, or reversing on a pad can never farm meter.
 */
export const PAD_MIN_SPEED = 15;
const START_BOOST = 0.6;

export const DEFAULT_CIRCUIT_INDEX = 0;

export function makeRacer(topScale: number, startS: number): RacerState {
  return {
    s: startS,
    x: 0,
    steerPos: 0,
    latV: 0,
    speed: 0,
    boost: START_BOOST,
    boostT: 0,
    boostDelay: 0,
    padOn: false,
    pickMask: 0,
    pickLap: -1,
    pickupsTaken: 0,
    lap: 0,
    nextCp: 0,
    lapStartT: 0,
    lapTimes: [],
    finished: false,
    finishT: 0,
    topScale,
    offroad: false,
    place: -1,
    gateS: startS,
    drifting: false,
  };
}

/**
 * Grid start: staggered two-column slots with the player last, so rivals
 * are visible ahead for a real race feel. Every slot pair clears contact
 * size (CRAFT_LENGTH 6 by CRAFT_SIDE 1.7), so the launch is clean with no
 * opening-frame shove; s/gateS stay consistent via makeRacer (no post-hoc
 * rewrites), and countdown/restart rebuild through this same builder.
 */
export function createRaceFor(circuit: RaceCircuit, countdownSec = 1.2): RaceState {
  const racers: RacerState[] = [];
  const player = makeRacer(circuit.aiScales[0] ?? 1, -35);
  player.x = 1.4;
  racers.push(player);
  const slots = [
    { x: -1.4, ds: 0 },
    { x: 1.4, ds: -7 },
    { x: -1.4, ds: -14 },
    { x: 1.4, ds: -21 },
  ];
  for (let k = 0; k < slots.length; k++) {
    const slot = slots[k]!;
    const r = makeRacer(circuit.aiScales[k + 1] ?? 0.84, slot.ds);
    r.x = slot.x;
    racers.push(r);
  }
  // Airborne state exists only on ramp circuits; legacy racers omit the key
  // entirely (exact legacy shape, exact legacy arithmetic downstream).
  if ((circuit.ramps?.length ?? 0) > 0) {
    for (const r of racers) r.air = { height: 0, velocity: 0, cooldown: 0, landingT: 0 };
  }
  // Fork commitment exists only on fork circuits; legacy racers omit the key
  // entirely (exact legacy shape, exact legacy arithmetic downstream).
  if (circuit.fork !== undefined) {
    for (const r of racers) r.forkSide = 0;
  }
  return {
    t: 0,
    racers,
    countdown: countdownSec,
    over: false,
    finishOrder: [],
    circuit,
    dnf: racers.map(() => false),
  };
}

/** Default-circuit race (kept so existing tests/dev callers stay meaningful). */
export function createRace(): RaceState {
  return createRaceFor(RACE_CIRCUITS[DEFAULT_CIRCUIT_INDEX]!);
}

export function restartRace(race: RaceState, countdownSec = 1.2): void {
  const fresh = createRaceFor(race.circuit, countdownSec);
  race.t = fresh.t;
  race.racers = fresh.racers;
  race.countdown = fresh.countdown;
  race.over = fresh.over;
  race.finishOrder = fresh.finishOrder;
  race.dnf = fresh.dnf;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapS(race: RaceState, s: number): number {
  return race.circuit.track.wrap(s);
}

/** Fork lookahead: AI commits to its branch lane before the blend begins. */
const FORK_AI_APPROACH = 120;

/** Reusable fork cross-section scratch (single-threaded stepping). */
function blankForkSection(): ForkSection {
  return {
    blend: 0, roadLo: -4, roadHi: 4, islandLo: 0, islandHi: 0,
    islandActive: false, leftLo: -4, leftHi: 4, rightLo: -4, rightHi: 4,
    leftCenter: 0, rightCenter: 0,
  };
}
const forkStepSec: ForkSection = blankForkSection();
const forkContactSec: ForkSection = blankForkSection();
const forkAiSec: ForkSection = blankForkSection();
const forkPadSpan = { lo: 0, hi: 0 };

/**
 * Shoulder depth past the asphalt, fork-aware: inside the split it reads
 * past the two lane bounds instead of the single legacy road. Outside the
 * split both lanes equal the legacy road, so the legacy arithmetic is exact.
 */
function laneDepthAt(race: RaceState, w: number, x: number): number {
  const fork = race.circuit.fork;
  if (fork === undefined) return Math.max(0, Math.abs(x) - ROAD_HALF);
  forkCrossSection(fork, w, ROAD_HALF, forkStepSec);
  const sec = forkStepSec;
  if (x >= sec.leftLo && x <= sec.leftHi) return 0;
  if (x >= sec.rightLo && x <= sec.rightHi) return 0;
  const dl = x < sec.leftLo ? sec.leftLo - x : x > sec.leftHi ? x - sec.leftHi : 0;
  const dr = x < sec.rightLo ? sec.rightLo - x : x > sec.rightHi ? x - sec.rightHi : 0;
  return Math.min(dl, dr);
}

function padAt(race: RaceState, s: number): BoostPad | null {
  const w = race.circuit.track.wrap(s);
  for (const pad of race.circuit.pads) {
    if (w >= pad.start && w <= pad.start + pad.length) return pad;
  }
  return null;
}

/** Gate positions for this race's circuit (finish gate is last). */
function gatesFor(race: RaceState): number[] {
  const len = race.circuit.track.length;
  return [...CHECKPOINT_FRACTIONS.map((f) => f * len), len];
}

/** Max honest distance past the last gate: one gate sector plus slack. */
function sectorCap(race: RaceState): number {
  return race.circuit.track.length / (CHECKPOINT_FRACTIONS.length + 1) + 50;
}

/** Advance checkpoint gates from prevWrapped -> newWrapped movement. */
function crossGates(r: RacerState, prevW: number, newW: number, forward: boolean, gates: number[]): void {
  if (prevW === newW) return;
  if (forward) {
    // Handle wrap: movement spans (prevW, TRACK_LENGTH) then [0, newW).
    const crossed = (g: number): boolean =>
      prevW <= newW ? g > prevW && g <= newW : g > prevW || g <= newW;
    for (let gi = r.nextCp; gi < gates.length; gi++) {
      if (!crossed(gates[gi]!)) break;
      if (gi < CHECKPOINT_FRACTIONS.length) {
        r.nextCp = gi + 1;
      } else {
        // Armed finish crossing: bank the lap.
        r.lap++;
        r.lapTimes.push(0); // timestamp filled by caller (needs race clock)
        r.nextCp = 0;
      }
    }
  } else {
    const crossedBack = (g: number): boolean =>
      prevW >= newW ? g <= prevW && g > newW : g <= prevW || g > newW;
    for (let gi = r.nextCp - 1; gi >= 0; gi--) {
      if (!crossedBack(gates[gi]!)) break;
      r.nextCp = gi;
    }
    // Reversing back over the finish gate re-locks it (un-banks nothing:
    // laps are only banked on forward crossings, so there is nothing to undo).
  }
}

export function stepRacer(race: RaceState, r: RacerState, input: RacerInput, dt: number): void {
  if (r.finished || race.countdown > 0) {
    r.speed = 0;
    return;
  }
  // Lateral span of this step: the pickup sweep interpolates across it so a
  // fast craft cannot tunnel past a cell lane between frames.
  const stepX0 = r.x;
  // Pre-step airborne flag for grounded-only rules below (takeoff can only
  // happen later this step; legacy racers read false with no extra ops).
  const airborne = isAirborne(r);
  const curve = race.circuit.track.curvatureAt(r.s);
  // Traversal passthrough: absent traversal returns the exact legacy profile.
  const profile = movementForTraversal(race.circuit.discipline, race.circuit.traversal);
  // Shoulder depth past the asphalt; the curb band counts as on-road.
  // On fork circuits depth reads past the two lane bounds (identical to the
  // legacy road outside the split).
  const depth = laneDepthAt(race, wrapS(race, r.s), r.x);
  r.offroad = depth > CURB_WIDTH;

  let top = profile.topSpeed * r.topScale;
  if (r.boostT > 0) top = profile.boostTopSpeed;
  // Depth-ramped surface penalty: full road pace through the curb band,
  // easing to the deep-shoulder cap at the barrier. Continuous in x, so
  // crossing the edge never snaps and shallow brushes keep most pace.
  // (Jet-ski smoothsteps the same span; see movement.ts.)
  // Clearly airborne craft bypass the surface-only pace cap; grounded
  // arithmetic (including the legacy path, where airborne is always false)
  // is untouched.
  if (r.offroad && !airborne) {
    top = boundaryCapTop(profile, top, r.boostT > 0, depth, ROAD_HALF, CURB_WIDTH, BARRIER_X);
  }

  // Edge-triggered by the caller: fires only with a full burst banked, so a
  // held or spammed button with insufficient meter makes no phantom burn.
  if (input.boost && r.boostT <= 0 && r.boost >= BOOST_COST) {
    r.boost -= BOOST_COST;
    r.boostT = BOOST_DURATION;
    r.boostDelay = BOOST_REGEN_DELAY;
  }

  const accelRate = (r.boostT > 0 ? profile.boostAccel : profile.accel) * (r.offroad && !airborne ? profile.shallowAccelScale : 1);
  if (input.accel) r.speed += accelRate * dt;
  if (input.brake) r.speed -= (r.speed > 1 ? profile.brakeDecel : profile.reverseDecel) * dt;
  r.speed -= r.speed * profile.drag * dt;
  // Jet-ski water drag: off-throttle pace bleeds off faster than a hover
  // craft coasts. Guarded so the hover path executes no extra arithmetic.
  if (profile.coastDrag > 0 && !input.accel && r.boostT <= 0) r.speed -= r.speed * profile.coastDrag * dt;
  // Grade pull from the actual track grade (grounded racers only; flight is
  // a later milestone). Guarded so flat tracks run the exact legacy ops.
  const grade = trackGradeAt(race.circuit.track, r.s);
  // Grade pull is a grounded force only; flight keeps ballistic motion.
  if (grade !== 0 && !airborne) r.speed -= Math.max(-GRADE_CLAMP, Math.min(GRADE_CLAMP, grade)) * GRADE_GRAVITY * dt;
  // Converge toward the cap AFTER accel so top speed means top speed.
  // Open-road caps converge hard (equilibrium overshoot is accelRate/8,
  // under 9 units even while boosting); far above a surface cap the excess
  // scrubs gradually (~0.5 s time constant, no instant edge snap), easing
  // to the hard cap near the limit so sustained shoulder pace stays capped.
  if (r.speed > top) {
    const rate = r.offroad && !airborne && r.speed > top + 8 ? 2.0 : 8;
    r.speed += (top - r.speed) * Math.min(1, rate * dt);
  }
  r.drifting = input.drift && Math.abs(r.speed) > 1;
  if (input.drift) r.speed -= r.speed * DRIFT_DRAG * dt;
  r.speed = clamp(r.speed, profile.maxReverse, BOOST_TOP_SPEED + 20);

  // Progressive digital steering: the smoothed position ramps toward the
  // input (quick attack, quicker release, quickest countersteer) so a brief
  // tap usefully nudges the craft, a held press predictably reaches full
  // lock, and reversing the stick recovers promptly. Authority scales with
  // speed: a stationary craft cannot slide sideways. Offroad keeps a floor
  // so a slowed craft can still steer back onto the road. Drift boosts yaw
  // at the cost of drag and grips against centrifugal slide-out.
  const opposing = Math.sign(input.steer) !== 0 && Math.sign(r.steerPos) !== 0 && Math.sign(input.steer) !== Math.sign(r.steerPos);
  const rampingUp = Math.abs(input.steer) > Math.abs(r.steerPos);
  const rampRate = opposing ? profile.steerCounter : rampingUp ? profile.steerAttack : profile.steerRelease;
  r.steerPos += clamp(input.steer - r.steerPos, -rampRate * dt, rampRate * dt);
  // Offroad recovery floor: only with real motion or propulsion intent, so a
  // stopped craft cannot crab sideways on steering alone.
  const pushing = input.accel || input.brake || Math.abs(r.speed) > 0.5;
  const authSpeed = r.offroad && pushing ? Math.max(Math.abs(r.speed), profile.authFloor) : Math.abs(r.speed);
  // Speed-shaped authority (shared helper below): zero at a stop, rising
  // promptly, strongest at corner-entry pace, easing off toward full
  // throttle — slowing down genuinely tightens turning while high-speed
  // understeer and braking usefulness are preserved.
  const steerAuthority = steerAuthorityAt(authSpeed);
  const dir = r.speed >= 0 ? 1 : -1;
  // Outward load: +curve is a right turn whose outside is -x, so a fast
  // craft is carried outward (away from the turn direction). The shove
  // scales with v*|v| against speed-shaped steering authority, so holding a bend
  // at pace demands real lock and tight bends at full throttle push wide
  // even at full ordinary steering; lifting/braking cuts the load
  // quadratically. Drift grips against it (trading speed for a tighter
  // held line via yaw plus drag), never a free straight-line gain.
  const bendLoad =
    curve * r.speed * Math.abs(r.speed) * CURVE_PUSH * (input.drift ? DRIFT_SLIDE_GRIP : 1);
  // Airborne steering is softened (reduced lateral authority); the ×1 on
  // the grounded path keeps legacy arithmetic exact.
  const steerScale = airborne ? JUMP_AIR_STEER_SCALE : 1;
  if (profile.lateralResponse <= 0) {
    // Hover: the smoothed input slides the hull directly (legacy behavior,
    // exact legacy arithmetic — this branch must not change).
    r.x += r.steerPos * steerAuthority * steerScale * (input.drift ? DRIFT_YAW : 1) * dir * dt;
    r.x -= bendLoad * dt;
  } else {
    // Jet-ski: steering chases a target lateral velocity, so the hull
    // carries momentum that settles with drag once input releases. Only
    // velocity decays — the line never recenters, so this never auto-steers.
    // Authority is still zero at a stop, so stopped input cannot move the
    // hull; the snap keeps a released craft bit-stable at rest.
    const targetV = r.steerPos * steerAuthority * steerScale * (input.drift ? DRIFT_YAW : 1) * dir - bendLoad;
    r.latV += (targetV - r.latV) * Math.min(1, profile.lateralResponse * dt);
    if (targetV === 0 && Math.abs(r.latV) < profile.lateralSnap) r.latV = 0;
    r.x += r.latV * dt;
  }
  // Shoulder flag follows the post-steer position (curb band counts as
  // on-road); pace loss is handled progressively by the surface
  // convergence above, never an edge snap.
  r.offroad = laneDepthAt(race, wrapS(race, r.s), r.x) > CURB_WIDTH;
  // Barrier scrape: clamp hard and bleed speed. Inside a fork split the
  // legacy +/- barrier becomes interval-relative (a normal shoulder past the
  // outer asphalt edge); outside the split it is the exact legacy barrier.
  {
    const fork = race.circuit.fork;
    let lo = -BARRIER_X;
    let hi = BARRIER_X;
    if (fork !== undefined) {
      forkCrossSection(fork, wrapS(race, r.s), ROAD_HALF, forkStepSec);
      if (forkStepSec.blend > 0) {
        lo = forkStepSec.roadLo - FORK_SHOULDER;
        hi = forkStepSec.roadHi + FORK_SHOULDER;
      }
    }
    if (r.x < lo || r.x > hi) {
      r.x = clamp(r.x, lo, hi);
      r.speed -= Math.abs(r.speed) * 2.2 * dt + 8 * dt;
      if (profile.lateralResponse > 0) r.latV = 0;
    }
  }

  const prevW = wrapS(race, r.s);
  r.s += r.speed * dt;
  const newW = wrapS(race, r.s);
  const prevCp = r.nextCp;
  const prevLap = r.lap;
  crossGates(r, prevW, newW, r.speed >= 0, gatesFor(race));
  if (r.nextCp !== prevCp || r.lap !== prevLap) r.gateS = r.s;
  // Fork island: commit once from the previous-x side, then hold it — input
  // that tunnels across the island can never flip the lane. The island grows
  // with the entrance blend, so the clamp target moves continuously and zone
  // entry never teleports. Same rule for the player and every AI rival.
  const fork = race.circuit.fork;
  if (fork !== undefined) {
    forkCrossSection(fork, newW, ROAD_HALF, forkStepSec);
    if (forkStepSec.blend <= 0) {
      r.forkSide = 0;
    } else {
      if ((r.forkSide ?? 0) === 0) {
        r.forkSide = stepX0 <= 0 ? -1 : 1;
      }
      const beforeIsland = r.x;
      r.x = clampForkX(fork, newW, ROAD_HALF, r.x, r.forkSide ?? 0);
      if (r.x !== beforeIsland) {
        r.speed -= Math.abs(r.speed) * 0.6 * dt;
        if (profile.lateralResponse > 0) r.latV = 0;
      }
      if (r.x < forkStepSec.roadLo - FORK_SHOULDER || r.x > forkStepSec.roadHi + FORK_SHOULDER) {
        r.x = clamp(r.x, forkStepSec.roadLo - FORK_SHOULDER, forkStepSec.roadHi + FORK_SHOULDER);
        r.speed -= Math.abs(r.speed) * 2.2 * dt + 8 * dt;
        if (profile.lateralResponse > 0) r.latV = 0;
      }
      r.offroad = laneDepthAt(race, newW, r.x) > CURB_WIDTH;
    }
  }
  // Jump flight: lip takeoff, gravity, touchdown. Progress gates above stay
  // unconditional (air never skips them); pads/pickups below gate on air.
  stepJumps(race, r, prevW, newW, stepX0, dt);

  // Boost pads grant one free entry burn kick inside the painted pad lane
  // (|x| <= PAD_HALF_X, the same lane the renderer draws) while driving
  // forward above PAD_MIN_SPEED — and nothing else. No meter refill on
  // dwell: lingering, crawling, or parking on a pad can never farm charge.
  // The kick fires once per entry (latched in r.padOn), and no meter
  // recovers while burning or still hot. Slow passive regen on open road
  // with the post-burn delay is the only refill. Same step function for AI
  // and humans: identical economy for everyone. Pads are the legacy supply:
  // they fire only in pads mode (pickups/none compile no pads at all, and
  // the mode gate below keeps even a hand-placed pad dark).
  const mode = race.circuit.boostMode ?? 'pads';
  const driving = r.speed >= PAD_MIN_SPEED;
  // Pads are a surface source: clearly airborne craft fly over them. The pad
  // lane reads the branch-relative pad.x (omitted means road center, so the
  // legacy trigger is exact).
  const pad = mode === 'pads' && driving && !isAirborne(r) ? padAt(race, newW) : null;
  let onPad = pad !== null && Math.abs(r.x - (pad.x ?? 0)) <= PAD_HALF_X;
  if (onPad && pad !== null && fork !== undefined) {
    forkCrossSection(fork, newW, ROAD_HALF, forkStepSec);
    forkPadLane(forkStepSec, pad.x ?? 0, PAD_HALF_X, forkPadSpan);
    onPad = r.x >= forkPadSpan.lo && r.x <= forkPadSpan.hi;
  }
  if (onPad && !r.padOn && r.boostT <= 0) r.boostT = Math.max(r.boostT, 0.8);
  r.padOn = onPad;
  // Banked energy cells: forward swept progress only, lateral overlap at the
  // interpolated crossing point, once per racer per lap. Reversing over a
  // cell, sitting on one, or re-crossing it this lap banks nothing.
  if (mode === 'pickups' && !isAirborne(r)) collectPickups(race, r, prevW, newW, stepX0);
  if (r.boostT > 0) {
    r.boostT = Math.max(0, r.boostT - dt);
    if (r.boostT > 0) r.boostDelay = BOOST_REGEN_DELAY;
  } else if (r.boostDelay > 0) {
    r.boostDelay = Math.max(0, r.boostDelay - dt);
  } else if (padAt(race, newW) === null) {
    // Pickups mode keeps only a trickle: cells stay the real supply, and a
    // driver who misses every lane still recovers one burst per ~50 s.
    const rate = mode === 'pickups' ? BOOST_REGEN * PICKUP_TRICKLE : BOOST_REGEN;
    r.boost = clamp(r.boost + rate * dt, 0, 1);
  }
}

/** Forward distance from a wrapped position to another along the track. */
function fwdDist(race: RaceState, from: number, to: number): number {
  const len = race.circuit.track.length;
  let d = to - from;
  if (d < 0) d += len;
  return d;
}

/**
 * Jump flight for one racer step. A grounded forward sweep across a ramp lip
 * at takeoff pace with lateral overlap launches with a bounded
 * speed-dependent impulse; flight integrates gravity against height above
 * the current ground, and touchdown clamps height/velocity with a brief cue
 * while s/x/speed continue untouched (no teleport, no speed cliff).
 * Parked, crawling, and reversing craft can never launch (speed gate plus
 * forward-sweep test); a cooldown set at takeoff and touchdown blocks a
 * same-pass retrigger but expires long before the next legitimate lap.
 * Pausing is the caller's freeze (no step calls): every timer here
 * integrates dt, so frozen frames hold frozen air. Legacy circuits (no
 * ramps, or a racer without the air key) return before any arithmetic.
 */
function stepJumps(
  race: RaceState,
  r: RacerState,
  prevW: number,
  newW: number,
  stepX0: number,
  dt: number,
): void {
  const air = r.air;
  const ramps = race.circuit.ramps;
  if (air === undefined || ramps === undefined || ramps.length === 0) return;
  // Caller-owned pause needs no timers of its own: cooldown and cue decay
  // only through stepped dt, so a frozen race holds frozen air.
  if (air.cooldown > 0) air.cooldown = Math.max(0, air.cooldown - dt);
  if (air.landingT > 0) air.landingT = Math.max(0, air.landingT - dt);
  let launched = false;
  if (air.height <= 0 && air.velocity <= 0 && air.cooldown <= 0 && r.speed >= JUMP_TAKEOFF_MIN_SPEED) {
    const span = fwdDist(race, prevW, newW);
    if (span > 1e-9) {
      for (let ri = 0; ri < ramps.length; ri++) {
        const ramp = ramps[ri]!;
        const lip = wrapS(race, ramp.s + ramp.length);
        const at = fwdDist(race, prevW, lip);
        if (at <= 0 || at > span) continue;
        const xCross = stepX0 + (r.x - stepX0) * (at / span);
        if (Math.abs(xCross - ramp.x) > ramp.halfWidth) continue;
        air.velocity = jumpImpulseFor(r.speed) + trackGradeAt(race.circuit.track, r.s) * r.speed;
        launched = true;
        air.cooldown = JUMP_COOLDOWN;
        break;
      }
    }
  }
  if (air.height > 0 || air.velocity > 0) {
    air.velocity -= JUMP_GRAVITY * dt;
    // World-vertical flight: rising terrain meets the racer sooner and
    // falling terrain leaves more air beneath them. Never stick to a hill.
    const groundRise = launched ? 0 : trackHeightAt(race.circuit.track, newW) - trackHeightAt(race.circuit.track, prevW);
    air.height += air.velocity * dt - groundRise;
    if (air.height <= 0) {
      air.height = 0;
      air.velocity = 0;
      air.landingT = JUMP_LANDING_CUE;
      air.cooldown = Math.max(air.cooldown, JUMP_COOLDOWN);
    }
  }
}

/**
 * Banked-energy collection for one racer step. The forward sweep
 * (prevW -> newW) must cross the cell, and the interpolated lateral position
 * at the crossing must overlap the cell lane. Takes are recorded in the
 * per-lap mask, so the same cell can never pay twice in one lap.
 */
function collectPickups(
  race: RaceState,
  r: RacerState,
  prevW: number,
  newW: number,
  stepX0: number,
): void {
  if (r.pickLap !== r.lap) {
    r.pickLap = r.lap;
    r.pickMask = 0;
  }
  if (r.speed < 0) return;
  const span = fwdDist(race, prevW, newW);
  if (span <= 1e-9) return;
  const picks = race.circuit.pickups ?? [];
  for (let pi = 0; pi < picks.length; pi++) {
    if ((r.pickMask & (1 << pi)) !== 0) continue;
    const cell = picks[pi]!;
    const at = fwdDist(race, prevW, wrapS(race, cell.s));
    if (at <= 0 || at > span) continue;
    const xCross = stepX0 + (r.x - stepX0) * (at / span);
    if (Math.abs(xCross - cell.x) > PICKUP_HALF_X) continue;
    r.pickMask |= 1 << pi;
    r.boost = clamp(r.boost + PICKUP_YIELD, 0, 1);
    r.pickupsTaken++;
  }
}

/** True once racer i has banked pickup pi on the current lap. */
export function isPickupTaken(race: RaceState, i: number, pi: number): boolean {
  const r = race.racers[i]!;
  return r.pickLap === r.lap && (r.pickMask & (1 << pi)) !== 0;
}

/** Cells still bankable for racer i on the current lap. */
export function pickupsRemaining(race: RaceState, i: number): number {
  const picks = race.circuit.pickups ?? [];
  let n = 0;
  for (let pi = 0; pi < picks.length; pi++) if (!isPickupTaken(race, i, pi)) n++;
  return n;
}

/**
 * Nearest bankable cell ahead for racer i (lateral lane target), or null
 * outside pickups mode / when nothing lies within seek range. Pure query —
 * collection still runs through the shared step function.
 */
export function pickupTargetX(race: RaceState, i: number): number | null {
  if ((race.circuit.boostMode ?? 'pads') !== 'pickups') return null;
  const r = race.racers[i]!;
  const picks = race.circuit.pickups ?? [];
  const w = wrapS(race, r.s);
  let best: EnergyPickup | null = null;
  let bestD = 150;
  for (let pi = 0; pi < picks.length; pi++) {
    if (isPickupTaken(race, i, pi)) continue;
    const d = fwdDist(race, w, wrapS(race, picks[pi]!.s));
    if (d > 0.5 && d < bestD) {
      bestD = d;
      best = picks[pi]!;
    }
  }
  return best ? best.x : null;
}

/** Current race position of racer i (1-based). */
export function racePosition(race: RaceState, i: number): number {
  let pos = 1;
  for (let j = 0; j < race.racers.length; j++) {
    if (j === i) continue;
    if (compareRacers(race, race.racers[j]!, race.racers[i]!) < 0) pos++;
  }
  return pos;
}

function compareRacers(race: RaceState, a: RacerState, b: RacerState): number {
  // Locked finish order beats live progress: a finisher always outranks the
  // unfinished, and finishers sort by place — never by post-line overshoot.
  if (a.finished || b.finished) {
    if (a.finished && b.finished) return a.place - b.place;
    return a.finished ? -1 : 1;
  }
  if (a.lap !== b.lap) return b.lap - a.lap;
  if (a.nextCp !== b.nextCp) return b.nextCp - a.nextCp;
  // Same gate: progress since the last gate change, capped so an unarmed
  // finish-line crossing (which never advances the gate) cannot outrank
  // honest sector driving. Final tiebreak on raw s keeps grid order stable.
  const cap = sectorCap(race);
  const pa = Math.min(a.s - a.gateS, cap);
  const pb = Math.min(b.s - b.gateS, cap);
  if (pa !== pb) return pb - pa;
  return b.s - a.s;
}

/** Signed shortest longitudinal gap from b to a along the track. */
function trackGap(race: RaceState, a: number, b: number): number {
  const len = race.circuit.track.length;
  let d = race.circuit.track.wrap(a - b);
  if (d > len / 2) d -= len;
  return d;
}

/**
 * Symmetric contact: overlapping craft shove each other apart laterally and
 * the faster one scrubs speed. Index loops only, no allocation.
 */
function resolveContact(race: RaceState, dt: number): void {
  const racers = race.racers;
  for (let i = 0; i < racers.length; i++) {
    const a = racers[i]!;
    if (a.finished) continue;
    for (let j = i + 1; j < racers.length; j++) {
      const b = racers[j]!;
      if (b.finished) continue;
      // Airborne craft fly over the pack: no contact either way.
      if (isAirborne(a) || isAirborne(b)) continue;
      // Fork island: craft on opposite committed lanes never touch across
      // the island — cross-island contacts are suppressed outright.
      const fork = race.circuit.fork;
      let aSide = 0;
      let bSide = 0;
      let aW = 0;
      let bW = 0;
      if (fork !== undefined) {
        aW = wrapS(race, a.s);
        bW = wrapS(race, b.s);
        forkCrossSection(fork, aW, ROAD_HALF, forkStepSec);
        const aActive = forkStepSec.islandActive;
        aSide = a.x <= forkStepSec.islandLo ? -1 : a.x >= forkStepSec.islandHi ? 1 : 0;
        forkCrossSection(fork, bW, ROAD_HALF, forkContactSec);
        const bActive = forkContactSec.islandActive;
        bSide = b.x <= forkContactSec.islandLo ? -1 : b.x >= forkContactSec.islandHi ? 1 : 0;
        if (aActive && bActive && aSide !== 0 && bSide !== 0 && aSide !== bSide) continue;
      }
      const ds = trackGap(race, a.s, b.s);
      const dx = a.x - b.x;
      if (Math.abs(ds) < CRAFT_LENGTH && Math.abs(dx) < CRAFT_SIDE) {
        const push = ((CRAFT_SIDE - Math.abs(dx)) * 0.5 + 0.4) * dt * 60 * 0.12;
        const side = dx >= 0 ? 1 : -1;
        a.x += side * push;
        b.x -= side * push;
        // Contact runs after the per-racer barrier clamp, so a wall-side
        // shove can escape the barrier: re-clamp within bounds (a hard cap,
        // never auto-centering) and re-sync the offroad flags the shove may
        // have carried across the curb line. No speed or boost change here.
        // On fork circuits the same-lane push additionally clamps against
        // the island (no shove tunnels a racer through it) and the barrier
        // is interval-relative inside the split.
        if (fork === undefined) {
          a.x = clamp(a.x, -BARRIER_X, BARRIER_X);
          b.x = clamp(b.x, -BARRIER_X, BARRIER_X);
        } else {
          a.x = clampForkX(fork, aW, ROAD_HALF, a.x, aSide !== 0 ? aSide : (a.forkSide ?? 0));
          b.x = clampForkX(fork, bW, ROAD_HALF, b.x, bSide !== 0 ? bSide : (b.forkSide ?? 0));
          forkCrossSection(fork, aW, ROAD_HALF, forkStepSec);
          a.x = forkStepSec.blend > 0
            ? clamp(a.x, forkStepSec.roadLo - FORK_SHOULDER, forkStepSec.roadHi + FORK_SHOULDER)
            : clamp(a.x, -BARRIER_X, BARRIER_X);
          forkCrossSection(fork, bW, ROAD_HALF, forkStepSec);
          b.x = forkStepSec.blend > 0
            ? clamp(b.x, forkStepSec.roadLo - FORK_SHOULDER, forkStepSec.roadHi + FORK_SHOULDER)
            : clamp(b.x, -BARRIER_X, BARRIER_X);
        }
        a.offroad = laneDepthAt(race, wrapS(race, a.s), a.x) > CURB_WIDTH;
        b.offroad = laneDepthAt(race, wrapS(race, b.s), b.x) > CURB_WIDTH;
        // Closing speed is the rate the longitudinal gap shrinks: positive
        // while the pair approaches (rear craft faster), negative while they
        // separate. Symmetric under a/b swap. Only the approaching (faster)
        // craft scrubs speed, and it always loses speed, never gains it.
        const closing = (b.speed - a.speed) * Math.sign(ds || 1);
        if (closing > 0) {
          const scrub = closing * 0.5 * dt * 60 * 0.06;
          if (a.speed >= b.speed) a.speed -= scrub;
          else b.speed -= scrub;
        }
      }
    }
  }
}

export function stepRace(race: RaceState, inputs: RacerInput[], dt: number): void {
  // Once the player finishes, the clock and every craft freeze for results.
  if (race.over) return;
  if (race.countdown > 0) {
    race.countdown = Math.max(0, race.countdown - dt);
    if (race.countdown === 0) {
      for (const r of race.racers) r.lapStartT = race.t;
    }
    // Hold craft on the grid during the countdown.
    for (const r of race.racers) r.speed = 0;
    return;
  }
  race.t += dt;
  for (let i = 0; i < race.racers.length; i++) {
    const r = race.racers[i]!;
    if (r.finished) continue;
    stepRacer(race, r, inputs[i]!, dt);
    // Stamp lap times banked this step.
    if (r.lapTimes.length > 0 && r.lapTimes[r.lapTimes.length - 1]! === 0) {
      const last = r.lapTimes.length - 1;
      r.lapTimes[last] = race.t - r.lapStartT;
      r.lapStartT = race.t;
    }
    if (r.lap >= race.circuit.laps && !r.finished) {
      r.finished = true;
      r.finishT = race.t;
      r.place = race.finishOrder.length;
      race.finishOrder.push(i);
    }
  }
  resolveContact(race, dt);
  // Timeout: a stuck player can never hang the race. Unfinished racers score
  // DNF and the clock freezes for results.
  if (!race.over && race.t >= race.circuit.timeout) {
    for (let i = 0; i < race.racers.length; i++) {
      if (!race.racers[i]!.finished && !race.dnf[i]) race.dnf[i] = true;
    }
    race.over = true;
  }
  if (!race.over && race.racers[PLAYER_INDEX]!.finished) race.over = true;
}

/** One classified row: finishers by time, then DNFs by on-track progress. */
export interface ClassifiedEntry {
  index: number;
  /** 1-based place. */
  place: number;
  /** Race-clock time for finishers; null for DNF. */
  time: number | null;
  dnf: boolean;
}

/**
 * Full classification, stable after race.over: true finishers first (in
 * finish order), then unfinished racers by on-track progress. DNFs (timeout)
 * rank after every classified finisher in progress order.
 */
export function classifyRace(race: RaceState): ClassifiedEntry[] {
  const out: ClassifiedEntry[] = [];
  for (const i of race.finishOrder) {
    const r = race.racers[i]!;
    out.push({ index: i, place: out.length + 1, time: r.finishT, dnf: false });
  }
  const rest: number[] = [];
  for (let i = 0; i < race.racers.length; i++) {
    if (!race.racers[i]!.finished) rest.push(i);
  }
  rest.sort((a, b) => compareRacers(race, race.racers[a]!, race.racers[b]!));
  for (const i of rest) {
    out.push({ index: i, place: out.length + 1, time: null, dnf: race.dnf[i] ?? false });
  }
  return out;
}

// --- Cup --------------------------------------------------------------------

/** Points totals after n races; history holds one classification per race. */
export interface CupState {
  raceIndex: number;
  points: number[];
  wins: number[];
  history: ClassifiedEntry[][];
}

export function createCup(racerCount = RACER_COUNT): CupState {
  return { raceIndex: 0, points: new Array(racerCount).fill(0), wins: new Array(racerCount).fill(0), history: [] };
}

/** True once every cup circuit has a recorded classification. */
export function cupComplete(cup: CupState, circuitCount = RACE_CIRCUITS.length): boolean {
  return cup.history.length >= circuitCount;
}

/**
 * Record one finished race: awards CUP_POINTS by place and advances the
 * race index. Standings stay stable — recording is append-only.
 */
export function recordRaceResult(cup: CupState, classification: ClassifiedEntry[]): void {
  for (const e of classification) {
    cup.points[e.index] = (cup.points[e.index] ?? 0) + (CUP_POINTS[e.place - 1] ?? 0);
    if (e.place === 1) cup.wins[e.index] = (cup.wins[e.index] ?? 0) + 1;
  }
  cup.history.push(classification.map((e) => ({ ...e })));
  cup.raceIndex = cup.history.length;
}

/** Cup order: points, then wins, then the final race place. Lower is better. */
export function cupStandings(cup: CupState): number[] {
  const order = cup.points.map((_, i) => i);
  const last = cup.history[cup.history.length - 1];
  const lastPlace = (i: number): number => last?.find((e) => e.index === i)?.place ?? 99;
  order.sort((a, b) => {
    if (cup.points[b] !== cup.points[a]) return cup.points[b]! - cup.points[a]!;
    if (cup.wins[b] !== cup.wins[a]) return cup.wins[b]! - cup.wins[a]!;
    return lastPlace(a) - lastPlace(b);
  });
  return order;
}

/** Reset points/history; the caller builds a fresh race for raceIndex 0. */
export function restartCup(cup: CupState): void {
  cup.raceIndex = 0;
  cup.points.fill(0);
  cup.wins.fill(0);
  cup.history.length = 0;
}

// --- AI -------------------------------------------------------------------

/** Lookahead distance scales with speed so fast craft brake in time. */
function maxCurveAhead(track: CompiledTrack, s: number, speed: number): { abs: number; signed: number } {
  const look = 40 + Math.abs(speed) * 0.9;
  let abs = 0;
  let signed = 0;
  const steps = 6;
  for (let k = 1; k <= steps; k++) {
    const c = track.curvatureAt(s + (look * k) / steps);
    if (Math.abs(c) > abs) {
      abs = Math.abs(c);
      signed = c;
    }
  }
  return { abs, signed };
}

/**
 * Lateral steering authority (world units/s at full smoothed lock) as a
 * smooth function of pace: zero stopped, prompt at low speed, peaking
 * near corner-entry pace, easing toward full throttle. One shared source
 * for physics, AI planning, and feedforward — never separate equations.
 */
export function steerAuthorityAt(speed: number): number {
  const v = Math.abs(speed);
  // Retain about 5.75 units/s at race and boost pace. Add cornering grip
  // around 40 instead of making fast steering progressively disappear.
  // Both terms are smooth, and the base goes to zero with motion.
  const base = STEER_GAIN * 50 * (1 - Math.exp(-v / 18));
  const cornerGrip = 1 + 0.7 * Math.exp(-Math.pow((v - 40) / 20, 2));
  return base * cornerGrip;
}

/**
 * Fastest pace the shared steering/grip model can hold through a bend:
 * solves steerAuthorityAt(v) * yaw == loadK * v^2 by bisection (monotone
 * decreasing past the authority peak, deterministic, bounded iteration).
 */
export function cornerHoldSpeed(curvature: number, drift: boolean): number {
  const loadK = Math.max(Math.abs(curvature), 1e-6) * CURVE_PUSH * (drift ? DRIFT_SLIDE_GRIP : 1);
  const yawK = drift ? DRIFT_YAW : 1;
  const residual = (v: number): number => steerAuthorityAt(v) * yawK - loadK * v * v;
  let lo = 5;
  let hi = BOOST_TOP_SPEED;
  if (residual(hi) >= 0) return hi;
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    if (residual(mid) >= 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Work backward from each upcoming corner's entry speed. Applying its
 * slowest speed immediately would brake along the entire approach; the
 * stopping-distance envelope lets the driver carry speed until braking
 * is needed. Reserve distance for digital input response and line setup.
 */
function plannedCornerSpeed(
  track: CompiledTrack,
  s: number,
  speed: number,
  brakeDecel = BRAKE_DECEL,
): number {
  const look = 40 + Math.abs(speed) * 0.9;
  let limit = BOOST_TOP_SPEED;
  for (let k = 0; k <= 10; k++) {
    const distance = look * k / 10;
    const curve = Math.abs(track.curvatureAt(s + distance));
    const hold = cornerHoldSpeed(curve, curve > 0.007) * 0.96;
    const brakingDistance = Math.max(0, distance - Math.abs(speed) * 0.1 - 3);
    limit = Math.min(limit, Math.sqrt(hold * hold + 2 * brakeDecel * brakingDistance));
  }
  return limit;
}

/**
 * Deterministic rival driver: a personal line (staggered apex offset on
 * curves, a home lane on straights), committed passes around slower traffic
 * with follow/brake fallback when blocked, and boost only into clear road.
 * A pure function of race state — no memory, so repeated planning calls and
 * restarts behave identically. Operates purely through RacerInput so rivals
 * obey identical physics, pads, and lap gates. Writes into `out` when
 * provided to avoid per-frame allocation.
 */
export function aiInputFor(race: RaceState, i: number, out?: RacerInput): RacerInput {
  const r = race.racers[i]!;
  const ahead = maxCurveAhead(race.circuit.track, r.s, r.speed);
  // Personal line: golden-ratio stagger spreads apex targets across the road
  // instead of stacking every rival on one inside line. Inside of a turn is
  // the turn direction: +curve bends right (+x).
  const frac = (i * 0.61803398875) % 1;
  let targetX = ahead.abs > 0.0025 ? Math.sign(ahead.signed) * (0.7 + 0.7 * frac) : ((i + 1) % 3 - 1) * 1.1;
  // Fork branches: a stable left/right pick by racer index, committed well
  // before the blend begins. In-zone the branch-relative center is the only
  // lateral target — passes and pickup hunts never fight it — and the lane
  // centers reconverge to the road center at the exit, so the field merges
  // naturally with no steering event.
  const fork = race.circuit.fork;
  let inFork = false;
  if (fork !== undefined) {
    const w = race.circuit.track.wrap(r.s);
    const d = w - fork.start;
    if (d >= -FORK_AI_APPROACH && d <= fork.length) {
      inFork = true;
      const side = (r.forkSide ?? 0) || forkBranchSide(i);
      if (d < 0) {
        targetX = side * 1.5;
      } else {
        forkCrossSection(fork, w, ROAD_HALF, forkAiSec);
        targetX = side < 0 ? forkAiSec.leftCenter : forkAiSec.rightCenter;
        if (d < fork.length / 2) {
          // Keep the incoming lane at the tip; do not snap the target back
          // through the growing island at the start of the split.
          targetX += side * 1.5 * (1 - forkAiSec.blend);
        }
      }
    }
  }
  // Nearest unfinished craft directly ahead (directional, not wrapped).
  let target: RacerState | null = null;
  let targetGap = 85;
  for (let j = 0; j < race.racers.length; j++) {
    if (j === i) continue;
    const o = race.racers[j]!;
    if (o.finished) continue;
    const gap = trackGap(race, o.s, r.s);
    if (gap > 0 && gap < targetGap) {
      targetGap = gap;
      target = o;
    }
  }
  const slower = target !== null && target.speed < r.speed + 2;
  // Committed pass: once alongside (|dx| past the deadband) hold that side;
  // otherwise take the side with fewer blockers so the choice cannot chatter.
  let passing = false;
  let blocked = false;
  if (!inFork && slower && targetGap < 75 && Math.abs(target!.x - r.x) < 2.2) {
    const dx = r.x - target!.x;
    let side: number;
    if (Math.abs(dx) >= 1.2) {
      side = Math.sign(dx);
    } else {
      let leftBlockers = 0;
      let rightBlockers = 0;
      for (let j = 0; j < race.racers.length; j++) {
        if (j === i) continue;
        const o = race.racers[j]!;
        if (o.finished) continue;
        const gap = trackGap(race, o.s, r.s);
        if (gap > -5 && gap < 40) {
          if (o.x < target!.x) leftBlockers++;
          else rightBlockers++;
        }
      }
      if (leftBlockers !== rightBlockers) side = leftBlockers < rightBlockers ? -1 : 1;
      else side = target!.x >= 0 ? -1 : 1;
    }
    const lane = clamp(target!.x + side * 1.9, -2.2, 2.2);
    // Blocked: another craft holds the chosen lane between us and the target
    // (ahead only, near the target's position) — otherwise follow through.
    for (let j = 0; j < race.racers.length; j++) {
      if (j === i) continue;
      const o = race.racers[j]!;
      if (o.finished || o === target) continue;
      const gap = trackGap(race, o.s, r.s);
      if (gap > 0 && gap < targetGap + 12 && Math.abs(o.x - lane) < 1.1) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      passing = true;
      targetX = lane;
    }
  }
  // Energy-lane seeking: in pickups mode the next bankable cell ahead pulls
  // the line sideways on mild road, through the same steering input as every
  // other target. Passing lines and real corners win over cell hunting.
  if (!inFork && !passing && ahead.abs < 0.004) {
    const laneX = pickupTargetX(race, i);
    if (laneX !== null) targetX = clamp(laneX, -2.2, 2.2);
  }
  // Blocked or closing with overlap AND faster: lift, and brake only when
  // truly on the gearbox, instead of ramming into a ram-proof shove. Never
  // brake or lift while slower — that capped the chaser below traffic pace
  // in a limit cycle instead of letting it close and pass.
  const closing = slower && targetGap < 30 && Math.abs(target!.x - r.x) < 1.4 && r.speed > target!.speed;
  const followBrake =
    (blocked && targetGap < 25 && r.speed > target!.speed + 1) || (closing && targetGap < 12);
  // Plan actual braking distance and the drift the driver will use in a
  // tight bend; rivals share the player's steering, grip and brake limits.
  // The pace target follows the race discipline so jet-ski rivals plan for
  // jet-ski pace through the same driver logic (hover is unchanged).
  const aiProfile = movementForTraversal(race.circuit.discipline, race.circuit.traversal);
  const topSpeed = aiProfile.topSpeed * r.topScale;
  const cornerSafe = Math.min(
    topSpeed,
    plannedCornerSpeed(race.circuit.track, r.s, r.speed, aiProfile.brakeDecel),
  );
  const currentCurve = race.circuit.track.curvatureAt(r.s);
  const drift = Math.abs(currentCurve) > 0.007 && Math.abs(r.speed) > 35;
  // Subtle per-rival brake point so the field does not concertina as one.
  const brake = followBrake || r.speed > cornerSafe + 1 + (i % 3) * 0.5;
  // Hold the line against the load: feedforward cancels the current bend
  // shove (load over shared speed-shaped authority) with lane error
  // correcting the rest, saturating at full lock when the error is large.
  const authNow = steerAuthorityAt(r.speed) * (drift ? DRIFT_YAW : 1);
  const ff = (currentCurve * r.speed * Math.abs(r.speed) * CURVE_PUSH * (drift ? DRIFT_SLIDE_GRIP : 1)) / Math.max(authNow, 1e-6);
  // Keep lane corrections at a predictable lateral speed as corner grip
  // increases. Otherwise stronger steering also amplifies the driver's
  // feedback loop, causing it to overshoot from side to side.
  const correction = (targetX - r.x) * 4.6 / Math.max(steerAuthorityAt(r.speed), 1);
  const steer = clamp(correction + clamp(ff, -1, 1), -1, 1);
  // Add a touch of per-rival determinism so the pack spreads out.
  const wobble = Math.sin(race.t * 0.7 + i * 2.1) * 0.08;
  const result =
    out ??
    ({ steer: 0, accel: false, brake: false, boost: false, drift: false } as RacerInput);
  result.steer = clamp(steer + wobble, -1, 1);
  result.accel = !brake && !(closing && !passing) && !(blocked && targetGap < 35 && r.speed > target!.speed);
  result.brake = brake;
  // Boost unless about to rear-end slower overlap or following under
  // braking. Boosting past offset traffic is honest pace (same meter and
  // pads); only a close-range closing overlap denies it.
  const boostClear = !followBrake && !(closing && targetGap < 25);
  result.boost = r.boost >= BOOST_COST && ahead.abs < 0.002 && r.speed > 45 && r.boostT <= 0 && boostClear;
  // Drift is a corner tool, not cruise drag: only where the load is real
  // and the pace is high enough that yaw-for-speed pays off.
  result.drift = drift;
  return result;
}

/** Player result once the player finishes; null while racing. */
export function playerResult(race: RaceState): {
  won: boolean;
  place: number;
  time: number;
} | null {
  const p = race.racers[PLAYER_INDEX]!;
  if (!p.finished) return null;
  return { won: p.place === 0, place: p.place + 1, time: p.finishT };
}
