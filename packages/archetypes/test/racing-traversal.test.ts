// Racing traversal P1: composable traversal contract + physics resolution.
// Legacy absence preserves hover/jetski exactly; new (handling, surface)
// combinations resolve through the central bounded tables; label/rider/
// propulsion never drive physics.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_SCHEMAS, DESIGN_SCHEMA } from '@sparkade/shared';
import {
  BARRIER_X,
  BICYCLE_TRAVERSAL,
  HOVER_MOVEMENT,
  JETSKI_MOVEMENT,
  MAGIC_BOARD_TRAVERSAL,
  MOTORCYCLE_TRAVERSAL,
  PLAYER_INDEX,
  RACING_HANDLINGS,
  RACING_SURFACES,
  SKATEBOARD_TRAVERSAL,
  aiInputFor,
  compileTrackVariant,
  createRaceFor,
  handlingTuningFor,
  movementFor,
  movementForTraversal,
  resolveTraversal,
  stepRace,
  type RacerInput,
  type RacingHandling,
  type RacingSurface,
} from '../src/racing/index';

const DT = 1 / 60;

function idle(): RacerInput {
  return { steer: 0, accel: false, brake: false, boost: false, drift: false };
}

describe('traversal schema contract', () => {
  it('resolves omission to undefined and validates every field', () => {
    expect(resolveTraversal(undefined)).toBeUndefined();
    expect(resolveTraversal({ ...BICYCLE_TRAVERSAL })).toEqual(BICYCLE_TRAVERSAL);
    expect(() => resolveTraversal(null)).toThrow(/traversal/);
    expect(() => resolveTraversal('bicycle')).toThrow(/traversal/);
    expect(() => resolveTraversal({ ...BICYCLE_TRAVERSAL, handling: 'drift' })).toThrow(
      /handling/,
    );
    expect(() => resolveTraversal({ ...BICYCLE_TRAVERSAL, surface: 'air' })).toThrow(/surface/);
    expect(() => resolveTraversal({ ...BICYCLE_TRAVERSAL, rider: 'prone' })).toThrow(/rider/);
    expect(() => resolveTraversal({ ...BICYCLE_TRAVERSAL, propulsion: 'steam' })).toThrow(
      /propulsion/,
    );
    expect(() => resolveTraversal({ ...BICYCLE_TRAVERSAL, label: '' })).toThrow(/label/);
    expect(() =>
      resolveTraversal({ handling: 'grip', surface: 'ground', rider: 'seated', propulsion: 'human' }),
    ).toThrow(/label/);
  });

  it('accepts every bounded handling×surface value', () => {
    for (const handling of RACING_HANDLINGS) {
      for (const surface of RACING_SURFACES) {
        expect(
          resolveTraversal({ label: 'T', handling, surface, rider: 'none', propulsion: 'motor' }),
        ).toEqual({ label: 'T', handling, surface, rider: 'none', propulsion: 'motor' });
      }
    }
  });

  it('declares optional traversal in both schemas (rejected otherwise)', () => {
    const racingSchema = ARCHETYPE_SCHEMAS.racing as {
      $defs: { racingIdentity: { properties: { traversal: unknown }; required: string[] } };
    };
    const designSchema = DESIGN_SCHEMA as {
      properties: { racingIdentity: { properties: { traversal: unknown }; required: string[] } };
    };
    for (const identity of [racingSchema.$defs.racingIdentity, designSchema.properties.racingIdentity]) {
      expect(identity.properties.traversal).toMatchObject({
        required: ['label', 'handling', 'surface', 'rider', 'propulsion'],
        additionalProperties: false,
      });
      const props = (identity.properties.traversal as { properties: Record<string, unknown> })
        .properties;
      expect(props['handling']).toMatchObject({ enum: ['direct', 'grip', 'carve', 'flow'] });
      expect(props['surface']).toMatchObject({ enum: ['ground', 'water'] });
      expect(props['rider']).toMatchObject({ enum: ['none', 'seated', 'standing', 'onFoot'] });
      expect(props['propulsion']).toMatchObject({ enum: ['motor', 'human', 'magic'] });
      expect(identity.required).not.toContain('traversal');
    }
  });
});

describe('traversal presets', () => {
  it('shares one engine across bicycle, motorcycle, skateboard, and magical board', () => {
    expect(BICYCLE_TRAVERSAL).toEqual({
      label: 'Cycle Sprint',
      handling: 'grip',
      surface: 'ground',
      rider: 'seated',
      propulsion: 'human',
    });
    expect(MOTORCYCLE_TRAVERSAL).toEqual({
      label: 'Moto Sprint',
      handling: 'grip',
      surface: 'ground',
      rider: 'seated',
      propulsion: 'motor',
    });
    expect(SKATEBOARD_TRAVERSAL).toEqual({
      label: 'Street Carve',
      handling: 'carve',
      surface: 'ground',
      rider: 'standing',
      propulsion: 'human',
    });
    expect(MAGIC_BOARD_TRAVERSAL).toEqual({
      label: 'Tide Charms',
      handling: 'carve',
      surface: 'water',
      rider: 'standing',
      propulsion: 'magic',
    });
  });
});

describe('traversal physics resolution', () => {
  it('preserves legacy exactly when traversal is absent (same profile object)', () => {
    expect(movementForTraversal(undefined, undefined)).toBe(movementFor(undefined));
    expect(movementForTraversal(undefined, undefined)).toBe(HOVER_MOVEMENT);
    expect(movementForTraversal('hover', undefined)).toBe(HOVER_MOVEMENT);
    expect(movementForTraversal('jetski', undefined)).toBe(JETSKI_MOVEMENT);
  });

  it('lands on the legacy objects at the envelope corners, bounded tables in between', () => {
    // direct/ground repeats hover steering exactly; carve/water repeats jet-ski.
    expect(
      movementForTraversal('hover', { label: 'T', handling: 'direct', surface: 'ground', rider: 'none', propulsion: 'motor' }),
    ).toBe(HOVER_MOVEMENT);
    expect(
      movementForTraversal('hover', { ...MAGIC_BOARD_TRAVERSAL }),
    ).toBe(JETSKI_MOVEMENT);
    // grip/ground keeps normalized hover pace with planted steering.
    const grip = movementForTraversal('hover', { ...BICYCLE_TRAVERSAL });
    expect(grip.topSpeed).toBe(HOVER_MOVEMENT.topSpeed);
    expect(grip.boostTopSpeed).toBe(HOVER_MOVEMENT.boostTopSpeed);
    expect(grip.accel).toBe(HOVER_MOVEMENT.accel);
    expect(grip.brakeDecel).toBe(HOVER_MOVEMENT.brakeDecel);
    expect(grip.drag).toBe(HOVER_MOVEMENT.drag);
    expect(grip.coastDrag).toBe(0);
    expect(grip.easedBoundary).toBe(false);
    expect(grip.lateralResponse).toBe(0);
    // carve/ground keeps hover pace with momentum steering; flow/water the inverse.
    const carve = movementForTraversal('hover', { ...SKATEBOARD_TRAVERSAL });
    expect(carve.topSpeed).toBe(HOVER_MOVEMENT.topSpeed);
    expect(carve.easedBoundary).toBe(false);
    expect(carve.lateralResponse).toBeGreaterThan(0);
    const flowWater = movementForTraversal('hover', {
      label: 'T',
      handling: 'flow',
      surface: 'water',
      rider: 'none',
      propulsion: 'magic',
    });
    expect(flowWater.topSpeed).toBe(JETSKI_MOVEMENT.topSpeed);
    expect(flowWater.easedBoundary).toBe(true);
    expect(flowWater.coastDrag).toBe(JETSKI_MOVEMENT.coastDrag);
  });

  it('never lets label, rider, or propulsion drive physics', () => {
    const base = movementForTraversal('hover', { ...BICYCLE_TRAVERSAL });
    const renamed = movementForTraversal('hover', {
      ...BICYCLE_TRAVERSAL,
      label: 'Zorp Blaster 9000',
      rider: 'onFoot',
      propulsion: 'magic',
    });
    expect(renamed).toEqual(base);
    expect(handlingTuningFor({ ...SKATEBOARD_TRAVERSAL, label: 'Other' })).toEqual(
      handlingTuningFor({ ...SKATEBOARD_TRAVERSAL }),
    );
  });

  it('threads traversal through compiled circuits and omits it on legacy compiles', () => {
    expect(compileTrackVariant('ember').traversal).toBeUndefined();
    expect('traversal' in compileTrackVariant('ember')).toBe(false);
    expect(compileTrackVariant('ember', { traversal: { ...BICYCLE_TRAVERSAL } }).traversal).toEqual(
      BICYCLE_TRAVERSAL,
    );
    expect(() =>
      compileTrackVariant('ember', {
        traversal: { ...BICYCLE_TRAVERSAL, handling: 'sideways' },
      }),
    ).toThrow(/handling/);
  });
});

describe('traversal AI completion', () => {
  it('finishes valid circuits with no NaNs for every handling×surface combination', () => {
    const handlings: RacingHandling[] = [...RACING_HANDLINGS];
    const surfaces: RacingSurface[] = [...RACING_SURFACES];
    for (const handling of handlings) {
      for (const surface of surfaces) {
        const tag = `${handling}-${surface}`;
        const circuit = compileTrackVariant('ember', {
          traversal: { label: tag, handling, surface, rider: 'standing', propulsion: 'human' },
        });
        const race = createRaceFor(circuit);
        race.countdown = 0;
        const inputs = race.racers.map((): RacerInput => idle());
        const cap = Math.ceil((circuit.timeout + 5) / DT);
        for (let k = 0; k < cap && !race.over; k++) {
          for (let i = 0; i < race.racers.length; i++) aiInputFor(race, i, inputs[i]!);
          stepRace(race, inputs, DT);
        }
        expect(race.racers[PLAYER_INDEX]!.finished, `${tag} player finished`).toBe(true);
        expect(race.racers[PLAYER_INDEX]!.lap, `${tag} player laps`).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < race.racers.length; i++) {
          const r = race.racers[i]!;
          expect(r.lap, `${tag} racer ${i} laps`).toBeGreaterThanOrEqual(1);
          for (const v of [r.s, r.x, r.steerPos, r.latV, r.speed, r.boost, r.boostT, r.boostDelay, r.finishT]) {
            expect(Number.isFinite(v), `${tag} racer ${i} finite state`).toBe(true);
            expect(Number.isNaN(v), `${tag} racer ${i} no NaN`).toBe(false);
          }
          for (const t of r.lapTimes) expect(Number.isFinite(t), `${tag} racer ${i} finite laps`).toBe(true);
          expect(Math.abs(r.x), `${tag} racer ${i} bounds`).toBeLessThanOrEqual(BARRIER_X + 1e-6);
        }
      }
    }
  }, 120000);
});
