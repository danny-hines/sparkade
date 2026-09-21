// Racing spec milestone: schema-validated golden, lint codes, duration,
// spec-applied runtime (names/themes/pace/songs), music/attract hooks,
// phase transitions, renderHud overlay pass, total-cup time bonus.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOGICAL_BUTTONS, MIN_DURATION_S, type RacingSpec } from '@sparkade/shared';
import type { EngineContext, GameInstance, InputSnapshot } from '@sparkade/engine';
import { archetypes } from '@sparkade/archetypes';
import {
  BARRIER_X,
  PLAYER_INDEX,
  RACE_CIRCUITS,
  aiInputFor,
  auditCircuit,
  compileTrackVariant,
  createRaceFor,
  createRacingGame,
  cupCraftColors,
  resolveCupRaces,
  stepRace,
  truncateName,
  type RacerInput,
  type RacingDevHandle,
} from '../src/racing/index';
import { lintRacing, estimateRacingDurationS } from '../src/racing/index';

const DT = 1 / 60;

function idle(): RacerInput {
  return { steer: 0, accel: false, brake: false, boost: false, drift: false };
}

function golden(): RacingSpec {
  const path = join(__dirname, '..', '..', 'generation', 'golden', 'golden-racing.json');
  return JSON.parse(readFileSync(path, 'utf8')) as RacingSpec;
}

interface MockCards {
  shown: unknown[][];
  active: boolean;
}

function mockCtx(played: string[], cards?: MockCards): EngineContext {
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'createLinearGradient') return () => gradient;
        if (p === 'canvas') return { width: 480, height: 270 };
        return (..._args: unknown[]) => undefined;
      },
      set: () => true,
    },
  );
  return {
    renderer: { ctx },
    music: { playSong: (name: string) => played.push(name), stopSong: () => undefined },
    ...(cards
      ? {
          cards: {
            show: (c: unknown[]) => {
              cards.shown.push(c);
              cards.active = true;
            },
            get active() {
              return cards.active;
            },
          },
        }
      : {}),
  } as unknown as EngineContext;
}

function pressButton(button: (typeof LOGICAL_BUTTONS)[number]): InputSnapshot {
  const input = blankInput();
  input[button] = { held: true, pressed: true, released: false };
  return input;
}

function blankInput(): InputSnapshot {
  const input = {} as InputSnapshot;
  for (const button of LOGICAL_BUTTONS) input[button] = { held: false, pressed: false, released: false };
  return input;
}

type DevGame = GameInstance & RacingDevHandle;

describe('golden racing game', () => {
  it('passes lint with zero errors and meets the five-minute rule', () => {
    const spec = golden();
    expect(archetypes.racing.lint(spec)).toEqual([]);
    expect(archetypes.racing.estimateDurationS(spec)).toBeGreaterThanOrEqual(MIN_DURATION_S);
    expect(estimateRacingDurationS(spec)).toBeGreaterThanOrEqual(MIN_DURATION_S);
  });

  it('is registered with schema, controls, and content floors', () => {
    expect(archetypes.racing.id).toBe('racing');
    expect(archetypes.racing.schema).toBeDefined();
    expect(archetypes.racing.controlHelp.map((c) => c.button)).toContain('B');
    expect(archetypes.racing.contentFloors.levels).toBe(3);
    expect(archetypes.racing.contentFloors.enemyTypes).toBe(4);
  });
});

describe('lintRacing diagnostics', () => {
  function mutate(fn: (spec: RacingSpec) => void) {
    const spec = golden();
    fn(spec);
    return lintRacing(spec).map((e) => e.code);
  }

  it('rejects wrong circuit counts and unknown templates', () => {
    expect(mutate((s) => void s.levels.pop())).toContain('RACING_CIRCUIT_COUNT');
    expect(
      mutate((s) => {
        s.levels[0]!.template = 'volcano' as 'ember';
      }),
    ).toContain('RACING_UNKNOWN_TEMPLATE');
    expect(
      mutate((s) => {
        s.levels[0]!.laps = 5 as 3;
      }),
    ).toContain('RACING_LAPS');
  });

  it('rejects unfair pace, duplicate names, and bad timeouts', () => {
    expect(
      mutate((s) => {
        s.levels[0]!.rivals[0]!.topScale = 1.2;
      }),
    ).toContain('RACING_UNFAIR_PACE');
    expect(
      mutate((s) => {
        s.levels[0]!.rivals.pop();
      }),
    ).toContain('RACING_RIVAL_COUNT');
    expect(
      mutate((s) => {
        s.levels[1]!.rivals[1]!.name = s.levels[1]!.rivals[0]!.name;
      }),
    ).toContain('RACING_DUP_NAME');
    expect(
      mutate((s) => {
        s.levels[0]!.timeoutS = 60;
      }),
    ).toContain('RACING_TIMEOUT');
    expect(
      mutate((s) => {
        s.levels[0]!.timeoutS = 219;
      }),
    ).toContain('RACING_TIMEOUT');
  });

  it('keeps one cast across the cup and one of each template', () => {
    // Same slot, different name in race 2 (a mid-cup rename).
    expect(
      mutate((s) => {
        s.levels[1]!.rivals[0]!.name = 'STRANGER';
      }),
    ).toContain('RACING_RIVAL_SLOTS');
    // Repeated template instead of one of each.
    expect(
      mutate((s) => {
        s.levels[2]!.template = 'ember';
      }),
    ).toContain('RACING_TEMPLATE_SET');
  });

  it('rejects finale-rival mismatches and combat-shaped boss keys', () => {
    expect(
      mutate((s) => {
        s.boss.rivalIndex = 0;
      }),
    ).toContain('RACING_BOSS_INDEX');
    expect(
      mutate((s) => {
        s.boss.name = 'IMPOSTOR';
      }),
    ).toContain('RACING_BOSS_NAME');
    expect(
      mutate((s) => {
        s.boss.topScale = 0.9;
      }),
    ).toContain('RACING_BOSS_PACE');
    expect(
      mutate((s) => {
        (s.boss as unknown as Record<string, unknown>)['hp'] = 100;
      }),
    ).toContain('RACING_BOSS_SHAPE');
  });

  it('rejects unknown songs and bad music', () => {
    expect(
      mutate((s) => {
        s.levels[2]!.musicSong = 'nope';
      }),
    ).toContain('MUSIC_UNKNOWN_SONG');
  });
});

describe('resolveCupRaces', () => {
  it('defaults to the three template circuits with theme song then boss song', () => {
    const races = resolveCupRaces();
    expect(races.map((r) => r.circuit.id)).toEqual(['ember', 'coral', 'ratchet']);
    expect(races.map((r) => r.musicSong)).toEqual(['theme', 'theme', 'boss']);
  });

  it('applies every spec parameter instead of just accepting it', () => {
    const spec = golden();
    spec.difficulty = 'standard';
    spec.levels[0]!.name = 'Custom Loop';
    spec.levels[0]!.rivals[0] = { name: 'CUSTOM RIVAL', topScale: 0.75 };
    spec.levels[0]!.theme = { scenery: 'crystals', sun: '#123456' };
    spec.levels[0]!.timeoutS = 200;
    spec.levels[0]!.musicSong = 'boss';
    const races = resolveCupRaces(spec);
    const c = races[0]!.circuit;
    expect(c.name).toBe('Custom Loop');
    expect(c.names[1]).toBe('CUSTOM RIVAL');
    expect(c.aiScales[1]).toBe(0.75);
    expect(c.theme.scenery).toBe('crystals');
    expect(c.theme.sun).toBe('#123456');
    expect(c.timeout).toBe(200);
    expect(races[0]!.musicSong).toBe('boss');
    // Unchanged circuits keep the authored identity.
    expect(races[1]!.circuit.names[1]).toBe(spec.levels[1]!.rivals[0]!.name);
  });
});

describe('truncateName', () => {
  it('hard-cuts long generated names ASCII-safely', () => {
    expect(truncateName('VEX')).toBe('VEX');
    expect(truncateName('A'.repeat(40), 16)).toBe('A'.repeat(16));
    expect(truncateName('VEX PRIME CHAMPION OF THE OUTER LEAGUES', 10)).toHaveLength(10);
  });
});

describe('spec-driven runtime', () => {
  it('plays one song per race, exposes renderHud, and reaches race phase', () => {
    const played: string[] = [];
    const cards: MockCards = { shown: [], active: false };
    const game = createRacingGame(mockCtx(played, cards), golden()) as DevGame;
    expect(typeof game.renderHud).toBe('function');
    // World and overlay passes both run standalone on a mock context.
    game.render();
    game.renderHud!();
    // start() queues the intro through the host card system.
    game.start();
    expect(cards.shown).toHaveLength(1);
    cards.active = false;
    // Title -> countdown on A (the host owns START for pause), song starts.
    game.update(DT, pressButton('A'));
    expect(game.racingDev.snapshot().phase).toBe('countdown');
    expect(played).toEqual(['theme']);
    // Run out the countdown: the phase becomes racing proper, not countdown.
    for (let k = 0; k < Math.ceil(3 / DT) + 5; k++) game.update(DT, blankInput());
    expect(game.racingDev.snapshot().phase).toBe('race');
    expect(game.racingDev.snapshot().trackName).toBe(golden().levels[0]!.name);
    // START never advances the cup (host pause owns it).
    game.update(DT, pressButton('START'));
    expect(game.racingDev.snapshot().phase).toBe('race');
    game.dispose();
  });

  it('advances results with A on the real host control path', () => {
    const spec = golden();
    // Below-lint timeouts keep this test fast; resolveCupRaces applies them.
    for (const level of spec.levels) level.timeoutS = 5 as 220;
    const game = createRacingGame(mockCtx([]), spec) as DevGame;
    game.racingDev.setAutopilot(true);
    let frames = 0;
    while (frames < 3000 && game.racingDev.snapshot().phase !== 'results') {
      game.update(DT, blankInput());
      frames++;
    }
    expect(game.racingDev.snapshot().phase).toBe('results');
    expect(game.racingDev.snapshot().trackId).toBe('ember');
    game.racingDev.setAutopilot(false);
    game.update(DT, pressButton('A'));
    const next = game.racingDev.snapshot();
    expect(next.phase).toBe('title');
    expect(next.trackId).toBe('coral');
    game.dispose();
  });

  it('holds the result until A confirms and the narrative plays', () => {
    const spec = golden();
    for (const level of spec.levels) level.timeoutS = 5 as 220;
    const cards: MockCards = { shown: [], active: false };
    const game = createRacingGame(mockCtx([], cards), spec) as DevGame;
    game.racingDev.setAutopilot(true);
    let frames = 0;
    while (frames < 20000) {
      const s = game.racingDev.snapshot();
      if (s.cup.complete && s.phase === 'cupEnd') break;
      game.update(DT, blankInput());
      frames++;
    }
    const end = game.racingDev.snapshot();
    expect(end.phase).toBe('cupEnd');
    // Autopilot confirmed hands-off and queued the narrative cards.
    expect(cards.shown.length).toBeGreaterThan(0);
    // Result waits while narrative cards are up...
    cards.active = true;
    expect(game.result).toBeNull();
    // ...and goes final once they play out.
    cards.active = false;
    expect(game.result).not.toBeNull();
    game.dispose();
  });

  function fastTimeoutCup(): RacingSpec {
    const spec = golden();
    for (const level of spec.levels) level.timeoutS = 5 as 220;
    return spec;
  }

  async function driveTo(game: DevGame, phase: string, cap = 30000): Promise<void> {
    for (let f = 0; f < cap; f++) {
      if (game.racingDev.snapshot().phase === phase) return;
      game.update(DT, blankInput());
    }
    throw new Error(`never reached phase ${phase}`);
  }

  it('rolls back R1 results on restart: no double count, no skip', async () => {
    const game = createRacingGame(mockCtx([]), fastTimeoutCup()) as DevGame;
    game.racingDev.setAutopilot(true);
    await driveTo(game, 'results');
    const banked = game.racingDev.snapshot();
    expect(banked.cup.raceIndex).toBe(1);
    expect(banked.cup.points.reduce((a, b) => a + b, 0)).toBe(22);
    game.restart();
    const back = game.racingDev.snapshot();
    expect(back.phase).toBe('title');
    expect(back.cup.raceIndex).toBe(0);
    expect(back.cup.points).toEqual([0, 0, 0, 0, 0]);
    expect(back.trackId).toBe('ember');
    // Re-run the same race: points count exactly once, next is coral.
    game.racingDev.advance();
    await driveTo(game, 'results');
    const again = game.racingDev.snapshot();
    expect(again.cup.raceIndex).toBe(1);
    expect(again.cup.points.reduce((a, b) => a + b, 0)).toBe(22);
    game.racingDev.advance();
    expect(game.racingDev.snapshot().trackId).toBe('coral');
    game.dispose();
  });

  it('restores R2 on restart with R1 points preserved', async () => {
    const game = createRacingGame(mockCtx([]), fastTimeoutCup()) as DevGame;
    game.racingDev.setAutopilot(true);
    await driveTo(game, 'results');
    const race1Points = [...game.racingDev.snapshot().cup.points];
    game.racingDev.advance();
    await driveTo(game, 'results');
    expect(game.racingDev.snapshot().cup.raceIndex).toBe(2);
    game.restart();
    const back = game.racingDev.snapshot();
    expect(back.phase).toBe('title');
    expect(back.cup.raceIndex).toBe(1);
    expect(back.cup.points).toEqual(race1Points);
    expect(back.trackId).toBe('coral');
    game.dispose();
  });

  it('restarts the whole cup from the final standings', async () => {
    const game = createRacingGame(mockCtx([]), fastTimeoutCup()) as DevGame;
    game.racingDev.setAutopilot(true);
    await driveTo(game, 'cupEnd', 60000);
    expect(game.racingDev.snapshot().cup.complete).toBe(true);
    game.restart();
    const back = game.racingDev.snapshot();
    expect(back.phase).toBe('title');
    expect(back.cup.raceIndex).toBe(0);
    expect(back.cup.points).toEqual([0, 0, 0, 0, 0]);
    expect(back.cup.complete).toBe(false);
    expect(back.trackId).toBe('ember');
    game.dispose();
  });

  it('keeps previous results on a mid-race restart', async () => {
    const game = createRacingGame(mockCtx([]), fastTimeoutCup()) as DevGame;
    game.racingDev.setAutopilot(true);
    await driveTo(game, 'results');
    game.racingDev.advance();
    await driveTo(game, 'race');
    game.restart();
    const back = game.racingDev.snapshot();
    expect(back.cup.raceIndex).toBe(1);
    expect(back.cup.points.reduce((a, b) => a + b, 0)).toBe(22);
    expect(back.trackId).toBe('coral');
    expect(back.t).toBe(0);
    game.dispose();
  });

  it('audits mirrored and rescaled variants within bounds', () => {
    for (const base of RACE_CIRCUITS) {
      for (const variant of [
        compileTrackVariant(base.id, { mirror: true }),
        compileTrackVariant(base.id, { length: 2800 }),
        compileTrackVariant(base.id, { length: 3600 }),
      ]) {
        const a = auditCircuit(variant.track, variant.pads);
        expect(a.finite).toBe(true);
        expect(a.seamStep / a.meanStep).toBeGreaterThan(0.9);
        expect(a.seamStep / a.meanStep).toBeLessThan(1.1);
        expect(a.seamTangentDot).toBeGreaterThan(0.999);
        // Length rescales curvature inversely; the band holds at the extrema.
        expect(a.maxCurvature).toBeLessThan(0.03);
        expect(a.minSeparation).toBeGreaterThan(4 * BARRIER_X);
        expect(a.padsInBounds).toBe(true);
      }
    }
    // Mirror flips handedness without changing magnitude.
    const fwd = RACE_CIRCUITS[0]!.track;
    const rev = compileTrackVariant('ember', { mirror: true }).track;
    expect(Math.abs(rev.curvatureAt(100) + fwd.curvatureAt(100))).toBeLessThan(
      Math.abs(rev.curvatureAt(100)) * 0.1 + 1e-6,
    );
  });

  it('finishes a lap on the hardest variant (mirrored shortest)', () => {
    const circuit = compileTrackVariant('ember', { length: 2800, mirror: true });
    const race = createRaceFor({ ...RACE_CIRCUITS[0]!, track: circuit.track, pads: circuit.pads });
    race.countdown = 0;
    const inputs = race.racers.map(() => idle());
    for (let k = 0; k < Math.ceil(200 / DT) && race.racers[PLAYER_INDEX]!.lap < 1; k++) {
      for (let i = 0; i < race.racers.length; i++) aiInputFor(race, i, inputs[i]);
      stepRace(race, inputs, DT);
    }
    expect(race.racers[PLAYER_INDEX]!.lap).toBeGreaterThanOrEqual(1);
  });

  it('applies length/mirror/shape and palette liveries from spec', () => {
    const spec = golden();
    spec.levels[0]!.length = 2900;
    spec.levels[0]!.mirror = true;
    spec.levels[0]!.craftShape = 'dart';
    const races = resolveCupRaces(spec);
    expect(races[0]!.circuit.track.length).toBeCloseTo(2900, -1);
    expect(races[0]!.circuit.craftShape).toBe('dart');
    // Palette-derived liveries: player on hero slot, rivals on enemy slots.
    const colors = cupCraftColors(spec);
    expect(colors.hulls[0]).toBe(spec.palette[6]);
    expect(colors.hulls.slice(1)).toEqual([spec.palette[8], spec.palette[9], spec.palette[10], spec.palette[12]]);
    expect(new Set(colors.hulls).size).toBe(5);
    // Stable across resolves; defaults without a palette.
    expect(cupCraftColors(spec).hulls).toEqual(colors.hulls);
    expect(cupCraftColors().hulls).toHaveLength(5);
  });

  it('rejects out-of-band authored lengths', () => {
    const spec = golden();
    spec.levels[0]!.length = 2000;
    expect(lintRacing(spec).map((e) => e.code)).toContain('RACING_LENGTH');
  });

  it('applies difficulty as bounded rival pace', () => {
    const spec = golden();
    spec.levels[2]!.rivals[spec.boss.rivalIndex - 1]!.topScale = 1;
    const openingPace = spec.levels[0]!.rivals[0]!.topScale;
    const chill = resolveCupRaces({ ...spec, difficulty: 'chill' });
    expect(chill[0]!.circuit.aiScales[1]).toBeCloseTo(openingPace * 0.92, 3);
    const spicy = resolveCupRaces({ ...spec, difficulty: 'spicy' });
    // Finale pace clamps at player top speed, never above it.
    expect(spicy[2]!.circuit.aiScales[spec.boss.rivalIndex]).toBe(1);
    expect(spicy[0]!.circuit.aiScales[1]).toBeGreaterThan(openingPace);
  });

  it('self-drives in attract mode with no input', () => {
    const engine = mockCtx([]);
    (engine as unknown as { attract: boolean }).attract = true;
    const game = createRacingGame(engine, golden()) as DevGame;
    expect(game.racingDev.snapshot().autopilot).toBe(true);
    for (let k = 0; k < 180; k++) game.update(DT, blankInput());
    expect(game.racingDev.snapshot().player.speed).toBeGreaterThan(5);
    game.dispose();
  });

  it('scores the time bonus from TOTAL cup elapsed on a spec-pace win', () => {
    const spec = golden();
    // Drive the player through actual digital inputs. Rival behavior may
    // change without making the old autopilot's podium a scoring invariant.
    for (const level of spec.levels) {
      for (const rival of level.rivals) rival.topScale = 0.7;
    }
    spec.boss.topScale = 0.9;
    spec.levels[2]!.rivals[spec.boss.rivalIndex - 1]!.topScale = 0.9;
    expect(lintRacing(spec)).toEqual([]);
    const game = createRacingGame(mockCtx([]), spec) as DevGame;
    const circuits = resolveCupRaces(spec);
    const elapsedByRace = [0, 0, 0];
    let frames = 0;
    while (frames < 90000) {
      const s = game.racingDev.snapshot();
      if (game.result) break;
      const input = blankInput();
      if (s.phase === 'title' || s.phase === 'results' || s.phase === 'cupEnd') {
        input.A.pressed = frames % 2 === 0;
      } else {
        elapsedByRace[s.cup.raceIndex]! += DT;
        const track = circuits[s.cup.raceIndex]!.circuit.track;
        const curve = track.curvatureAt(s.player.s + 30);
        const targetX = Math.max(-1.5, Math.min(1.5, curve * 300));
        input.LEFT.held = s.player.x > targetX + 0.3;
        input.RIGHT.held = s.player.x < targetX - 0.3;
        input.B.held = true;
        input.L.held = Math.abs(curve) > 0.012 && s.player.speed > 65;
        input.A.pressed = Math.abs(track.curvatureAt(s.player.s + 90)) < 0.002
          && s.player.speed > 40 && s.player.boostT <= 0 && s.player.boost >= 0.3;
      }
      game.update(DT, input);
      frames++;
    }
    const end = game.racingDev.snapshot();
    expect(end.cup.complete).toBe(true);
    const result = game.result;
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe('won');
    // Count real racing/countdown frames independently of the game's score.
    // A driver improvement can change lap times without weakening coverage
    // of the whole-cup-versus-finale regression.
    expect(result!.timeBonusSeconds).toBeGreaterThan(0);
    expect(result!.timeBonusSeconds).toBe(
      Math.round(900 - elapsedByRace.reduce((total, elapsed) => total + elapsed, 0)),
    );
    expect(result!.timeBonusSeconds).toBeLessThan(Math.round(900 - elapsedByRace[2]!));
    game.dispose();
  });
});
