// Boost supply modes: pads (legacy), pickups (banked energy), none.
// Mode exclusivity, swept collection vs miss, once-per-lap anti-farming,
// AI lane seeking, restart cleanup, legacy defaults, and PB key separation.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RacingSpec } from '@sparkade/shared';
import {
  PLAYER_INDEX,
  RACE_CIRCUITS,
  aiInputFor,
  createRaceFor,
  isPickupTaken,
  pickupTargetX,
  pickupsRemaining,
  recordKey,
  resolveCupRaces,
  restartRace,
  stepRace,
  stepRacer,
  type RacerInput,
  type RaceState,
} from '../src/racing/index';
import { lintRacing } from '../src/racing/index';

const DT = 1 / 60;

function idle(): RacerInput {
  return { steer: 0, accel: false, brake: false, boost: false, drift: false };
}

function gas(): RacerInput {
  return { steer: 0, accel: true, brake: false, boost: false, drift: false };
}

function golden(): RacingSpec {
  const path = join(__dirname, '..', '..', 'generation', 'golden', 'golden-racing.json');
  return JSON.parse(readFileSync(path, 'utf8')) as RacingSpec;
}

function withBoostMode(spec: RacingSpec, mode: 'pads' | 'pickups' | 'none'): RacingSpec {
  const cast = spec.levels[0]!.rivals;
  const concept = (name: string): string => `${name} test rival hovercraft in a distinct livery`;
  return {
    ...spec,
    identity: {
      pilotName: 'ROOKIE',
      artDirection: 'Test art direction for the boost-mode cup',
      worldConcept: 'A test cup world for boost supply modes',
      playerCraftConcept: 'Test twin-pod hovercraft in track-day colors',
      rivalCrafts: [
        { name: cast[0]!.name, vehicleConcept: concept(cast[0]!.name) },
        { name: cast[1]!.name, vehicleConcept: concept(cast[1]!.name) },
        { name: cast[2]!.name, vehicleConcept: concept(cast[2]!.name) },
        { name: cast[3]!.name, vehicleConcept: concept(cast[3]!.name) },
      ],
      sound: { engine: { family: 'electric' } },
      boost: {
        mode,
        displayName: mode === 'pads' ? 'Surge Pads' : mode === 'pickups' ? 'Ember Cells' : 'Dead Engine',
        appearanceConcept: 'Test boost supply appearance concept for the cup',
      },
    },
  };
}

/** Flat-track pickups race: isolates collection from bends and pads. */
function flatPickupsRace(): RaceState {
  const base = RACE_CIRCUITS[0]!;
  const race = createRaceFor(
    {
      ...base,
      boostMode: 'pickups',
      pads: [],
      track: { ...base.track, curvatureAt: () => 0 },
    },
    0,
  );
  for (let i = 1; i < race.racers.length; i++) race.racers[i]!.finished = true;
  return race;
}

function drivePlayer(race: RaceState, steps: number, input: RacerInput = gas()): void {
  const inputs = race.racers.map(() => idle());
  inputs[PLAYER_INDEX] = input;
  for (let k = 0; k < steps; k++) stepRace(race, inputs, DT);
}

describe('boost mode exclusivity', () => {
  it('keeps legacy pads with identity omitted', () => {
    const spec = golden();
    delete spec.identity;
    for (const { circuit } of resolveCupRaces(spec)) {
      expect(circuit.boostMode).toBe('pads');
      expect(circuit.pads.length).toBeGreaterThan(0);
      expect(circuit.pickups).toEqual([]);
    }
    const dev = resolveCupRaces();
    expect(dev[0]!.circuit.boostMode).toBe('pads');
    expect(dev[0]!.circuit.pads.length).toBeGreaterThan(0);
  });

  it('compiles cells and no pads for pickups, nothing for none', () => {
    for (const { circuit } of resolveCupRaces(withBoostMode(golden(), 'pickups'))) {
      expect(circuit.boostMode).toBe('pickups');
      expect(circuit.pads).toEqual([]);
      expect(circuit.pickups).toHaveLength(4);
    }
    for (const { circuit } of resolveCupRaces(withBoostMode(golden(), 'none'))) {
      expect(circuit.boostMode).toBe('none');
      expect(circuit.pads).toEqual([]);
      expect(circuit.pickups).toEqual([]);
    }
    for (const { circuit } of resolveCupRaces(golden())) {
      expect(circuit.boostMode).toBe('pads');
      expect(circuit.pads.length).toBeGreaterThan(0);
      expect(circuit.pickups).toEqual([]);
    }
  });

  it('pads stay dark in pickups mode even when hand-placed', () => {
    const race = flatPickupsRace();
    race.circuit = { ...race.circuit, pads: [{ start: 100, length: 90 }] };
    const p = race.racers[PLAYER_INDEX]!;
    p.s = 90;
    p.x = 0;
    p.speed = 60;
    drivePlayer(race, 30);
    expect(p.boostT).toBe(0);
  });
});

describe('energy cell collection', () => {
  it('banks meter without burning on a real lane hit', () => {
    const race = flatPickupsRace();
    const p = race.racers[PLAYER_INDEX]!;
    const cell = race.circuit.pickups[0]!;
    p.s = cell.s - 5;
    p.x = cell.x;
    p.speed = 50;
    p.boost = 0;
    drivePlayer(race, 30);
    expect(p.pickupsTaken).toBe(1);
    expect(isPickupTaken(race, PLAYER_INDEX, 0)).toBe(true);
    expect(p.boostT).toBe(0);
    expect(p.boost).toBeGreaterThan(0.3);
    expect(pickupsRemaining(race, PLAYER_INDEX)).toBe(3);
  });

  it('misses off-lane and never collects while reversing', () => {
    const race = flatPickupsRace();
    const p = race.racers[PLAYER_INDEX]!;
    const cell = race.circuit.pickups[0]!;
    // Off-lane pass: same sweep, no overlap.
    p.s = cell.s - 5;
    p.x = cell.x + 2.5;
    p.speed = 50;
    drivePlayer(race, 30);
    expect(p.pickupsTaken).toBe(0);
    // Reverse sweep across the lane: forward progress only.
    p.s = cell.s + 3;
    p.x = cell.x;
    p.speed = -12;
    drivePlayer(race, 30, idle());
    expect(p.pickupsTaken).toBe(0);
  });

  it('pays once per lap and re-arms on the next lap', () => {
    const race = flatPickupsRace();
    const p = race.racers[PLAYER_INDEX]!;
    const cell = race.circuit.pickups[0]!;
    p.boost = 0;
    p.s = cell.s - 5;
    p.x = cell.x;
    p.speed = 50;
    drivePlayer(race, 30);
    expect(p.pickupsTaken).toBe(1);
    // Re-cross the same cell on the same lap: no double pay.
    p.s = cell.s - 5;
    p.speed = 50;
    drivePlayer(race, 30);
    expect(p.pickupsTaken).toBe(1);
    // Next lap re-arms the cell.
    p.lap += 1;
    p.s = cell.s - 5;
    p.speed = 50;
    drivePlayer(race, 30);
    expect(p.pickupsTaken).toBe(2);
  });

  it('never collects during the countdown', () => {
    const race = flatPickupsRace();
    race.countdown = 1;
    const p = race.racers[PLAYER_INDEX]!;
    const cell = race.circuit.pickups[0]!;
    p.s = cell.s - 1;
    p.x = cell.x;
    p.speed = 50;
    stepRacer(race, p, gas(), DT);
    expect(p.pickupsTaken).toBe(0);
    expect(p.speed).toBe(0);
  });
});

describe('pickup-seeking rivals', () => {
  it('aims AI at the next bankable lane on mild road', () => {
    const race = flatPickupsRace();
    for (let i = 1; i < race.racers.length; i++) race.racers[i]!.finished = false;
    const ai = race.racers[1]!;
    const cell = race.circuit.pickups[0]!;
    ai.s = cell.s - 100;
    ai.x = 0;
    ai.speed = 50;
    expect(pickupTargetX(race, 1)).toBe(cell.x);
    const out = aiInputFor(race, 1);
    expect(Math.sign(out.steer)).toBe(Math.sign(cell.x - ai.x));
    // Pads mode never seeks.
    race.circuit = { ...race.circuit, boostMode: 'pads' };
    expect(pickupTargetX(race, 1)).toBeNull();
  });

  it('an AI rival banks a cell driving the same physics', () => {
    const race = flatPickupsRace();
    for (let i = 1; i < race.racers.length; i++) race.racers[i]!.finished = false;
    const ai = race.racers[1]!;
    ai.s = race.circuit.pickups[0]!.s - 120;
    ai.x = 0;
    ai.speed = 40;
    ai.boost = 0;
    const inputs = race.racers.map(() => idle());
    for (let k = 0; k < 600 && ai.pickupsTaken < 1; k++) {
      for (let i = 0; i < race.racers.length; i++) {
        inputs[i] = i === PLAYER_INDEX ? idle() : aiInputFor(race, i, inputs[i]);
      }
      stepRace(race, inputs, DT);
    }
    expect(ai.pickupsTaken).toBeGreaterThanOrEqual(1);
    expect(ai.boost).toBeGreaterThan(0.2);
  });
});

describe('restart and legacy behavior', () => {
  it('restart clears takes so every racer gets a fair lap', () => {
    const race = flatPickupsRace();
    const p = race.racers[PLAYER_INDEX]!;
    const cell = race.circuit.pickups[0]!;
    p.s = cell.s - 5;
    p.x = cell.x;
    p.speed = 50;
    drivePlayer(race, 30);
    expect(p.pickupsTaken).toBe(1);
    restartRace(race, 0);
    const fresh = race.racers[PLAYER_INDEX]!;
    expect(fresh.pickMask).toBe(0);
    expect(fresh.pickupsTaken).toBe(0);
    expect(pickupsRemaining(race, PLAYER_INDEX)).toBe(4);
    fresh.s = cell.s - 5;
    fresh.x = cell.x;
    fresh.speed = 50;
    drivePlayer(race, 30);
    expect(fresh.pickupsTaken).toBe(1);
  });

  it('legacy pads behavior is untouched with identity omitted', () => {
    const race = createRaceFor(RACE_CIRCUITS[0]!, 0);
    const p = race.racers[PLAYER_INDEX]!;
    expect(p.boost).toBeCloseTo(0.6, 6);
    // Legacy pad kick still fires on entry.
    const pad = race.circuit.pads[0]!;
    p.s = pad.start - 2;
    p.x = 0;
    p.speed = 60;
    drivePlayer(race, 20);
    expect(p.boostT).toBeGreaterThan(0);
  });

  it('manual boost still burns banked meter with no on-track sources', () => {
    const spec = withBoostMode(golden(), 'none');
    const { circuit } = resolveCupRaces(spec)[0]!;
    const race = createRaceFor(circuit, 0);
    const p = race.racers[PLAYER_INDEX]!;
    p.boost = 0.6;
    stepRacer(race, p, { steer: 0, accel: true, brake: false, boost: true, drift: false }, DT);
    expect(p.boostT).toBeGreaterThan(0);
    expect(p.boost).toBeCloseTo(0.1, 6);
  });
});

describe('timing record keys', () => {
  it('keeps legacy pads keys stable and separates modes and layouts', () => {
    const base = RACE_CIRCUITS[0]!;
    const legacy = recordKey('game', 'course', { ...base, boostMode: undefined as never });
    expect(recordKey('game', 'course', base)).toBe(legacy);
    expect(legacy).not.toContain('boost');
    const pickups = recordKey('game', 'course', { ...base, boostMode: 'pickups' });
    const none = recordKey('game', 'course', { ...base, boostMode: 'none', pads: [] });
    expect(pickups).toContain('boostpickups');
    expect(pickups).toContain('cells');
    expect(none).toContain('boostnone');
    expect(new Set([legacy, pickups, none]).size).toBe(3);
    const moved = recordKey('game', 'course', {
      ...base,
      boostMode: 'pickups',
      pickups: base.pickups.map((c, k) => (k === 0 ? { ...c, s: c.s + 40 } : c)),
    });
    expect(moved).not.toBe(pickups);
  });
});

describe('identity lint', () => {
  it('accepts the golden identity and rejects a renamed rival craft', () => {
    expect(lintRacing(golden())).toEqual([]);
    const spec = golden();
    spec.identity!.rivalCrafts[0]!.name = 'IMPOSTOR';
    expect(lintRacing(spec).map((e) => e.code)).toContain('RACING_IDENTITY_CAST');
    const legacy = golden();
    delete legacy.identity;
    expect(lintRacing(legacy)).toEqual([]);
  });
});
