// Racing milestone-1 tests: pure simulation/track logic, no DOM.
import { describe, expect, it } from 'vitest';
import { LOGICAL_BUTTONS, type LogicalButton } from '@sparkade/shared';
import type { EngineContext, GameInstance, InputSnapshot } from '@sparkade/engine';
import {
  CRAFT_WORLD_W,
  RACING_CAM_BACK,
  RACING_CAM_H,
  RACING_FOCAL,
  RACING_HORIZON,
  RACING_Z_NEAR,
  createRacingGame,
  projectAtZ,
  projectRoad,
  turnCueAt,
  type RacingDevHandle,
} from '../src/racing/game';
import {
  BARRIER_X,
  BOOST_PADS,
  CHECKPOINT_FRACTIONS,
  PAD_HALF_X,
  RACE_CIRCUITS,
  ROAD_HALF,
  TRACK_LENGTH,
  compileTrack,
  compileTrackVariant,
  curvatureAt,
  padAt,
  pointAt,
  tangentAt,
  trackOutlinePoints,
  wrapS,
} from '../src/racing/track';
import {
  PLAYER_INDEX,
  PLAYER_TOP_SPEED,
  RACE_LAPS,
  aiInputFor,
  createRace,
  playerResult,
  racePosition,
  restartRace,
  stepRace,
  type RaceState,
  type RacerInput,
} from '../src/racing/simulation';

const DT = 1 / 60;

function idle(): RacerInput {
  return { steer: 0, accel: false, brake: false, boost: false, drift: false };
}

function fullGas(): RacerInput {
  return { steer: 0, accel: true, brake: false, boost: false, drift: false };
}

/** Simple center-seeking driver used to prove laps are finishable. */
function autoDrive(race: RaceState, i: number): RacerInput {
  const r = race.racers[i]!;
  const steer = Math.max(-1, Math.min(1, -r.x * 0.6));
  return { steer, accel: true, brake: false, boost: false, drift: false };
}

function inputsFor(race: RaceState, player: RacerInput): RacerInput[] {
  return race.racers.map((_, i) => (i === PLAYER_INDEX ? player : aiInputFor(race, i)));
}

function testSnapshot(press?: LogicalButton): InputSnapshot {
  const input = {} as InputSnapshot;
  for (const button of LOGICAL_BUTTONS) {
    input[button] = { held: false, pressed: false, released: false };
  }
  if (press) input[press] = { held: true, pressed: true, released: false };
  return input;
}

function runSteps(race: RaceState, n: number, player: RacerInput | ((r: RaceState) => RacerInput)): void {
  for (let k = 0; k < n; k++) {
    const p = typeof player === 'function' ? player(race) : player;
    stepRace(race, inputsFor(race, p), DT);
  }
}

describe('racing track invariants', () => {
  it('compiles to the target length', () => {
    expect(TRACK_LENGTH).toBeGreaterThan(1000);
    expect(TRACK_LENGTH).toBeCloseTo(3400, -2);
  });

  it('spaces arc-length samples uniformly, including across the seam', () => {
    const n = 200;
    const ds: number[] = [];
    let prev = pointAt(0);
    for (let k = 1; k <= n; k++) {
      const p = pointAt((k / n) * TRACK_LENGTH);
      ds.push(Math.hypot(p.x - prev.x, p.y - prev.y));
      prev = p;
    }
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
    for (const d of ds) {
      expect(d / mean).toBeGreaterThan(0.9);
      expect(d / mean).toBeLessThan(1.1);
    }
  });

  it('keeps tangent direction continuous, including across the seam', () => {
    const n = 256;
    const step = TRACK_LENGTH / n;
    let worst = 0;
    for (let k = 0; k < n; k++) {
      const a = tangentAt(k * step);
      const b = tangentAt((k + 1) * step);
      const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
      worst = Math.max(worst, Math.acos(dot));
    }
    // Adjacent tangents ~13 units apart rotate smoothly even through the
    // tight hairpin (~0.42 rad); a kink or seam tear would jump past ~1 rad.
    expect(worst).toBeLessThan(0.6);
  });

  it('accumulates one full clockwise turn per lap', () => {
    const n = 512;
    let total = 0;
    let prevA = Math.atan2(tangentAt(0).x, -tangentAt(0).y);
    for (let k = 1; k <= n; k++) {
      const t = tangentAt((k / n) * TRACK_LENGTH);
      const a = Math.atan2(t.x, -t.y);
      let d = a - prevA;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      total += d;
      prevA = a;
    }
    expect(total).toBeCloseTo(Math.PI * 2, 1);
  });

  it('keeps curvature bounded for stable projection', () => {
    for (let s = 0; s < TRACK_LENGTH; s += 25) {
      expect(Math.abs(curvatureAt(s))).toBeLessThan(0.02);
    }
  });

  it('sits boost pads on low-curvature straights', () => {
    for (const pad of BOOST_PADS) {
      for (let k = 0; k <= pad.length; k += 15) {
        expect(Math.abs(curvatureAt(pad.start + k))).toBeLessThan(0.004);
      }
    }
  });

  it('compiles independent templates with the same guarantees', () => {
    const oval = compileTrack(
      [
        { x: 500, y: 0 },
        { x: 0, y: 300 },
        { x: -500, y: 0 },
        { x: 0, y: -300 },
      ],
      2000,
    );
    expect(oval.length).toBeCloseTo(2000, -1);
    const a = oval.pointAt(0);
    const b = oval.pointAt(oval.length);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
  });

  it('places boost pads on the circuit in driving order', () => {
    expect(BOOST_PADS.length).toBeGreaterThanOrEqual(1);
    let prev = -1;
    for (const pad of BOOST_PADS) {
      expect(pad.start).toBeGreaterThan(prev);
      expect(pad.start + pad.length).toBeLessThan(TRACK_LENGTH);
      expect(padAt(pad.start + pad.length / 2)).not.toBeNull();
      prev = pad.start;
    }
  });

  it('produces a closed minimap outline', () => {
    const pts = trackOutlinePoints(60);
    expect(pts.length).toBe(61);
    expect(pts[0]).toEqual(pts[60]);
  });

  it('barriers sit outside the road surface', () => {
    expect(BARRIER_X).toBeGreaterThan(ROAD_HALF);
  });
});

describe('racing lap and checkpoint integrity', () => {
  it('banks a lap after passing every checkpoint in order', () => {
    const race = createRace();
    race.countdown = 0;
    runSteps(race, 60 * 150, (r) => autoDrive(r, PLAYER_INDEX));
    const p = race.racers[PLAYER_INDEX]!;
    expect(p.lap).toBeGreaterThanOrEqual(1);
    expect(p.lapTimes.length).toBe(p.lap);
    expect(p.nextCp).toBeLessThanOrEqual(CHECKPOINT_FRACTIONS.length);
  });

  it('cannot be fooled by crossing the finish without checkpoints', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.s = TRACK_LENGTH - 20;
    p.x = 0;
    p.speed = 80;
    p.nextCp = 0;
    runSteps(race, 60, fullGas());
    expect(p.lap).toBe(0);
    expect(p.nextCp).toBe(0);
  });

  it('cannot be fooled by reversing over the finish line', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 10;
    p.x = 0;
    p.speed = 0;
    for (let k = 0; k < 240; k++) {
      stepRace(race, inputsFor(race, { ...idle(), brake: true }), DT);
    }
    expect(wrapS(p.s)).toBeGreaterThan(TRACK_LENGTH / 2);
    expect(p.lap).toBe(0);
    expect(p.nextCp).toBe(0);
  });

  it('steps the gate back when reversing over a checkpoint', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.s = CHECKPOINT_FRACTIONS[0] * TRACK_LENGTH - 5;
    p.x = 0;
    p.speed = 40;
    runSteps(race, 30, fullGas());
    expect(p.nextCp).toBe(1);
    for (let k = 0; k < 240; k++) {
      stepRace(race, inputsFor(race, { ...idle(), brake: true }), DT);
      if (p.nextCp === 0) break;
    }
    expect(p.nextCp).toBe(0);
    expect(p.lap).toBe(0);
  });
});

describe('racing boost resource', () => {
  it('burns meter for a top-speed boost on manual trigger', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 100;
    p.speed = PLAYER_TOP_SPEED;
    const before = p.boost;
    stepRace(race, inputsFor(race, { ...fullGas(), boost: true }), DT);
    expect(p.boostT).toBeGreaterThan(0);
    expect(p.boost).toBeLessThan(before);
    runSteps(race, 30, fullGas());
    expect(p.speed).toBeGreaterThan(PLAYER_TOP_SPEED);
  });

  it('refuses boost below cost and never goes negative', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.boost = 0.1;
    stepRace(race, inputsFor(race, { ...fullGas(), boost: true }), DT);
    expect(p.boostT).toBe(0);
    expect(p.boost).toBeGreaterThanOrEqual(0);
  });

  it('regenerates meter over time', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.boost = 0;
    p.s = 1000; // away from pads
    p.speed = 40;
    runSteps(race, 600, fullGas());
    expect(p.boost).toBeGreaterThan(0);
  });

  it('boost pads trigger one free entry burn and no dwell refill', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    const pad = BOOST_PADS[0]!;
    p.s = pad.start - 10;
    p.x = 0;
    p.speed = 60;
    p.boost = 0;
    runSteps(race, 20, fullGas());
    expect(p.boostT).toBeGreaterThan(0);
    // Ride out the kick and the recovery delay: dwelling on the pad banks
    // nothing beyond the slow post-delay trickle (a few thousandths here).
    runSteps(race, 60, fullGas());
    expect(p.boostT).toBe(0);
    expect(p.boost).toBeLessThan(0.05);
  });
});

describe('racing AI and race rules', () => {
  it('AI makes real gated progress without teleporting', () => {
    const race = createRace();
    race.countdown = 0;
    const startS = race.racers.map((r) => r!.s);
    let maxStep = 0;
    for (let k = 0; k < 60 * 30; k++) {
      const before = race.racers.map((r) => r!.s);
      stepRace(
        race,
        race.racers.map((_, i) => (i === PLAYER_INDEX ? idle() : aiInputFor(race, i))),
        DT,
      );
      for (let i = 0; i < race.racers.length; i++) {
        maxStep = Math.max(maxStep, Math.abs(race.racers[i]!.s - before[i]!));
      }
    }
    for (let i = 1; i < race.racers.length; i++) {
      expect(race.racers[i]!.s - startS[i]!).toBeGreaterThan(500);
    }
    // No step may exceed the fastest physically possible distance.
    expect(maxStep).toBeLessThanOrEqual(((128 + 20) * DT) + 1e-6);
  });

  it('AI obeys the same speed limits as the player', () => {
    const race = createRace();
    race.countdown = 0;
    for (let k = 0; k < 60 * 60; k++) {
      stepRace(
        race,
        race.racers.map((_, i) => (i === PLAYER_INDEX ? idle() : aiInputFor(race, i))),
        DT,
      );
      for (const r of race.racers) {
        expect(r.speed).toBeLessThanOrEqual(128 + 20 + 1e-6);
        expect(r.speed).toBeGreaterThanOrEqual(-12 - 1e-6);
        expect(Math.abs(r.x)).toBeLessThanOrEqual(BARRIER_X + 1e-6);
      }
    }
  });

  it('offroad craft are slower than on-road craft', () => {
    const race = createRace();
    race.countdown = 0;
    const on = race.racers[1]!;
    const off = race.racers[2]!;
    on.s = 100;
    on.x = 0;
    on.speed = 70;
    off.s = 100;
    off.x = ROAD_HALF + 1;
    off.speed = 70;
    // Straight-line gas for everyone (no AI steering) to isolate surfaces.
    // Flat control: the real track's bends would shove the on-road craft.
    race.circuit = { ...race.circuit, track: { ...race.circuit.track, curvatureAt: () => 0 } };
    const gas: RacerInput = { steer: 0, accel: true, brake: false, boost: false, drift: false };
    for (let k = 0; k < 300; k++) {
      stepRace(
        race,
        race.racers.map(() => ({ ...gas })),
        DT,
      );
    }
    expect(off.offroad).toBe(true);
    expect(on.offroad).toBe(false);
    expect(off.speed).toBeLessThan(on.speed);
  });

  it('ranks racers by lap, then gates, then sector distance', () => {
    const race = createRace();
    race.countdown = 0;
    const [a, b] = [race.racers[0]!, race.racers[1]!];
    a.s = 500;
    a.gateS = 0;
    b.s = 400;
    b.gateS = 0;
    a.lap = 0;
    b.lap = 0;
    a.nextCp = 0;
    b.nextCp = 0;
    for (let i = 2; i < race.racers.length; i++) {
      race.racers[i]!.s = -100;
      race.racers[i]!.gateS = -100;
    }
    expect(racePosition(race, 0)).toBe(1);
    expect(racePosition(race, 1)).toBe(2);
    b.lap = 1;
    expect(racePosition(race, 1)).toBe(1);
  });

  it('honors locked finish order over post-line overshoot', () => {
    const race = createRace();
    race.countdown = 0;
    const [a, b, c] = [race.racers[0]!, race.racers[1]!, race.racers[2]!];
    // a finished first, b finished second with MORE crossing overshoot (the
    // old progress ranking put b ahead and showed POS 1/5 for P2).
    a.finished = true;
    a.place = 0;
    a.finishT = 100;
    a.s = 50;
    b.finished = true;
    b.place = 1;
    b.finishT = 100.06;
    b.s = 5000;
    // c never finished but sits far up the road.
    c.finished = false;
    c.lap = 2;
    c.s = 9000;
    c.gateS = 8900;
    for (const r of race.racers.slice(3)) {
      r.s = -100;
      r.gateS = -100;
    }
    expect(racePosition(race, 0)).toBe(1);
    expect(racePosition(race, 1)).toBe(2);
    expect(racePosition(race, 2)).toBe(3);
  });

  it('finishes after the final lap and restarts cleanly', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.lap = RACE_LAPS - 1;
    p.nextCp = CHECKPOINT_FRACTIONS.length; // armed
    p.s = TRACK_LENGTH - 30;
    p.x = 0;
    p.speed = 70;
    runSteps(race, 120, fullGas());
    expect(p.finished).toBe(true);
    expect(race.over).toBe(true);
    const res = playerResult(race);
    expect(res).not.toBeNull();
    expect(res!.place).toBeGreaterThanOrEqual(1);
    restartRace(race);
    expect(race.over).toBe(false);
    expect(race.t).toBe(0);
    expect(race.countdown).toBeGreaterThan(0);
    expect(playerResult(race)).toBeNull();
    for (const r of race.racers) {
      expect(r.lap).toBe(0);
      expect(r.finished).toBe(false);
      expect(r.nextCp).toBe(0);
    }
  });
});

describe('racing game shell', () => {
  it('runs update+render frames without throwing and reports HUD', () => {
    const gradient = { addColorStop: () => undefined };
    const ctx = new Proxy(
      {},
      {
        get: (_t, p) => {
          if (p === 'createLinearGradient') return () => gradient;
          return (..._args: unknown[]) => undefined;
        },
        set: () => true,
      },
    );
    const engine = { renderer: { ctx } } as unknown as EngineContext;
    const game = createRacingGame(engine);
    game.start();
    for (let f = 0; f < 60 * 30; f++) {
      const input = testSnapshot(f % 300 === 0 ? 'A' : undefined);
      input.B.held = true;
      input.LEFT.held = f % 240 < 120;
      input.RIGHT.held = !input.LEFT.held;
      game.update(DT, input);
      game.render();
    }
    expect(game.hud.score).toBeGreaterThanOrEqual(0);
    expect(game.hud.mechanic?.label).toBe('BOOST');
    game.restart();
    expect(game.result).toBeNull();
    game.dispose();
  });
});

describe('racing depth projection', () => {
  it('runs broad foreground to narrow distance, monotonically', () => {
    const strips = projectRoad(0, 0);
    expect(strips.length).toBeGreaterThan(10);
    for (let i = 1; i < strips.length; i++) {
      expect(strips[i]!.half).toBeLessThan(strips[i - 1]!.half);
      expect(strips[i]!.y).toBeLessThan(strips[i - 1]!.y);
      expect(strips[i]!.ppu).toBeLessThan(strips[i - 1]!.ppu);
      expect(strips[i]!.z).toBeGreaterThan(strips[i - 1]!.z);
    }
    // Broad foreground, narrow horizon: near half > 100px, far half < 20px.
    expect(strips[0]!.half).toBeGreaterThan(100);
    expect(strips[strips.length - 1]!.half).toBeLessThan(20);
    // Bottom of screen converging near the horizon.
    expect(strips[0]!.y).toBeCloseTo(300, 6);
    expect(strips[strips.length - 1]!.y).toBeGreaterThanOrEqual(RACING_HORIZON);
    expect(strips[strips.length - 1]!.y).toBeLessThan(RACING_HORIZON + 10);
  });

  it('derives width and height from one pinhole scale', () => {
    const strips = projectRoad(500, 0.5);
    for (const s of strips) {
      const scale = RACING_FOCAL / s.z;
      // Lateral and vertical laws share the single FOCAL/z depth law.
      expect(s.ppu).toBeCloseTo(scale, 10);
      expect(s.half).toBeCloseTo(ROAD_HALF * scale, 10);
      expect(s.y).toBeCloseTo(RACING_HORIZON + RACING_CAM_H * RACING_FOCAL / s.z, 10);
    }
  });

  it('draws the player at readable size on a multi-craft-wide road', () => {
    const strips = projectRoad(500, 0);
    const player = projectAtZ(strips, RACING_CAM_BACK)!;
    expect(player).not.toBeNull();
    // ~104 display px at 2x: readable SNES hovercraft silhouette.
    const w = CRAFT_WORLD_W * player.ppu;
    expect(w).toBeGreaterThan(40);
    expect(w).toBeLessThan(65);
    // Road is about five craft widths wide at the player.
    expect((player.half * 2) / w).toBeCloseTo((ROAD_HALF * 2) / CRAFT_WORLD_W, 3);
    // Real road shows under the craft: player ground sits above the bottom.
    expect(player.y).toBeLessThan(strips[0]!.y - 10);
  });

  it('scales same-world-size craft exactly like the road', () => {
    const strips = projectRoad(500, 0);
    const near = projectAtZ(strips, RACING_CAM_BACK)!;
    const far = projectAtZ(strips, RACING_CAM_BACK + 120)!;
    const craftNear = CRAFT_WORLD_W * near.ppu;
    const craftFar = CRAFT_WORLD_W * far.ppu;
    // Craft pixel ratio must equal road half-width ratio (one projection).
    expect(craftNear / craftFar).toBeCloseTo(near.half / far.half, 6);
    expect(craftFar).toBeLessThan(20);
  });

  it('culls depths outside the visible strips', () => {
    const strips = projectRoad(0, 0);
    expect(projectAtZ(strips, RACING_Z_NEAR - 1)).toBeNull();
    expect(projectAtZ(strips, RACING_Z_NEAR + 5000)).toBeNull();
    expect(projectAtZ(strips, RACING_CAM_BACK)).not.toBeNull();
  });

  it('interpolates craft depths within pixels of the analytic curve', () => {
    const strips = projectRoad(500, 0);
    for (const z of [RACING_CAM_BACK, 14, 30, 80, 200]) {
      const proj = projectAtZ(strips, z)!;
      expect(proj).not.toBeNull();
      // Dense near-camera strips keep linear interpolation honest.
      expect(Math.abs(proj.ppu - RACING_FOCAL / z) / (RACING_FOCAL / z)).toBeLessThan(0.05);
      expect(
        Math.abs(proj.y - (RACING_HORIZON + (RACING_CAM_H * RACING_FOCAL) / z)),
      ).toBeLessThan(1.5);
    }
  });

  it('reuses the provided strip buffer without allocating', () => {
    const buf = projectRoad(0, 0);
    const again = projectRoad(700, 1.5, buf);
    expect(again).toBe(buf);
    expect(buf[0]!.cx).not.toBe(projectRoad(0, 0)[0]!.cx);
  });
});

describe('racing physics corrections', () => {
  it('does not slide sideways while stationary', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 100;
    p.x = 0.5;
    p.speed = 0;
    for (let k = 0; k < 60; k++) {
      stepRace(race, inputsFor(race, { ...idle(), steer: 1 }), DT);
    }
    expect(p.x).toBeCloseTo(0.5, 10);
  });

  it('pushes outward on right curves (positive curve drives -x)', () => {
    const race = createRace();
    race.countdown = 0;
    // Find a sustained right-hand curve, clear of the launch grid slots.
    let s = 0;
    for (let c = 500; c < TRACK_LENGTH; c += 10) {
      if (curvatureAt(c) > 0.002) {
        s = c;
        break;
      }
    }
    expect(curvatureAt(s)).toBeGreaterThan(0.002);
    const p = race.racers[PLAYER_INDEX]!;
    p.s = s;
    p.x = 0;
    p.speed = 70;
    stepRace(race, inputsFor(race, idle()), DT);
    expect(p.x).toBeLessThan(0);
  });

  it('caps manual boost below road pace while offroad', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 100;
    p.x = ROAD_HALF + 1;
    p.speed = 40;
    p.boost = 1;
    stepRace(race, inputsFor(race, { ...fullGas(), boost: true }), DT);
    expect(p.boostT).toBeGreaterThan(0);
    for (let k = 0; k < 600; k++) {
      stepRace(race, inputsFor(race, { ...fullGas(), boost: k === 300 }), DT);
    }
    expect(p.speed).toBeLessThan(65);
  });

  it('denies boost pads to offroad drivers', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    const pad = BOOST_PADS[0]!;
    p.s = pad.start - 10;
    p.x = ROAD_HALF + 1;
    p.speed = 50;
    p.boost = 0;
    // Flat control: bend shove must not carry the offroad driver into the lane.
    race.circuit = { ...race.circuit, track: { ...race.circuit.track, curvatureAt: () => 0 } };
    for (let frame = 0; frame < 600 && p.s <= pad.start + pad.length; frame++) {
      runSteps(race, 1, fullGas());
    }
    expect(wrapS(p.s)).toBeGreaterThan(pad.start + pad.length);
    expect(p.boostT).toBe(0);
    expect(p.boost).toBeLessThan(0.3);
  });

  it('freezes the clock and craft once the race is over', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.lap = RACE_LAPS - 1;
    p.nextCp = CHECKPOINT_FRACTIONS.length;
    p.s = TRACK_LENGTH - 30;
    p.x = 0;
    p.speed = 70;
    runSteps(race, 120, fullGas());
    expect(race.over).toBe(true);
    const t = race.t;
    const speeds = race.racers.map((r) => r!.speed);
    runSteps(race, 60, fullGas());
    expect(race.t).toBe(t);
    expect(race.racers.map((r) => r!.speed)).toEqual(speeds);
  });
});

describe('racing contact and overtaking', () => {
  it('shoves overlapping craft apart instead of passing through', () => {
    const race = createRace();
    race.countdown = 0;
    race.circuit = { ...race.circuit, pads: [], track: { ...race.circuit.track, curvatureAt: () => 0 } };
    const a = race.racers[1]!;
    const b = race.racers[2]!;
    a.s = 500;
    b.s = 501;
    a.x = -0.2;
    b.x = 0.2;
    a.speed = 60;
    b.speed = 60;
    const gas: RacerInput = { steer: 0, accel: true, brake: false, boost: false, drift: false };
    for (let k = 0; k < 60; k++) {
      stepRace(
        race,
        race.racers.map(() => ({ ...gas })),
        DT,
      );
    }
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(0.8);
    // No teleport: longitudinal order preserved, gap bounded.
    expect(Math.abs(a.s - b.s)).toBeLessThan(30);
  });

  it('steers AI around slower traffic on straights', () => {
    const race = createRace();
    race.countdown = 0;
    const slow = race.racers[0]!;
    const ai = race.racers[1]!;
    slow.s = 1050;
    slow.x = 0;
    slow.speed = 20;
    ai.s = 1000;
    ai.x = 0;
    ai.speed = 60;
    const input = aiInputFor(race, 1);
    expect(Math.abs(input.steer)).toBeGreaterThan(0.2);
  });

  it('writes AI input into a reusable buffer when provided', () => {
    const race = createRace();
    race.countdown = 0;
    const buf: RacerInput = { steer: 0, accel: false, brake: false, boost: false, drift: false };
    const out = aiInputFor(race, 2, buf);
    expect(out).toBe(buf);
    expect(typeof buf.steer).toBe('number');
  });

  it('plans deterministically: repeated calls agree exactly', () => {
    const race = createRace();
    race.countdown = 0;
    for (let i = 0; i < race.racers.length; i++) {
      const a = aiInputFor(race, i);
      const b = aiInputFor(race, i);
      expect(b).toEqual(a);
    }
  });
});

describe('racing rival spacing', () => {
  /** Park uninvolved rivals far off-track so the scenario pair is isolated. */
  function isolate(race: RaceState, keep: number[]): void {
    for (let i = 0; i < race.racers.length; i++) {
      if (keep.includes(i)) continue;
      const o = race.racers[i]!;
      o.s = -2000 - i * 100;
      o.x = 0;
      o.speed = 0;
    }
  }

  const gas: RacerInput = { steer: 0, accel: true, brake: false, boost: false, drift: false };

  it('completes a clean pass on slower traffic with brief contact', () => {
    const race = createRace();
    race.countdown = 0;
    // Isolate passing from the circuit's bends and boost pads. Full-cup
    // tests separately exercise the controller on the real geometry.
    race.circuit = {
      ...race.circuit,
      pads: [],
      track: { ...race.circuit.track, curvatureAt: () => 0 },
    };
    isolate(race, [1, 2]);
    const leader = race.racers[1]!;
    const chaser = race.racers[2]!;
    // The pace delta (top 80 vs 56) leaves enough room for a clean pass.
    leader.s = 120;
    leader.x = 0;
    leader.speed = 50;
    leader.topScale = 0.7;
    chaser.s = 70;
    chaser.x = 0;
    chaser.speed = 70;
    chaser.topScale = 1;
    let contactFrames = 0;
    let sideFlips = 0;
    let lastSide = 0;
    let committed = false;
    for (let k = 0; k < 60 * 25 && chaser.s - leader.s < 10; k++) {
      const inputs = race.racers.map((_, i) => (i === 2 ? aiInputFor(race, i) : { ...gas }));
      stepRace(race, inputs, DT);
      if (Math.abs(chaser.s - leader.s) < 6 && Math.abs(chaser.x - leader.x) < 1.7) contactFrames++;
      const dx = chaser.x - leader.x;
      if (Math.abs(dx) >= 1.2) {
        const side = Math.sign(dx);
        if (committed && side !== lastSide) sideFlips++;
        committed = true;
        lastSide = side;
      }
    }
    // The pass completes: chaser pulls 10 units clear of the leader.
    expect(chaser.s - leader.s).toBeGreaterThanOrEqual(10);
    // Committed side never chatters mid-pass.
    expect(sideFlips).toBe(0);
    // Contact is a brief brush, not chronic bunching.
    expect(contactFrames).toBeLessThan(60);
  });

  it('follows with a lift when the pass lane is blocked', () => {
    const race = createRace();
    race.countdown = 0;
    // Flat control plus blockers on BOTH escape lanes: the chaser is truly
    // boxed in, so lifting (not bend shove or a free lane) is what is measured.
    race.circuit = { ...race.circuit, track: { ...race.circuit.track, curvatureAt: () => 0 } };
    isolate(race, [0, 1, 2, 3, 4]);
    // Same-lane wall ahead: leader, mid, and lane-blockers holding both
    // escape lanes between chaser and mid. Top scales cruise the wall
    // at ~56 while the chaser arrives at full pace.
    const leader = race.racers[0]!;
    const mid = race.racers[1]!;
    const chaser = race.racers[2]!;
    const laneBlocker = race.racers[3]!;
    const laneBlocker2 = race.racers[4]!;
    leader.s = 1000;
    leader.x = 0;
    leader.speed = 50;
    leader.topScale = 0.7;
    mid.s = 970;
    mid.x = 0;
    mid.speed = 50;
    mid.topScale = 0.72;
    laneBlocker.s = 978;
    laneBlocker.x = -1.9;
    laneBlocker.speed = 50;
    laneBlocker.topScale = 0.72;
    laneBlocker2.s = 978;
    laneBlocker2.x = 1.9;
    laneBlocker2.speed = 50;
    laneBlocker2.topScale = 0.72;
    chaser.s = 940;
    chaser.x = 0;
    chaser.speed = 60;
    chaser.topScale = 1;
    let lifted = false;
    for (let k = 0; k < 60 * 10; k++) {
      const inputs = race.racers.map((_, i) => (i === 2 ? aiInputFor(race, i) : { ...gas }));
      stepRace(race, inputs, DT);
      if (!inputs[2]!.accel) lifted = true;
    }
    // Boxed in, the chaser lifts at least once instead of ramming through,
    // and stays behind the leader for the window (no teleport past).
    expect(lifted).toBe(true);
    expect(chaser.s).toBeLessThan(leader.s);
  });
});

describe('racing progressive steering', () => {
  function speeding(): RaceState {
    const race = createRace();
    // Isolate steering from road curvature, pads, and opponent contact.
    race.circuit = { ...race.circuit, pads: [], track: { ...race.circuit.track, curvatureAt: () => 0 } };
    for (const r of race.racers.slice(1)) r.finished = true;
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 100;
    p.x = 0;
    p.speed = PLAYER_TOP_SPEED;
    return race;
  }

  it('nudges on a brief tap instead of crossing the road', () => {
    const race = speeding();
    const p = race.racers[PLAYER_INDEX]!;
    for (let k = 0; k < 6; k++) {
      stepRace(race, inputsFor(race, { ...fullGas(), steer: 1 }), DT);
    }
    // Six frames (0.1s) at top speed moves a fraction of the road, and the
    // smoothed position has visibly ramped without reaching full lock.
    expect(Math.abs(p.x)).toBeLessThan(0.6);
    expect(p.steerPos).toBeGreaterThan(0);
    expect(p.steerPos).toBeLessThan(1);
  });

  it('reaches full lock on a held press and returns on release', () => {
    const race = speeding();
    const p = race.racers[PLAYER_INDEX]!;
    for (let k = 0; k < 120; k++) {
      stepRace(race, inputsFor(race, { ...fullGas(), steer: 1 }), DT);
    }
    // Held steering is still effective: most of the road crossed, clamped
    // at the barrier rather than unbounded.
    expect(Math.abs(p.x)).toBeGreaterThan(2);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(BARRIER_X + 1e-6);
    for (let k = 0; k < 60; k++) {
      stepRace(race, inputsFor(race, fullGas()), DT);
    }
    expect(p.steerPos).toBeCloseTo(0, 2);
  });
});

describe('racing contact closing speed', () => {
  /** Drag-only single-step factor, so contact scrub is isolated. */
  const DRAG_F = 1 - 0.28 * DT;

  function pair(aS: number, aV: number, bS: number, bV: number): RaceState {
    const race = createRace();
    race.countdown = 0;
    const a = race.racers[1]!;
    const b = race.racers[2]!;
    a.s = aS;
    a.x = 0;
    a.speed = aV;
    b.s = bS;
    b.x = 0;
    b.speed = bV;
    // Park the rest far away so the pair is isolated.
    for (const i of [0, 3, 4]) {
      const o = race.racers[i]!;
      o.s = -2000 - i * 50;
      o.x = 0;
      o.speed = 0;
    }
    return race;
  }

  function stepIdle(race: RaceState): void {
    stepRace(
      race,
      race.racers.map(() => ({ ...idle() })),
      DT,
    );
  }

  it('slows the faster rear craft while approaching', () => {
    const race = pair(500, 40, 497, 70);
    stepIdle(race);
    const a = race.racers[1]!;
    const b = race.racers[2]!;
    // Rear craft loses speed beyond drag; the slower front craft does not.
    expect(b.speed).toBeLessThan(70 * DRAG_F - 0.3);
    expect(a.speed).toBeCloseTo(40 * DRAG_F, 1);
  });

  it('ignores separating craft', () => {
    const race = pair(500, 70, 497, 40);
    stepIdle(race);
    const a = race.racers[1]!;
    const b = race.racers[2]!;
    // A faster front craft pulling away scrubs nothing: drag only.
    expect(a.speed).toBeCloseTo(70 * DRAG_F, 1);
    expect(b.speed).toBeCloseTo(40 * DRAG_F, 1);
  });

  it('behaves symmetrically when the pair order swaps', () => {
    // Same approach as the first test, but the faster rear craft is index 1.
    const race = pair(497, 70, 500, 40);
    stepIdle(race);
    const a = race.racers[1]!;
    const b = race.racers[2]!;
    expect(a.speed).toBeLessThan(70 * DRAG_F - 0.3);
    expect(b.speed).toBeCloseTo(40 * DRAG_F, 1);
  });
});

describe('racing pad lane alignment', () => {
  it('only triggers pads inside the painted lane', () => {
    const pad = BOOST_PADS[0]!;
    expect(PAD_HALF_X).toBeLessThan(ROAD_HALF);
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.s = pad.start - 5;
    p.x = ROAD_HALF - 0.5; // on the road surface, outside the pad lane
    // Flat control: bend shove must not carry the edge driver into the lane.
    race.circuit = { ...race.circuit, track: { ...race.circuit.track, curvatureAt: () => 0 } };
    p.speed = 60;
    p.boost = 0;
    runSteps(race, 30, fullGas());
    expect(wrapS(p.s)).toBeGreaterThan(pad.start);
    expect(p.boostT).toBe(0);
    expect(p.boost).toBeLessThan(0.3);
  });
});

describe('racing dev diagnostics', () => {
  type DevGame = GameInstance & RacingDevHandle;
  function devGame(): DevGame {
    const gradient = { addColorStop: () => undefined };
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'createLinearGradient') return () => gradient;
          return (..._args: unknown[]) => undefined;
        },
        set: () => true,
      },
    );
    const engine = { renderer: { ctx } } as unknown as EngineContext;
    return createRacingGame(engine) as DevGame;
  }

  it('exposes a snapshot plus reset/autopilot without globals', () => {
    const game = devGame();
    expect(game.racingDev).toBeDefined();
    const s0 = game.racingDev.snapshot();
    expect(s0.fps).toBeGreaterThan(0);
    expect(s0.player.pos).toBeGreaterThanOrEqual(1);
    expect(s0.player.pos).toBeLessThanOrEqual(5);
    expect(s0.autopilot).toBe(false);
    game.racingDev.setAutopilot(true);
    expect(game.racingDev.snapshot().autopilot).toBe(true);
    // Autopilot drives the player with no button input at all.
    for (let f = 0; f < 180; f++) {
      game.update(DT, testSnapshot());
      game.render();
    }
    const s1 = game.racingDev.snapshot();
    expect(s1.player.speed).toBeGreaterThan(5);
    expect(s1.t).toBeGreaterThan(1);
    game.racingDev.reset();
    expect(game.racingDev.snapshot().t).toBe(0);
    game.dispose();
  });

  it('renders byte-identical frames while the race clock is frozen', () => {
    const log: string[] = [];
    const gradient = {
      addColorStop: (a: string, b: string) => {
        log.push(`grad:${a}:${b}`);
      },
    };
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'createLinearGradient') {
            return (...args: unknown[]) => {
              log.push(`linear:${JSON.stringify(args)}`);
              return gradient;
            };
          }
          return (...args: unknown[]) => {
            log.push(`${String(prop)}:${JSON.stringify(args)}`);
          };
        },
        set: (_t, prop, value) => {
          log.push(`set:${String(prop)}:${JSON.stringify(value)}`);
          return true;
        },
      },
    );
    const engine = { renderer: { ctx } } as unknown as EngineContext;
    const game = createRacingGame(engine) as DevGame;
    game.racingDev.setAutopilot(true);
    for (let f = 0; f < 120; f++) game.update(DT, testSnapshot());
    // Frozen clock (no update between renders, as under host pause).
    log.length = 0;
    game.render();
    const first = [...log];
    log.length = 0;
    game.render();
    expect(log).toEqual(first);
    expect(first.length).toBeGreaterThan(100);
    game.dispose();
  });

  it('exposes handling telemetry for host playtests', () => {
    const game = devGame();
    game.racingDev.setAutopilot(true);
    for (let f = 0; f < 600; f++) {
      game.update(DT, testSnapshot());
      if (f % 10 === 0) game.render();
    }
    const s = game.racingDev.snapshot();
    expect(typeof s.player.steerPos).toBe('number');
    expect(s.player.steerPos).toBeGreaterThanOrEqual(-1);
    expect(s.player.steerPos).toBeLessThanOrEqual(1);
    expect(typeof s.player.drifting).toBe('boolean');
    game.dispose();
  });
});

describe('racing driving feel', () => {
  function speeding(flat = false): RaceState {
    const race = createRace();
    race.countdown = 0;
    if (flat) {
      // Flat control: tap/drag fixtures measure steering, not bend shove.
      race.circuit = { ...race.circuit, track: { ...race.circuit.track, curvatureAt: () => 0 } };
    }
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 100;
    p.x = 0;
    p.speed = PLAYER_TOP_SPEED;
    return race;
  }

  it('makes brief taps useful: a 5-frame tap nudges without crossing the road', () => {
    const race = speeding(true);
    const p = race.racers[PLAYER_INDEX]!;
    for (let k = 0; k < 5; k++) {
      stepRace(race, inputsFor(race, { ...fullGas(), steer: 1 }), DT);
    }
    // A useful nudge: clearly off-center, nowhere near the barrier.
    expect(Math.abs(p.x)).toBeGreaterThan(0.08);
    expect(Math.abs(p.x)).toBeLessThan(0.8);
    expect(p.steerPos).toBeGreaterThan(0);
    expect(p.steerPos).toBeLessThan(1);
  });

  it('keeps held steering predictable and deterministic', () => {
    const drive = (): number => {
      const race = speeding(true);
      const p = race.racers[PLAYER_INDEX]!;
      for (let k = 0; k < 120; k++) {
        stepRace(race, inputsFor(race, { ...fullGas(), steer: 1 }), DT);
      }
      return p.x;
    };
    const a = drive();
    const b = drive();
    expect(a).toBe(b);
    // Held lock is effective: most of the road crossed, clamped at worst.
    expect(Math.abs(a)).toBeGreaterThan(2);
    expect(Math.abs(a)).toBeLessThanOrEqual(BARRIER_X + 1e-6);
  });

  it('recovers promptly on countersteer', () => {
    const race = speeding(true);
    const p = race.racers[PLAYER_INDEX]!;
    p.speed = 45; // corner pace: where steering response is strongest
    // Pace-holding controller (real lift/brake modulation, flat track).
    const cruise = (steer: number): RacerInput => ({
      steer,
      accel: p.speed < 44,
      brake: p.speed > 48,
      boost: false,
      drift: false,
    });
    for (let k = 0; k < 60; k++) {
      stepRace(race, inputsFor(race, cruise(1)), DT);
    }
    expect(p.steerPos).toBeCloseTo(1, 1);
    const peakX = p.x;
    expect(peakX).toBeGreaterThan(1);
    // Slam the stick the other way: position crosses center within 20 frames
    // and lateral progress reverses instead of wallowing.
    for (let k = 0; k < 20; k++) {
      stepRace(race, inputsFor(race, cruise(-1)), DT);
    }
    expect(p.steerPos).toBeLessThan(0);
    expect(p.x).toBeLessThan(peakX - 0.5);
  });

  it('trades speed for tighter turning while drifting', () => {
    const drive = (drift: boolean, frames: number): { x: number; speed: number } => {
      const race = speeding();
      const p = race.racers[PLAYER_INDEX]!;
      for (let k = 0; k < frames; k++) {
        stepRace(race, inputsFor(race, { ...fullGas(), steer: 1, drift }), DT);
      }
      return { x: p.x, speed: p.speed };
    };
    // Short window (pre-barrier): drift reaches visibly further across.
    const plain = drive(false, 20);
    const drift = drive(true, 20);
    expect(Math.abs(drift.x)).toBeGreaterThan(Math.abs(plain.x) + 0.5);
    // Sustained drift costs real pace but stays drivable: straight-line runs
    // (no steering, so no barrier scrape) isolate the drag cost.
    const straight = (driftMode: boolean): number => {
      const race = speeding(true);
      const p = race.racers[PLAYER_INDEX]!;
      for (let k = 0; k < 120; k++) {
        stepRace(race, inputsFor(race, { ...fullGas(), drift: driftMode }), DT);
      }
      return p.speed;
    };
    const cruise = straight(false);
    const scrubbed = straight(true);
    expect(scrubbed).toBeLessThan(cruise - 5);
    expect(scrubbed).toBeGreaterThan(30);
  });

  it('grips against slide-out while drifting through a curve', () => {
    let s = 0;
    for (let c = 0; c < TRACK_LENGTH; c += 10) {
      if (curvatureAt(c) > 0.002) {
        s = c;
        break;
      }
    }
    expect(curvatureAt(s)).toBeGreaterThan(0.002);
    const drive = (drift: boolean): number => {
      const race = createRace();
      race.countdown = 0;
      const p = race.racers[PLAYER_INDEX]!;
      p.s = s;
      p.x = 0;
      p.speed = 70;
      for (let k = 0; k < 60; k++) {
        stepRace(race, inputsFor(race, { ...fullGas(), drift }), DT);
      }
      return p.x;
    };
    // Same curve, same speed: the drifting line slides outward less.
    expect(drive(true)).toBeGreaterThan(drive(false));
  });

  it('recovers from offroad by steering home', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 100;
    p.x = ROAD_HALF + 1;
    p.speed = 30;
    for (let k = 0; k < 240; k++) {
      stepRace(race, inputsFor(race, { ...fullGas(), steer: -1 }), DT);
      if (Math.abs(p.x) <= ROAD_HALF) break;
    }
    expect(Math.abs(p.x)).toBeLessThanOrEqual(ROAD_HALF);
    // Back on the surface, pace rebuilds toward road speed.
    for (let k = 0; k < 240; k++) {
      stepRace(race, inputsFor(race, fullGas()), DT);
      if (p.speed > 50) break;
    }
    expect(p.speed).toBeGreaterThan(50);
  });
});

describe('racing turn cues', () => {
  it('points into real bends with the curvature sign', () => {
    const track = RACE_CIRCUITS[0]!.track;
    let found = 0;
    for (let s = 0; s < track.length; s += 20) {
      const cue = turnCueAt(track, s);
      const ahead = track.curvatureAt(s + 70);
      if (Math.abs(ahead) > 0.004) {
        expect(cue).toBe(Math.sign(ahead));
        found++;
      } else if (Math.abs(ahead) < 0.001) {
        expect(cue).toBe(0);
      }
    }
    expect(found).toBeGreaterThan(5);
  });

  it('mirrors cue direction on mirrored circuits', () => {
    const base = RACE_CIRCUITS[0]!.track;
    const mirrored = compileTrackVariant('ember', { mirror: true }).track;
    let checked = 0;
    for (let s = 0; s < base.length; s += 20) {
      const cue = turnCueAt(base, s);
      if (cue !== 0) {
        expect(turnCueAt(mirrored, s)).toBe(-cue);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('stays silent on straights', () => {
    const track = RACE_CIRCUITS[0]!.track;
    expect(turnCueAt(track, 100)).toBe(0);
  });
});

describe('racing stationary recovery', () => {
  it('holds a stopped offroad craft against steer-only crabbing', () => {
    const race = createRace();
    race.countdown = 0;
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 100;
    p.x = 4;
    p.speed = 0;
    for (let k = 0; k < 60; k++) {
      stepRace(race, inputsFor(race, { ...idle(), steer: -1 }), DT);
    }
    expect(p.x).toBeCloseTo(4, 6);
    // But throttling up from the same spot recovers onto the road.
    for (let k = 0; k < 240; k++) {
      stepRace(race, inputsFor(race, { ...fullGas(), steer: -1 }), DT);
      if (Math.abs(p.x) <= ROAD_HALF) break;
    }
    expect(Math.abs(p.x)).toBeLessThanOrEqual(ROAD_HALF);
  });
});
