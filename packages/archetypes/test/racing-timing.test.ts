// Personal timing records: keys, validation, storage, attempt lifecycle.
// Pure timing module + read-only game wiring; no DOM, no real localStorage.
import { describe, expect, it } from 'vitest';
import type { EngineContext, GameInstance, InputSnapshot } from '@sparkade/engine';
import { LOGICAL_BUTTONS } from '@sparkade/shared';
import {
  FIRST_FLYING_LAP,
  TIMING_GATES,
  TIMING_VERSION,
  formatDelta,
  geometrySignature,
  LapAttempt,
  localStorageStore,
  memoryStore,
  PersonalBests,
  recordKey,
  validateBest,
  type BestStore,
} from '../src/racing/timing';
import { RACE_CIRCUITS, compileTrackVariant } from '../src/racing/track';
import { createRacingGame, type RacingDevHandle } from '../src/racing/game';

const DT = 1 / 60;

function throwingStore(): BestStore {
  return {
    load: () => {
      throw new Error('blocked');
    },
    save: () => {
      throw new Error('quota');
    },
  };
}

describe('record keys', () => {
  const circuit = RACE_CIRCUITS[0]!;
  it('is versioned, stable, and not display-name-only', () => {
    const a = recordKey('game', 'course', circuit);
    expect(a).toContain(`pbv${TIMING_VERSION}`);
    expect(a).not.toContain(circuit.name);
    expect(recordKey('game', 'course', circuit)).toBe(a);
    expect(recordKey('game', 'course', { ...circuit, name: 'Renamed' })).toBe(a);
  });
  it('isolates mirror, length, pads, and game identity', () => {
    const base = recordKey('game', 'course', circuit);
    const mirror = compileTrackVariant(circuit.id, { mirror: true });
    const longer = compileTrackVariant(circuit.id, { length: 3600 });
    expect(recordKey('game', 'course', { ...circuit, track: mirror.track })).not.toBe(base);
    expect(recordKey('game', 'course', { ...circuit, track: longer.track })).not.toBe(base);
    expect(
      recordKey('game', 'course', { ...circuit, pads: [{ start: 500, length: 60 }] }),
    ).not.toBe(base);
    expect(recordKey('other-game', 'course', circuit)).not.toBe(base);
    expect(geometrySignature(mirror.track)).not.toBe(geometrySignature(circuit.track));
  });
});

describe('record validation and storage', () => {
  const good = { lap: 42.1, splits: [10.5, 21.0, 31.5, 42.1] };
  it('accepts gate-matched records, rejects corrupt shapes', () => {
    expect(TIMING_GATES).toBe(4);
    expect(validateBest(good)).toEqual(good);
    expect(validateBest(null)).toBeNull();
    expect(validateBest('42.1')).toBeNull();
    expect(validateBest({ lap: -1, splits: good.splits })).toBeNull();
    expect(validateBest({ lap: 42.1, splits: [10.5, 21.0, 31.5] })).toBeNull();
    expect(validateBest({ lap: 42.1, splits: [21.0, 10.5, 31.5, 42.1] })).toBeNull();
    expect(validateBest({ lap: 42.1, splits: [10.5, 21.0, 31.5, 40.0] })).toBeNull();
    expect(validateBest({ lap: Infinity, splits: good.splits })).toBeNull();
  });
  it('survives corrupt payloads and blocked storage without throwing', () => {
    const mem = memoryStore();
    mem.save('k', 'not-json{{{');
    const reg = new PersonalBests(mem, 'game');
    expect(reg.get('course', RACE_CIRCUITS[0]!)).toBeNull();
    const blocked = new PersonalBests(throwingStore(), 'game');
    expect(blocked.get('course', RACE_CIRCUITS[0]!)).toBeNull();
    expect(() => blocked.set('course', RACE_CIRCUITS[0]!, { ...good })).not.toThrow();
  });
  it('persists across instances over a shared store and bounds the cache', () => {
    const shared = memoryStore();
    const a = new PersonalBests(shared, 'game');
    const circuit = RACE_CIRCUITS[0]!;
    a.set('course', circuit, { ...good });
    const b = new PersonalBests(shared, 'game');
    expect(b.get('course', circuit)).toEqual(good);
    // 33 distinct courses: oldest cache entry evicts but reloads from store.
    for (let i = 0; i < 33; i++) {
      a.set(`course-${i}`, circuit, { lap: 50 + i, splits: [10 + i, 20 + i, 30 + i, 50 + i] });
    }
    expect(a.get('course-0', circuit)).toEqual({ lap: 50, splits: [10, 20, 30, 50] });
  });
  it('falls back to memory when localStorage is unavailable', () => {
    const store = localStorageStore('test.');
    const reg = new PersonalBests(store, 'game');
    reg.set('course', RACE_CIRCUITS[0]!, { ...good });
    expect(reg.get('course', RACE_CIRCUITS[0]!)).toEqual(good);
  });
});

describe('lap attempts', () => {
  function drive(
    att: LapAttempt,
    gates: Array<[number, number, number, number, boolean?]>,
    auto = false,
  ) {
    let res = null;
    for (const [t, lap, cp, start, stepAuto] of gates) {
      res = att.observe({ t, lap, nextCp: cp }, start, stepAuto ?? auto);
    }
    return res;
  }
  it('banks sequential gates but holds the standing-start lap as out-lap', () => {
    const att = new LapAttempt();
    expect(FIRST_FLYING_LAP).toBe(2);
    // Out-lap: full gate sequence, banked as lap 1 -> ineligible.
    expect(
      drive(att, [
        [0, 0, 0, 0],
        [10, 0, 1, 0],
        [22, 0, 2, 0],
        [35, 0, 3, 0],
        [50, 1, 0, 50],
      ]),
    ).toBeNull();
    // Flying lap: same shape -> recorded with frozen cumulative splits.
    const res = drive(att, [
      [60, 1, 1, 50],
      [71, 1, 2, 50],
      [83, 1, 3, 50],
      [97, 2, 0, 97],
    ]);
    expect(res).toEqual({ lapTime: 47, splits: [10, 21, 33, 47] });
  });
  it('voids on reversal, autopilot, restart, and skipped gates', () => {
    let att = new LapAttempt();
    expect(
      drive(att, [
        [0, 1, 0, 0],
        [10, 1, 1, 0],
        [12, 1, 0, 0],
        [30, 1, 1, 0],
        [40, 1, 2, 0],
        [50, 1, 3, 0],
        [60, 2, 0, 60],
      ]),
    ).toBeNull();
    att = new LapAttempt();
    expect(
      drive(
        att,
        [
          [0, 1, 0, 0],
          [10, 1, 1, 0],
          [20, 1, 2, 0],
          [30, 1, 3, 0],
          [40, 2, 0, 40],
        ],
        true,
      ),
    ).toBeNull();
    // Auto switched on mid-lap then off before the finish: still void.
    att = new LapAttempt();
    expect(
      drive(att, [
        [0, 1, 0, 0, false],
        [10, 1, 1, 0, true],
        [20, 1, 2, 0, false],
        [30, 1, 3, 0, false],
        [40, 2, 0, 40, false],
      ]),
    ).toBeNull();
    att = new LapAttempt();
    drive(att, [
      [0, 1, 0, 0],
      [10, 1, 1, 0],
    ]);
    att.reset(); // restart clears transient progress, not saved records
    expect(
      drive(att, [
        [100, 0, 0, 100],
        [110, 0, 1, 100],
        [122, 0, 2, 100],
        [135, 0, 3, 100],
        [150, 1, 0, 150],
      ]),
    ).toBeNull();
    att = new LapAttempt();
    expect(
      drive(att, [
        [0, 1, 0, 0],
        [30, 1, 3, 0],
        [40, 2, 0, 40],
      ]),
    ).toBeNull();
  });
  it('formats deltas with words and sign', () => {
    expect(formatDelta(-0.5)).toEqual({ text: '-0.50', ahead: true });
    expect(formatDelta(1.234)).toEqual({ text: '+1.23', ahead: false });
  });
});

describe('timing game wiring', () => {
  function snapshotInput(): InputSnapshot {
    const input = {} as InputSnapshot;
    for (const button of LOGICAL_BUTTONS) {
      input[button] = { held: false, pressed: false, released: false };
    }
    return input;
  }
  it('exposes read-only timing status with a versioned key', () => {
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
    const game = createRacingGame(engine) as GameInstance & RacingDevHandle;
    game.start();
    game.update(DT, snapshotInput());
    const snap = game.racingDev.snapshot();
    expect(snap.timing.key).toContain(`pbv${TIMING_VERSION}`);
    expect(snap.timing.best).toBeNull();
    expect(snap.timing.delta).toBeNull();
    expect(snap.timing.eligible).toBe(false);
    game.dispose();
  });
});
