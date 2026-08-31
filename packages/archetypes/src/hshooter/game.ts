// Horizontal shooter gameplay (R-Type / Gradius-like). The ship flies left→right
// through an AUTO-SCROLLING TILE STAGE built with the same tile system as the
// platformer: a ceiling and floor plus mid-field obstacle blocks, all SOLID.
// Everything lives in WORLD coordinates with an auto-scrolling camera; the ship
// AND the enemies collide with the terrain via the shared moveAABB (walls block,
// they don't merely damage), and shots die on walls. Reuses the vertical
// shooter's pools / boss engine / charge+bomb, flipped to the horizontal axis.
// Controls: d-pad move, Y fire (hold), X charge shot, B bomb, A speed toggle.
import {
  ConnectedSolidAutotiles,
  LIBRARY,
  createSilhouetteAura,
  drawTileLayer,
  highDensityTileRef,
  isSolidInnerLibraryId,
  makeBackdrop,
  makeGeneratedBackdrop,
  moveAABB,
  pickVariant,
  resolveSolidInnerRef,
  solidNeighborMask,
  terrainAtlasFrame,
  type AABB,
  type Backdrop,
  type BackdropVariant,
  type EngineContext,
  type GameInstance,
  type GameResult,
  type HudState,
  type InputSnapshot,
  type ResolvedSprite,
  type SilhouetteAura,
  type Solidity,
  type TileGrid,
} from '@sparkade/engine';
import {
  FEEL,
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  TILE_SIZE,
  difficultyScale,
  type DifficultyScale,
  type HShooterLevel,
  type HShooterSpec,
  type HShooterTileType,
  type ShooterEnemyType,
  type ShooterBossPattern,
  type ShooterPath,
  type ShooterPickupType,
  type ShooterWave,
} from '@sparkade/shared';
import { corridorSurfaceDecorations } from './decor';
import {
  HSHOOTER_WAVE_SPAWN_MARGIN_PX,
  HSHOOTER_PICKUP_SCREEN_SPEED_PX,
  planHShooterPickupTrajectory,
  planHShooterWavePlacement,
  sampleHShooterPickupTrajectoryY,
  type HShooterPickupTrajectoryPlan,
  type HShooterTurretMount,
} from './encounters';
import { estimateHShooterDurationS } from './lint';
import {
  HSHOOTER_PLAYER_HITBOX,
  HSHOOTER_PLAYER_MAX_SCREEN_X as PLAYER_MAX_SX,
  HSHOOTER_PLAYER_MIN_SCREEN_X as PLAYER_MIN_SX,
  HSHOOTER_PLAYER_START_SCREEN_X as PLAYER_START_SX,
  HSHOOTER_PLAYER_SPEED_HIGH as SPEED_HIGH,
  HSHOOTER_PLAYER_SPEED_LOW as SPEED_LOW,
} from './traversal';

const W = INTERNAL_WIDTH;
const H = INTERNAL_HEIGHT;
const TILE = TILE_SIZE;
const PW = HSHOOTER_PLAYER_HITBOX.w;
const PH = HSHOOTER_PLAYER_HITBOX.h;
const FIRE_RATE = 8;
const RAPID_RATE = 12;
const PLAYER_SHOT_SPEED = 340;
const MAX_NORMAL_SHOTS = 6;
const CHARGE_TIME = 0.8;
const CHARGE_SHOT_SPEED = 320;
const CHARGE_DMG = 4;
const ENEMY_SHOT_SPEED = 110;
const BOSS_SHOT_SPEED = 90;
const START_BOMBS = 2;
const MAX_BOMBS = 4;
const BOMB_DMG = 3;
const POD_FIRE_INTERVAL = 1.6;
const BOSS_ENTRANCE_S = 2;
const BOSS_DEFEAT_DURATION_S = 1.55;
const BOSS_DEFEAT_BURST_INTERVAL_S = 0.16;
const BOSS_DEFEAT_FINALE_LEAD_S = 0.3;
const BOSS_SX = W - 70;
const KAMIKAZE_TRIGGER_SX = W - 150;
const ECOLL = 5; // enemy terrain half-box
const ST_APPROACH = 0;
const ST_HOLD = 1;
const ST_LEAVE = 2;
const ST_HOMING = 3;
const HSHOOTER_CHARGE_STREAM_COUNT = 14;

interface HShooterChargeStreamPath {
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
}

export const HSHOOTER_GENERATED_BACKDROP_DIM_ALPHA = 0.2;
export const HSHOOTER_PROCEDURAL_BACKDROP_ALPHA = 0.3;
export const GENERATED_HSHOOTER_PLAYER_DRAW_SIZE = { w: 30, h: 20 } as const;
export const GENERATED_HSHOOTER_BOSS_DRAW_SIZE = { w: 72, h: 48 } as const;
export const GENERATED_HSHOOTER_BOSS_HIT_SIZE = { w: 52, h: 36 } as const;
export const GENERATED_HSHOOTER_ENEMY_ATLAS_CELL_SIZE = 96;
export const GENERATED_HSHOOTER_ENEMY_ROLES = [
  'popcorn',
  'weaver',
  'tank',
  'turret',
  'kamikaze',
] as const satisfies readonly ShooterEnemyType[];
export const GENERATED_HSHOOTER_ENEMY_DRAW_SIZE: Record<
  ShooterEnemyType,
  { w: number; h: number }
> = {
  popcorn: { w: 26, h: 18 },
  weaver: { w: 32, h: 20 },
  tank: { w: 42, h: 28 },
  turret: { w: 30, h: 24 },
  kamikaze: { w: 28, h: 18 },
};
export const GENERATED_HSHOOTER_ENEMY_HIT_SIZE: Record<ShooterEnemyType, { w: number; h: number }> =
  {
    popcorn: { w: 16, h: 12 },
    weaver: { w: 19, h: 13 },
    tank: { w: 29, h: 19 },
    turret: { w: 20, h: 16 },
    kamikaze: { w: 17, h: 11 },
  };

export interface HShooterCraftAnchors {
  rear: { x: number; y: number };
  muzzle: { x: number; y: number };
}

type TileKind = HShooterTileType;

interface Foe {
  active: boolean;
  type: ShooterEnemyType;
  path: ShooterPath;
  x: number; // WORLD center
  y: number;
  vx: number; // WORLD velocity
  vy: number;
  avoidVy: number; // terrain-avoidance steer (added on top of the pattern)
  stuckT: number; // time wedged against a wall (crash fallback)
  baseY: number;
  t: number;
  hp: number;
  fireRate: number;
  fireT: number;
  state: number;
  holdSX: number; // screen-x to park at (hold path)
  holdT: number;
  holdDur: number;
  phase: number;
  speedMul: number;
  flashT: number;
  chargeSeq: number;
  mount: HShooterTurretMount | null;
}

interface PShot {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  pierce: boolean;
  seq: number;
  t: number;
}

interface EShot {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  t: number;
}

interface Pick {
  active: boolean;
  type: ShooterPickupType;
  x: number;
  y: number;
  trajectory: HShooterPickupTrajectoryPlan | null;
  t: number;
}

interface Pod {
  alive: boolean;
  hp: number;
  ox: number;
  oy: number;
  fireT: number;
  flashT: number;
  chargeSeq: number;
}

interface BossState {
  active: boolean;
  x: number; // WORLD center
  y: number;
  t: number;
  hp: number;
  maxHp: number;
  phaseIx: number;
  entranceT: number;
  fireT: number;
  burstLeft: number;
  burstT: number;
  spiralAngle: number;
  flashT: number;
  chargeSeq: number;
  telegraphPrepared: boolean;
  telegraphAimAngle: number;
  telegraphTargetX: number;
  telegraphTargetY: number;
  telegraphGapY: number;
}

const ROLE_FALLBACK: Record<string, string> = {
  hero: 'lib:ship_dart',
  popcorn: 'lib:foe_popcorn',
  weaver: 'lib:foe_weaver',
  tank: 'lib:foe_tank',
  turret: 'lib:foe_turret',
  pod: 'lib:foe_turret',
  kamikaze: 'lib:foe_kamikaze',
  boss: 'lib:boss_leviathan',
  projectile: 'lib:proj_bolt',
  enemy_shot: 'lib:proj_pellet',
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function chargeStreamNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function fallbackHShooterCraftAnchors(): HShooterCraftAnchors {
  return {
    rear: { x: -GENERATED_HSHOOTER_PLAYER_DRAW_SIZE.w / 2, y: 0 },
    muzzle: { x: GENERATED_HSHOOTER_PLAYER_DRAW_SIZE.w / 2, y: 0 },
  };
}

/** Find effect attachment points from the actual opaque craft silhouette.
 * Coordinates are returned in the centered 30x20 gameplay draw footprint. */
export function hshooterCraftAnchorsFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): HShooterCraftAnchors {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (w === 0 || h === 0 || rgba.length < w * h * 4) return fallbackHShooterCraftAnchors();

  const columnCounts = new Uint16Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3]! >= 48) columnCounts[x] = columnCounts[x]! + 1;
    }
  }
  const stableColumnPixels = Math.max(2, Math.ceil(h * 0.02));
  let minX = columnCounts.findIndex((count) => count >= stableColumnPixels);
  let maxX = -1;
  for (let x = w - 1; x >= 0; x--) {
    if (columnCounts[x]! >= stableColumnPixels) {
      maxX = x;
      break;
    }
  }
  if (minX < 0 || maxX < 0) {
    minX = columnCounts.findIndex((count) => count > 0);
    for (let x = w - 1; x >= 0; x--) {
      if (columnCounts[x]! > 0) {
        maxX = x;
        break;
      }
    }
  }
  if (minX < 0 || maxX < 0) return fallbackHShooterCraftAnchors();

  const edgeBand = Math.max(1, Math.round(w * 0.04));
  const averageEdgeY = (fromX: number, toX: number): number => {
    let totalY = 0;
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = Math.max(0, fromX); x <= Math.min(w - 1, toX); x++) {
        if (rgba[(y * w + x) * 4 + 3]! < 48) continue;
        totalY += y + 0.5;
        count++;
      }
    }
    return count > 0 ? totalY / count : h / 2;
  };
  const localX = (x: number) => ((x + 0.5) / w - 0.5) * GENERATED_HSHOOTER_PLAYER_DRAW_SIZE.w;
  const localY = (y: number) => (y / h - 0.5) * GENERATED_HSHOOTER_PLAYER_DRAW_SIZE.h;
  return {
    rear: {
      x: localX(minX),
      y: localY(averageEdgeY(minX, minX + edgeBand)),
    },
    muzzle: {
      x: localX(maxX),
      y: localY(averageEdgeY(maxX - edgeBand, maxX)),
    },
  };
}

function generatedHShooterCraftAnchors(source: CanvasImageSource): HShooterCraftAnchors {
  try {
    const sized = source as {
      naturalWidth?: number;
      naturalHeight?: number;
      videoWidth?: number;
      videoHeight?: number;
      width?: number;
      height?: number;
    };
    const width = Math.round(sized.naturalWidth ?? sized.videoWidth ?? sized.width ?? 0);
    const height = Math.round(sized.naturalHeight ?? sized.videoHeight ?? sized.height ?? 0);
    if (width < 1 || height < 1) return fallbackHShooterCraftAnchors();
    const raster = document.createElement('canvas');
    raster.width = width;
    raster.height = height;
    const ctx = raster.getContext('2d');
    if (!ctx) return fallbackHShooterCraftAnchors();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, width, height);
    return hshooterCraftAnchorsFromRgba(ctx.getImageData(0, 0, width, height).data, width, height);
  } catch {
    return fallbackHShooterCraftAnchors();
  }
}

export function hshooterEnemyTravelRotation(vx: number, vy: number): number {
  if (Math.hypot(vx, vy) < 0.01) return 0;
  let rotation = Math.atan2(vy, vx) - Math.PI;
  while (rotation > Math.PI) rotation -= Math.PI * 2;
  while (rotation < -Math.PI) rotation += Math.PI * 2;
  return rotation;
}

export function hshooterBossAttackCadenceS(
  pattern: ShooterBossPattern,
  fireIntervalMs: number,
): number {
  const intervalS = Math.max(0.12, fireIntervalMs / 1000);
  return pattern === 'spiral' ? intervalS / 3 : intervalS;
}

export function hshooterBossTelegraphDurationS(
  pattern: ShooterBossPattern,
  fireIntervalMs: number,
): number {
  const cadenceS = hshooterBossAttackCadenceS(pattern, fireIntervalMs);
  const preferred = pattern === 'walls' ? 0.58 : pattern === 'aimed' ? 0.48 : 0.4;
  return Math.min(cadenceS * 0.72, Math.max(0.14, preferred));
}

export function hshooterBossTelegraphProgress(
  fireT: number,
  pattern: ShooterBossPattern,
  fireIntervalMs: number,
): number {
  const cadenceS = hshooterBossAttackCadenceS(pattern, fireIntervalMs);
  const telegraphS = hshooterBossTelegraphDurationS(pattern, fireIntervalMs);
  return clamp((fireT - (cadenceS - telegraphS)) / Math.max(0.001, telegraphS), 0, 1);
}

function legacyHitDimensions(sprite: ResolvedSprite): { w: number; h: number } {
  return { w: Math.max(8, sprite.w - 4), h: Math.max(8, sprite.h - 4) };
}

export function usesDetailedHShooterPresentation(
  artDensity: HShooterSpec['hshooterArtDensity'],
): boolean {
  return artDensity === 'detailed';
}

/** The generated panorama completes exactly one edge-to-edge travel over the
 * authored autoscroll duration. Procedural parallax continues after it clamps. */
export function hshooterBackdropPanDistance(level: { scroll: number; durationS: number }): number {
  return Math.max(1, level.scroll * level.durationS);
}

export function generatedHShooterBossDrawRect(
  centerX: number,
  centerY: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: centerX - GENERATED_HSHOOTER_BOSS_DRAW_SIZE.w / 2,
    y: centerY - GENERATED_HSHOOTER_BOSS_DRAW_SIZE.h / 2,
    ...GENERATED_HSHOOTER_BOSS_DRAW_SIZE,
  };
}

export function generatedHShooterBossMuzzleX(centerX: number): number {
  return centerX - GENERATED_HSHOOTER_BOSS_DRAW_SIZE.w / 2 + 4;
}

export function generatedHShooterEnemyAtlasX(role: ShooterEnemyType): number {
  return GENERATED_HSHOOTER_ENEMY_ROLES.indexOf(role) * GENERATED_HSHOOTER_ENEMY_ATLAS_CELL_SIZE;
}

/** Top-down shooter art is rotated clockwise into the horizontal flight plane. */
export function horizontalSpriteDimensions(
  sprite: { w: number; h: number },
  inset = 0,
): { w: number; h: number } {
  return {
    w: Math.max(8, sprite.h - inset),
    h: Math.max(8, sprite.w - inset),
  };
}

export function createHShooterGame(engine: EngineContext, spec: HShooterSpec): GameInstance {
  return new HShooterGame(engine, spec);
}

class HShooterGame implements GameInstance {
  hud: HudState = { score: 0, lives: 3, health: 3, maxHealth: 3, keys: 0, bombs: START_BOMBS };
  result: GameResult | null = null;

  private phase: 'cards' | 'play' = 'cards';
  private levelIndex = 0;
  private level!: HShooterLevel;
  private backdrop!: Backdrop;
  private generatedBackdrop: Backdrop | null = null;
  private bgVariant: BackdropVariant;
  private scrollX = 0;
  private clock = 0;
  private lastWaveT = 0;
  private waveFired: boolean[] = [];
  private pickupFired: boolean[] = [];

  // tile stage
  private grid: { cols: number; rows: number; kind(x: number, y: number): TileKind } = {
    cols: 0,
    rows: 0,
    kind: () => 'empty',
  };
  private tileFrames: Record<string, readonly CanvasImageSource[]> = {};
  private solidAutotiles: ConnectedSolidAutotiles | null = null;
  private highDensitySolidTerrain = false;
  private decorations: Array<{ x: number; y: number }> = [];

  private foes: Foe[] = Array.from({ length: 24 }, () => ({
    active: false,
    type: 'popcorn',
    path: 'dive',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    avoidVy: 0,
    stuckT: 0,
    baseY: 0,
    t: 0,
    hp: 1,
    fireRate: 0,
    fireT: 0,
    state: ST_APPROACH,
    holdSX: 0,
    holdT: 0,
    holdDur: 0,
    phase: 0,
    speedMul: 1,
    flashT: 0,
    chargeSeq: 0,
    mount: null,
  }));
  private pshots: PShot[] = Array.from({ length: 8 }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    dmg: 1,
    pierce: false,
    seq: 0,
    t: 0,
  }));
  private eshots: EShot[] = Array.from({ length: 48 }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    dmg: 1,
    t: 0,
  }));
  private picks: Pick[] = Array.from({ length: 8 }, () => ({
    active: false,
    type: 'spread',
    x: 0,
    y: 0,
    trajectory: null,
    t: 0,
  }));

  // player (WORLD center)
  private px = 60;
  private py = H / 2;
  private pvy = 0;
  private fast = false;
  private fireCd = 0;
  private chargeT = 0;
  private chargeReady = false;
  private glowT = 0;
  private thrustT = 0;
  private invulnT = 0;
  private spread = false;
  private rapid = false;
  private shieldUp = false;
  private chargeSeqCounter = 0;
  private animT = 0;
  private playT = 0;

  private boss: BossState | null = null;
  private pods: Pod[] = [];
  private bossDefeatT = 0;
  private bossDefeatBurstT = 0;
  private bossDefeatBurstIndex = 0;
  private bossDefeatFinaleFired = false;

  private sprites: Record<string, ResolvedSprite> = {};
  private pickupSprites: Record<ShooterPickupType, ResolvedSprite>;
  private detailedPresentation: boolean;
  private generatedPlayerCraft: CanvasImageSource;
  private playerCraftAnchors: HShooterCraftAnchors;
  private playerShieldAura: SilhouetteAura;
  private generatedBoss: CanvasImageSource | null;
  private generatedEnemyAtlas: CanvasImageSource | null;
  private generatedBackdrops: Readonly<Record<string, CanvasImageSource>> | null;
  private foeDims: Record<ShooterEnemyType, { w: number; h: number }>;
  private bossDims: { w: number; h: number };
  private bossVisualDims: { w: number; h: number };
  private diff!: DifficultyScale;
  private pbox: AABB = { x: 0, y: 0, w: PW, h: PH };
  private ebox: AABB = { x: 0, y: 0, w: ECOLL * 2, h: ECOLL * 2 };
  private pkbox: AABB = { x: 0, y: 0, w: 12, h: 12 };

  constructor(
    private engine: EngineContext,
    private spec: HShooterSpec,
  ) {
    this.diff = difficultyScale(this.spec.difficulty);
    this.detailedPresentation = usesDetailedHShooterPresentation(this.spec.hshooterArtDensity);
    if (!engine.hshooterPlayerCraft) {
      throw new Error('H-scroll games require a generated player craft');
    }
    this.generatedPlayerCraft = engine.hshooterPlayerCraft;
    this.playerCraftAnchors = generatedHShooterCraftAnchors(this.generatedPlayerCraft);
    this.playerShieldAura = createSilhouetteAura(
      this.generatedPlayerCraft,
      GENERATED_HSHOOTER_PLAYER_DRAW_SIZE.w,
      GENERATED_HSHOOTER_PLAYER_DRAW_SIZE.h,
      this.spec.palette[14] ?? '#94e7ff',
      4,
    );
    this.generatedBoss = engine.hshooterBoss;
    this.generatedEnemyAtlas = engine.hshooterEnemyAtlas;
    if (spec.hshooterEnemyArtVersion === 1 && !this.generatedEnemyAtlas) {
      throw new Error('This H-scroll game requires its complete generated enemy cast');
    }
    this.generatedBackdrops = engine.hshooterBackdrops;
    this.bgVariant = pickVariant(this.spec.palette, this.spec.seed, this.spec.backdrop);
    for (const role of Object.keys(ROLE_FALLBACK)) {
      const fallback = ROLE_FALLBACK[role]!;
      this.sprites[role] =
        role === 'hero'
          ? engine.sprites.byRef(fallback, false)
          : engine.sprites.byRole(role, fallback);
    }
    this.pickupSprites = {
      spread: engine.sprites.byRole('pickup_spread', 'lib:pickup_spread'),
      rapid: engine.sprites.byRole('pickup_rapid', 'lib:pickup_rapid'),
      shield: engine.sprites.byRole('pickup_shield', 'lib:pickup_shield'),
      bomb: engine.sprites.byRole('pickup_bomb', 'lib:pickup_bomb'),
    };
    const foeDimensions = (sprite: ResolvedSprite) =>
      this.detailedPresentation
        ? horizontalSpriteDimensions(sprite, 4)
        : legacyHitDimensions(sprite);
    this.foeDims = this.generatedEnemyAtlas
      ? GENERATED_HSHOOTER_ENEMY_HIT_SIZE
      : {
          popcorn: foeDimensions(this.sprites['popcorn']!),
          weaver: foeDimensions(this.sprites['weaver']!),
          tank: foeDimensions(this.sprites['tank']!),
          turret: foeDimensions(this.sprites['turret']!),
          kamikaze: foeDimensions(this.sprites['kamikaze']!),
        };
    const bossSprite = this.sprites['boss']!;
    this.bossDims = this.generatedBoss
      ? GENERATED_HSHOOTER_BOSS_HIT_SIZE
      : this.detailedPresentation
        ? horizontalSpriteDimensions(bossSprite, 8)
        : { w: bossSprite.w - 8, h: bossSprite.h - 8 };
    this.bossVisualDims = this.generatedBoss
      ? GENERATED_HSHOOTER_BOSS_DRAW_SIZE
      : this.detailedPresentation
        ? horizontalSpriteDimensions(bossSprite)
        : { w: bossSprite.w, h: bossSprite.h };
  }

  start(): void {
    const cards = this.spec.story.intro.map((line) => ({
      title: this.spec.meta.title,
      lines: [line],
      portrait: this.engine.portrait,
      artRole: 'intro' as const,
    }));
    this.engine.cards.show(cards, () => this.enterLevel(0));
  }

  restart(): void {
    if (this.isBoss()) this.enterBoss(false);
    else this.loadLevel(this.levelIndex);
    this.hud.health = this.hud.maxHealth;
  }

  dispose(): void {
    this.engine.music.stopSong();
  }

  private isBoss(): boolean {
    return this.levelIndex >= this.spec.levels.length;
  }

  // ---------------------------------------------------------- tile stage

  private buildGrid(tiles: string[], legend: Record<string, TileKind>): void {
    tiles = tiles ?? []; // tolerate a malformed/old spec rather than freeze
    legend = legend ?? {};
    const rows = tiles.length;
    const cols = tiles[0]?.length ?? 0;
    const kinds: TileKind[] = new Array(cols * rows).fill('empty');
    for (let y = 0; y < rows; y++) {
      const row = tiles[y] ?? '';
      for (let x = 0; x < cols; x++) {
        const ch = row[x] ?? '.';
        kinds[y * cols + x] = ch === '.' ? 'empty' : (legend[ch] ?? 'empty');
      }
    }
    this.grid = {
      cols,
      rows,
      kind: (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? 'empty' : kinds[y * cols + x]!),
    };
    const art: Record<string, string> = {
      solid: 'lib:tile_solid',
      hazard: 'lib:tile_hazard',
      decoration: 'lib:tile_deco',
    };
    this.tileFrames = {};
    this.solidAutotiles = null;
    this.highDensitySolidTerrain = false;

    // Omitted art density is the compatibility path for published games. New
    // specs opt into the source-authored terrain resolver during assembly.
    if (this.spec.hshooterArtDensity !== 'detailed') {
      for (const [kind, ref] of Object.entries(art)) {
        this.tileFrames[kind] = this.engine.sprites.byRole(ref.slice(4), ref, {
          bob: false,
        }).frames;
      }
      return;
    }

    for (const [kind, ref] of Object.entries(art)) {
      if (kind === 'solid') continue;
      const assigned = this.spec.sprites.assign[ref.slice(4)] ?? ref;
      this.tileFrames[kind] = this.engine.sprites.byRef(highDensityTileRef(assigned), false, {
        bob: false,
      }).frames;
    }

    const capRef = this.spec.sprites.assign['tile_solid'] ?? 'lib:tile_solid';
    const cap = this.engine.sprites.byRef(highDensityTileRef(capRef), false, { bob: false });
    const refExists = (ref: string): boolean => {
      const [kind, id] = ref.split(':', 2);
      if (!id) return false;
      if (kind === 'lib') {
        const entry = LIBRARY[id];
        return (
          isSolidInnerLibraryId(id) &&
          entry !== undefined &&
          entry.frames.every((frame) => frame.w === TILE && frame.h === TILE)
        );
      }
      if (kind === 'custom') {
        const sprite = this.spec.sprites.custom[id];
        const rowsAreOpaque = (spriteRows: readonly string[]): boolean =>
          spriteRows.length === TILE &&
          spriteRows.every((row) => row.length === TILE && !/[.0]/.test(row));
        return (
          sprite?.w === TILE &&
          sprite.h === TILE &&
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
      ? this.engine.sprites.byRef(highDensityTileRef(innerRef), false, { bob: false })
      : cap;
    this.highDensitySolidTerrain =
      (cap.frames[0]?.width ?? TILE) > TILE && (inner.frames[0]?.width ?? TILE) > TILE;
    this.solidAutotiles = new ConnectedSolidAutotiles(
      cap.frames,
      inner.frames,
      this.spec.palette[1] ?? '#111111',
    );
  }

  private tileCanvasAt(tx: number, ty: number, frameIx: number): CanvasImageSource | null {
    const kind = this.grid.kind(tx, ty);
    if (kind === 'empty') return null;
    if (kind === 'solid' && this.solidAutotiles) {
      const mask = solidNeighborMask((x, y) => this.grid.kind(x, y) === 'solid', tx, ty);
      return this.solidAutotiles.frame(
        mask,
        this.highDensitySolidTerrain ? terrainAtlasFrame(tx, ty) : frameIx,
      );
    }
    const frames = this.tileFrames[kind];
    if (!frames?.length) return null;
    return frames[frameIx % frames.length] ?? frames[0] ?? null;
  }

  private solidity(tx: number, ty: number): Solidity {
    return this.grid.kind(tx, ty) === 'solid' ? 'solid' : 'empty';
  }

  private tileGrid(): TileGrid {
    return {
      cols: this.grid.cols,
      rows: this.grid.rows,
      tileSize: TILE,
      solidityAt: (x, y) => this.solidity(x, y),
    };
  }

  private solidAtWorld(wx: number, wy: number): boolean {
    return this.grid.kind(Math.floor(wx / TILE), Math.floor(wy / TILE)) === 'solid';
  }

  /** Do the ship's (slightly inset) box corners sit inside solid terrain? True
   *  only when it's been forced into a wall — normal flush contact leaves a gap. */
  private boxOverlapsSolid(cx: number, cy: number): boolean {
    for (const ox of [-(PW / 2) + 1, PW / 2 - 1]) {
      for (const oy of [-(PH / 2) + 1, PH / 2 - 1]) {
        if (this.grid.kind(Math.floor((cx + ox) / TILE), Math.floor((cy + oy) / TILE)) === 'solid')
          return true;
      }
    }
    return false;
  }

  /** Nearest open world-y at a world-x, searching out from a preferred y. */
  private openYAt(wx: number, preferY: number): number {
    const tx = Math.floor(wx / TILE);
    const ty = clamp(Math.floor(preferY / TILE), 0, this.grid.rows - 1);
    if (this.grid.kind(tx, ty) !== 'solid') return ty * TILE + TILE / 2;
    for (let d = 1; d < this.grid.rows; d++) {
      if (this.grid.kind(tx, ty - d) !== 'solid') return (ty - d) * TILE + TILE / 2;
      if (this.grid.kind(tx, ty + d) !== 'solid') return (ty + d) * TILE + TILE / 2;
    }
    return preferY;
  }

  // -------------------------------------------------------------- level flow

  private enterLevel(ix: number): void {
    this.levelIndex = ix;
    if (ix >= this.spec.levels.length) {
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
    this.backdrop = makeBackdrop(this.spec.palette, this.spec.seed + ix * 101, this.bgVariant);
    const generatedBackdrop = this.generatedBackdrops?.[`level${ix + 1}`];
    this.generatedBackdrop = generatedBackdrop
      ? makeGeneratedBackdrop(generatedBackdrop, W, H, {
          panAcrossDistance: hshooterBackdropPanDistance(level),
        })
      : null;
    this.buildGrid(level.tiles, level.legend);
    this.decorations =
      this.spec.hshooterArtDensity === 'detailed'
        ? corridorSurfaceDecorations(level, this.spec.seed + ix * 101 + 0xc0771d0)
        : [];
    this.scrollX = 0;
    this.clock = 0;
    this.lastWaveT = 0;
    this.waveFired = level.waves.map(() => false);
    this.pickupFired = level.pickups.map(() => false);
    this.clearPools();
    this.boss = null;
    this.pods = [];
    this.hud.boss = undefined;
    this.spawnPlayer();
    this.engine.camera.snap(0, 0);
  }

  private enterBoss(withCard: boolean): void {
    this.levelIndex = this.spec.levels.length;
    const build = () => {
      this.buildBoss();
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

  private buildBoss(): void {
    // Open arena for the boss: a screen-sized grid of empty cells (NOT a 0-col
    // grid — moveAABB treats every tx >= cols as a solid wall, which would box
    // the ship in place).
    this.scrollX = 0;
    const cols = Math.ceil(W / TILE) + 4;
    const rows = Math.ceil(H / TILE);
    this.buildGrid(
      Array.from({ length: rows }, () => '.'.repeat(cols)),
      {},
    );
    this.decorations = [];
    this.backdrop = makeBackdrop(this.spec.palette, this.spec.seed + 777, this.bgVariant);
    const generatedBackdrop = this.generatedBackdrops?.boss;
    this.generatedBackdrop = generatedBackdrop
      ? makeGeneratedBackdrop(generatedBackdrop, W, H)
      : null;
    this.clearPools();
    this.spawnPlayer();
    const b = this.spec.boss;
    this.boss = {
      active: true,
      x: W + 60,
      y: H / 2,
      t: 0,
      hp: b.hp,
      maxHp: b.hp,
      phaseIx: 0,
      entranceT: 0,
      fireT: 0,
      burstLeft: 0,
      burstT: 0,
      spiralAngle: 0,
      flashT: 0,
      chargeSeq: 0,
      telegraphPrepared: false,
      telegraphAimAngle: Math.PI,
      telegraphTargetX: this.px,
      telegraphTargetY: this.py,
      telegraphGapY: H / 2 - 24,
    };
    this.bossDefeatT = 0;
    this.bossDefeatBurstT = 0;
    this.bossDefeatBurstIndex = 0;
    this.bossDefeatFinaleFired = false;
    this.pods = [];
    for (let i = 0; i < b.pods; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const rank = Math.floor(i / 2) + 1;
      this.pods.push({
        alive: true,
        hp: b.podHp,
        ox: -8 - (rank - 1) * 24,
        oy: side * (this.bossVisualDims.h / 2 + 6 + (rank - 1) * 12),
        fireT: i * 0.4,
        flashT: 0,
        chargeSeq: 0,
      });
    }
    this.hud.boss = { hp: b.hp, maxHp: b.hp, name: b.name };
    this.engine.camera.snap(0, 0);
  }

  private clearPools(): void {
    for (const f of this.foes) f.active = false;
    for (const p of this.pshots) p.active = false;
    for (const s of this.eshots) s.active = false;
    for (const p of this.picks) p.active = false;
  }

  private spawnPlayer(): void {
    this.px = this.scrollX + PLAYER_START_SX;
    this.py = this.grid.cols > 0 ? this.openYAt(this.px, H / 2) : H / 2;
    this.pvy = 0;
    this.fireCd = 0;
    this.chargeT = 0;
    this.chargeReady = false;
    this.invulnT = 0;
  }

  // ----------------------------------------------------------------- update

  update(dt: number, input: InputSnapshot): void {
    if (this.phase !== 'play') return;
    this.playT += dt;
    this.animT += dt;
    if (this.bossDefeatT > 0) {
      this.updateBossDefeat(dt);
      return;
    }
    if (!this.isBoss()) this.scrollX += this.level.scroll * dt;
    this.engine.camera.snap(this.scrollX, 0);

    this.updatePlayer(dt, input);
    if (this.phase !== 'play') return;
    if (!this.isBoss()) this.updateTimeline(dt);
    this.updateFoes(dt);
    if (this.phase !== 'play') return;
    if (this.boss) this.updateBoss(dt);
    if (this.phase !== 'play') return;
    this.updatePlayerShots(dt);
    if (this.phase !== 'play') return;
    this.updateEnemyShots(dt);
    if (this.phase !== 'play') return;
    this.updatePickups(dt);
    if (!this.isBoss()) this.checkLevelEnd();
  }

  private playerCraftBank(): number {
    return clamp(this.pvy / SPEED_HIGH, -1, 1) * 0.14;
  }

  private playerCraftAnchorAt(
    centerX: number,
    centerY: number,
    anchor: { x: number; y: number },
  ): { x: number; y: number } {
    const bank = this.playerCraftBank();
    const cos = Math.cos(bank);
    const sin = Math.sin(bank);
    return {
      x: centerX + anchor.x * cos - anchor.y * sin,
      y: centerY + anchor.x * sin + anchor.y * cos,
    };
  }

  private playerMuzzleAt(centerX = this.px, centerY = this.py): { x: number; y: number } {
    return this.playerCraftAnchorAt(centerX, centerY, this.playerCraftAnchors.muzzle);
  }

  private playerRearAt(centerX = this.px, centerY = this.py): { x: number; y: number } {
    return this.playerCraftAnchorAt(centerX, centerY, this.playerCraftAnchors.rear);
  }

  private updatePlayer(dt: number, input: InputSnapshot): void {
    const inx = (input.LEFT.held ? -1 : 0) + (input.RIGHT.held ? 1 : 0);
    const iny = (input.UP.held ? -1 : 0) + (input.DOWN.held ? 1 : 0);
    const speed = this.fast ? SPEED_HIGH : SPEED_LOW;
    const norm = inx !== 0 && iny !== 0 ? 0.7071 : 1;
    this.pvy = iny * speed * norm;
    // Carry with the scroll (holds screen position), plus input; blocked by walls.
    const carry = this.isBoss() ? 0 : this.level.scroll * dt;
    const mvx = carry + inx * speed * norm * dt;
    const mvy = this.pvy * dt;
    this.pbox.x = this.px - PW / 2;
    this.pbox.y = this.py - PH / 2;
    const moved = moveAABB(this.tileGrid(), this.pbox, mvx, mvy);
    this.px = moved.x + PW / 2;
    this.py = clamp(moved.y + PH / 2, 6, H - 6);

    // Screen-x band: the ship may fly to either viewport edge (no damage for
    // reaching the back edge — it's just carried by the scroll).
    const sx = this.px - this.scrollX;
    if (sx > PLAYER_MAX_SX) this.px = this.scrollX + PLAYER_MAX_SX;
    else if (sx < PLAYER_MIN_SX) this.px = this.scrollX + PLAYER_MIN_SX;
    // CRUSH: if that clamp (or a scrolling wall) has squeezed the ship into
    // solid terrain — wedged between an obstacle and the screen edge — it dies.
    if (this.invulnT <= 0 && this.boxOverlapsSolid(this.px, this.py)) {
      this.killPlayer();
      if (this.phase !== 'play') return;
    }

    // thruster
    this.thrustT += dt;
    const thrustInterval = this.fast ? 0.035 : 0.065;
    if (this.thrustT >= thrustInterval) {
      this.thrustT = 0;
      const rear = this.playerRearAt();
      this.engine.particles.burst(rear.x, rear.y, this.fast ? 2 : 1, {
        color: this.spec.palette[this.fast ? 15 : 12],
        speed: this.fast ? 60 : 38,
        life: this.fast ? 0.3 : 0.22,
        gravity: 0,
        size: this.fast ? 3 : 2,
        angle: Math.PI,
        spread: this.fast ? 0.35 : 0.55,
      });
    }

    if (input.A.pressed) {
      this.fast = !this.fast;
      this.engine.sfx.play('jump');
    }

    // Y: autofire (rightward, world)
    this.fireCd = Math.max(0, this.fireCd - dt);
    if (input.Y.held && this.fireCd <= 0) {
      const muzzle = this.playerMuzzleAt();
      if (this.fireNormalShot(muzzle.x, muzzle.y, PLAYER_SHOT_SPEED, 0)) {
        if (this.spread) {
          this.fireNormalShot(muzzle.x - 1, muzzle.y - 4, PLAYER_SHOT_SPEED * 0.92, -70);
          this.fireNormalShot(muzzle.x - 1, muzzle.y + 4, PLAYER_SHOT_SPEED * 0.92, 70);
        }
        this.engine.particles.burst(muzzle.x, muzzle.y, this.spread ? 2 : 1, {
          color: this.spec.palette[this.rapid ? 15 : 14],
          speed: 34,
          life: 0.16,
          gravity: 0,
          size: this.rapid ? 2 : 1,
          angle: 0,
          spread: this.spread ? 0.75 : 0.25,
        });
        this.fireCd = 1 / (this.rapid ? RAPID_RATE : FIRE_RATE);
        this.engine.sfx.play('shoot');
      }
    }

    // X: charge shot
    if (input.X.held) {
      this.chargeT += dt;
      if (this.chargeT >= CHARGE_TIME && !this.chargeReady) {
        this.chargeReady = true;
        this.engine.sfx.play('powerup');
      }
      this.glowT += dt;
      if (this.glowT >= 0.05) {
        this.glowT = 0;
        const muzzle = this.playerMuzzleAt();
        this.engine.particles.burst(muzzle.x, muzzle.y, this.chargeReady ? 2 : 1, {
          color: this.spec.palette[this.chargeReady ? 15 : 7],
          speed: 26,
          life: 0.25,
          gravity: 0,
          size: this.chargeReady ? 3 : 2,
        });
      }
    } else if (this.chargeT > 0) {
      if (this.chargeT >= CHARGE_TIME) {
        this.chargeSeqCounter++;
        const muzzle = this.playerMuzzleAt();
        if (this.fireChargeShot(muzzle.x, muzzle.y, CHARGE_SHOT_SPEED, 0)) {
          this.engine.sfx.play('shoot');
          this.engine.shake(80, 1);
          this.engine.particles.burst(muzzle.x, muzzle.y, 14, {
            color: this.spec.palette[15],
            speed: 95,
            life: 0.42,
            gravity: 0,
            size: 3,
            angle: 0,
            spread: 1.1,
          });
        }
      }
      this.chargeT = 0;
      this.chargeReady = false;
    }

    if (input.B.pressed && this.hud.bombs > 0) this.detonateBomb();

    // hazard tile under the ship
    if (
      this.invulnT <= 0 &&
      this.grid.kind(Math.floor(this.px / TILE), Math.floor(this.py / TILE)) === 'hazard'
    ) {
      this.hurtPlayer(1);
      if (this.phase !== 'play') return;
    }

    this.invulnT = Math.max(0, this.invulnT - dt);
  }

  private detonateBomb(): void {
    this.hud.bombs--;
    for (const s of this.eshots) {
      if (!s.active) continue;
      s.active = false;
      this.engine.particles.burst(s.x, s.y, 2, {
        color: this.spec.palette[14],
        speed: 50,
        life: 0.3,
      });
    }
    for (const e of this.foes) {
      if (!e.active) continue;
      e.hp -= BOMB_DMG;
      e.flashT = 0.15;
      if (e.hp <= 0) this.killFoe(e);
    }
    const b = this.boss;
    if (b && b.active && b.entranceT >= BOSS_ENTRANCE_S) {
      b.hp -= BOMB_DMG;
      b.flashT = 0.15;
      this.hud.score += this.spec.scoring.events.bossHit;
      for (const pod of this.pods) {
        if (!pod.alive) continue;
        pod.hp -= BOMB_DMG;
        if (pod.hp <= 0) this.killPod(pod, b);
      }
    }
    this.engine.sfx.play('hit');
    this.engine.shake(400, 5);
    this.engine.hitStop(60);
    this.engine.particles.burst(this.px + 20, this.py, 24, {
      color: this.spec.palette[12],
      speed: 190,
      life: 0.6,
      size: 3,
    });
  }

  // ------------------------------------------------------------- wave timeline

  private updateTimeline(dt: number): void {
    this.clock += dt;
    const level = this.level;
    for (let i = 0; i < level.waves.length; i++) {
      if (this.waveFired[i]) continue;
      const w = level.waves[i]!;
      if (this.clock >= w.t) {
        this.waveFired[i] = true;
        this.lastWaveT = Math.max(this.lastWaveT, w.t);
        this.spawnWave(w);
      }
    }
    for (let i = 0; i < level.pickups.length; i++) {
      if (this.pickupFired[i]) continue;
      const p = level.pickups[i]!;
      if (this.clock >= p.t) {
        this.pickupFired[i] = true;
        this.spawnPickup(p.type, p.t);
      }
    }
  }

  private spawnWave(w: ShooterWave): void {
    const rng = this.engine.rng;
    const sweepDir = rng.chance(0.5) ? 1 : -1;
    // Use the authored temporal projection instead of the frame's slightly
    // overshot scroll position so lint and runtime inspect identical columns.
    const spawnX = w.t * this.level.scroll + W + HSHOOTER_WAVE_SPAWN_MARGIN_PX;
    const preferredY =
      w.path === 'sweep'
        ? sweepDir > 0
          ? 70
          : H - 70
        : this.openYAt(spawnX, rng.range(60, H - 60));
    const plan = planHShooterWavePlacement(this.level, w, spawnX, preferredY);
    for (const placement of plan.placements) {
      const e = this.claimFoe();
      if (!e) break;
      e.type = w.enemyType;
      e.path = w.path;
      e.y = placement.y;
      e.x = placement.x;
      e.baseY = e.y;
      e.t = 0;
      e.hp = Math.max(1, Math.round(w.hp * this.diff.hp));
      e.fireRate = w.fireRate * this.diff.fire;
      e.fireT = -rng.range(0, 0.8);
      e.state = ST_APPROACH;
      e.holdT = 0;
      e.phase = rng.range(0, Math.PI * 2);
      e.flashT = 0;
      e.chargeSeq = 0;
      e.mount = placement.mount;
      e.avoidVy = 0;
      e.stuckT = 0;
      e.speedMul = e.type === 'popcorn' ? 1.2 : e.type === 'tank' ? 0.6 : 1;
      // WORLD velocities. Turrets are mounted (vx 0) so they scroll off with the
      // terrain; others drift left in world (= faster-left on screen).
      if (e.type === 'turret') {
        e.vx = 0;
        e.vy = 0;
      } else {
        switch (w.path) {
          case 'dive':
            e.vx = -70 * e.speedMul;
            e.vy = 0;
            break;
          case 'sweep':
            e.vx = -60 * e.speedMul;
            e.vy = sweepDir * -50 * e.speedMul;
            break;
          case 'sine':
            e.vx = -50 * e.speedMul;
            e.vy = 0;
            break;
          case 'hold':
            e.vx = -70 * e.speedMul;
            e.vy = 0;
            break;
        }
      }
      e.holdSX = w.path === 'hold' ? W * 0.62 + rng.range(-24, 24) : -9999;
      e.holdDur = w.path === 'hold' ? 4 : 0;
    }
  }

  private claimFoe(): Foe | null {
    for (const e of this.foes)
      if (!e.active) {
        e.active = true;
        return e;
      }
    return null;
  }

  private spawnPickup(type: ShooterPickupType, authoredTimeS: number): void {
    const trajectory = planHShooterPickupTrajectory(this.level, authoredTimeS);
    if (!trajectory.complete || !trajectory.points[0]) return;
    for (const p of this.picks) {
      if (p.active) continue;
      p.active = true;
      p.type = type;
      p.trajectory = trajectory;
      p.x = trajectory.points[0].x;
      p.y = trajectory.points[0].y;
      p.t = 0;
      return;
    }
  }

  // ---------------------------------------------------------------- enemies

  private moveFoe(e: Foe, dt: number): void {
    this.ebox.x = e.x - ECOLL;
    this.ebox.y = e.y - ECOLL;
    const px = e.x;
    const m = moveAABB(this.tileGrid(), this.ebox, e.vx * dt, (e.vy + e.avoidVy) * dt);
    e.x = m.x + ECOLL;
    e.y = m.y + ECOLL;
    if (m.hitY) {
      e.vy = 0;
      e.avoidVy = 0;
    }
    // wedged against a wall making no horizontal headway?
    if (m.hitX && Math.abs(e.x - px) < 0.4) e.stuckT += dt;
    else e.stuckT = Math.max(0, e.stuckT - dt * 3);
  }

  /** Steer vertically around a solid obstacle ahead, toward the nearer open
   *  side; decays back toward the authored motion once clear. */
  private terrainSteer(x: number, y: number, vx: number, avoidVy: number, dt: number): number {
    const dir = vx <= 0 ? -1 : 1;
    const ty = Math.floor(y / TILE);
    const aheadTx = Math.floor((x + dir * TILE * 1.5) / TILE);
    const hereTx = Math.floor(x / TILE);
    if (this.grid.kind(aheadTx, ty) === 'solid' || this.grid.kind(hereTx, ty) === 'solid') {
      let up = 99;
      let down = 99;
      for (let d = 1; d <= 9; d++)
        if (this.grid.kind(aheadTx, ty - d) !== 'solid') {
          up = d;
          break;
        }
      for (let d = 1; d <= 9; d++)
        if (this.grid.kind(aheadTx, ty + d) !== 'solid') {
          down = d;
          break;
        }
      return clamp(avoidVy + (up <= down ? -1 : 1) * 260 * dt, -155, 155);
    }
    return avoidVy * 0.9;
  }

  private avoidTerrain(e: Foe, dt: number): void {
    e.avoidVy = this.terrainSteer(e.x, e.y, e.vx, e.avoidVy, dt);
  }

  private crashFoe(e: Foe): void {
    e.active = false;
    this.engine.particles.burst(e.x, e.y, 8, { color: this.spec.palette[8], speed: 70, life: 0.4 });
  }

  private updateFoes(dt: number): void {
    for (const e of this.foes) {
      if (!e.active) continue;
      const prevT = e.t;
      e.t += dt;
      e.flashT = Math.max(0, e.flashT - dt);
      const sx = e.x - this.scrollX; // screen x

      if (e.type === 'kamikaze' && e.state === ST_APPROACH && sx < KAMIKAZE_TRIGGER_SX)
        e.state = ST_HOMING;

      // steer around terrain so a moving enemy never jams into an obstacle
      if (e.type !== 'turret' && e.state !== ST_HOLD && sx < W + 40) this.avoidTerrain(e, dt);

      if (e.type === 'turret') {
        // mounted: no self-movement (scrolls off with the terrain)
      } else if (e.state === ST_HOLD) {
        e.holdT += dt;
        if (e.holdT >= e.holdDur) {
          e.state = ST_LEAVE;
          e.vx = -90 * e.speedMul;
          e.vy = 0;
        }
      } else if (e.state === ST_HOMING) {
        const dx = this.px - e.x;
        const dy = this.py - e.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        e.vx += (dx / len) * 240 * dt;
        e.vy += (dy / len) * 240 * dt;
        const sp = Math.hypot(e.vx, e.vy);
        const max = 220 * e.speedMul;
        if (sp > max) {
          e.vx = (e.vx / sp) * max;
          e.vy = (e.vy / sp) * max;
        }
        this.moveFoe(e, dt);
      } else {
        if (e.path === 'sine' && e.state === ST_APPROACH) {
          e.vy = (e.baseY + Math.sin(e.t * 2.4 + e.phase) * 42 - e.y) / Math.max(dt, 0.0001);
          this.moveFoe(e, dt);
          e.vy = 0;
        } else {
          this.moveFoe(e, dt);
        }
        if (e.type === 'weaver')
          e.y += (Math.sin(e.t * 6 + e.phase) - Math.sin(prevT * 6 + e.phase)) * 14;
        if (e.state === ST_APPROACH && sx <= e.holdSX && e.holdDur > 0) {
          e.state = ST_HOLD;
          e.holdT = 0;
        }
      }

      // last resort: if truly wedged (fully sealed pocket), crash it
      if (e.stuckT > 0.8) {
        this.crashFoe(e);
        continue;
      }

      // fire aimed shots
      if (e.fireRate > 0) {
        const onScreen = sx > 8 && sx < W - 4 && e.y > 8 && e.y < H - 8;
        const gated = e.type !== 'turret' && e.path === 'hold' && e.state !== ST_HOLD;
        if (onScreen && !gated) {
          e.fireT += dt;
          const interval = 1 / e.fireRate;
          if (e.fireT >= interval) {
            e.fireT -= interval;
            this.fireEnemyAimed(e.x - 6, e.y, ENEMY_SHOT_SPEED, e.type === 'tank' ? 2 : 1);
            this.engine.particles.burst(e.x - 7, e.y, e.type === 'tank' ? 4 : 2, {
              color: this.spec.palette[e.type === 'tank' ? 15 : 14],
              speed: e.type === 'tank' ? 48 : 34,
              life: 0.18,
              gravity: 0,
              angle: Math.PI,
              spread: 0.5,
            });
            this.engine.sfx.play('shoot');
          }
        }
      }

      if (sx < -48 || e.y < -48 || e.y > H + 48) {
        e.active = false;
        continue;
      }

      const d = this.foeDims[e.type];
      if (this.invulnT <= 0 && this.overlap(e.x, e.y, d.w, d.h, this.px, this.py, 4, 4)) {
        this.hurtPlayer(1);
        if (e.type === 'popcorn' || e.type === 'weaver') {
          e.active = false;
          this.engine.particles.burst(e.x, e.y, 8, {
            color: this.spec.palette[8],
            speed: 80,
            life: 0.4,
          });
        }
        if (this.phase !== 'play') return;
      }
    }
  }

  private killFoe(e: Foe): void {
    e.active = false;
    this.hud.score += this.spec.scoring.events.enemyKill;
    this.engine.sfx.play('hit');
    const heavy = e.type === 'tank' || e.type === 'turret';
    this.engine.particles.burst(e.x, e.y, heavy ? 15 : 10, {
      color: this.spec.palette[8],
      speed: heavy ? 120 : 95,
      life: heavy ? 0.62 : 0.45,
      size: heavy ? 3 : 2,
    });
    this.engine.particles.burst(e.x, e.y, heavy ? 7 : 4, {
      color: this.spec.palette[14],
      speed: heavy ? 65 : 48,
      life: heavy ? 0.45 : 0.3,
      gravity: 0,
      size: 2,
    });
    if (heavy) this.engine.shake(110, 1.5);
    if (e.type === 'tank') this.engine.hitStop(24);
  }

  // ------------------------------------------------------------------- boss

  private bossMuzzleX(b: BossState, inset = 8): number {
    return this.generatedBoss ? generatedHShooterBossMuzzleX(b.x) : b.x - inset;
  }

  private prepareBossTelegraph(
    b: BossState,
    pattern: ShooterBossPattern,
    cadenceS: number,
    telegraphS: number,
  ): void {
    if (b.telegraphPrepared || b.burstLeft > 0 || b.fireT < cadenceS - telegraphS) return;
    b.telegraphPrepared = true;
    b.telegraphTargetX = this.px;
    b.telegraphTargetY = this.py;
    b.telegraphAimAngle =
      pattern === 'spiral'
        ? b.spiralAngle + (25 * Math.PI) / 180
        : Math.atan2(this.py - b.y, this.px - this.bossMuzzleX(b));
    if (pattern === 'walls') b.telegraphGapY = this.engine.rng.range(24, H - 72);
    this.engine.particles.burst(this.bossMuzzleX(b), b.y, pattern === 'walls' ? 7 : 4, {
      color: this.spec.palette[10],
      speed: 34,
      life: telegraphS,
      gravity: 0,
      size: 2,
    });
  }

  private finishBossAttack(b: BossState, cadenceS: number): void {
    b.fireT = Math.max(0, b.fireT - cadenceS);
    b.telegraphPrepared = false;
    this.engine.particles.burst(this.bossMuzzleX(b), b.y, 5, {
      color: this.spec.palette[15],
      speed: 55,
      life: 0.22,
      gravity: 0,
      size: 2,
      angle: Math.PI,
      spread: 0.8,
    });
  }

  private updateBoss(dt: number): void {
    const b = this.boss!;
    if (!b.active) return;
    b.t += dt;
    b.flashT = Math.max(0, b.flashT - dt);
    if (b.entranceT < BOSS_ENTRANCE_S) {
      b.entranceT = Math.min(BOSS_ENTRANCE_S, b.entranceT + dt);
      b.x = this.scrollX + W + 60 - (W + 60 - BOSS_SX) * (b.entranceT / BOSS_ENTRANCE_S);
      b.y = H / 2;
      this.hud.boss = { hp: Math.max(0, b.hp), maxHp: b.maxHp, name: this.spec.boss.name };
      return;
    }
    b.x = this.scrollX + BOSS_SX;
    b.y = H / 2 + Math.sin(b.t * 0.9) * 60;

    const phases = this.spec.boss.phases;
    const phaseIx = Math.min(phases.length - 1, Math.floor((1 - b.hp / b.maxHp) * phases.length));
    if (phaseIx !== b.phaseIx) {
      b.phaseIx = phaseIx;
      b.fireT = 0;
      b.burstLeft = 0;
      b.telegraphPrepared = false;
      this.engine.shake(300, 4);
      this.engine.particles.burst(b.x, b.y, 20, {
        color: this.spec.palette[11],
        speed: 130,
        life: 0.6,
      });
    }
    const phase = phases[b.phaseIx]!;
    const cadenceS = hshooterBossAttackCadenceS(phase.pattern, phase.fireIntervalMs);
    const telegraphS = hshooterBossTelegraphDurationS(phase.pattern, phase.fireIntervalMs);
    const spd = BOSS_SHOT_SPEED * phase.bulletSpeed;
    b.fireT += dt;
    this.prepareBossTelegraph(b, phase.pattern, cadenceS, telegraphS);

    switch (phase.pattern) {
      case 'fan': {
        if (b.fireT >= cadenceS) {
          const n = 5 + this.engine.rng.int(0, 2);
          const aim = b.telegraphPrepared
            ? b.telegraphAimAngle
            : Math.atan2(this.py - b.y, this.px - b.x);
          for (let i = 0; i < n; i++) {
            const a = aim + ((i - (n - 1) / 2) * Math.PI) / 12;
            const muzzleX = this.bossMuzzleX(b);
            this.fireEnemyShot(muzzleX, b.y, Math.cos(a) * spd, Math.sin(a) * spd, 1);
          }
          this.finishBossAttack(b, cadenceS);
          this.engine.sfx.play('shoot');
        }
        break;
      }
      case 'spiral': {
        if (b.fireT >= cadenceS) {
          b.spiralAngle = b.telegraphPrepared
            ? b.telegraphAimAngle
            : b.spiralAngle + (25 * Math.PI) / 180;
          this.fireEnemyShot(
            this.bossMuzzleX(b),
            b.y,
            Math.cos(b.spiralAngle) * spd,
            Math.sin(b.spiralAngle) * spd,
            1,
          );
          this.finishBossAttack(b, cadenceS);
          this.engine.sfx.play('shoot');
        }
        break;
      }
      case 'walls': {
        if (b.fireT >= cadenceS) {
          const gapY = b.telegraphPrepared ? b.telegraphGapY : this.engine.rng.range(24, H - 72);
          for (let by = 12; by < H; by += 26) {
            if (by > gapY && by < gapY + 48) continue;
            const muzzleX = this.bossMuzzleX(b, 14);
            this.fireEnemyShot(muzzleX, by, -spd, 0, 1);
          }
          this.finishBossAttack(b, cadenceS);
          this.engine.sfx.play('shoot');
        }
        break;
      }
      case 'aimed': {
        if (b.burstLeft > 0) {
          b.burstT += dt;
          if (b.burstT >= 0.09) {
            b.burstT -= 0.09;
            b.burstLeft--;
            const muzzleX = this.bossMuzzleX(b);
            const aim = Math.atan2(b.telegraphTargetY - b.y, b.telegraphTargetX - muzzleX);
            this.fireEnemyShot(
              muzzleX,
              b.y,
              Math.cos(aim) * spd * 1.15,
              Math.sin(aim) * spd * 1.15,
              1,
            );
          }
        } else if (b.fireT >= cadenceS) {
          b.burstLeft = 3;
          b.burstT = 0.09;
          this.finishBossAttack(b, cadenceS);
          this.engine.sfx.play('shoot');
        }
        break;
      }
    }

    for (const pod of this.pods) {
      if (!pod.alive) continue;
      pod.flashT = Math.max(0, pod.flashT - dt);
      pod.fireT += dt;
      if (pod.fireT >= POD_FIRE_INTERVAL) {
        pod.fireT -= POD_FIRE_INTERVAL;
        this.fireEnemyAimed(b.x + pod.ox - 6, b.y + pod.oy, ENEMY_SHOT_SPEED, 1);
        this.engine.particles.burst(b.x + pod.ox - 6, b.y + pod.oy, 3, {
          color: this.spec.palette[14],
          speed: 38,
          life: 0.2,
          gravity: 0,
          angle: Math.PI,
          spread: 0.5,
        });
      }
    }

    if (
      this.invulnT <= 0 &&
      this.overlap(b.x, b.y, this.bossDims.w, this.bossDims.h, this.px, this.py, 4, 4)
    ) {
      this.hurtPlayer(1);
      if (this.phase !== 'play') return;
    }

    this.hud.boss = { hp: Math.max(0, b.hp), maxHp: b.maxHp, name: this.spec.boss.name };
    if (b.hp <= 0) this.defeatBoss(b);
  }

  private killPod(pod: Pod, b: BossState): void {
    pod.alive = false;
    this.hud.score += this.spec.scoring.events.bossHit;
    this.engine.sfx.play('hit');
    this.engine.shake(150, 2);
    this.engine.particles.burst(b.x + pod.ox, b.y + pod.oy, 14, {
      color: this.spec.palette[9],
      speed: 110,
      life: 0.5,
    });
  }

  private defeatBoss(b: BossState): void {
    b.active = false;
    b.telegraphPrepared = false;
    this.hud.boss = undefined;
    this.hud.score += this.spec.scoring.events.levelClear;
    this.bossDefeatT = BOSS_DEFEAT_DURATION_S;
    this.bossDefeatBurstT = 0;
    this.bossDefeatBurstIndex = 0;
    this.bossDefeatFinaleFired = false;
    for (const shot of this.pshots) shot.active = false;
    for (const shot of this.eshots) shot.active = false;
    for (const pod of this.pods) pod.alive = false;
    this.engine.particles.burst(b.x, b.y, 22, {
      color: this.spec.palette[15],
      speed: 125,
      life: 0.7,
      size: 3,
    });
    this.engine.shake(260, 4);
    this.engine.hitStop(80);
    this.engine.sfx.play('hit');
    this.engine.music.stopSong();
  }

  private updateBossDefeat(dt: number): void {
    const b = this.boss;
    if (!b) return;
    this.bossDefeatT = Math.max(0, this.bossDefeatT - dt);
    this.bossDefeatBurstT += dt;
    while (
      this.bossDefeatBurstT >= BOSS_DEFEAT_BURST_INTERVAL_S &&
      this.bossDefeatT > BOSS_DEFEAT_FINALE_LEAD_S
    ) {
      this.bossDefeatBurstT -= BOSS_DEFEAT_BURST_INTERVAL_S;
      this.bossDefeatBurstIndex++;
      const wide = this.bossDefeatBurstIndex % 3 === 0;
      this.engine.particles.burst(
        b.x + this.engine.rng.range(-this.bossVisualDims.w * 0.42, this.bossVisualDims.w * 0.42),
        b.y + this.engine.rng.range(-this.bossVisualDims.h * 0.42, this.bossVisualDims.h * 0.42),
        wide ? 15 : 9,
        {
          color: this.spec.palette[this.bossDefeatBurstIndex % 2 === 0 ? 12 : 14],
          speed: wide ? 155 : 95,
          life: wide ? 0.7 : 0.48,
          gravity: 0,
          size: wide ? 3 : 2,
        },
      );
      if (wide) this.engine.shake(110, 2.5);
    }
    if (!this.bossDefeatFinaleFired && this.bossDefeatT <= BOSS_DEFEAT_FINALE_LEAD_S) {
      this.bossDefeatFinaleFired = true;
      this.engine.particles.burst(b.x, b.y, 36, {
        color: this.spec.palette[15],
        speed: 210,
        life: 1,
        gravity: 0,
        size: 4,
      });
      this.engine.shake(650, 7);
      this.engine.hitStop(100);
      this.engine.sfx.play('hit');
    }
    if (this.bossDefeatT > 0) return;
    this.showVictoryCards();
  }

  private showVictoryCards(): void {
    this.phase = 'cards';
    this.engine.cards.show(
      this.spec.story.victory.map((line) => ({
        lines: [line],
        portrait: this.engine.portrait,
        artRole: 'victory' as const,
      })),
      () => {
        const par = estimateHShooterDurationS(this.spec) * 1.35;
        this.result = {
          outcome: 'won',
          score: this.hud.score,
          timeBonusSeconds: Math.max(0, Math.round(par - this.playT)),
        };
      },
    );
  }

  // ------------------------------------------------------------- projectiles

  private fireNormalShot(x: number, y: number, vx: number, vy: number): boolean {
    let normal = 0;
    for (const p of this.pshots) if (p.active && !p.pierce) normal++;
    if (normal >= MAX_NORMAL_SHOTS) return false;
    return this.claimPShot(x, y, vx, vy, 1, false, 0);
  }

  private fireChargeShot(x: number, y: number, vx: number, vy: number): boolean {
    return this.claimPShot(x, y, vx, vy, CHARGE_DMG, true, this.chargeSeqCounter);
  }

  private claimPShot(
    x: number,
    y: number,
    vx: number,
    vy: number,
    dmg: number,
    pierce: boolean,
    seq: number,
  ): boolean {
    for (const p of this.pshots) {
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.dmg = dmg;
      p.pierce = pierce;
      p.seq = seq;
      p.t = 0;
      return true;
    }
    return false;
  }

  private fireEnemyShot(x: number, y: number, vx: number, vy: number, dmg: number): boolean {
    for (const s of this.eshots) {
      if (s.active) continue;
      s.active = true;
      s.x = x;
      s.y = y;
      s.vx = vx;
      s.vy = vy;
      s.dmg = dmg;
      s.t = 0;
      return true;
    }
    return false;
  }

  private fireEnemyAimed(x: number, y: number, speed: number, dmg: number): void {
    const dx = this.px - x;
    const dy = this.py - y;
    const len = Math.max(1, Math.hypot(dx, dy));
    this.fireEnemyShot(x, y, (dx / len) * speed, (dy / len) * speed, dmg);
  }

  private updatePlayerShots(dt: number): void {
    const b = this.boss;
    for (const p of this.pshots) {
      if (!p.active) continue;
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const sx = p.x - this.scrollX;
      if (sx > W + 16 || p.y < -16 || p.y > H + 16 || this.solidAtWorld(p.x, p.y)) {
        p.active = false;
        continue;
      }
      const pw = p.pierce ? 16 : 10;
      const ph = p.pierce ? 12 : 6;

      for (const e of this.foes) {
        if (!e.active) continue;
        if (p.pierce && e.chargeSeq === p.seq) continue;
        const d = this.foeDims[e.type];
        if (!this.overlap(p.x, p.y, pw, ph, e.x, e.y, d.w, d.h)) continue;
        e.hp -= p.dmg;
        e.flashT = 0.1;
        if (p.pierce) e.chargeSeq = p.seq;
        else p.active = false;
        this.engine.particles.burst(p.x, p.y, p.pierce ? 7 : 3, {
          color: this.spec.palette[p.pierce ? 15 : 9],
          speed: p.pierce ? 85 : 52,
          life: p.pierce ? 0.35 : 0.2,
          gravity: 0,
          size: p.pierce ? 3 : 2,
        });
        if (p.pierce) this.engine.hitStop(18);
        if (e.hp <= 0) this.killFoe(e);
        else this.engine.sfx.play('hit');
        if (!p.active) break;
      }

      if (p.active && b && b.active && b.entranceT >= BOSS_ENTRANCE_S) {
        for (const pod of this.pods) {
          if (!pod.alive) continue;
          if (p.pierce && pod.chargeSeq === p.seq) continue;
          if (!this.overlap(p.x, p.y, pw, ph, b.x + pod.ox, b.y + pod.oy, 12, 12)) continue;
          pod.hp -= p.dmg;
          pod.flashT = 0.1;
          if (p.pierce) pod.chargeSeq = p.seq;
          else p.active = false;
          this.engine.particles.burst(p.x, p.y, p.pierce ? 8 : 4, {
            color: this.spec.palette[p.pierce ? 15 : 9],
            speed: 72,
            life: 0.3,
            gravity: 0,
            size: p.pierce ? 3 : 2,
          });
          if (pod.hp <= 0) this.killPod(pod, b);
          else this.engine.sfx.play('hit');
          if (!p.active) break;
        }
        if (
          p.active &&
          !(p.pierce && b.chargeSeq === p.seq) &&
          this.overlap(p.x, p.y, pw, ph, b.x, b.y, this.bossDims.w, this.bossDims.h)
        ) {
          b.hp -= p.dmg;
          b.flashT = 0.12;
          this.hud.score += this.spec.scoring.events.bossHit;
          this.engine.sfx.play('hit');
          this.engine.particles.burst(p.x, p.y, 5, {
            color: this.spec.palette[9],
            speed: 70,
            life: 0.3,
          });
          if (p.pierce) b.chargeSeq = p.seq;
          else p.active = false;
        }
      }
    }
  }

  private updateEnemyShots(dt: number): void {
    for (const s of this.eshots) {
      if (!s.active) continue;
      s.t += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const sx = s.x - this.scrollX;
      if (sx < -16 || sx > W + 16 || s.y < -16 || s.y > H + 16 || this.solidAtWorld(s.x, s.y)) {
        s.active = false;
        continue;
      }
      if (this.invulnT <= 0 && this.overlap(s.x, s.y, 5, 5, this.px, this.py, 4, 4)) {
        s.active = false;
        this.hurtPlayer(s.dmg);
        if (this.phase !== 'play') return;
      }
    }
  }

  // ---------------------------------------------------------------- pickups

  private updatePickups(dt: number): void {
    for (const p of this.picks) {
      if (!p.active) continue;
      p.t += dt;
      const trajectory = p.trajectory;
      const targetY = trajectory ? sampleHShooterPickupTrajectoryY(trajectory, p.t) : null;
      if (!trajectory || targetY === null) {
        p.active = false;
        continue;
      }
      const firstPoint = trajectory.points[0]!;
      const nextX = firstPoint.x + (this.level.scroll - HSHOOTER_PICKUP_SCREEN_SPEED_PX) * p.t;
      this.pkbox.x = p.x - 6;
      this.pkbox.y = p.y - 6;
      const m = moveAABB(this.tileGrid(), this.pkbox, nextX - p.x, targetY - p.y);
      p.x = m.x + 6;
      p.y = m.y + 6;
      if (m.hitX || m.hitY) {
        p.active = false;
        continue;
      }
      if (p.x - this.scrollX < -16) {
        p.active = false;
        continue;
      }
      if (!this.overlap(p.x, p.y, 12, 12, this.px, this.py, 14, 14)) continue;
      p.active = false;
      this.hud.score += this.spec.scoring.events.pickup;
      switch (p.type) {
        case 'spread':
          this.spread = true;
          this.engine.sfx.play('powerup');
          break;
        case 'rapid':
          this.rapid = true;
          this.engine.sfx.play('powerup');
          break;
        case 'shield':
          this.shieldUp = true;
          this.engine.sfx.play('powerup');
          break;
        case 'bomb':
          this.hud.bombs = Math.min(MAX_BOMBS, this.hud.bombs + 1);
          this.engine.sfx.play('pickup');
          break;
      }
      this.engine.particles.burst(p.x, p.y, 10, {
        color: this.spec.palette[13],
        speed: 60,
        life: 0.4,
      });
    }
  }

  // ------------------------------------------------------------ damage/death

  private hurtPlayer(dmg: number): void {
    if (this.invulnT > 0) return;
    if (this.shieldUp) {
      this.shieldUp = false;
      this.invulnT = 0.8;
      this.engine.sfx.play('hit');
      this.engine.particles.burst(this.px, this.py, 12, {
        color: this.spec.palette[4],
        speed: 80,
        life: 0.4,
      });
      return;
    }
    this.hud.health -= dmg;
    this.invulnT = FEEL.invulnMs / 1000;
    this.engine.sfx.play('hurt');
    this.engine.shake(FEEL.screenShakeMs, 3);
    this.engine.hitStop(FEEL.hitStopMs);
    this.engine.particles.burst(this.px, this.py, 12, {
      color: this.spec.palette[8],
      speed: 105,
      life: 0.45,
      gravity: 0,
      size: 2,
    });
    if (this.hud.health <= 0) this.killPlayer();
  }

  private killPlayer(): void {
    this.hud.lives--;
    this.engine.sfx.play('die');
    this.engine.particles.burst(this.px, this.py, 20, {
      color: this.spec.palette[5],
      speed: 130,
      life: 0.7,
    });
    for (const p of this.pshots) p.active = false;
    for (const s of this.eshots) s.active = false;
    this.chargeT = 0;
    this.chargeReady = false;

    if (this.hud.lives < 0) {
      this.phase = 'cards';
      this.hud.boss = undefined;
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
    if (this.isBoss()) {
      const b = this.boss;
      if (b) {
        b.fireT = 0;
        b.burstLeft = 0;
        b.telegraphPrepared = false;
      }
    } else {
      for (const e of this.foes) e.active = false;
      this.clock = this.lastWaveT;
      const waves = this.level.waves;
      for (let i = 0; i < waves.length; i++)
        if (waves[i]!.t >= this.lastWaveT) this.waveFired[i] = false;
    }
    this.spawnPlayer();
    this.invulnT = 2;
  }

  // -------------------------------------------------------------- level end

  private checkLevelEnd(): void {
    if (this.clock <= this.level.durationS) return;
    for (const e of this.foes) if (e.active) return;
    for (const s of this.eshots) if (s.active) return;
    this.hud.score += this.spec.scoring.events.levelClear;
    this.engine.sfx.play('win');
    this.engine.music.stopSong();
    this.phase = 'cards';
    this.enterLevel(this.levelIndex + 1);
  }

  // ---------------------------------------------------------------- helpers

  private overlap(
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number,
  ): boolean {
    return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const r = this.engine.renderer;
    const cam = this.engine.camera;
    r.clear(this.spec.palette[2]);
    if (!this.backdrop) return;

    if (this.generatedBackdrop) {
      this.generatedBackdrop.draw(r.ctx, this.scrollX, 0);
      r.rect(0, 0, W, H, `rgba(0, 0, 0, ${HSHOOTER_GENERATED_BACKDROP_DIM_ALPHA})`);
      r.ctx.save();
      r.ctx.globalAlpha = HSHOOTER_PROCEDURAL_BACKDROP_ALPHA;
      this.backdrop.draw(r.ctx, cam.x, cam.y);
      r.ctx.restore();
    } else {
      this.backdrop.draw(r.ctx, cam.x, cam.y);
    }

    // tile stage
    const frameIx = Math.floor(this.animT * 4) % 2;
    drawTileLayer(r, cam, this.grid.cols, this.grid.rows, TILE, (tx, ty) => {
      return this.tileCanvasAt(tx, ty, frameIx);
    });

    const decorationFrames = this.tileFrames['decoration'];
    if (decorationFrames?.length) {
      const decoration =
        decorationFrames[frameIx % decorationFrames.length] ?? decorationFrames[0]!;
      for (const cell of this.decorations) {
        r.drawScaled(decoration, cell.x * TILE - cam.x, cell.y * TILE - cam.y, TILE, TILE);
      }
    }

    // pickups
    for (const p of this.picks) {
      if (!p.active) continue;
      const sprite = this.pickupSprites[p.type];
      const img = this.engine.sprites.frame(sprite, 'idle', p.t);
      r.draw(img, p.x - cam.x - sprite.w / 2, p.y - sprite.h / 2);
    }

    // player shots (rotated to travel right)
    const projSprite = this.sprites['projectile']!;
    for (const p of this.pshots) {
      if (!p.active) continue;
      const img = this.engine.sprites.frame(projSprite, 'idle', p.t);
      const s = p.pierce ? 2 : 1;
      this.drawVelocityTrail(
        p.x - cam.x,
        p.y,
        p.vx,
        p.vy,
        p.pierce ? 24 : 12,
        this.spec.palette[p.pierce ? 15 : 14] ?? '#fff1a8',
        p.pierce ? 4 : 2,
        p.pierce ? 0.9 : 0.7,
      );
      this.drawHorizontal(img, p.x - cam.x, p.y, projSprite.w * s, projSprite.h * s);
    }

    // Detailed specs rotate top-down foes into their correct side-view plane.
    // The legacy branch intentionally preserves published-game presentation.
    for (const e of this.foes) {
      if (!e.active) continue;
      if (this.generatedEnemyAtlas) {
        if (e.flashT <= 0 || Math.floor(this.animT * 24) % 2 === 0) {
          this.drawGeneratedEnemy(e);
        }
        this.drawFoeMuzzleWarning(e);
        continue;
      }
      const sprite = this.sprites[e.type]!;
      const img =
        e.flashT > 0
          ? sprite.flash[0]!
          : this.engine.sprites.frame(sprite, 'fly', e.t, !this.detailedPresentation);
      if (this.detailedPresentation) {
        this.drawHorizontal(
          img,
          e.x - cam.x,
          e.y,
          sprite.w,
          sprite.h,
          e.type === 'turret' && e.mount === 'ceiling',
        );
      } else {
        r.draw(img, e.x - cam.x - sprite.w / 2, e.y - sprite.h / 2);
      }
      this.drawFoeMuzzleWarning(e);
    }

    // boss + pods
    const b = this.boss;
    if (b && (b.active || this.bossDefeatT > 0)) {
      if (b.active && b.entranceT >= BOSS_ENTRANCE_S) this.drawBossTelegraph(b);
      const ctx = r.ctx;
      ctx.save();
      if (!b.active) {
        const remaining = this.bossDefeatT / BOSS_DEFEAT_DURATION_S;
        ctx.globalAlpha = 0.35 + remaining * 0.5;
        const pulse = 1 + (1 - remaining) * 0.12 + Math.sin(this.animT * 38) * 0.025;
        ctx.translate(Math.round(b.x - cam.x), Math.round(b.y));
        ctx.scale(pulse, pulse);
        ctx.translate(-Math.round(b.x - cam.x), -Math.round(b.y));
      }
      if (this.generatedBoss) {
        // The authored silhouette stays rigid; movement, hit flicker, pods,
        // projectiles, particles, and destruction remain procedural effects.
        if (b.flashT <= 0 || Math.floor(this.animT * 24) % 2 === 0) {
          const rect = generatedHShooterBossDrawRect(b.x - cam.x, b.y);
          r.drawScaled(this.generatedBoss, rect.x, rect.y, rect.w, rect.h);
        }
      } else {
        const sprite = this.sprites['boss']!;
        const img =
          b.flashT > 0
            ? sprite.flash[0]!
            : this.engine.sprites.frame(sprite, 'idle', this.animT, !this.detailedPresentation);
        if (this.detailedPresentation) {
          this.drawHorizontal(img, b.x - cam.x, b.y, sprite.w, sprite.h);
        } else {
          r.draw(img, b.x - cam.x - sprite.w / 2, b.y - sprite.h / 2);
        }
      }
      ctx.restore();
      const podSprite = this.sprites['pod']!;
      for (const pod of this.pods) {
        if (!pod.alive) continue;
        const pimg =
          pod.flashT > 0
            ? podSprite.flash[0]!
            : this.engine.sprites.frame(podSprite, 'fly', this.animT, !this.detailedPresentation);
        if (this.detailedPresentation) {
          this.drawHorizontal(pimg, b.x + pod.ox - cam.x, b.y + pod.oy, podSprite.w, podSprite.h);
        } else {
          r.draw(pimg, b.x + pod.ox - cam.x - podSprite.w / 2, b.y + pod.oy - podSprite.h / 2);
        }
        this.drawPodMuzzleWarning(b, pod);
      }
    }

    // enemy bullets on top
    const shotSprite = this.sprites['enemy_shot']!;
    for (const sh of this.eshots) {
      if (!sh.active) continue;
      const img = this.engine.sprites.frame(shotSprite, 'idle', sh.t);
      this.drawVelocityTrail(
        sh.x - cam.x,
        sh.y,
        sh.vx,
        sh.vy,
        sh.dmg > 1 ? 15 : 9,
        this.spec.palette[sh.dmg > 1 ? 8 : 10] ?? '#ff5c5c',
        sh.dmg > 1 ? 3 : 2,
        0.72,
      );
      r.draw(img, sh.x - cam.x - shotSprite.w / 2, sh.y - shotSprite.h / 2);
    }

    // Required native generated side-view craft.
    if (this.invulnT <= 0 || Math.floor(this.animT * 12) % 2 === 0) {
      const sxp = this.px - cam.x;
      this.drawPlayerExhaust(sxp, this.py);
      if (this.shieldUp) this.drawPlayerShield(sxp, this.py);
      this.drawGeneratedPlayerCraft(this.generatedPlayerCraft, sxp, this.py);
      this.drawPlayerWeaponGlow(sxp, this.py);
      if (this.chargeT > 0.15) this.drawPlayerCharge(sxp, this.py);
    }
  }

  private strokeLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    width: number,
    alpha: number,
    dash: readonly number[] = [],
  ): void {
    const ctx = this.engine.renderer.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.setLineDash([...dash]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x1), Math.round(y1));
    ctx.lineTo(Math.round(x2), Math.round(y2));
    ctx.stroke();
    ctx.restore();
  }

  private strokeRing(
    x: number,
    y: number,
    radius: number,
    color: string,
    width: number,
    alpha: number,
  ): void {
    const ctx = this.engine.renderer.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(y), Math.max(1, radius), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawVelocityTrail(
    x: number,
    y: number,
    vx: number,
    vy: number,
    length: number,
    color: string,
    width: number,
    alpha: number,
  ): void {
    const speed = Math.max(1, Math.hypot(vx, vy));
    this.strokeLine(
      x,
      y,
      x - (vx / speed) * length,
      y - (vy / speed) * length,
      color,
      width,
      alpha,
    );
  }

  private drawPixelGuide(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    alpha: number,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.max(1, Math.hypot(dx, dy));
    const steps = Math.max(2, Math.floor(length / 14));
    const ctx = this.engine.renderer.ctx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (let index = 1; index < steps; index++) {
      if ((index + Math.floor(this.animT * 12)) % 3 === 0) continue;
      const progress = index / steps;
      const size = progress > 0.72 ? 2 : 1;
      ctx.fillRect(
        Math.round(x1 + dx * progress - size / 2),
        Math.round(y1 + dy * progress - size / 2),
        size,
        size,
      );
    }
    ctx.restore();
  }

  private drawFoeMuzzleWarning(enemy: Foe): void {
    if (enemy.fireRate <= 0) return;
    const gated = enemy.type !== 'turret' && enemy.path === 'hold' && enemy.state !== ST_HOLD;
    if (gated) return;
    const interval = 1 / enemy.fireRate;
    const warningS = Math.min(0.26, interval * 0.4);
    const progress = clamp((enemy.fireT - (interval - warningS)) / Math.max(0.01, warningS), 0, 1);
    if (progress <= 0) return;
    const x = enemy.x - this.engine.camera.x - 8;
    const pulse = 2 + progress * 4 + Math.sin(this.animT * 22) * 0.8;
    this.strokeRing(
      x,
      enemy.y,
      pulse,
      this.spec.palette[enemy.type === 'tank' ? 15 : 14] ?? '#ffec6e',
      progress > 0.7 ? 2 : 1,
      0.35 + progress * 0.6,
    );
  }

  private drawPodMuzzleWarning(boss: BossState, pod: Pod): void {
    const warningS = 0.28;
    const progress = clamp((pod.fireT - (POD_FIRE_INTERVAL - warningS)) / warningS, 0, 1);
    if (progress <= 0) return;
    this.strokeRing(
      boss.x + pod.ox - this.engine.camera.x - 6,
      boss.y + pod.oy,
      2 + progress * 5,
      this.spec.palette[14] ?? '#ffec6e',
      progress > 0.75 ? 2 : 1,
      0.35 + progress * 0.6,
    );
  }

  private drawBossTelegraph(boss: BossState): void {
    if (!boss.telegraphPrepared) return;
    const phase = this.spec.boss.phases[boss.phaseIx];
    if (!phase) return;
    const progress = hshooterBossTelegraphProgress(boss.fireT, phase.pattern, phase.fireIntervalMs);
    if (progress <= 0) return;
    const camX = this.engine.camera.x;
    const muzzleX = this.bossMuzzleX(boss) - camX;
    const color = this.spec.palette[10] ?? '#ff5c5c';
    const bright = this.spec.palette[15] ?? '#fff1a8';
    const pulse = 0.45 + progress * 0.5;

    switch (phase.pattern) {
      case 'fan': {
        for (const offset of [-Math.PI / 6, 0, Math.PI / 6]) {
          const angle = boss.telegraphAimAngle + offset;
          this.strokeLine(
            muzzleX,
            boss.y,
            muzzleX + Math.cos(angle) * 175,
            boss.y + Math.sin(angle) * 175,
            color,
            offset === 0 ? 2 : 1,
            pulse,
            [6, 5],
          );
        }
        break;
      }
      case 'spiral': {
        const radius = 9 + progress * 10;
        this.strokeRing(muzzleX, boss.y, radius, color, 2, pulse);
        this.strokeLine(
          muzzleX,
          boss.y,
          muzzleX + Math.cos(boss.telegraphAimAngle) * (radius + 18),
          boss.y + Math.sin(boss.telegraphAimAngle) * (radius + 18),
          bright,
          2,
          pulse,
        );
        break;
      }
      case 'walls': {
        for (let y = 12; y < H; y += 26) {
          if (y > boss.telegraphGapY && y < boss.telegraphGapY + 48) continue;
          this.strokeLine(
            muzzleX - 74,
            y,
            muzzleX,
            y,
            color,
            progress > 0.75 ? 3 : 2,
            pulse,
            [5, 4],
          );
        }
        this.strokeLine(
          muzzleX - 92,
          boss.telegraphGapY,
          muzzleX - 12,
          boss.telegraphGapY,
          bright,
          1,
          pulse,
        );
        this.strokeLine(
          muzzleX - 92,
          boss.telegraphGapY + 48,
          muzzleX - 12,
          boss.telegraphGapY + 48,
          bright,
          1,
          pulse,
        );
        break;
      }
      case 'aimed': {
        const targetX = boss.telegraphTargetX - camX;
        this.drawPixelGuide(
          muzzleX,
          boss.y,
          targetX,
          boss.telegraphTargetY,
          progress > 0.78 ? bright : color,
          pulse,
        );
        break;
      }
    }
    this.strokeRing(muzzleX, boss.y, 4 + progress * 5, bright, progress > 0.8 ? 3 : 2, pulse);
  }

  private drawPlayerExhaust(centerX: number, centerY: number): void {
    const ctx = this.engine.renderer.ctx;
    const rear = this.playerRearAt(centerX, centerY);
    const pulse = (Math.sin(this.animT * (this.fast ? 34 : 24)) + 1) * 0.5;
    const length = (this.fast ? 15 : 9) + pulse * (this.fast ? 6 : 4);
    ctx.save();
    ctx.translate(Math.round(rear.x), Math.round(rear.y));
    ctx.rotate(this.playerCraftBank());
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = this.spec.palette[this.fast ? 15 : 12] ?? '#ffec6e';
    ctx.beginPath();
    ctx.moveTo(0, -(this.fast ? 3 : 2));
    ctx.lineTo(-Math.round(length), 0);
    ctx.lineTo(0, this.fast ? 3 : 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = this.spec.palette[15] ?? '#fff1a8';
    ctx.fillRect(-Math.round(length * 0.55), -1, Math.max(2, Math.round(length * 0.45)), 2);
    ctx.restore();
  }

  private drawPlayerWeaponGlow(centerX: number, centerY: number): void {
    if (!this.spread && !this.rapid) return;
    const muzzle = this.playerMuzzleAt(centerX, centerY);
    const pulse = 0.5 + (Math.sin(this.animT * 18) + 1) * 0.2;
    const ctx = this.engine.renderer.ctx;
    ctx.save();
    ctx.fillStyle = this.spec.palette[this.rapid ? 15 : 14] ?? '#fff1a8';
    ctx.globalAlpha = pulse;
    const size = this.spread ? 4 : 3;
    ctx.fillRect(Math.round(muzzle.x - size / 2), Math.round(muzzle.y - size / 2), size, size);
    ctx.restore();
  }

  private drawPlayerShield(centerX: number, centerY: number): void {
    const renderer = this.engine.renderer;
    const ctx = this.engine.renderer.ctx;
    const breath = (Math.sin(this.animT * 4.5) + 1) / 2;
    ctx.save();
    ctx.translate(Math.round(centerX), Math.round(centerY));
    ctx.rotate(this.playerCraftBank());
    ctx.translate(-Math.round(centerX), -Math.round(centerY));
    renderer.drawSilhouetteAura(
      this.playerShieldAura,
      centerX - GENERATED_HSHOOTER_PLAYER_DRAW_SIZE.w / 2,
      centerY - GENERATED_HSHOOTER_PLAYER_DRAW_SIZE.h / 2,
      GENERATED_HSHOOTER_PLAYER_DRAW_SIZE.w,
      GENERATED_HSHOOTER_PLAYER_DRAW_SIZE.h,
      [
        { radius: 1, alpha: 0.76 + breath * 0.14 },
        { radius: 3, alpha: 0.3 + breath * 0.1 },
        { radius: 4, alpha: 0.1 + breath * 0.06 },
      ],
    );
    ctx.restore();
  }

  private chargeStreamPoint(
    muzzle: { x: number; y: number },
    path: HShooterChargeStreamPath,
    progress: number,
    laneIndex: number,
  ): { x: number; y: number } {
    const t = clamp(progress, 0, 1);
    const inverse = 1 - t;
    const sway = Math.sin(this.animT * (4.1 + laneIndex * 0.35) + t * 5 + laneIndex) * inverse;
    return {
      x:
        muzzle.x +
        inverse * inverse * path.startX +
        2 * inverse * t * path.controlX +
        sway * (laneIndex % 2 === 0 ? 1.5 : -1.5),
      y:
        muzzle.y +
        inverse * inverse * path.startY +
        2 * inverse * t * path.controlY +
        sway * (laneIndex < 2 ? 1.2 : -1.2),
    };
  }

  private chargeStreamPath(laneIndex: number, cycle: number): HShooterChargeStreamPath {
    const seed = laneIndex * 19.19 + cycle * 37.71;
    const angle = chargeStreamNoise(seed) * Math.PI * 2;
    const radius = 22 + chargeStreamNoise(seed + 1) * 16;
    const bend = (chargeStreamNoise(seed + 2) - 0.5) * 20;
    const startX = Math.cos(angle) * radius;
    const startY = Math.sin(angle) * radius * 0.72;
    return {
      startX,
      startY,
      controlX: startX * 0.52 - Math.sin(angle) * bend,
      controlY: startY * 0.52 + Math.cos(angle) * bend * 0.72,
    };
  }

  private drawChargeStream(
    muzzle: { x: number; y: number },
    laneIndex: number,
    chargeProgress: number,
    outerColor: string,
    innerColor: string,
  ): void {
    const ctx = this.engine.renderer.ctx;
    const cadence = 0.48 + (laneIndex % 5) * 0.055 + chargeProgress * 0.18;
    const elapsed = this.animT * cadence + laneIndex * 0.137;
    const cycle = Math.floor(elapsed);
    const cycleProgress = elapsed - cycle;
    const activePortion = 0.48 + chargeProgress * 0.2;
    if (cycleProgress >= activePortion) return;

    const life = cycleProgress / activePortion;
    const fadeIn = clamp(life / 0.18, 0, 1);
    const fadeOut = clamp((1 - life) / 0.24, 0, 1);
    const visibility = fadeIn * fadeOut;
    if (visibility <= 0.01) return;

    const path = this.chargeStreamPath(laneIndex, cycle);
    const head = clamp(0.06 + life * 1.08, 0, 1);
    const tail = Math.max(0, head - (0.14 + chargeProgress * 0.12));
    const trace = (from: number, to: number, samples: number) => {
      ctx.beginPath();
      for (let sample = 0; sample <= samples; sample++) {
        const progress = from + (to - from) * (sample / samples);
        const point = this.chargeStreamPoint(muzzle, path, progress, laneIndex);
        if (sample === 0) ctx.moveTo(Math.round(point.x), Math.round(point.y));
        else ctx.lineTo(Math.round(point.x), Math.round(point.y));
      }
      ctx.stroke();
    };

    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = outerColor;
    ctx.lineWidth = this.chargeReady ? 4 : 3;
    ctx.globalAlpha = visibility * (0.24 + chargeProgress * 0.34);
    trace(tail, head, 5);
    ctx.strokeStyle = innerColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = visibility * (0.68 + chargeProgress * 0.32);
    trace(tail, head, 5);

    const mote = this.chargeStreamPoint(muzzle, path, head, laneIndex);
    const moteSize = this.chargeReady || head > 0.82 ? 2 : 1;
    ctx.fillStyle = innerColor;
    ctx.globalAlpha = visibility * 0.9;
    ctx.fillRect(
      Math.round(mote.x - moteSize / 2),
      Math.round(mote.y - moteSize / 2),
      moteSize,
      moteSize,
    );
    ctx.restore();
  }

  private drawPlayerCharge(centerX: number, centerY: number): void {
    const progress = Math.min(1, this.chargeT / CHARGE_TIME);
    const muzzle = this.playerMuzzleAt(centerX, centerY);
    const color = this.spec.palette[this.chargeReady ? 15 : 14] ?? '#f4f4f4';
    const streamColor = this.spec.palette[4] ?? color;
    const pulse = (Math.sin(this.animT * (this.chargeReady ? 28 : 16)) + 1) * 0.5;
    const radius = 3 + progress * 6 + pulse * (this.chargeReady ? 2 : 1);
    const ctx = this.engine.renderer.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let index = 0; index < HSHOOTER_CHARGE_STREAM_COUNT; index++) {
      this.drawChargeStream(muzzle, index, progress, streamColor, color);
    }
    const gradient = ctx.createRadialGradient(
      Math.round(muzzle.x),
      Math.round(muzzle.y),
      0,
      Math.round(muzzle.x),
      Math.round(muzzle.y),
      radius,
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.28, color);
    gradient.addColorStop(0.72, `${color}aa`);
    gradient.addColorStop(1, `${color}00`);
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.72 + progress * 0.28;
    ctx.beginPath();
    ctx.arc(Math.round(muzzle.x), Math.round(muzzle.y), radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Rotate top-down library art into the horizontal flight plane. */
  private drawHorizontal(
    img: CanvasImageSource,
    cx: number,
    cy: number,
    w: number,
    h: number,
    flipAcrossLane = false,
  ): void {
    const ctx = this.engine.renderer.ctx;
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(cy));
    if (flipAcrossLane) ctx.scale(1, -1);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /** Draw native side-view enemy art; homing craft pitch into their real screen path. */
  private drawGeneratedEnemy(enemy: Foe): void {
    if (!this.generatedEnemyAtlas) return;
    const ctx = this.engine.renderer.ctx;
    const size = GENERATED_HSHOOTER_ENEMY_DRAW_SIZE[enemy.type];
    ctx.save();
    ctx.translate(Math.round(enemy.x - this.engine.camera.x), Math.round(enemy.y));
    if (enemy.type === 'kamikaze' && enemy.state === ST_HOMING) {
      const screenVx = enemy.vx - (this.isBoss() ? 0 : this.level.scroll);
      ctx.rotate(hshooterEnemyTravelRotation(screenVx, enemy.vy + enemy.avoidVy));
    }
    if (enemy.type === 'turret' && enemy.mount === 'ceiling') ctx.scale(1, -1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.generatedEnemyAtlas,
      generatedHShooterEnemyAtlasX(enemy.type),
      0,
      GENERATED_HSHOOTER_ENEMY_ATLAS_CELL_SIZE,
      GENERATED_HSHOOTER_ENEMY_ATLAS_CELL_SIZE,
      -size.w / 2,
      -size.h / 2,
      size.w,
      size.h,
    );
    ctx.restore();
  }

  /** One rigid craft gains banking from movement without paying for pose calls. */
  private drawGeneratedPlayerCraft(img: CanvasImageSource, cx: number, cy: number): void {
    const ctx = this.engine.renderer.ctx;
    const { w: width, h: height } = GENERATED_HSHOOTER_PLAYER_DRAW_SIZE;
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(cy));
    ctx.rotate(this.playerCraftBank());
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
}
