// Racing presentation milestone 2: hybrid steering lean, water course
// rendering, record-key separation, and paused determinism. Pure render
// behavior — physics assertions stay in the simulation/discipline suites.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOGICAL_BUTTONS, type RacingSpec } from '@sparkade/shared';
import type { EngineContext, InputSnapshot } from '@sparkade/engine';
import type { RacingArtBundle } from '@sparkade/engine';
import { buoyCountFor, buoySide, worldMarkerSlots } from '../src/racing/game';
import {
  BAKED_POSE_LEAN,
  RACE_CIRCUITS,
  VIS_LEAN_MAX,
  bakedPoseLean,
  clampVisRoll,
  compileTrackVariant,
  craftLean,
  createRacingGame,
  helpControlsLine,
  makeArtSpriteQueue,
  offroadLabel,
  packResidualLean,
  poseBankThreshold,
  recordKey,
  selectCraftPose,
  selectCraftPoseSteady,
  type RacingDevHandle,
} from '../src/racing/index';

type Op = { k: string; v?: unknown; args?: unknown[] };

function recordingCtx(log: Op[]): unknown {
  const gradient = {
    addColorStop: (...a: unknown[]) => {
      log.push({ k: 'addColorStop', args: a });
    },
  };
  return new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'createLinearGradient') {
          return (...a: unknown[]) => {
            log.push({ k: 'createLinearGradient', args: a });
            return gradient;
          };
        }
        if (p === 'canvas') return { width: 480, height: 270 };
        return (...a: unknown[]) => {
          log.push({ k: String(p), args: a });
        };
      },
      set: (_t, p, v) => {
        log.push({ k: `set:${String(p)}`, v });
        return true;
      },
    },
  );
}

function mockEngine(log: Op[]): EngineContext {
  const played: string[] = [];
  return {
    renderer: { ctx: recordingCtx(log) },
    music: { playSong: (name: string) => played.push(name), stopSong: () => undefined },
    cards: {
      show: () => undefined,
      get active() {
        return false;
      },
    },
  } as unknown as EngineContext;
}

function blankInput(): InputSnapshot {
  const input = {} as InputSnapshot;
  for (const button of LOGICAL_BUTTONS) input[button] = { held: false, pressed: false, released: false };
  return input;
}

function golden(): RacingSpec {
  const path = join(__dirname, '..', '..', 'generation', 'golden', 'golden-racing.json');
  return JSON.parse(readFileSync(path, 'utf8')) as RacingSpec;
}

function jetskiSpec(): RacingSpec {
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
  return spec;
}

type DevGame = ReturnType<typeof createRacingGame> & RacingDevHandle;

function driveToRace(game: DevGame, spec: RacingSpec, steer: 'LEFT' | 'RIGHT' | null): void {
  const start = blankInput();
  start.A = { held: true, pressed: true, released: false };
  game.start();
  game.update(1 / 60, start);
  for (let k = 0; k < 300; k++) {
    const input = blankInput();
    input.B.held = true;
    if (steer === 'LEFT') input.LEFT.held = true;
    if (steer === 'RIGHT') input.RIGHT.held = true;
    game.update(1 / 60, input);
    void spec;
  }
}

describe('hybrid steering lean', () => {
  it('is zero at rest and bounded, signed, and smooth everywhere else', () => {
    expect(craftLean(0)).toEqual({ tilt: 0, shift: 0, squash: 1 });
    const small = craftLean(0.2);
    expect(small.tilt).toBeCloseTo(0.01, 10);
    expect(small.shift).toBeCloseTo(0.012, 10);
    expect(small.squash).toBeCloseTo(0.994, 10);
    const full = craftLean(1);
    expect(full).toEqual({ tilt: 0.05, shift: 0.06, squash: 0.97 });
    // Countersteer flips the vector exactly (no crossfade, no dead band).
    expect(craftLean(-0.5)).toEqual({
      tilt: -craftLean(0.5).tilt,
      shift: -craftLean(0.5).shift,
      squash: craftLean(0.5).squash,
    });
    // Clamped past full lock: never excessive.
    expect(craftLean(3)).toEqual(craftLean(1));
    expect(craftLean(-3)).toEqual(craftLean(-1));
  });

  it('caps combined roll so lean never stacks past the bound', () => {
    expect(clampVisRoll(0.22)).toBe(0.22);
    expect(clampVisRoll(0.22 + 0.05)).toBe(0.22);
    expect(clampVisRoll(-0.3)).toBe(-0.22);
    expect(clampVisRoll(0.1)).toBe(0.1);
  });

  it('holds the neutral baked pose to stronger steering on water only', () => {
    expect(poseBankThreshold(undefined)).toBe(0.12);
    expect(poseBankThreshold('hover')).toBe(0.12);
    expect(poseBankThreshold('jetski')).toBe(0.2);
    // Same input banks the hover craft but not the ski (lean carries it).
    expect(selectCraftPose(0.15, 60)).toBe('bankRight');
    expect(selectCraftPose(0.15, 60, poseBankThreshold('jetski'))).toBe('rear');
    expect(selectCraftPose(0.25, 60, poseBankThreshold('jetski'))).toBe('bankRight');
    // Stopped craft never corner-animate, whatever the stick says.
    expect(selectCraftPose(1, 0)).toBe('rear');
    expect(selectCraftPose(1, 0.5)).toBe('rear');
  });
});

function stubImage(width: number, height: number): CanvasImageSource {
  return { width, height } as unknown as CanvasImageSource;
}

function stubPack(): RacingArtBundle {
  return {
    panoramas: [stubImage(1536, 480), stubImage(1536, 480), stubImage(1536, 480)],
    strips: [
      stubImage(192, 64),
      stubImage(192, 64),
      stubImage(192, 64),
      stubImage(192, 64),
      stubImage(192, 64),
    ],
    sceneryAtlas: stubImage(288, 192),
    materialAtlas: stubImage(256, 256),
  };
}

function packEngine(log: Op[], pack: RacingArtBundle): EngineContext {
  const engine = mockEngine(log) as unknown as Record<string, unknown>;
  engine.racingArt = pack;
  return engine as unknown as EngineContext;
}

describe('residual lean math', () => {
  it('compensates the baked cell so net orientation is always the desired lean', () => {
    expect(BAKED_POSE_LEAN).toBeCloseTo(0.16, 10);
    expect(bakedPoseLean('rear')).toBe(0);
    expect(bakedPoseLean('bankRight')).toBeCloseTo(0.16, 10);
    expect(bakedPoseLean('bankLeft')).toBeCloseTo(-0.16, 10);
    // Net (residual + baked) equals the desired lean on every
    // hysteresis-reachable combination, so the sprite switch changes pixels
    // but never heading — no doubled bank. (Far mismatched extremes hit the
    // ±0.22 safety rail instead; hysteresis never holds those states.)
    const cases: [number, 'rear' | 'bankLeft' | 'bankRight'][] = [];
    for (const v of [-1, -0.5, -0.15, -0.05, 0, 0.05, 0.15, 0.5, 1]) cases.push([v, 'rear']);
    for (const v of [0.1, 0.15, 0.5, 1]) cases.push([v, 'bankRight']);
    for (const v of [-0.1, -0.15, -0.5, -1]) cases.push([v, 'bankLeft']);
    for (const [v, pose] of cases) {
      const net = packResidualLean(v, pose) + bakedPoseLean(pose);
      expect(net).toBeCloseTo(v * VIS_LEAN_MAX, 12);
    }
  });

  it('stays restrained, signed, and exactly neutral at rest', () => {
    expect(packResidualLean(0, 'rear')).toBe(0);
    // A stale banked cell at zero input compensates exactly (net reads zero,
    // per the equivalence test above); the switch itself re-arms to rear.
    expect(packResidualLean(0, 'bankLeft')).toBeCloseTo(0.16, 12);
    expect(packResidualLean(0, 'bankRight')).toBeCloseTo(-0.16, 12);
    // Neutral pose leans toward the bank frame progressively...
    expect(packResidualLean(0.5, 'rear')).toBeCloseTo(0.09, 12);
    // ...and the banked frame carries only a small compensating residual.
    expect(packResidualLean(1, 'bankRight')).toBeCloseTo(0.02, 12);
    expect(packResidualLean(-1, 'bankLeft')).toBeCloseTo(-0.02, 12);
    // Countersteer flips sign through neutral.
    expect(packResidualLean(-0.5, 'rear')).toBeCloseTo(-0.09, 12);
    for (const v of [-1, -0.3, 0.3, 1]) {
      for (const pose of ['rear', 'bankLeft', 'bankRight'] as const) {
        expect(Math.abs(packResidualLean(v, pose))).toBeLessThanOrEqual(0.22);
      }
    }
  });

  it('holds the banked pose through boundary hover (hysteresis, no chatter)', () => {
    // From neutral the plain threshold switches...
    expect(selectCraftPoseSteady('rear', 0.13, 60)).toBe('bankRight');
    expect(selectCraftPoseSteady('rear', 0.11, 60)).toBe('rear');
    // ...but a banked pose holds until steering retreats past threshold-hyst.
    expect(selectCraftPoseSteady('bankRight', 0.1, 60)).toBe('bankRight');
    expect(selectCraftPoseSteady('bankRight', 0.05, 60)).toBe('rear');
    expect(selectCraftPoseSteady('bankLeft', -0.1, 60)).toBe('bankLeft');
    expect(selectCraftPoseSteady('bankLeft', -0.05, 60)).toBe('rear');
    // Hard crossing still flips sides without sticking.
    expect(selectCraftPoseSteady('bankRight', -0.13, 60)).toBe('bankLeft');
    expect(selectCraftPoseSteady('bankLeft', 0.13, 60)).toBe('bankRight');
    // Stopped craft stay neutral whatever the stick says.
    expect(selectCraftPoseSteady('bankRight', 1, 0)).toBe('rear');
    // Jetski threshold holds neutral further (lean carries small inputs).
    expect(selectCraftPoseSteady('rear', 0.15, 60, poseBankThreshold('jetski'))).toBe('rear');
    expect(selectCraftPoseSteady('rear', 0.25, 60, poseBankThreshold('jetski'))).toBe('bankRight');
  });
});

describe('route-buoy lattice', () => {
  it('divides the lap exactly at modest density (no fixed-grid seam pop)', () => {
    for (const length of [2800, 2900, 3200, 3400, 3600]) {
      const count = buoyCountFor(length);
      expect(count).toBeGreaterThanOrEqual(8);
      const spacing = length / count;
      expect(spacing).toBeGreaterThanOrEqual(100);
      expect(spacing).toBeLessThanOrEqual(200);
      // Exact division: the lattice phase is identical on every lap.
      expect(count * spacing).toBeCloseTo(length, 9);
    }
    expect(buoySide(0)).toBe(-1);
    expect(buoySide(1)).toBe(1);
    expect(buoySide(2)).toBe(-1);
  });

  it('returns identical markers across the lap seam (camS vs camS + length)', () => {
    for (const length of [2800, 2900, 3400, 3600]) {
      const count = buoyCountFor(length);
      for (const camS of [0, length - 10, length * 0.37, -5]) {
        const a = worldMarkerSlots(camS, length, count);
        const b = worldMarkerSlots(camS + length, length, count);
        // Same marker ids in the same far-to-near order at the same depths
        // to within float dust (1e-9 units ≈ 1e-9 px on screen: no pop).
        expect(a.map((m) => m.k)).toEqual(b.map((m) => m.k));
        expect(a.length).toBeGreaterThan(0);
        for (let i = 0; i < a.length; i++) {
          expect(a[i]!.z).toBeCloseTo(b[i]!.z, 9);
        }
      }
    }
  });

  it('keeps at least one buoy in view at every camera position', () => {
    for (const length of [2800, 3400, 3600]) {
      const count = buoyCountFor(length);
      for (let camS = 0; camS < length; camS += 50) {
        expect(worldMarkerSlots(camS, length, count).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('discipline wording', () => {
  it('names shallows and carve on water, offroad and drift on asphalt', () => {
    expect(offroadLabel(undefined)).toBe('OFFROAD');
    expect(offroadLabel('hover')).toBe('OFFROAD');
    expect(offroadLabel('jetski')).toBe('SHALLOWS');
    expect(helpControlsLine('hover')).toContain('L/R DRIFT');
    expect(helpControlsLine(undefined)).toContain('B ACCEL');
    expect(helpControlsLine('jetski')).toContain('L/R CARVE');
    expect(helpControlsLine('jetski')).toContain('B THROTTLE');
    expect(helpControlsLine('jetski')).not.toContain('DRIFT');
  });
});

describe('record-key separation', () => {
  it('keeps hover keys byte-identical and segments jetski courses', () => {
    const base = RACE_CIRCUITS[0]!;
    const stripped = { ...base };
    delete (stripped as { discipline?: unknown }).discipline;
    const hoverKey = recordKey('game', 'course', base);
    expect(recordKey('game', 'course', stripped)).toBe(hoverKey);
    expect(hoverKey).not.toContain('disc');
    const ski = compileTrackVariant('ember', { discipline: 'jetski' });
    const skiKey = recordKey('game', 'course', ski);
    expect(skiKey).not.toBe(hoverKey);
    expect(skiKey.endsWith('|discjetski1')).toBe(true);
  });
});

describe('water course rendering', () => {
  it('paints buoys and wake with no asphalt stripes on the ski course', () => {
    const log: Op[] = [];
    const game = createRacingGame(mockEngine(log), jetskiSpec()) as DevGame;
    driveToRace(game, jetskiSpec(), 'LEFT');
    log.length = 0;
    game.render();
    const fills = log.filter((o) => o.k === 'set:fillStyle').map((o) => String(o.v));
    // No asphalt center stripes on water...
    expect(fills.some((f) => f.startsWith('rgba(240,240,220'))).toBe(false);
    // ...but buoys mark the route and the hull rides a wake ellipse.
    expect(fills).toContain('#ff7a2e');
    expect(fills).toContain('rgba(225,243,255,0.5)');
    // Hull-contact spray emits at pace (drawn through the spark pool).
    expect(fills).toContain('#dff3ff');
    game.dispose();
  });

  it('keeps asphalt stripes on the hover course', () => {
    const log: Op[] = [];
    const game = createRacingGame(mockEngine(log), golden()) as DevGame;
    driveToRace(game, golden(), null);
    log.length = 0;
    game.render();
    const fills = log.filter((o) => o.k === 'set:fillStyle').map((o) => String(o.v));
    expect(fills.some((f) => f.startsWith('rgba(240,240,220'))).toBe(true);
    expect(fills).not.toContain('#ff7a2e');
    game.dispose();
  });

  it('renders paused frames pixel-identically (no draw-transform leakage)', () => {
    const log: Op[] = [];
    const game = createRacingGame(mockEngine(log), jetskiSpec()) as DevGame;
    driveToRace(game, jetskiSpec(), 'RIGHT');
    game.render();
    log.length = 0;
    game.render();
    // Normalize through JSON on both sides: canvas gradient handles are
    // opaque objects, and only the serializable call stream must match.
    const first = JSON.parse(JSON.stringify(log)) as Op[];
    log.length = 0;
    game.render();
    // Frozen race clock: no emissions, no easing, no globalAlpha leftovers.
    expect(JSON.parse(JSON.stringify(log))).toEqual(first);
    const alphas = log.filter((o) => o.k === 'set:globalAlpha').map((o) => o.v);
    expect(alphas[alphas.length - 1]).toBe(1);
    game.dispose();
  });
});

describe('pack rotation', () => {
  it('applies a real rotation to generated blits on moving steer', () => {
    const log: Op[] = [];
    const pack = stubPack();
    const game = createRacingGame(packEngine(log, pack), jetskiSpec()) as DevGame;
    driveToRace(game, jetskiSpec(), 'LEFT');
    log.length = 0;
    game.render();
    const rots = log.filter((o) => o.k === 'rotate').map((o) => (o.args as number[])[0]);
    expect(rots.length).toBeGreaterThan(0);
    expect(rots.some((r) => r !== 0)).toBe(true);
    // Painter order intact: rotated craft still blit, alpha normalized after.
    expect(log.some((o) => o.k === 'drawImage')).toBe(true);
    // The shared lattice marks the generated course too (not just gates).
    const fills = log.filter((o) => o.k === 'set:fillStyle').map((o) => String(o.v));
    expect(fills).toContain('#ff7a2e');
    // Generated water must not inherit the asphalt renderer's curb strip.
    expect(log.some(o => o.k === 'drawImage' && o.args?.[0] === pack.materialAtlas
      && Number(o.args[1]) < 128 && Number(o.args[2]) >= 128)).toBe(false);
    const alphas = log.filter((o) => o.k === 'set:globalAlpha').map((o) => o.v);
    expect(alphas[alphas.length - 1]).toBe(1);
    // Telemetry reports the rotation the blit actually received (nonzero
    // and bounded; sign follows the live speed-scaled lean, not full lock).
    const tilt = game.racingDev.snapshot().player.visTilt;
    expect(tilt).not.toBe(0);
    expect(Math.abs(tilt)).toBeLessThanOrEqual(0.22);
    game.dispose();
  });

  it('stays exactly neutral at rest on water: contact ripple, never black shadow', () => {
    const log: Op[] = [];
    const game = createRacingGame(packEngine(log, stubPack()), jetskiSpec()) as DevGame;
    game.start();
    const input = blankInput();
    input.A = { held: true, pressed: true, released: false };
    game.update(1 / 60, input);
    log.length = 0;
    game.render();
    const rots = log.filter((o) => o.k === 'rotate').map((o) => (o.args as number[])[0]);
    expect(rots.some((r) => r !== 0)).toBe(false);
    const fills = log.filter((o) => o.k === 'set:fillStyle').map((o) => String(o.v));
    expect(fills).not.toContain('rgba(0,0,0,0.45)');
    expect(fills).toContain('rgba(225,243,255,0.18)');
    game.dispose();
  });

  it('resets queue rotation when the stick settles (no stale transform)', () => {
    const log: Op[] = [];
    const game = createRacingGame(packEngine(log, stubPack()), jetskiSpec()) as DevGame;
    driveToRace(game, jetskiSpec(), 'LEFT');
    log.length = 0;
    game.render();
    expect(log.filter((o) => o.k === 'rotate').length).toBeGreaterThan(0);
    // Fresh queue entries carry no rotation, and a settled stick re-emits
    // an exact zero for the player entry (rivals keep driving, so the
    // frame-level proof is the player telemetry, not the absence of ops).
    expect(makeArtSpriteQueue(4).every((e) => e.rot === 0)).toBe(true);
    for (let k = 0; k < 240; k++) game.update(1 / 60, blankInput());
    game.render();
    expect(game.racingDev.snapshot().player.visTilt).toBe(0);
    game.dispose();
  });
});

describe('dev snapshot telemetry', () => {
  it('exposes discipline, latV, and the live lean vector', () => {
    const log: Op[] = [];
    const game = createRacingGame(mockEngine(log), jetskiSpec()) as DevGame;
    // Title phase: parked craft shows a zero lean vector and rear pose.
    game.render();
    const parked = game.racingDev.snapshot().player;
    expect(parked.discipline).toBe('jetski');
    expect(parked.visShift).toBe(0);
    expect(parked.visTilt).toBe(0);
    expect(parked.visSquash).toBe(1);
    // Racing with held steer at pace: lean reads, latV is live physics.
    driveToRace(game, jetskiSpec(), 'LEFT');
    game.render();
    const racing = game.racingDev.snapshot().player;
    expect(racing.speed).toBeGreaterThan(10);
    expect(racing.visShift).toBeLessThan(0);
    expect(racing.visSquash).toBeLessThan(1);
    expect(racing.visSquash).toBeGreaterThanOrEqual(0.97);
    // Residual rotation is live too (nonzero, bounded; the held LEFT input
    // wall-pins at low speed, so speed-scaling keeps it small and positive
    // against the banked cell — net orientation still equals the lean).
    expect(racing.visTilt).not.toBe(0);
    expect(Math.abs(racing.visTilt)).toBeLessThanOrEqual(0.22);
    expect(typeof racing.latV).toBe('number');
    expect(game.racingDev.snapshot().art.pose).toBe('bankLeft');
    // Hover control: same inputs report hover with zero lateral velocity.
    const hoverLog: Op[] = [];
    const hoverGame = createRacingGame(mockEngine(hoverLog), golden()) as DevGame;
    driveToRace(hoverGame, golden(), 'LEFT');
    hoverGame.render();
    const hoverSnap = hoverGame.racingDev.snapshot().player;
    expect(hoverSnap.discipline).toBe('hover');
    expect(hoverSnap.latV).toBe(0);
    expect(hoverSnap.visShift).toBeLessThan(0);
    hoverGame.dispose();
    game.dispose();
  });
});
