// Deterministic racing stress/soak diagnostic (milestone 1: observe only).
//
// Exercises shipped circuit templates plus mirror/length endpoints with
// realistic digital controls. Read-only probing: the player driver plans from
// aiInputFor (shared solver, no assists) and quantizes to cabinet inputs
// (-1/0/1 steer, boolean pedals); it never writes live racer state. Rival
// drivers use aiInputFor directly. No physics tuning here: this harness only
// detects finite/bounds/gate/progress/DNF/restart/projection breakage.
//
// Usage:
//   npx tsx scripts/check-racing.mts [--repeat N] [--json <path>] [--format json|text]
//   npm run check:racing [-- <args>]
//
// Matrix (default, 12 races): 3 templates x mirror{false,true} x length{2800,3600},
// full 3 laps each with all 5 racers. --repeat N reruns the matrix N times
// (soak). Bounded default runtime: well under ~20 s. Deterministic: fixed
// 60 Hz step, pure-function drivers, no randomness, no server/browser calls.
//
// Exit codes: 0 = no correctness failures (lap rankings and duty stats are
// informational only); 1 = real correctness failure; 2 = bad arguments.
import { writeFileSync } from 'node:fs';
import {
  aiInputFor,
  createRaceFor,
  PLAYER_INDEX,
  restartRace,
  stepRace,
  type RaceState,
  type RacerInput,
} from '../packages/archetypes/src/racing/simulation';
import {
  BARRIER_X,
  compileTrackVariant,
  type RaceCircuit,
} from '../packages/archetypes/src/racing/track';
import {
  projectAtZ,
  projectRoad,
  RACING_CAM_BACK,
} from '../packages/archetypes/src/racing/game';

const DT = 1 / 60;
const EPS = 1e-6;
// Anchor/seam tolerances mirror racing-cornering.test.ts (W/2 = 256, seam < 0.5).
const ANCHOR_TOL = 1e-6;
const SEAM_TOL = 0.5;

interface Args {
  repeat: number;
  jsonPath: string | null;
  format: 'text' | 'json';
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/check-racing.mts [--repeat N] [--json <path>] [--format json|text]',
    '',
    '  --repeat N       run the 12-race matrix N times (default 1; soak mode)',
    '  --json <path>    write the full machine-readable JSON report to <path>',
    '  --format json    print only the JSON report to stdout (default: human summary)',
    '  --help, -h       print this usage',
  ].join('\n');
}

function parseArgs(argv: string[]): Args {
  const args: Args = { repeat: 1, jsonPath: null, format: 'text' };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k]!;
    if (a === '--help' || a === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (a === '--repeat') {
      const n = Number(argv[++k]);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        console.error(`check-racing: --repeat needs an integer 1..100, got ${argv[k] ?? '(missing)'}`);
        console.error(usage());
        process.exit(2);
      }
      args.repeat = n;
    } else if (a === '--json') {
      const p = argv[++k];
      if (!p) {
        console.error('check-racing: --json needs a path');
        console.error(usage());
        process.exit(2);
      }
      args.jsonPath = p;
    } else if (a === '--format') {
      const f = argv[++k];
      if (f !== 'json' && f !== 'text') {
        console.error(`check-racing: --format needs json|text, got ${f ?? '(missing)'}`);
        console.error(usage());
        process.exit(2);
      }
      args.format = f;
    } else {
      console.error(`check-racing: unknown argument ${a}`);
      console.error(usage());
      process.exit(2);
    }
  }
  return args;
}

const blank = (): RacerInput => ({ steer: 0, accel: false, brake: false, boost: false, drift: false });

/**
 * Quantized cabinet player: plans with the shared AI solver (read-only —
 * aiInputFor never mutates race state) then quantizes steer to -1/0/1 with a
 * 12-frame PWM window and rounds pedals to booleans. Realistic digital play,
 * not a live state writer.
 */
function digitalPlayerDrive(race: RaceState, frame: number): RacerInput {
  const planned = aiInputFor(race, PLAYER_INDEX);
  const phase = (frame % 12) / 12;
  return {
    steer: phase < Math.abs(planned.steer) ? Math.sign(planned.steer) : 0,
    accel: planned.accel,
    brake: planned.brake,
    boost: false,
    drift: planned.drift,
  };
}

interface RaceResult {
  config: string;
  template: string;
  mirror: boolean;
  length: number;
  trackLength: number;
  frames: number;
  raceTime: number;
  playerFinished: boolean;
  playerDnf: boolean;
  playerPlace: number | null;
  playerFinishT: number | null;
  playerLapTimes: number[];
  allFinished: boolean;
  dnfCount: number;
  offroadDuty: number;
  wallDuty: number;
  contactDuty: number;
  maxStagnationFrames: number;
  failures: string[];
}

function finiteRaceState(race: RaceState): string | null {
  for (let i = 0; i < race.racers.length; i++) {
    const r = race.racers[i]!;
    for (const [k, v] of [['s', r.s], ['x', r.x], ['speed', r.speed], ['boost', r.boost]] as const) {
      if (!Number.isFinite(v)) return `racer ${i} ${k} non-finite (${v})`;
    }
  }
  return null;
}

function runRace(circuit: RaceCircuit, label: string): RaceResult {
  const race = createRaceFor(circuit, 0);
  const player = race.racers[PLAYER_INDEX]!;
  player.x = 0;
  const failures: string[] = [];
  const inputs = race.racers.map(blank);
  const cap = Math.ceil(circuit.timeout / DT);
  let frame = 0;
  let offroad = 0;
  let wall = 0;
  let contact = 0;
  let stagnant = 0;
  let maxStagnation = 0;
  let lastLap = 0;
  let sawNonFinite = false;
  let sawBounds = false;

  for (; frame < cap && !race.over; frame++) {
    inputs[PLAYER_INDEX] = digitalPlayerDrive(race, frame);
    for (let i = 1; i < race.racers.length; i++) aiInputFor(race, i, inputs[i]!);
    stepRace(race, inputs, DT);
    if (!sawNonFinite) {
      const bad = finiteRaceState(race);
      if (bad) {
        failures.push(`non-finite state at frame ${frame}: ${bad}`);
        sawNonFinite = true;
      }
    }
    if (!sawBounds) {
      for (let i = 0; i < race.racers.length; i++) {
        if (Math.abs(race.racers[i]!.x) > BARRIER_X + EPS) {
          failures.push(`racer ${i} escaped barrier at frame ${frame}: |x|=${race.racers[i]!.x}`);
          sawBounds = true;
          break;
        }
      }
    }
    if (player.lap < lastLap) failures.push(`player lap regressed ${lastLap} -> ${player.lap} at frame ${frame}`);
    lastLap = player.lap;
    if (player.offroad) offroad++;
    if (Math.abs(player.x) >= BARRIER_X - 0.01) wall++;
    let touching = false;
    for (let i = 0; i < race.racers.length && !touching; i++) {
      for (let j = i + 1; j < race.racers.length; j++) {
        const a = race.racers[i]!;
        const b = race.racers[j]!;
        if (a.finished || b.finished) continue;
        const gap = circuit.track.wrap(a.s - b.s);
        if (Math.min(gap, circuit.track.length - gap) < 6 && Math.abs(a.x - b.x) < 1.7) {
          touching = true;
          break;
        }
      }
    }
    if (touching) contact++;
    if (Math.abs(player.speed) < 0.5 && !player.finished) {
      stagnant++;
      if (stagnant > maxStagnation) maxStagnation = stagnant;
    } else {
      stagnant = 0;
    }
  }

  if (!sawNonFinite) {
    const bad = finiteRaceState(race);
    if (bad) failures.push(`non-finite final state: ${bad}`);
  }
  if (!race.over) failures.push(`race never ended within timeout (${circuit.timeout}s)`);
  if (!player.finished) failures.push(`player unfinished: lap ${player.lap}/${circuit.laps} nextCp ${player.nextCp}`);
  if (race.dnf[PLAYER_INDEX]) failures.push('player scored DNF');
  if (race.t >= circuit.timeout) failures.push(`race clock hit timeout (${race.t.toFixed(2)}s)`);
  if (player.lapTimes.length !== circuit.laps && player.finished) {
    failures.push(`player lapTimes ${player.lapTimes.length} != laps ${circuit.laps}`);
  }
  for (const [li, lt] of player.lapTimes.entries()) {
    if (!(lt > 0) || !Number.isFinite(lt)) failures.push(`player lap ${li} time invalid (${lt})`);
  }
  // Snapshot the finished-race metrics BEFORE restartRace rebuilds the field.
  const raceTime = race.t;
  const playerFinished = player.finished;
  const playerDnf = race.dnf[PLAYER_INDEX] ?? false;
  const playerPlace = player.finished ? player.place + 1 : null;
  const playerFinishT = player.finished ? player.finishT : null;
  const playerLapTimes = [...player.lapTimes];
  const allFinished = race.racers.every((r) => r.finished);
  const dnfCount = race.dnf.filter(Boolean).length;
  // Restart integrity: rebuild through the shared path and prove it runs.
  restartRace(race, 1.2);
  if (race.t !== 0 || race.over || race.finishOrder.length !== 0 || race.countdown <= 0) {
    failures.push('restartRace did not reset clock/over/finishOrder/countdown');
  }
  if (!race.racers.every((r) => r.lap === 0 && !r.finished && r.lapTimes.length === 0)) {
    failures.push('restartRace did not reset racer laps/finish state');
  }
  if (!race.dnf.every((d) => d === false)) failures.push('restartRace did not clear DNF flags');
  race.countdown = 0;
  const restartInputs = race.racers.map(blank);
  for (let k = 0; k < 60; k++) {
    for (let i = 0; i < race.racers.length; i++) aiInputFor(race, i, restartInputs[i]!);
    stepRace(race, restartInputs, DT);
  }
  if (!(race.t > 0)) failures.push('restarted race clock did not advance');
  const badRestart = finiteRaceState(race);
  if (badRestart) failures.push(`non-finite state after restart: ${badRestart}`);

  const total = Math.max(1, frame);
  return {
    config: label,
    template: circuit.id,
    mirror: label.includes('mirror'),
    length: label.includes('2800') ? 2800 : 3600,
    trackLength: circuit.track.length,
    frames: frame,
    raceTime,
    playerFinished,
    playerDnf,
    playerPlace,
    playerFinishT,
    playerLapTimes,
    allFinished,
    dnfCount,
    offroadDuty: offroad / total,
    wallDuty: wall / total,
    contactDuty: contact / total,
    maxStagnationFrames: maxStagnation,
    failures,
  };
}

interface ProjectionResult {
  config: string;
  failures: string[];
  maxBend: number;
  bendDeparture: number;
}

function runProjection(circuit: RaceCircuit, label: string): ProjectionResult {
  const failures: string[] = [];
  const track = circuit.track;
  // Sharpest bend on this geometry (256 samples).
  let maxBend = 0;
  let bendS = 0;
  for (let k = 0; k < 256; k++) {
    const s = (k / 256) * track.length;
    const c = Math.abs(track.curvatureAt(s));
    if (c > maxBend) {
      maxBend = c;
      bendS = s;
    }
  }
  const checkStrips = (strips: ReturnType<typeof projectRoad>, where: string): void => {
    for (let i = 0; i < strips.length; i++) {
      const st = strips[i]!;
      if (![st.y, st.cx, st.half, st.ppu, st.z].every(Number.isFinite)) {
        failures.push(`${where}: strip ${i} non-finite`);
        return;
      }
      if (i > 0) {
        const p = strips[i - 1]!;
        if (!(st.z > p.z)) failures.push(`${where}: z not strictly increasing at strip ${i}`);
        if (!(st.y < p.y)) failures.push(`${where}: y not monotonic at strip ${i}`);
        if (!(st.half < p.half)) failures.push(`${where}: half-width not monotonic at strip ${i}`);
        if (!(st.ppu < p.ppu)) failures.push(`${where}: ppu not monotonic at strip ${i}`);
      }
    }
  };
  // Sample across the sharp bend and the seam.
  for (const s of [bendS, track.wrap(bendS + 40), 0.001, track.length - 0.001]) {
    checkStrips(projectRoad(s, 0, undefined, track), `s=${s.toFixed(1)}`);
  }
  // Bend must actually bend (departure from a straight chord), mirroring the
  // cornering regression's shape (never a pure sideways shift).
  const strips = projectRoad(bendS, 0, undefined, track);
  const near = projectAtZ(strips, 20)!;
  const middle = projectAtZ(strips, 80)!;
  const far = projectAtZ(strips, 160)!;
  const lineX = far.cx + ((near.cx - far.cx) * (middle.y - far.y)) / (near.y - far.y);
  const bendDeparture = middle.cx - lineX;
  if (!Number.isFinite(bendDeparture)) failures.push('bend departure non-finite');
  // Anchor: player-depth road center pins to the craft's lateral position.
  for (const x of [-4, 0, 4]) {
    const at = projectAtZ(projectRoad(bendS, x, undefined, track), RACING_CAM_BACK)!;
    if (Math.abs(at.cx + x * at.ppu - 256) > ANCHOR_TOL) {
      failures.push(`anchor error at x=${x}: ${at.cx + x * at.ppu - 256}`);
    }
  }
  // Seam continuity: geometry is periodic by construction.
  const before = projectRoad(track.length - 0.001, 0, undefined, track);
  const after = projectRoad(0.001, 0, undefined, track);
  for (let i = 0; i < before.length; i++) {
    if (Math.abs(before[i]!.cx - after[i]!.cx) > SEAM_TOL) {
      failures.push(`seam discontinuity at strip ${i}: ${Math.abs(before[i]!.cx - after[i]!.cx)}`);
      break;
    }
  }
  return { config: label, failures, maxBend, bendDeparture };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const templates = ['ember', 'coral', 'ratchet'];
  const mirrors = [false, true];
  const lengths = [2800, 3600];
  const races: RaceResult[] = [];
  const projections: ProjectionResult[] = [];
  const failures: string[] = [];

  for (let rep = 0; rep < opts.repeat; rep++) {
    for (const template of templates) {
      for (const mirror of mirrors) {
        for (const length of lengths) {
          const label = `${template}-${mirror ? 'mirror' : 'normal'}-${length}${opts.repeat > 1 ? `#${rep + 1}` : ''}`;
          const circuit = compileTrackVariant(template, { length, mirror });
          const race = runRace(circuit, label);
          races.push(race);
          for (const f of race.failures) failures.push(`[${label}] ${f}`);
          // Projection checks run once per geometry (skip on soak repeats).
          if (rep === 0) {
            const proj = runProjection(circuit, label);
            projections.push(proj);
            for (const f of proj.failures) failures.push(`[${label}/projection] ${f}`);
          }
        }
      }
    }
  }

  // Determinism: rerun the first geometry, expect bit-identical key outcomes.
  const first = compileTrackVariant(templates[0]!, { length: lengths[0]!, mirror: mirrors[0]! });
  const a = runRace(first, 'determinism-a');
  const b = runRace(first, 'determinism-b');
  const detKeys = (r: RaceResult): string =>
    JSON.stringify([r.playerFinishT, r.frames, r.playerLapTimes, r.maxStagnationFrames]);
  const deterministic = detKeys(a) === detKeys(b);
  if (!deterministic) failures.push('nondeterminism: identical rerun of first geometry diverged');
  for (const f of a.failures) failures.push(`[determinism-a] ${f}`);
  for (const f of b.failures) failures.push(`[determinism-b] ${f}`);

  const report = {
    tool: 'check-racing',
    milestone: 1,
    note: 'observe-only; no physics tuning, no production changes',
    matrix: { templates, mirrors, lengths, laps: 3, repeat: opts.repeat, dt: DT },
    raceCount: races.length,
    durationMs: Date.now() - started,
    deterministic,
    failures,
    races: races.map((r) => ({
      config: r.config,
      trackLength: +r.trackLength.toFixed(1),
      frames: r.frames,
      raceTime: +r.raceTime.toFixed(2),
      playerFinished: r.playerFinished,
      playerDnf: r.playerDnf,
      playerPlace: r.playerPlace,
      playerFinishT: r.playerFinishT !== null ? +r.playerFinishT.toFixed(2) : null,
      playerLapTimes: r.playerLapTimes.map((t) => +t.toFixed(2)),
      allFinished: r.allFinished,
      dnfCount: r.dnfCount,
      offroadDuty: +r.offroadDuty.toFixed(4),
      wallDuty: +r.wallDuty.toFixed(4),
      contactDuty: +r.contactDuty.toFixed(4),
      maxStagnationFrames: r.maxStagnationFrames,
      failures: r.failures,
    })),
    projections: projections.map((p) => ({
      config: p.config,
      maxBend: +p.maxBend.toFixed(5),
      bendDeparture: +p.bendDeparture.toFixed(1),
      failures: p.failures,
    })),
  };

  if (opts.jsonPath) writeFileSync(opts.jsonPath, JSON.stringify(report, null, 2) + '\n');
  if (opts.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`check-racing: ${races.length} races, ${projections.length} projection probes, ${((Date.now() - started) / 1000).toFixed(1)}s`);
    for (const r of races) {
      const laps = r.playerLapTimes.map((t) => t.toFixed(1)).join('/');
      console.log(
        `  ${r.config}: ${r.playerFinished ? `finished P${r.playerPlace} ${r.playerFinishT?.toFixed(1)}s laps[${laps}]` : 'UNFINISHED'} ` +
          `offroad ${(r.offroadDuty * 100).toFixed(1)}% wall ${(r.wallDuty * 100).toFixed(1)}% contact ${(r.contactDuty * 100).toFixed(1)}% ` +
          `stag ${r.maxStagnationFrames}f${r.failures.length ? ` FAIL(${r.failures.length})` : ''}`,
      );
    }
    for (const p of projections) {
      console.log(
        `  ${p.config}/proj: maxBend ${p.maxBend.toFixed(5)} departure ${p.bendDeparture.toFixed(1)}${p.failures.length ? ` FAIL(${p.failures.length})` : ''}`,
      );
    }
    console.log(`  determinism rerun: ${deterministic ? 'identical' : 'DIVERGED'}`);
    if (failures.length) {
      console.error(`\n${failures.length} correctness failure(s):`);
      for (const f of failures) console.error(`  - ${f}`);
    } else {
      console.log('\nOK — no correctness failures (rankings/duty stats informational only)');
    }
    if (opts.jsonPath) console.log(`JSON report: ${opts.jsonPath}`);
  }
  process.exit(failures.length ? 1 : 0);
}

main();
