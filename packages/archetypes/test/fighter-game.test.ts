import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOGICAL_BUTTONS,
  fighterStyleExample,
  type FighterCombatProfile,
  type FighterPose,
  type FighterSpec,
  type LogicalButton,
} from '@sparkade/shared';
import {
  STEP,
  Rng,
  type EngineContext,
  type GameInstance,
  type InputSnapshot,
} from '@sparkade/engine';
import { createFighterGame, fighterWalkPoseAtTime } from '../src/fighter/game';

vi.mock('@sparkade/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sparkade/engine')>();
  return {
    ...actual,
    makeBackdrop: () => ({
      draw: () => undefined,
      drawForeground: () => undefined,
    }),
  };
});

type MoveId = 'punchHigh' | 'punchLow' | 'kickHigh' | 'kickLow' | 'airPunch' | 'airKick' | 'pulse';
type ActorState =
  'idle' | 'walk' | 'crouch' | 'jump' | 'attack' | 'block' | 'hitstun' | 'blockstun' | 'ko';

interface TestActor {
  profile: FighterCombatProfile | null;
  ai: boolean;
  confirmed: boolean;
  chain: number;
  chainT: number;
  escapeT: number;
  guardWindow: number;
  guardCooldown: number;
  counterT: number;
  pulseCooldown: number;
  receivedChain: number;
  scale: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  state: ActorState;
  walkT: number;
  move: MoveId | null;
  moveT: number;
  moveSerial: number;
  stunT: number;
  block: boolean;
  crouch: boolean;
  bufferedMove: MoveId | null;
  bufferT: number;
  aiT: number;
  aiIntent: 'approach' | 'retreat' | 'attack' | 'block' | 'jump' | 'wait';
  aggression: number;
  aiRecoveryT: number;
  identitySlot: number;
  speedScale: number;
  aiPulseId: number;
  aiDefense: 'guard' | 'duck' | 'jump' | null;
  aiDefenseT: number;
}

interface FighterHarness extends GameInstance {
  pulses: { x: number; y: number; owner: TestActor; vx: number; life: number }[];
  control(a: TestActor, dt: number, input: InputSnapshot): void;
  resolveHits(a: TestActor, b: TestActor): void;
  tickKit(a: TestActor, dt: number): void;
  tryChain(a: TestActor, move: MoveId): boolean;
  updatePulses(dt: number): void;
  startRound(fresh: boolean): void;
  enterBout(index: number): void;
  phase: 'cards' | 'fight';
  roundPhase: 'ready' | 'fight' | 'over';
  p: TestActor;
  o: TestActor;
  generatedFighterAtlases: readonly CanvasImageSource[];
  generatedFighterArena: CanvasImageSource | null;
  preparedFighterPoses: readonly Readonly<
    Record<FighterPose, { normal: CanvasImageSource; flash: CanvasImageSource }>
  >[];
  preparedFighterArenas: readonly [CanvasImageSource, CanvasImageSource] | null;
  bout: number;
  startMove(actor: TestActor, move: MoveId): void;
  aiControl(actor: TestActor, foe: TestActor, dt: number): void;
  stepActor(actor: TestActor, dt: number): void;
  poseOf(actor: TestActor): FighterPose;
  drawArenaBackground(): void;
  drawGeneratedFighter(actor: TestActor, pose: FighterPose, flash: boolean): void;
}

interface HarnessOptions {
  difficulty?: 'chill' | 'standard' | 'spicy';
  profile?: FighterCombatProfile;
  chance?: boolean | ((probability: number) => boolean);
  fighterAtlases?: readonly CanvasImageSource[] | null;
  fighterArenaAtlas?: CanvasImageSource | null;
  fighterArenaPresentationBaked?: boolean;
  rangeUnit?: number;
  seed?: number;
}

interface GeneratedDrawEvent {
  image: CanvasImageSource;
  x: number;
  y: number;
  width: number;
  height: number;
  filter: string;
  source?: { x: number; y: number; width: number; height: number };
}

let preparedCanvasId = 0;

function fakePreparedCanvas(): HTMLCanvasElement {
  const ctx = {
    filter: 'none',
    fillStyle: '#000000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    drawImage: (): void => undefined,
    fillRect: (): void => undefined,
  };
  return {
    kind: 'prepared-fighter-canvas',
    id: preparedCanvasId++,
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
  preparedCanvasId = 0;
  vi.stubGlobal('document', {
    createElement: (name: string) => {
      if (name !== 'canvas') throw new Error(`unexpected element ${name}`);
      return fakePreparedCanvas();
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

function loadSpec(): FighterSpec {
  const path = join(__dirname, '..', '..', 'generation', 'golden', 'golden-fighter.json');
  return JSON.parse(readFileSync(path, 'utf8')) as FighterSpec;
}

function stubFighterAtlases(): readonly CanvasImageSource[] {
  return Array.from(
    { length: 5 },
    (_, identitySlot) => ({ identitySlot }) as unknown as CanvasImageSource,
  );
}

function snapshot(options: { block?: boolean; press?: LogicalButton } = {}): InputSnapshot {
  const input = {} as InputSnapshot;
  for (const button of LOGICAL_BUTTONS) {
    input[button] = { held: false, pressed: false, released: false };
  }
  if (options.block) input.L.held = true;
  if (options.press) {
    input[options.press] = { held: true, pressed: true, released: false };
  }
  return input;
}

function makeHarness(options: HarnessOptions = {}): {
  game: FighterHarness;
  sfxEvents: string[];
  chanceEvents: number[];
  generatedDraws: GeneratedDrawEvent[];
  transforms: Array<readonly ['translate' | 'scale', number, number]>;
} {
  const spec = options.profile ? fighterStyleExample(loadSpec(), options.profile) : loadSpec();
  if (options.difficulty) spec.difficulty = options.difficulty;
  const sfxEvents: string[] = [];
  const chanceEvents: number[] = [];
  const generatedDraws: GeneratedDrawEvent[] = [];
  const transforms: Array<readonly ['translate' | 'scale', number, number]> = [];
  const noop = (): void => undefined;
  const ctx = {
    filter: 'none',
    fillStyle: '#000000',
    imageSmoothingEnabled: true,
    save: noop,
    restore: noop,
    beginPath: noop,
    ellipse: noop,
    fill: noop,
    translate: (x: number, y: number) => transforms.push(['translate', x, y]),
    scale: (x: number, y: number) => transforms.push(['scale', x, y]),
    drawImage: (image: CanvasImageSource, ...values: number[]) => {
      if (values.length === 8) {
        const [sx, sy, sw, sh, x, y, width, height] = values as [
          number,
          number,
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        generatedDraws.push({
          image,
          x,
          y,
          width,
          height,
          filter: ctx.filter,
          source: { x: sx, y: sy, width: sw, height: sh },
        });
        return;
      }
      const [x, y, width, height] = values as [number, number, number, number];
      generatedDraws.push({ image, x, y, width, height, filter: ctx.filter });
    },
  };
  const engine = {
    renderer: {
      ctx,
      theme: { text: '#fff', heading: '#fff' },
      clear: noop,
      rect: noop,
      frame: noop,
      text: noop,
    },
    sprites: { likenessHead: () => null },
    rng:
      options.seed === undefined
        ? {
            chance: (probability: number) => {
              chanceEvents.push(probability);
              return typeof options.chance === 'function'
                ? options.chance(probability)
                : (options.chance ?? true);
            },
            range: (min: number, max: number) => min + (max - min) * (options.rangeUnit ?? 0),
          }
        : new Rng(options.seed),
    cards: {
      show: (_cards: unknown, done?: () => void) => done?.(),
    },
    music: { playJingle: noop, playSong: noop, stopSong: noop },
    sfx: { play: (name: string) => sfxEvents.push(name) },
    particles: { burst: noop },
    camera: { snap: noop },
    portrait: null,
    fighterAtlases:
      options.fighterAtlases === undefined ? stubFighterAtlases() : options.fighterAtlases,
    fighterArenaAtlas: options.fighterArenaAtlas ?? null,
    fighterArenaPresentationBaked: options.fighterArenaPresentationBaked ?? false,
    attract: false,
    shake: noop,
    hitStop: noop,
    spec,
  } as unknown as EngineContext;

  const game = createFighterGame(engine, spec) as FighterHarness;
  game.start();
  game.phase = 'fight';
  game.roundPhase = 'fight';
  return { game, sfxEvents, chanceEvents, generatedDraws, transforms };
}

function putAtLeftWall(game: FighterHarness): void {
  game.p.x = 26;
  game.o.x = 56;
  game.p.facing = 1;
  game.o.facing = -1;
  game.p.state = 'idle';
  game.o.state = 'idle';
  game.p.move = null;
  game.o.move = null;
}

describe('fighter pressure and counter windows', () => {
  it('consumes a cached AI attack intent after one move', () => {
    const { game, sfxEvents } = makeHarness({ chance: true, rangeUnit: 0 });
    putAtLeftWall(game);
    game.o.aiIntent = 'attack';
    game.o.aiT = 0.5;

    for (let frame = 0; frame < 16; frame++) {
      game.aiControl(game.o, game.p, STEP);
      game.stepActor(game.o, STEP);
    }

    expect(game.o.moveSerial).toBe(1);
    expect(sfxEvents.filter((event) => event === 'shoot')).toHaveLength(1);
    expect(game.o.aiIntent).toBe('wait');
  });

  it('clears grounded approach velocity when a move starts', () => {
    const { game } = makeHarness();
    game.p.vx = 78;

    game.startMove(game.p, 'punchHigh');

    expect(game.p.state).toBe('attack');
    expect(game.p.vx).toBe(0);
  });

  it('makes only one reactive guard decision per incoming move', () => {
    const { game, chanceEvents } = makeHarness({ chance: false });
    putAtLeftWall(game);
    game.o.aiIntent = 'wait';
    game.o.aiT = 1;
    game.startMove(game.p, 'punchHigh');

    for (let frame = 0; frame < 4; frame++) {
      game.aiControl(game.o, game.p, STEP);
      game.stepActor(game.p, STEP);
    }

    expect(chanceEvents).toHaveLength(1);
  });

  it('lets a cornered player regain held guard before another full hit', () => {
    const { game, sfxEvents } = makeHarness({ chance: true, rangeUnit: 0 });
    putAtLeftWall(game);
    game.o.aiIntent = 'attack';
    game.o.aiT = 0.5;

    let firstHit = false;
    let sawGuardWindow = false;
    for (let frame = 0; frame < 90; frame++) {
      game.update(STEP, snapshot({ block: firstHit }));
      if (sfxEvents.includes('hit')) firstHit = true;
      if (firstHit && game.p.state === 'block') {
        sawGuardWindow = true;
        break;
      }
    }

    expect(firstHit).toBe(true);
    expect(sawGuardWindow).toBe(true);
    expect(sfxEvents.filter((event) => event === 'hit')).toHaveLength(1);
  });

  it('executes a counter pressed during the final 140ms of hitstun', () => {
    // Refuse every reactive guard roll so a successfully buffered counter can
    // also demonstrate that the AI's contact recovery is a real punish window.
    const { game, sfxEvents } = makeHarness({ chance: false, rangeUnit: 0 });
    putAtLeftWall(game);
    game.o.aiIntent = 'attack';
    game.o.aiT = 0.5;
    const opponentHp = game.o.hp;

    let pressedAtStun = 0;
    for (let frame = 0; frame < 90; frame++) {
      if (
        game.p.state === 'hitstun' &&
        game.p.stunT > 0 &&
        game.p.stunT <= 0.12 &&
        pressedAtStun === 0
      ) {
        pressedAtStun = game.p.stunT;
        game.update(STEP, snapshot({ press: 'B' }));
      } else {
        game.update(STEP, snapshot());
      }
      if (pressedAtStun > 0 && game.o.hp < opponentHp) break;
    }

    expect(pressedAtStun).toBeGreaterThan(0);
    expect(pressedAtStun).toBeLessThanOrEqual(0.14);
    expect(game.p.moveSerial).toBe(1);
    expect(game.o.hp).toBeLessThan(opponentHp);
    expect(sfxEvents.filter((event) => event === 'hit')).toHaveLength(2);
  });
});

describe('generated fighter art', () => {
  it('alternates idle and walk at eight frames per second while moving', () => {
    expect(fighterWalkPoseAtTime(0)).toBe('idle');
    expect(fighterWalkPoseAtTime(0.13)).toBe('walk');
    expect(fighterWalkPoseAtTime(0.26)).toBe('idle');

    const { game } = makeHarness();
    game.p.state = 'walk';
    game.p.vx = 78;
    for (let frame = 0; frame < 8; frame++) game.stepActor(game.p, STEP);
    expect(game.poseOf(game.p)).toBe('walk');
    game.p.state = 'idle';
    game.stepActor(game.p, STEP);
    expect(game.p.walkT).toBe(0);
    expect(game.poseOf(game.p)).toBe('idle');
  });

  it('uses the reusable ladder panel and distinct boss panel from one arena atlas', () => {
    const arena = { kind: 'fighter-arena' } as unknown as CanvasImageSource;
    const { game, generatedDraws } = makeHarness({ fighterArenaAtlas: arena });

    game.bout = 0;
    game.drawArenaBackground();
    game.bout = 3;
    game.drawArenaBackground();

    expect(game.generatedFighterArena).toBe(arena);
    expect(game.preparedFighterArenas).not.toBeNull();
    expect(generatedDraws).toEqual([
      {
        image: game.preparedFighterArenas![0],
        x: 0,
        y: 0,
        width: 512,
        height: 300,
        filter: 'none',
      },
      {
        image: game.preparedFighterArenas![1],
        x: 0,
        y: 0,
        width: 512,
        height: 300,
        filter: 'none',
      },
    ]);
  });

  it('requires one complete five-atlas roster', () => {
    const complete = stubFighterAtlases();
    const ready = makeHarness({ fighterAtlases: complete });
    expect(ready.game.generatedFighterAtlases).toEqual(complete);
    expect(ready.game.drawGeneratedFighter(ready.game.p, 'idle', false)).toBeUndefined();

    expect(() => makeHarness({ fighterAtlases: complete.slice(0, 4) })).toThrow(
      'Fighter requires one complete five-character generated atlas roster',
    );
    expect(() => makeHarness({ fighterAtlases: null })).toThrow(
      'Fighter requires one complete five-character generated atlas roster',
    );
  });

  it('mirrors left-facing art and selects the cached hit-flash pose', () => {
    const atlases = stubFighterAtlases();
    const { game, generatedDraws, transforms } = makeHarness({ fighterAtlases: atlases });
    game.p.facing = -1;

    expect(game.drawGeneratedFighter(game.p, 'hit', true)).toBeUndefined();
    expect(transforms).toEqual([
      ['translate', Math.round(game.p.x) * 2, 0],
      ['scale', -1, 1],
    ]);
    expect(generatedDraws).toEqual([
      {
        image: game.preparedFighterPoses[0]!.hit.flash,
        x: Math.round(game.p.x) - 48,
        y: Math.round(game.p.y) - 92,
        width: 96,
        height: 96,
        filter: 'none',
      },
    ]);
  });

  it('selects each pose and opponent identity from the prepared roster cache', () => {
    const atlases = stubFighterAtlases();
    const { game, generatedDraws } = makeHarness({ fighterAtlases: atlases });

    expect(game.generatedFighterAtlases).toEqual(atlases);
    expect(game.drawGeneratedFighter(game.o, 'airKick', false)).toBeUndefined();
    const x = Math.round(game.o.x) - 48;
    const y = Math.round(game.o.y) - 92;
    expect(generatedDraws).toEqual([
      {
        image: game.preparedFighterPoses[game.o.identitySlot]!.airKick.normal,
        x,
        y,
        width: 96,
        height: 96,
        filter: 'none',
      },
    ]);
  });

  it('keeps live rendering to one unfiltered arena draw and one draw per fighter', () => {
    const arena = { kind: 'fighter-arena' } as unknown as CanvasImageSource;
    const { game, generatedDraws } = makeHarness({ fighterArenaAtlas: arena });

    game.render();

    expect(generatedDraws).toHaveLength(3);
    expect(generatedDraws.every((draw) => draw.filter === 'none')).toBe(true);
    expect(generatedDraws.every((draw) => draw.source === undefined)).toBe(true);
    expect(generatedDraws.slice(1).map((draw) => draw.image)).toEqual([
      game.preparedFighterPoses[game.o.identitySlot]!.idle.normal,
      game.preparedFighterPoses[game.p.identitySlot]!.idle.normal,
    ]);
  });

  it('renders only the cached arena behind story cards', () => {
    const arena = { kind: 'fighter-arena' } as unknown as CanvasImageSource;
    const { game, generatedDraws } = makeHarness({ fighterArenaAtlas: arena });
    game.phase = 'cards';

    game.render();

    expect(generatedDraws).toEqual([
      {
        image: game.preparedFighterArenas![0],
        x: 0,
        y: 0,
        width: 512,
        height: 300,
        filter: 'none',
      },
    ]);
  });
});

describe('Fighter combat identities', () => {
  const positioned = (profile: FighterCombatProfile) => {
    const { game } = makeHarness({ profile, chance: false });
    game.p.x = 100;
    game.o.x = 130;
    game.p.facing = 1;
    game.o.facing = -1;
    game.o.aiRecoveryT = 1000;
    return game;
  };
  const confirm = (game: FighterHarness, button: LogicalButton) => {
    game.update(STEP, snapshot({ press: button }));
    for (let i = 0; i < 20 && !game.p.confirmed; i++) game.update(STEP, snapshot());
    expect(game.p.confirmed).toBe(true);
  };
  it('chains three distinct rushdown strikes, scales damage, and grants an escape after the third', () => {
    const game = positioned('rushdown');
    const hp = game.o.hp;
    confirm(game, 'B');
    confirm(game, 'Y');
    confirm(game, 'X');
    expect(game.p.chain).toBe(3);
    expect(hp - game.o.hp).toBeCloseTo(5 + 8 * 0.75 + 12 * 0.55);
    expect(game.o.escapeT).toBeGreaterThan(0);
    expect(game.tryChain(game.p, 'punchLow')).toBe(false);
    const after = game.o.hp;
    game.startMove(game.p, 'punchLow');
    game.stepActor(game.p, 0.05);
    game.resolveHits(game.p, game.o);
    expect(game.o.hp).toBe(after);
  });
  it('cannot cancel a miss or a blocked attack into a chain', () => {
    const game = positioned('rushdown');
    game.startMove(game.p, 'punchLow');
    game.stepActor(game.p, 0.05);
    game.o.x = 400;
    game.resolveHits(game.p, game.o);
    expect(game.tryChain(game.p, 'punchHigh')).toBe(false);
    game.o.x = 130;
    game.o.block = true;
    game.o.crouch = true;
    game.resolveHits(game.p, game.o);
    expect(game.tryChain(game.p, 'punchHigh')).toBe(false);
    expect(game.p.chain).toBe(0);
  });
  it('rewards a fresh timed guard but holding guard does not continually reopen the window', () => {
    const game = positioned('counter');
    game.o.ai = false;
    game.control(game.p, STEP, snapshot({ block: true }));
    game.startMove(game.o, 'punchHigh');
    game.stepActor(game.o, 0.07);
    const hp = game.p.hp;
    game.resolveHits(game.o, game.p);
    expect(game.p.hp).toBe(hp);
    expect(game.p.counterT).toBeGreaterThan(0);
    expect(game.o.state).toBe('hitstun');
    game.tickKit(game.p, 1);
    game.control(game.p, STEP, snapshot({ block: true }));
    expect(game.p.guardWindow).toBe(0);
    game.startMove(game.o, 'punchHigh');
    game.stepActor(game.o, 0.07);
    game.resolveHits(game.o, game.p);
    expect(game.p.hp).toBeLessThan(hp);
  });
  it('limits non-rushdown characters to two-hit chains', () => {
    const game = positioned('counter');
    confirm(game, 'B');
    confirm(game, 'Y');
    expect(game.tryChain(game.p, 'kickHigh')).toBe(false);
  });
  it('telegraphs a finite pulse, consumes its charge and lets a crouching fighter duck it', () => {
    const game = positioned('rangedControl');
    game.o.x = 220;
    game.control(game.p, STEP, snapshot({ block: true, press: 'Y' }));
    expect(game.p.move).toBe('pulse');
    expect(game.p.pulseCooldown).toBe(2);
    game.stepActor(game.p, 0.27);
    expect(game.pulses).toHaveLength(0);
    game.stepActor(game.p, 0.02);
    expect(game.pulses).toHaveLength(1);
    game.o.crouch = true;
    const hp = game.o.hp;
    for (let i = 0; i < 160; i++) game.updatePulses(STEP);
    expect(game.o.hp).toBe(hp);
    expect(game.pulses).toHaveLength(0);
    game.startRound(false);
    expect(game.p.pulseCooldown).toBe(0);
    expect(game.p.counterT).toBe(0);
  });
  it('interrupts a pulse windup before it can emit', () => {
    const game = positioned('rangedControl');
    game.startMove(game.p, 'pulse');
    game.startMove(game.o, 'punchHigh');
    game.stepActor(game.o, 0.1);
    game.resolveHits(game.o, game.p);
    expect(game.p.state).toBe('hitstun');
    game.stepActor(game.p, 0.5);
    expect(game.pulses).toHaveLength(0);
  });
  it.each(['stand', 'guard', 'duck', 'jump'] as const)(
    'pulses respect %s across all nine body-size matchups',
    (defense) => {
      for (const attackerScale of [0.94, 1.05, 1.16])
        for (const defenderScale of [0.94, 1.05, 1.16]) {
          const game = positioned('rangedControl');
          game.p.scale = attackerScale;
          game.o.scale = defenderScale;
          game.o.x = 230;
          game.o.profile = 'rushdown';
          game.o.block = defense === 'guard';
          game.o.crouch = defense === 'duck';
          if (defense === 'jump') game.o.y -= 85;
          const hp = game.o.hp;
          game.startMove(game.p, 'pulse');
          game.stepActor(game.p, 0.29);
          for (let i = 0; i < 160; i++) game.updatePulses(STEP);
          expect(hp - game.o.hp, `${attackerScale} -> ${defenderScale}`).toBeCloseTo(
            defense === 'stand' ? 10 : defense === 'guard' ? 1.2 : 0,
          );
          expect(game.pulses).toHaveLength(0);
        }
    },
  );
  it('spends the counter bonus on one retaliatory attack and expires unused readiness', () => {
    const game = positioned('counter');
    game.p.counterT = 0.9;
    const hp = game.o.hp;
    confirm(game, 'B');
    expect(hp - game.o.hp).toBeCloseTo(5 * 1.65);
    expect(game.p.counterT).toBe(0);
    game.p.counterT = 0.9;
    game.tickKit(game.p, 1);
    expect(game.p.counterT).toBe(0);
    game.startRound(false);
    expect(game.p.guardWindow).toBe(0);
    expect(game.p.chain).toBe(0);
    expect(game.p.escapeT).toBe(0);
  });
  it('keeps projectile knockback aligned with travel after its owner turns around', () => {
    const game = positioned('rangedControl');
    game.o.x = 230;
    game.startMove(game.p, 'pulse');
    game.stepActor(game.p, 0.29);
    game.p.facing = -1;
    for (let i = 0; i < 50 && game.pulses.length; i++) game.updatePulses(STEP);
    expect(game.o.hp).toBeLessThan(game.o.maxHp);
    expect(game.o.vx).toBeGreaterThan(0);
  });
  it.each(['rushdown', 'counter', 'rangedControl'] as const)(
    '%s can physically jump above the highest pulse lane',
    (profile) => {
      const game = positioned(profile);
      const floor = game.p.y;
      game.control(game.p, STEP, snapshot({ press: 'UP' }));
      let apex = floor;
      for (let i = 0; i < 80; i++) {
        game.stepActor(game.p, STEP);
        apex = Math.min(apex, game.p.y);
      }
      expect(floor - apex).toBeGreaterThan(85);
      expect(game.p.y).toBe(floor);
    },
  );
  it('makes ranged AI fire at distance and rushdown AI select a chain opener', () => {
    const ranged = positioned('rangedControl');
    ranged.o.profile = 'rangedControl';
    ranged.o.aiRecoveryT = 0;
    ranged.p.x = 60;
    ranged.o.x = 350;
    ranged.aiControl(ranged.o, ranged.p, STEP);
    expect(ranged.o.move).toBe('pulse');
    const rush = positioned('rushdown');
    rush.o.aiRecoveryT = 0;
    rush.o.aiIntent = 'attack';
    rush.o.aiT = 1;
    rush.aiControl(rush.o, rush.p, STEP);
    expect(rush.o.move).toBe('punchLow');
  });
});

describe('Fighter fairness with ordinary health', () => {
  it.each(['chill', 'standard', 'spicy'] as const)(
    '%s guards wait for a visible reaction even at boss aggression',
    (difficulty) => {
      const { game } = makeHarness({ profile: 'counter', difficulty, chance: true });
      game.p.x = 100;
      game.o.x = 132;
      game.o.aggression = 100;
      game.o.aiIntent = 'wait';
      game.o.aiT = 5;
      game.startMove(game.p, 'kickHigh');
      for (let i = 0; i < 6; i++) {
        game.aiControl(game.o, game.p, STEP);
        expect(game.o.block).toBe(false);
      }
      for (let i = 0; i < 20; i++) game.aiControl(game.o, game.p, STEP);
      expect(game.o.block).toBe(true);
    },
  );

  it('rolls a declined anti-air once for an entire jump', () => {
    const { game, chanceEvents } = makeHarness({ profile: 'counter', chance: false });
    game.p.x = 100;
    game.o.x = 132;
    game.p.y -= 30;
    game.o.aiIntent = 'wait';
    game.o.aiT = 5;
    for (let i = 0; i < 60; i++) game.aiControl(game.o, game.p, STEP);
    expect(chanceEvents).toHaveLength(1);
    expect(game.o.move).toBeNull();
  });

  it.each(['rushdown', 'counter', 'rangedControl'] as const)(
    '%s responds to an emitted projectile and survives without healing',
    (profile) => {
      const { game } = makeHarness({ profile: 'rangedControl', chance: true });
      game.p.x = 80;
      game.o.x = 310;
      game.p.facing = 1;
      game.o.profile = profile;
      game.o.pulseCooldown = 2; // Exercise defense while its own shot is recharging.
      game.o.aiIntent = 'wait';
      game.o.aiT = 5;
      game.startMove(game.p, 'pulse');
      game.aiControl(game.o, game.p, STEP);
      expect(game.o.aiPulseId).toBe(-1); // Windup alone grants no projectile read.
      game.stepActor(game.p, 0.29);
      let defended = false,
        recovered = false;
      for (let i = 0; i < 120; i++) {
        game.aiControl(game.o, game.p, STEP);
        game.stepActor(game.o, STEP);
        game.updatePulses(STEP);
        if (i < 6) expect(game.o.aiDefense).toBeNull();
        defended ||= game.o.aiDefense !== null;
        recovered ||= defended && game.o.aiDefense === null && game.o.aiRecoveryT > 0;
      }
      expect(defended).toBe(true);
      expect(recovered).toBe(true);
      expect(game.o.hp).toBe(game.o.maxHp);
    },
  );

  it('a missed projectile response remains a mistake rather than rerolling into immunity', () => {
    const { game, chanceEvents } = makeHarness({ profile: 'counter', chance: false });
    game.p.x = 80;
    game.o.x = 310;
    game.p.facing = 1;
    game.o.aiIntent = 'wait';
    game.o.aiT = 5;
    game.startMove(game.p, 'pulse');
    game.stepActor(game.p, 0.29);
    for (let i = 0; i < 90; i++) {
      game.aiControl(game.o, game.p, STEP);
      game.stepActor(game.o, STEP);
      game.updatePulses(STEP);
    }
    expect(chanceEvents).toHaveLength(1);
    expect(game.o.hp).toBeLessThan(game.o.maxHp);
    expect(game.o.hp).toBeGreaterThan(0);
  });

  it.each(['rushdown', 'counter', 'rangedControl'] as const)(
    '%s can regain guard after corner pressure without a health reset',
    (profile) => {
      const { game } = makeHarness({ profile, chance: true, rangeUnit: 0 });
      putAtLeftWall(game);
      game.o.profile = 'rushdown';
      game.o.aiIntent = 'attack';
      game.o.aiT = 0.5;
      let firstHit = false,
        guarded = false;
      for (let i = 0; i < 180; i++) {
        game.update(STEP, snapshot({ block: firstHit }));
        firstHit ||= game.p.hp < game.p.maxHp;
        if (firstHit && game.p.block) {
          guarded = true;
          break;
        }
      }
      expect(firstHit).toBe(true);
      expect(guarded).toBe(true);
      expect(game.p.hp).toBeGreaterThan(game.p.maxHp / 2);
    },
  );

  it.each(['rushdown', 'counter', 'rangedControl'] as const)(
    '%s can approach a retreating ranged opponent while ducking shots',
    (profile) => {
      const { game } = makeHarness({ profile, chance: true });
      game.p.x = 80;
      game.o.x = 350;
      game.p.speedScale = 0.85;
      game.o.speedScale = 1.15;
      game.o.profile = 'rangedControl';
      let frames = 0;
      for (; frames < 900 && Math.abs(game.p.x - game.o.x) > 60; frames++) {
        const incoming = game.pulses.some(
          (p) => p.owner === game.o && p.x > game.p.x && p.x - game.p.x < 95,
        );
        game.update(STEP, snapshot({ press: incoming ? 'DOWN' : 'RIGHT' }));
      }
      expect(frames).toBeLessThan(900);
      expect(Math.abs(game.p.x - game.o.x)).toBeLessThanOrEqual(60);
      expect(game.p.hp).toBeGreaterThan(0);
    },
  );

  it.each(['rushdown', 'counter', 'rangedControl'] as const)(
    'a missed %s boss strike leaves a real player punish window',
    (profile) => {
      const { game } = makeHarness({ profile, chance: true });
      game.enterBout(3);
      game.roundPhase = 'fight';
      game.o.profile = profile;
      game.o.hp = game.o.maxHp * 0.2; // Start in the real boss's last rage phase.
      const bossHp = game.o.hp;
      game.p.x = 100;
      game.o.x = 132;
      game.p.facing = 1;
      game.o.facing = 1; // Player has crossed behind the committed strike.
      game.startMove(game.o, 'kickHigh');
      for (let i = 0; i < 50 && game.o.move; i++) game.update(STEP, snapshot());
      expect(game.p.hp).toBe(game.p.maxHp);
      expect(game.o.aiRecoveryT).toBeGreaterThan(0);
      game.update(STEP, snapshot({ press: 'B' }));
      for (let i = 0; i < 8; i++) game.update(STEP, snapshot());
      expect(game.o.hp).toBeLessThan(bossHp);
    },
  );
});

describe('fighter AI sustained offense', () => {
  it('consumes a jump decision once and attacks after landing in range', () => {
    const { game } = makeHarness({ profile: 'rushdown', chance: true });
    game.o.profile = 'rushdown';
    game.p.x = 130;
    game.o.x = 200;
    game.o.aiIntent = 'jump';
    game.o.aiT = 0.45;
    const floor = game.o.y;
    let jumps = 0;
    for (let frame = 0; frame < 150; frame++) {
      const grounded = game.o.y >= floor - 0.5 && game.o.vy === 0;
      game.update(STEP, snapshot());
      if (grounded && game.o.vy < 0) jumps++;
    }
    expect(jumps).toBe(1);
    expect(game.o.moveSerial).toBeGreaterThan(0);
    expect(game.p.hp).toBeLessThan(game.p.maxHp);
  });
  it('ranged control does not shuffle forever between retreat and firing range', () => {
    const { game } = makeHarness({ profile: 'rangedControl', chance: true });
    game.o.profile = 'rangedControl';
    game.p.x = 132;
    game.o.x = 220;
    for (let frame = 0; frame < 480; frame++) game.update(STEP, snapshot());
    expect(game.o.moveSerial).toBeGreaterThan(1);
    expect(game.p.hp).toBeLessThan(game.p.maxHp);
  });
  it.each(['rushdown', 'counter', 'rangedControl', null] as const)(
    '%s pressures an idle player across difficulties, distances and seeds',
    (profile) => {
      for (const difficulty of ['chill', 'standard', 'spicy'] as const)
        for (const seed of [1, 17, 53, 101, 313, 997])
          for (const distance of [32, 88, 160, 270]) {
            const { game } = makeHarness({ profile: profile ?? undefined, difficulty, seed });
            game.o.profile = profile;
            game.p.x = 55;
            game.o.x = 55 + distance;
            let firstAttack = Infinity;
            for (let frame = 0; frame < 900 && game.roundPhase === 'fight'; frame++) {
              game.update(STEP, snapshot());
              if (game.o.moveSerial > 0 && firstAttack === Infinity) firstAttack = frame * STEP;
            }
            const context = `${profile}/${difficulty}/seed=${seed}/distance=${distance}`;
            // A full-stage approach needs travel time, especially on chill.
            expect(firstAttack, context).toBeLessThan(8);
            expect(game.p.hp, context).toBeLessThan(game.p.maxHp);
          }
    },
  );
});
