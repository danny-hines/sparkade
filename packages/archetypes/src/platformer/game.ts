// Platformer gameplay (Mario-like). Controls per SNES convention:
// d-pad move/duck, A jump, X/Y run (+ throw with the projectile powerup),
// B spin jump, START pause (host-owned).
import {
  aabbOverlap,
  cellsUnder,
  createSilhouetteAura,
  drawTileLayer,
  LIBRARY,
  makeBackdrop,
  makeGeneratedBackdrop,
  moveAABB,
  platformerHdMovingPlatformRef,
  platformerHdSpringRef,
  platformerHdTileRef,
  type Backdrop,
  type EngineContext,
  type GameInstance,
  type GameResult,
  type HudState,
  type InputSnapshot,
  type ResolvedSprite,
  type SilhouetteAura,
  type SilhouetteAuraBand,
  type Solidity,
} from '@sparkade/engine';
import {
  platformerPlayStyle,
  platformerBossPacing,
  platformerChargeShot,
  PLATFORMER_CHARGED_SHOT,
  platformerMechanics,
  platformerTowerLevel,
  requiredPlatformerActionPoses,
  type PlatformerActionPose,
  type PlatformerPose,
  FEEL,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  LIB_BOSSES_PLATFORMER,
  TILE_SIZE,
  difficultyScale,
  resolvePlatformerMovement,
  type DifficultyScale,
  type Coord,
  type PlatformerEntity,
  type PlatformerAbilityKind,
  type PlatformerLevel,
  type PlatformerSpec,
  type PlatformerTileType,
  type ResolvedPlatformerMovement,
} from '@sparkade/shared';
import {
  platformerActionFrame,
  platformerBlasterFacing,
  platformerPoseBounds,
  platformerWallDrawX,
  type PlatformerPoseBounds,
} from './poses';
import { surfaceDecorations } from './decor';
import { drawPixelCharge, drawPixelStrike } from './effects';
import { stepTowerMotion, TOWER_MOTION, type TowerMotion } from './tower-motion';
import {
  isSolidInnerLibraryId,
  platformNeighborMask,
  PlatformerPlatformAutotiles,
  PlatformerSolidAutotiles,
  resolveSolidInnerRef,
  solidNeighborMask,
  terrainAtlasFrame,
} from './autotile';
import {
  MOVING_PLATFORM_BODY,
  platformerDoorRect,
  platformerHeroPresentation,
  platformerMovingPlatformOutlineRect,
  platformerPlayerBody,
  platformerWorldScale,
} from './geometry';
import { estimatePlatformerDurationS } from './lint';

const GRAV = 860;
const MAX_FALL = 330;
const WALK = 88;
const RUN = 142;
const ACCEL = 950;
const JUMP_V = -302;
const JUMP_RELEASE_V = -80;
const SPRING_V = -488;
const STOMP_BOUNCE = -230;
const SPIN_BOUNCE = -280;
const CONVEYOR_SPEED = 42;
const PLAYER_FRONT_IDLE_DELAY_S = 1;

export function platformerStrikeBox(
  player: { x: number; y: number; w: number; h: number },
  facing: number,
) {
  return {
    x: facing > 0 ? player.x + player.w / 2 : player.x + player.w / 2 - 34,
    y: player.y + 3,
    w: 34,
    h: player.h - 6,
  };
}

export type PlatformerSurfaceMaterial = 'normal' | 'ice' | 'conveyorLeft' | 'conveyorRight';

function isPlatformerFullSolid(kind: PlatformerTileType): boolean {
  return kind === 'solid' || kind === 'ice' || kind === 'conveyorLeft' || kind === 'conveyorRight';
}

/** Resolve a stable material when the player's feet overlap two support cells.
 * A directional conveyor wins over ice; opposing conveyors cancel rather than
 * making the player jitter at their seam. */
export function platformerSurfaceMaterial(
  supports: readonly PlatformerTileType[],
): PlatformerSurfaceMaterial {
  const left = supports.includes('conveyorLeft');
  const right = supports.includes('conveyorRight');
  if (left !== right) return left ? 'conveyorLeft' : 'conveyorRight';
  return supports.includes('ice') ? 'ice' : 'normal';
}

/** Only compact legacy saves need terrain repainted in front of oversized
 * generated hero art. Current two-tile players use their full visual body for
 * collision, so repainting terrain would incorrectly cover both the hero and
 * any semantic surface cues drawn on top of the tile. */
export function shouldMaskLegacyPlatformerForeground(
  playerHeightTiles: PlatformerSpec['playerHeightTiles'],
  appliedPresentation: string,
  playerHeight: number,
  spriteHeight: number,
): boolean {
  return (
    playerHeightTiles !== 2 &&
    appliedPresentation === 'tall-humanoid' &&
    playerHeight !== spriteHeight
  );
}

export type GeneratedPlatformerGroundAnimation = 'idle' | 'sideIdle' | 'walk';

/** Ground animation follows player intent rather than residual velocity. A
 * coasting hero keeps the side silhouette, then turns toward the camera only
 * after both stopping and spending a beat without directional input. */
export function generatedPlatformerGroundAnimation(
  horizontalIntent: number,
  horizontalVelocity: number,
  noHorizontalInputTime: number,
): GeneratedPlatformerGroundAnimation {
  if (horizontalIntent !== 0 && Math.abs(horizontalVelocity) > 8) return 'walk';
  if (Math.abs(horizontalVelocity) > 8 || noHorizontalInputTime < PLAYER_FRONT_IDLE_DELAY_S) {
    return 'sideIdle';
  }
  return 'idle';
}

/** One horizontal-control step, exported so profile behavior stays testable
 * without needing to boot the canvas runtime. Balanced reproduces the original
 * single acceleration value on the ground and its 0.65 air-control multiplier. */
export function stepPlatformerHorizontalVelocity(
  velocity: number,
  direction: number,
  maxSpeed: number,
  dt: number,
  onGround: boolean,
  movement: ResolvedPlatformerMovement,
  surface: PlatformerSurfaceMaterial = 'normal',
): number {
  const normalizedDirection = Math.max(-1, Math.min(1, direction));
  const reversing =
    normalizedDirection !== 0 && velocity !== 0 && Math.sign(velocity) !== normalizedDirection;
  const control = onGround
    ? normalizedDirection === 0 || reversing
      ? movement.groundBraking
      : movement.groundAcceleration
    : normalizedDirection === 0
      ? movement.airBraking
      : movement.airControl;
  const surfaceControl =
    onGround && surface === 'ice'
      ? normalizedDirection === 0
        ? 0.12
        : reversing
          ? 0.18
          : 0.32
      : 1;
  const conveyorSpeed =
    onGround && surface === 'conveyorLeft'
      ? -CONVEYOR_SPEED
      : onGround && surface === 'conveyorRight'
        ? CONVEYOR_SPEED
        : 0;
  const target = normalizedDirection * maxSpeed + conveyorSpeed;
  const delta = target - velocity;
  const step = ACCEL * control * surfaceControl * dt;
  return velocity + (Math.abs(delta) <= step ? delta : Math.sign(delta) * step);
}

type TileKind = PlatformerTileType;

interface Ent {
  active: boolean;
  type: PlatformerEntity['type'];
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  homeX: number;
  homeY: number;
  dir: number;
  t: number;
  hp: number;
  fireT: number;
  props: NonNullable<PlatformerEntity['props']>;
  onGround: boolean;
}

interface Proj {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  friendly: boolean;
  grav: boolean;
  t: number;
  trailT: number;
  damage: number;
  hitsLeft: number;
}

interface OutlinedMovingPlatformFrame {
  image: HTMLCanvasElement;
  padX: number;
  padY: number;
}

interface BossAttackState {
  name: 'stomp' | 'charge' | 'spread' | 'summon' | 'idle';
  t: number;
  telegraph: number;
}

const PLATFORMER_PLAYER_POSES = ['idle', 'sideIdle', 'walk1', 'walk2', 'jump'] as const;
type PlatformerPlayerPose = (typeof PLATFORMER_PLAYER_POSES)[number];
type GeneratedPlatformerPoses = Readonly<
  Record<PlatformerPlayerPose, CanvasImageSource> &
    Partial<Record<PlatformerActionPose, CanvasImageSource>>
>;
const GENERATED_PLAYER_FALLBACK_DRAW_W = 24;
const GENERATED_PLAYER_FALLBACK_DRAW_H = 32;
const GENERATED_PLAYER_GROUND_OVERLAP = 2;
const GENERATED_PLAYER_GAIT_SPEEDUP = 1.12;
const LEGACY_GENERATED_PLAYER_WIDTH = 56;
const LEGACY_GENERATED_PLAYER_HEIGHT = 64;
const LEGACY_GENERATED_PLAYER_DENSITY = 2;
const DETAILED_GENERATED_PLAYER_WIDTH = 112;
const DETAILED_GENERATED_PLAYER_HEIGHT = 128;
const DETAILED_GENERATED_PLAYER_DENSITY = 4;
const GENERATED_BOSS_DRAW_W = 48;
const GENERATED_BOSS_DRAW_H = 48;
const GENERATED_BOSS_GROUND_OVERLAP = 2;
const GENERATED_ENEMY_GROUND_OVERLAP = 1;
const ABILITY_NOTICE_DURATION_S = 1.8;
const ABILITY_NOTICE_RISE_PX = 18;
export const GENERATED_PLATFORMER_BACKDROP_DIM_ALPHA = 0.22;

/** Screen-space motion for the world-anchored ability pickup announcement. */
export function platformerAbilityNoticeFrame(
  elapsed: number,
  duration = ABILITY_NOTICE_DURATION_S,
): { alpha: number; rise: number } {
  const progress = Math.max(0, Math.min(1, elapsed / Math.max(0.001, duration)));
  const fadeStart = 0.55;
  return {
    alpha: progress <= fadeStart ? 1 : (1 - progress) / (1 - fadeStart),
    rise: ABILITY_NOTICE_RISE_PX * (1 - (1 - progress) ** 2),
  };
}

const GENERATED_ENEMY_DRAW_SIZE = {
  walker: { w: 24, h: 24 },
  flyer: { w: 26, h: 22 },
  shooter: { w: 24, h: 24 },
  chaser: { w: 22, h: 22 },
} as const;

type GeneratedPlatformerEnemyRole = keyof typeof GENERATED_ENEMY_DRAW_SIZE;

function isGeneratedPlatformerEnemyRole(
  role: PlatformerEntity['type'],
): role is GeneratedPlatformerEnemyRole {
  return Object.prototype.hasOwnProperty.call(GENERATED_ENEMY_DRAW_SIZE, role);
}

export function generatedPlatformerGaitRate(speed: number): number {
  // The six timing beats below preserve the old four-beat cycle duration while
  // holding each contact twice as long as its neutral side separator. The small
  // multiplier keeps the runtime cadence close to the pose lab's balanced timing.
  return Math.max(6, Math.min(13.5, Math.abs(speed) / 12)) * GENERATED_PLAYER_GAIT_SPEEDUP;
}

export function generatedPlatformerGaitFrame(phase: number): {
  pose: 'sideIdle' | 'walk1' | 'walk2';
  compression: 0;
} {
  const frame = ((Math.floor(phase) % 6) + 6) % 6;
  if (frame < 2) return { pose: 'walk1', compression: 0 };
  if (frame === 2 || frame === 5) return { pose: 'sideIdle', compression: 0 };
  return { pose: 'walk2', compression: 0 };
}

export function generatedPlatformerPoseDrawSize(
  sourceWidth: number,
  sourceHeight: number,
): { w: number; h: number } {
  const density =
    sourceWidth >= DETAILED_GENERATED_PLAYER_WIDTH &&
    sourceHeight >= DETAILED_GENERATED_PLAYER_HEIGHT
      ? DETAILED_GENERATED_PLAYER_DENSITY
      : LEGACY_GENERATED_PLAYER_DENSITY;
  return {
    w:
      Number.isFinite(sourceWidth) && sourceWidth > 0
        ? sourceWidth / density
        : LEGACY_GENERATED_PLAYER_WIDTH / LEGACY_GENERATED_PLAYER_DENSITY,
    h:
      Number.isFinite(sourceHeight) && sourceHeight > 0
        ? sourceHeight / density
        : LEGACY_GENERATED_PLAYER_HEIGHT / LEGACY_GENERATED_PLAYER_DENSITY,
  };
}

function generatedImageDrawSize(image: CanvasImageSource): { w: number; h: number } {
  const dimensions = image as unknown as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  return generatedPlatformerPoseDrawSize(
    dimensions.naturalWidth || dimensions.width || GENERATED_PLAYER_FALLBACK_DRAW_W * 2,
    dimensions.naturalHeight || dimensions.height || GENERATED_PLAYER_FALLBACK_DRAW_H * 2,
  );
}

/** Generated art overlaps the collision floor by two world pixels because the
 * visible tile cap begins two pixels below its solid edge. This is presentation-only:
 * physics continues to use the inset player body. */
export function generatedPlatformerPlayerDrawRect(
  playerX: number,
  playerY: number,
  playerW: number,
  playerH: number,
  drawW = GENERATED_PLAYER_FALLBACK_DRAW_W,
  drawH = GENERATED_PLAYER_FALLBACK_DRAW_H,
  compression: 0 | 1 = 0,
): { x: number; y: number; w: number; h: number } {
  const renderedHeight = drawH - compression;
  return {
    x: playerX - (drawW - playerW) / 2,
    y: playerY + playerH + GENERATED_PLAYER_GROUND_OVERLAP - renderedHeight,
    w: drawW,
    h: renderedHeight,
  };
}

export function generatedPlatformerBossDrawRect(
  bossX: number,
  bossY: number,
  bossW: number,
  bossH: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: bossX - (GENERATED_BOSS_DRAW_W - bossW) / 2,
    y: bossY + bossH + GENERATED_BOSS_GROUND_OVERLAP - GENERATED_BOSS_DRAW_H,
    w: GENERATED_BOSS_DRAW_W,
    h: GENERATED_BOSS_DRAW_H,
  };
}

export function generatedPlatformerEnemyDrawRect(
  role: GeneratedPlatformerEnemyRole,
  enemyX: number,
  enemyY: number,
  enemyW: number,
  enemyH: number,
): { x: number; y: number; w: number; h: number } {
  const size = GENERATED_ENEMY_DRAW_SIZE[role];
  return {
    x: enemyX - (size.w - enemyW) / 2,
    y: enemyY + enemyH + GENERATED_ENEMY_GROUND_OVERLAP - size.h,
    w: size.w,
    h: size.h,
  };
}

export function platformerShooterFacingDirection(
  playerCenterX: number,
  enemyCenterX: number,
  currentDirection: number,
): -1 | 1 {
  const delta = playerCenterX - enemyCenterX;
  if (Math.abs(delta) < 0.5) return currentDirection < 0 ? -1 : 1;
  return delta < 0 ? -1 : 1;
}

export function platformerShooterMuzzlePoint(
  drawRect: { x: number; y: number; w: number; h: number },
  direction: number,
): { x: number; y: number } {
  const inset = Math.max(1, Math.min(3, drawRect.w * 0.12));
  return {
    x: direction < 0 ? drawRect.x + inset : drawRect.x + drawRect.w - inset,
    y: drawRect.y + drawRect.h / 2,
  };
}

export function platformerBossTelegraphAuraBands(
  attackTime: number,
  telegraphDuration: number,
  maxRadius: number,
): SilhouetteAuraBand[] {
  const duration = Math.max(0.001, telegraphDuration);
  const readiness = Math.max(0, Math.min(1, attackTime / duration));
  const radiusLimit = Math.max(1, Math.round(maxRadius));
  const phase = (attackTime * (2.3 + readiness * 2.2)) % 1;
  return [
    { radius: 1, alpha: 0.45 + readiness * 0.28 },
    {
      radius: 1 + Math.floor(phase * radiusLimit),
      alpha: (0.92 - readiness * 0.12) * (1 - phase),
    },
  ];
}

/** Density-four spring art retains the original one-tile world footprint. */
export function platformerSpringDrawRect(
  springX: number,
  springY: number,
  springW: number,
  springH: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: springX - (TILE_SIZE - springW) / 2,
    y: springY - (TILE_SIZE - springH),
    w: TILE_SIZE,
    h: TILE_SIZE,
  };
}

export function generatedPlatformerPropDrawRect(
  role: 'coin' | 'heart' | 'powerup',
  x: number,
  y: number,
  width: number,
  height: number,
  time: number,
): { x: number; y: number; w: number; h: number } {
  const wave = Math.sin(time * (role === 'coin' ? 5.5 : 4));
  const bob = role === 'powerup' ? -1.5 - wave * 1.25 : -0.75 - wave * 0.75;
  const scaleX = role === 'coin' ? 0.55 + Math.abs(Math.cos(time * 5.5)) * 0.45 : 1;
  const scaleY = role === 'coin' ? 1 : 1 + wave * (role === 'heart' ? 0.08 : 0.1);
  const drawW = width * scaleX;
  const drawH = height * scaleY;
  return {
    x: x + (width - drawW) / 2,
    y: y + bob + (height - drawH) / 2,
    w: drawW,
    h: drawH,
  };
}

/** Generated player art is atomic so animation can never switch identities or
 * pixel densities when one asset is missing or fails to load. */
export function completeGeneratedPlatformerPoses(
  poses: Readonly<Record<string, CanvasImageSource>> | null,
  requiredActions: readonly PlatformerActionPose[] = [],
): GeneratedPlatformerPoses | null {
  if (!poses) return null;
  const complete = { ...poses } as Record<PlatformerPlayerPose, CanvasImageSource>;
  for (const pose of [...PLATFORMER_PLAYER_POSES, ...requiredActions]) {
    const image = poses[pose];
    if (!image) return null;
    // The spread preserves optional action poses on older saves.
  }
  return complete;
}

const ROLE_FALLBACK: Record<string, string> = {
  hero: 'lib:hero_squire',
  walker: 'lib:enemy_walker',
  flyer: 'lib:enemy_flyer',
  shooter: 'lib:enemy_shooter',
  chaser: 'lib:enemy_chaser',
  boss: 'lib:boss_knight',
  coin: 'lib:pickup_coin',
  heart: 'lib:pickup_heart',
  powerup: 'lib:pickup_power',
  projectile: 'lib:proj_orb',
  enemy_projectile: 'lib:proj_pellet',
  obj_platform: 'lib:obj_platform',
  obj_spring: 'lib:obj_spring',
};

function generatedAbilityPropRole(kind: PlatformerAbilityKind): string {
  switch (kind) {
    case 'doubleJump':
      return 'powerupDoubleJump';
    case 'projectile':
      return 'powerupProjectile';
    case 'shield':
      return 'powerupShield';
  }
}

export function createPlatformerGame(engine: EngineContext, spec: PlatformerSpec): GameInstance {
  return new PlatformerGame(engine, spec);
}

class PlatformerGame implements GameInstance {
  hud: HudState = {
    score: 0,
    lives: 3,
    health: 3,
    maxHealth: 3,
    keys: 0,
    bombs: 0,
    collectibles: 0,
  };
  result: GameResult | null = null;

  private phase: 'cards' | 'play' | 'over' = 'cards';
  private levelIndex = 0; // 0..2 levels, 3 = boss arena
  private level!: PlatformerLevel;
  private grid!: { cols: number; rows: number; kind(x: number, y: number): TileKind };
  private tileCanvases = new Map<string, CanvasImageSource[]>();
  private objectiveAuras = new Map<'checkpoint' | 'exit', SilhouetteAura[]>();
  private outlinedMovingPlatforms = new Map<CanvasImageSource, OutlinedMovingPlatformFrame>();
  private platformAutotiles: PlatformerPlatformAutotiles | null = null;
  private solidAutotiles: PlatformerSolidAutotiles | null = null;
  private highDensitySolidTerrain = false;
  private decorations: Coord[] = [];
  private backdrop!: Backdrop;
  private ents: Ent[] = [];
  private projs: Proj[] = Array.from({ length: 16 }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    friendly: false,
    grav: false,
    t: 0,
    trailT: 0,
    damage: 1,
    hitsLeft: 1,
  }));

  // player
  private px = 0;
  private py = 0;
  private playerW = 10;
  private playerH = 14;
  private worldScale: 1 | 2 = 1;
  private viewW = INTERNAL_WIDTH;
  private viewH = INTERNAL_HEIGHT;
  private pvx = 0;
  private pvy = 0;
  private facing = 1;
  private onGround = false;
  private coyoteT = 0;
  private jumpBufT = 0;
  private spinning = false;
  private airJumpUsed = false;
  private invulnT = 0;
  private throwCooldown = 0;
  private charge = 0;
  private shotPoseT = 0;
  private aimUp = false;
  private shotUp = false;
  private shotFacing = 1;
  private meleeT = 0;
  private meleeActiveStarted = false;
  private meleeHits = new Set<Ent>();
  private meleeFacing = 1;
  private towerMotion: TowerMotion | null = null;

  private get playStyle() {
    return platformerPlayStyle(this.spec);
  }
  private get kit() {
    return platformerMechanics(this.spec);
  }
  private get blasterFacing() {
    return platformerBlasterFacing(this.facing, this.onGround, this.towerMotion?.wall ?? 0);
  }
  private get canStomp() {
    return this.kit.combat === 'stomp';
  }
  private get meleeActive() {
    return this.kit.combat === 'melee' && this.meleeT <= 0.36 && this.meleeT > 0.2;
  }

  private power = { doubleJump: false, projectile: false, shield: false };
  private checkpoint: { x: number; y: number } | null = null;
  private animT = 0;
  private generatedGaitT = 0;
  private horizontalIntent = 0;
  private noHorizontalInputT = 0;
  private playT = 0;
  private abilityNotice: { text: string; x: number; y: number; elapsed: number } | null = null;

  // boss
  private boss:
    (Ent & { attack: BossAttackState; phaseIx: number; invulnT: number; maxHp: number }) | null =
    null;

  private sprites: Record<string, ResolvedSprite> = {};
  private generatedPlayerPoses: GeneratedPlatformerPoses;
  private poseBounds: Partial<Record<PlatformerPose, PlatformerPoseBounds>> = {};
  private playerAuras: Readonly<Record<PlatformerPose, SilhouetteAura>>;
  private bossAuras = new Map<CanvasImageSource, SilhouetteAura>();
  private generatedBoss: CanvasImageSource | null = null;
  private generatedEnemies: Readonly<Record<string, CanvasImageSource>> | null = null;
  private generatedProps: Readonly<Record<string, CanvasImageSource>> | null = null;
  private generatedBackdrops: Readonly<Record<string, CanvasImageSource>> | null = null;
  private generatedBackdropActive = false;
  private diff!: DifficultyScale;
  // Per-game movement is selected from bounded engine-owned profiles. Omitted
  // profiles remain byte-identical to the original physics, while legacy feel
  // values continue to overlay their original gravity/jump/speed multipliers.
  private movement!: ResolvedPlatformerMovement;
  private grav = GRAV;
  private jumpV = JUMP_V;
  private run = RUN;
  private walk = WALK;
  private maxFall = MAX_FALL;
  private jumpReleaseV = JUMP_RELEASE_V;

  constructor(
    private engine: EngineContext,
    private spec: PlatformerSpec,
  ) {
    this.diff = difficultyScale(this.spec.difficulty);
    this.movement = resolvePlatformerMovement(this.spec.movementProfile, this.spec.feel);
    this.grav = GRAV * this.movement.gravity;
    this.jumpV = JUMP_V * this.movement.jump;
    this.run = RUN * this.movement.speed;
    this.walk = WALK * this.movement.speed;
    this.maxFall = MAX_FALL * this.movement.terminalVelocity;
    this.jumpReleaseV = JUMP_RELEASE_V * this.movement.jumpCutoff;
    const bossFallback = `lib:${
      LIB_BOSSES_PLATFORMER[(this.spec.seed >>> 0) % LIB_BOSSES_PLATFORMER.length]!
    }`;
    for (const role of Object.keys(ROLE_FALLBACK)) {
      this.sprites[role] = engine.sprites.byRole(
        role,
        role === 'boss' ? bossFallback : ROLE_FALLBACK[role]!,
        role === 'hero'
          ? { presentation: platformerHeroPresentation(this.spec.playerHeightTiles) }
          : role === 'obj_platform'
            ? { bob: false, anchorOpaqueTop: true }
            : role === 'obj_spring'
              ? { bob: false }
              : {},
      );
    }
    this.worldScale = platformerWorldScale(this.spec.playerHeightTiles, this.spec.platformerScale);
    this.viewW = INTERNAL_WIDTH / this.worldScale;
    this.viewH = INTERNAL_HEIGHT / this.worldScale;
    const body = platformerPlayerBody(this.spec.playerHeightTiles, this.spec.platformerScale);
    this.playerW = body.w;
    this.playerH = body.h;
    const generatedPlayerPoses = completeGeneratedPlatformerPoses(
      this.engine.platformerPoses,
      this.spec.actionPoseVersion === 1 ? requiredPlatformerActionPoses(this.spec) : [],
    );
    if (!generatedPlayerPoses) {
      throw new Error('Platformer games require a complete generated player pose set');
    }
    this.generatedPlayerPoses = generatedPlayerPoses;
    this.poseBounds = Object.fromEntries(
      Object.entries(generatedPlayerPoses).map(([pose, image]) => [
        pose,
        platformerPoseBounds(image),
      ]),
    );
    const shieldColor = this.spec.palette[14] ?? '#94e7ff';
    this.playerAuras = Object.fromEntries(
      Object.entries(generatedPlayerPoses).map(([pose, image]) => {
        const size = generatedImageDrawSize(image);
        return [pose, createSilhouetteAura(image, size.w, size.h, shieldColor, 3)];
      }),
    ) as unknown as Readonly<Record<PlatformerPose, SilhouetteAura>>;
    this.generatedBoss = this.engine.platformerBoss;
    const bossSprite = this.sprites['boss']!;
    const bossAuraColor = this.spec.palette[11] ?? '#ef7d57';
    if (this.generatedBoss) {
      this.bossAuras.set(
        this.generatedBoss,
        createSilhouetteAura(
          this.generatedBoss,
          GENERATED_BOSS_DRAW_W,
          GENERATED_BOSS_DRAW_H,
          bossAuraColor,
          4,
        ),
      );
    } else {
      for (const frame of bossSprite.frames) {
        this.bossAuras.set(
          frame,
          createSilhouetteAura(frame, bossSprite.w, bossSprite.h, bossAuraColor, 4),
        );
      }
    }
    this.generatedEnemies = this.engine.platformerEnemies;
    this.generatedProps = this.engine.platformerProps;
    this.generatedBackdrops = this.engine.platformerBackdrops;
    if (this.spec.abilityLoadout?.length) {
      this.hud.abilities = this.spec.abilityLoadout.map(({ kind, name }) => ({
        kind,
        name,
        active: false,
      }));
    }
  }

  get worldZoom() {
    if (this.worldScale === 1) return undefined;
    return { scale: this.worldScale };
  }

  start(): void {
    const s = this.spec.story;
    const cards = s.intro.map((line) => ({
      title: this.spec.meta.title,
      lines: [line],
      portrait: this.engine.portrait,
      artRole: 'intro' as const,
    }));
    this.engine.cards.show(cards, () => this.enterLevel(0));
  }

  restart(): void {
    // Pause-menu Restart: current level from its start, full health, score/lives kept.
    this.checkpoint = null;
    if (this.levelIndex >= 3) this.enterBoss(false);
    else this.loadLevel(this.levelIndex);
    this.hud.health = this.hud.maxHealth;
  }

  dispose(): void {
    this.engine.music.stopSong();
  }

  // -------------------------------------------------------------- level flow

  private enterLevel(ix: number): void {
    this.levelIndex = ix;
    if (ix >= 3) {
      this.enterBoss(true);
      return;
    }
    this.engine.music.playJingle('levelIntro');
    this.engine.cards.show(
      [
        {
          title: this.spec.levels[ix]!.name,
          lines: [this.spec.story.levelIntros[ix] ?? '...'],
          portrait: this.engine.portrait,
        },
      ],
      () => {
        this.loadLevel(ix);
        this.engine.music.playSong(this.spec.levels[ix]!.musicSong);
        this.phase = 'play';
      },
    );
  }

  private loadLevel(ix: number): void {
    const level = this.spec.levels[ix]!;
    this.level = level;
    this.buildGrid(level.tiles, level.legend);
    this.decorations = surfaceDecorations(level, this.spec.seed + ix * 101 + 0xdec0);
    const generatedBackdrop = this.generatedBackdrops?.[`level${ix + 1}`];
    this.generatedBackdropActive = !!generatedBackdrop;
    this.backdrop = generatedBackdrop
      ? makeGeneratedBackdrop(generatedBackdrop, this.viewW, this.viewH)
      : makeBackdrop(this.spec.palette, this.spec.seed + ix * 101, this.spec.backdrop);
    this.ents = level.entities.map((e) => this.makeEnt(e));
    this.boss = null;
    for (const p of this.projs) p.active = false;
    this.checkpoint = null;
    this.spawnPlayer(level.playerSpawn.x, level.playerSpawn.y);
    this.engine.camera.snap(
      Math.max(0, this.playerCenterX() - this.viewW / 2),
      Math.max(0, this.playerCenterY() - this.viewH / 2),
    );
  }

  private enterBoss(withCard: boolean): void {
    this.levelIndex = 3;
    const build = () => {
      this.buildBossArena();
      this.engine.music.playSong('boss');
      this.phase = 'play';
    };
    if (withCard) {
      this.engine.cards.show(
        [
          {
            title: this.spec.boss.name,
            lines: [this.spec.story.bossIntro],
            portrait: this.engine.portrait,
            artRole: 'boss',
          },
        ],
        build,
      );
    } else build();
  }

  private defaultArenaTiles(): string[] {
    // Heroic framing needs both fighters in its 16-tile-wide view. Compact
    // games retain the original 34-tile arena byte-for-byte.
    const cols = this.worldScale === 2 ? 20 : 34;
    const rows = 17;
    const tiles: string[] = [];
    for (let y = 0; y < rows; y++) {
      let row = '';
      for (let x = 0; x < cols; x++) {
        const wall = x === 0 || x === cols - 1;
        const floor = y >= rows - 2;
        const plat =
          (y === rows - 6 && x >= 4 && x <= 8) ||
          (y === rows - 6 && x >= cols - 9 && x <= cols - 5);
        row += wall || floor ? '#' : plat ? '=' : '.';
      }
      tiles.push(row);
    }
    return tiles;
  }

  private buildBossArena(): void {
    // Use the model's custom arena when it authored one, else the default. The
    // arena lint guarantees side walls + a solid bottom-two-rows floor, so the
    // fixed player/boss spawns below stay valid; the spawn also self-lifts out
    // of solid as a safety net.
    const custom = this.spec.boss.arena;
    const tiles = custom?.tiles?.length ? custom.tiles : this.defaultArenaTiles();
    const legend = custom?.tiles?.length ? custom.legend : { '#': 'solid', '=': 'platform' };
    const rows = tiles.length;
    const cols = tiles[0]?.length ?? 34;
    this.buildGrid(tiles, legend);
    this.decorations = [];
    // Boss arena keeps its 'caves' fallback (matching pre-backdrop-field behavior) so
    // published games without a `backdrop` field render identically; an explicit spec
    // backdrop now carries into the boss fight too. Do NOT drop the fallback to match
    // loadLevel — that would repaint every legacy game's boss arena.
    const generatedBackdrop = this.generatedBackdrops?.boss;
    this.generatedBackdropActive = !!generatedBackdrop;
    this.backdrop = generatedBackdrop
      ? makeGeneratedBackdrop(generatedBackdrop, this.viewW, this.viewH)
      : makeBackdrop(this.spec.palette, this.spec.seed + 777, this.spec.backdrop ?? 'caves');
    this.ents = [];
    for (const p of this.projs) p.active = false;
    this.checkpoint = null;
    this.spawnPlayer(3, rows - 3);
    const bossSprite = this.sprites['boss']!;
    this.boss = {
      active: true,
      type: 'walker',
      x: (cols - 6) * TILE_SIZE,
      y: (rows - 2) * TILE_SIZE - bossSprite.h,
      vx: 0,
      vy: 0,
      w: bossSprite.w - 6,
      h: bossSprite.h - 2,
      homeX: 0,
      homeY: 0,
      dir: -1,
      t: 0,
      hp: this.spec.boss.hp,
      maxHp: this.spec.boss.hp,
      fireT: 0,
      props: {},
      onGround: true,
      attack: { name: 'idle', t: 0, telegraph: 0 },
      phaseIx: 0,
      invulnT: 0,
    };
    this.hud.boss = { hp: this.boss.hp, maxHp: this.boss.maxHp, name: this.spec.boss.name };
    this.engine.camera.snap(0, rows * TILE_SIZE - this.viewH);
  }

  private buildGrid(tiles: string[], legend: Record<string, string>): void {
    const rows = tiles.length;
    const cols = tiles[0]?.length ?? 0;
    const kinds: TileKind[] = new Array(cols * rows).fill('empty');
    for (let y = 0; y < rows; y++) {
      const row = tiles[y]!;
      for (let x = 0; x < cols; x++) {
        const ch = row[x] ?? '.';
        const authored = ch === '.' ? 'empty' : ((legend[ch] as TileKind | undefined) ?? 'empty');
        // Exit placement and decoration are engine-owned. Treat legacy/model
        // grid markers as empty so they cannot create duplicate doors or
        // floating scenery; deterministic surface decor is drawn separately.
        kinds[y * cols + x] = authored === 'exit' || authored === 'decoration' ? 'empty' : authored;
      }
    }
    this.grid = {
      cols,
      rows,
      kind: (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? 'empty' : kinds[y * cols + x]!),
    };
    // Pre-resolve tile art per kind. Solid terrain additionally has a visual
    // cap/body split selected from its neighbours; collision remains one
    // square `solid` kind regardless of the selected canvas.
    const art: Record<string, string> = {
      platform: 'lib:tile_platform',
      hazard: 'lib:tile_hazard',
      checkpoint: 'lib:tile_checkpoint',
      exit: 'lib:tile_exit',
      decoration: 'lib:tile_deco',
    };
    this.tileCanvases.clear();
    for (const [kind, ref] of Object.entries(art)) {
      // Reskinnable terrain: assign role = the default lib id (e.g. "tile_solid":
      // "lib:ice_solid" or a custom 16x16). bob:false keeps tiles still.
      const role = ref.slice(4);
      const assigned = this.spec.sprites.assign[role] ?? ref;
      this.tileCanvases.set(
        kind,
        this.engine.sprites.byRef(platformerHdTileRef(assigned), false, { bob: false }).frames,
      );
    }
    const objectiveColor = this.spec.palette[13] ?? '#ffd75e';
    this.objectiveAuras.clear();
    for (const [kind, size] of [
      ['checkpoint', { w: TILE_SIZE, h: TILE_SIZE }],
      ['exit', { w: TILE_SIZE, h: TILE_SIZE * 2 }],
    ] as const) {
      const frames = this.tileCanvases.get(kind) ?? [];
      this.objectiveAuras.set(
        kind,
        frames.map((frame) => createSilhouetteAura(frame, size.w, size.h, objectiveColor, 4)),
      );
    }

    const capRef = this.spec.sprites.assign['tile_solid'] ?? 'lib:tile_solid';
    const cap = this.engine.sprites.byRef(platformerHdTileRef(capRef), false, { bob: false });
    const refExists = (ref: string): boolean => {
      const [kind, id] = ref.split(':', 2);
      if (!id) return false;
      if (kind === 'lib') {
        const entry = LIBRARY[id];
        return (
          isSolidInnerLibraryId(id) &&
          entry !== undefined &&
          entry.frames.every((frame) => frame.w === TILE_SIZE && frame.h === TILE_SIZE)
        );
      }
      if (kind === 'custom') {
        const sprite = this.spec.sprites.custom[id];
        const rowsAreOpaque = (rows: readonly string[]): boolean =>
          rows.length === TILE_SIZE &&
          rows.every((row) => row.length === TILE_SIZE && !/[.0]/.test(row));
        return (
          sprite?.w === TILE_SIZE &&
          sprite.h === TILE_SIZE &&
          rowsAreOpaque(sprite.rows) &&
          (sprite.frames?.every(rowsAreOpaque) ?? true)
        );
      }
      return false;
    };
    const innerRef = resolveSolidInnerRef(
      capRef,
      this.spec.sprites.assign['tile_solid_inner'],
      refExists,
    );
    const inner = innerRef
      ? this.engine.sprites.byRef(platformerHdTileRef(innerRef), false, { bob: false })
      : cap;
    this.highDensitySolidTerrain =
      (cap.frames[0]?.width ?? TILE_SIZE) > TILE_SIZE &&
      (inner.frames[0]?.width ?? TILE_SIZE) > TILE_SIZE;
    this.solidAutotiles = new PlatformerSolidAutotiles(
      cap.frames,
      inner.frames,
      this.spec.palette[1] ?? '#111111',
      true,
    );
    this.platformAutotiles = new PlatformerPlatformAutotiles(
      this.tileCanvases.get('platform') ?? [],
      this.spec.palette[1] ?? '#111111',
    );
    const movingPlatformRef = platformerHdMovingPlatformRef(capRef);
    if (movingPlatformRef) {
      this.sprites['obj_platform'] = this.engine.sprites.byRef(movingPlatformRef, false, {
        bob: false,
        anchorOpaqueTop: true,
      });
    }
    this.outlinedMovingPlatforms.clear();
    const movingPlatformSprite = this.sprites['obj_platform'];
    const terrainOutlineColor = this.spec.palette[1] ?? '#111111';
    for (const frame of [
      ...(movingPlatformSprite?.frames ?? []),
      ...(movingPlatformSprite?.flipped ?? []),
    ]) {
      const densityX = frame.width / MOVING_PLATFORM_BODY.w;
      const densityY = frame.height / MOVING_PLATFORM_BODY.h;
      const radius = Math.max(1, Math.round(Math.min(densityX, densityY) / 2));
      const outline = createSilhouetteAura(
        frame,
        frame.width,
        frame.height,
        terrainOutlineColor,
        radius,
      );
      const image = document.createElement('canvas');
      image.width = frame.width + radius * 2;
      image.height = frame.height + radius * 2;
      const context = image.getContext('2d')!;
      context.imageSmoothingEnabled = false;
      for (const ring of outline.rings) context.drawImage(ring, 0, 0);
      context.drawImage(frame, radius, radius);
      this.outlinedMovingPlatforms.set(frame, {
        image,
        padX: radius / densityX,
        padY: radius / densityY,
      });
    }
    const springRef = platformerHdSpringRef(capRef);
    if (springRef) {
      this.sprites['obj_spring'] = this.engine.sprites.byRef(springRef, false, { bob: false });
    }
  }

  /** One visual lookup shared by the main terrain and foreground mask passes. */
  private tileCanvasAt(tx: number, ty: number, frameIx: number): CanvasImageSource | null {
    const kind = this.grid.kind(tx, ty);
    if (kind === 'empty') return null;
    if (isPlatformerFullSolid(kind)) {
      const mask = solidNeighborMask((x, y) => isPlatformerFullSolid(this.grid.kind(x, y)), tx, ty);
      return (
        this.solidAutotiles?.frame(
          mask,
          this.highDensitySolidTerrain ? terrainAtlasFrame(tx, ty) : frameIx,
        ) ?? null
      );
    }
    if (kind === 'platform') {
      const mask = platformNeighborMask((x, y) => this.grid.kind(x, y) === 'platform', tx, ty);
      return this.platformAutotiles?.frame(mask, frameIx) ?? null;
    }
    const frames = this.tileCanvases.get(kind);
    if (!frames?.length) return null;
    return frames[frameIx % frames.length] ?? frames[0] ?? null;
  }

  /**
   * Climb a tile coordinate up out of any `solid` tiles. The model authors the
   * terrain (ASCII grid) and the entity/spawn coordinates ({x,y}) as two
   * independent representations that nothing reconciles, so they occasionally
   * collide — a pickup or the player dropped inside solid terrain is unreachable
   * (moveAABB never lets the player enter a solid cell) or immovable. Lifting to
   * the nearest open cell above keeps the game playable regardless of the spec.
   * Platforms are one-way (passable), so they never trap and aren't lifted past.
   */
  private liftOutOfSolid(tx: number, ty: number): number {
    let y = ty;
    while (y > 0 && isPlatformerFullSolid(this.grid.kind(tx, y))) y--;
    return y;
  }

  private playerCellOpen(tx: number, ty: number): boolean {
    const kind = this.grid.kind(tx, ty);
    return !isPlatformerFullSolid(kind) && kind !== 'platform' && kind !== 'hazard';
  }

  /** Lift a marked 16x32 player until both occupied tile rows are clear. */
  private liftPlayerOutOfTerrain(tx: number, footTy: number): number {
    if (this.playerH <= TILE_SIZE) return this.liftOutOfSolid(tx, footTy);
    let y = footTy;
    while (y > 0 && (!this.playerCellOpen(tx, y) || !this.playerCellOpen(tx, y - 1))) y--;
    return y;
  }

  private playerBox(): { x: number; y: number; w: number; h: number } {
    return { x: this.px, y: this.py, w: this.playerW, h: this.playerH };
  }

  private playerCenterX(): number {
    return this.px + this.playerW / 2;
  }

  private playerCenterY(): number {
    return this.py + this.playerH / 2;
  }

  private playerBottom(): number {
    return this.py + this.playerH;
  }

  private makeEnt(e: PlatformerEntity): Ent {
    const small = e.type === 'coin' || e.type === 'heart' || e.type === 'powerup';
    const movingPlatform = e.type === 'movingPlatform';
    const ey = this.liftOutOfSolid(e.x, e.y);
    const inset = small ? 2 : movingPlatform ? 0 : 1;
    return {
      active: true,
      type: e.type,
      x: e.x * TILE_SIZE + inset,
      y: ey * TILE_SIZE + inset,
      vx: 0,
      vy: 0,
      w: movingPlatform ? MOVING_PLATFORM_BODY.w : small ? 12 : 14,
      h: movingPlatform ? MOVING_PLATFORM_BODY.h : small ? 12 : 14,
      homeX: e.x * TILE_SIZE,
      homeY: ey * TILE_SIZE,
      dir: e.props?.dir ?? -1,
      t: 0,
      hp: 1,
      fireT: 0,
      props: e.props ?? {},
      onGround: false,
    };
  }

  private spawnPlayer(tx: number, ty: number): void {
    // Coordinates identify the lower/feet cell. Lift invalid placements out
    // of terrain, then bottom-align the two-tile body to its supporting cell.
    const sy = this.liftPlayerOutOfTerrain(tx, ty);
    if (this.playerH > TILE_SIZE) {
      this.px = tx * TILE_SIZE + (TILE_SIZE - this.playerW) / 2;
      this.py = (sy + 1) * TILE_SIZE - this.playerH;
    } else {
      // Preserve saved one-tile-body games' initial placement exactly.
      this.px = tx * TILE_SIZE + 3;
      this.py = sy * TILE_SIZE + 1;
    }
    this.pvx = 0;
    this.pvy = 0;
    this.onGround = false;
    this.spinning = false;
    this.generatedGaitT = 0;
    this.horizontalIntent = 0;
    this.noHorizontalInputT = 0;
    this.invulnT = 0;
    this.abilityNotice = null;
    this.charge = 0;
    this.meleeT = 0;
    this.meleeHits.clear();
    this.shotPoseT = 0;
    this.throwCooldown = 0;
    this.towerMotion = null;
    if (this.kit.combat === 'blaster') this.setAbilityActive('projectile', true);
  }

  // ----------------------------------------------------------------- update

  update(dt: number, input: InputSnapshot): void {
    if (this.phase !== 'play') return;
    this.playT += dt;
    this.animT += dt;
    if (this.abilityNotice) {
      this.abilityNotice.elapsed += dt;
      if (this.abilityNotice.elapsed >= ABILITY_NOTICE_DURATION_S) this.abilityNotice = null;
    }
    this.updatePlayer(dt, input);
    this.updateEntities(dt);
    if (this.boss) this.updateBoss(dt);
    this.updateProjectiles(dt);

    const bounds = { w: this.grid.cols * TILE_SIZE, h: this.grid.rows * TILE_SIZE };
    this.engine.camera.follow(this.playerCenterX(), this.playerCenterY(), this.facing, bounds, dt, {
      w: this.viewW,
      h: this.viewH,
      lookahead: 40 / this.worldScale,
    });
  }

  private solidity(tx: number, ty: number): Solidity {
    const k = this.grid.kind(tx, ty);
    return isPlatformerFullSolid(k) ? 'solid' : k === 'platform' ? 'platform' : 'empty';
  }

  private playerSurfaceMaterial(): PlatformerSurfaceMaterial {
    if (!this.onGround) return 'normal';
    const supportY = Math.floor((this.playerBottom() + 1) / TILE_SIZE);
    const minX = Math.floor((this.px + 1) / TILE_SIZE);
    const maxX = Math.floor((this.px + this.playerW - 1) / TILE_SIZE);
    const supports: TileKind[] = [];
    for (let x = minX; x <= maxX; x++) supports.push(this.grid.kind(x, supportY));
    return platformerSurfaceMaterial(supports);
  }

  private updatePlayer(dt: number, input: InputSnapshot): void {
    const style = this.playStyle;
    const kit = this.kit;
    const combat = kit.combat !== 'stomp';
    this.aimUp = input.UP.held;
    const run = combat ? input.B.held : input.X.held || input.Y.held;
    const target =
      kit.combat === 'melee' && this.meleeT > 0 && this.onGround
        ? 0
        : (input.LEFT.held ? -1 : 0) + (input.RIGHT.held ? 1 : 0);
    const jumpPressed = input.A.pressed || (!combat && input.B.pressed);
    this.shotPoseT = Math.max(0, this.shotPoseT - dt);
    this.meleeT = Math.max(0, this.meleeT - dt);
    this.horizontalIntent = target;
    this.noHorizontalInputT = target === 0 ? this.noHorizontalInputT + dt : 0;
    if (target !== 0 && !(kit.combat === 'melee' && this.meleeT > 0)) this.facing = target;
    if (kit.traversal === 'wallJump') {
      const previous = this.towerMotion ?? { wall: 0, lock: 0, coyote: 0, buffer: 0 };
      const beforeVy = this.pvy;
      this.towerMotion = stepTowerMotion(
        {
          cols: this.grid.cols,
          rows: this.grid.rows,
          tileSize: TILE_SIZE,
          solidityAt: (x, y) => this.solidity(x, y),
        },
        {
          ...previous,
          x: this.px,
          y: this.py,
          w: this.playerW,
          h: this.playerH,
          vx: this.pvx,
          vy: this.pvy,
          grounded: this.onGround,
        },
        {
          direction: target,
          run,
          jump: jumpPressed,
          release: input.A.released || (!combat && input.B.released),
          drop: input.DOWN.held && jumpPressed,
        },
        dt,
        this.ents.filter((entity) => entity.active && entity.type === 'movingPlatform'),
      );
      const moved = this.towerMotion;
      this.px = moved.x;
      this.py = moved.y;
      this.pvx = moved.vx;
      this.pvy = moved.vy;
      this.onGround = moved.grounded;
      this.spinning = false;
      if (moved.vy < beforeVy - 100) this.engine.sfx.play('jump');
    } else {
      const maxSpeed = run ? this.run : this.walk;
      const surface = this.playerSurfaceMaterial();
      this.pvx = stepPlatformerHorizontalVelocity(
        this.pvx,
        target,
        maxSpeed,
        dt,
        this.onGround,
        this.movement,
        surface,
      );

      // jump buffering + coyote time
      this.coyoteT = this.onGround ? FEEL.coyoteMs / 1000 : Math.max(0, this.coyoteT - dt);
      this.jumpBufT = Math.max(0, this.jumpBufT - dt);
      if (jumpPressed) this.jumpBufT = FEEL.jumpBufferMs / 1000;
      if (this.jumpBufT > 0 && (this.onGround || this.coyoteT > 0)) {
        this.pvy = this.jumpV;
        this.spinning = !combat && (input.B.pressed || (input.B.held && !input.A.held));
        this.jumpBufT = 0;
        this.coyoteT = 0;
        this.airJumpUsed = false;
        this.engine.sfx.play('jump');
      } else if (
        this.jumpBufT > 0 &&
        this.power.doubleJump &&
        !this.airJumpUsed &&
        !this.onGround
      ) {
        this.pvy = this.jumpV * 0.92;
        this.airJumpUsed = true;
        this.jumpBufT = 0;
        this.spinning = true;
        this.engine.sfx.play('jump');
        this.engine.particles.burst(this.playerCenterX(), this.playerBottom(), 6, {
          color: this.spec.palette[7],
          gravity: 40,
          speed: 50,
        });
      }
      // variable jump height
      if ((input.A.released || (!combat && input.B.released)) && this.pvy < this.jumpReleaseV) {
        this.pvy = this.jumpReleaseV;
      }

      this.pvy = Math.min(this.maxFall, this.pvy + this.grav * dt);

      const drop = input.DOWN.held && jumpPressed;
      const grid = {
        cols: this.grid.cols,
        rows: this.grid.rows,
        tileSize: TILE_SIZE,
        solidityAt: (x: number, y: number) => this.solidity(x, y),
      };
      const box = this.playerBox();
      const moved = moveAABB(grid, box, this.pvx * dt, this.pvy * dt, { dropThrough: drop });
      this.px = moved.x;
      this.py = moved.y;
      if (moved.hitX) this.pvx = 0;
      if (moved.hitY && this.pvy > 0) this.pvy = 0;
      if (moved.hitY && this.pvy < 0) this.pvy = 0;
      if (!this.onGround && moved.onGround) this.spinning = false;
      this.onGround = moved.onGround;
    }
    if (this.onGround) this.airJumpUsed = false;
    if (this.onGround && target !== 0 && Math.abs(this.pvx) > 8) {
      this.generatedGaitT += dt * generatedPlatformerGaitRate(this.pvx);
    } else {
      this.generatedGaitT = 0;
    }

    // tile interactions
    for (const c of cellsUnder(this.playerBox(), TILE_SIZE)) {
      const k = this.grid.kind(c.tx, c.ty);
      if (k === 'hazard') this.hurtPlayer();
      else if (k === 'checkpoint') {
        if (!this.checkpoint || this.checkpoint.x !== c.tx || this.checkpoint.y !== c.ty) {
          this.checkpoint = { x: c.tx, y: c.ty };
          this.engine.sfx.play('powerup');
          this.engine.particles.burst(c.tx * TILE_SIZE + 8, c.ty * TILE_SIZE + 4, 10, {
            color: this.spec.palette[13],
            gravity: -30,
            speed: 40,
          });
        }
      }
    }

    // exit (levels only)
    if (this.levelIndex < 3) {
      if (aabbOverlap(this.playerBox(), platformerDoorRect(this.level.exit))) {
        this.levelClear();
        return;
      }
    }

    // fell out of the world
    if (this.playerBottom() > this.grid.rows * TILE_SIZE + 48) this.killPlayer();

    this.throwCooldown = Math.max(0, this.throwCooldown - dt);
    if (kit.combat === 'blaster') {
      const canCharge = platformerChargeShot(this.spec) !== 'none';
      if (canCharge && input.X.held)
        this.charge = Math.min(1, this.charge + dt / PLATFORMER_CHARGED_SHOT.chargeSeconds);
      if (canCharge && input.X.released) {
        if (this.charge > 0 && this.throwCooldown === 0)
          this.shootBlaster(input.UP.held, this.charge >= 1);
        this.charge = 0;
      }
      if (
        (input.Y.held || (!canCharge && input.X.held)) &&
        !(canCharge && input.X.held) &&
        this.throwCooldown === 0
      )
        this.shootBlaster(input.UP.held, false);
    } else if (kit.combat === 'melee') {
      if (input.Y.pressed && this.meleeT === 0) {
        this.meleeT = 0.48;
        this.meleeActiveStarted = false;
        this.meleeHits.clear();
        this.meleeFacing = this.facing;
      }
      if (this.meleeActive) {
        if (!this.meleeActiveStarted) this.engine.sfx.play('shoot');
        this.meleeActiveStarted = true;
        this.strike();
      }
    } else if (
      this.power.projectile &&
      (input.X.pressed || input.Y.pressed) &&
      this.throwCooldown <= 0
    ) {
      if (
        this.fireProj(
          this.playerCenterX(),
          this.playerCenterY(),
          this.facing * 230,
          -30,
          true,
          true,
        )
      ) {
        this.throwCooldown = 0.35;
        this.shotPoseT = 0.18;
        this.shotUp = false;
        this.shotFacing = this.facing;
        this.engine.sfx.play('shoot');
      }
    }
    this.hud.mechanic = this.spec.playStyle
      ? {
          label:
            kit.combat === 'blaster'
              ? platformerChargeShot(this.spec) === 'none'
                ? 'BLASTER'
                : kit.traversal === 'wallJump'
                  ? 'WALL / CHARGE'
                  : 'CHARGE'
              : style === 'towerClimber'
                ? this.boss
                  ? 'WALL JUMP'
                  : 'ASCENT'
                : kit.combat === 'melee'
                  ? 'MELEE'
                  : 'ACROBAT',
          value:
            style === 'towerClimber'
              ? this.boss
                ? 'CLIMB TO DODGE'
                : `${Math.max(0, Math.round(((this.level.playerSpawn.y + 1) * TILE_SIZE - this.py - this.playerH) / TILE_SIZE))}m`
              : kit.combat === 'melee'
                ? this.meleeT > 0.36
                  ? 'WINDUP'
                  : this.meleeT > 0.2
                    ? 'STRIKE'
                    : this.meleeT > 0
                      ? 'RECOVERY'
                      : 'READY'
                : kit.combat === 'blaster'
                  ? platformerChargeShot(this.spec) === 'none'
                    ? 'FIRE'
                    : this.charge >= 1
                      ? 'READY'
                      : `${Math.round(this.charge * 100)}%`
                  : 'JUMP / BOUNCE',
          progress:
            kit.combat === 'blaster'
              ? platformerChargeShot(this.spec) === 'none'
                ? undefined
                : this.charge
              : kit.combat === 'melee'
                ? 1 - this.meleeT / 0.48
                : undefined,
        }
      : undefined;

    this.invulnT = Math.max(0, this.invulnT - dt);
  }

  private levelClear(): void {
    this.hud.score += this.spec.scoring.events.levelClear;
    this.engine.sfx.play('win');
    this.phase = 'cards';
    this.engine.music.stopSong();
    this.enterLevel(this.levelIndex + 1);
  }

  private attackLineClear(x: number, y: number): boolean {
    const fromX = this.playerCenterX();
    const fromY = this.playerCenterY();
    const steps = Math.max(1, Math.ceil(Math.hypot(x - fromX, y - fromY) / 4));
    for (let i = 1; i <= steps; i++) {
      if (
        this.solidity(
          Math.floor((fromX + ((x - fromX) * i) / steps) / TILE_SIZE),
          Math.floor((fromY + ((y - fromY) * i) / steps) / TILE_SIZE),
        ) === 'solid'
      )
        return false;
    }
    return true;
  }

  private playerPoseDrawRect(pose: PlatformerPose, flip: boolean, compression: 0 | 1 = 0) {
    const image = this.generatedPlayerPoses[pose]!;
    const size = generatedImageDrawSize(image);
    const rect = generatedPlatformerPlayerDrawRect(
      this.px,
      this.py,
      this.playerW,
      this.playerH,
      size.w,
      size.h,
      compression,
    );
    const drawW = rect.w;
    let heroWorldX = rect.x;
    if (this.kit.traversal === 'wallJump' && !this.onGround) {
      let leftWall = -Infinity,
        rightWall = Infinity;
      for (
        let ty = Math.floor((this.py + 2) / TILE_SIZE);
        ty <= Math.floor((this.py + this.playerH - 2) / TILE_SIZE);
        ty++
      ) {
        for (
          let tx = Math.floor((this.px - drawW) / TILE_SIZE);
          tx <= Math.floor((this.px + this.playerW + drawW) / TILE_SIZE);
          tx++
        ) {
          const kind = this.solidity(tx, ty);
          const height =
            kind === 'solid'
              ? TILE_SIZE
              : kind === 'platform'
                ? TOWER_MOTION.platformSideHeight
                : 0;
          if (!height || ty * TILE_SIZE + height <= this.py + 2) continue;
          if ((tx + 1) * TILE_SIZE <= this.px + 0.01)
            leftWall = Math.max(leftWall, (tx + 1) * TILE_SIZE);
          if (tx * TILE_SIZE >= this.px + this.playerW - 0.01)
            rightWall = Math.min(rightWall, tx * TILE_SIZE);
        }
      }
      for (const platform of this.ents) {
        if (
          !platform.active ||
          platform.type !== 'movingPlatform' ||
          platform.y + platform.h <= this.py + 2 ||
          platform.y >= this.py + this.playerH - 2
        )
          continue;
        if (platform.x + platform.w <= this.px + 0.01)
          leftWall = Math.max(leftWall, platform.x + platform.w);
        if (platform.x >= this.px + this.playerW - 0.01)
          rightWall = Math.min(rightWall, platform.x);
      }
      heroWorldX = platformerWallDrawX(
        heroWorldX,
        drawW,
        this.poseBounds[pose] ?? { left: 0, right: 1 },
        flip,
        leftWall,
        rightWall,
      );
    }
    return { ...rect, x: heroWorldX };
  }

  private blasterMuzzle(up: boolean): { x: number; y: number } {
    const wall = !this.onGround ? (this.towerMotion?.wall ?? 0) : 0;
    const pose: PlatformerPose = wall
      ? up
        ? 'wallShootUp'
        : 'wallShoot'
      : !this.onGround
        ? up
          ? 'jumpShootUp'
          : 'jumpShoot'
        : up
          ? 'shootUp'
          : 'shoot';
    const facing = this.blasterFacing;
    if (!this.generatedPlayerPoses[pose])
      return {
        x: this.playerCenterX() + (up ? 0 : facing * 12),
        y: this.playerCenterY() - (up ? 12 : 0),
      };
    const flip = wall ? wall < 0 : facing < 0;
    const rect = this.playerPoseDrawRect(pose, flip);
    const bounds = this.poseBounds[pose] ?? { left: 0, right: 1 };
    const left = rect.x + rect.w * (flip ? 1 - bounds.right : bounds.left);
    const right = rect.x + rect.w * (flip ? 1 - bounds.left : bounds.right);
    return up
      ? { x: this.playerCenterX() - wall * 6, y: rect.y + 6 }
      : { x: facing < 0 ? left - 1 : right + 1, y: this.playerCenterY() - 3 };
  }

  private shootBlaster(up: boolean, charged: boolean): void {
    const facing = this.blasterFacing;
    const { x, y } = this.blasterMuzzle(up);
    if (!this.attackLineClear(x, y)) return;
    if (
      this.fireProj(
        x,
        y,
        up ? 0 : facing * 280,
        up ? -280 : 0,
        true,
        false,
        charged ? PLATFORMER_CHARGED_SHOT.damage : 1,
      )
    ) {
      this.throwCooldown = charged ? 0.35 : 0.18;
      this.shotPoseT = 0.18;
      this.shotUp = up;
      this.shotFacing = facing;
      this.engine.sfx.play('shoot');
      this.engine.particles.burst(x, y, charged ? 10 : 3, {
        color: this.spec.palette[13],
        speed: charged ? 75 : 30,
        life: 0.16,
        gravity: 0,
      });
    }
  }

  private strike(): void {
    for (const enemy of this.ents) {
      if (!enemy.active || !['walker', 'flyer', 'shooter', 'chaser'].includes(enemy.type)) continue;
      this.tryMeleeHit(enemy);
    }
    if (this.boss) this.tryMeleeHit(this.boss);
  }

  /** Check throughout the active window, including targets that move into it.
   * A descending strike covers the feet; ordinary jumps never gain this hitbox. */
  private tryMeleeHit(enemy: Ent): boolean {
    if (!this.meleeActive || !enemy.active) return false;
    const landing =
      !this.onGround &&
      this.pvy > 0 &&
      this.playerBottom() <= enemy.y + 10 &&
      aabbOverlap(
        { x: this.px - 4, y: this.playerBottom() - 5, w: this.playerW + 8, h: 11 },
        enemy,
      );
    const previouslyHit = this.meleeHits.has(enemy);
    if (
      !previouslyHit &&
      ((!landing && !aabbOverlap(platformerStrikeBox(this.playerBox(), this.meleeFacing), enemy)) ||
        !this.attackLineClear(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2))
    )
      return false;

    if (landing) {
      this.py = Math.min(this.py, enemy.y - this.playerH - 0.01);
      this.pvy = STOMP_BOUNCE;
      this.onGround = false;
      this.airJumpUsed = false;
    }
    // The same swing cannot damage a boss again, or trade contact damage after
    // landing its hit. Boss invulnerability still blocks additional HP damage.
    if (previouslyHit) return true;
    this.meleeHits.add(enemy);
    const b = this.boss;
    if (enemy === b) {
      if (b.invulnT <= 0) {
        b.hp -= 2;
        b.invulnT = 0.3;
        this.hud.score += this.spec.scoring.events.bossHit;
        this.engine.sfx.play('hit');
        this.engine.hitStop(65);
        this.engine.shake(100, 2);
      }
    } else {
      enemy.active = false;
      this.hud.score += this.spec.scoring.events.enemyKill;
      this.burstEnemyDefeat(enemy);
      this.engine.sfx.play('hit');
      this.engine.hitStop(45);
    }
    return true;
  }

  /** Palette-bound energy core and inward sparks; no extra generated asset required. */
  private drawChargeOrb(x: number, y: number, amount: number, time: number, flying: boolean): void {
    drawPixelCharge(
      this.engine.renderer.ctx,
      x,
      y,
      amount,
      time,
      flying,
      platformerChargeShot(this.spec) === 'arcane',
      this.spec.palette,
    );
  }

  private drawSignatureEffects(): void {
    const { renderer: r, camera: cam } = this.engine;
    const x = this.playerCenterX() - cam.x;
    const y = this.playerCenterY() - cam.y;
    const ctx = r.ctx;
    ctx.save();
    ctx.fillStyle = this.spec.palette[14]!;
    if (this.kit.combat === 'blaster' && this.charge > 0) {
      const muzzle = this.blasterMuzzle(this.aimUp);
      this.drawChargeOrb(muzzle.x - cam.x, muzzle.y - cam.y, this.charge, this.animT, false);
    }
    if (this.kit.combat === 'melee' && this.meleeT > 0.2) {
      drawPixelStrike(
        ctx,
        x,
        y,
        this.playerBottom() - cam.y,
        this.meleeFacing,
        this.meleeT,
        !this.onGround && this.pvy > 0,
        this.spec.palette,
      );
    }
    if (this.kit.traversal === 'wallJump' && this.towerMotion?.wall && !this.onGround) {
      const wallX = x + this.towerMotion.wall * (this.playerW / 2 + 1);
      for (let i = 0; i < 3; i++)
        ctx.fillRect(wallX, y + ((this.animT * 35 + i * 7) % 20) - 6, 2, 3);
    }
    ctx.restore();
  }

  private hurtPlayer(): void {
    if (this.invulnT > 0) return;
    if (this.power.shield) {
      this.setAbilityActive('shield', false);
      this.invulnT = 1;
      this.engine.sfx.play('hit');
      this.engine.particles.burst(this.playerCenterX(), this.playerCenterY(), 10, {
        color: this.spec.palette[4],
        gravity: 0,
        speed: 70,
      });
      return;
    }
    this.charge = 0;
    this.meleeT = 0;
    this.hud.health--;
    this.invulnT = FEEL.invulnMs / 1000;
    this.pvy = -170;
    this.pvx = -this.facing * 120;
    this.engine.sfx.play('hurt');
    this.engine.shake(FEEL.screenShakeMs, 3);
    this.engine.hitStop(FEEL.hitStopMs);
    if (this.hud.health <= 0) this.killPlayer();
  }

  private setAbilityActive(kind: PlatformerAbilityKind, active: boolean): void {
    this.power[kind] = active;
    const ability = this.hud.abilities?.find((entry) => entry.kind === kind);
    if (ability) ability.active = active;
  }

  private showAbilityNotice(kind: PlatformerAbilityKind): void {
    const name =
      this.hud.abilities?.find((ability) => ability.kind === kind)?.name ??
      kind.replace(/([a-z])([A-Z])/g, '$1 $2');
    this.abilityNotice = {
      text: `ABILITY: ${name}`.toUpperCase(),
      x: this.playerCenterX(),
      y: this.py,
      elapsed: 0,
    };
  }

  private killPlayer(): void {
    this.hud.lives--;
    this.engine.sfx.play('die');
    this.engine.particles.burst(this.playerCenterX(), this.playerCenterY(), 18, {
      color: this.spec.palette[5],
      speed: 120,
    });
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
      return;
    }
    this.hud.health = this.hud.maxHealth;
    if (this.levelIndex >= 3) {
      // boss retry: reset positions, boss keeps current phase HP
      const b = this.boss;
      this.spawnPlayer(3, this.grid.rows - 3);
      if (b) {
        b.attack = { name: 'idle', t: 0, telegraph: 0 };
        b.x = (this.grid.cols - 6) * TILE_SIZE;
      }
      for (const p of this.projs) p.active = false;
    } else if (this.checkpoint) {
      this.spawnPlayer(this.checkpoint.x, this.checkpoint.y);
    } else {
      this.spawnPlayer(this.level.playerSpawn.x, this.level.playerSpawn.y);
    }
    this.invulnT = 1.5;
  }

  // ---------------------------------------------------------------- enemies

  private shooterInterval(e: Ent): number {
    const interval = (e.props.fireIntervalMs ?? 2200) / 1000 / this.diff.fire;
    return this.spec.encounterVersion === 1 ? Math.max(1.8, interval) : interval;
  }

  private shooterDrawRect(e: Ent) {
    const sprite = this.sprites['shooter']!;
    return this.generatedEnemies?.shooter
      ? generatedPlatformerEnemyDrawRect('shooter', e.x, e.y, e.w, e.h)
      : { x: e.x - (sprite.w - e.w) / 2, y: e.y - (sprite.h - e.h), w: sprite.w, h: sprite.h };
  }

  private updateEntities(dt: number): void {
    const camX = this.engine.camera.x;
    const camY = this.engine.camera.y;
    for (const e of this.ents) {
      if (!e.active) continue;
      // New encounters never bank an unseen turret shot. Re-entering the
      // viewport gives the full interval again, even after camera backtracking.
      if (this.spec.encounterVersion === 1 && e.type === 'shooter') {
        // Use the visible sprite, not its smaller collision box: a clipped
        // head/muzzle must not charge a shot while only the feet are visible.
        const rect = this.shooterDrawRect(e);
        if (
          rect.x < camX ||
          rect.x + rect.w > camX + this.viewW ||
          rect.y < camY ||
          rect.y + rect.h > camY + this.viewH
        ) {
          e.fireT = 0;
          continue;
        }
      }
      // Activate only near the camera (budget); keep updating once seen.
      if (e.x > camX + this.viewW + 64 || e.x < camX - 96) continue;
      if (
        platformerTowerLevel(this.spec, this.level) &&
        (e.y > camY + this.viewH + 64 || e.y + e.h < camY - 64)
      )
        continue;
      e.t += dt;
      switch (e.type) {
        case 'walker':
        case 'chaser': {
          // A chaser above a climb must leave the landing clear until the
          // player approaches its elevation. Keep gravity active while waiting.
          const waitingForApproach =
            this.spec.encounterVersion === 1 &&
            e.type === 'chaser' &&
            Math.abs(this.playerCenterY() - (e.y + e.h / 2)) > TILE_SIZE * 2;
          const speed = waitingForApproach
            ? 0
            : (e.props.speed ?? 1) * (e.type === 'chaser' ? 60 : 34);
          let dir = e.dir;
          if (
            e.type === 'chaser' &&
            Math.abs(this.playerCenterX() - (e.x + e.w / 2)) < TILE_SIZE * 8
          ) {
            dir = Math.sign(this.playerCenterX() - (e.x + e.w / 2)) || dir;
          }
          const range = (e.props.range ?? 6) * TILE_SIZE;
          if (e.type === 'walker' && Math.abs(e.x - e.homeX) > range)
            dir = Math.sign(e.homeX - e.x);
          // turn at walls/edges
          const aheadX = dir > 0 ? e.x + e.w + 1 : e.x - 1;
          const footY = Math.floor((e.y + e.h + 2) / TILE_SIZE);
          const wall =
            this.solidity(
              Math.floor(aheadX / TILE_SIZE),
              Math.floor((e.y + e.h / 2) / TILE_SIZE),
            ) === 'solid';
          const cliff =
            this.solidity(Math.floor(aheadX / TILE_SIZE), footY) === 'empty' &&
            this.solidity(Math.floor(aheadX / TILE_SIZE), footY) !== 'platform';
          if (wall || (e.type === 'walker' && cliff)) dir = -dir;
          e.dir = dir;
          e.vy = Math.min(MAX_FALL, e.vy + GRAV * dt);
          const grid = {
            cols: this.grid.cols,
            rows: this.grid.rows,
            tileSize: TILE_SIZE,
            solidityAt: (x: number, y: number) => this.solidity(x, y),
          };
          const moved = moveAABB(grid, e, dir * speed * dt, e.vy * dt);
          e.x = moved.x;
          e.y = moved.y;
          if (moved.hitY) e.vy = 0;
          e.onGround = moved.onGround;
          break;
        }
        case 'flyer': {
          const amp = (e.props.amplitude ?? 1.5) * TILE_SIZE;
          const period = (e.props.periodMs ?? 2400) / 1000;
          e.x = e.homeX + Math.cos((e.t / period) * Math.PI * 2) * amp * 1.4;
          e.y = e.homeY + Math.sin((e.t / period) * Math.PI * 2) * amp;
          e.dir = Math.cos((e.t / period) * Math.PI * 2 + Math.PI / 2) > 0 ? 1 : -1;
          break;
        }
        case 'shooter': {
          e.fireT += dt;
          const enemyCenterX = e.x + e.w / 2;
          e.dir = platformerShooterFacingDirection(this.playerCenterX(), enemyCenterX, e.dir);
          const interval = this.shooterInterval(e);
          if (
            e.fireT >= interval &&
            Math.abs(this.playerCenterX() - enemyCenterX) < this.viewW * 0.6
          ) {
            e.fireT = 0;
            const muzzle = platformerShooterMuzzlePoint(this.shooterDrawRect(e), e.dir);
            if (e.props.aim === 'arc') {
              this.fireProj(muzzle.x, muzzle.y, e.dir * 80, -190, false, true);
            } else {
              const dx = this.playerCenterX() - muzzle.x;
              const dy = this.playerCenterY() - muzzle.y;
              const len = Math.max(1, Math.hypot(dx, dy));
              this.fireProj(muzzle.x, muzzle.y, (dx / len) * 120, (dy / len) * 120, false, false);
            }
            this.engine.sfx.play('shoot');
          }
          break;
        }
        case 'movingPlatform': {
          const period = (e.props.periodMs ?? 3000) / 1000;
          const ph = (Math.sin((e.t / period) * Math.PI * 2) + 1) / 2;
          const nx = e.homeX + (e.props.dx ?? 3) * TILE_SIZE * ph;
          const ny = e.homeY + (e.props.dy ?? 0) * TILE_SIZE * ph;
          const dxm = nx - e.x;
          const dym = ny - e.y;
          // carry the player when standing on it
          const onTop =
            this.playerBottom() >= e.y - 2 &&
            this.playerBottom() <= e.y + 6 &&
            this.px + this.playerW > e.x &&
            this.px < e.x + e.w &&
            this.pvy >= 0;
          if (onTop) {
            this.px += dxm;
            this.py = e.y + dym - this.playerH - 0.01;
            this.pvy = 0;
            this.onGround = true;
          }
          e.x = nx;
          e.y = ny;
          break;
        }
        case 'spring':
        case 'coin':
        case 'heart':
        case 'powerup':
          break;
      }

      // player interaction
      if (['walker', 'flyer', 'shooter', 'chaser'].includes(e.type) && this.tryMeleeHit(e))
        continue;
      if (!aabbOverlap(this.playerBox(), e)) continue;
      switch (e.type) {
        case 'coin':
          e.active = false;
          this.hud.collectibles = (this.hud.collectibles ?? 0) + 1;
          this.hud.score += this.spec.scoring.events.pickup;
          this.engine.sfx.play('pickup');
          this.engine.particles.burst(e.x + 6, e.y + 6, 5, {
            color: this.spec.palette[13],
            gravity: 60,
            speed: 45,
          });
          break;
        case 'heart':
          e.active = false;
          this.hud.health = Math.min(this.hud.maxHealth, this.hud.health + 1);
          this.hud.score += this.spec.scoring.events.pickup;
          this.engine.sfx.play('pickup');
          this.engine.particles.burst(e.x + 6, e.y + 6, 9, {
            color: this.spec.palette[11],
            gravity: -15,
            speed: 50,
            life: 0.55,
          });
          break;
        case 'powerup': {
          e.active = false;
          const kind = e.props.kind ?? 'doubleJump';
          this.setAbilityActive(kind, true);
          if (kind === 'projectile' && this.kit.combat === 'blaster')
            this.hud.health = Math.min(this.hud.maxHealth, this.hud.health + 1);
          this.showAbilityNotice(kind);
          this.hud.score += this.spec.scoring.events.pickup;
          this.engine.sfx.play('powerup');
          this.engine.particles.burst(e.x + 6, e.y + 6, 14, {
            color: this.spec.palette[7],
            gravity: -20,
            speed: 60,
          });
          break;
        }
        case 'spring':
          if (this.pvy > -40) {
            this.pvy = SPRING_V;
            this.spinning = true;
            e.t = 0.01; // triggers extended anim frame
            this.engine.sfx.play('jump');
            this.engine.particles.burst(e.x + e.w / 2, e.y + 2, 8, {
              color: this.spec.palette[13],
              gravity: 40,
              speed: 55,
              life: 0.4,
              angle: -Math.PI / 2,
              spread: Math.PI / 2,
            });
          }
          break;
        case 'movingPlatform':
          break;
        default: {
          // enemy contact: stomp vs hurt
          const falling = this.pvy > 40;
          const above = this.playerBottom() - e.y < 8;
          if (this.canStomp && falling && above) {
            e.active = false;
            this.pvy = this.spinning ? SPIN_BOUNCE : STOMP_BOUNCE;
            this.hud.score += this.spec.scoring.events.enemyKill;
            this.engine.sfx.play('hit');
            this.engine.hitStop(40);
            this.burstEnemyDefeat(e);
          } else {
            this.hurtPlayer();
          }
        }
      }
    }
  }

  private burstEnemyDefeat(e: Ent): void {
    const x = e.x + e.w / 2;
    const y = e.y + e.h / 2;
    this.engine.particles.burst(x, y, 12, {
      color: this.spec.palette[8],
      speed: 95,
      life: 0.55,
      gravity: 80,
    });
    this.engine.particles.burst(x, y, 5, {
      color: this.spec.palette[13],
      speed: 55,
      life: 0.35,
      size: 3,
      gravity: 20,
    });
  }

  // ------------------------------------------------------------------- boss

  private updateBoss(dt: number): void {
    const b = this.boss!;
    if (!b.active) return;
    b.t += dt;
    b.invulnT = Math.max(0, b.invulnT - dt);
    const phaseCount = this.spec.boss.phases.length;
    const phaseIx = Math.min(phaseCount - 1, Math.floor((1 - b.hp / b.maxHp) * phaseCount));
    if (phaseIx !== b.phaseIx) {
      b.phaseIx = phaseIx;
      this.engine.shake(300, 4);
      this.engine.particles.burst(b.x + b.w / 2, b.y + b.h / 2, 20, {
        color: this.spec.palette[11],
        speed: 130,
      });
    }
    const phase = this.spec.boss.phases[b.phaseIx]!;
    const pacing =
      this.spec.encounterVersion === 1
        ? platformerBossPacing(platformerMechanics(this.spec).combat)
        : null;
    const tempo = pacing ? Math.min(phase.tempo, pacing.maxTempo) : phase.tempo;
    const grid = {
      cols: this.grid.cols,
      rows: this.grid.rows,
      tileSize: TILE_SIZE,
      solidityAt: (x: number, y: number) => this.solidity(x, y),
    };

    const atk = b.attack;
    atk.t += dt;
    switch (atk.name) {
      case 'idle': {
        // face the player; pick next attack after a beat
        b.dir = Math.sign(this.playerCenterX() - (b.x + b.w / 2)) || -1;
        const interval = Math.max(1.6 / tempo, pacing?.recovery ?? 0);
        if (atk.t >= interval) {
          const list = phase.attacks;
          const next = list[Math.floor(this.engine.rng.next() * list.length)]!;
          b.attack = {
            name: next,
            t: 0,
            telegraph: Math.max(0.45 / tempo, pacing?.telegraph ?? 0),
          };
        }
        break;
      }
      case 'stomp': {
        if (atk.t < atk.telegraph) break; // crouch telegraph
        if (b.onGround && atk.t < atk.telegraph + 0.05) {
          b.vy = -360;
          b.vx = Math.sign(this.playerCenterX() - (b.x + b.w / 2)) * 90 * tempo;
          b.onGround = false;
        }
        b.vy = Math.min(MAX_FALL, b.vy + GRAV * dt);
        const moved = moveAABB(grid, b, b.vx * dt, b.vy * dt);
        b.x = moved.x;
        b.y = moved.y;
        if (moved.onGround && b.vy > 0) {
          b.vy = 0;
          b.onGround = true;
          this.engine.shake(250, 4);
          this.engine.sfx.play('hit');
          this.engine.particles.burst(b.x + b.w / 2, b.y + b.h, 18, {
            color: this.spec.palette[8],
            speed: 120,
            life: 0.55,
            gravity: 120,
            angle: -Math.PI / 2,
            spread: Math.PI * 0.85,
          });
          // ground shockwaves both directions
          this.fireProj(b.x + b.w / 2 - 8, b.y + b.h - 8, -110 * tempo, 0, false, false);
          this.fireProj(b.x + b.w / 2 + 8, b.y + b.h - 8, 110 * tempo, 0, false, false);
          b.attack = { name: 'idle', t: 0, telegraph: 0 };
        }
        break;
      }
      case 'charge': {
        if (atk.t < atk.telegraph) break; // flash telegraph
        const speed = 240 * tempo;
        const moved = moveAABB(grid, b, b.dir * speed * dt, 0);
        b.x = moved.x;
        if (moved.hitX || atk.t > atk.telegraph + 2.2) {
          if (moved.hitX) this.engine.shake(200, 3);
          b.attack = { name: 'idle', t: 0, telegraph: 0 };
        }
        break;
      }
      case 'spread': {
        if (atk.t < atk.telegraph) break;
        const n = Math.min(3 + b.phaseIx, pacing?.spreadCount ?? Infinity);
        for (let i = 0; i < n; i++) {
          const a =
            Math.atan2(
              this.playerCenterY() - (b.y + b.h / 2),
              this.playerCenterX() - (b.x + b.w / 2),
            ) +
            ((i - (n - 1) / 2) * Math.PI) / 10;
          this.fireProj(
            b.x + b.w / 2,
            b.y + b.h / 2,
            Math.cos(a) * 130 * tempo,
            Math.sin(a) * 130 * tempo,
            false,
            false,
          );
        }
        this.engine.sfx.play('shoot');
        b.attack = { name: 'idle', t: 0, telegraph: 0 };
        break;
      }
      case 'summon': {
        if (atk.t < atk.telegraph) break;
        const minions = this.ents.filter((e) => e.active && e.type === 'walker').length;
        if (minions < 3) {
          const m = this.makeEnt({
            type: 'walker',
            x: Math.round(b.x / TILE_SIZE) - 2,
            y: Math.round(b.y / TILE_SIZE),
            props: { speed: 1.4 },
          });
          this.ents.push(m);
          this.engine.particles.burst(m.x + 7, m.y + 7, 8, {
            color: this.spec.palette[10],
            speed: 70,
          });
        }
        b.attack = { name: 'idle', t: 0, telegraph: 0 };
        break;
      }
    }

    // gravity when idle-ish
    if (atk.name !== 'stomp') {
      b.vy = Math.min(MAX_FALL, b.vy + GRAV * dt);
      const moved = moveAABB(grid, b, 0, b.vy * dt);
      b.y = moved.y;
      if (moved.onGround) {
        b.vy = 0;
        b.onGround = true;
      }
    }

    // boss vs player
    const pbox = this.playerBox();
    const meleeConnected = this.tryMeleeHit(b);
    if (aabbOverlap(pbox, b) && !meleeConnected) {
      const falling = this.pvy > 40;
      const above = this.playerBottom() - b.y < 10;
      if (this.canStomp && falling && above && b.invulnT <= 0) {
        b.hp--;
        b.invulnT = 0.5;
        this.pvy = this.spinning ? SPIN_BOUNCE : STOMP_BOUNCE;
        this.hud.score += this.spec.scoring.events.bossHit;
        this.engine.sfx.play('hit');
        this.engine.hitStop(70);
        this.engine.shake(150, 2);
        this.engine.particles.burst(b.x + b.w / 2, b.y + 4, 12, {
          color: this.spec.palette[9],
          speed: 100,
        });
      } else if (!this.canStomp || !falling || !above) {
        this.hurtPlayer();
      }
    }
    this.hud.boss = { hp: Math.max(0, b.hp), maxHp: b.maxHp, name: this.spec.boss.name };

    if (b.hp <= 0) {
      b.active = false;
      this.hud.boss = undefined;
      this.hud.score += this.spec.scoring.events.levelClear;
      this.engine.particles.burst(b.x + b.w / 2, b.y + b.h / 2, 40, {
        color: this.spec.palette[12],
        speed: 160,
        life: 1,
      });
      this.engine.shake(500, 5);
      this.engine.music.stopSong();
      this.phase = 'cards';
      this.engine.cards.show(
        this.spec.story.victory.map((line) => ({
          lines: [line],
          portrait: this.engine.portrait,
          artRole: 'victory' as const,
        })),
        () => {
          const par = estimatePlatformerDurationS(this.spec) * 1.35;
          this.result = {
            outcome: 'won',
            score: this.hud.score,
            timeBonusSeconds: Math.max(0, Math.round(par - this.playT)),
          };
        },
      );
    }
  }

  // ------------------------------------------------------------- projectiles

  private fireProj(
    x: number,
    y: number,
    vx: number,
    vy: number,
    friendly: boolean,
    grav: boolean,
    damage = 1,
  ): boolean {
    for (const p of this.projs) {
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.friendly = friendly;
      p.grav = grav;
      p.t = 0;
      p.trailT = 0;
      p.damage = damage;
      p.hitsLeft = friendly && damage > 1 ? PLATFORMER_CHARGED_SHOT.enemyHits : 1;
      return true;
    }
    return false;
  }

  private updateProjectiles(dt: number): void {
    const pbox = this.playerBox();
    for (const p of this.projs) {
      if (!p.active) continue;
      p.t += dt;
      if (p.grav) p.vy += 400 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.trailT -= dt;
      if (p.trailT <= 0) {
        p.trailT = 0.045;
        this.engine.particles.burst(p.x, p.y, 1, {
          color: this.spec.palette[p.friendly ? 13 : 11],
          speed: 12,
          life: 0.24,
          size: 2,
          gravity: 0,
          angle: Math.atan2(-p.vy, -p.vx),
          spread: 0.35,
        });
      }
      if (p.t > 4 || p.y > this.grid.rows * TILE_SIZE + 32) {
        p.active = false;
        continue;
      }
      const radius = p.friendly && p.damage > 1 ? PLATFORMER_CHARGED_SHOT.radius : 3;
      const box = { x: p.x - radius, y: p.y - radius, w: radius * 2, h: radius * 2 };
      if (
        p.friendly &&
        p.damage > 1 &&
        cellsUnder(box, TILE_SIZE).some((cell) => this.solidity(cell.tx, cell.ty) === 'solid')
      ) {
        p.active = false;
        this.engine.particles.burst(p.x, p.y, 10, {
          color: this.spec.palette[5],
          speed: 65,
          life: 0.25,
          gravity: 0,
        });
        continue;
      }
      const tx = Math.floor(p.x / TILE_SIZE);
      const ty = Math.floor(p.y / TILE_SIZE);
      if (this.solidity(tx, ty) === 'solid' && !(p.grav && p.vy < 0)) {
        // ground shockwaves slide along the floor; others break on walls
        if (!(!p.friendly && Math.abs(p.vy) < 1 && this.solidity(tx, ty - 1) === 'empty')) {
          this.engine.particles.burst(p.x, p.y, 4, {
            color: this.spec.palette[p.friendly ? 13 : 11],
            speed: 45,
            life: 0.3,
            gravity: 30,
          });
          p.active = false;
          continue;
        }
      }
      if (p.friendly) {
        for (const e of this.ents) {
          if (
            !e.active ||
            e.type === 'coin' ||
            e.type === 'heart' ||
            e.type === 'powerup' ||
            e.type === 'spring' ||
            e.type === 'movingPlatform'
          )
            continue;
          if (aabbOverlap(box, e)) {
            e.active = false;
            p.hitsLeft--;
            p.active = p.hitsLeft > 0;
            this.hud.score += this.spec.scoring.events.enemyKill;
            this.engine.sfx.play('hit');
            this.burstEnemyDefeat(e);
            if (!p.active) break;
          }
        }
        const b = this.boss;
        if (p.active && b && b.active && b.invulnT <= 0 && aabbOverlap(box, b)) {
          b.hp -= p.damage;
          b.invulnT = 0.3;
          p.active = false;
          this.hud.score += this.spec.scoring.events.bossHit;
          this.engine.sfx.play('hit');
          this.engine.hitStop(55);
          this.engine.shake(110, 2);
          this.engine.particles.burst(p.x, p.y, 14, {
            color: this.spec.palette[13],
            speed: 105,
            life: 0.5,
            gravity: 45,
          });
        }
      } else if (aabbOverlap(box, pbox)) {
        p.active = false;
        this.hurtPlayer();
      }
    }
  }

  // ------------------------------------------------------------------ render

  private drawSurfaceMaterialCues(camX: number, camY: number): void {
    const ctx = this.engine.renderer.ctx;
    const minX = Math.max(0, Math.floor(camX / TILE_SIZE) - 1);
    const maxX = Math.min(this.grid.cols - 1, Math.ceil((camX + this.viewW) / TILE_SIZE) + 1);
    const minY = Math.max(0, Math.floor(camY / TILE_SIZE) - 1);
    const maxY = Math.min(this.grid.rows - 1, Math.ceil((camY + this.viewH) / TILE_SIZE) + 1);
    const iceColor = this.spec.palette[14] ?? '#b8f3ff';
    const conveyorColor = this.spec.palette[13] ?? '#ffd75e';
    const conveyorPhase = Math.floor(this.animT * 8) % 4;
    const sparklePhase = Math.floor(this.animT * 5);

    ctx.save();
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const kind = this.grid.kind(tx, ty);
        if (kind !== 'ice' && kind !== 'conveyorLeft' && kind !== 'conveyorRight') continue;
        // Material semantics only live on exposed tops. If malformed authored
        // data buries a material tile, keep collision correct without drawing
        // a cue through the full-solid cell above it.
        if (isPlatformerFullSolid(this.grid.kind(tx, ty - 1))) continue;
        const x = tx * TILE_SIZE - camX;
        const y = ty * TILE_SIZE - camY;
        if (kind === 'ice') {
          ctx.globalAlpha = 0.78;
          ctx.fillStyle = iceColor;
          ctx.fillRect(Math.round(x), Math.round(y), TILE_SIZE, 2);
          ctx.globalAlpha = 0.42;
          const glintX = 2 + ((tx * 5 + ty * 3 + sparklePhase) % 11);
          ctx.fillRect(Math.round(x + glintX), Math.round(y + 3), 3, 1);
          ctx.fillRect(Math.round(x + glintX + 1), Math.round(y + 2), 1, 3);
          continue;
        }

        const dir = kind === 'conveyorRight' ? 1 : -1;
        ctx.globalAlpha = 0.56;
        ctx.fillStyle = '#111111';
        ctx.fillRect(Math.round(x), Math.round(y + 1), TILE_SIZE, 5);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = conveyorColor;
        for (let slot = 0; slot < 2; slot++) {
          const forward = 3 + slot * 8 + conveyorPhase;
          const center = dir > 0 ? forward : TILE_SIZE - 1 - forward;
          ctx.fillRect(Math.round(x + center - dir * 2), Math.round(y + 3), 3, 1);
          ctx.fillRect(Math.round(x + center), Math.round(y + 2), 1, 3);
        }
      }
    }
    ctx.restore();
  }

  render(): void {
    const r = this.engine.renderer;
    const cam = this.engine.camera;
    r.clear(this.spec.palette[2]);
    if (this.phase === 'cards' && !this.level && !this.boss) return; // pre-first-level intro
    if (!this.grid) return;
    this.backdrop.draw(r.ctx, cam.x, cam.y);
    if (this.generatedBackdropActive) {
      r.rect(
        0,
        0,
        this.viewW,
        this.viewH,
        `rgba(0, 0, 0, ${GENERATED_PLATFORMER_BACKDROP_DIM_ALPHA})`,
      );
    }

    const frameIx = Math.floor(this.animT * 4) % 2;
    drawTileLayer(r, cam, this.grid.cols, this.grid.rows, TILE_SIZE, (tx, ty) => {
      return this.tileCanvasAt(tx, ty, frameIx);
    });
    this.drawSurfaceMaterialCues(cam.x, cam.y);

    if (this.checkpoint) {
      const x = this.checkpoint.x * TILE_SIZE - cam.x;
      const y = this.checkpoint.y * TILE_SIZE - cam.y;
      const auraFrames = this.objectiveAuras.get('checkpoint');
      const aura = auraFrames?.[frameIx % auraFrames.length] ?? auraFrames?.[0];
      if (aura) {
        const phase = (this.animT * 0.9) % 1;
        const waveRadius = 1 + Math.floor(phase * aura.padding);
        r.drawSilhouetteAura(aura, x, y, TILE_SIZE, TILE_SIZE, [
          { radius: 1, alpha: 0.42 },
          { radius: waveRadius, alpha: 0.78 * (1 - phase) },
        ]);
      }
    }

    const decorationFrames = this.tileCanvases.get('decoration');
    if (decorationFrames?.length) {
      for (const decoration of this.decorations) {
        r.drawScaled(
          decorationFrames[frameIx % decorationFrames.length] ?? decorationFrames[0]!,
          decoration.x * TILE_SIZE - cam.x,
          decoration.y * TILE_SIZE - cam.y,
          TILE_SIZE,
          TILE_SIZE,
        );
      }
    }

    // exit marker
    if (this.levelIndex < 3 && this.level) {
      const exitFrames = this.tileCanvases.get('exit')!;
      const door = platformerDoorRect(this.level.exit);
      const distance = Math.abs(this.playerCenterX() - (door.x + door.w / 2));
      const near = distance < TILE_SIZE * 6;
      const auraFrames = this.objectiveAuras.get('exit');
      const aura = auraFrames?.[frameIx % auraFrames.length] ?? auraFrames?.[0];
      if (aura) {
        const phase = (this.animT * (near ? 1.25 : 0.7)) % 1;
        const waveRadius = 1 + Math.floor(phase * aura.padding);
        r.drawSilhouetteAura(aura, door.x - cam.x, door.y - cam.y, door.w, door.h, [
          { radius: 1, alpha: near ? 0.58 : 0.3 },
          { radius: waveRadius, alpha: (near ? 0.9 : 0.58) * (1 - phase) },
        ]);
      }
      r.drawScaled(
        exitFrames[frameIx % exitFrames.length]!,
        door.x - cam.x,
        door.y - cam.y,
        door.w,
        door.h,
      );
    }

    // entities
    for (const e of this.ents) {
      if (!e.active) continue;
      if (e.x - cam.x < -32 || e.x - cam.x > this.viewW + 32) continue;
      const generatedEnemyRole = isGeneratedPlatformerEnemyRole(e.type) ? e.type : null;
      const generatedEnemy = generatedEnemyRole
        ? this.generatedEnemies?.[generatedEnemyRole]
        : null;
      if (
        this.spec.encounterVersion === 1 &&
        e.type === 'shooter' &&
        e.fireT >= this.shooterInterval(e) - 0.55
      ) {
        const muzzle = platformerShooterMuzzlePoint(this.shooterDrawRect(e), e.dir);
        const x = Math.round(muzzle.x - cam.x),
          y = Math.round(muzzle.y - cam.y);
        r.ctx.fillStyle = this.spec.palette[10]!;
        // Sparse pixels keep the warning in the same visual language as attacks.
        const pulse = Math.floor(e.fireT * 12) % 2;
        for (const [dx, dy] of [
          [-3 - pulse, 0],
          [3 + pulse, 0],
          [0, -3 - pulse],
          [0, 3 + pulse],
        ])
          r.ctx.fillRect(x + dx!, y + dy!, 1, 1);
      }
      if (generatedEnemy && generatedEnemyRole) {
        const rect = generatedPlatformerEnemyDrawRect(generatedEnemyRole, e.x, e.y, e.w, e.h);
        r.drawScaledFlipped(
          generatedEnemy,
          rect.x - cam.x,
          rect.y - cam.y,
          rect.w,
          rect.h,
          e.dir > 0,
        );
        continue;
      }
      const generatedPropRole =
        e.type === 'coin'
          ? 'collectible'
          : e.type === 'heart'
            ? 'health'
            : e.type === 'powerup'
              ? generatedAbilityPropRole(e.props.kind ?? 'doubleJump')
              : null;
      const generatedProp = generatedPropRole
        ? (this.generatedProps?.[generatedPropRole] ??
          (e.type === 'powerup' ? this.generatedProps?.powerup : null))
        : null;
      if (generatedProp) {
        const rect = generatedPlatformerPropDrawRect(
          e.type as 'coin' | 'heart' | 'powerup',
          e.x,
          e.y,
          e.w,
          e.h,
          e.t,
        );
        r.drawScaled(generatedProp, rect.x - cam.x, rect.y - cam.y, rect.w, rect.h);
        continue;
      }
      const sprite = this.entitySprite(e);
      if (!sprite) continue;
      const anim = e.type === 'spring' ? (e.t > 0 && e.t < 0.25 ? 'bounce' : 'idle') : 'walk';
      const img = this.engine.sprites.frame(sprite, anim, e.t + this.animT, e.dir > 0);
      if (e.type === 'movingPlatform') {
        const outlined = this.outlinedMovingPlatforms.get(img);
        if (outlined) {
          const rect = platformerMovingPlatformOutlineRect(
            e.x - cam.x,
            e.y - cam.y,
            outlined.padX,
            outlined.padY,
            this.worldScale,
          );
          r.ctx.drawImage(outlined.image, rect.x, rect.y, rect.w, rect.h);
        } else {
          r.drawScaled(
            img,
            e.x - cam.x,
            e.y - cam.y,
            MOVING_PLATFORM_BODY.w,
            MOVING_PLATFORM_BODY.h,
          );
        }
        continue;
      }
      if (e.type === 'spring') {
        // Curated springs are density-four 64px sources, but keep the same
        // 16px world footprint and collider as the original library spring.
        const rect = platformerSpringDrawRect(e.x, e.y, e.w, e.h);
        r.drawScaled(img, rect.x - cam.x, rect.y - cam.y, rect.w, rect.h);
        continue;
      }
      const drawX = e.x - cam.x - (sprite.w - e.w) / 2;
      const drawY = e.y - cam.y - (sprite.h - e.h);
      r.draw(img, drawX, drawY);
    }

    // boss
    const b = this.boss;
    if (b && b.active) {
      const sprite = this.sprites['boss']!;
      const anim =
        b.attack.name !== 'idle' && b.attack.t < b.attack.telegraph + 0.3
          ? 'attack'
          : b.invulnT > 0
            ? 'hurt'
            : 'idle';
      const telegraphing = b.attack.name !== 'idle' && b.attack.t < b.attack.telegraph;
      const bossImage = this.generatedBoss
        ? this.generatedBoss
        : this.engine.sprites.frame(sprite, anim, this.animT);
      const bossRect = this.generatedBoss
        ? generatedPlatformerBossDrawRect(b.x, b.y, b.w, b.h)
        : {
            x: b.x - (sprite.w - b.w) / 2,
            y: b.y - (sprite.h - b.h),
            w: sprite.w,
            h: sprite.h,
          };
      if (telegraphing) {
        const aura = this.bossAuras.get(bossImage) ?? this.bossAuras.values().next().value;
        if (aura) {
          r.drawSilhouetteAura(
            aura,
            bossRect.x - cam.x,
            bossRect.y - cam.y,
            bossRect.w,
            bossRect.h,
            platformerBossTelegraphAuraBands(b.attack.t, b.attack.telegraph, aura.padding),
            b.dir > 0,
          );
        }
      }
      if (this.generatedBoss) {
        // The generated foundation is intentionally one excellent signature
        // silhouette. Movement, telegraphs, particles, hit-stop, and a brief
        // damage flicker provide animation without risking identity drift.
        if (b.invulnT <= 0 || Math.floor(this.animT * 16) % 2 === 0) {
          r.drawScaledFlipped(
            bossImage,
            bossRect.x - cam.x,
            bossRect.y - cam.y,
            bossRect.w,
            bossRect.h,
            b.dir > 0,
          );
        }
      } else {
        r.drawScaledFlipped(
          bossImage,
          bossRect.x - cam.x,
          bossRect.y - cam.y,
          bossRect.w,
          bossRect.h,
          b.dir > 0,
        );
      }
    }

    // projectiles (friendly and hostile can be cast separately)
    for (const p of this.projs) {
      if (!p.active) continue;
      const generatedProjectile =
        this.generatedProps?.[p.friendly ? 'heroProjectile' : 'enemyProjectile'];
      const charged = p.friendly && p.damage > 1;
      if (charged) this.drawChargeOrb(p.x - cam.x, p.y - cam.y, 1, p.t, true);
      if (generatedProjectile) {
        const size = charged ? PLATFORMER_CHARGED_SHOT.drawSize : 8;
        r.drawScaledFlipped(
          generatedProjectile,
          p.x - cam.x - size / 2,
          p.y - cam.y - size / 2,
          size,
          size,
          p.friendly ? p.vx < 0 : p.vx > 0,
        );
        continue;
      }
      const projSprite = this.sprites[p.friendly ? 'projectile' : 'enemy_projectile']!;
      const img = this.engine.sprites.frame(projSprite, 'idle', p.t, p.vx < 0);
      r.draw(img, p.x - cam.x - 4, p.y - cam.y - 4);
    }

    this.drawSignatureEffects();

    // player (invulnerability flicker)
    if (this.invulnT <= 0 || Math.floor(this.animT * 12) % 2 === 0) {
      const hero = this.sprites['hero']!;
      const groundAnim = generatedPlatformerGroundAnimation(
        this.horizontalIntent,
        this.pvx,
        this.noHorizontalInputT,
      );
      const gait =
        this.onGround && groundAnim === 'walk'
          ? generatedPlatformerGaitFrame(this.generatedGaitT)
          : null;
      const base: PlatformerPlayerPose = !this.onGround
        ? 'jump'
        : groundAnim === 'walk'
          ? gait!.pose
          : groundAnim;
      const action = platformerActionFrame({
        grounded: this.onGround,
        base,
        runContact: gait?.pose === 'walk2' ? 2 : 1,
        facing: this.facing,
        wall: this.towerMotion?.wall ?? 0,
        firing: this.charge > 0 || this.shotPoseT > 0,
        aimUp: this.charge > 0 ? this.aimUp : this.shotUp,
        attackFacing:
          this.meleeT > 0
            ? this.meleeFacing
            : this.charge > 0
              ? this.blasterFacing
              : this.shotFacing,
        meleeT: this.meleeT,
      });
      // Old saves keep their original five-frame set. New saves require every action at load.
      const generatedPose = this.generatedPlayerPoses[action.pose] ? action.pose : base;
      const generatedImage = this.generatedPlayerPoses[generatedPose]!;
      let flip = action.pose === generatedPose ? action.flip : base !== 'idle' && this.facing < 0;
      const img: CanvasImageSource = generatedImage;
      if (this.spinning && !this.onGround && generatedPose === 'jump') {
        flip = Math.floor(this.animT * 12) % 2 === 0;
      }
      const generatedRect = this.playerPoseDrawRect(generatedPose, flip, gait?.compression ?? 0);
      const drawW = generatedRect.w;
      const drawH = generatedRect.h;
      const heroWorldX = generatedRect.x;
      const heroWorldY = generatedRect.y;
      const heroX = heroWorldX - cam.x;
      const heroY = heroWorldY - cam.y;
      if (this.power.shield) {
        const breath = (Math.sin(this.animT * 4.5) + 1) / 2;
        r.drawSilhouetteAura(
          this.playerAuras[generatedPose],
          heroX,
          heroY,
          drawW,
          drawH,
          [
            { radius: 1, alpha: 0.76 + breath * 0.14 },
            { radius: 2, alpha: 0.36 + breath * 0.1 },
            { radius: 3, alpha: 0.12 + breath * 0.06 },
          ],
          flip,
        );
      }
      r.drawScaledFlipped(img, heroX, heroY, drawW, drawH, flip);

      // Saved games without the two-tile layout marker retain their compact
      // collider. Keep their old foreground masking for one-tile passages;
      // marked games use the actual 16x32 visual as the collision body.
      if (
        shouldMaskLegacyPlatformerForeground(
          this.spec.playerHeightTiles,
          hero.appliedPresentation,
          this.playerH,
          hero.h,
        )
      ) {
        const minTx = Math.floor(heroWorldX / TILE_SIZE);
        const maxTx = Math.ceil((heroWorldX + drawW) / TILE_SIZE) - 1;
        const minTy = Math.floor(heroWorldY / TILE_SIZE);
        const maxTy = Math.ceil((heroWorldY + drawH) / TILE_SIZE) - 1;
        for (let ty = minTy; ty <= maxTy; ty++) {
          for (let tx = minTx; tx <= maxTx; tx++) {
            const solidity = this.solidity(tx, ty);
            if (solidity !== 'solid' && solidity !== 'platform') continue;
            const tile = this.tileCanvasAt(tx, ty, frameIx);
            if (!tile) continue;
            r.drawScaled(
              tile,
              tx * TILE_SIZE - cam.x,
              ty * TILE_SIZE - cam.y,
              TILE_SIZE,
              TILE_SIZE,
            );
          }
        }
      }
    }

    // Close foreground scenery, drawn in front of gameplay (parallax > 1) for depth.
    this.backdrop.drawForeground(r.ctx, cam.x, cam.y);

    if (this.abilityNotice) {
      const notice = this.abilityNotice;
      const { alpha, rise } = platformerAbilityNoticeFrame(notice.elapsed);
      const scale = 1 / this.worldScale;
      const textWidth = r.textWidth(notice.text, scale);
      const halfWidth = textWidth / 2;
      const x = Math.max(
        halfWidth + 2 / this.worldScale,
        Math.min(this.viewW - halfWidth - 2 / this.worldScale, notice.x - cam.x),
      );
      const y = Math.max(2 / this.worldScale, notice.y - cam.y - (12 + rise) / this.worldScale);
      r.ctx.save();
      r.ctx.globalAlpha = alpha;
      r.text(notice.text, x + 1 / this.worldScale, y + 1 / this.worldScale, r.theme.panelBg, {
        align: 'center',
        scale,
      });
      r.text(notice.text, x, y, r.theme.heading, { align: 'center', scale });
      r.ctx.restore();
    }
  }

  private entitySprite(e: Ent): ResolvedSprite | null {
    switch (e.type) {
      case 'walker':
      case 'flyer':
      case 'shooter':
      case 'chaser':
        return this.sprites[e.type] ?? null;
      case 'coin':
        return this.sprites['coin'] ?? null;
      case 'heart':
        return this.sprites['heart'] ?? null;
      case 'powerup':
        return this.sprites['powerup'] ?? null;
      case 'spring':
        return this.sprites['obj_spring'] ?? null;
      case 'movingPlatform':
        return this.sprites['obj_platform'] ?? null;
    }
  }
}
