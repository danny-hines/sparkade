// Personal timing records: best lap + checkpoint splits per generated course.
// Pure logic, no DOM/storage: persistence arrives through the injectable
// BestStore (localStorage adapter or memory fallback). The simulation and
// race clock are untouched — this only observes gate/lap state.

import { CHECKPOINT_FRACTIONS, type RaceCircuit } from './track';

/** Bump when physics or timing rules change enough to obsolete records. */
export const TIMING_VERSION = 3;
/** Gates per lap: one split per checkpoint plus the finish. */
export const TIMING_GATES = CHECKPOINT_FRACTIONS.length + 1;
/** Bounded in-memory record cache (LRU eviction). */
export const MAX_CACHED_RECORDS = 32;
/** First banked lap covers the standing grid approach: never a record. */
export const FIRST_FLYING_LAP = 2;

export interface PersonalBest {
  /** Full gate-validated flying lap time (seconds, finite, > 0). */
  lap: number;
  /** Cumulative split per gate, same lap, strictly ordered, last === lap. */
  splits: number[];
}

/**
 * Deterministic geometry signature: quantized signed-curvature samples.
 * Stable for the same compiled course; flips with mirroring, shifts with
 * length/geometry edits. Pure function of the track interface (testable
 * against stub tracks).
 */
export function geometrySignature(track: {
  length: number;
  curvatureAt(s: number): number;
}): string {
  const N = 32;
  const parts: string[] = [String(Math.round(track.length))];
  for (let i = 0; i < N; i++) {
    parts.push(String(Math.round(track.curvatureAt((i / N) * track.length) * 1e4)));
  }
  return parts.join('.');
}

/**
 * Versioned record key. Stable for the same generated course across
 * sessions; distinct across templates, compiled length/geometry/mirror
 * (via the signature), boost-pad layouts, lap counts, game/course
 * identity, and boost supply mode. Pads-mode keys are byte-identical to
 * the legacy scheme (no mode segment); pickups/none append their mode and
 * pickups appends the cell layout, so different boost rules never share a
 * record. Jet-ski courses append a discipline segment; hover keys (explicit
 * or omitted discipline) stay byte-identical to the legacy scheme. Never a
 * bare template id or display name.
 */
export function recordKey(gameId: string, courseId: string, circuit: RaceCircuit): string {
  const pads = circuit.pads.map((p) => `${Math.round(p.start)}+${Math.round(p.length)}`).join(',');
  const mode = circuit.boostMode ?? 'pads';
  const segs = [
    `pbv${TIMING_VERSION}`,
    gameId,
    courseId,
    `len${Math.round(circuit.track.length)}`,
    `geo${geometrySignature(circuit.track)}`,
    `pads${pads}`,
    `laps${circuit.laps}`,
  ];
  if (mode !== 'pads') segs.push(`boost${mode}`);
  if (mode === 'pickups') {
    const cells = (circuit.pickups ?? [])
      .map((c) => `${Math.round(circuit.track.wrap(c.s))}@${c.x}`)
      .join(',');
    segs.push(`cells${cells}`);
  }
  if ((circuit.discipline ?? 'hover') === 'jetski') segs.push('discjetski1');
  return segs.join('|');
}

/** Validate a loaded candidate; corrupt/foreign values become null. */
export function validateBest(v: unknown): PersonalBest | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { lap?: unknown; splits?: unknown };
  if (typeof o.lap !== 'number' || !Number.isFinite(o.lap) || o.lap <= 0 || o.lap > 3600) return null;
  if (!Array.isArray(o.splits) || o.splits.length !== TIMING_GATES) return null;
  let prev = 0;
  for (const s of o.splits) {
    if (typeof s !== 'number' || !Number.isFinite(s) || s <= prev) return null;
    prev = s;
  }
  const last = o.splits[o.splits.length - 1]!;
  if (Math.abs(last - o.lap) > 1e-6) return null;
  return { lap: o.lap, splits: [...(o.splits as number[])] };
}

/** Narrow persistence port: load/save raw strings, best-effort. */
export interface BestStore {
  load(key: string): string | null;
  save(key: string, value: string): void;
}

/** In-memory store: tests, SSR, and fallback when the browser blocks storage. */
export function memoryStore(): BestStore {
  const map = new Map<string, string>();
  return {
    load: (key) => map.get(key) ?? null,
    save: (key, value) => {
      map.set(key, value);
    },
  };
}

/**
 * Browser localStorage adapter. Every access is guarded: private mode,
 * blocked storage, unparseable values, and quota errors degrade to
 * memory-only behavior and never break the race.
 */
export function localStorageStore(prefix: string, fallback: BestStore = memoryStore()): BestStore {
  function backend(): Storage | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage;
    } catch {
      return null;
    }
  }
  return {
    load(key) {
      const store = backend();
      if (store === null) return fallback.load(key);
      try {
        const raw = store.getItem(prefix + key);
        return raw ?? fallback.load(key);
      } catch {
        return fallback.load(key);
      }
    },
    save(key, value) {
      const store = backend();
      if (store === null) {
        fallback.save(key, value);
        return;
      }
      try {
        store.setItem(prefix + key, value);
      } catch {
        fallback.save(key, value);
      }
    },
  };
}

/**
 * Bounded personal-best registry for one game identity. Fresh instances
 * reload saved records through the store; corrupt entries validate to
 * null and never poison the cache.
 */
export class PersonalBests {
  private readonly cache = new Map<string, PersonalBest>();

  constructor(
    private readonly store: BestStore,
    private readonly gameId: string,
  ) {}

  keyFor(courseId: string, circuit: RaceCircuit): string {
    return recordKey(this.gameId, courseId, circuit);
  }

  get(courseId: string, circuit: RaceCircuit): PersonalBest | null {
    const key = this.keyFor(courseId, circuit);
    const hit = this.cache.get(key);
    if (hit !== undefined) return { ...hit, splits: [...hit.splits] };
    let parsed: unknown = null;
    try {
      const raw = this.store.load(key);
      parsed = raw === null ? null : JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const best = validateBest(parsed);
    if (best !== null) this.remember(key, best);
    return best === null ? null : { ...best, splits: [...best.splits] };
  }

  set(courseId: string, circuit: RaceCircuit, best: PersonalBest): void {
    const valid = validateBest(best);
    if (valid === null) return;
    const key = this.keyFor(courseId, circuit);
    this.remember(key, valid);
    try {
      this.store.save(key, JSON.stringify(valid));
    } catch {
      // Best-effort persistence only.
    }
  }

  private remember(key: string, best: PersonalBest): void {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, best);
    while (this.cache.size > MAX_CACHED_RECORDS) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}

// --- Live attempt tracking --------------------------------------------------

export interface LapSample {
  t: number;
  lap: number;
  nextCp: number;
}

export interface AttemptResult {
  lapTime: number;
  splits: number[];
}

/**
 * Observes gate/lap snapshots for one driver and assembles validated lap
 * attempts. Policy (documented, restated in the milestone report):
 * - The standing-start lap (banked lap 1) is an out-lap: never recorded.
 * - Only fully gate-sequenced laps count: splits must hit every gate in
 *   order; reversing (nextCp steps back) or a short split array voids.
 * - Autopilot on at any point voids the attempt, even if switched off.
 * - restart/reset/course change calls reset(): transient state clears,
 *   saved records are untouched.
 */
export class LapAttempt {
  /** Current attempt can still produce a record (no autopilot/reversal). */
  get live(): boolean {
    return this.valid;
  }

  private refLap = -1;
  private refCp = 0;
  private startT = 0;
  private readonly splits: number[] = [];
  private valid = true;

  reset(): void {
    this.refLap = -1;
    this.refCp = 0;
    this.startT = 0;
    this.splits.length = 0;
    this.valid = true;
  }

  /** A completed flying lap attempt, or null (ineligible/void/incomplete). */
  observe(sample: LapSample, lapStartT: number, autopilot: boolean): AttemptResult | null {
    if (autopilot) this.valid = false;
    if (this.refLap === -1) {
      this.refLap = sample.lap;
      this.refCp = sample.nextCp;
      this.startT = lapStartT;
      return null;
    }
    if (sample.lap === this.refLap) {
      if (sample.nextCp < this.refCp) {
        this.valid = false; // reversed over a gate: no record from this lap
      } else {
        while (this.refCp < sample.nextCp) {
          this.splits.push(sample.t - this.startT);
          this.refCp++;
        }
      }
      return null;
    }
    if (sample.lap > this.refLap) {
      const lapTime = sample.t - this.startT;
      const splits = [...this.splits, lapTime];
      const lapIndex = sample.lap; // 1-based count just banked
      this.refLap = sample.lap;
      this.refCp = sample.nextCp;
      this.startT = lapStartT;
      this.splits.length = 0;
      const wasValid = this.valid && !autopilot;
      // Next-attempt eligibility follows the autopilot flag at the boundary:
      // an attempt born while auto is on starts void (tainted birth), so
      // eligibility never resets while autopilot remains on. Any later auto
      // observe voids a live attempt too; a fully clean lap after auto goes
      // off records again from its following bank.
      this.valid = !autopilot;
      if (!wasValid) return null;
      if (lapIndex < FIRST_FLYING_LAP) return null; // out-lap
      if (splits.length !== TIMING_GATES) return null; // skipped gates
      const valid = validateBest({ lap: lapTime, splits });
      return valid === null ? null : { lapTime: valid.lap, splits: valid.splits };
    }
    this.valid = false; // lap counter went backwards: void
    return null;
  }
}

/** Split delta presentation: words + sign as well as color. */
export function formatDelta(delta: number): { text: string; ahead: boolean } {
  const ahead = delta < 0;
  const mag = Math.abs(delta).toFixed(2);
  return { text: `${ahead ? '-' : '+'}${mag}`, ahead };
}
