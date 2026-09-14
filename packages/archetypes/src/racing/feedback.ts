// Race-readability feedback: corner warnings + nearest-rival context.
// Pure helpers over compiled geometry and racer progress; the renderer and
// HUD text are thin consumers. No physics, no AI, no DOM.

import type { RaceCircuit } from './track';
import { PLAYER_INDEX, racePosition, type RaceState } from './simulation';

export type BendSeverity = 'SWEEP' | 'SHARP' | 'TIGHT';

export interface Bend {
  /** Wrapped circuit position where the bend region begins. */
  start: number;
  /** Peak signed curvature (mirror flips the sign, never the severity). */
  peak: number;
  /** +1 right, -1 left. */
  dir: 1 | -1;
  severity: BendSeverity;
}

/** Severity floors on |curvature| (host-measured maxima ~0.013-0.019). */
export const SWEEP_CURVE = 0.0025;
export const SHARP_CURVE = 0.007;
export const TIGHT_CURVE = 0.012;
/** Quiet gap below which same-sign bend regions merge (never opposite). */
const MERGE_QUIET = 40;
/** Approach-board offsets before a bend start (sim units, near→far). */
export const BOARD_OFFSETS = [40, 80, 120];
/** Sim units to-labelled-metres (HUD speed is sim speed * 2.4 km/h). */
export const UNITS_TO_M = 2 / 3;

function severityOf(peakAbs: number): BendSeverity {
  if (peakAbs >= TIGHT_CURVE) return 'TIGHT';
  if (peakAbs >= SHARP_CURVE) return 'SHARP';
  return 'SWEEP';
}

/**
 * Deterministic bend set for one compiled course. Coarse scan (10u) grouped
 * into SIGN-CONSISTENT contiguous regions: a region closes on direction
 * change or when the curve drops out, tracks its end, and merges only with
 * a same-sign neighbor across a genuinely short quiet gap. Opposite bends
 * (S-curves) never merge; the seam merges by end-to-start gap. Direction
 * always agrees with the region's own start curvature and peak. Compute
 * ONCE per course and reuse every frame.
 */
export function analyzeBends(circuit: RaceCircuit): Bend[] {
  const len = circuit.track.length;
  interface Raw {
    start: number;
    end: number;
    sign: 1 | -1;
    peak: number;
  }
  const runs: Raw[] = [];
  let cur: Raw | null = null;
  for (let s = 0; s < len; s += 10) {
    const c = circuit.track.curvatureAt(s);
    if (Math.abs(c) >= SWEEP_CURVE) {
      const sign: 1 | -1 = c >= 0 ? 1 : -1;
      if (cur !== null && cur.sign === sign) {
        cur.end = s;
        if (Math.abs(c) > Math.abs(cur.peak)) cur.peak = c;
      } else {
        if (cur !== null) runs.push(cur);
        cur = { start: s, end: s, sign, peak: c };
      }
    } else if (cur !== null) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur !== null) runs.push(cur);
  // Merge same-sign neighbors across a short quiet gap (end-to-start).
  const merged: Raw[] = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.sign === r.sign && r.start - prev.end < MERGE_QUIET) {
      prev.end = r.end;
      if (Math.abs(r.peak) > Math.abs(prev.peak)) prev.peak = r.peak;
    } else {
      merged.push({ ...r });
    }
  }
  // Seam: first and last may be one region (end-to-start across the line).
  if (merged.length > 1) {
    const first = merged[0]!;
    const last = merged[merged.length - 1]!;
    if (last.sign === first.sign && first.start + len - last.end < MERGE_QUIET) {
      last.end = first.end;
      if (Math.abs(first.peak) > Math.abs(last.peak)) last.peak = first.peak;
      merged.shift();
    }
  }
  return merged.map((r) => ({
    start: ((r.start % len) + len) % len,
    peak: r.peak,
    dir: r.sign,
    severity: severityOf(Math.abs(r.peak)),
  }));
}

export interface Upcoming {
  bend: Bend;
  /** Forward distance from wrapped position to bend start (0..len). */
  dist: number;
}

/** Next bend ahead with wrap-correct distance; distance shrinks with travel. */
export function nextBend(bends: Bend[], sWrapped: number, trackLen: number): Upcoming | null {
  if (bends.length === 0) return null;
  let best: Upcoming | null = null;
  for (const bend of bends) {
    const dist = (((bend.start - sWrapped) % trackLen) + trackLen) % trackLen;
    if (best === null || dist < best.dist) best = { bend, dist };
  }
  return best;
}

/**
 * World-anchored approach-board lap positions for a bend start: fixed
 * offsets before it, wrapped, so boards never drift as the camera moves.
 * BOARD_OFFSETS runs near-to-far; the countdown convention is 3 chevrons
 * on the far board down to 1 on the near board.
 */
export function boardsFor(bendStart: number, trackLen: number): number[] {
  return BOARD_OFFSETS.map((off) => (((bendStart - off) % trackLen) + trackLen) % trackLen);
}

/** Chevron count for a board index (near-to-far order): 1 near … 3 far. */
export function boardChevrons(boardIdx: number): number {
  return Math.max(1, Math.min(BOARD_OFFSETS.length, boardIdx + 1));
}

/** A position banner goes stale the moment the position changes again. */
export function bannerStale(bannerPos: number | null, posNow: number): boolean {
  return bannerPos !== null && bannerPos !== posNow;
}

// --- Rival context ----------------------------------------------------------

/** Cooldown between position banners (race-clock seconds). */
export const POS_EVENT_COOLDOWN = 5;

export interface RivalGap {
  index: number;
  name: string;
  /** Signed progress gap in sim units: + means the rival is ahead. */
  gap: number;
  side: 'AHEAD' | 'BEHIND' | 'ALONGSIDE';
}

/**
 * Nearest opponent by total progress (lap-aware unwrapped s, so a lapped
 * car physically ahead never presents as the race leader: its progress gap
 * is a full lap negative). Finished racers keep their frozen progress.
 */
export function nearestRival(race: RaceState, names: string[]): RivalGap | null {
  const player = race.racers[PLAYER_INDEX]!;
  let best: RivalGap | null = null;
  for (let i = 0; i < race.racers.length; i++) {
    if (i === PLAYER_INDEX) continue;
    const r = race.racers[i]!;
    const gap = r.s - player.s;
    const side = Math.abs(gap) < 8 ? 'ALONGSIDE' : gap > 0 ? 'AHEAD' : 'BEHIND';
    if (best === null || Math.abs(gap) < Math.abs(best.gap)) {
      best = { index: i, name: names[i] ?? `R${i + 1}`, gap, side };
    }
  }
  return best;
}

/**
 * Position-change banner with destination: 'GAINED P2' / 'LOST P4'.
 * Pure over (posNow, posShown, nowT, lastEventT): emits only on a real
 * change past cooldown, so contact oscillation cannot spam. Returns the
 * banner text plus the new shown/last-event state.
 */
export function positionEvent(
  posNow: number,
  posShown: number | null,
  nowT: number,
  lastEventT: number,
): { text: string | null; shown: number; eventT: number } {
  if (posShown === null) return { text: null, shown: posNow, eventT: lastEventT };
  if (posNow === posShown || nowT - lastEventT < POS_EVENT_COOLDOWN) {
    return { text: null, shown: posNow, eventT: lastEventT };
  }
  const text = posNow < posShown ? `GAINED P${posNow}` : `LOST P${posNow}`;
  return { text, shown: posNow, eventT: nowT };
}

/** Current 1-based race position of the player. */
export function playerPos(race: RaceState): number {
  return racePosition(race, PLAYER_INDEX);
}
