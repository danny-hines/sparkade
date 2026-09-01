// Sparkade shared constants — the numbers and names that form contracts between
// engine, archetypes, generation prompts, server validators and the shell.

/** Version of the hand-written engine substrate. Recorded in every game's meta.json. */
export const ENGINE_VERSION = '1.0.0';

/** game.json contract version (section 7 of the design doc). */
export const SPEC_VERSION = 1;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Internal render resolution; blitted once per frame at 2x integer scale to 1024x600. */
export const INTERNAL_WIDTH = 512;
export const INTERNAL_HEIGHT = 300;
export const DISPLAY_SCALE = 2;
export const TILE_SIZE = 16;

/** Adventure rooms remain single-screen, but fill most of the cabinet viewport.
 * These dimensions are shared by generation, validation, asset processing, and
 * runtime rendering so a room cannot silently target the legacy 24×12 grid. */
export const ADVENTURE_ROOM_COLUMNS = 32;
export const ADVENTURE_ROOM_ROWS = 16;
export const ADVENTURE_ROOM_WIDTH = ADVENTURE_ROOM_COLUMNS * TILE_SIZE;
export const ADVENTURE_ROOM_HEIGHT = ADVENTURE_ROOM_ROWS * TILE_SIZE;

/** Bounded platformer framing modes. Raw tile/camera scale is never model-authored. */
export const PLATFORMER_SCALES = ['compact', 'heroic'] as const;
export type PlatformerScale = (typeof PLATFORMER_SCALES)[number];

/** Source-art resolution, independent from an archetype's camera framing. */
export const GAMEPLAY_ART_DENSITIES = ['chunky', 'detailed'] as const;
export type GameplayArtDensity = (typeof GAMEPLAY_ART_DENSITIES)[number];

/** Compatibility name retained for the original platformer contract. */
export const PLATFORMER_ART_DENSITIES = GAMEPLAY_ART_DENSITIES;
export type PlatformerArtDensity = GameplayArtDensity;

// ---------------------------------------------------------------------------
// Performance budgets (validators reject specs that exceed them; engine enforces at runtime)
// ---------------------------------------------------------------------------

export const BUDGET = {
  maxActiveEntities: 24,
  maxParticles: 120,
  maxLevelWidthTiles: 256,
  maxAudioVoices: 8,
} as const;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const LOGICAL_BUTTONS = [
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'A',
  'B',
  'X',
  'Y',
  'L',
  'R',
  'START',
  'SELECT',
] as const;
export type LogicalButton = (typeof LOGICAL_BUTTONS)[number];

/** Default keyboard map (KeyboardEvent.code → logical button). Arrows = d-pad, X=A, Z=B, A=X, S=Y, Q=L, W=R, Enter=START, RShift=SELECT. */
export const DEFAULT_KEYBOARD_MAP: Record<string, LogicalButton> = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyX: 'A',
  KeyZ: 'B',
  KeyA: 'X',
  KeyS: 'Y',
  KeyQ: 'L',
  KeyW: 'R',
  Enter: 'START',
  ShiftRight: 'SELECT',
};

/**
 * Default gamepad map (button index → logical button) assuming the W3C "standard"
 * layout. Zero Delay encoders rarely report a standard mapping — the first-boot
 * remap wizard exists precisely for them; this is only the shipping guess.
 */
export const DEFAULT_GAMEPAD_MAP: Record<number, LogicalButton> = {
  0: 'B', // bottom face — SNES B position
  1: 'A',
  2: 'Y',
  3: 'X',
  4: 'L',
  5: 'R',
  8: 'SELECT',
  9: 'START',
  12: 'UP',
  13: 'DOWN',
  14: 'LEFT',
  15: 'RIGHT',
};

/** Menu auto-repeat: first repeat after 350 ms, then every 100 ms. */
export const MENU_REPEAT_DELAY_MS = 350;
export const MENU_REPEAT_INTERVAL_MS = 100;

/** Hold any single input this long from a shell menu to open the remap wizard. */
export const REMAP_HOLD_MS = 5000;
export const REMAP_HINT_MS = 2000;

/** Hold START this long in-game for the guaranteed shell escape. */
export const ESCAPE_HOLD_MS = 2000;

/** Hold A this long to confirm a game delete. */
export const DELETE_HOLD_MS = 3000;

/** Menu screens idle back to Attract after this long (never during generation/gameplay). */
export const ATTRACT_IDLE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Game feel (baked into the substrate so every generated game inherits it)
// ---------------------------------------------------------------------------

export const FEEL = {
  coyoteMs: 80,
  jumpBufferMs: 100,
  hitStopMs: 60,
  screenShakeMs: 180,
  invulnMs: 1200,
  damageFlashMs: 100,
} as const;

// Difficulty: the design stage picks one; archetypes scale enemy aggression from
// it. Deliberately conservative and geometry-neutral — it only touches enemy hp
// and fire cadence, never level layout, entity counts, or the jump kernel, so it
// can't make a validated level unsolvable.
export const DIFFICULTIES = ['chill', 'standard', 'spicy'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export interface DifficultyScale {
  /** enemy hp multiplier (clamp to ≥1 after rounding at the call site) */
  hp: number;
  /** enemy fire-cadence multiplier: >1 = faster (more shots/sec / shorter interval) */
  fire: number;
}
export function difficultyScale(d: Difficulty | undefined): DifficultyScale {
  switch (d) {
    case 'chill':
      return { hp: 0.8, fire: 0.8 };
    case 'spicy':
      return { hp: 1.3, fire: 1.3 };
    default:
      return { hp: 1, fire: 1 };
  }
}

// Hero feel (platformer): per-game movement character. Deliberately one-sided —
// the knobs only ever make the hero float / jump / run MORE than baseline, never
// less, so the reachability lint's fixed jump kernel (4 across, 3 up) stays a
// lower bound and any level it passes remains solvable at runtime. resolveHeroFeel
// clamps to the safe ranges in the engine, so an out-of-range or hand-edited spec
// can't shrink reach below the kernel.
export interface HeroFeel {
  gravityScale?: number; // 0.72–1.0 — lower = floatier, more airtime
  jumpScale?: number; // 1.0–1.25 — higher = taller jump
  speedScale?: number; // 1.0–1.3 — higher = faster run
}
export function resolveHeroFeel(f: HeroFeel | undefined): {
  gravity: number;
  jump: number;
  speed: number;
} {
  const clamp = (v: number | undefined, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v ?? 1));
  return {
    gravity: clamp(f?.gravityScale, 0.72, 1.0),
    jump: clamp(f?.jumpScale, 1.0, 1.25),
    speed: clamp(f?.speedScale, 1.0, 1.3),
  };
}

/**
 * Authored platformer movement styles. The model chooses a name instead of
 * tuning physics numbers directly; the engine owns the bounded values below.
 */
export const PLATFORMER_MOVEMENT_PROFILES = [
  'balanced',
  'precision',
  'momentum',
  'floaty',
  'heavy',
] as const;
export type PlatformerMovementProfile = (typeof PLATFORMER_MOVEMENT_PROFILES)[number];

export interface ResolvedPlatformerMovement {
  /** Multipliers applied to the platformer's baseline movement constants. */
  gravity: number;
  jump: number;
  speed: number;
  groundAcceleration: number;
  groundBraking: number;
  airControl: number;
  airBraking: number;
  terminalVelocity: number;
  jumpCutoff: number;
}

const PLATFORMER_MOVEMENT_VALUES: Record<PlatformerMovementProfile, ResolvedPlatformerMovement> = {
  balanced: {
    gravity: 1,
    jump: 1,
    speed: 1,
    groundAcceleration: 1,
    groundBraking: 1,
    airControl: 0.65,
    airBraking: 0.65,
    terminalVelocity: 1,
    jumpCutoff: 1,
  },
  precision: {
    gravity: 1,
    jump: 1,
    speed: 1.03,
    groundAcceleration: 1.45,
    groundBraking: 1.8,
    airControl: 0.95,
    airBraking: 1.05,
    terminalVelocity: 1,
    jumpCutoff: 0.78,
  },
  momentum: {
    gravity: 0.92,
    jump: 1.05,
    speed: 1.16,
    groundAcceleration: 1,
    groundBraking: 0.35,
    airControl: 0.5,
    airBraking: 0.12,
    terminalVelocity: 1,
    jumpCutoff: 1.1,
  },
  floaty: {
    gravity: 0.74,
    jump: 1.08,
    speed: 1,
    groundAcceleration: 1.08,
    groundBraking: 1,
    airControl: 0.9,
    airBraking: 0.3,
    terminalVelocity: 0.78,
    jumpCutoff: 0.72,
  },
  heavy: {
    gravity: 1.1,
    jump: 1.1,
    speed: 1.1,
    groundAcceleration: 1.35,
    groundBraking: 1.55,
    airControl: 0.65,
    airBraking: 0.7,
    terminalVelocity: 1.2,
    jumpCutoff: 0.85,
  },
};

/**
 * Resolve model-authored movement into engine-owned physics. Legacy `feel`
 * remains a safe, one-sided overlay so existing saved games keep their exact
 * movement while new games can use the richer named profiles.
 */
export function resolvePlatformerMovement(
  profile: PlatformerMovementProfile | undefined,
  legacyFeel?: HeroFeel,
): ResolvedPlatformerMovement {
  const base = PLATFORMER_MOVEMENT_VALUES[profile ?? 'balanced'];
  const legacy = resolveHeroFeel(legacyFeel);
  return {
    gravity: base.gravity * legacy.gravity,
    jump: base.jump * legacy.jump,
    speed: base.speed * legacy.speed,
    groundAcceleration: base.groundAcceleration * legacy.speed,
    groundBraking: base.groundBraking * legacy.speed,
    airControl: base.airControl * legacy.speed,
    airBraking: base.airBraking * legacy.speed,
    terminalVelocity: base.terminalVelocity,
    jumpCutoff: base.jumpCutoff,
  };
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/** Canonical SFX event names every game uses. Engine ships defaults; specs may override any. */
export const SFX_EVENTS = [
  'jump',
  'shoot',
  'hit',
  'hurt',
  'die',
  'pickup',
  'powerup',
  'uiMove',
  'uiSelect',
  'uiBack',
  'win',
  'lose',
] as const;
export type SfxEvent = (typeof SFX_EVENTS)[number];

/** Music ducks to this fraction while a jingle plays. */
export const JINGLE_DUCK = 0.3;

// ---------------------------------------------------------------------------
// Archetypes
// ---------------------------------------------------------------------------

export const ARCHETYPE_IDS = ['platformer', 'shooter', 'adventure', 'hshooter', 'fighter'] as const;
export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

/** Minimum estimated interactive play time (seconds) — the five-minute rule. */
export const MIN_DURATION_S = 300;

// ---------------------------------------------------------------------------
// Likeness pipeline
// ---------------------------------------------------------------------------

export const HEAD_SPRITE_SIZES = [12, 16] as const;
export const PORTRAIT_SIZE = 64;
export const MAX_PHOTO_DIM = 512;

/**
 * The face-framing oval, as fractions of the captured SQUARE photo. The
 * wizard's on-screen guide and the server's likeness crop both derive from
 * these numbers — they must never drift apart, or players frame one region
 * and the bake grabs another. Slightly taller than wide (ry/rx ≈ 1.27): the
 * fill-resize to a square head rounds the face a touch, chibi-style.
 */
export const LIKENESS_OVAL = { cx: 0.5, cy: 0.45, rx: 0.22, ry: 0.28 } as const;

// ---------------------------------------------------------------------------
// Generation pipeline
// ---------------------------------------------------------------------------

export const GENERATION = {
  perCallTimeoutMs: 90_000,
  softBudgetMs: 6 * 60 * 1000, // "taking longer than usual"
  hardBudgetMs: 12 * 60 * 1000, // image-aware fail timeout (retryable)
  maxRepairAttemptsPerStage: 2,
  /** Surgical patches are cheap on Contributor tier. Keep following useful
   * progress, but cap both calls and cumulative job spend before falling back. */
  maxRepairCallsPerAttempt: 8,
  repairCostBudgetUsd: 0.25,
  maxTransientRetriesPerCall: 2,
  maxRecordingSeconds: 45,
  /** Anti-collision block includes the last N local games. */
  antiCollisionGames: 10,
  /** How many generation jobs run at once. Generation is network-bound (waiting
   *  on the model), so a few in parallel overlap those waits; kept small to stay
   *  gentle on the cabinet + the API. Override with SPARKADE_GEN_CONCURRENCY. */
  maxConcurrentJobs: 3,
  /** Shared across jobs. The default allows substantial parallelism without
   * making stress-test values the cabinet baseline; override with
   * SPARKADE_IMAGE_CONCURRENCY when testing provider limits. */
  maxConcurrentImageCalls: 16,
} as const;

export const STAGE_NAMES = ['design', 'levels', 'entities', 'music', 'repair', 'stt'] as const;
export type StageName = (typeof STAGE_NAMES)[number];

/** Job progress stages, in display order (shown honestly in the UI). */
export const JOB_STAGES = [
  'queued',
  'designing',
  'writing-spec',
  'validating',
  'repairing',
  'building-assets',
  'done',
  'failed',
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** Published Meta Model API pricing (USD per million tokens).
 *  Keep historical rows so existing game ledgers remain interpretable. */
export const DEFAULT_PRICING: Record<
  string,
  { inputPerM: number; outputPerM: number; cachedInputPerM?: number }
> = {
  'muse-spark-1.1': { inputPerM: 1.25, outputPerM: 4.25, cachedInputPerM: 0.15 },
  'muse-spark-1.2-contributor': { inputPerM: 0.1, outputPerM: 0.2, cachedInputPerM: 0.002 },
};

export const DEFAULT_MODEL = 'muse-spark-1.2-contributor';

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export const DEFAULT_PORT = 8080;
export const DEFAULT_BIND = '127.0.0.1';

/** Stable filenames for image-model-authored game art. These names are also the
 * HTTP allowlist; a manifest can never escape a game's assets directory. */
export const GENERATED_GAME_ASSET_FILES = {
  generatedPortrait: 'portrait.png',
  generatedPortraitDefeat: 'portrait-defeat.png',
  generatedHead12: 'head12.png',
  generatedHead12Side: 'head12-side.png',
  generatedHead12Back: 'head12-back.png',
  generatedHead16: 'head16.png',
  generatedHead16Side: 'head16-side.png',
  generatedHead16Back: 'head16-back.png',
  keyArt: 'key-art.png',
  storyIntro: 'story-intro.png',
  storyBoss: 'story-boss.png',
  storyVictory: 'story-victory.png',
  storyDefeat: 'story-defeat.png',
  hshooterPlayerCraft: 'hshooter-player-craft.png',
  hshooterBoss: 'hshooter-boss.png',
  hshooterEnemyAtlas: 'hshooter-enemy-atlas.png',
  shooterPlayerCraft: 'shooter-player-craft.png',
  shooterBoss: 'shooter-boss.png',
  shooterEnemyAtlas: 'shooter-enemy-atlas.png',
  fighterPlayerAtlas: 'fighter-player-atlas.png',
  fighterOpponent1Atlas: 'fighter-opponent-1-atlas.png',
  fighterOpponent2Atlas: 'fighter-opponent-2-atlas.png',
  fighterOpponent3Atlas: 'fighter-opponent-3-atlas.png',
  fighterBossAtlas: 'fighter-boss-atlas.png',
  fighterArenaAtlas: 'fighter-arena-atlas.png',
  platformerIdle: 'platformer-player-idle.png',
  platformerSideIdle: 'platformer-player-side-idle.png',
  platformerWalk1: 'platformer-player-walk-1.png',
  platformerWalk2: 'platformer-player-walk-2.png',
  platformerJump: 'platformer-player-jump.png',
  platformerBoss: 'platformer-boss.png',
  platformerEnemyWalker: 'platformer-enemy-walker.png',
  platformerEnemyFlyer: 'platformer-enemy-flyer.png',
  platformerEnemyShooter: 'platformer-enemy-shooter.png',
  platformerEnemyChaser: 'platformer-enemy-chaser.png',
  platformerPropCollectible: 'platformer-prop-collectible.png',
  platformerPropHealth: 'platformer-prop-health.png',
  platformerPropPowerup: 'platformer-prop-powerup.png',
  platformerPropPowerupDoubleJump: 'platformer-prop-powerup-double-jump.png',
  platformerPropPowerupProjectile: 'platformer-prop-powerup-projectile.png',
  platformerPropPowerupShield: 'platformer-prop-powerup-shield.png',
  platformerPropHeroProjectile: 'platformer-prop-hero-projectile.png',
  platformerPropEnemyProjectile: 'platformer-prop-enemy-projectile.png',
  platformerBackdropLevel1: 'platformer-backdrop-level-1.png',
  platformerBackdropLevel2: 'platformer-backdrop-level-2.png',
  platformerBackdropLevel3: 'platformer-backdrop-level-3.png',
  platformerBackdropBoss: 'platformer-backdrop-boss.png',
  hshooterBackdropLevel1: 'hshooter-backdrop-level-1.png',
  hshooterBackdropLevel2: 'hshooter-backdrop-level-2.png',
  hshooterBackdropLevel3: 'hshooter-backdrop-level-3.png',
  hshooterBackdropBoss: 'hshooter-backdrop-boss.png',
  shooterBackdropLevel1: 'shooter-backdrop-level-1.png',
  shooterBackdropLevel2: 'shooter-backdrop-level-2.png',
  shooterBackdropLevel3: 'shooter-backdrop-level-3.png',
  shooterBackdropBoss: 'shooter-backdrop-boss.png',
  adventureRoomPlates: 'adventure-room-plates.png',
  adventureBoss: 'adventure-boss.png',
  adventureEnemyAtlas: 'adventure-enemy-atlas.png',
  adventureObjectAtlas: 'adventure-object-atlas.png',
  adventurePlayerDownIdle: 'adventure-player-down-idle.png',
  adventurePlayerDownWalk: 'adventure-player-down-walk.png',
  adventurePlayerUpIdle: 'adventure-player-up-idle.png',
  adventurePlayerUpWalk: 'adventure-player-up-walk.png',
  adventurePlayerSideIdle: 'adventure-player-side-idle.png',
  adventurePlayerSideWalk: 'adventure-player-side-walk.png',
  adventurePlayerDownMelee: 'adventure-player-down-melee.png',
  adventurePlayerUpMelee: 'adventure-player-up-melee.png',
  adventurePlayerSideMelee: 'adventure-player-side-melee.png',
  adventurePlayerDownSecondary: 'adventure-player-down-secondary.png',
  adventurePlayerUpSecondary: 'adventure-player-up-secondary.png',
  adventurePlayerSideSecondary: 'adventure-player-side-secondary.png',
  // Legacy, read-only compatibility: an experimental pipeline emitted these
  // files for a small number of saved games. New generations no longer create
  // them and the runtime intentionally ignores them in favor of curated packs,
  // but retaining the allowlist entries keeps the rest of those manifests valid.
  platformerTerrainCheckpoint: 'platformer-terrain-checkpoint.png',
  platformerTerrainDecoration: 'platformer-terrain-decoration.png',
  platformerTerrainExit: 'platformer-terrain-exit.png',
  platformerTerrainHazard: 'platformer-terrain-hazard.png',
  platformerTerrainMovingPlatform: 'platformer-terrain-moving-platform.png',
  platformerTerrainPlatform: 'platformer-terrain-platform.png',
  platformerTerrainSolidCap: 'platformer-terrain-solid-cap.png',
  platformerTerrainSolidInner: 'platformer-terrain-solid-inner.png',
} as const;

export type GeneratedGameAssetRole = keyof typeof GENERATED_GAME_ASSET_FILES;

/** Runtime and generation contract for each generated Fighter roster atlas. */
export const GENERATED_FIGHTER_ATLAS_CELL_SIZE = 96;
export const GENERATED_FIGHTER_ATLAS_COLUMNS = 4;
export const GENERATED_FIGHTER_ROSTER_SIZE = 5;
export const GENERATED_FIGHTER_ARENA_WIDTH = 512;
export const GENERATED_FIGHTER_ARENA_HEIGHT = 300;
export const GENERATED_FIGHTER_ARENA_PANELS = 2;
/** Stable presentation treatment shared by server-baked and legacy runtime arenas. */
export const GENERATED_FIGHTER_ARENA_BRIGHTNESS = 0.82;
export const GENERATED_FIGHTER_ARENA_SATURATION = 0.85;
export const FIGHTER_POSES = [
  'idle',
  'walk',
  'crouch',
  'jump',
  'punchHigh',
  'punchLow',
  'kickHigh',
  'kickLow',
  'airPunch',
  'airKick',
  'block',
  'hit',
  'ko',
] as const;
export type FighterPose = (typeof FIGHTER_POSES)[number];

// ---------------------------------------------------------------------------
// Built-in sprite library ids (the contract between engine art, schemas,
// prompts and golden games — `lib:<id>` references must come from this list;
// the engine unit tests assert its library implements every id).
// ---------------------------------------------------------------------------

export const LIB_HEROES_PLATFORMER = [
  'hero_squire',
  'hero_gadget',
  'hero_ranger',
  'hero_miner',
  'hero_astro',
  'hero_ninja',
] as const;
export const LIB_HEROES_ADVENTURE = [
  'hero_wander',
  'hero_scout',
  'hero_sage',
  'hero_paladin',
  'hero_druid',
  'hero_tinker',
] as const;
export const LIB_SHIPS = [
  'ship_dart',
  'ship_falcon',
  'ship_bloom',
  'ship_saucer',
  'ship_manta',
  'ship_hammer',
] as const;

export const LIB_ENEMIES_GROUND = [
  'enemy_walker',
  'enemy_flyer',
  'enemy_shooter',
  'enemy_chaser',
  'enemy_bruiser',
  'enemy_slime',
  'enemy_beetle',
  'enemy_wisp',
] as const;

export const LIB_FOES_SHOOTER = [
  'foe_popcorn',
  'foe_weaver',
  'foe_tank',
  'foe_turret',
  'foe_kamikaze',
  'foe_drone',
  'foe_ray',
  'foe_orbiter',
] as const;

// Bosses split by SILHOUETTE, not just orientation. The 8 creature/humanoid
// bosses read as front-facing figures, so they work both side-view (platformer)
// and top-down 3/4 (adventure) — both archetypes draw from the same pool, which
// doubles boss variety from existing art. The 4 vehicle bosses are top-down
// craft for the shmups. (boss_titan is intentionally LAST — it was the reflexive
// default pick that made every platformer boss look the same.)
export const LIB_BOSSES_CREATURE = [
  'boss_knight',
  'boss_drake',
  'boss_minotaur',
  'boss_thorn',
  'boss_lich',
  'boss_warden',
  'boss_spider',
  'boss_kraken',
  'boss_wraith',
  'boss_ooze',
  'boss_automaton',
  'boss_cyclops',
  'boss_toad',
  'boss_treant',
  'boss_beholder',
  'boss_demon',
  'boss_hydra',
  'boss_pharaoh',
  'boss_yeti',
  'boss_scorpion',
  'boss_gorgon',
  'boss_titan',
] as const;
export const LIB_BOSSES_SHOOTER = [
  'boss_leviathan',
  'boss_fortress',
  'boss_hive',
  'boss_prism',
  'boss_saucer',
  'boss_core',
  'boss_dreadnought',
  'boss_mecha',
  'boss_wasp',
  'boss_bomber',
] as const;
export const LIB_BOSSES_PLATFORMER = LIB_BOSSES_CREATURE;
export const LIB_BOSSES_ADVENTURE = LIB_BOSSES_CREATURE;

export const LIB_BOSSES: readonly string[] = [...LIB_BOSSES_CREATURE, ...LIB_BOSSES_SHOOTER];

export const LIB_PROJECTILES = [
  'proj_pellet',
  'proj_orb',
  'proj_arrow',
  'proj_bolt',
  'proj_bomb',
  'proj_wave',
] as const;

export const LIB_PICKUPS = [
  'pickup_coin',
  'pickup_heart',
  'pickup_key',
  'pickup_power',
  'pickup_gem',
  'pickup_bomb',
  'pickup_shield',
  'pickup_spread',
  'pickup_rapid',
  'pickup_star',
] as const;

export const LIB_ITEMS = ['item_boomerang', 'item_bombs', 'item_bow'] as const;

export const LIB_NPCS = [
  'npc_keeper',
  'npc_elder',
  'npc_merchant',
  'npc_ghost',
  'npc_tinker',
] as const;

export const LIB_OBJECTS = ['obj_spring', 'obj_platform'] as const;

export const LIB_TILE_KINDS = [
  'solid',
  'solid_inner',
  'platform',
  'hazard',
  'checkpoint',
  'exit',
  'deco',
  'wall',
  'floor',
  'block',
  'pit',
  'switch',
  'door_locked',
  'door_boss',
  'door_open',
] as const;

export const LIB_TILES = LIB_TILE_KINDS.map((k) => `tile_${k}`);

/**
 * Core themed tile families available to every tiled archetype. Legacy art
 * uses semantic game colors; platformers transparently upgrade these refs to
 * source-authored, game-harmonized HD art. A spec reskins terrain via sprites.assign, e.g.
 * `"tile_solid": "lib:castle_solid"` (or a custom 16×16 sprite).
 */
export const LIB_TILE_THEMES = [
  'castle',
  'cave',
  'wasteland',
  'alien',
  'ice',
  'desert',
  'clockwork',
  'candy',
  'coral',
  'garden',
] as const;

/** Additional Muse-authored terrain families beyond the original core set. */
export const LIB_HD_TILE_THEMES = [
  'city',
  'circuitry',
  'volcano',
  'jungle',
  'spaceship',
  'haunted',
  'sky',
  'industrial',
] as const;

/** Compatibility name retained for existing platformer authoring tools. */
export const LIB_PLATFORMER_ONLY_TILE_THEMES = LIB_HD_TILE_THEMES;

export const LIB_PLATFORMER_TILE_THEMES = [...LIB_TILE_THEMES, ...LIB_HD_TILE_THEMES] as const;

export const LIB_PLATFORMER_TILE_KINDS = [
  'solid',
  'solid_inner',
  'platform',
  'hazard',
  'checkpoint',
  'exit',
  'deco',
] as const;

export const LIB_THEMED_TILES: readonly string[] = LIB_TILE_THEMES.flatMap((theme) =>
  LIB_TILE_KINDS.map((k) => `${theme}_${k}`),
);

export const LIB_PLATFORMER_ONLY_TILES: readonly string[] = LIB_PLATFORMER_ONLY_TILE_THEMES.flatMap(
  (theme) => LIB_PLATFORMER_TILE_KINDS.map((kind) => `${theme}_${kind}`),
);

export const LIB_SPRITE_IDS: readonly string[] = [
  ...LIB_HEROES_PLATFORMER,
  ...LIB_HEROES_ADVENTURE,
  ...LIB_SHIPS,
  ...LIB_ENEMIES_GROUND,
  ...LIB_FOES_SHOOTER,
  ...LIB_BOSSES,
  ...LIB_PROJECTILES,
  ...LIB_PICKUPS,
  ...LIB_ITEMS,
  ...LIB_NPCS,
  ...LIB_OBJECTS,
  ...LIB_TILES,
  ...LIB_THEMED_TILES,
  ...LIB_PLATFORMER_ONLY_TILES,
];

/**
 * Procedural backdrop variants (engine `makeBackdrop`). Source of truth shared
 * with the archetype schemas' optional `backdrop` field (a unit test enforces
 * the enums match) so the model can pick a variant that fits the theme.
 */
export const BACKDROP_VARIANTS = [
  'starfield',
  'hills',
  'clouds',
  'caves',
  'mountains',
  'candy',
  'city',
  'ruins',
  'pyramids',
  'circuit',
  'factory',
] as const;

export type BackdropVariantId = (typeof BACKDROP_VARIANTS)[number];

/**
 * VERTICAL-scroll backdrop variants for the shooter archetype (engine
 * `makeScrollBackdrop`). The shared BACKDROP_VARIANTS above are all horizontal,
 * horizon-anchored side-scroll scenes — wrong for a top-down vertical shmup, so
 * a space shooter could only ever pick 'starfield'. These are top-down /
 * fly-through scenes that tile VERTICALLY. Source of truth shared with
 * shooter.schema.json's `backdrop` enum (a unit test enforces the match).
 * Grouped: space · aerial/terrestrial · hazard/exotic.
 */
export const SHOOTER_BACKDROP_VARIANTS = [
  'deepspace',
  'clouds',
  'nebula',
  'asteroids',
  'ocean',
  'metropolis',
  'canyon',
  'swamp',
  'tundra',
] as const;

export type ShooterBackdropId = (typeof SHOOTER_BACKDROP_VARIANTS)[number];

/**
 * Procedural weather / ambient-particle overlays (engine `makeWeather`), drawn
 * over gameplay and under the HUD in the game's palette colors. Source of truth
 * shared with the archetype schemas' optional `weather` field (a unit test
 * enforces the enums match). Default is 'none' — purely additive, so games
 * without the field render exactly as before.
 */
export const WEATHER_KINDS = [
  'none',
  'rain',
  'storm',
  'snow',
  'embers',
  'ash',
  'leaves',
  'petals',
  'fog',
  'bubbles',
  'fireflies',
  'dust',
] as const;

export type WeatherKind = (typeof WEATHER_KINDS)[number];

/**
 * Per-game lighting mood: a translucent color wash over the scene (drawn under
 * the weather + HUD so they stay legible), for day/night/sunset variety.
 * 'none' = untinted. The enum in all three archetype schema JSONs must
 * byte-match this list (enforced by schemas.test.ts).
 */
export const LIGHTING_MODES = ['none', 'dawn', 'dusk', 'night', 'gloom'] as const;

export type LightingMode = (typeof LIGHTING_MODES)[number];

/**
 * Palette slot conventions. Library art and prompt templates agree on these
 * semantics so any generated 16-color palette recolors everything coherently.
 */
export const PALETTE_SLOTS = [
  'transparent', // 0 — always treated as transparent when drawing sprites
  'outline', // 1 — darkest; sprite outlines
  'bg-dark', // 2
  'bg-mid', // 3
  'bg-light', // 4
  'hero-primary', // 5
  'hero-secondary', // 6
  'hero-accent', // 7
  'enemy-primary', // 8
  'enemy-secondary', // 9
  'enemy-accent', // a
  'hazard', // b
  'accent-warm', // c
  'gold', // d
  'light', // e
  'white', // f
] as const;

// ---------------------------------------------------------------------------
// Built-in idea cards (six, family-friendly, two per archetype)
// ---------------------------------------------------------------------------

export interface IdeaCard {
  id: string;
  title: string;
  archetype: ArchetypeId;
  premise: string;
  tone: string;
}

export const IDEA_CARDS: readonly IdeaCard[] = [
  {
    id: 'gearheart-foundry',
    title: 'Gearheart Foundry',
    archetype: 'platformer',
    premise:
      'A wind-up hero re-lights the furnaces of a sleeping robot city, hopping across conveyor rooftops and gear towers.',
    tone: 'bright and plucky',
  },
  {
    id: 'marshmallow-mountain',
    title: 'Marshmallow Mountain',
    archetype: 'platformer',
    premise:
      'A campfire spirit bounces up a dessert peak of toasted cliffs and cocoa falls before sunrise melts the trail.',
    tone: 'cozy and warm',
  },
  {
    id: 'museum-of-lost-sounds',
    title: 'The Museum of Lost Sounds',
    archetype: 'adventure',
    premise:
      'After closing time, a junior curator must return escaped echoes to their exhibits in a museum where sound has gone missing.',
    tone: 'gentle-spooky',
  },
  {
    id: 'tidepool-kingdom',
    title: 'Tidepool Kingdom',
    archetype: 'adventure',
    premise:
      'A hermit-crab knight quests through coral halls to reclaim stolen shells from a smug seagull baron.',
    tone: 'playful and salty',
  },
  {
    id: 'static-storm',
    title: 'Static Storm',
    archetype: 'shooter',
    premise:
      'Pilot a paper plane through a thundercloud arcade, weaving between neon bolts to unplug the storm king.',
    tone: 'energetic and electric',
  },
  {
    id: 'garden-defense-orbit',
    title: 'Garden Defense Orbit',
    archetype: 'shooter',
    premise:
      'Protect a floating greenhouse from meteor-riding weeds with seed-shot volleys and sunflower shields.',
    tone: 'cheerful and green',
  },
];

// ---------------------------------------------------------------------------
// Deferred archetypes (post-MVP) — canonical control maps recorded so they
// don't get lost. See docs/EXTENDING.md for the extension interface.
// ---------------------------------------------------------------------------

export const DEFERRED_CONTROL_MAPS = {
  racing: {
    B: 'accelerate',
    Y: 'brake',
    A: 'item / boost',
    L: 'hop / drift',
    R: 'hop / drift',
  },
} as const;
