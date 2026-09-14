// Contact-at-the-wall bounds: resolveContact runs after the per-racer
// barrier clamp, so a wall-side shove must not escape the barrier, and the
// offroad flags the shove carries across the curb line must be re-synced.
import { describe, expect, it } from 'vitest';
import {
  aiInputFor,
  createRaceFor,
  stepRace,
  type RaceState,
  type RacerInput,
} from '../src/racing/simulation';
import { BARRIER_X, CURB_WIDTH, RACE_CIRCUITS, ROAD_HALF } from '../src/racing/track';

const base = RACE_CIRCUITS[0]!;
// Straight, pad-free geometry isolates contact from curve load and pad kicks.
const straight = { ...base, pads: [], track: { ...base.track, curvatureAt: () => 0 } };

const idle = (): RacerInput => ({ steer: 0, accel: false, brake: false, boost: false, drift: false });

/** Pair at the wall with rivals parked; speeds equal so contact never scrubs. */
function wallPair(x0: number, x1: number): RaceState {
  const race = createRaceFor(straight, 0);
  for (let i = 2; i < race.racers.length; i++) race.racers[i]!.finished = true;
  const a = race.racers[0]!;
  a.s = a.gateS = 100;
  a.x = x0;
  a.speed = 50;
  const b = race.racers[1]!;
  b.s = b.gateS = 101;
  b.x = x1;
  b.speed = 50;
  return race;
}

function offroadFor(x: number): boolean {
  return Math.max(0, Math.abs(x) - ROAD_HALF) > CURB_WIDTH;
}

describe('contact at the barrier', () => {
  it('holds the host repro inside the barrier (racer 0 shoved at +x wall)', () => {
    const race = wallPair(BARRIER_X, BARRIER_X - 0.7);
    stepRace(race, race.racers.map(idle), 1 / 60);
    for (const r of race.racers.slice(0, 2)) {
      expect(Math.abs(r.x)).toBeLessThanOrEqual(BARRIER_X);
      expect(Number.isFinite(r.x)).toBe(true);
    }
    // The clamp is a hard cap: no speed or boost gain from the shove.
    expect(race.racers[0]!.speed).toBeLessThanOrEqual(50);
    expect(race.racers[1]!.speed).toBeLessThanOrEqual(50);
  });

  it('mirrors at the -x wall', () => {
    const race = wallPair(-BARRIER_X, -(BARRIER_X - 0.7));
    stepRace(race, race.racers.map(idle), 1 / 60);
    for (const r of race.racers.slice(0, 2)) {
      expect(Math.abs(r.x)).toBeLessThanOrEqual(BARRIER_X);
    }
  });

  it('holds with the pair indices swapped (racer 1 takes the wall shove)', () => {
    const race = wallPair(BARRIER_X - 0.7, BARRIER_X);
    stepRace(race, race.racers.map(idle), 1 / 60);
    for (const r of race.racers.slice(0, 2)) {
      expect(Math.abs(r.x)).toBeLessThanOrEqual(BARRIER_X);
    }
  });

  it.each([30, 60, 120])('holds at %dHz', (hz) => {
    const race = wallPair(BARRIER_X, BARRIER_X - 0.7);
    stepRace(race, race.racers.map(idle), 1 / hz);
    for (const r of race.racers.slice(0, 2)) {
      expect(Math.abs(r.x)).toBeLessThanOrEqual(BARRIER_X);
    }
  });

  it('syncs the offroad flag when contact shoves outward across the curb', () => {
    const race = wallPair(4.3, 3.5);
    expect(race.racers[0]!.offroad).toBe(false);
    stepRace(race, race.racers.map(idle), 1 / 60);
    const a = race.racers[0]!;
    expect(a.x).toBeGreaterThan(ROAD_HALF + CURB_WIDTH);
    expect(a.offroad).toBe(true);
    expect(a.offroad).toBe(offroadFor(a.x));
  });

  it('syncs the offroad flag when contact shoves inward across the curb', () => {
    const race = wallPair(4.5, 5.3);
    stepRace(race, race.racers.map(idle), 1 / 60);
    const a = race.racers[0]!;
    expect(a.x).toBeLessThan(ROAD_HALF + CURB_WIDTH);
    expect(a.offroad).toBe(false);
    expect(a.offroad).toBe(offroadFor(a.x));
  });

  it('keeps a crowded wall field in bounds, then recovers onto the road', () => {
    const race = createRaceFor(straight, 0);
    for (let i = 0; i < race.racers.length; i++) {
      const r = race.racers[i]!;
      r.s = r.gateS = 10 + i * 4;
      r.x = BARRIER_X - i * 0.4;
      r.speed = 30;
    }
    for (let k = 0; k < 120; k++) {
      stepRace(
        race,
        race.racers.map((_, i) => aiInputFor(race, i)),
        1 / 60,
      );
      for (const r of race.racers) {
        expect(Math.abs(r.x)).toBeLessThanOrEqual(BARRIER_X);
        expect(Number.isFinite(r.s)).toBe(true);
      }
    }
    // Recovery: with traffic ahead, the AI steers back onto the road.
    for (let k = 0; k < 600 && Math.abs(race.racers[0]!.x) >= BARRIER_X - 1; k++) {
      stepRace(
        race,
        race.racers.map((_, i) => aiInputFor(race, i)),
        1 / 60,
      );
    }
    const player = race.racers[0]!;
    expect(Math.abs(player.x)).toBeLessThan(BARRIER_X - 1);
    expect(player.offroad).toBe(offroadFor(player.x));
  });
});
