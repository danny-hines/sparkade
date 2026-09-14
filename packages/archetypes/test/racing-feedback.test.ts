// Corner warnings + rival context: pure-helper behavior tests. No DOM,
// no rendering; rendering consumes these helpers (host browser-verifies).
import { describe, expect, it } from 'vitest';
import {
  BOARD_OFFSETS,
  analyzeBends,
  bannerStale,
  boardChevrons,
  boardsFor,
  nearestRival,
  nextBend,
  positionEvent,
  UNITS_TO_M,
  type Bend,
} from '../src/racing/feedback';
import { LapAttempt, PersonalBests, memoryStore } from '../src/racing/timing';
import { gameIdentity } from '../src/racing/game';
import { RACE_CIRCUITS, compileTrackVariant } from '../src/racing/track';
import { createRaceFor } from '../src/racing/simulation';

describe('bend analysis', () => {
  it('is deterministic, grouped, and severity-graded on every template', () => {
    for (const circuit of RACE_CIRCUITS) {
      const a = analyzeBends(circuit);
      expect(analyzeBends(circuit)).toEqual(a);
      expect(a.length).toBeGreaterThan(2); // no whole-course collapse
      expect(a.length).toBeLessThan(40); // grouped regions, not chatter
      for (const bend of a) {
        expect(['SWEEP', 'SHARP', 'TIGHT']).toContain(bend.severity);
        expect(bend.start).toBeGreaterThanOrEqual(0);
        expect(bend.start).toBeLessThan(circuit.track.length);
        // Direction agrees with the region's own start curvature and peak.
        expect(Math.sign(circuit.track.curvatureAt(bend.start)) || bend.dir).toBe(bend.dir);
        expect(Math.sign(bend.peak)).toBe(bend.dir);
        const sev =
          Math.abs(bend.peak) >= 0.012 ? 'TIGHT' : Math.abs(bend.peak) >= 0.007 ? 'SHARP' : 'SWEEP';
        expect(bend.severity).toBe(sev);
      }
    }
    const ember = analyzeBends(RACE_CIRCUITS[0]!);
    expect(ember.some((x) => x.severity === 'TIGHT')).toBe(true); // max .0189
    const ratchet = analyzeBends(RACE_CIRCUITS[2]!);
    expect(ratchet.some((x) => x.severity === 'TIGHT')).toBe(true); // max .0194
  });
  it('keeps adjacent opposite bends separate (synthetic S-curve)', () => {
    const len = 1000;
    const track = {
      length: len,
      curvatureAt: (s: number): number => {
        if (s >= 100 && s < 300) return 0.015;
        if (s >= 340 && s < 540) return -0.015;
        return 0;
      },
    };
    const bends = analyzeBends({ track } as never);
    expect(bends.length).toBe(2);
    expect(bends[0]!.dir).toBe(1);
    expect(bends[0]!.severity).toBe('TIGHT');
    expect(bends[1]!.dir).toBe(-1);
    expect(bends[1]!.severity).toBe('TIGHT');
  });
  it('groups one bend spanning the finish seam', () => {
    const len = 1000;
    const track = {
      length: len,
      curvatureAt: (s: number): number => (s >= len - 100 || s < 100 ? 0.01 : 0),
    };
    const bends = analyzeBends({ track } as never);
    expect(bends.length).toBe(1);
    expect(bends[0]!.dir).toBe(1);
    expect(bends[0]!.severity).toBe('SHARP');
  });
  it('reverses direction (not severity) on mirrored variants', () => {
    const circuit = RACE_CIRCUITS[0]!;
    const plain = analyzeBends(circuit);
    const variant = compileTrackVariant(circuit.id, { mirror: true });
    const mirrored = analyzeBends({ ...circuit, track: variant.track });
    expect(mirrored.length).toBe(plain.length);
    const sev = (xs: Array<{ severity: string }>) => xs.map((x) => x.severity).sort().join(',');
    expect(sev(mirrored)).toBe(sev(plain));
    // Every bend flips direction (multiset negated), severity untouched.
    const dirs = (xs: Bend[]) => xs.map((x) => x.dir).sort((x, y) => x - y).join(',');
    expect(dirs(mirrored)).toBe(
      dirs(plain)
        .split(',')
        .map((d) => String(-Number(d)))
        .sort()
        .join(','),
    );
  });
  it('is stable and deterministic on altered-length geometry', () => {
    const circuit = RACE_CIRCUITS[0]!;
    const longer = compileTrackVariant(circuit.id, { length: 3600 });
    const a = analyzeBends({ ...circuit, track: longer.track });
    const b = analyzeBends({ ...circuit, track: longer.track });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('upcoming bend distance', () => {
  const bends = [
    { start: 100, peak: 0.01, dir: 1 as const, severity: 'SHARP' as const },
    { start: 500, peak: -0.015, dir: -1 as const, severity: 'TIGHT' as const },
  ];
  it('shrinks monotonically on approach and wraps past the bend', () => {
    const d90 = nextBend(bends, 90, 1000)!;
    const d95 = nextBend(bends, 95, 1000)!;
    const d99 = nextBend(bends, 99, 1000)!;
    expect(d90.dist).toBe(10);
    expect(d95.dist).toBeLessThan(d90.dist);
    expect(d99.dist).toBeLessThan(d95.dist);
    // Just past the bend start: the NEXT bend is due, far away.
    const past = nextBend(bends, 110, 1000)!;
    expect(past.bend.start).toBe(500);
    expect(past.dist).toBe(390);
  });
  it('wraps correctly at the finish seam', () => {
    const near = nextBend(bends, 990, 1000)!;
    expect(near.bend.start).toBe(100);
    expect(near.dist).toBe(110);
  });
  it('anchors approach boards at fixed wrapped offsets', () => {
    expect(boardsFor(500, 1000)).toEqual([460, 420, 380]);
    expect(boardsFor(30, 1000)).toEqual([990, 950, 910]);
    expect(BOARD_OFFSETS).toEqual([40, 80, 120]);
    expect(UNITS_TO_M).toBeCloseTo(2 / 3, 9);
  });
  it('counts down 3 far to 1 near and retires stale banners', () => {
    expect(boardChevrons(0)).toBe(1);
    expect(boardChevrons(1)).toBe(2);
    expect(boardChevrons(2)).toBe(3);
    expect(bannerStale(null, 3)).toBe(false);
    expect(bannerStale(2, 2)).toBe(false);
    expect(bannerStale(2, 3)).toBe(true);
  });
});

describe('nearest rival', () => {
  function field(): { race: ReturnType<typeof createRaceFor>; names: string[] } {
    const race = createRaceFor({ ...RACE_CIRCUITS[0]!, laps: 1 }, 0);
    return { race, names: ['YOU', 'VEX', 'JUNO', 'PIP', 'KAZ'] };
  }
  it('signs gaps by progress and never crowns a lapped car ahead', () => {
    const { race, names } = field();
    const len = race.circuit.track.length;
    race.racers[0]!.s = 1000;
    race.racers[1]!.s = 1030; // genuinely ahead
    race.racers[2]!.s = 1000 - len + 50; // lapped down, physically ahead on road
    race.racers[3]!.s = 900;
    race.racers[4]!.s = 800;
    const near = nearestRival(race, names)!;
    expect(near.index).toBe(1);
    expect(near.side).toBe('AHEAD');
    expect(near.gap).toBeCloseTo(30, 9);
    // The lapped car in isolation reports BEHIND by a lap, not AHEAD —
    // even though it sits 50 units ahead on the road on screen.
    race.racers[1]!.s = 1000 + len + 600;
    race.racers[3]!.s = 1000 - len - 600;
    race.racers[4]!.s = 1000 - len - 500;
    const lapped = nearestRival(race, names)!;
    expect(lapped.index).toBe(2);
    expect(lapped.side).toBe('BEHIND');
    expect(lapped.gap).toBeLessThan(-len / 2);
  });
  it('calls close gaps ALONGSIDE and tolerates finished racers', () => {
    const { race, names } = field();
    race.racers[0]!.s = 1000;
    race.racers[1]!.s = 1004;
    race.racers[1]!.finished = true;
    race.racers[2]!.s = 0;
    race.racers[3]!.s = -500;
    race.racers[4]!.s = -900;
    const near = nearestRival(race, names)!;
    expect(near.side).toBe('ALONGSIDE');
  });
});

describe('position events', () => {
  it('announces destination, initializes silently, and cools down', () => {
    let st = positionEvent(3, null, 10, -1e9);
    expect(st.text).toBeNull();
    expect(st.shown).toBe(3);
    st = positionEvent(2, st.shown, 20, st.eventT);
    expect(st.text).toBe('GAINED P2');
    // Oscillating contact inside cooldown: no spam, tracking follows.
    const spam = positionEvent(3, st.shown, 22, st.eventT);
    expect(spam.text).toBeNull();
    expect(spam.shown).toBe(3);
    const later = positionEvent(4, spam.shown, 30, st.eventT);
    expect(later.text).toBe('LOST P4');
  });
});

describe('M1 corrections', () => {
  it('isolates game identity by seed and sanitizes delimiters', () => {
    const a = gameIdentity({ seed: 7, meta: { title: 'Cup' } } as never);
    const b = gameIdentity({ seed: 8, meta: { title: 'Cup' } } as never);
    expect(a).not.toBe(b);
    expect(a).toContain('7');
    const pipe = gameIdentity({ seed: 7, meta: { title: 'A|B' } } as never);
    expect(pipe).not.toContain('|');
    expect(gameIdentity(undefined)).toBe('Ember Cup~0');
  });
  it('does not re-arm recording while autopilot stays on, recovers after', () => {
    const att = new LapAttempt();
    const step = (t: number, lap: number, cp: number, start: number, auto: boolean) =>
      att.observe({ t, lap, nextCp: cp }, start, auto);
    step(0, 1, 0, 0, false);
    step(10, 1, 1, 0, false);
    step(20, 1, 2, 0, false);
    step(30, 1, 3, 0, false);
    expect(step(40, 2, 0, 40, true)).toBeNull(); // auto bank voids
    expect(att.live).toBe(false);
    // Auto still on: next lap cannot record either.
    expect(step(50, 2, 1, 40, true)).toBeNull();
    expect(att.live).toBe(false);
    // Auto off for a whole clean lap: recording resumes.
    step(60, 2, 2, 40, false);
    step(70, 2, 3, 40, false);
    expect(att.live).toBe(false); // this lap was already voided at its start
    const res = step(80, 3, 0, 80, false);
    expect(res).toBeNull();
    step(90, 3, 1, 80, false);
    step(100, 3, 2, 80, false);
    step(110, 3, 3, 80, false);
    const res2 = step(120, 4, 0, 120, false);
    expect(res2).not.toBeNull();
  });
  it('keeps seed-distinct registries from sharing records', () => {
    const circuit = RACE_CIRCUITS[0]!;
    const shared = memoryStore();
    const ra = new PersonalBests(shared, gameIdentity({ seed: 1, meta: { title: 'Cup' } } as never));
    const rb = new PersonalBests(shared, gameIdentity({ seed: 2, meta: { title: 'Cup' } } as never));
    ra.set('ember#0', circuit, { lap: 50, splits: [10, 20, 30, 50] });
    expect(rb.get('ember#0', circuit)).toBeNull();
  });
});
