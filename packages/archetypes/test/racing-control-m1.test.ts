// Milestone 1 (world anchoring + boost economy): targeted pure-logic tests,
// no DOM. Complements racing-simulation.test.ts; steering/AI tuning untouched.
import { describe, expect, it } from 'vitest';
import { INTERNAL_HEIGHT } from '@sparkade/shared';
import {
  RACING_ARROW_COUNT,
  RACING_CAM_BACK,
  RACING_HORIZON,
  RACING_SCENERY_COUNT,
  RACING_Z_NEAR,
  RACING_Z_SPAN,
  markerGate,
  projectAtZ,
  projectRoad,
  worldMarkerSlots,
} from '../src/racing/game';
import {
  BOOST_COST,
  PAD_MIN_SPEED,
  PLAYER_INDEX,
  PLAYER_TOP_SPEED,
  aiInputFor,
  createRace,
  stepRace,
  type RaceState,
  type RacerInput,
} from '../src/racing/simulation';
import { BOOST_PADS, PAD_HALF_X, RACE_CIRCUITS } from '../src/racing/track';

const DT = 1 / 60;

function idle(): RacerInput {
  return { steer: 0, accel: false, brake: false, boost: false, drift: false };
}

function fullGas(): RacerInput {
  return { steer: 0, accel: true, brake: false, boost: false, drift: false };
}

function inputsFor(race: RaceState, player: RacerInput): RacerInput[] {
  return race.racers.map((_, i) => (i === PLAYER_INDEX ? player : idle()));
}

function runSteps(race: RaceState, n: number, player: RacerInput): void {
  for (let k = 0; k < n; k++) stepRace(race, inputsFor(race, player), DT);
}

/** Flat, pad-free circuit so boost/pad tests isolate the economy. */
function flatRace(): RaceState {
  const race = createRace();
  race.countdown = 0;
  race.circuit = {
    ...race.circuit,
    pads: [],
    track: { ...race.circuit.track, curvatureAt: () => 0 },
  };
  return race;
}

describe('world-anchored markers', () => {
  const len = RACE_CIRCUITS[0]!.track.length;

  it('holds fixed periodic circuit positions and approaches smoothly', () => {
    const camS = 1000;
    const a = worldMarkerSlots(camS, len, RACING_SCENERY_COUNT);
    const b = worldMarkerSlots(camS + 10, len, RACING_SCENERY_COUNT);
    expect(a.length).toBeGreaterThan(2);
    // Persistent ids shift exactly 10 units closer — never jump strips.
    // (Ids that wrap past the camera across the span edge leave the set.)
    let shared = 0;
    const za = new Map(a.map((m) => [m.k, m.z]));
    for (const m of b) {
      const prev = za.get(m.k);
      if (prev !== undefined && prev - 10 >= RACING_Z_NEAR - 1e-9) {
        expect(m.z).toBeCloseTo(prev - 10, 9);
        shared++;
      }
    }
    expect(shared).toBeGreaterThan(2);
    // Far-to-near order for overdraw; ids bounded per lap.
    for (let i = 1; i < b.length; i++) expect(b[i]!.z).toBeLessThan(b[i - 1]!.z);
    for (const m of b) expect(m.k).toBeLessThan(RACING_SCENERY_COUNT);
  });

  it('repeats identically every lap with a smooth finish seam', () => {
    const camS = 600;
    const lap1 = worldMarkerSlots(camS, len, RACING_ARROW_COUNT);
    const lap2 = worldMarkerSlots(camS + len, len, RACING_ARROW_COUNT);
    const lap3 = worldMarkerSlots(camS + 2 * len + 0.5, len, RACING_ARROW_COUNT);
    // Same camera-relative lattice every lap: same landmark, same depth.
    expect(lap2).toEqual(lap1);
    expect(lap3).not.toEqual(lap1); // half-unit advance still moves markers
    for (const cam of [1000, 1005, len - 5, len + 3]) {
      const slots = worldMarkerSlots(cam, len, RACING_ARROW_COUNT);
      expect(slots.length).toBeGreaterThan(0);
      for (const m of slots) {
        expect(Number.isInteger(m.k)).toBe(true);
        expect(m.z).toBeGreaterThanOrEqual(RACING_Z_NEAR - 1e-9);
        expect(m.z).toBeLessThanOrEqual(RACING_Z_NEAR + RACING_Z_SPAN + 1e-9);
        expect(markerGate(m.k, 6)).toBeGreaterThanOrEqual(0);
        expect(markerGate(m.k, 6)).toBeLessThan(6);
      }
    }
  });

  it('projects markers through the shared depth law, moving down-screen on approach', () => {
    const track = RACE_CIRCUITS[0]!.track;
    for (const camS of [500, track.length - 5]) {
      const strips = projectRoad(camS + RACING_CAM_BACK, 0, undefined, track);
      const slots = worldMarkerSlots(camS, len, RACING_SCENERY_COUNT);
      let prev: { z: number; y: number; half: number } | null = null;
      for (const m of slots) {
        const proj = projectAtZ(strips, m.z);
        expect(proj).not.toBeNull();
        // On-screen, below the horizon, with positive road width.
        expect(proj!.y).toBeGreaterThan(RACING_HORIZON);
        expect(proj!.y).toBeLessThanOrEqual(INTERNAL_HEIGHT + 1e-6);
        expect(proj!.half).toBeGreaterThan(0);
        // Nearer markers render lower and wider: smooth approach, no pops.
        if (prev !== null && m.z < prev.z) {
          expect(proj!.y).toBeGreaterThan(prev.y);
          expect(proj!.half).toBeGreaterThan(prev.half);
        }
        prev = { z: m.z, y: proj!.y, half: proj!.half };
      }
    }
    // One fixed landmark tracked across camera advance (staying ahead of
    // the near plane so it keeps projecting instead of passing).
    const spacing = len / RACING_SCENERY_COUNT;
    const k = Math.ceil((600 + 20) / spacing);
    const za = k * spacing - 600;
    const zb = k * spacing - 620;
    expect(zb).toBeCloseTo(za - 20, 9);
    const sa = projectRoad(600 + RACING_CAM_BACK, 0, undefined, track);
    const sb = projectRoad(620 + RACING_CAM_BACK, 0, undefined, track);
    const pa = projectAtZ(sa, za)!;
    const pb = projectAtZ(sb, zb)!;
    expect(pb.y).toBeGreaterThan(pa.y);
    expect(pb.half).toBeGreaterThan(pa.half);
  });
});

describe('boost economy', () => {
  it('banks roughly two bursts per full meter, then refuses without phantom burn', () => {
    const race = flatRace();
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 100;
    p.speed = PLAYER_TOP_SPEED;
    p.boost = 1;
    stepRace(race, inputsFor(race, { ...fullGas(), boost: true }), DT);
    expect(p.boostT).toBeGreaterThan(0);
    expect(p.boost).toBeCloseTo(1 - BOOST_COST, 9);
    runSteps(race, 70, fullGas()); // burn (1.1s) ends
    expect(p.boostT).toBe(0);
    stepRace(race, inputsFor(race, { ...fullGas(), boost: true }), DT);
    expect(p.boostT).toBeGreaterThan(0);
    expect(p.boost).toBeCloseTo(1 - 2 * BOOST_COST, 9);
    runSteps(race, 70, fullGas());
    // Third press with ~0 meter: refused, never negative, no phantom burn.
    stepRace(race, inputsFor(race, { ...fullGas(), boost: true }), DT);
    expect(p.boostT).toBe(0);
    expect(p.boost).toBeGreaterThanOrEqual(0);
  });

  it('recovers nothing while burning and takes >10s to earn a burst back', () => {
    const race = flatRace();
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 100;
    p.speed = PLAYER_TOP_SPEED;
    p.boost = BOOST_COST;
    stepRace(race, inputsFor(race, { ...fullGas(), boost: true }), DT);
    expect(p.boost).toBe(0);
    runSteps(race, 60, fullGas()); // still burning: zero recovery
    expect(p.boost).toBe(0);
    runSteps(race, 600, fullGas()); // 10 more seconds past the burn
    expect(p.boost).toBeGreaterThan(0); // delayed trickle resumes…
    expect(p.boost).toBeLessThan(BOOST_COST); // …but a burst takes >10s
  });

  it('grants no pad refill while a manual burn is active', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    const pad = BOOST_PADS[0]!;
    p.boost = 1;
    p.speed = PLAYER_TOP_SPEED;
    p.s = 100;
    stepRace(race, inputsFor(race, { ...fullGas(), boost: true }), DT);
    const banked = p.boost;
    // Cross most of the pad while the manual burn is still active.
    p.s = pad.start - 5;
    p.x = 0;
    p.speed = 80;
    for (let k = 0; k < 60 && p.boostT > 0; k++) {
      stepRace(race, inputsFor(race, fullGas()), DT);
      expect(p.boost).toBeCloseTo(banked, 9);
    }
    expect(p.boostT).toBeGreaterThanOrEqual(0);
  });

  it('never farms charge by sitting, crawling, or reversing on a pad', () => {
    const pad = BOOST_PADS[0]!;
    // Stationary: parked mid-pad for 5 seconds.
    {
      const race = createRace();
      race.countdown = 0;
      const p = race.racers[PLAYER_INDEX]!;
      p.s = pad.start + pad.length / 2;
      p.x = 0;
      p.speed = 0;
      p.boost = 0;
      runSteps(race, 300, idle());
      expect(p.boost).toBe(0);
      expect(p.boostT).toBe(0);
    }
    // Crawling: rolling below PAD_MIN_SPEED across the pad.
    {
      const race = createRace();
      race.countdown = 0;
      const p = race.racers[PLAYER_INDEX]!;
      p.s = pad.start + 5;
      p.x = 0;
      p.speed = 5;
      p.boost = 0;
      runSteps(race, 60, idle());
      expect(p.boost).toBe(0);
      expect(p.boostT).toBe(0);
    }
    // Reversing: backing over the pad from its far end.
    {
      const race = createRace();
      race.countdown = 0;
      const p = race.racers[PLAYER_INDEX]!;
      p.s = pad.start + pad.length - 5;
      p.x = 0;
      p.speed = 0;
      p.boost = 0;
      const reverse: RacerInput = { steer: 0, accel: false, brake: true, boost: false, drift: false };
      runSteps(race, 60, reverse);
      expect(p.speed).toBeLessThan(0);
      expect(p.boost).toBe(0);
      expect(p.boostT).toBe(0);
    }
  });

  it('fires the pad entry kick once: lingering never re-triggers the burn', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    const pad = BOOST_PADS[0]!;
    p.s = pad.start - 10;
    p.x = 0;
    p.speed = 30;
    p.boost = 0;
    runSteps(race, 30, fullGas()); // enter the pad: kick fires
    expect(p.boostT).toBeGreaterThan(0);
    // Wait out the 0.8s kick while still rolling on the long pad.
    let steps = 0;
    while (p.boostT > 0 && steps < 120) {
      stepRace(race, inputsFor(race, fullGas()), DT);
      steps++;
    }
    expect(p.boostT).toBe(0);
    const wrapped = race.circuit.track.wrap(p.s);
    expect(wrapped).toBeGreaterThanOrEqual(pad.start);
    expect(wrapped).toBeLessThanOrEqual(pad.start + pad.length);
    // Lingering on the same pad: no re-kick and no meter refill.
    for (let k = 0; k < 20; k++) {
      stepRace(race, inputsFor(race, fullGas()), DT);
      const w = race.circuit.track.wrap(p.s);
      if (w < pad.start || w > pad.start + pad.length) break;
      expect(p.boostT).toBe(0);
    }
  });

  it('keeps edge/lane trigger integrity at speed', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    const pad = BOOST_PADS[0]!;
    // On the road surface but outside the painted pad lane.
    p.s = pad.start - 5;
    p.x = PAD_HALF_X + 0.5;
    p.speed = 60;
    p.boost = 0;
    runSteps(race, 120, fullGas());
    expect(race.circuit.track.wrap(p.s)).toBeGreaterThan(pad.start + pad.length);
    expect(p.boostT).toBe(0);
    expect(p.boost).toBeLessThan(0.3);
  });

  it('holds AI to the same meter: no burn below cost, burn at cost', () => {
    const mkAI = (boost: number): { race: RaceState; out: RacerInput } => {
      const race = flatRace();
      for (let i = 0; i < race.racers.length; i++) {
        const o = race.racers[i]!;
        o.s = i === 1 ? 200 : -2000 - i * 100;
        o.x = 0;
        o.speed = i === 1 ? 50 : 0;
        o.boost = boost;
        o.boostT = 0;
      }
      return { race, out: aiInputFor(race, 1) };
    };
    // Below one burst: AI asks for nothing (shared stepRace could not burn).
    {
      const { race, out } = mkAI(BOOST_COST - 0.1);
      expect(out.boost).toBe(false);
      const before = race.racers[1]!.boost;
      stepRace(race, race.racers.map((_, i) => (i === 1 ? out : idle())), DT);
      expect(race.racers[1]!.boostT).toBe(0);
      expect(race.racers[1]!.boost).toBeGreaterThanOrEqual(before);
    }
    // Banked burst on clear straight road: AI may spend it like a human.
    {
      const { race, out } = mkAI(0.9);
      expect(out.boost).toBe(true);
      stepRace(race, race.racers.map((_, i) => (i === 1 ? out : idle())), DT);
      expect(race.racers[1]!.boostT).toBeGreaterThan(0);
    }
    expect(PAD_MIN_SPEED).toBeGreaterThan(0);
  });
});
