import { describe, expect, it } from 'vitest';
import {
  aiInputFor,
  compileTrackVariant,
  createRaceFor,
  stepRace,
  stepRacer,
  recordKey,
  type RacerInput,
} from '../src/racing/index';
import { jumpLipS, JUMP_CURVE_MAX, resolveJumps } from '../src/racing/jumps';
const idle: RacerInput = { steer: 0, accel: false, brake: false, boost: false, drift: false };
const DT = 1 / 60;
function launchFixture(speed = 70, x = 0) {
  const circuit = compileTrackVariant('coral', { jumps: 'ramps', length: 3000 });
  const race = createRaceFor(circuit, 0),
    p = race.racers[0]!;
  p.s =
    jumpLipS(circuit.ramps![0]!, circuit.track.length) - Math.max(0.01, (Math.abs(speed) * DT) / 2);
  p.speed = speed;
  p.x = x;
  return { circuit, race, p };
}

describe('racing ramp mechanics', () => {
  it('keeps legacy state and records unchanged when omitted or none', () => {
    const a = compileTrackVariant('ember', {}),
      b = compileTrackVariant('ember', { jumps: 'none' });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(createRaceFor(a).racers).toEqual(createRaceFor(b).racers);
    expect(createRaceFor(a).racers[0]).not.toHaveProperty('air');
    expect(recordKey('x', 'course', a)).toEqual(recordKey('x', 'course', b));
    expect(() => resolveJumps('flying')).toThrow();
  });
  it('places safe deterministic ramps across templates, lengths and mirrors', () => {
    for (const t of ['ember', 'coral', 'ratchet'] as const)
      for (const length of [2800, 3200, 3600])
        for (const mirror of [false, true]) {
          const c = compileTrackVariant(t, { length, mirror, jumps: 'ramps' });
          expect(c.ramps!.length).toBeGreaterThan(0);
          expect(c.ramps).toEqual(compileTrackVariant(t, { length, mirror, jumps: 'ramps' }).ramps);
          for (const r of c.ramps!) {
            for (const g of [0, 0.25 * length, 0.5 * length, 0.75 * length, length]) {
              expect(Math.abs(r.s - g)).toBeGreaterThanOrEqual(119.9);
              expect(Math.abs(r.s + r.length - g)).toBeGreaterThanOrEqual(119.9);
            }
            for (let s = r.s - 60; s <= r.s + r.length + 60; s += 5)
              expect(Math.abs(c.track.curvatureAt(s))).toBeLessThanOrEqual(JUMP_CURVE_MAX);
          }
        }
  });
  it('requires forward pace and lane overlap, then lands without a speed cliff', () => {
    for (const [speed, x] of [
      [0, 0],
      [15, 0],
      [-70, 0],
      [70, 3.7],
    ]) {
      const { race, p } = launchFixture(speed, x);
      stepRacer(race, p, idle, DT);
      expect(p.air!.height).toBe(0);
    }
    const { race, p } = launchFixture();
    stepRacer(race, p, idle, DT);
    expect(p.air!.height).toBeGreaterThan(0);
    let max = 0,
      landing = false;
    for (let i = 0; i < 180; i++) {
      const v = p.speed;
      stepRacer(race, p, { ...idle, accel: true }, DT);
      max = Math.max(max, p.air!.height);
      if (p.air!.landingT > 0) {
        expect(Math.abs(p.speed - v)).toBeLessThan(3);
        landing = true;
        break;
      }
    }
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThan(3);
    expect(landing).toBe(true);
  });
  it('airborne drivers cross checkpoints while bypassing surface supplies and contacts', () => {
    const { race, p, circuit } = launchFixture();
    p.s = circuit.track.length * 0.25 - 1;
    p.x = 0;
    p.speed = 70;
    p.air!.height = 1;
    p.air!.velocity = 0;
    p.boostT = 0;
    p.boost = 0;
    p.boostDelay = 10;
    race.circuit = { ...circuit, pads: [{ start: p.s, length: 20 }] };
    const rival = race.racers[1]!;
    rival.s = p.s;
    rival.x = 0;
    rival.speed = 70;
    for (const r of race.racers.slice(2)) r.finished = true;
    const control = { ...p, air: { ...p.air! } };
    stepRacer(race, control, idle, DT);
    stepRace(
      race,
      race.racers.map(() => idle),
      DT,
    );
    expect(p.x).toBeCloseTo(control.x, 10);
    expect(p.nextCp).toBe(1);
    expect(p.boostT).toBe(0);
  });
  it('finishes three-lap cups with hills and jumps for all handling/surface combinations', () => {
    for (const handling of ['direct', 'grip', 'carve', 'flow'] as const)
      for (const surface of ['ground', 'water'] as const) {
        const c = compileTrackVariant('coral', {
          jumps: 'ramps',
          elevation: 'ridge',
          length: 3000,
          traversal: { label: 'Test', handling, surface, rider: 'standing', propulsion: 'human' },
        });
        const r = createRaceFor(c, 0);
        let takeoffs = 0,
          last = 0;
        for (let n = 0; !r.over && n < 15000; n++) {
          stepRace(
            r,
            r.racers.map((_, i) => aiInputFor(r, i)),
            DT,
          );
          const h = r.racers[0]!.air!.height;
          if (h > 0 && last === 0) takeoffs++;
          last = h;
          expect(Number.isFinite(h)).toBe(true);
        }
        expect(r.racers[0]!.finished).toBe(true);
        expect(r.dnf[0]).toBe(false);
        expect(takeoffs).toBeGreaterThanOrEqual(3);
      }
  });
});
