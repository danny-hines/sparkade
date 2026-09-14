import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { RacingSpec } from '@sparkade/shared';
import { lintRacing } from '../src/racing/lint';
import {
  aiInputFor,
  CHECKPOINT_FRACTIONS,
  clampForkX,
  compileTrackVariant,
  createRaceFor,
  forkBranchSide,
  forkCenterS,
  forkCrossSection,
  forkFor,
  type CompiledTrack,
  FORK_CURVE_MAX,
  FORK_ENTER,
  FORK_EXIT,
  FORK_ISLAND_HALF,
  FORK_KEEPOUT,
  FORK_LEFT_CENTER,
  FORK_OUTER_L,
  FORK_OUTER_R,
  FORK_RAMP_KEEPOUT,
  FORK_RIGHT_CENTER,
  FORK_ZONE,
  recordKey,
  resolveForks,
  ROAD_HALF,
  stepRace,
  stepRacer,
  type RacerInput,
} from '../src/racing/index';

const idle: RacerInput = { steer: 0, accel: false, brake: false, boost: false, drift: false };
const DT = 1 / 60;

function splitCircuit(template: 'ember' | 'coral' | 'ratchet' = 'ember', length = 3200) {
  const circuit = compileTrackVariant(template, { forks: 'split', length });
  if (circuit.fork === undefined) throw new Error(`no safe fork interval on ${template}@${length}`);
  return circuit;
}

describe('racing fork splits', () => {
  it('keeps legacy shape and records unchanged when omitted or none', () => {
    const a = compileTrackVariant('ember', {});
    const b = compileTrackVariant('ember', { forks: 'none' });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(a).not.toHaveProperty('fork');
    expect(createRaceFor(a).racers[0]).not.toHaveProperty('forkSide');
    expect(recordKey('x', 'course', a)).toEqual(recordKey('x', 'course', b));
    expect(() => resolveForks('triple')).toThrow();
  });

  it('places one safe deterministic split across templates, lengths and mirrors', () => {
    for (const t of ['ember', 'coral', 'ratchet'] as const) {
      for (const length of [2800, 3200, 3600]) {
        for (const mirror of [false, true]) {
          const c = compileTrackVariant(t, { length, mirror, forks: 'split' });
          // Omit-if-none: either absent or fully safe, never forced.
          if (c.fork === undefined) continue;
          expect(c.fork).toEqual(compileTrackVariant(t, { length, mirror, forks: 'split' }).fork);
          const { start, length: len } = c.fork;
          expect(c.pads.slice(1).some(p => p.start < start + len && p.start + p.length > start)).toBe(false);
          expect(len).toBe(FORK_ZONE);
          expect(start).toBeGreaterThan(0);
          expect(start + len).toBeLessThan(c.track.length);
          for (const g of [0, 0.25 * length, 0.5 * length, 0.75 * length]) {
            expect(Math.abs(start - g)).toBeGreaterThanOrEqual(FORK_KEEPOUT - 0.1);
            expect(Math.abs(start + len - g)).toBeGreaterThanOrEqual(FORK_KEEPOUT - 0.1);
          }
          for (let s = start - 40; s <= start + len + 40; s += 5) {
            expect(Math.abs(c.track.curvatureAt(s))).toBeLessThanOrEqual(FORK_CURVE_MAX);
          }
        }
      }
    }
  });

  it('keeps clear of ramp approach/landing when combined with jumps', () => {
    for (const t of ['ember', 'coral', 'ratchet'] as const) {
      const c = compileTrackVariant(t, { forks: 'split', jumps: 'ramps', length: 3200 });
      if (c.fork === undefined || c.ramps === undefined) continue;
      for (const r of c.ramps) {
        const lip = (r.s + r.length) % c.track.length;
        for (const p of [r.s, lip]) {
          let d = Math.abs(c.fork.start - p) % c.track.length;
          if (d > c.track.length / 2) d = c.track.length - d;
          expect(d).toBeGreaterThanOrEqual(FORK_RAMP_KEEPOUT - 0.1);
        }
      }
    }
  });

  it('blends from the legacy road to full lanes and back (renderer shape)', () => {
    const c = splitCircuit();
    const { start } = c.fork!;
    const before = forkCrossSection(c.fork!, start - 10, ROAD_HALF);
    expect(before.blend).toBe(0);
    expect(before.roadLo).toBe(-ROAD_HALF);
    expect(before.roadHi).toBe(ROAD_HALF);
    expect(before.leftCenter).toBe(0);
    expect(before.rightCenter).toBe(0);
    const mid = forkCrossSection(c.fork!, forkCenterS(c.fork!), ROAD_HALF);
    expect(mid.blend).toBe(1);
    expect(mid.roadLo).toBe(FORK_OUTER_L);
    expect(mid.roadHi).toBe(FORK_OUTER_R);
    expect(mid.islandLo).toBe(-FORK_ISLAND_HALF);
    expect(mid.islandHi).toBe(FORK_ISLAND_HALF);
    expect(mid.islandActive).toBe(true);
    expect(mid.rightLo - mid.leftHi).toBe(2); // genuine 2-unit island
    expect(mid.leftHi - mid.leftLo).toBeCloseTo(7, 8); // broad safe left
    expect(mid.rightHi - mid.rightLo).toBeCloseTo(5, 8); // narrow rewarded right
    expect(mid.leftCenter).toBe(FORK_LEFT_CENTER);
    expect(mid.rightCenter).toBe(FORK_RIGHT_CENTER);
    const exit = forkCrossSection(c.fork!, start + FORK_ZONE - 1, ROAD_HALF);
    expect(exit.blend).toBeGreaterThan(0);
    expect(exit.blend).toBeLessThan(0.05);
    // Equal-s lanes: gates, laps, and curvature still read the one centerline.
    expect(CHECKPOINT_FRACTIONS).toEqual([0.25, 0.5, 0.75]);
  });

  it('relocates one existing pad and one existing pickup into the narrow branch', () => {
    const c = splitCircuit();
    const mid = forkCenterS(c.fork!);
    expect(c.pads.length).toBe(2); // relocated, never added
    expect(c.pads[0]!.x).toBe(FORK_RIGHT_CENTER);
    expect(c.pads[0]!.length).toBe(90);
    expect(c.pads[0]!.start).toBeGreaterThanOrEqual(c.fork!.start + FORK_ENTER);
    expect(c.pads[0]!.start + c.pads[0]!.length).toBeLessThanOrEqual(
      c.fork!.start + FORK_ZONE - FORK_EXIT,
    );
    expect(c.pickups.length).toBe(4); // relocated, never added
    const moved = c.pickups.filter((p) => p.x === FORK_RIGHT_CENTER);
    expect(moved.length).toBe(1);
    expect(moved[0]!.s).toBe(mid);
  });

  it('blocks island crossing and holds commitment under full opposing steer', () => {
    for (const [startX, steer] of [
      [-1.5, 1],
      [1.5, -1],
    ] as const) {
      const circuit = splitCircuit();
      const race = createRaceFor(circuit, 0);
      const p = race.racers[0]!;
      p.s = circuit.fork!.start - 20;
      p.x = startX;
      p.speed = 70;
      let maxJump = 0;
      for (let n = 0; n < 900; n++) {
        const prevX = p.x;
        stepRacer(race, p, { ...idle, steer, accel: true }, DT);
        maxJump = Math.max(maxJump, Math.abs(p.x - prevX));
        const w = circuit.track.wrap(p.s);
        if (w > circuit.fork!.start && w < circuit.fork!.start + circuit.fork!.length) {
          const section = forkCrossSection(circuit.fork!, w, ROAD_HALF);
          if (section.islandActive) {
            if (steer > 0) expect(p.x).toBeLessThanOrEqual(section.islandLo + 1e-6);
            else expect(p.x).toBeGreaterThanOrEqual(section.islandHi - 1e-6);
          }
          expect(p.forkSide).toBe(startX < 0 ? -1 : 1);
        }
      }
      expect(maxJump).toBeLessThan(2); // no entry teleport, no lane flip
      // Commitment resets after the exit so the next lap re-commits cleanly.
      expect(p.forkSide).toBe(0);
    }
  });

  it('clamps tunneled input to the committed side (pure query)', () => {
    const c = splitCircuit();
    const mid = forkCenterS(c.fork!);
    expect(clampForkX(c.fork!, mid, ROAD_HALF, 5, -1)).toBe(-FORK_ISLAND_HALF);
    expect(clampForkX(c.fork!, mid, ROAD_HALF, -5, 1)).toBe(FORK_ISLAND_HALF);
    expect(clampForkX(c.fork!, mid, ROAD_HALF, -4.5, -1)).toBe(-4.5);
    expect(clampForkX(c.fork!, c.fork!.start - 50, ROAD_HALF, 5, -1)).toBe(5);
  });

  it('suppresses cross-island contacts but clamps same-lane shoves', () => {
    const circuit = splitCircuit();
    const d = 20; // entrance blend: island active, lanes nearly merged
    const s = circuit.fork!.start + d;
    const race = createRaceFor(circuit, 0);
    for (const r of race.racers.slice(2)) r.finished = true;
    const [a, b] = [race.racers[0]!, race.racers[1]!];
    a.s = s;
    b.s = s;
    a.speed = 0;
    b.speed = 0;
    a.x = -0.6;
    b.x = 0.6;
    stepRace(
      race,
      race.racers.map(() => idle),
      DT,
    );
    expect(a.x).toBe(-0.6);
    expect(b.x).toBe(0.6);
    // Same lane: the shove lands but never crosses the island.
    const mid = forkCenterS(circuit.fork!);
    a.s = mid;
    b.s = mid;
    a.speed = 0;
    b.speed = 0;
    a.x = -4.0;
    b.x = -3.0;
    a.forkSide = -1;
    b.forkSide = -1;
    for (let n = 0; n < 60; n++)
      stepRace(
        race,
        race.racers.map(() => idle),
        DT,
      );
    expect(b.x).toBeLessThanOrEqual(-FORK_ISLAND_HALF + 1e-6);
    expect(a.x).toBeGreaterThanOrEqual(FORK_OUTER_L - 2.2 - 1e-6);
  });

  it('drives AI to both branches and finishes the full race', () => {
    const circuit = splitCircuit('ember', 3200);
    const race = createRaceFor(circuit, 0);
    const mid = forkCenterS(circuit.fork!);
    const seen = new Map<number, number>();
    for (let n = 0; !race.over && n < 25000; n++) {
      stepRace(
        race,
        race.racers.map((_, i) => aiInputFor(race, i)),
        DT,
      );
      for (let i = 0; i < race.racers.length; i++) {
        const r = race.racers[i]!;
        if (r.finished) continue;
        const w = circuit.track.wrap(r.s);
        if (Math.abs(w - mid) < 3 && (r.forkSide ?? 0) !== 0 && !seen.has(i)) {
          seen.set(i, r.forkSide!);
        }
      }
    }
    expect(race.racers[0]!.finished).toBe(true);
    expect(seen.size).toBe(5);
    for (let i = 0; i < 5; i++) expect(seen.get(i)).toBe(forkBranchSide(i));
    // Lap integrity is untouched: one centerline, same gates, same laps.
    for (const r of race.racers) {
      expect(r.lap).toBeGreaterThanOrEqual(circuit.laps - 1);
      expect(r.lapTimes.length).toBe(r.lap);
    }
  });

  it('segregates records by fork layout only', () => {
    const plain = compileTrackVariant('ember', { length: 3200 });
    const forked = compileTrackVariant('ember', { length: 3200, forks: 'split' });
    expect(forked.fork).toBeDefined();
    expect(recordKey('g', 'c', forked)).not.toEqual(recordKey('g', 'c', plain));
    expect(recordKey('g', 'c', forked)).toContain('fork');
    expect(recordKey('g', 'c', forked)).toEqual(
      recordKey('g', 'c', compileTrackVariant('ember', { length: 3200, forks: 'split' })),
    );
  });
  it('rejects a promised split with no safe layout instead of silently dropping it', () => {
    const spec = JSON.parse(readFileSync(new URL('../../generation/golden/golden-racing.json', import.meta.url), 'utf8')) as RacingSpec;
    const course = spec.levels.find(l => l.template === 'ember')!;
    course.forks = 'split'; course.length = 3200;
    expect(lintRacing(spec).filter(e => e.code === 'RACING_FORK_LAYOUT')).toHaveLength(0);
    course.jumps = 'ramps';
    expect(lintRacing(spec).some(e => e.code === 'RACING_FORK_LAYOUT')).toBe(true);
  });

  it('only triggers the branch pad within its visibly painted road interval', () => {
    for (const [x, expected] of [[-1.5, false], [5.8, true], [6.2, false]] as const) {
      const c = splitCircuit();
      const race = createRaceFor(c, 0), p = race.racers[0]!;
      p.s = forkCenterS(c.fork!); p.x = x; p.speed = 70; p.boostT = 0;
      stepRacer(race, p, idle, DT);
      expect(p.padOn).toBe(expected);
      expect(p.boostT > 0).toBe(expected);
    }
  });

  it('rejects a fork in the landing margin of a ramp wrapping through the finish', () => {
    const track = {
      length: 3200,
      curvatureAt: (s: number) => s >= 90 && s <= 470 ? 0 : 1,
    } as CompiledTrack;
    expect(forkFor(track)).toBeDefined();
    expect(forkFor(track, [{ s: 3190, length: 30 }])).toBeUndefined();
  });

});
