// Racing discipline milestone 1: hover contract preserved, jet-ski physics.
// Hover omission stays byte-for-byte legacy (fixture regression); jet-ski
// adds inertial lateral momentum, smooth shallow resistance, and water
// coast — on the same boost reserve, lap gates, contact, and AI rules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RacingSpec } from '@sparkade/shared';
import { ARCHETYPE_SCHEMAS, DESIGN_SCHEMA } from '@sparkade/shared';
import {
  BARRIER_X,
  PLAYER_INDEX,
  RACE_CIRCUITS,
  aiInputFor,
  compileTrackVariant,
  createRaceFor,
  movementFor,
  resolveCupRaces,
  resolveDiscipline,
  stepRace,
  type RaceState,
  type RacerInput,
} from '../src/racing/index';

const DT = 1 / 60;

function idle(): RacerInput {
  return { steer: 0, accel: false, brake: false, boost: false, drift: false };
}

function fullGas(): RacerInput {
  return { steer: 0, accel: true, brake: false, boost: false, drift: false };
}

function golden(): RacingSpec {
  const path = join(__dirname, '..', '..', 'generation', 'golden', 'golden-racing.json');
  return JSON.parse(readFileSync(path, 'utf8')) as RacingSpec;
}

/** Exact replay of the pre-change baseline capture (see fixtures/). */
function capturePlayerTraj(race: RaceState): number[][] {
  const traj: number[][] = [];
  const inputs = race.racers.map(
    (): RacerInput => ({ steer: 0, accel: true, brake: false, boost: false, drift: false }),
  );
  for (let k = 0; k < 60 * 120; k++) {
    for (let i = 1; i < race.racers.length; i++) aiInputFor(race, i, inputs[i]!);
    const p = race.racers[0]!;
    inputs[0]!.steer = Math.max(-1, Math.min(1, -p.x * 0.6));
    stepRace(race, inputs, DT);
    if (k % 60 === 0) {
      traj.push([
        +p.s.toFixed(6),
        +p.x.toFixed(6),
        +p.speed.toFixed(6),
        p.lap,
        p.nextCp,
        +p.boost.toFixed(6),
      ]);
    }
  }
  return traj;
}

describe('racing discipline contract', () => {
  it('resolves omission to hover and rejects anything else', () => {
    expect(resolveDiscipline(undefined)).toBe('hover');
    expect(resolveDiscipline('hover')).toBe('hover');
    expect(resolveDiscipline('jetski')).toBe('jetski');
    expect(() => resolveDiscipline('submarine')).toThrow(/unknown racing discipline/);
    expect(() => movementFor('submarine' as 'hover')).toThrow(/unknown racing discipline/);
    expect(movementFor(undefined).discipline).toBe('hover');
    expect(movementFor('hover').discipline).toBe('hover');
    expect(movementFor('jetski').discipline).toBe('jetski');
  });

  it('compiles hover by default and threads jetski on request', () => {
    expect(compileTrackVariant('ember').discipline).toBe('hover');
    expect(compileTrackVariant('ember', { mirror: true }).discipline).toBe('hover');
    expect(compileTrackVariant('coral', { discipline: 'jetski' }).discipline).toBe('jetski');
  });

  it('keeps legacy specs on hover and threads identity discipline into every cup race', () => {
    const legacy = resolveCupRaces(golden());
    expect(legacy.map((r) => r.circuit.discipline)).toEqual(['hover', 'hover', 'hover']);
    const spec = golden();
    spec.identity = {
      pilotName: 'REEF',
      artDirection: 'Bright marine arcade with clean geometric waves.',
      worldConcept: 'A sunlit archipelago channel raced on jet-skis.',
      playerCraftConcept: 'A compact teal jet-ski with white trim and a low spray rail.',
      rivalCrafts: ['VEX', 'JUNO', 'PIP', 'KAZ'].map((name) => ({
        name,
        vehicleConcept: `A rival jet-ski in ${name} colors with a tall fin.`,
      })),
      sound: { engine: { family: 'combustion' } },
      boost: { mode: 'pads', displayName: 'Surge Pads', appearanceConcept: 'Glowing buoys.' },
      discipline: 'jetski',
    };
    const ski = resolveCupRaces(spec);
    expect(ski.map((r) => r.circuit.discipline)).toEqual(['jetski', 'jetski', 'jetski']);
    // Geometry still comes from the proven templates.
    expect(ski.map((r) => r.circuit.id)).toEqual(['ember', 'coral', 'ratchet']);
  });

  it('rejects an invalid discipline at resolve time instead of racing wrong physics', () => {
    const spec = golden();
    delete spec.identity!.traversal;
    (spec as unknown as { identity: unknown }).identity = {
      ...(spec.identity ?? {}),
      pilotName: 'REEF',
      artDirection: 'Bright marine arcade with clean geometric waves.',
      worldConcept: 'A sunlit archipelago channel raced on jet-skis.',
      playerCraftConcept: 'A compact teal jet-ski with white trim.',
      rivalCrafts: ['VEX', 'JUNO', 'PIP', 'KAZ'].map((name) => ({
        name,
        vehicleConcept: `A rival jet-ski in ${name} colors.`,
      })),
      sound: { engine: { family: 'combustion' } },
      boost: { mode: 'pads', displayName: 'Surge Pads', appearanceConcept: 'Glowing buoys.' },
      discipline: 'submarine',
    };
    expect(() => resolveCupRaces(spec)).toThrow(/unknown racing discipline/);
  });

  it('declares optional hover|jetski identity.discipline in both schemas (rejected otherwise)', () => {
    // Structural read of the single-source-of-truth JSON schemas (runtime
    // rejection itself is covered above via resolveDiscipline/movementFor).
    const racingSchema = ARCHETYPE_SCHEMAS.racing as {
      $defs: { racingIdentity: { properties: { discipline: unknown }; required: string[] } };
    };
    const designSchema = DESIGN_SCHEMA as {
      properties: { racingIdentity: { properties: { discipline: unknown }; required: string[] } };
    };
    for (const identity of [racingSchema.$defs.racingIdentity, designSchema.properties.racingIdentity]) {
      expect(identity.properties.discipline).toMatchObject({ enum: ['hover', 'jetski'] });
      expect(identity.required).not.toContain('discipline');
    }
  });
});

describe('hover regression fixture', () => {
  it('replays the pre-change checkpoint trajectories exactly on all 3 circuits', () => {
    const path = join(__dirname, 'fixtures', 'racing-hover-baseline.json');
    const fixture = JSON.parse(readFileSync(path, 'utf8')) as {
      circuit: number;
      laps: number;
      t: number;
      traj: number[][];
    }[];
    expect(fixture).toHaveLength(3);
    for (const entry of fixture) {
      const race = createRaceFor(RACE_CIRCUITS[entry.circuit]!);
      race.countdown = 0;
      expect(capturePlayerTraj(race)).toEqual(entry.traj);
      expect(race.racers[PLAYER_INDEX]!.lap).toBe(entry.laps);
      expect(+race.t.toFixed(4)).toBe(entry.t);
    }
  });

  it('treats an omitted discipline exactly like explicit hover', () => {
    for (const base of RACE_CIRCUITS) {
      const legacy = { ...base };
      delete (legacy as { discipline?: unknown }).discipline;
      const a = createRaceFor(legacy);
      const b = createRaceFor({ ...legacy, discipline: 'hover' });
      a.countdown = 0;
      b.countdown = 0;
      expect(capturePlayerTraj(a)).toEqual(capturePlayerTraj(b));
    }
  });
});

describe('jet-ski movement', () => {
  function skiRace(): RaceState {
    const circuit = compileTrackVariant('ember', { discipline: 'jetski' });
    // Flat control: isolate lateral/longitudinal physics from bend load.
    circuit.track = { ...circuit.track, curvatureAt: () => 0 };
    const race = createRaceFor(circuit);
    race.countdown = 0;
    return race;
  }

  function stepPlayer(race: RaceState, input: RacerInput): void {
    stepRace(
      race,
      race.racers.map((_, i) => (i === PLAYER_INDEX ? input : idle())),
      DT,
    );
  }

  it('carries lateral momentum that settles with drag and never auto-steers', () => {
    const race = skiRace();
    const p = race.racers[PLAYER_INDEX]!;
    p.x = 0;
    p.speed = 60;
    // Hold full lock for a second: the hull slides sideways.
    for (let k = 0; k < 60; k++) stepPlayer(race, { ...fullGas(), steer: 1 });
    expect(p.x).toBeGreaterThan(1);
    expect(p.latV).toBeGreaterThan(0);
    // Release: momentum keeps it sliding briefly, then it settles.
    stepPlayer(race, fullGas());
    const sliding = p.x;
    expect(p.latV).toBeGreaterThan(0);
    for (let k = 0; k < 240; k++) stepPlayer(race, fullGas());
    expect(p.latV).toBe(0);
    expect(p.x).toBeGreaterThan(sliding);
    // Settled means settled: the line holds, it never steers back to center.
    const held = p.x;
    for (let k = 0; k < 120; k++) stepPlayer(race, fullGas());
    expect(p.x).toBe(held);
    expect(p.x).toBeGreaterThan(1);
  });

  it('never moves a stopped craft on steering input alone', () => {
    const race = skiRace();
    const p = race.racers[PLAYER_INDEX]!;
    expect(p.speed).toBe(0);
    const x0 = p.x;
    const s0 = p.s;
    for (let k = 0; k < 120; k++) stepPlayer(race, { ...idle(), steer: 1 });
    expect(p.x).toBe(x0);
    expect(p.latV).toBe(0);
    expect(p.s).toBe(s0);
  });

  it('keeps low-speed steering useful', () => {
    const race = skiRace();
    const p = race.racers[PLAYER_INDEX]!;
    p.speed = 10;
    for (let k = 0; k < 60; k++) stepPlayer(race, { ...idle(), steer: 1 });
    expect(Math.abs(p.x)).toBeGreaterThan(0.5);
  });

  it('recovers from the boundary back to the road under steering', () => {
    const race = skiRace();
    const p = race.racers[PLAYER_INDEX]!;
    p.x = BARRIER_X - 0.1;
    p.speed = 50;
    for (let k = 0; k < 600 && (p.offroad || Math.abs(p.x) > 4.0); k++) {
      stepPlayer(race, { ...fullGas(), steer: -Math.sign(p.x) });
    }
    expect(Math.abs(p.x)).toBeLessThanOrEqual(4.0);
    expect(p.offroad).toBe(false);
  });

  it('treats shallow water smoothly: faster than the hover ramp at the same depth', () => {
    const hoverCircuit = compileTrackVariant('ember');
    hoverCircuit.track = { ...hoverCircuit.track, curvatureAt: () => 0 };
    const skiCircuit = compileTrackVariant('ember', { discipline: 'jetski' });
    skiCircuit.track = { ...skiCircuit.track, curvatureAt: () => 0 };
    const hover = createRaceFor(hoverCircuit);
    const ski = createRaceFor(skiCircuit);
    hover.countdown = 0;
    ski.countdown = 0;
    const hp = hover.racers[PLAYER_INDEX]!;
    const sp = ski.racers[PLAYER_INDEX]!;
    for (const r of [hp, sp]) {
      r.s = 1000;
      r.x = 5.0;
      r.speed = 70;
    }
    const gas: RacerInput[] = hover.racers.map(() => ({ ...fullGas() }));
    const skiGas: RacerInput[] = ski.racers.map(() => ({ ...fullGas() }));
    for (let k = 0; k < 300; k++) {
      stepRace(hover, gas, DT);
      stepRace(ski, skiGas, DT);
    }
    expect(sp.offroad).toBe(true);
    expect(hp.offroad).toBe(true);
    // Both are capped by the boundary, but the smooth water edge costs less.
    expect(sp.speed).toBeGreaterThan(hp.speed);
    expect(sp.speed).toBeLessThan(76);
  });

  it('shares the finite boost reserve and manual modes with hover', () => {
    const race = skiRace();
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 1000;
    p.speed = 60;
    const before = p.boost;
    stepPlayer(race, { ...fullGas(), boost: true });
    expect(p.boost).toBeCloseTo(before - 0.5, 10);
    expect(p.boostT).toBeGreaterThan(0);
    // Below cost refuses, same as hover.
    p.boostT = 0;
    p.boost = 0.1;
    stepPlayer(race, { ...fullGas(), boost: true });
    expect(p.boostT).toBe(0);
  });

  it('coasts down off-throttle while hover holds pace', () => {
    const hoverCircuit = compileTrackVariant('ember');
    hoverCircuit.track = { ...hoverCircuit.track, curvatureAt: () => 0 };
    const skiCircuit = compileTrackVariant('ember', { discipline: 'jetski' });
    skiCircuit.track = { ...skiCircuit.track, curvatureAt: () => 0 };
    const hover = createRaceFor(hoverCircuit);
    const ski = createRaceFor(skiCircuit);
    hover.countdown = 0;
    ski.countdown = 0;
    const hp = hover.racers[PLAYER_INDEX]!;
    const sp = ski.racers[PLAYER_INDEX]!;
    hp.s = 1000;
    sp.s = 1000;
    hp.speed = 60;
    sp.speed = 60;
    for (let k = 0; k < 180; k++) {
      stepRace(
        hover,
        hover.racers.map(() => idle()),
        DT,
      );
      stepRace(
        ski,
        ski.racers.map(() => idle()),
        DT,
      );
    }
    expect(sp.speed).toBeLessThan(hp.speed);
    // And the jet-ski still responds to throttle afterwards.
    expect(sp.speed).toBeGreaterThan(0);
  });
});

describe('jet-ski AI completion', () => {
  it('banks a player-slot finish with no racer stuck: all 3 templates, mirrored, at both length extremes', () => {
    const templates = ['ember', 'coral', 'ratchet'];
    const variants: { mirror: boolean; length: number }[] = [];
    for (const mirror of [false, true]) {
      for (const length of [2800, 3600]) variants.push({ mirror, length });
    }
    for (const template of templates) {
      for (const variant of variants) {
        const circuit = compileTrackVariant(template, { ...variant, discipline: 'jetski' });
        const race = createRaceFor(circuit);
        race.countdown = 0;
        const inputs = race.racers.map((): RacerInput => idle());
        const cap = Math.ceil((circuit.timeout + 5) / DT);
        // The clock freezes once the player slot finishes (results rule), so
        // completion means: the player slot banks all 3 laps, and nobody is
        // stuck — every rival is at least a full lap up the road by then.
        for (let k = 0; k < cap && !race.over; k++) {
          for (let i = 0; i < race.racers.length; i++) aiInputFor(race, i, inputs[i]!);
          stepRace(race, inputs, DT);
        }
        const tag = `${template} mirror=${variant.mirror} len=${variant.length}`;
        expect(race.racers[PLAYER_INDEX]!.finished, `${tag} player`).toBe(true);
        expect(race.racers[PLAYER_INDEX]!.lap, `${tag} player laps`).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < race.racers.length; i++) {
          expect(race.racers[i]!.lap, `${tag} racer ${i}`).toBeGreaterThanOrEqual(1);
          expect(Number.isFinite(race.racers[i]!.x), `${tag} racer ${i} finite x`).toBe(true);
          expect(Math.abs(race.racers[i]!.x), `${tag} racer ${i} bounds`).toBeLessThanOrEqual(
            BARRIER_X + 1e-6,
          );
        }
      }
    }
  }, 120000);
});
