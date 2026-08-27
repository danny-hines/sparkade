import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LOGICAL_BUTTONS, type FighterSpec, type LogicalButton } from '@sparkade/shared';
import { STEP, type EngineContext, type GameInstance, type InputSnapshot } from '@sparkade/engine';
import { createFighterGame } from '../src/fighter/game';
import { FIGHTER_POSES, type FighterPose } from '../src/fighter/figure';

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

type MoveId = 'punchHigh' | 'punchLow' | 'kickHigh' | 'kickLow' | 'airKick';
type ActorState =
  'idle' | 'walk' | 'crouch' | 'jump' | 'attack' | 'block' | 'hitstun' | 'blockstun' | 'ko';

interface TestActor {
  x: number;
  y: number;
  vx: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  state: ActorState;
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
}

interface FighterHarness extends GameInstance {
  phase: 'cards' | 'fight';
  roundPhase: 'ready' | 'fight' | 'over';
  p: TestActor;
  o: TestActor;
  playerGeneratedPoses: Readonly<Record<FighterPose, CanvasImageSource>> | null;
  startMove(actor: TestActor, move: MoveId): void;
  aiControl(actor: TestActor, foe: TestActor, dt: number): void;
  stepActor(actor: TestActor, dt: number): void;
  drawGeneratedPlayer(actor: TestActor, pose: FighterPose, flash: boolean): boolean;
}

interface HarnessOptions {
  chance?: boolean | ((probability: number) => boolean);
  fighterPoses?: Readonly<Record<string, CanvasImageSource>> | null;
  rangeUnit?: number;
}

interface GeneratedDrawEvent {
  image: CanvasImageSource;
  x: number;
  y: number;
  width: number;
  height: number;
  filter: string;
}

function loadSpec(): FighterSpec {
  const path = join(__dirname, '..', '..', 'generation', 'golden', 'golden-fighter.json');
  return JSON.parse(readFileSync(path, 'utf8')) as FighterSpec;
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
  const spec = loadSpec();
  const sfxEvents: string[] = [];
  const chanceEvents: number[] = [];
  const generatedDraws: GeneratedDrawEvent[] = [];
  const transforms: Array<readonly ['translate' | 'scale', number, number]> = [];
  const noop = (): void => undefined;
  const ctx = {
    filter: 'none',
    imageSmoothingEnabled: true,
    save: noop,
    restore: noop,
    translate: (x: number, y: number) => transforms.push(['translate', x, y]),
    scale: (x: number, y: number) => transforms.push(['scale', x, y]),
    drawImage: (image: CanvasImageSource, x: number, y: number, width: number, height: number) =>
      generatedDraws.push({ image, x, y, width, height, filter: ctx.filter }),
  };
  const engine = {
    renderer: { ctx },
    sprites: { likenessHead: () => null },
    rng: {
      chance: (probability: number) => {
        chanceEvents.push(probability);
        return typeof options.chance === 'function'
          ? options.chance(probability)
          : (options.chance ?? true);
      },
      range: (min: number, max: number) => min + (max - min) * (options.rangeUnit ?? 0),
    },
    cards: {
      show: (_cards: unknown, done?: () => void) => done?.(),
    },
    music: { playJingle: noop, playSong: noop, stopSong: noop },
    sfx: { play: (name: string) => sfxEvents.push(name) },
    particles: { burst: noop },
    camera: { snap: noop },
    portrait: null,
    fighterPoses: options.fighterPoses ?? null,
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

function generatedPoseSet(): Record<FighterPose, CanvasImageSource> {
  return Object.fromEntries(
    FIGHTER_POSES.map((pose) => [pose, { pose } as unknown as CanvasImageSource]),
  ) as Record<FighterPose, CanvasImageSource>;
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

describe('generated fighter player poses', () => {
  it('uses generated art only when the complete pose set is available', () => {
    const complete = generatedPoseSet();
    const ready = makeHarness({ fighterPoses: complete });

    expect(ready.game.playerGeneratedPoses).not.toBeNull();
    expect(ready.game.drawGeneratedPlayer(ready.game.p, 'idle', false)).toBe(true);
    expect(ready.generatedDraws).toEqual([
      {
        image: complete.idle,
        x: Math.round(ready.game.p.x) - 32,
        y: Math.round(ready.game.p.y) - 60,
        width: 64,
        height: 64,
        filter: 'none',
      },
    ]);

    const incomplete = generatedPoseSet();
    delete (incomplete as Partial<Record<FighterPose, CanvasImageSource>>).ko;
    const fallback = makeHarness({ fighterPoses: incomplete });

    expect(fallback.game.playerGeneratedPoses).toBeNull();
    expect(fallback.game.drawGeneratedPlayer(fallback.game.p, 'idle', false)).toBe(false);
    expect(fallback.generatedDraws).toHaveLength(0);
  });

  it('mirrors left-facing art and preserves the hit-flash filter', () => {
    const poses = generatedPoseSet();
    const { game, generatedDraws, transforms } = makeHarness({ fighterPoses: poses });
    game.p.facing = -1;

    expect(game.drawGeneratedPlayer(game.p, 'hit', true)).toBe(true);
    expect(transforms).toEqual([
      ['translate', Math.round(game.p.x) * 2, 0],
      ['scale', -1, 1],
    ]);
    expect(generatedDraws[0]).toMatchObject({
      image: poses.hit,
      width: 64,
      height: 64,
      filter: 'brightness(0) invert(1)',
    });
  });
});
