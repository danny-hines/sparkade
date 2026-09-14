// Milestone 2 (cornering load + honest AI): handling tests on real physics.
// No state injection mid-race; setups only. Steering/AI behavior asserted
// through the shared step function both directions and on real circuits.
import { describe, expect, it } from 'vitest';
import {
  CURVE_PUSH,
  PLAYER_INDEX,
  PLAYER_TOP_SPEED,
  aiInputFor,
  cornerHoldSpeed,
  createRace,
  createRaceFor,
  restartRace,
  stepRace,
  steerAuthorityAt,
  type RaceState,
  type RacerInput,
} from '../src/racing/simulation';
import {
  BARRIER_X,
  CURB_WIDTH,
  RACE_CIRCUITS,
  ROAD_HALF,
  compileTrackVariant,
} from '../src/racing/track';
import { steerVisScale } from '../src/racing/game';

const DT = 1 / 60;

function idle(): RacerInput {
  return { steer: 0, accel: false, brake: false, boost: false, drift: false };
}

function soloLap(circuitId: string): RaceState {
  const circuit = RACE_CIRCUITS.find((c) => c.id === circuitId)!;
  const race = createRaceFor({ ...circuit, laps: 1 }, 0);
  race.racers[0]!.x = 0;
  for (const rival of race.racers.slice(1)) rival.finished = true;
  return race;
}

/** Constant-curve bench: sustained bend of severity c (both signs tested). */
function benchRace(c: number): RaceState {
  const race = createRace();
  race.countdown = 0;
  race.circuit = {
    ...race.circuit,
    pads: [],
    track: { ...race.circuit.track, curvatureAt: () => c },
  };
  for (let i = 1; i < race.racers.length; i++) {
    const o = race.racers[i]!;
    o.s = -2000 - i * 100;
    o.speed = 0;
  }
  return race;
}

describe('cornering load', () => {
  it.each([0.019, -0.019])('pushes wide at full throttle on a sustained %s bend even at full lock', (c) => {
    const race = benchRace(c);
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 0;
    p.x = 0;
    p.speed = PLAYER_TOP_SPEED;
    const into = Math.sign(c); // steer into the bend (inside)
    let minIn = Infinity;
    let maxOut = -Infinity;
    for (let k = 0; k < 180; k++) {
      stepRace(
        race,
        race.racers.map((_, i) =>
          i === PLAYER_INDEX ? { steer: into, accel: true, brake: false, boost: false, drift: false } : idle(),
        ),
        DT,
      );
      minIn = Math.min(minIn, into * p.x);
      maxOut = Math.max(maxOut, -into * p.x);
    }
    // Carried across to the outside barrier despite full ordinary lock.
    expect(maxOut).toBeGreaterThan(3);
    expect(minIn).toBeLessThan(2);
  });

  it.each([0.019, -0.019])('holds the same %s bend when slowed to a hairpin crawl', (c) => {
    const race = benchRace(c);
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 0;
    p.x = 0;
    p.speed = 25;
    const into = Math.sign(c);
    // Line-hold driving (like a real driver modulating lock): full lock
    // into the bend would over-grip to the inside wall at crawl pace.
    let worst = 0;
    for (let k = 0; k < 180; k++) {
      const gas = p.speed < 24;
      const hold = Math.max(-1, Math.min(1, (into * 1 - p.x) * 1.2));
      stepRace(
        race,
        race.racers.map((_, i) =>
          i === PLAYER_INDEX
            ? { steer: hold, accel: gas, brake: !gas && p.speed > 26, boost: false, drift: false }
            : idle(),
        ),
        DT,
      );
      worst = Math.max(worst, Math.abs(p.x));
    }
    expect(worst).toBeLessThan(2.5);
  });

  it('demands no steering nowhere: a no-steer full-gas launch goes wide', () => {
    const race = benchRace(0.01);
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 0;
    p.x = 0;
    p.speed = PLAYER_TOP_SPEED;
    const gas: RacerInput = { steer: 0, accel: true, brake: false, boost: false, drift: false };
    let wide = false;
    for (let k = 0; k < 300; k++) {
      stepRace(race, race.racers.map(() => ({ ...gas })), DT);
      if (Math.abs(p.x) > 3) {
        wide = true;
        break;
      }
    }
    expect(wide).toBe(true);
  });

  it('braking to a hold speed keeps a clean faster line than flat-out pinning', () => {
    const drive = (braked: boolean): { exitSpeed: number; worstX: number; wallFrames: number } => {
      const race = benchRace(0.019);
      const p = race.racers[PLAYER_INDEX]!;
      p.s = 0;
      // Honest corner entry: the braked driver arrives at entry pace on the
      // inside line (braking happens BEFORE the bend, not inside it); the
      // flat driver arrives at full throttle on the centerline.
      p.x = braked ? 1 : 0;
      p.speed = braked ? 45 : PLAYER_TOP_SPEED;
      let worstX = 0;
      let wallFrames = 0;
      for (let k = 0; k < 240; k++) {
        let input: RacerInput;
        if (!braked) {
          input = { steer: 1, accel: true, brake: false, boost: false, drift: false };
        } else {
          // Brake to drift pace, then drift a held inside line: grip + yaw
          // keep a clean line at ~40 while flat-out pins at the barrier.
          // (Proportional line-hold, not full lock: excess yaw would run
          // wide to the inside wall instead.)
          const tooFast = p.speed > 46;
          const hold = Math.max(-1, Math.min(1, (0.5 - p.x) * 1.2));
          input = { steer: hold, accel: !tooFast, brake: tooFast, boost: false, drift: true };
        }
        stepRace(race, race.racers.map((_, i) => (i === PLAYER_INDEX ? input : idle())), DT);
        worstX = Math.max(worstX, Math.abs(p.x));
        if (Math.abs(p.x) >= BARRIER_X - 0.01) wallFrames++;
      }
      return { exitSpeed: p.speed, worstX, wallFrames };
    };
    const flat = drive(false);
    const held = drive(true);
    // Flat-out understeers into the outside barrier and grinds there; the
    // braked driver holds a clean line at real corner pace without ever
    // touching the wall.
    expect(flat.worstX).toBeGreaterThan(4);
    expect(flat.wallFrames).toBeGreaterThan(60);
    expect(held.worstX).toBeLessThan(3);
    expect(held.wallFrames).toBe(0);
    expect(held.exitSpeed).toBeGreaterThan(35);
  });

  it('solves hold speeds from the shared authority law', () => {
    // Tight bend hold speed sits well below top speed: load outgrows lock.
    const tight = cornerHoldSpeed(0.019, false);
    expect(tight).toBeLessThan(PLAYER_TOP_SPEED * 0.6);
    expect(tight).toBeGreaterThan(15);
    expect(cornerHoldSpeed(0.001, false)).toBeGreaterThan(PLAYER_TOP_SPEED);
    // Consistency: authority at hold speed balances the bend load exactly.
    const ratio = steerAuthorityAt(tight) / (0.019 * tight * tight * CURVE_PUSH);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
    // Slowing strengthens control: authority peaks near corner-entry pace.
    expect(steerAuthorityAt(40)).toBeGreaterThan(steerAuthorityAt(80) * 1.5);
    expect(steerAuthorityAt(0)).toBe(0);
  });
});

describe('handling on real circuits', () => {
  it.each(['ember', 'coral', 'ratchet'])('rewards a clean digital driving line on %s', (id) => {
    const drive = (useBrakes: boolean) => {
      const race = soloLap(id);
      const inputs = race.racers.map(idle);
      let offroadFrames = 0;
      let steerFrames = 0;
      let frames = 0;
      for (; frames < 18000 && !race.over; frames++) {
        const planned = aiInputFor(race, 0);
        const steer = frames % 12 / 12 < Math.abs(planned.steer) ? Math.sign(planned.steer) : 0;
        inputs[0] = {
          steer,
          accel: useBrakes ? planned.accel : true,
          brake: useBrakes && planned.brake,
          drift: useBrakes && planned.drift,
          boost: false,
        };
        stepRace(race, inputs, DT);
        if (race.racers[0]!.offroad) offroadFrames++;
        if (steer) steerFrames++;
      }
      expect(race.racers[0]!.lap).toBe(1);
      expect(race.dnf[0]).toBe(false);
      return { time: race.t, offroadFrames, steeringDuty: steerFrames / frames };
    };
    const flat = drive(false);
    const controlled = drive(true);
    expect(controlled.offroadFrames).toBe(0);
    expect(flat.offroadFrames).toBeGreaterThan(0);
    expect(controlled.steeringDuty).toBeGreaterThan(0.45);
    // Forgiving shoulders narrowed the flat-vs-braking gap by design
    // (easier driving wins over punishing wide lines): the clean line stays
    // broadly competitive with zero excursions, while flat always runs wide.
    // Tight-corner braking benefit is covered separately on the bench.
    expect(controlled.time).toBeLessThan(flat.time * 1.15);
  });

  it('demands sustained digital steering across a technical lap', () => {
    const race = soloLap('ember');
    const p = race.racers[0]!;
    const inputs = race.racers.map(() => ({ ...idle() }));
    let steerFrames = 0;
    let frame = 0;
    for (; frame < 18000 && !race.over; frame++) {
      const a = aiInputFor(race, 0);
      const phase = (frame % 12) / 12;
      const input = { steer: 0, accel: true, brake: false, boost: false, drift: false };
      input.steer = phase < Math.abs(a.steer) ? Math.sign(a.steer) : 0;
      inputs[0] = input;
      stepRace(race, inputs, DT);
      if (input.steer !== 0) steerFrames++;
    }
    expect(p.lap).toBe(1);
    // Curves demand intentional steering: far above the old ~17% nudge duty.
    expect(steerFrames / frame).toBeGreaterThan(0.5);
  });

  it.each(['ember', 'coral', 'ratchet'])('completes an honest AI solo lap on %s', (id) => {
    const race = soloLap(id);
    const inputs = race.racers.map(() => ({ ...idle() }));
    let frame = 0;
    for (; frame < 18000 && !race.over; frame++) {
      inputs[0] = aiInputFor(race, 0);
      stepRace(race, inputs, DT);
    }
    expect(race.racers[0]!.lap).toBe(1);
    expect(race.dnf[0]).toBe(false);
  });

  it.each([
    { length: 2800, mirror: true },
    { length: 3600, mirror: false },
  ])('completes generated geometry (length $length, mirror $mirror) with digital drivers', ({ length, mirror }) => {
    const base = RACE_CIRCUITS[0]!;
    const variant = compileTrackVariant(base.id, { length, mirror });
    // Player slowest: the player finishes LAST, so race.over (player finish)
    // can only freeze the clock once every rival has honestly finished.
    const circuit = { ...variant, laps: 1, aiScales: [0.7, ...variant.aiScales.slice(1)] };
    const race = createRaceFor(circuit, 0);
    let frame = 0;
    for (; frame < 18000 && !race.over; frame++) {
      stepRace(
        race,
        race.racers.map((_, i) => aiInputFor(race, i)),
        DT,
      );
      if (race.racers.every((r) => r.finished)) break;
    }
    for (const r of race.racers) expect(r.lap).toBe(1);
  });
});

describe('launch grid and start feel', () => {
  /** Contact box: overlapping craft shove when |ds| < 6 and |dx| < 1.7. */
  function separated(race: RaceState): boolean {
    for (let i = 0; i < race.racers.length; i++) {
      for (let j = i + 1; j < race.racers.length; j++) {
        const a = race.racers[i]!;
        const b = race.racers[j]!;
        if (Math.abs(a.s - b.s) < 6 && Math.abs(a.x - b.x) < 1.7) return false;
      }
    }
    return true;
  }

  it.each(RACE_CIRCUITS.map((c) => c.id))('builds a unique separated grid on %s, player last, gates consistent', (id) => {
    const circuit = RACE_CIRCUITS.find((c) => c.id === id)!;
    const race = createRaceFor(circuit, 1.2);
    expect(race.racers.length).toBe(5);
    const player = race.racers[PLAYER_INDEX]!;
    // Player at the back; every slot unique; s/gateS agree (no rewrites).
    for (const r of race.racers) {
      expect(r.gateS).toBe(r.s);
      expect(r.speed).toBe(0);
    }
    for (const r of race.racers) {
      if (r !== player) expect(r.s).toBeGreaterThan(player.s);
    }
    expect(separated(race)).toBe(true);
    // Launch through the countdown: no contact impulse, orderly getaway.
    const gas: RacerInput = { steer: 0, accel: true, brake: false, boost: false, drift: false };
    for (let k = 0; k < 120; k++) {
      stepRace(race, race.racers.map(() => ({ ...gas })), DT);
      expect(separated(race)).toBe(true);
    }
    // Restart rebuilds the identical clean grid.
    restartRace(race, 1.2);
    expect(separated(race)).toBe(true);
    for (const r of race.racers) expect(r.gateS).toBe(r.s);
  });

  it('scales steering visuals to zero at a stop with smooth progression', () => {
    expect(steerVisScale(0)).toBe(0);
    expect(steerVisScale(-0)).toBe(0);
    // Smooth low-speed ramp, full effect at race pace.
    expect(steerVisScale(15)).toBeCloseTo(0.5, 1);
    expect(steerVisScale(30)).toBe(1);
    expect(steerVisScale(80)).toBe(1);
    expect(steerVisScale(15)).toBeGreaterThan(steerVisScale(5));
    expect(steerVisScale(5)).toBeGreaterThan(0);
  });

  it('treats the curb band as road: no flag, no snap', () => {
    const race = benchRace(0);
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 0;
    p.x = ROAD_HALF + CURB_WIDTH / 2; // inside the forgiving apron
    p.speed = 80;
    const gas: RacerInput = { steer: 0, accel: true, brake: false, boost: false, drift: false };
    stepRace(race, race.racers.map((_, i) => (i === PLAYER_INDEX ? gas : idle())), DT);
    expect(p.offroad).toBe(false);
    expect(80 - p.speed).toBeLessThan(2);
  });

  it('keeps most pace through a brief shallow excursion', () => {
    const race = benchRace(0);
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 0;
    p.x = ROAD_HALF + CURB_WIDTH + 0.2; // just past the curb
    p.speed = 80;
    const gas: RacerInput = { steer: 0, accel: true, brake: false, boost: false, drift: false };
    // Bounded one-frame loss, then a quarter second of shallow running.
    stepRace(race, race.racers.map((_, i) => (i === PLAYER_INDEX ? gas : idle())), DT);
    expect(p.offroad).toBe(true);
    expect(80 - p.speed).toBeLessThan(5);
    for (let k = 0; k < 15; k++) {
      const before = p.speed;
      stepRace(race, race.racers.map((_, i) => (i === PLAYER_INDEX ? gas : idle())), DT);
      expect(before - p.speed).toBeLessThan(5); // smooth, never a snap
      expect(p.offroad).toBe(true);
    }
    expect(p.speed).toBeGreaterThanOrEqual(74);
  });

  it('settles deep sustained shoulder running materially below road pace', () => {
    const race = benchRace(0);
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 0;
    p.x = ROAD_HALF + 1.9; // deep shoulder, short of the barrier
    p.speed = 80;
    const gas: RacerInput = { steer: 0, accel: true, brake: false, boost: false, drift: false };
    for (let k = 0; k < 300; k++) {
      stepRace(race, race.racers.map((_, i) => (i === PLAYER_INDEX ? gas : idle())), DT);
    }
    expect(p.offroad).toBe(true);
    expect(p.speed).toBeLessThan(65);
    expect(p.speed).toBeGreaterThan(45);
  });

  it('recovers promptly with real steering input', () => {
    const race = benchRace(0);
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 0;
    p.x = ROAD_HALF + 1.9;
    p.speed = 55;
    for (let k = 0; k < 300; k++) {
      const home: RacerInput = { steer: p.x > 0 ? -1 : 1, accel: true, brake: false, boost: false, drift: false };
      stepRace(race, race.racers.map((_, i) => (i === PLAYER_INDEX ? home : idle())), DT);
      if (Math.abs(p.x) < ROAD_HALF && p.speed > 40) break;
    }
    expect(Math.abs(p.x)).toBeLessThan(ROAD_HALF);
    expect(p.speed).toBeGreaterThan(40);
  });

  it('slows consistently across frame rates', () => {
    const run = (dt: number): number => {
      const race = benchRace(0);
      const p = race.racers[PLAYER_INDEX]!;
      p.s = 0;
      p.x = ROAD_HALF + 1;
      p.speed = 80;
      const gas: RacerInput = { steer: 0, accel: true, brake: false, boost: false, drift: false };
      for (let k = 0; k < Math.round(1 / dt); k++) {
        stepRace(race, race.racers.map((_, i) => (i === PLAYER_INDEX ? gas : idle())), dt);
      }
      return p.speed;
    };
    const v60 = run(1 / 60);
    expect(Math.abs(run(1 / 30) - v60)).toBeLessThan(4);
    expect(Math.abs(run(1 / 120) - v60)).toBeLessThan(4);
  });
});
