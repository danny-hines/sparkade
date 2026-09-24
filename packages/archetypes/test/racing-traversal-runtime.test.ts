// Racing traversal runtime milestone: cup wiring, record-key separation,
// bounded presentation, and integration behavior. Legacy render/discipline
// suites stay untouched; this file covers only the new traversal path.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOGICAL_BUTTONS,
  type RacingDiscipline,
  type RacingSpec,
  type RacingTraversal,
} from '@sparkade/shared';
import type { EngineContext, InputSnapshot } from '@sparkade/engine';
import type { RacingArtBundle } from '@sparkade/engine';
import {
  BICYCLE_TRAVERSAL,
  MAGIC_BOARD_TRAVERSAL,
  MOTORCYCLE_TRAVERSAL,
  SKATEBOARD_TRAVERSAL,
  HOVER_MOVEMENT,
  JETSKI_MOVEMENT,
  compileTrackVariant,
  createRacingGame,
  movementForTraversal,
  recordKey,
  resolveCupRaces,
  resolveTraversal,
  RACE_CIRCUITS,
  accelWordFor,
  flameForPresentation,
  helpControlsLineFor,
  isWaterCircuit,
  racingControlsFor,
  resolveRacePresentation,
  LEGACY_PRESENTATION,
  riderBobFor,
  slideWordFor,
  speedTextFor,
  surfaceDisciplineFor,
  surfaceForCircuit,
  titleLabelFor,
  trailForPresentation,
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
  return {
    renderer: { ctx: recordingCtx(log), button: (b: string) => b },
    music: { playSong: () => undefined, stopSong: () => undefined },
    cards: {
      show: () => undefined,
      get active() {
        return false;
      },
    },
  } as unknown as EngineContext;
}

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

function blankInput(): InputSnapshot {
  const input = {} as InputSnapshot;
  for (const button of LOGICAL_BUTTONS) input[button] = { held: false, pressed: false, released: false };
  return input;
}

function golden(): RacingSpec {
  const path = join(__dirname, '..', '..', 'generation', 'golden', 'golden-racing.json');
  return JSON.parse(readFileSync(path, 'utf8')) as RacingSpec;
}

function identityFor(traversal: RacingTraversal): RacingSpec['identity'] {
  return {
    pilotName: 'TESTER',
    artDirection: 'Test art direction.',
    worldConcept: 'Test world.',
    playerCraftConcept: 'Test craft.',
    rivalCrafts: ['VEX', 'JUNO', 'PIP', 'KAZ'].map((name) => ({
      name,
      vehicleConcept: `Test rival ${name}.`,
    })),
    sound: { engine: { family: 'combustion' } },
    boost: { mode: 'pads', displayName: 'Surge Pads', appearanceConcept: 'Glowing pads.' },
    traversal: { ...traversal },
  };
}

function specWith(traversal: RacingTraversal): RacingSpec {
  const spec = golden();
  spec.identity = identityFor(traversal);
  return spec;
}

type DevGame = ReturnType<typeof createRacingGame> & RacingDevHandle;

function driveToRace(game: DevGame): void {
  const start = blankInput();
  start.A = { held: true, pressed: true, released: false };
  game.start();
  game.update(1 / 60, start);
  for (let k = 0; k < 300; k++) {
    const input = blankInput();
    input.B.held = true;
    game.update(1 / 60, input);
  }
}

function hudSpeedTexts(log: Op[]): number[] {
  return log
    .filter((o) => o.k === 'fillText')
    .map((o) => String((o.args as unknown[])[0]))
    .filter((t) => /^\d+ KM\/H$/.test(t))
    .map((t) => parseInt(t, 10));
}

afterEach(() => {
  // Panorama failure-cache tests install a document stub; never leak it.
  delete (globalThis as unknown as Record<string, unknown>).document;
});

describe('resolveCupRaces traversal path', () => {
  it('keeps legacy circuits traversal-free without a spec or identity', () => {
    for (const { circuit } of resolveCupRaces()) {
      expect('traversal' in circuit).toBe(false);
      expect(circuit.discipline).toBe('hover');
    }
    const legacy = golden();
    delete legacy.identity;
    for (const { circuit } of resolveCupRaces(legacy)) {
      expect('traversal' in circuit).toBe(false);
      expect(circuit.discipline).toBe('hover');
    }
  });

  it('threads a ground traversal onto every circuit with hover discipline', () => {
    const races = resolveCupRaces(specWith(BICYCLE_TRAVERSAL));
    expect(races.length).toBe(3);
    for (const { circuit } of races) {
      expect(circuit.traversal).toEqual(BICYCLE_TRAVERSAL);
      expect(circuit.discipline).toBe('hover');
    }
  });

  it('derives jetski discipline from a water traversal surface', () => {
    const races = resolveCupRaces(specWith(MAGIC_BOARD_TRAVERSAL));
    for (const { circuit } of races) {
      expect(circuit.traversal).toEqual(MAGIC_BOARD_TRAVERSAL);
      expect(circuit.discipline).toBe('jetski');
    }
  });

  it('still applies bounded geometry variation with a traversal present', () => {
    const spec = specWith(SKATEBOARD_TRAVERSAL);
    spec.levels[0] = { ...spec.levels[0]!, length: 2800, mirror: true };
    const races = resolveCupRaces(spec);
    const varied = races[0]!.circuit;
    expect(Math.round(varied.track.length)).toBe(2800);
    expect(varied.traversal).toEqual(SKATEBOARD_TRAVERSAL);
    expect(varied.discipline).toBe('hover');
    // Mirroring flips turn handedness through the same compiled geometry.
    const base = RACE_CIRCUITS.find((c) => c.id === varied.id)!;
    expect(Math.sign(varied.track.curvatureAt(400))).toBe(-Math.sign(base.track.curvatureAt(400)));
  });

  it('throws on an invalid traversal instead of racing wrong physics', () => {
    const spec = specWith(BICYCLE_TRAVERSAL);
    spec.identity = {
      ...spec.identity!,
      traversal: { ...BICYCLE_TRAVERSAL, handling: 'sideways' } as unknown as RacingTraversal,
    };
    expect(() => resolveCupRaces(spec)).toThrow(/handling/);
  });

  it('derives compileTrackVariant discipline from the traversal surface', () => {
    expect(compileTrackVariant('ember').discipline).toBe('hover');
    expect(
      compileTrackVariant('ember', { traversal: { ...BICYCLE_TRAVERSAL } }).discipline,
    ).toBe('hover');
    expect(
      compileTrackVariant('ember', { traversal: { ...MAGIC_BOARD_TRAVERSAL } }).discipline,
    ).toBe('jetski');
    // Explicit discipline survives without a traversal (legacy path).
    expect(compileTrackVariant('ember', { discipline: 'jetski' }).discipline).toBe('jetski');
    expect(() => compileTrackVariant('ember', { discipline: 'submarine' as unknown as RacingDiscipline })).toThrow(
      /unknown racing discipline/,
    );
  });
});

describe('record-key traversal separation', () => {
  const base = RACE_CIRCUITS[0]!;

  it('preserves legacy keys byte-identically when traversal is omitted', () => {
    const hoverKey = recordKey('game', 'course', base);
    expect(hoverKey).not.toContain('trav');
    expect(hoverKey).not.toContain('disc');
    const stripped = { ...base };
    delete (stripped as { discipline?: unknown }).discipline;
    expect(recordKey('game', 'course', stripped)).toBe(hoverKey);
    const ski = compileTrackVariant('ember', { discipline: 'jetski' });
    const skiKey = recordKey('game', 'course', ski);
    expect(skiKey).toContain('discjetski1');
    expect(skiKey).not.toContain('trav');
  });

  it('separates handling+surface while sharing rider/propulsion/label renames', () => {
    const gripGround = { ...base, traversal: { ...BICYCLE_TRAVERSAL } };
    const key = recordKey('game', 'course', gripGround);
    expect(key).toContain('travgrip-ground');
    expect(key).not.toBe(recordKey('game', 'course', base));
    // Presentation-only renames share the record.
    expect(
      recordKey('game', 'course', {
        ...base,
        traversal: { ...BICYCLE_TRAVERSAL, label: 'Zorp 9000', rider: 'onFoot', propulsion: 'magic' },
      }),
    ).toBe(key);
    // Either physics axis splits the record.
    expect(
      recordKey('game', 'course', { ...base, traversal: { ...SKATEBOARD_TRAVERSAL } }),
    ).not.toBe(key);
    expect(
      recordKey('game', 'course', {
        ...base,
        traversal: { label: 'T', handling: 'grip', surface: 'water', rider: 'seated', propulsion: 'human' },
      }),
    ).not.toBe(key);
    // A water traversal never collides with the legacy jetski key.
    expect(
      recordKey('game', 'course', { ...base, traversal: { ...MAGIC_BOARD_TRAVERSAL } }),
    ).not.toBe(recordKey('game', 'course', compileTrackVariant('ember', { discipline: 'jetski' })));
  });
});

describe('movement profile cache', () => {
  it('returns cached references without allocating on the traversal path', () => {
    // Envelope corners keep their exact legacy objects.
    expect(
      movementForTraversal('hover', {
        label: 'T',
        handling: 'direct',
        surface: 'ground',
        rider: 'none',
        propulsion: 'motor',
      }),
    ).toBe(HOVER_MOVEMENT);
    expect(movementForTraversal('hover', { ...MAGIC_BOARD_TRAVERSAL })).toBe(JETSKI_MOVEMENT);
    // Composed profiles are stable references across calls (hot path: no
    // per-step allocation), with identical numbers.
    const a = movementForTraversal('hover', { ...BICYCLE_TRAVERSAL });
    const b = movementForTraversal('hover', {
      ...BICYCLE_TRAVERSAL,
      label: 'Other',
      rider: 'onFoot',
      propulsion: 'magic',
    });
    expect(a).toBe(b);
    expect(a.topSpeed).toBe(HOVER_MOVEMENT.topSpeed);
    expect(a.easedBoundary).toBe(false);
    const carveA = movementForTraversal('hover', { ...SKATEBOARD_TRAVERSAL });
    expect(movementForTraversal('hover', { ...SKATEBOARD_TRAVERSAL })).toBe(carveA);
    expect(carveA.lateralResponse).toBeGreaterThan(0);
    expect(carveA.topSpeed).toBe(HOVER_MOVEMENT.topSpeed);
  });
});

describe('bounded presentation resolver', () => {
  it('resolves omission to the shared legacy presentation', () => {
    expect(resolveRacePresentation(undefined)).toBe(LEGACY_PRESENTATION);
    expect(resolveRacePresentation(null)).toBe(LEGACY_PRESENTATION);
    expect(resolveRacePresentation({ ...MOTORCYCLE_TRAVERSAL })).toBe(LEGACY_PRESENTATION);
    expect(speedTextFor(LEGACY_PRESENTATION, 80)).toBe('192 KM/H');
    expect(helpControlsLineFor(LEGACY_PRESENTATION)).toBe(
      'D-PAD STEER - B ACCEL - Y BRAKE - A BOOST (HALF METER) - L/R DRIFT',
    );
  });

  it('derives surface and discipline from the surface, never sport names', () => {
    expect(surfaceForCircuit({ traversal: { ...BICYCLE_TRAVERSAL }, discipline: 'jetski' })).toBe(
      'ground',
    );
    expect(surfaceForCircuit({ traversal: { ...MAGIC_BOARD_TRAVERSAL }, discipline: 'hover' })).toBe(
      'water',
    );
    expect(surfaceForCircuit({ discipline: 'jetski' })).toBe('water');
    expect(surfaceForCircuit({})).toBe('ground');
    expect(surfaceDisciplineFor({ ...BICYCLE_TRAVERSAL }, 'jetski')).toBe('hover');
    expect(surfaceDisciplineFor({ ...MAGIC_BOARD_TRAVERSAL }, 'hover')).toBe('jetski');
    expect(surfaceDisciplineFor(undefined, 'jetski')).toBe('jetski');
    expect(surfaceDisciplineFor(undefined, undefined)).toBe('hover');
    expect(isWaterCircuit({ traversal: { ...MAGIC_BOARD_TRAVERSAL } })).toBe(true);
    expect(isWaterCircuit({ traversal: { ...SKATEBOARD_TRAVERSAL } })).toBe(false);
  });

  it('burns motor flames, caps magic, and never burns human racers', () => {
    const motor = resolveRacePresentation({ ...MOTORCYCLE_TRAVERSAL });
    const human = resolveRacePresentation({ ...BICYCLE_TRAVERSAL });
    const magic = resolveRacePresentation({ ...MAGIC_BOARD_TRAVERSAL });
    expect(flameForPresentation(motor, 60, 0.5)).toBe(2);
    expect(flameForPresentation(motor, 60, 0)).toBe(1);
    expect(flameForPresentation(motor, 0, 0)).toBe(0);
    expect(flameForPresentation(human, 60, 0.5)).toBe(0);
    expect(flameForPresentation(human, 60, 0)).toBe(0);
    expect(flameForPresentation(magic, 60, 0.5)).toBe(1);
    expect(flameForPresentation(magic, 60, 0)).toBe(1);
    expect(flameForPresentation(magic, 0, 0)).toBe(0);
    // Restrained magic trail only; motor and human never trail.
    expect(trailForPresentation(magic, 60, 0)).toBe(1);
    expect(trailForPresentation(magic, 0, 0)).toBe(0);
    expect(trailForPresentation(motor, 60, 0.5)).toBe(0);
    expect(trailForPresentation(human, 60, 0.5)).toBe(0);
  });

  it('keeps stopped racers exactly still with tiny cadence cues at pace', () => {
    const human = resolveRacePresentation({ ...BICYCLE_TRAVERSAL });
    const motor = resolveRacePresentation({ ...MOTORCYCLE_TRAVERSAL });
    expect(riderBobFor(human, 0, 123.4)).toBe(0);
    expect(riderBobFor(human, 0.5, 123.4)).toBe(0);
    expect(riderBobFor(motor, 80, 123.4)).toBe(0);
    const bob = riderBobFor(human, 60, 1);
    expect(Math.abs(bob)).toBeGreaterThan(0);
    expect(Math.abs(bob)).toBeLessThanOrEqual(1);
  });

  it('scales human speed below motor pace and picks verbs from enums', () => {
    const human = resolveRacePresentation({ ...BICYCLE_TRAVERSAL });
    const runner = resolveRacePresentation({
      label: 'T',
      handling: 'direct',
      surface: 'ground',
      rider: 'onFoot',
      propulsion: 'human',
    });
    const pusher = resolveRacePresentation({ ...SKATEBOARD_TRAVERSAL });
    const motor = resolveRacePresentation({ ...MOTORCYCLE_TRAVERSAL });
    expect(speedTextFor(human, 80)).toBe('40 KM/H');
    expect(speedTextFor(motor, 80)).toBe('192 KM/H');
    expect(accelWordFor(runner)).toBe('RUN');
    expect(accelWordFor(human)).toBe('PEDAL');
    expect(accelWordFor(pusher)).toBe('PUSH');
    expect(accelWordFor(motor)).toBe('ACCEL');
    expect(slideWordFor(pusher, 'carve')).toBe('CARVE');
    expect(slideWordFor(human, 'grip')).toBe('DRIFT');
    expect(slideWordFor(LEGACY_PRESENTATION, null, 'jetski')).toBe('CARVE');
    expect(slideWordFor(LEGACY_PRESENTATION, null, 'hover')).toBe('DRIFT');
    const controls = racingControlsFor(human, 'grip');
    expect(controls.find((c) => c.button === 'B')!.label).toBe('PEDAL');
    expect(controls.find((c) => c.button === 'L')!.label).toBe('DRIFT');
    expect(racingControlsFor(pusher, 'carve').find((c) => c.button === 'L')!.label).toBe('CARVE');
    expect(helpControlsLineFor(human, 'grip')).toContain('B PEDAL');
    expect(helpControlsLineFor(pusher, 'carve')).toContain('L/R CARVE');
  });

  it('keeps the freeform label to titles and truncates it', () => {
    expect(titleLabelFor(undefined)).toBeNull();
    expect(titleLabelFor(null)).toBeNull();
    expect(titleLabelFor({ ...BICYCLE_TRAVERSAL })).toBe('Cycle Sprint');
    const long = titleLabelFor({
      label: 'A very long invented traversal name that overflows cards',
      handling: 'grip',
      surface: 'ground',
      rider: 'seated',
      propulsion: 'human',
    });
    expect(long!.length).toBeLessThanOrEqual(28);
  });

  it('validates resolveTraversal through the cup path', () => {
    expect(resolveTraversal(undefined)).toBeUndefined();
    expect(resolveTraversal({ ...BICYCLE_TRAVERSAL })).toEqual(BICYCLE_TRAVERSAL);
  });
});

describe('traversal runtime integration', () => {
  it('shows cadence-scaled human speed and the traversal label on cards', () => {
    const log: Op[] = [];
    const game = createRacingGame(mockEngine(log), specWith(BICYCLE_TRAVERSAL)) as DevGame;
    // Title phase carries the freeform label and the PEDAL verb.
    game.start();
    game.render();
    game.renderHud?.();
    const cardTexts = log
      .filter((o) => o.k === 'fillText')
      .map((o) => String((o.args as unknown[])[0]));
    expect(cardTexts).toContain('CYCLE SPRINT');
    expect(cardTexts.some((t) => t.includes('B PEDAL'))).toBe(true);
    // Racing phase reads cadence pace, never a 200 KM/H motor read.
    driveToRace(game);
    expect(game.racingDev.snapshot().player.speed).toBeGreaterThan(30);
    log.length = 0;
    game.render();
    game.renderHud?.();
    const speeds = hudSpeedTexts(log);
    expect(speeds.length).toBeGreaterThan(0);
    for (const v of speeds) expect(v).toBeLessThanOrEqual(64);
    game.dispose();
  });

  it('keeps the legacy motor speed readout on omission', () => {
    const log: Op[] = [];
    const game = createRacingGame(mockEngine(log), golden()) as DevGame;
    driveToRace(game);
    log.length = 0;
    game.render();
    game.renderHud?.();
    const speeds = hudSpeedTexts(log);
    expect(speeds.length).toBeGreaterThan(0);
    for (const v of speeds) expect(v).toBeGreaterThan(100);
    game.dispose();
  });

  it('renders a proper water wake for human propulsion on water', () => {
    const log: Op[] = [];
    const waterHuman: RacingTraversal = {
      label: 'Swim Sprint',
      handling: 'flow',
      surface: 'water',
      rider: 'onFoot',
      propulsion: 'human',
    };
    const game = createRacingGame(mockEngine(log), specWith(waterHuman)) as DevGame;
    driveToRace(game);
    log.length = 0;
    game.render();
    const fills = log.filter((o) => o.k === 'set:fillStyle').map((o) => String(o.v));
    // Hull-contact wake ellipse regardless of propulsion, no hover shadow.
    expect(fills).toContain('rgba(225,243,255,0.5)');
    expect(fills).not.toContain('rgba(0,0,0,0.45)');
    game.dispose();
  });

  it('renders parked traversal frames pixel-identically (exactly still)', () => {
    const log: Op[] = [];
    const game = createRacingGame(mockEngine(log), specWith(BICYCLE_TRAVERSAL)) as DevGame;
    game.start();
    game.render();
    log.length = 0;
    game.render();
    const first = JSON.parse(JSON.stringify(log)) as Op[];
    log.length = 0;
    game.render();
    expect(JSON.parse(JSON.stringify(log))).toEqual(first);
    game.dispose();
  });

  it('caches a failed panorama build per image instead of retrying every frame', () => {
    let builds = 0;
    (globalThis as unknown as Record<string, unknown>).document = {
      createElement: () => {
        builds++;
        return { width: 0, height: 0, getContext: () => null };
      },
    };
    const log: Op[] = [];
    const game = createRacingGame(packEngine(log, stubPack()), golden()) as DevGame;
    driveToRace(game);
    game.render();
    game.render();
    game.render();
    // One attempt for the current panorama image, not one per frame.
    expect(builds).toBe(1);
    game.dispose();
  });
});
