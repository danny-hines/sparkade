// Racing cup milestone: three parameterized circuits, cup flow, timeout/DNF.
import { describe, expect, it } from 'vitest';
import { LOGICAL_BUTTONS } from '@sparkade/shared';
import { BARRIER_X, RACE_CIRCUITS, auditCircuit, compileTrackVariant, createRacingGame } from '../src/racing/index';
import type { RaceCircuit, RacingDevHandle } from '../src/racing/index';
import {
  CUP_POINTS,
  PLAYER_INDEX,
  RACER_COUNT,
  aiInputFor,
  classifyRace,
  createCup,
  createRace,
  createRaceFor,
  cupComplete,
  cupStandings,
  playerResult,
  recordRaceResult,
  restartCup,
  restartRace,
  stepRace,
  type RaceState,
  type RacerInput,
} from '../src/racing/index';

const DT = 1 / 60;

function idle(): RacerInput {
  return { steer: 0, accel: false, brake: false, boost: false, drift: false };
}

/** Drive every craft (including the player) with the deterministic AI. */
function runAiRace(race: RaceState, maxT: number): void {
  const inputs: RacerInput[] = race.racers.map(() => ({ ...idle() }));
  race.countdown = 0;
  const cap = Math.ceil(maxT / DT);
  for (let k = 0; k < cap && !race.over; k++) {
    for (let i = 0; i < race.racers.length; i++) aiInputFor(race, i, inputs[i]);
    stepRace(race, inputs, DT);
  }
}

describe('cup circuits', () => {
  it('ships exactly three distinct closed templates', () => {
    expect(RACE_CIRCUITS).toHaveLength(3);
    const ids = RACE_CIRCUITS.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    const names = RACE_CIRCUITS.map((c) => c.name);
    expect(new Set(names).size).toBe(3);
  });

  it('sizes every circuit for 3 laps in ~2800-3600 units', () => {
    for (const c of RACE_CIRCUITS) {
      expect(c.laps).toBe(3);
      expect(c.track.length).toBeGreaterThanOrEqual(2800);
      expect(c.track.length).toBeLessThanOrEqual(3600);
    }
    const lens = RACE_CIRCUITS.map((c) => c.track.length).sort((a, b) => a - b);
    // Genuinely different lengths, not rescaled copies of one shape.
    for (let i = 1; i < lens.length; i++) {
      expect(lens[i]! - lens[i - 1]!).toBeGreaterThan(100);
    }
  });

  it('audits every template: finite, seamless, drivable, non-intersecting, pads in bounds', () => {
    for (const c of RACE_CIRCUITS) {
      const a = auditCircuit(c.track, c.pads);
      expect(a.finite).toBe(true);
      // Seam step matches ordinary steps; tangents agree across the seam.
      expect(a.seamStep / a.meanStep).toBeGreaterThan(0.9);
      expect(a.seamStep / a.meanStep).toBeLessThan(1.1);
      expect(a.seamTangentDot).toBeGreaterThan(0.999);
      // Drivable: peak smoothed curvature stays well under AI brake limits.
      expect(a.maxCurvature).toBeLessThan(0.02);
      // No near-overlapping roads: far-apart samples stay several road
      // widths apart (road half-width is 3, barrier at 4.8).
      expect(a.minSeparation).toBeGreaterThan(4 * BARRIER_X);
      expect(a.padsInBounds).toBe(true);
      expect(c.pads).toHaveLength(2);
    }
  });

  it('gives each circuit its own scenery/palette and paces its finale rival', () => {
    const scenery = RACE_CIRCUITS.map((c) => c.theme.scenery);
    expect(new Set(scenery).size).toBe(3);
    const tops = RACE_CIRCUITS.map((c) => c.theme.skyTop);
    expect(new Set(tops).size).toBe(3);
    const finale = RACE_CIRCUITS[RACE_CIRCUITS.length - 1]!;
    // Same driver all cup (no mid-cup rename); the finale runs a faster
    // setup, and the separate display title lives in spec boss metadata.
    expect(finale.names).toEqual(RACE_CIRCUITS[0]!.names);
    expect(finale.aiScales[1]).toBeGreaterThan(RACE_CIRCUITS[0]!.aiScales[1]!);
    expect(finale.aiScales[1]).toBeLessThanOrEqual(1);
  });

  it('keeps the default single-track API on the first circuit', () => {
    const race = createRace();
    expect(race.circuit.id).toBe(RACE_CIRCUITS[0]!.id);
    expect(race.circuit.laps).toBe(3);
    expect(race.racers).toHaveLength(RACER_COUNT);
  });
});

describe('AI drivability on every template', () => {
  for (const c of RACE_CIRCUITS) {
    it(`finishes a full 3-lap AI race on ${c.id} before the timeout`, () => {
      const race = createRaceFor(c);
      runAiRace(race, c.timeout);
      expect(race.over).toBe(true);
      expect(race.t).toBeLessThan(c.timeout);
      const player = race.racers[PLAYER_INDEX]!;
      expect(player.finished).toBe(true);
      expect(playerResult(race)).not.toBeNull();
    });
  }
});

describe('cup flow', () => {
  // Short-timeout stand-in so the flow test runs in milliseconds.
  function sprintCircuit(base: RaceCircuit): RaceCircuit {
    return { ...base, timeout: 400 };
  }

  it('runs race -> next -> cup completion with stable points', () => {
    const cup = createCup();
    expect(cupComplete(cup)).toBe(false);
    let awarded = 0;
    for (const base of RACE_CIRCUITS) {
      const race = createRaceFor(sprintCircuit(base));
      runAiRace(race, base.timeout);
      expect(race.over).toBe(true);
      const rows = classifyRace(race);
      expect(rows).toHaveLength(RACER_COUNT);
      expect(rows.map((r) => r.place)).toEqual([1, 2, 3, 4, 5]);
      recordRaceResult(cup, rows);
      awarded += CUP_POINTS.reduce((a, b) => a + b, 0);
    }
    expect(cup.raceIndex).toBe(3);
    expect(cupComplete(cup)).toBe(true);
    // Every race awards exactly 9+6+4+2+1 = 22 points across the field.
    expect(cup.points.reduce((a, b) => a + b, 0)).toBe(awarded);
    const order = cupStandings(cup);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('completes a lap on quantized digital steering (-1/0/1)', () => {
    const race = createRace();
    race.countdown = 0;
    // Bang-bang cabinet driver: deadbanded centering plus curve feedforward,
    // all through the same physics (no teleports, no analog AI for the player).
    const digital = race.racers.map((_, i) => {
      if (i === PLAYER_INDEX) return idle();
      return idle();
    });
    for (let k = 0; k < Math.ceil(180 / DT); k++) {
      const p = race.racers[PLAYER_INDEX]!;
      if (p.lap >= 1) break;
      const curve = race.circuit.track.curvatureAt(p.s + 30);
      const err = p.x - curve * 300;
      digital[PLAYER_INDEX] = {
        steer: err > 0.5 ? -1 : err < -0.5 ? 1 : 0,
        accel: true,
        brake: false,
        boost: false,
        drift: false,
      };
      for (let i = 1; i < race.racers.length; i++) aiInputFor(race, i, digital[i]);
      stepRace(race, digital, DT);
    }
    expect(race.racers[PLAYER_INDEX]!.lap).toBeGreaterThanOrEqual(1);
  });

  it('keeps final standings stable after the race is over', () => {
    const race = createRaceFor(RACE_CIRCUITS[0]!);
    runAiRace(race, 400);
    const before = classifyRace(race);
    const t = race.t;
    const order = [...race.finishOrder];
    for (let k = 0; k < 120; k++) {
      stepRace(
        race,
        race.racers.map(() => idle()),
        DT,
      );
    }
    expect(race.t).toBe(t);
    expect(race.finishOrder).toEqual(order);
    expect(classifyRace(race)).toEqual(before);
  });

  it('scores DNFs and never hangs when the player is stuck', () => {
    const base = RACE_CIRCUITS[0]!;
    const race = createRaceFor({ ...base, timeout: 5 });
    race.countdown = 0;
    const cap = Math.ceil(10 / DT);
    for (let k = 0; k < cap && !race.over; k++) {
      stepRace(
        race,
        race.racers.map(() => idle()),
        DT,
      );
    }
    expect(race.over).toBe(true);
    expect(race.t).toBeGreaterThanOrEqual(5);
    // Nobody moved, so nobody finished: the whole field is DNF.
    expect(race.finishOrder).toHaveLength(0);
    expect(race.dnf.every(Boolean)).toBe(true);
    const rows = classifyRace(race);
    expect(rows).toHaveLength(RACER_COUNT);
    expect(rows.every((r) => r.dnf && r.time === null)).toBe(true);
    expect(playerResult(race)).toBeNull();
    // Frozen: further steps change nothing, so hosts cannot spin forever.
    const t = race.t;
    stepRace(
      race,
      race.racers.map(() => idle()),
      DT,
    );
    expect(race.t).toBe(t);
  });

  it('ranks a finished player ahead of the DNF field at timeout', () => {
    const base = RACE_CIRCUITS[0]!;
    const race = createRaceFor({ ...base, timeout: 30 });
    race.countdown = 0;
    // Player teleports near the finish armed; rivals idle at the grid.
    const p = race.racers[PLAYER_INDEX]!;
    p.lap = 2;
    p.nextCp = 3;
    p.s = base.track.length - 200;
    p.speed = 70;
    const gas: RacerInput = { steer: 0, accel: true, brake: false, boost: false, drift: false };
    const cap = Math.ceil(40 / DT);
    for (let k = 0; k < cap && !race.over; k++) {
      const inputs = race.racers.map((_, i) => (i === PLAYER_INDEX ? { ...gas } : idle()));
      stepRace(race, inputs, DT);
    }
    expect(p.finished).toBe(true);
    const rows = classifyRace(race);
    expect(rows[0]!.index).toBe(PLAYER_INDEX);
    expect(rows[0]!.dnf).toBe(false);
  });

  it('restarts cleanly on the same circuit and resets the cup', () => {
    const race = createRaceFor(RACE_CIRCUITS[1]!);
    runAiRace(race, 400);
    expect(race.over).toBe(true);
    restartRace(race);
    expect(race.over).toBe(false);
    expect(race.t).toBe(0);
    expect(race.circuit.id).toBe(RACE_CIRCUITS[1]!.id);
    expect(race.dnf.every((d) => !d)).toBe(true);
    expect(race.finishOrder).toHaveLength(0);
    for (const r of race.racers) {
      expect(r.lap).toBe(0);
      expect(r.finished).toBe(false);
    }
    const cup = createCup();
    recordRaceResult(cup, [
      { index: 0, place: 1, time: 100, dnf: false },
      { index: 1, place: 2, time: 101, dnf: false },
      { index: 2, place: 3, time: 102, dnf: false },
      { index: 3, place: 4, time: 103, dnf: false },
      { index: 4, place: 5, time: 104, dnf: false },
    ]);
    expect(cup.points[0]).toBe(9);
    expect(cupStandings(cup)[0]).toBe(0);
    restartCup(cup);
    expect(cup.raceIndex).toBe(0);
    expect(cup.points.every((v) => v === 0)).toBe(true);
    expect(cup.history).toHaveLength(0);
    expect(cupComplete(cup)).toBe(false);
  });

  it('advances a full autopilot cup through all three circuits at game level', () => {
    const gradient = { addColorStop: () => undefined };
    const ctx = new Proxy(
      {},
      {
        get: (_t, p) => {
          if (p === 'createLinearGradient') return () => gradient;
          if (p === 'canvas') return { width: 480, height: 270 };
          return (..._args: unknown[]) => undefined;
        },
        set: () => true,
      },
    );
    const engine = { renderer: { ctx } } as unknown as import('@sparkade/engine').EngineContext;
    const game = createRacingGame(engine) as import('@sparkade/engine').GameInstance & RacingDevHandle;
    game.racingDev.setAutopilot(true);
    expect(game.result).toBeNull();
    const seen = new Set<string>();
    const input = {} as import('@sparkade/engine').InputSnapshot;
    for (const b of LOGICAL_BUTTONS) input[b] = { held: false, pressed: false, released: false };
    let frames = 0;
    while (frames < 60000) {
      const s = game.racingDev.snapshot();
      seen.add(s.trackId);
      if (s.cup.complete && s.phase === 'cupEnd') break;
      game.update(DT, input);
      if (frames % 10 === 0) game.render();
      frames++;
    }
    const end = game.racingDev.snapshot();
    // Every circuit raced exactly once — no skips, no repeats.
    expect(seen).toEqual(new Set(['ember', 'coral', 'ratchet']));
    expect(end.cup.complete).toBe(true);
    expect(end.phase).toBe('cupEnd');
    // GameResult only becomes final when the cup is complete.
    expect(game.result).not.toBeNull();
    expect(game.result!.score).toBeGreaterThan(0);
    game.dispose();
  });
});

describe('quantized digital feel completes every circuit', () => {
  for (const circuit of RACE_CIRCUITS) {
    it(`keeps the ${circuit.id} pack from spending the race in contact`, () => {
      const race = createRaceFor(circuit, 0);
      const inputs = race.racers.map(() => idle());
      let frames = 0;
      let contactFrames = 0;
      for (; frames < circuit.timeout / DT && !race.over; frames++) {
        for (let i = 0; i < inputs.length; i++) aiInputFor(race, i, inputs[i]);
        stepRace(race, inputs, DT);
        let touching = false;
        for (let i = 0; i < race.racers.length; i++) {
          for (let j = i + 1; j < race.racers.length; j++) {
            const a = race.racers[i]!;
            const b = race.racers[j]!;
            const gap = circuit.track.wrap(a.s - b.s);
            if (!a.finished && !b.finished
              && Math.min(gap, circuit.track.length - gap) < 6
              && Math.abs(a.x - b.x) < 1.7) touching = true;
          }
        }
        if (touching) contactFrames++;
      }
      expect(race.racers[PLAYER_INDEX]!.finished).toBe(true);
      // Allow ordinary racing contact while rejecting the former 56–96%
      // sustained bunching. This margin tolerates future line tuning.
      expect(contactFrames).toBeLessThan(frames * 0.2);
    });
  }

  /**
   * Bang-bang cabinet driver: quantized steer (-1/0/1), boolean pedals, plus
   * curve feedforward through the same physics — no analog input, no assists.
   */
  function digitalDrive(race: RaceState, i: number): RacerInput {
    const r = race.racers[i]!;
    const curve = race.circuit.track.curvatureAt(r.s + 30);
    const err = r.x - curve * 300;
    const ahead = race.circuit.track.curvatureAt(r.s + 90);
    return {
      steer: err > 0.5 ? -1 : err < -0.5 ? 1 : 0,
      accel: true,
      brake: Math.abs(ahead) > 0.004 && r.speed > 50,
      boost: false,
      drift: Math.abs(ahead) > 0.005 && Math.abs(r.speed) > 50,
    };
  }

  /** Player on the digital driver, rivals on AI; null while unfinished. */
  function runDigitalRace(race: RaceState): void {
    race.countdown = 0;
    const cap = Math.ceil(race.circuit.timeout / DT);
    for (let k = 0; k < cap && !race.over; k++) {
      const inputs = race.racers.map((_, i) => (i === PLAYER_INDEX ? digitalDrive(race, i) : aiInputFor(race, i)));
      stepRace(race, inputs, DT);
    }
  }

  for (const c of RACE_CIRCUITS) {
    it(`finishes a full 3-lap digital race on ${c.id} before the timeout`, () => {
      const race = createRaceFor(c);
      runDigitalRace(race);
      expect(race.over).toBe(true);
      expect(race.t).toBeLessThan(c.timeout);
      expect(race.racers[PLAYER_INDEX]!.finished).toBe(true);
    });
  }

  const extremes: Array<{ label: string; circuit: RaceCircuit }> = [
    { label: 'ember-shortest-2800', circuit: compileTrackVariant('ember', { length: 2800 }) },
    { label: 'ember-longest-3600', circuit: compileTrackVariant('ember', { length: 3600 }) },
    { label: 'ember-mirrored', circuit: compileTrackVariant('ember', { mirror: true }) },
  ];

  for (const { label, circuit } of extremes) {
    it(`finishes a full digital race on the ${label} extreme`, () => {
      const race = createRaceFor(circuit);
      runDigitalRace(race);
      expect(race.over).toBe(true);
      expect(race.t).toBeLessThan(circuit.timeout);
      expect(race.racers[PLAYER_INDEX]!.finished).toBe(true);
    });

    it(`finishes a full AI race on the ${label} extreme`, () => {
      const race = createRaceFor(circuit);
      runAiRace(race, circuit.timeout);
      expect(race.over).toBe(true);
      expect(race.t).toBeLessThan(circuit.timeout);
      expect(race.racers[PLAYER_INDEX]!.finished).toBe(true);
    });
  }
});

describe('cup flow ties', () => {
  it('breaks cup ties by wins, then by final-race place', () => {
    const cup = createCup();
    // Racer 0 wins race 1, racer 1 wins race 2, equal on points.
    const win0 = [
      { index: 0, place: 1, time: 100, dnf: false },
      { index: 1, place: 2, time: 101, dnf: false },
      { index: 2, place: 3, time: 102, dnf: false },
      { index: 3, place: 4, time: 103, dnf: false },
      { index: 4, place: 5, time: 104, dnf: false },
    ];
    const win1 = [
      { index: 1, place: 1, time: 100, dnf: false },
      { index: 0, place: 2, time: 101, dnf: false },
      { index: 2, place: 3, time: 102, dnf: false },
      { index: 3, place: 4, time: 103, dnf: false },
      { index: 4, place: 5, time: 104, dnf: false },
    ];
    recordRaceResult(cup, win0);
    recordRaceResult(cup, win1);
    // 15-15 on points, 1-1 on wins: latest race winner takes it.
    expect(cup.points[0]).toBe(cup.points[1]);
    expect(cupStandings(cup)[0]).toBe(1);
  });
});
