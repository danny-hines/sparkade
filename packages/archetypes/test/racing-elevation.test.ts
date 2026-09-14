// Racing elevation milestone: bounded periodic height profiles, grade
// physics, record segregation, and flat-equivalence preservation.
import { describe, expect, it } from 'vitest';
import { RACING_HANDLINGS, RACING_SURFACES } from '@sparkade/shared';
import {
  compileTrackVariant,
  createRaceFor,
  geometrySignature,
  recordKey,
  resolveElevation,
  trackGradeAt,
  trackHeightAt,
  aiInputFor,
  stepRace,
  type RaceState,
  type RacerInput,
  type RacingHandling,
  type RacingSurface,
} from '../src/racing/index';

const DT = 1 / 60;
const TEMPLATES = ['ember', 'coral', 'ratchet'] as const;
const KINDS = ['rolling', 'ridge'] as const;

function coast(): RacerInput {
  return { steer: 0, accel: false, brake: false, boost: false, drift: false };
}

function driveAllAI(race: RaceState): RacerInput[] {
  return race.racers.map((_, i) => aiInputFor(race, i));
}

/** Step a full race with AI drivers until over; returns steps taken. */
function runRace(race: RaceState, maxSteps: number): number {
  let steps = 0;
  while (!race.over && steps < maxSteps) {
    stepRace(race, driveAllAI(race), DT);
    steps++;
  }
  return steps;
}

describe('elevation validation', () => {
  it('resolves omission/flat to undefined and rejects unknown values', () => {
    expect(resolveElevation(undefined)).toBeUndefined();
    expect(resolveElevation('flat')).toBeUndefined();
    expect(resolveElevation('rolling')).toBe('rolling');
    expect(() => resolveElevation('alps')).toThrow(/elevation/);
    expect(() => compileTrackVariant('ember', { elevation: 'alps' as never })).toThrow(/elevation/);
  });
});

describe('elevation profiles', () => {
  it('is periodic in height and slope with no step at the start', () => {
    for (const template of TEMPLATES) {
      for (const kind of KINDS) {
        for (const length of [2800, 3400, 3600]) {
          for (const mirror of [false, true]) {
            const { track } = compileTrackVariant(template, { length, mirror, elevation: kind });
            const L = track.length;
            expect(track.elevationProfile?.kind).toBe(kind);
            expect(track.heightAt!(0)).toBe(0);
            // Wrap periodicity: height and slope match across the seam.
            expect(track.heightAt!(L)).toBeCloseTo(track.heightAt!(0), 9);
            expect(track.gradeAt!(L)).toBeCloseTo(track.gradeAt!(0), 9);
            expect(track.heightAt!(-37.5)).toBeCloseTo(track.heightAt!(L - 37.5), 9);
            // Dense continuity sweep: no jumps anywhere on the lap.
            const N = 720;
            let prev = track.heightAt!(0);
            for (let k = 1; k <= N; k++) {
              const h = track.heightAt!((k / N) * L);
              expect(Math.abs(h - prev)).toBeLessThan(0.6);
              prev = h;
            }
          }
        }
      }
    }
  });

  it('stays within amplitude and grade bounds on every template', () => {
    for (const template of TEMPLATES) {
      for (const kind of KINDS) {
        for (const length of [2800, 3600]) {
          const { track } = compileTrackVariant(template, { length, elevation: kind });
          const N = 1440;
          let maxH = 0;
          let maxG = 0;
          for (let k = 0; k < N; k++) {
            const s = (k / N) * track.length;
            maxH = Math.max(maxH, Math.abs(track.heightAt!(s)));
            maxG = Math.max(maxG, Math.abs(track.gradeAt!(s)));
          }
          expect(maxH).toBeGreaterThan(2); // readable rises, not noise
          expect(maxH).toBeLessThanOrEqual(20);
          expect(maxG).toBeLessThanOrEqual(0.12);
        }
      }
    }
  });

  it('keeps every height/grade sample finite', () => {
    for (const template of TEMPLATES) {
      for (const kind of KINDS) {
        const { track } = compileTrackVariant(template, { elevation: kind });
        for (let k = 0; k < 360; k++) {
          const s = (k / 360) * track.length;
          expect(Number.isFinite(track.heightAt!(s))).toBe(true);
          expect(Number.isFinite(track.gradeAt!(s))).toBe(true);
        }
      }
    }
  });

  it('is independent of mirror except for horizontal geometry', () => {
    for (const template of TEMPLATES) {
      for (const kind of KINDS) {
        const a = compileTrackVariant(template, { elevation: kind });
        const b = compileTrackVariant(template, { mirror: true, elevation: kind });
        expect(a.track.length).toBeCloseTo(b.track.length, 6);
        for (let k = 0; k < 120; k++) {
          const s = (k / 120) * a.track.length;
          expect(b.track.heightAt!(s)).toBeCloseTo(a.track.heightAt!(s), 9);
          expect(b.track.gradeAt!(s)).toBeCloseTo(a.track.gradeAt!(s), 9);
          // Horizontal geometry mirrors: x negates, y matches.
          expect(b.track.pointAt(s).x).toBeCloseTo(-a.track.pointAt(s).x, 6);
          expect(b.track.pointAt(s).y).toBeCloseTo(a.track.pointAt(s).y, 6);
        }
      }
    }
  });
});

describe('flat equivalence', () => {
  it('omits elevation keys and preserves geometry, signatures, and record keys', () => {
    for (const template of TEMPLATES) {
      const legacy = compileTrackVariant(template);
      const flat = compileTrackVariant(template, { elevation: 'flat' });
      expect('elevationProfile' in legacy.track).toBe(false);
      expect('heightAt' in legacy.track).toBe(false);
      expect('gradeAt' in legacy.track).toBe(false);
      expect(Object.keys(flat.track)).toEqual(Object.keys(legacy.track));
      expect(flat.track.length).toBe(legacy.track.length);
      for (let k = 0; k < 60; k++) {
        const s = (k / 60) * legacy.track.length;
        expect(flat.track.pointAt(s)).toEqual(legacy.track.pointAt(s));
        expect(flat.track.curvatureAt(s)).toBe(legacy.track.curvatureAt(s));
      }
      expect(geometrySignature(flat.track)).toBe(geometrySignature(legacy.track));
      expect(recordKey('g', 'c', flat)).toBe(recordKey('g', 'c', legacy));
      // Legacy-safe helpers read exactly zero without elevation.
      expect(trackHeightAt(legacy.track, 123)).toBe(0);
      expect(trackGradeAt(legacy.track, 123)).toBe(0);
    }
  });

  it('runs the exact legacy trajectory when height is omitted', () => {
    const steer: RacerInput = { steer: 0.4, accel: true, brake: false, boost: false, drift: false };
    const snapshots: string[] = [];
    for (const circuit of [compileTrackVariant('ember'), compileTrackVariant('ember', { elevation: 'flat' })]) {
      const race = createRaceFor(circuit, 0);
      for (let k = 0; k < 600; k++) {
        stepRace(race, race.racers.map(() => ({ ...steer })), DT);
      }
      snapshots.push(JSON.stringify(race.racers.map((r) => [r.s, r.x, r.speed, r.boost, r.lap])));
    }
    expect(snapshots[1]).toBe(snapshots[0]);
  });
});

describe('elevation record segregation', () => {
  it('appends an elevation segment only for non-flat tracks', () => {
    const flat = compileTrackVariant('ember');
    const rolling = compileTrackVariant('ember', { elevation: 'rolling' });
    const ridge = compileTrackVariant('ember', { elevation: 'ridge' });
    const flatKey = recordKey('game', 'course', flat);
    expect(recordKey('game', 'course', rolling)).not.toBe(flatKey);
    expect(recordKey('game', 'course', ridge)).not.toBe(flatKey);
    expect(recordKey('game', 'course', rolling)).toContain('elevrolling');
    expect(recordKey('game', 'course', ridge)).toContain('elevridge');
    expect(recordKey('game', 'course', rolling)).not.toBe(recordKey('game', 'course', ridge));
  });
});

describe('grade physics', () => {
  it('coasts faster downhill than uphill with the same rule for every racer', () => {
    const elevated = compileTrackVariant('ember', { elevation: 'ridge' });
    const { track } = elevated;
    // Steepest descent/ascent from a dense grade scan.
    let sDown = 0;
    let sUp = 0;
    let minG = Infinity;
    let maxG = -Infinity;
    for (let k = 0; k < 720; k++) {
      const s = (k / 720) * track.length;
      const g = track.gradeAt!(s);
      if (g < minG) {
        minG = g;
        sDown = s;
      }
      if (g > maxG) {
        maxG = g;
        sUp = s;
      }
    }
    expect(minG).toBeLessThan(-0.01);
    expect(maxG).toBeGreaterThan(0.01);
    // Coast (no accel/brake/boost) with a centering steer so bend load never
    // scrapes the barrier; longitudinal pace is the only thing compared.
    function coastFinal(startS: number): number[] {
      const race = createRaceFor(elevated, 0);
      for (const r of race.racers) {
        r.s = startS;
        r.gateS = startS;
        r.speed = 60;
      }
      for (let k = 0; k < 300; k++) {
        stepRace(
          race,
          race.racers.map((r) => ({ ...coast(), steer: Math.max(-1, Math.min(1, -r.x * 0.6)) })),
          DT,
        );
      }
      return race.racers.map((r) => r.speed);
    }
    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const down = avg(coastFinal(sDown));
    const up = avg(coastFinal(sUp));
    expect(down - up).toBeGreaterThan(1);
    // Flat control at the same start: grade is the systematic difference.
    const flatRace = createRaceFor(compileTrackVariant('ember'), 0);
    for (const r of flatRace.racers) {
      r.s = sDown;
      r.gateS = sDown;
      r.speed = 60;
    }
    for (let k = 0; k < 300; k++) {
      stepRace(
        flatRace,
        flatRace.racers.map((r) => ({ ...coast(), steer: Math.max(-1, Math.min(1, -r.x * 0.6)) })),
        DT,
      );
    }
    const flat = avg(flatRace.racers.map((r) => r.speed));
    expect(down).toBeGreaterThan(flat);
    expect(flat).toBeGreaterThan(up);
  });
});

describe('elevated cup completion', () => {
  it.each(TEMPLATES)('finishes a full 3-lap race on %s with rolling and ridge', (template) => {
    for (const kind of KINDS) {
      const circuit = compileTrackVariant(template, { elevation: kind });
      expect(circuit.laps).toBe(3);
      const race = createRaceFor(circuit, 0);
      const steps = runRace(race, 60 * 400);
      expect(race.over).toBe(true);
      expect(race.racers[0]!.finished).toBe(true);
      expect(race.racers[0]!.lapTimes).toHaveLength(3);
      expect(steps).toBeLessThan(60 * 400);
      for (const r of race.racers) {
        expect(Number.isFinite(r.s)).toBe(true);
        expect(Number.isFinite(r.speed)).toBe(true);
      }
    }
  }, 60000);

  it('finishes rolling races for 4 handling x 2 surface traversals', () => {
    const handlings = RACING_HANDLINGS as readonly RacingHandling[];
    const surfaces = RACING_SURFACES as readonly RacingSurface[];
    expect(handlings).toHaveLength(4);
    expect(surfaces).toHaveLength(2);
    for (const handling of handlings) {
      for (const surface of surfaces) {
        const circuit = compileTrackVariant('ember', {
          elevation: 'rolling',
          traversal: { label: 'slope test', handling, surface, rider: 'seated', propulsion: 'motor' },
        });
        const race = createRaceFor(circuit, 0);
        runRace(race, 60 * 400);
        expect(race.over).toBe(true);
        expect(race.racers[0]!.finished).toBe(true);
      }
    }
  }, 90000);
});
