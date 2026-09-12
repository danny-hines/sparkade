// Fighter gameplay (1v1 arcade ladder, Street Fighter / Mortal Kombat feel).
// Two generated-atlas fighters share one stage; the player climbs a ladder of
// AI opponents, each a best-of-3 match, up to a boss fighter. The move set +
// frame data + round/match FSM + AI are hand-authored here (the model only
// authors bounded roster/story data — balance stays fixed). Controls per the
// canonical map: Y high punch, X high kick, B low punch, A low kick, L/R block,
// d-pad walk/jump/crouch, START pause (host-owned).
import {
  makeBackdrop,
  pickVariant,
  type Backdrop,
  type BackdropVariant,
  type EngineContext,
  type GameInstance,
  type GameResult,
  type HudState,
  type InputSnapshot,
} from '@sparkade/engine';
import {
  FEEL,
  fighterProfile,
  fighterProjectile,
  type FighterProjectile,
  FIGHTER_STYLE_CATALOG,
  type FighterCombatProfile,
  FIGHTER_POSES,
  GENERATED_FIGHTER_ARENA_BRIGHTNESS,
  GENERATED_FIGHTER_ARENA_HEIGHT,
  GENERATED_FIGHTER_ARENA_SATURATION,
  GENERATED_FIGHTER_ARENA_WIDTH,
  GENERATED_FIGHTER_ATLAS_CELL_SIZE,
  GENERATED_FIGHTER_ATLAS_COLUMNS,
  GENERATED_FIGHTER_ROSTER_SIZE,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  difficultyScale,
  type DifficultyScale,
  type FighterBuild,
  type FighterCharacter,
  type FighterPose,
  type FighterSpec,
} from '@sparkade/shared';
import { estimateFighterDurationS } from './lint';
import {
  drawFighterProjectile,
  drawFighterProjectileWindup,
  drawFighterProjectileImpact,
} from './projectile-effects';

const W = INTERNAL_WIDTH;
const H = INTERNAL_HEIGHT;
const FLOOR_Y = H - 30;
const STAGE_MIN = 26;
const STAGE_MAX = W - 26;
const GRAVITY = 900;
const JUMP_V = 330;
// Clear hand-height pulses with the full generated sprite. Legacy ladders
// retain their original jump; profiled fighters reach an approximately 90px apex.
const PROFILE_JUMP_V = 410;
const WALK = 78;
const BODY_HALF = 12; // torso half-width for body collision + range
const ROUND_TIME = 60;
const ROUNDS_TO_WIN = 2;
const FIGHTER_ARENA_PRESENTATION_FILTER = `brightness(${GENERATED_FIGHTER_ARENA_BRIGHTNESS * 100}%) saturate(${GENERATED_FIGHTER_ARENA_SATURATION * 100}%)`;
const FIGHTER_SILHOUETTE_OPACITY = 0.72;
const FIGHTER_SILHOUETTE_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;
// Cabinet controls are deliberately forgiving: a counter pressed just before
// stun ends is remembered, and every AI contact leaves a real punish window.
const PLAYER_ATTACK_BUFFER_S = 0.14;
const AI_COUNTER_WINDOW_S = 0.2;
const AI_WHIFF_OPENING_S = 0.16;

type MoveId = 'punchHigh' | 'punchLow' | 'kickHigh' | 'kickLow' | 'airPunch' | 'airKick' | 'pulse';
type Height = 'high' | 'low' | 'overhead';

interface Move {
  pose: FighterPose;
  startup: number;
  active: number;
  recovery: number;
  dmg: number;
  reach: number; // fist/foot distance from center at contact
  hitY: number; // vertical center of the hitbox (figure-local, negative up)
  height: Height;
  knockback: number;
  hitstun: number;
  blockstun: number;
  knockdown?: boolean;
}

const MOVES: Record<MoveId, Move> = {
  pulse: {
    pose: 'punchHigh',
    startup: 0.28,
    active: 0.05,
    recovery: 0.42,
    dmg: 10,
    reach: 27,
    hitY: -62,
    height: 'high',
    knockback: 55,
    hitstun: 0.22,
    blockstun: 0.12,
  },
  punchLow: {
    pose: 'punchLow',
    startup: 0.05,
    active: 0.04,
    recovery: 0.12,
    dmg: 5,
    reach: 24,
    hitY: -22,
    height: 'low',
    knockback: 24,
    hitstun: 0.24,
    blockstun: 0.14,
  },
  punchHigh: {
    pose: 'punchHigh',
    startup: 0.07,
    active: 0.05,
    recovery: 0.16,
    dmg: 8,
    reach: 28,
    hitY: -30,
    height: 'high',
    knockback: 34,
    hitstun: 0.3,
    blockstun: 0.18,
  },
  kickLow: {
    pose: 'kickLow',
    startup: 0.09,
    active: 0.06,
    recovery: 0.24,
    dmg: 9,
    reach: 30,
    hitY: -6,
    height: 'low',
    knockback: 48,
    hitstun: 0.32,
    blockstun: 0.2,
    knockdown: true,
  },
  kickHigh: {
    pose: 'kickHigh',
    startup: 0.11,
    active: 0.06,
    recovery: 0.22,
    dmg: 12,
    reach: 32,
    hitY: -24,
    height: 'high',
    knockback: 66,
    hitstun: 0.36,
    blockstun: 0.22,
  },
  airKick: {
    pose: 'airKick',
    startup: 0.06,
    active: 0.16,
    recovery: 0.08,
    dmg: 9,
    reach: 26,
    hitY: -20,
    height: 'overhead',
    knockback: 30,
    hitstun: 0.3,
    blockstun: 0.18,
  },
  airPunch: {
    pose: 'airPunch',
    startup: 0.05,
    active: 0.12,
    recovery: 0.09,
    dmg: 7,
    reach: 25,
    hitY: -25,
    height: 'overhead',
    knockback: 24,
    hitstun: 0.26,
    blockstun: 0.16,
  },
};

type State =
  'idle' | 'walk' | 'crouch' | 'jump' | 'attack' | 'block' | 'hitstun' | 'blockstun' | 'ko';

interface Pulse {
  id: number;
  owner: Actor;
  x: number;
  y: number;
  vx: number;
  life: number;
}
interface Actor {
  projectile: FighterProjectile;
  profile: FighterCombatProfile | null;
  chain: number;
  chainT: number;
  confirmed: boolean;
  receivedChain: number;
  escapeT: number;
  guardHeld: boolean;
  guardWindow: number;
  guardCooldown: number;
  counterT: number;
  counterStrike: boolean;
  pulseCooldown: number;
  feedback: string;
  feedbackT: number;
  x: number;
  y: number; // feet y (FLOOR_Y on ground; < FLOOR_Y airborne)
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  state: State;
  /** Time spent continuously walking; drives the zero-cost idle/walk cycle. */
  walkT: number;
  move: MoveId | null;
  moveT: number;
  moveSerial: number;
  airMove: boolean; // used its one air attack this jump
  hitDone: boolean;
  crouch: boolean;
  block: boolean;
  stunT: number;
  flashT: number;
  bufferedMove: MoveId | null;
  bufferT: number;
  scale: number;
  /** 0=player, 1-3=ladder rungs, 4=boss; matches generated atlas order. */
  identitySlot: number;
  speedScale: number;
  powerScale: number;
  // AI
  ai: boolean;
  aiT: number;
  aiIntent: 'approach' | 'retreat' | 'attack' | 'block' | 'jump' | 'wait';
  aggression: number;
  aiRecoveryT: number;
  aiSeenFoeMove: number;
  aiGuardingFoeMove: number;
  aiReactionT: number;
  aiAirSeen: boolean;
  aiAirT: number;
  aiAntiAir: boolean;
  aiPulseId: number;
  aiPulseT: number;
  aiPulseResponse: 'guard' | 'duck' | 'jump' | null;
  aiDefense: 'guard' | 'duck' | 'jump' | null;
  aiDefenseT: number;
}

interface PreparedFighterPose {
  normal: HTMLCanvasElement;
  flash: HTMLCanvasElement;
}

type PreparedFighterPoses = Readonly<Record<FighterPose, PreparedFighterPose>>;

function canvas2d(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/** Crop one atlas pose once so gameplay never filters or re-crops the full atlas. */
function cropFighterPose(atlas: CanvasImageSource, pose: FighterPose): HTMLCanvasElement {
  const size = GENERATED_FIGHTER_ATLAS_CELL_SIZE;
  const index = FIGHTER_POSES.indexOf(pose);
  const sx = (index % GENERATED_FIGHTER_ATLAS_COLUMNS) * size;
  const sy = Math.floor(index / GENERATED_FIGHTER_ATLAS_COLUMNS) * size;
  const { canvas, ctx } = canvas2d(size, size);
  ctx.drawImage(atlas, sx, sy, size, size, 0, 0, size, size);
  return canvas;
}

/** Build the old brightness(0) + opacity silhouette without a Canvas filter. */
function blackFighterSilhouette(source: HTMLCanvasElement): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(source.width, source.height);
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.globalAlpha = FIGHTER_SILHOUETTE_OPACITY;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, source.width, source.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/** Build the old brightness(0) + invert(1) damage flash without a Canvas filter. */
function whiteFighterPose(source: HTMLCanvasElement): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(source.width, source.height);
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, source.width, source.height);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function composeFighterPose(
  source: HTMLCanvasElement,
  silhouette: HTMLCanvasElement,
): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(source.width, source.height);
  for (const [dx, dy] of FIGHTER_SILHOUETTE_OFFSETS) ctx.drawImage(silhouette, dx, dy);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** Precompose every pose once. Runtime rendering becomes one ordinary drawImage. */
function prepareFighterPoses(atlas: CanvasImageSource): PreparedFighterPoses {
  return Object.fromEntries(
    FIGHTER_POSES.map((pose) => {
      const source = cropFighterPose(atlas, pose);
      const silhouette = blackFighterSilhouette(source);
      return [
        pose,
        {
          normal: composeFighterPose(source, silhouette),
          flash: composeFighterPose(whiteFighterPose(source), silhouette),
        },
      ];
    }),
  ) as PreparedFighterPoses;
}

/** Split and, for old saved assets, color-treat arena panels once at game load. */
function prepareFighterArenaPanels(
  atlas: CanvasImageSource | null,
  presentationBaked: boolean,
): readonly [HTMLCanvasElement, HTMLCanvasElement] | null {
  if (!atlas) return null;
  const preparePanel = (panel: number): HTMLCanvasElement => {
    const { canvas, ctx } = canvas2d(GENERATED_FIGHTER_ARENA_WIDTH, GENERATED_FIGHTER_ARENA_HEIGHT);
    if (!presentationBaked) ctx.filter = FIGHTER_ARENA_PRESENTATION_FILTER;
    ctx.drawImage(
      atlas,
      0,
      panel * GENERATED_FIGHTER_ARENA_HEIGHT,
      GENERATED_FIGHTER_ARENA_WIDTH,
      GENERATED_FIGHTER_ARENA_HEIGHT,
      0,
      0,
      GENERATED_FIGHTER_ARENA_WIDTH,
      GENERATED_FIGHTER_ARENA_HEIGHT,
    );
    ctx.filter = 'none';
    return canvas;
  };
  return [preparePanel(0), preparePanel(1)];
}

function requireGeneratedFighterAtlases(
  atlases: readonly CanvasImageSource[] | null,
): readonly CanvasImageSource[] {
  if (!atlases || atlases.length !== GENERATED_FIGHTER_ROSTER_SIZE || !atlases.every(Boolean)) {
    throw new Error('Fighter requires one complete five-character generated atlas roster');
  }
  return [...atlases];
}

function fighterScaleForBuild(build: FighterBuild): number {
  return build === 'nimble' ? 0.94 : build === 'heavy' ? 1.16 : 1.05;
}

export function fighterWalkPoseAtTime(elapsedS: number): 'idle' | 'walk' {
  return Math.floor(Math.max(0, elapsedS) * 8) % 2 === 0 ? 'idle' : 'walk';
}

export function createFighterGame(engine: EngineContext, spec: FighterSpec): GameInstance {
  return new FighterGame(engine, spec);
}

class FighterGame implements GameInstance {
  private pulses: Pulse[] = [];
  private nextPulseId = 1;
  private pulseImpacts: {
    x: number;
    y: number;
    age: number;
    kind: FighterProjectile['kind'];
    guarded: boolean;
  }[] = [];
  hud: HudState = { score: 0, lives: 2, health: 0, maxHealth: 0, keys: 0, bombs: 0 };
  result: GameResult | null = null;

  private phase: 'cards' | 'fight' = 'cards';
  private roundPhase: 'ready' | 'fight' | 'over' = 'ready';
  private bout = 0; // 0..levels.length-1 = ladder rungs, levels.length = boss
  private roundNum = 1;
  private pWins = 0;
  private oWins = 0;
  private timer = ROUND_TIME;
  private phaseT = 0;
  private banner = '';
  private diff!: DifficultyScale;

  private p!: Actor;
  private o!: Actor;
  private generatedFighterAtlases: readonly CanvasImageSource[];
  private generatedFighterArena: CanvasImageSource | null;
  private preparedFighterPoses: readonly PreparedFighterPoses[];
  private preparedFighterArenas: readonly [HTMLCanvasElement, HTMLCanvasElement] | null;
  private backdrop: Backdrop;
  private bgVariant: BackdropVariant;

  constructor(
    private engine: EngineContext,
    private spec: FighterSpec,
  ) {
    this.diff = difficultyScale(this.spec.difficulty);
    this.generatedFighterAtlases = requireGeneratedFighterAtlases(this.engine.fighterAtlases);
    this.generatedFighterArena = this.engine.fighterArenaAtlas;
    this.preparedFighterPoses = this.generatedFighterAtlases.map(prepareFighterPoses);
    this.preparedFighterArenas = prepareFighterArenaPanels(
      this.generatedFighterArena,
      this.engine.fighterArenaPresentationBaked,
    );
    this.bgVariant = pickVariant(this.spec.palette, this.spec.seed, this.spec.backdrop);
    this.backdrop = makeBackdrop(this.spec.palette, this.spec.seed, this.bgVariant);
    // Init both actors so render() is safe during the pre-fight story cards.
    this.p = this.makeActor(this.playerChar(), false, 0, 0);
    this.o = this.makeActor(this.opponentChar(), true, 0, this.opponentIdentitySlot());
  }

  // ------------------------------------------------------------------- setup

  private makeActor(
    c: FighterCharacter,
    ai: boolean,
    aggression: number,
    identitySlot: number,
  ): Actor {
    const build = c.build;
    const profile = fighterProfile(c);
    return {
      profile,
      projectile: fighterProjectile(c),
      chain: 0,
      chainT: 0,
      confirmed: false,
      receivedChain: 0,
      escapeT: 0,
      guardHeld: false,
      guardWindow: 0,
      guardCooldown: 0,
      counterT: 0,
      counterStrike: false,
      pulseCooldown: 0,
      feedback: '',
      feedbackT: 0,
      x: ai ? STAGE_MAX - 80 : STAGE_MIN + 80,
      y: FLOOR_Y,
      vx: 0,
      vy: 0,
      facing: ai ? -1 : 1,
      hp: c.hp,
      maxHp: c.hp,
      state: 'idle',
      walkT: 0,
      move: null,
      moveT: 0,
      moveSerial: 0,
      airMove: false,
      hitDone: false,
      crouch: false,
      block: false,
      stunT: 0,
      flashT: 0,
      bufferedMove: null,
      bufferT: 0,
      scale: fighterScaleForBuild(build),
      identitySlot,
      speedScale:
        Math.max(0.85, Math.min(1.15, c.speedScale ?? 1)) * (profile === 'rushdown' ? 1.12 : 1),
      powerScale: Math.max(0.85, Math.min(1.15, c.powerScale ?? 1)),
      ai,
      aiT: 0,
      aiIntent: 'wait',
      aggression,
      aiRecoveryT: 0,
      aiSeenFoeMove: -1,
      aiGuardingFoeMove: -1,
      aiReactionT: 0,
      aiAirSeen: false,
      aiAirT: 0,
      aiAntiAir: false,
      aiPulseId: -1,
      aiPulseT: 0,
      aiPulseResponse: null,
      aiDefense: null,
      aiDefenseT: 0,
    };
  }

  private playerChar(): FighterCharacter {
    return this.spec.player;
  }

  private opponentChar(): FighterCharacter {
    const boss = this.spec.boss;
    if (this.isBoss()) {
      return {
        name: boss.name,
        visualConcept: boss.visualConcept,
        build: boss.build,
        colorSlot: boss.colorSlot,
        hp: boss.hp,
        outfit: boss.outfit,
        speedScale: boss.speedScale,
        powerScale: boss.powerScale,
        combatProfile: boss.combatProfile,
        projectile: boss.projectile,
      };
    }
    return this.spec.levels[this.bout]!.opponent;
  }

  private isBoss(): boolean {
    return this.bout >= this.spec.levels.length;
  }

  private opponentIdentitySlot(): number {
    return this.isBoss() ? this.spec.levels.length + 1 : this.bout + 1;
  }

  private opponentAggression(): number {
    // Later rungs + boss rage phases are more aggressive; difficulty scales it.
    const rung = this.bout / Math.max(1, this.spec.levels.length);
    let base = 0.7 + rung * 0.5; // 0.7 .. ~1.2
    if (this.isBoss()) {
      const b = this.spec.boss;
      const frac = this.o ? 1 - this.o.hp / this.o.maxHp : 0;
      const ph = b.phases[Math.min(b.phases.length - 1, Math.floor(frac * b.phases.length))];
      base = 1.1 * (ph?.aggression ?? 1.3);
    }
    return base * (0.8 + this.diff.fire * 0.3);
  }

  start(): void {
    const cards = this.spec.story.intro.map((line) => ({
      title: this.spec.meta.title,
      lines: [line],
      portrait: this.engine.portrait,
      artRole: 'intro' as const,
    }));
    this.engine.cards.show(cards, () => this.enterBout(0));
  }

  restart(): void {
    this.startRound(true);
    this.hud.lives = Math.max(this.hud.lives, 0);
  }

  dispose(): void {
    this.engine.music.stopSong();
  }

  private enterBout(ix: number): void {
    this.bout = ix;
    this.pWins = 0;
    this.oWins = 0;
    this.roundNum = 1;
    const boss = this.isBoss();
    const line = boss ? this.spec.story.bossIntro : (this.spec.story.levelIntros[ix] ?? '...');
    const name = boss ? this.spec.boss.name : this.spec.levels[ix]!.name;
    this.phase = 'cards';
    this.engine.music.playJingle('levelIntro');
    this.engine.cards.show(
      [
        {
          title: name,
          lines: [line],
          portrait: this.engine.portrait,
          ...(boss ? { artRole: 'boss' as const } : {}),
        },
        ...(this.spec.fighterStyle
          ? [
              {
                title: `${this.opponentChar().name}: ${FIGHTER_STYLE_CATALOG[this.opponentChar().combatProfile!].name}`,
                lines: [
                  this.spec.fighterStyle === 'rangedControl'
                    ? `Hold guard and press high punch to cast ${fighterProjectile(this.playerChar()).name}. Each cast needs time to recharge.`
                    : FIGHTER_STYLE_CATALOG[this.spec.fighterStyle].signature,
                  this.opponentChar().combatProfile === 'rangedControl'
                    ? `Opponent: Jump or duck ${fighterProjectile(this.opponentChar()).name}, then close in during recovery.`
                    : `Opponent: ${FIGHTER_STYLE_CATALOG[this.opponentChar().combatProfile!].counterplay}`,
                ],
              },
            ]
          : []),
      ],
      () => {
        this.engine.music.playSong(boss ? 'boss' : this.spec.levels[ix]!.musicSong);
        this.startRound(true);
        this.phase = 'fight';
      },
    );
  }

  private startRound(fresh: boolean): void {
    this.pulses = [];
    this.pulseImpacts = [];
    if (fresh) {
      this.p = this.makeActor(this.playerChar(), false, 0, 0);
      this.o = this.makeActor(
        this.opponentChar(),
        true,
        this.opponentAggression(),
        this.opponentIdentitySlot(),
      );
    } else {
      this.resetActor(this.p, false);
      this.resetActor(this.o, true);
    }
    this.timer = ROUND_TIME;
    this.roundPhase = 'ready';
    this.phaseT = 0;
    this.banner = `ROUND ${this.roundNum}`;
    this.engine.camera.snap(0, 0);
  }

  private resetActor(a: Actor, ai: boolean): void {
    a.chain =
      a.chainT =
      a.receivedChain =
      a.escapeT =
      a.guardWindow =
      a.guardCooldown =
      a.counterT =
      a.pulseCooldown =
      a.feedbackT =
        0;
    a.confirmed = a.guardHeld = a.counterStrike = false;
    a.feedback = '';
    a.x = ai ? STAGE_MAX - 80 : STAGE_MIN + 80;
    a.y = FLOOR_Y;
    a.vx = 0;
    a.vy = 0;
    a.facing = ai ? -1 : 1;
    a.hp = a.maxHp;
    a.state = 'idle';
    a.walkT = 0;
    a.move = null;
    a.moveT = 0;
    a.hitDone = false;
    a.stunT = 0;
    a.flashT = 0;
    a.crouch = false;
    a.block = false;
    a.airMove = false;
    a.bufferedMove = null;
    a.bufferT = 0;
    a.aiT = 0;
    a.aiIntent = 'wait';
    a.aiRecoveryT = 0;
    a.aiSeenFoeMove = -1;
    a.aiGuardingFoeMove = -1;
    a.aiReactionT = a.aiAirT = a.aiPulseT = a.aiDefenseT = 0;
    a.aiAirSeen = a.aiAntiAir = false;
    a.aiPulseId = -1;
    a.aiPulseResponse = a.aiDefense = null;
    if (ai) a.aggression = this.opponentAggression();
  }

  // ----------------------------------------------------------------- update

  update(dt: number, input: InputSnapshot): void {
    this.pulseImpacts = this.pulseImpacts.filter((impact) => (impact.age += dt) < 0.28);
    if (this.phase !== 'fight') return;
    this.phaseT += dt;
    this.o.aggression = this.opponentAggression();

    if (this.roundPhase === 'ready') {
      // brief "ROUND n" then "FIGHT!"
      if (this.phaseT > 0.9 && this.banner.startsWith('ROUND')) this.banner = 'FIGHT!';
      if (this.phaseT > 1.7) {
        this.roundPhase = 'fight';
        this.banner = '';
        this.phaseT = 0;
      }
      this.faceOff();
      return;
    }
    if (this.roundPhase === 'over') {
      this.stepPhysics(this.p, dt); // let the loser fall/settle
      this.stepPhysics(this.o, dt);
      if (this.phaseT > 2.2) this.afterRound();
      return;
    }

    // live round
    this.timer = Math.max(0, this.timer - dt);
    this.faceOff();
    this.tickKit(this.p, dt);
    this.tickKit(this.o, dt);
    // In a library demo both fighters run on AI so the match plays itself.
    if (this.engine.attract) this.aiControl(this.p, this.o, dt);
    else this.control(this.p, dt, input);
    this.aiControl(this.o, this.p, dt);
    this.stepActor(this.p, dt);
    this.stepActor(this.o, dt);
    this.resolveHits(this.p, this.o);
    this.resolveHits(this.o, this.p);
    this.updatePulses(dt);
    this.bodyPush();

    if (this.p.hp <= 0 || this.o.hp <= 0 || this.timer <= 0) this.endRound();
  }

  private faceOff(): void {
    if (this.p.state !== 'ko' && this.o.state !== 'ko') {
      const dir = this.o.x >= this.p.x ? 1 : -1;
      if (this.p.state === 'idle' || this.p.state === 'walk') this.p.facing = dir;
      if (this.o.state === 'idle' || this.o.state === 'walk') this.o.facing = dir === 1 ? -1 : 1;
    }
  }

  // ---------------------------------------------------------------- control

  private canAct(a: Actor): boolean {
    return a.state === 'idle' || a.state === 'walk' || a.state === 'crouch' || a.state === 'block';
  }

  private requestedMove(input: InputSnapshot, crouching: boolean): MoveId | null {
    if (input.Y.pressed) return crouching ? 'punchLow' : 'punchHigh';
    if (input.B.pressed) return 'punchLow';
    if (input.X.pressed) return crouching ? 'kickLow' : 'kickHigh';
    if (input.A.pressed) return 'kickLow';
    return null;
  }

  private control(a: Actor, dt: number, input: InputSnapshot): void {
    if (a.state === 'ko') return;
    if (a.bufferT > 0) {
      a.bufferT = Math.max(0, a.bufferT - dt);
      if (a.bufferT === 0) a.bufferedMove = null;
    }
    const holdGuard = input.L.held || input.R.held;
    const freshGuard = holdGuard && !a.guardHeld;
    a.guardHeld = holdGuard;
    const requestedMove = this.requestedMove(input, input.DOWN.held);
    if ((a.state === 'hitstun' || a.state === 'blockstun') && requestedMove) {
      a.bufferedMove = requestedMove;
      a.bufferT = PLAYER_ATTACK_BUFFER_S;
    }
    this.tickStun(a, dt);
    if (a.state === 'hitstun' || a.state === 'blockstun') return;

    const airborne = a.y < FLOOR_Y - 0.5;
    a.block = false;
    if (a.state === 'attack') {
      if (requestedMove) this.tryChain(a, requestedMove);
      return;
    }

    if (!airborne) {
      const holdBlock = holdGuard;
      if (a.profile === 'rangedControl' && holdGuard && input.Y.pressed && this.canAct(a)) {
        if (a.pulseCooldown <= 0 && !this.pulses.some((p) => p.owner === a))
          this.startMove(a, 'pulse');
        return;
      }
      a.crouch = input.DOWN.held;
      // block only when holding back is not required here — hold L/R to guard
      if (holdBlock && this.canAct(a)) {
        a.block = true;
        a.state = 'block';
        if (freshGuard) this.openGuardWindow(a);
        a.vx = 0;
      } else {
        // movement
        const mv = (input.LEFT.held ? -1 : 0) + (input.RIGHT.held ? 1 : 0);
        if (a.crouch) {
          a.state = 'crouch';
          a.vx = 0;
        } else if (mv !== 0) {
          a.state = 'walk';
          a.vx = mv * WALK * a.speedScale;
        } else {
          a.state = 'idle';
          a.vx = 0;
        }
        if (input.UP.pressed) {
          a.vy = -(a.profile ? PROFILE_JUMP_V : JUMP_V);
          a.state = 'jump';
          a.airMove = false;
          a.vx = mv * WALK * a.speedScale;
        }
      }
      // attacks (ground)
      if (this.canAct(a) || a.state === 'walk' || a.state === 'crouch') {
        const move = a.bufferedMove ?? requestedMove;
        if (move) {
          a.bufferedMove = null;
          a.bufferT = 0;
          this.startMove(a, move);
        }
      }
    } else {
      // air: one attack per jump
      a.state = 'jump';
      if (
        !a.airMove &&
        (input.Y.pressed || input.X.pressed || input.A.pressed || input.B.pressed)
      ) {
        a.airMove = true;
        this.startMove(a, input.Y.pressed || input.B.pressed ? 'airPunch' : 'airKick');
      }
    }
  }

  private startMove(a: Actor, id: MoveId, chain = false): void {
    if (!chain) a.chain = 0;
    a.chainT = 0;
    a.confirmed = false;
    a.block = false;
    a.guardWindow = 0;
    a.counterStrike = a.counterT > 0 && id !== 'pulse';
    a.counterT = 0;
    if (id === 'pulse') a.pulseCooldown = 2;
    a.move = id;
    a.moveT = 0;
    a.moveSerial += 1;
    a.hitDone = false;
    a.state = 'attack';
    // Ground attacks commit in place. Carrying approach velocity through the
    // whole strike let the AI erase knockback and slide-lock players at a wall.
    if (a.y >= FLOOR_Y - 0.5) a.vx = 0;
    // An attack intent authorizes exactly one move. The old cached intent was
    // reused every recovery frame while aiT was frozen, producing long locks.
    if (a.ai) a.aiIntent = 'wait';
    this.engine.sfx.play('shoot');
  }

  // --------------------------------------------------------------------- AI

  private aiReactionDelay(): number {
    return this.spec.difficulty === 'chill' ? 0.24 : this.spec.difficulty === 'spicy' ? 0.14 : 0.19;
  }

  /** Observe an emitted projectile once. Decisions never read the player's
   * button state, cancel an attack, or bypass contact/whiff recovery. */
  private reactToPulse(a: Actor, dt: number): boolean {
    const pulse = this.pulses.find((p) => p.owner !== a && (a.x - p.x) * p.vx > 0);
    if (!pulse) {
      a.aiPulseResponse = null;
      return false;
    }
    if (a.aiPulseId !== pulse.id) {
      a.aiPulseId = pulse.id;
      a.aiPulseT = this.aiReactionDelay();
      const chance =
        this.spec.difficulty === 'chill' ? 0.4 : this.spec.difficulty === 'spicy' ? 0.7 : 0.55;
      a.aiPulseResponse = this.engine.rng.chance(chance)
        ? a.profile === 'counter'
          ? 'guard'
          : a.profile === 'rangedControl'
            ? 'duck'
            : 'jump'
        : null;
      return false;
    }
    a.aiPulseT = Math.max(0, a.aiPulseT - dt);
    if (a.aiPulseT > 0 || !a.aiPulseResponse) return false;
    const eta = Math.max(0, (Math.abs(pulse.x - a.x) - BODY_HALF * a.scale) / Math.abs(pulse.vx));
    const response = a.aiPulseResponse;
    if (eta > (response === 'jump' ? 0.46 : response === 'duck' ? 0.3 : 0.12)) return false;
    a.aiPulseResponse = null;
    a.aiDefense = response;
    a.aiDefenseT = response === 'jump' ? 0.9 : 0.48;
    a.facing = pulse.vx > 0 ? -1 : 1;
    a.vx = 0;
    if (response === 'jump') {
      a.vy = -PROFILE_JUMP_V;
      a.vx = a.facing * WALK * a.speedScale * 0.6;
      a.state = 'jump';
      a.airMove = false;
    } else {
      a.block = response === 'guard';
      a.crouch = response === 'duck';
      a.state = a.block ? 'block' : 'crouch';
      if (a.block) this.openGuardWindow(a);
    }
    return true;
  }

  private aiControl(a: Actor, foe: Actor, dt: number): void {
    if (a.state === 'ko') return;
    if (a.aiRecoveryT > 0) a.aiRecoveryT = Math.max(0, a.aiRecoveryT - dt);
    if (a.aiDefenseT > 0) {
      a.aiDefenseT = Math.max(0, a.aiDefenseT - dt);
      if (a.aiDefenseT === 0) {
        a.aiDefense = null;
        a.aiRecoveryT = Math.max(a.aiRecoveryT, 0.18);
      }
    }
    this.tickStun(a, dt);
    if (a.state === 'hitstun' || a.state === 'blockstun') return;
    if (a.state === 'attack') {
      if (a.profile === 'rushdown' && a.confirmed && a.moveT > 0.1)
        this.tryChain(a, a.move === 'punchLow' ? 'punchHigh' : 'kickHigh');
      return;
    }

    const dist = Math.abs(foe.x - a.x);
    const dir = foe.x >= a.x ? 1 : -1;
    const inRange = dist < (a.profile === 'rangedControl' ? 52 : 46);
    const foeAttacking = foe.state === 'attack' && foe.move !== null;
    const foeAirborne = foe.y < FLOOR_Y - 6;
    const wasGuarding = a.block;
    a.block = false;
    a.crouch = false;

    if (a.profile && a.aiDefenseT > 0) {
      a.block = a.aiDefense === 'guard';
      a.crouch = a.aiDefense === 'duck';
      a.state = a.aiDefense === 'jump' ? 'jump' : a.block ? 'block' : 'crouch';
      return;
    }
    // Do not turn a projectile-dodging jump into a midair guard or ground shot.
    if (a.profile && a.y < FLOOR_Y - 0.5) {
      a.state = 'jump';
      return;
    }

    // Contact recovery is a genuine opening: no instant guard or anti-air read
    // is allowed until the player's stun plus counter window has elapsed.
    if (a.aiRecoveryT > 0) {
      a.state = 'idle';
      a.vx = 0;
      return;
    }
    if (a.profile && this.reactToPulse(a, dt)) return;

    // Roll reactive guard once per enemy move and then hold that decision. The
    // previous per-frame reroll made even a nominal 70% guard virtually certain.
    if (!foeAttacking) a.aiGuardingFoeMove = -1;
    if (foeAttacking && dist < 52 && a.aiSeenFoeMove !== foe.moveSerial) {
      a.aiSeenFoeMove = foe.moveSerial;
      a.aiReactionT = a.profile ? this.aiReactionDelay() : 0;
      const guard = Math.min(0.72, 0.28 + a.aggression * 0.16);
      if (this.engine.rng.chance(guard)) a.aiGuardingFoeMove = foe.moveSerial;
    }
    a.aiReactionT = Math.max(0, a.aiReactionT - dt);
    if (foeAttacking && a.aiGuardingFoeMove === foe.moveSerial && a.aiReactionT <= 0) {
      const mv = this.moveFor(foe, foe.move!);
      a.state = 'block';
      a.block = true;
      if (!wasGuarding && a.profile === 'counter') this.openGuardWindow(a);
      a.crouch = mv.height === 'low';
      a.vx = 0;
      return;
    }
    if (
      a.profile === 'rangedControl' &&
      !foeAirborne &&
      dist > 95 &&
      !a.aiPulseResponse &&
      a.pulseCooldown <= 0 &&
      !this.pulses.some((p) => p.owner === a)
    ) {
      a.facing = dir;
      this.startMove(a, 'pulse');
      return;
    }
    if (
      a.profile === 'rangedControl' &&
      dist < 85 &&
      a.x > STAGE_MIN + 25 &&
      a.x < STAGE_MAX - 25
    ) {
      a.state = 'walk';
      a.vx = -dir * WALK * a.speedScale * 0.65;
      return;
    }
    if (a.profile === 'counter' && a.counterT > 0 && inRange) {
      a.facing = dir;
      this.startMove(a, 'punchHigh');
      return;
    }
    // Anti-air: foe jumping in close → poke up.
    const antiAirChance = Math.min(0.82, 0.42 + a.aggression * 0.18);
    if (a.profile) {
      if (!foeAirborne) a.aiAirSeen = a.aiAntiAir = false;
      else if (!a.aiAirSeen) {
        a.aiAirSeen = true;
        a.aiAirT = this.aiReactionDelay();
        a.aiAntiAir = this.engine.rng.chance(antiAirChance);
      }
      a.aiAirT = Math.max(0, a.aiAirT - dt);
    }
    if (
      foeAirborne &&
      dist < 60 &&
      (a.profile ? a.aiAntiAir && a.aiAirT <= 0 : this.engine.rng.chance(antiAirChance))
    ) {
      a.aiAntiAir = false;
      a.facing = dir;
      this.startMove(a, 'kickHigh');
      return;
    }

    a.aiT -= dt;
    if (a.aiT <= 0) {
      a.aiT = Math.max(
        a.profile ? this.aiReactionDelay() + 0.05 : 0.14,
        this.engine.rng.range(0.18, 0.5) / Math.max(0.6, a.aggression),
      );
      if (inRange) {
        const attackChance = Math.min(0.82, 0.15 + a.aggression * 0.4);
        a.aiIntent = this.engine.rng.chance(attackChance)
          ? 'attack'
          : this.engine.rng.chance(0.3)
            ? 'retreat'
            : 'block';
      } else if (dist < 120) {
        a.aiIntent = this.engine.rng.chance(0.8) ? 'approach' : 'jump';
      } else {
        a.aiIntent = 'approach';
      }
    }

    a.facing = dir;
    switch (a.aiIntent) {
      case 'approach':
        a.state = 'walk';
        a.vx = dir * WALK * a.speedScale * 0.9;
        break;
      case 'retreat':
        a.state = 'walk';
        a.vx = -dir * WALK * a.speedScale * 0.8;
        break;
      case 'attack':
        if (inRange) {
          const roll = this.engine.rng.range(0, 1);
          this.startMove(
            a,
            a.profile === 'rushdown' || roll < 0.35
              ? 'punchLow'
              : roll < 0.6
                ? 'punchHigh'
                : roll < 0.82
                  ? 'kickLow'
                  : 'kickHigh',
          );
        } else {
          a.state = 'walk';
          a.vx = dir * WALK * a.speedScale;
        }
        break;
      case 'block':
        a.state = 'block';
        a.block = true;
        if (a.profile === 'counter' && !wasGuarding) this.openGuardWindow(a);
        a.vx = 0;
        break;
      case 'jump':
        if (a.y >= FLOOR_Y - 0.5) {
          a.vy = -(a.profile ? PROFILE_JUMP_V : JUMP_V);
          a.state = 'jump';
          a.airMove = false;
          a.vx = dir * WALK * a.speedScale;
        }
        break;
      default:
        a.state = 'idle';
        a.vx = 0;
    }
  }

  // ------------------------------------------------------------- simulation

  private tickStun(a: Actor, dt: number): void {
    if (a.stunT > 0) {
      a.stunT -= dt;
      if (a.stunT <= 0 && (a.state === 'hitstun' || a.state === 'blockstun')) a.state = 'idle';
    }
    if (a.flashT > 0) a.flashT -= dt;
  }

  private stepActor(a: Actor, dt: number): void {
    if (a.state === 'walk' && Math.abs(a.vx) > 0.5) a.walkT += dt;
    else a.walkT = 0;
    if (a.state === 'ko') {
      this.stepPhysics(a, dt);
      return;
    }
    if (a.state === 'attack' && a.move) {
      a.moveT += dt;
      const m = this.moveFor(a, a.move);
      if (a.move === 'pulse' && !a.hitDone && a.moveT >= m.startup) {
        a.hitDone = true;
        this.pulses.push({
          id: this.nextPulseId++,
          owner: a,
          x: a.x + a.facing * m.reach * a.scale,
          y: a.y + m.hitY * a.scale,
          vx: a.facing * 190,
          life: 2.5,
        });
      }
      if (a.moveT >= m.startup + m.active + m.recovery) {
        a.move = null;
        a.state = a.y < FLOOR_Y - 0.5 ? 'jump' : 'idle';
        if (a.ai) {
          a.aiRecoveryT = Math.max(a.aiRecoveryT, AI_WHIFF_OPENING_S);
          a.aiIntent = 'wait';
          a.aiT = 0;
          if (a.y >= FLOOR_Y - 0.5) a.vx = 0;
        }
      }
    }
    this.stepPhysics(a, dt);
  }

  private stepPhysics(a: Actor, dt: number): void {
    a.x += a.vx * dt;
    a.x = Math.max(STAGE_MIN, Math.min(STAGE_MAX, a.x));
    // airborne
    if (a.y < FLOOR_Y - 0.5 || a.vy < 0) {
      a.vy += GRAVITY * dt;
      a.y += a.vy * dt;
      if (a.y >= FLOOR_Y) {
        a.y = FLOOR_Y;
        a.vy = 0;
        a.airMove = false;
        if (a.state === 'jump') a.state = 'idle';
      }
    }
  }

  private bodyPush(): void {
    // keep the two bodies from overlapping
    const d = this.o.x - this.p.x;
    const min = BODY_HALF * (this.p.scale + this.o.scale);
    if (Math.abs(d) < min && Math.abs(this.p.y - this.o.y) < 24) {
      const push = (min - Math.abs(d)) / 2;
      const s = d >= 0 ? 1 : -1;
      this.p.x = Math.max(STAGE_MIN, Math.min(STAGE_MAX, this.p.x - s * push));
      this.o.x = Math.max(STAGE_MIN, Math.min(STAGE_MAX, this.o.x + s * push));
    }
  }

  // ------------------------------------------------------------------ hits

  private resolveHits(att: Actor, def: Actor): void {
    if (att.state !== 'attack' || !att.move || att.hitDone) return;
    if (att.move === 'pulse' || def.escapeT > 0) return;
    const m = this.moveFor(att, att.move);
    if (att.moveT < m.startup || att.moveT > m.startup + m.active) return;
    // hitbox: a point out in front at the strike's reach + height
    const hx = att.x + att.facing * m.reach * att.scale;
    const hy = att.y + m.hitY * att.scale;
    // defender hurtbox
    const dw = BODY_HALF * def.scale + 6;
    const top = def.y + (def.crouch ? -26 : -46) * def.scale;
    const bot = def.y - 2;
    if (Math.abs(hx - def.x) > dw || hy < top - 6 || hy > bot + 6) return;
    if (def.state === 'ko') return;

    att.hitDone = true;
    this.applyHit(att, def, m, hx, hy, false);
  }

  private moveFor(a: Actor, id: MoveId): Move {
    const m = MOVES[id];
    if (id === 'pulse' || !a.profile) return m;
    if (a.profile === 'rangedControl')
      return { ...m, startup: m.startup * 1.2, recovery: m.recovery * 1.2, reach: m.reach * 1.1 };
    return m;
  }

  private tickKit(a: Actor, dt: number): void {
    for (const key of [
      'chainT',
      'escapeT',
      'guardWindow',
      'guardCooldown',
      'counterT',
      'pulseCooldown',
      'feedbackT',
    ] as const)
      a[key] = Math.max(0, a[key] - dt);
    if (a.state !== 'hitstun' && a.state !== 'blockstun') a.receivedChain = 0;
    if (a.chainT <= 0) a.confirmed = false;
  }

  private openGuardWindow(a: Actor): void {
    if (a.profile !== 'counter' || a.guardCooldown > 0) return;
    a.guardWindow = 0.16;
    a.guardCooldown = 0.65;
  }

  private tryChain(a: Actor, move: MoveId): boolean {
    if (!a.profile || !a.confirmed || a.chainT <= 0) return false;
    const next =
      a.move === 'punchLow' && a.chain === 1
        ? 'punchHigh'
        : a.profile === 'rushdown' && a.move === 'punchHigh' && a.chain === 2
          ? 'kickHigh'
          : null;
    if (move !== next) return false;
    this.startMove(a, move, true);
    return true;
  }

  private applyHit(
    att: Actor,
    def: Actor,
    m: Move,
    hx: number,
    hy: number,
    projectile: boolean,
    direction = att.facing,
  ): void {
    if (def.state === 'ko' || def.escapeT > 0) return;
    const blockingRight =
      def.block &&
      (!def.ai || (m.height === 'low' && def.crouch) || (m.height !== 'low' && !def.crouch));
    if (blockingRight && def.profile === 'counter' && def.guardWindow > 0) {
      def.guardWindow = 0;
      def.counterT = 0.9;
      def.feedback = 'COUNTER READY';
      def.feedbackT = 0.9;
      if (!projectile) {
        att.confirmed = false;
        att.move = null;
        att.state = 'hitstun';
        att.stunT = 0.3;
        att.vx = -att.facing * 30;
        att.aiRecoveryT = Math.max(att.aiRecoveryT, 0.5);
      }
      this.engine.sfx.play('powerup');
      return;
    }
    const chain = blockingRight ? 0 : def.state === 'hitstun' ? def.receivedChain + 1 : 1;
    const scale = att.profile ? [1, 1, 0.75, 0.55][Math.min(3, chain)]! : 1;
    const dmg = m.dmg * att.powerScale * scale * (att.counterStrike && !projectile ? 1.65 : 1);
    if (att.ai)
      att.aiRecoveryT = Math.max(
        att.aiRecoveryT,
        (blockingRight ? m.blockstun : m.hitstun) + AI_COUNTER_WINDOW_S,
      );
    def.move = null;
    def.confirmed = false;
    def.counterStrike = false;
    if (blockingRight) {
      def.hp -= Math.max(1, dmg * 0.12);
      def.state = 'blockstun';
      def.stunT = m.blockstun;
      def.vx = direction * 40;
      att.confirmed = false;
      this.engine.sfx.play('uiBack');
    } else {
      def.hp -= dmg;
      def.block = false;
      def.guardWindow = 0;
      def.receivedChain = chain;
      def.state = 'hitstun';
      def.stunT = m.hitstun;
      def.flashT = 0.12;
      if (!projectile) {
        att.chain++;
        att.confirmed = true;
        att.chainT = 0.22;
        if (att.chain > 1) {
          att.feedback = `${att.chain} HIT`;
          att.feedbackT = 0.75;
        }
      }
      const finisher = att.profile && chain >= 3;
      def.vx =
        direction * (finisher ? 110 : att.profile === 'rushdown' && !projectile ? 12 : m.knockback);
      if (finisher) def.escapeT = m.hitstun + 0.2;
      if (m.knockdown || def.hp <= 0) {
        def.vy = -160;
        def.y = Math.min(def.y, FLOOR_Y - 0.6);
      }
      this.engine.sfx.play('hit');
      this.engine.shake(FEEL.screenShakeMs, 3);
      this.engine.hitStop(FEEL.hitStopMs);
      if (att === this.p) this.hud.score += 20;
    }
    this.engine.particles.burst(hx, hy, blockingRight ? 3 : 8, {
      color: this.spec.palette[blockingRight ? 14 : 11],
      speed: 70,
      life: 0.25,
    });
    if (def.hp <= 0) {
      def.hp = 0;
      def.state = 'ko';
      def.move = null;
    }
  }

  private updatePulses(dt: number): void {
    this.pulses = this.pulses.filter((pulse) => {
      const def = pulse.owner === this.p ? this.o : this.p;
      const before = pulse.x;
      pulse.x += pulse.vx * dt;
      pulse.life -= dt;
      if (pulse.life <= 0 || pulse.x < 0 || pulse.x > W || pulse.owner.state === 'ko') return false;
      // Generated fighters occupy roughly 80 px of the 96 px foot-anchored
      // cell. Pulses travel at the extended high-punch fist, not the old
      // procedural fighter's waist. Keep duck clearance across all builds.
      const top = def.y + (def.crouch ? -48 : -80) * def.scale;
      if (
        Math.max(before, pulse.x) >= def.x - BODY_HALF * def.scale &&
        Math.min(before, pulse.x) <= def.x + BODY_HALF * def.scale &&
        pulse.y >= top &&
        pulse.y <= def.y - 2
      ) {
        this.pulseImpacts.push({
          x: Math.max(
            def.x - BODY_HALF * def.scale,
            Math.min(def.x + BODY_HALF * def.scale, pulse.x),
          ),
          y: pulse.y,
          age: 0,
          kind: pulse.owner.projectile.kind,
          guarded: def.block || def.escapeT > 0,
        });
        this.applyHit(pulse.owner, def, MOVES.pulse, pulse.x, pulse.y, true, pulse.vx > 0 ? 1 : -1);
        return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------- round flow

  private endRound(): void {
    if (this.roundPhase !== 'fight') return;
    this.roundPhase = 'over';
    this.pulses = [];
    this.phaseT = 0;
    let pW = this.p.hp > 0;
    let oW = this.o.hp > 0;
    if (this.timer <= 0 && pW && oW) {
      // time out: more health wins
      pW = this.p.hp >= this.o.hp;
      oW = !pW;
    }
    if (this.p.hp <= 0) this.p.state = 'ko';
    if (this.o.hp <= 0) this.o.state = 'ko';
    if (pW && !oW) {
      this.pWins++;
      this.banner = 'K.O.!';
      this.hud.score += 300;
      this.engine.sfx.play('win');
    } else {
      this.oWins++;
      this.banner = this.timer <= 0 ? 'TIME' : 'K.O.!';
      this.engine.sfx.play('lose');
    }
    this.engine.music.stopSong();
  }

  private afterRound(): void {
    if (this.pWins >= ROUNDS_TO_WIN) {
      this.winBout();
    } else if (this.oWins >= ROUNDS_TO_WIN) {
      this.loseBout();
    } else {
      this.roundNum++;
      this.engine.music.playSong(this.isBoss() ? 'boss' : this.spec.levels[this.bout]!.musicSong);
      this.startRound(false);
    }
  }

  private winBout(): void {
    if (this.isBoss()) {
      this.phase = 'cards';
      this.engine.music.stopSong();
      this.engine.cards.show(
        this.spec.story.victory.map((line) => ({
          lines: [line],
          portrait: this.engine.portrait,
          artRole: 'victory' as const,
        })),
        () => {
          const par = estimateFighterDurationS(this.spec);
          this.result = {
            outcome: 'won',
            score: this.hud.score,
            timeBonusSeconds: Math.max(0, Math.round(par - this.phaseT)),
          };
        },
      );
    } else {
      this.enterBout(this.bout + 1);
    }
  }

  private loseBout(): void {
    this.hud.lives--;
    if (this.hud.lives < 0) {
      this.phase = 'cards';
      this.engine.music.stopSong();
      this.engine.cards.show(
        this.spec.story.defeat.map((line) => ({
          lines: [line],
          portrait: this.engine.portraitDefeat,
          artRole: 'defeat' as const,
        })),
        () => {
          this.result = { outcome: 'lost', score: this.hud.score, timeBonusSeconds: 0 };
        },
      );
    } else {
      // continue: refight the same bout from round 1
      this.pWins = 0;
      this.oWins = 0;
      this.roundNum = 1;
      this.engine.music.playSong(this.isBoss() ? 'boss' : this.spec.levels[this.bout]!.musicSong);
      this.startRound(true);
    }
  }

  // ------------------------------------------------------------------ render

  private poseOf(a: Actor): FighterPose {
    if (a.state === 'ko') return 'ko';
    if (a.state === 'hitstun') return 'hit';
    if (a.state === 'blockstun' || a.state === 'block') return 'block';
    if (a.state === 'attack' && a.move) return MOVES[a.move].pose;
    if (a.y < FLOOR_Y - 0.5) return 'jump';
    if (a.crouch || a.state === 'crouch') return 'crouch';
    if (a.state === 'walk') return fighterWalkPoseAtTime(a.walkT);
    return 'idle';
  }

  private drawGeneratedFighter(a: Actor, pose: FighterPose, flash: boolean): void {
    const ctx = this.engine.renderer.ctx;
    const size = GENERATED_FIGHTER_ATLAS_CELL_SIZE;
    const bottomPadding = 4;
    const x = Math.round(a.x) - size / 2;
    const y = Math.round(a.y) - (size - bottomPadding);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (a.facing === -1) {
      // Every source PNG is authored facing right. Mirror around the actor's
      // combat center without changing any gameplay geometry.
      ctx.translate(Math.round(a.x) * 2, 0);
      ctx.scale(-1, 1);
    }
    const prepared = this.preparedFighterPoses[a.identitySlot]![pose];
    ctx.drawImage(flash ? prepared.flash : prepared.normal, x, y, size, size);
    ctx.restore();
  }

  private drawArenaBackground(): void {
    if (this.preparedFighterArenas) {
      const panel = this.isBoss() ? 1 : 0;
      this.engine.renderer.ctx.drawImage(this.preparedFighterArenas[panel], 0, 0, W, H);
      return;
    }
    // Stable fallback for an unavailable optional generated environment.
    this.backdrop.draw(this.engine.renderer.ctx, Math.sin(this.phaseT * 0.2) * 8, 0);
  }

  render(): void {
    const r = this.engine.renderer;
    const pal = this.spec.palette;
    r.clear(pal[2] ?? '#101020');

    this.drawArenaBackground();
    // Story cards own their presentation. Keep only the cached arena behind
    // them instead of rendering fighters, shadows, and combat UI pointlessly.
    if (this.phase === 'cards') return;

    // stage: banded floor + a back wall line
    r.rect(0, FLOOR_Y, W, H - FLOOR_Y, pal[1] ?? '#10122b');
    r.rect(0, FLOOR_Y, W, 2, pal[4] ?? '#41a6f6');
    r.rect(0, FLOOR_Y - 1, W, 1, pal[3] ?? '#29366f');

    // shadows
    for (const a of [this.p, this.o]) {
      const gy = FLOOR_Y + 1;
      const shw = 20 * a.scale;
      r.ctx.fillStyle = 'rgba(0,0,0,0.35)';
      r.ctx.beginPath();
      r.ctx.ellipse(a.x, gy, shw, 3.5 * a.scale, 0, 0, Math.PI * 2);
      r.ctx.fill();
    }

    // fighters (player over opponent when overlapping toward the camera)
    const order = this.p.y >= this.o.y ? [this.o, this.p] : [this.p, this.o];
    for (const a of order) {
      const flick = a.state === 'hitstun' && Math.floor(this.phaseT * 30) % 2 === 0;
      const pose = this.poseOf(a);
      const flash = a.flashT > 0 || flick;
      this.drawGeneratedFighter(a, pose, flash);
    }

    for (const pulse of this.pulses)
      drawFighterProjectile(
        r,
        pulse.owner.projectile.kind,
        Math.round(pulse.x),
        Math.round(pulse.y),
        Math.sign(pulse.vx),
        2.5 - pulse.life,
      );
    for (const impact of this.pulseImpacts)
      drawFighterProjectileImpact(r, impact.kind, impact.x, impact.y, impact.age, impact.guarded);
    for (const a of [this.p, this.o]) {
      if (a.guardWindow > 0 || a.counterT > 0) {
        const x = Math.round(a.x + a.facing * 22),
          y = Math.round(a.y - 65);
        for (let i = 0; i < 3; i++) r.rect(x, y + i * 7, 3, 4, '#a7f070');
      }
      if (a.move === 'pulse' && a.moveT < MOVES.pulse.startup) {
        const x = Math.round(a.x + a.facing * 27 * a.scale),
          y = Math.round(a.y + MOVES.pulse.hitY * a.scale);
        drawFighterProjectileWindup(r, a.projectile.kind, x, y, a.moveT / MOVES.pulse.startup);
      }
    }
    this.renderUi(r);
  }

  private renderUi(r: EngineContext['renderer']): void {
    const pal = this.spec.palette;
    // health bars (P1 left, opponent right), below the host HUD strip
    const barW = 190;
    const y = 24;
    const bar = (x: number, frac: number, flip: boolean): void => {
      r.rect(x, y, barW, 8, pal[1] ?? '#000');
      r.frame(x, y, barW, 8, pal[4] ?? '#41a6f6');
      const w = Math.max(0, Math.round((barW - 2) * Math.max(0, frac)));
      const col = frac > 0.3 ? (pal[5] ?? '#38b764') : (pal[11] ?? '#e04040');
      r.rect(flip ? x + barW - 1 - w : x + 1, y + 1, w, 6, col);
    };
    bar(8, this.p.hp / this.p.maxHp, false);
    bar(W - 8 - barW, this.o.hp / this.o.maxHp, true);
    r.text(this.playerChar().name, 10, y + 11, r.theme.text);
    r.text(this.opponentChar().name, W - 10, y + 11, r.theme.text, { align: 'right' });

    for (const [a, x, align] of [
      [this.p, 10, 'left'],
      [this.o, W - 10, 'right'],
    ] as const) {
      if (!a.profile) continue;
      const status =
        a.feedbackT > 0
          ? a.feedback
          : a.profile === 'rushdown'
            ? 'CHAIN B > Y > X'
            : a.profile === 'counter'
              ? a.guardCooldown > 0
                ? 'GUARD RECOVERING'
                : 'TIMED GUARD READY'
              : a.pulseCooldown > 0
                ? `${a.pulseCooldown.toFixed(1)}s RECHARGE`
                : 'GUARD + Y: CAST';
      r.text(
        a.profile === 'rangedControl' ? a.projectile.name : FIGHTER_STYLE_CATALOG[a.profile].name,
        x,
        51,
        r.theme.dim,
        { align },
      );
      r.text(status, x, 63, '#ffd75e', { align });
    }

    // round-win pips
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      r.rect(8 + i * 8, y - 7, 5, 5, i < this.pWins ? (pal[13] ?? '#ffd75e') : (pal[3] ?? '#333'));
      r.rect(
        W - 13 - i * 8,
        y - 7,
        5,
        5,
        i < this.oWins ? (pal[13] ?? '#ffd75e') : (pal[3] ?? '#333'),
      );
    }

    // timer
    r.text(String(Math.ceil(this.timer)).padStart(2, '0'), W / 2, y, r.theme.heading, {
      align: 'center',
    });

    // banner (ROUND n / FIGHT! / K.O.)
    if (this.banner) {
      const big = this.banner === 'FIGHT!' || this.banner.startsWith('K.O');
      r.text(this.banner, W / 2, H / 2 - 20, big ? (pal[13] ?? '#ffd75e') : r.theme.heading, {
        align: 'center',
        scale: big ? 2 : 1,
      });
    }
  }
}
