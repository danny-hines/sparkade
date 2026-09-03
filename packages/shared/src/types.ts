// Sparkade shared types. These mirror the JSON Schemas in ./schemas exactly —
// the schemas are the contract (embedded verbatim in LLM prompts); these types
// are the compile-time view of the same shapes.

import type {
  ArchetypeId,
  BackdropVariantId,
  Difficulty,
  GeneratedGameAssetRole,
  GameplayArtDensity,
  HeroFeel,
  JobStage,
  LightingMode,
  LogicalButton,
  PlatformerArtDensity,
  PlatformerMovementProfile,
  PlatformerScale,
  SfxEvent,
  ShooterBackdropId,
  StageName,
  WeatherKind,
} from './constants';

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

/** Palette-indexed pixel art: chars 0–f index the game palette, '.' = transparent. */
export interface SpriteData {
  w: number;
  h: number;
  rows: string[];
  /** Optional extra animation frames (same w×h as `rows`); the engine cycles
   *  [rows, ...frames] as an idle/walk animation instead of the auto-bob. */
  frames?: string[][];
  /** Heroes only: where the baked likeness head is composited onto this sprite
   *  (top-left in sprite pixels + which baked size). Lets a custom hero body
   *  still wear the player's face. */
  headSlot?: { x: number; y: number; size: 12 | 16 };
}

/** `lib:<id>` (built-in library) or `custom:<id>` (defined in sprites.custom). */
export type SpriteRef = string;

export interface SpritesBlock {
  custom: Record<string, SpriteData>;
  /** role → sprite ref. `hero` and `boss` are always present. */
  assign: Record<string, SpriteRef>;
}

/** Stable pieces surfaced to the generation screen as they finish, ahead of the
 *  atomic publish: the palette/title land at design time, sprites when the
 *  entities pass returns, music when the composer pass returns. Everything after
 *  `palette` is optional — the client shows whatever is present. */
export interface PartialSpec {
  archetype: string;
  title: string;
  tagline: string;
  palette: string[];
  sprites?: SpritesBlock;
  music?: MusicBlock;
}

// ---------------------------------------------------------------------------
// Story / meta / scoring
// ---------------------------------------------------------------------------

export interface GameMetaBlock {
  title: string;
  tagline: string;
  /** Canonical player visual/wardrobe brief retained with the published game
   * so regenerated presentation assets use the same character design. */
  heroConcept?: string;
}

export interface StoryBlock {
  intro: string[];
  levelIntros: string[];
  bossIntro: string;
  victory: string[];
  defeat: string[];
}

export interface ScoringBlock {
  events: {
    enemyKill: number;
    pickup: number;
    bossHit: number;
    levelClear: number;
  };
  timeBonusPerSecond: number;
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

export interface PulseInstrument {
  duty: 0.125 | 0.25 | 0.5;
  vol: number;
  decay: number;
}
export interface BassInstrument {
  vol: number;
  decay: number;
}
export interface DrumInstrument {
  vol: number;
}

export interface InstrumentsBlock {
  pulse1: PulseInstrument;
  pulse2: PulseInstrument;
  bass: BassInstrument;
  drums: DrumInstrument;
}

/**
 * A pattern is exactly 16 steps per channel.
 * Note steps: `"<note><octave>:<duration-in-16ths>"` (e.g. `"C4:2"`, `"Eb3:4"`) or `"-"` rest.
 * Drum steps: `"K" | "S" | "H" | "-"`.
 */
export interface MusicPattern {
  pulse1?: string[];
  pulse2?: string[];
  bass?: string[];
  drums?: string[];
}

export interface MusicBlock {
  bpm: number;
  key: string;
  instruments: InstrumentsBlock;
  patterns: Record<string, MusicPattern>;
  /** Ordered pattern references. `theme` and `boss` always exist. */
  songs: Record<string, string[]>;
  jingles: {
    victory: MusicPattern;
    gameover: MusicPattern;
    levelIntro: MusicPattern;
  };
}

// ---------------------------------------------------------------------------
// SFX (jsfxr-style synthesis parameters)
// ---------------------------------------------------------------------------

export interface SfxParams {
  wave: 'square' | 'saw' | 'sine' | 'noise' | 'triangle';
  /** Start frequency, Hz. */
  freq: number;
  /** Semitones per second of pitch slide. */
  freqSlide?: number;
  attack?: number;
  sustain?: number;
  decay: number;
  duty?: 0.125 | 0.25 | 0.5;
  vol?: number;
  vibratoDepth?: number;
  vibratoSpeed?: number;
  arpSemitones?: number;
  arpTime?: number;
  lowpass?: number;
}

export type SfxBlock = Partial<Record<SfxEvent, SfxParams>>;

// ---------------------------------------------------------------------------
// Platformer spec
// ---------------------------------------------------------------------------

export type PlatformerTileType =
  | 'empty'
  | 'solid'
  | 'ice'
  | 'conveyorLeft'
  | 'conveyorRight'
  | 'platform'
  | 'hazard'
  | 'checkpoint'
  | 'exit'
  | 'decoration';

export type PlatformerEntityType =
  | 'walker'
  | 'flyer'
  | 'shooter'
  | 'chaser'
  | 'spring'
  | 'movingPlatform'
  | 'coin'
  | 'heart'
  | 'powerup';

export const PLATFORMER_ABILITY_KINDS = ['doubleJump', 'projectile', 'shield'] as const;

export type PlatformerAbilityKind = (typeof PLATFORMER_ABILITY_KINDS)[number];

/** Story-specific presentation layered over one bounded platformer behavior. */
export interface PlatformerAbility {
  kind: PlatformerAbilityKind;
  name: string;
  visualConcept: string;
}

export interface PlatformerEntityProps {
  dir?: -1 | 1;
  speed?: number;
  range?: number;
  amplitude?: number;
  periodMs?: number;
  fireIntervalMs?: number;
  aim?: 'aimed' | 'arc';
  dx?: number;
  dy?: number;
  kind?: PlatformerAbilityKind;
}

export interface PlatformerEntity {
  type: PlatformerEntityType;
  x: number;
  y: number;
  props?: PlatformerEntityProps;
}

export interface Coord {
  x: number;
  y: number;
}

export interface PlatformerLevel {
  name: string;
  musicSong: string;
  tiles: string[];
  legend: Record<string, PlatformerTileType>;
  entities: PlatformerEntity[];
  playerSpawn: Coord;
  exit: Coord;
}

export type PlatformerBossAttack = 'stomp' | 'charge' | 'spread' | 'summon';

export interface PlatformerBoss {
  name: string;
  hp: number;
  phases: { attacks: PlatformerBossAttack[]; tempo: number }[];
  /** Optional custom boss-fight arena (same tile format as levels). Omit → the
   *  engine's default walled arena. Must have solid side walls and a solid floor
   *  across the bottom two rows so the player and boss have a floor to fight on. */
  arena?: { tiles: string[]; legend: Record<string, PlatformerTileType> };
}

// ---------------------------------------------------------------------------
// Shooter spec
// ---------------------------------------------------------------------------

export type ShooterEnemyType = 'popcorn' | 'weaver' | 'tank' | 'turret' | 'kamikaze';
export type ShooterFormation = 'line' | 'vee' | 'column' | 'arc';
export type ShooterPath = 'dive' | 'sweep' | 'sine' | 'hold';
export type ShooterPickupType = 'spread' | 'rapid' | 'shield' | 'bomb';

export interface ShooterWave {
  t: number;
  enemyType: ShooterEnemyType;
  count: number;
  formation: ShooterFormation;
  path: ShooterPath;
  hp: number;
  fireRate: number;
}

export interface ShooterLevel {
  name: string;
  musicSong: string;
  scroll: number;
  durationS: number;
  waves: ShooterWave[];
  pickups: { t: number; type: ShooterPickupType; x?: number }[];
}

export type ShooterBossPattern = 'fan' | 'spiral' | 'walls' | 'aimed';

export interface ShooterBoss {
  name: string;
  hp: number;
  pods: number;
  podHp: number;
  phases: { pattern: ShooterBossPattern; bulletSpeed: number; fireIntervalMs: number }[];
}

// ---------------------------------------------------------------------------
// Horizontal shooter spec (R-Type-like: flies left→right through a tile stage)
// ---------------------------------------------------------------------------

/** Tile kinds for the auto-scrolling stage (same idea as the platformer): the
 *  ship AND enemies collide with `solid`; `hazard` damages on contact. */
export type HShooterTileType = 'empty' | 'solid' | 'hazard' | 'decoration';

export interface HShooterLevel {
  name: string;
  musicSong: string;
  scroll: number;
  durationS: number;
  /** ASCII tile grid (rows). Top/bottom rows are the ceiling/floor; solids in
   *  the middle are obstacles to weave through. Must be wide enough to scroll
   *  for the whole level (cols*16 ≥ scroll*durationS + a screen). */
  tiles: string[];
  legend: Record<string, HShooterTileType>;
  waves: ShooterWave[];
  pickups: { t: number; type: ShooterPickupType }[];
}

// ---------------------------------------------------------------------------
// Fighter spec (1v1 arcade-ladder fighting game)
// ---------------------------------------------------------------------------

/** A generated fighter's body silhouette. The move set and frame data remain
 * hand-authored and identical for every character. */
export type FighterBuild = 'nimble' | 'balanced' | 'heavy';

/** Broad costume family used to direct generated character art. */
export type FighterOutfit = 'gi' | 'boxer' | 'wrestler' | 'street' | 'robe' | 'armor';

/** One immutable visual-language contract selected during the design pass and
 * reused by presentation art, every roster identity, combat poses, and arenas. */
export interface FighterArtDirection {
  aesthetic: 'cartoon' | 'stylized' | 'semi-realistic';
  /** Concrete head-to-body scale and anatomy rules shared by the whole cast. */
  proportions: string;
  /** Concrete pixel clustering, outline, lighting, and shading treatment. */
  rendering: string;
}

export interface FighterCharacter {
  name: string;
  /** Concrete head-to-toe art direction used to establish generated identity. */
  visualConcept: string;
  build: FighterBuild;
  /** Broad costume family used by the image-generation prompt. */
  outfit: FighterOutfit;
  /** Palette slot (5-a) used to guide the generated costume colors. */
  colorSlot: number;
  hp: number;
  /** Light, clamped stat leans (0.85-1.15); balance is guaranteed by clamping. */
  speedScale?: number;
  powerScale?: number;
}

export interface FighterLevel {
  /** Bout / arena name (e.g. "The Salt Pier"). */
  name: string;
  musicSong: string;
  opponent: FighterCharacter;
}

/** Boss aggression tier, entered at descending HP fractions (rage as it's hurt). */
export interface FighterPhase {
  aggression: number;
}

export interface FighterBoss {
  name: string;
  /** Concrete head-to-toe art direction used to establish generated identity. */
  visualConcept: string;
  build: FighterBuild;
  /** Broad costume family used by the image-generation prompt. */
  outfit: FighterOutfit;
  colorSlot: number;
  hp: number;
  speedScale?: number;
  powerScale?: number;
  phases: FighterPhase[];
}

export interface FighterSpec extends GameSpecBase {
  archetype: 'fighter';
  /** Roster-wide visual language authored once during the story/design pass. */
  artDirection: FighterArtDirection;
  /** Backdrop behind the arena (horizontal scene); omitted → seed pick. */
  backdrop?: BackdropVariantId;
  /** The generated player's authored identity and gameplay attributes. */
  player: FighterCharacter;
  /** Ladder rungs (AI opponents), fought in order; boss is the final rung. */
  levels: FighterLevel[];
  boss: FighterBoss;
}

// ---------------------------------------------------------------------------
// Adventure spec
// ---------------------------------------------------------------------------

export type AdventureTileType =
  'floor' | 'wall' | 'hazard' | 'block' | 'pit' | 'switch' | 'decoration';

export type AdventureEntityType =
  'walker' | 'flyer' | 'shooter' | 'chaser' | 'bruiser' | 'npc' | 'key' | 'heart' | 'item';

export type AdventureMeleeProfile = 'close' | 'sweep' | 'reach';
export type AdventureSecondaryBehavior = 'shot' | 'returning' | 'blast';
export type AdventureSecondaryItem = AdventureSecondaryBehavior;
export type AdventureDoor = 'none' | 'open' | 'locked' | 'boss';

export interface AdventureCombatKit {
  primary: {
    /** Engine-owned reach/cadence profile; fiction remains in name/visualConcept. */
    profile: AdventureMeleeProfile;
    name: string;
    visualConcept: string;
    /** True for punches, kicks, or another weaponless close attack. */
    unarmed: boolean;
  };
  secondary: {
    /** Engine-owned projectile behavior; fiction remains in name/visualConcept. */
    behavior: AdventureSecondaryBehavior;
    name: string;
    visualConcept: string;
  };
}

export interface PlayerCraftIdentity {
  /** Likeness-independent vehicle silhouette, materials, propulsion, canopy, and markings. */
  visualConcept: string;
}

export interface AdventureEntity {
  type: AdventureEntityType;
  x: number;
  y: number;
  props?: {
    dialog?: string;
    speed?: number;
    item?: AdventureSecondaryItem;
  };
}

export interface AdventureRoom {
  id: string;
  gridPos: Coord;
  tiles: string[];
  legend: Record<string, AdventureTileType>;
  entities: AdventureEntity[];
  doors: { n: AdventureDoor; s: AdventureDoor; e: AdventureDoor; w: AdventureDoor };
}

export interface AdventureDungeon {
  rooms: AdventureRoom[];
  items: { secondary: AdventureSecondaryItem };
  bossRoom: string;
  startRoom: string;
}

export type AdventureBossPattern = 'charge' | 'teleport' | 'spiral' | 'summon';

export interface AdventureBoss {
  name: string;
  hp: number;
  phases: { pattern: AdventureBossPattern; tempo: number }[];
}

// ---------------------------------------------------------------------------
// The full game spec (game.json)
// ---------------------------------------------------------------------------

export interface GameSpecBase {
  specVersion: 1;
  archetype: ArchetypeId;
  /** Server-assigned; drives procedural backdrops + SFX pitch variation. */
  seed: number;
  meta: GameMetaBlock;
  /** Exactly 16 hex colors; index 0 is treated as transparent. */
  palette: string[];
  story: StoryBlock;
  sprites: SpritesBlock;
  /** Procedural parallax backdrop scene; omitted → mood-based pick from the seed.
   *  Platformer/adventure use BackdropVariantId (horizontal); shooter narrows
   *  this to ShooterBackdropId (vertical) — see the per-spec override below. */
  backdrop?: BackdropVariantId | ShooterBackdropId;
  /** Ambient weather/particle overlay; omitted → 'none' (clear). */
  weather?: WeatherKind;
  /** Lighting mood wash over the scene; omitted → 'none' (untinted). */
  lighting?: LightingMode;
  /** VFX intensity multiplier for screen-shake (0–1.5); omitted → 1 (default). */
  juice?: number;
  /** Enemy-aggression tier from the design stage; omitted → 'standard'. */
  difficulty?: Difficulty;
  /** Legacy platformer-only movement overlay; named movementProfile is preferred. */
  feel?: HeroFeel;
  music: MusicBlock;
  sfx?: SfxBlock;
  scoring: ScoringBlock;
}

export interface PlatformerSpec extends GameSpecBase {
  archetype: 'platformer';
  /** Collision/layout version for the 16x32 likeness hero; omitted means legacy 10x14 physics. */
  playerHeightTiles?: 2;
  /** Camera framing for platformer gameplay; omitted preserves the original wide view. */
  platformerScale?: PlatformerScale;
  /** Source-art resolution; omitted saved games retain the original chunky sprites. */
  platformerArtDensity?: PlatformerArtDensity;
  /** Bounded engine-owned movement style; omitted saved games remain balanced. */
  movementProfile?: PlatformerMovementProfile;
  /** Story-specific identities for one or two bounded engine-owned abilities. */
  abilityLoadout?: PlatformerAbility[];
  /** Horizontal side-scroll scene; omitted → seed-varied pick. */
  backdrop?: BackdropVariantId;
  levels: PlatformerLevel[];
  boss: PlatformerBoss;
}

export interface ShooterSpec extends GameSpecBase {
  archetype: 'shooter';
  /** Published with the required generated boss and five-role enemy cast. */
  shooterGameplayArtVersion?: 1;
  /** Required likeness-independent top-down player vehicle identity. */
  playerCraft: PlayerCraftIdentity;
  /** Vertical-scroll scene (top-down / fly-through); omitted → seed-varied pick. */
  backdrop?: ShooterBackdropId;
  levels: ShooterLevel[];
  boss: ShooterBoss;
}

export interface AdventureSpec extends GameSpecBase {
  archetype: 'adventure';
  /** Story-specific presentation layered over bounded engine combat behaviors. */
  combatKit: AdventureCombatKit;
  /** Semantic environment-family hint for generated room surfaces. */
  backdrop?: BackdropVariantId;
  levels: AdventureDungeon[];
  boss: AdventureBoss;
}

export interface HShooterSpec extends GameSpecBase {
  archetype: 'hshooter';
  /** Source-authored terrain detail; omitted saved games retain legacy tiles. */
  hshooterArtDensity?: GameplayArtDensity;
  /** Published with required generated enemy art; omitted pre-migration games use library foes. */
  hshooterEnemyArtVersion?: 1;
  /** Required likeness-independent side-view player vehicle identity. */
  playerCraft: PlayerCraftIdentity;
  /** Far backdrop behind the terrain (horizontal scene); omitted → seed pick. */
  backdrop?: BackdropVariantId;
  levels: HShooterLevel[];
  boss: ShooterBoss;
}

export type GameSpec = PlatformerSpec | ShooterSpec | AdventureSpec | HShooterSpec | FighterSpec;

// ---------------------------------------------------------------------------
// Design doc (output of the design pass; design.schema.json)
// ---------------------------------------------------------------------------

export interface DesignDoc {
  title: string;
  tagline: string;
  archetype: ArchetypeId;
  palette: string[];
  /** Canonical player visual brief. With a photo, this directs the story-specific
   * wardrobe below the neck while the photo remains truth for head identity. */
  heroConcept: string;
  /** Adventure-only primary and secondary equipment identity. */
  combatKit?: AdventureCombatKit;
  /** Shooter vehicle identity, authored independently from player likeness. */
  vehicleConcept?: string;
  /** Fighter-only roster-wide visual language. Required by the design schema
   * when the selected archetype is Fighter. */
  fighterArtDirection?: FighterArtDirection;
  story: StoryBlock;
  levelPlan: { name: string; summary: string }[];
  cast: { role: string; concept: string }[];
  musicBrief: { key: string; bpm: number; themeMood: string; bossMood: string };
  scoring: ScoringBlock;
  difficulty: 'chill' | 'standard' | 'spicy';
  /** Platformer-only camera framing; heroic is the default for newly generated games. */
  platformerScale?: PlatformerScale;
  /** Platformer-only source-art detail, independent from camera framing. */
  platformerArtDensity?: PlatformerArtDensity;
  /** Platformer-only bounded movement style; omitted checkpoints default to balanced. */
  movementProfile?: PlatformerMovementProfile;
  /** Platformer ability identities; empty for every other archetype. */
  abilityLoadout: PlatformerAbility[];
  /** Legacy platformer-only movement overlay; new designs should use movementProfile. */
  feel?: HeroFeel;
}

// ---------------------------------------------------------------------------
// Validation / lint
// ---------------------------------------------------------------------------

export interface LintError {
  code: string;
  path: string;
  message: string;
}

export interface ContentFloors {
  levels: number;
  enemyTypes: number;
  bossPhases: number;
  /** Human-readable extras enforced by lint (e.g. "≥ 12 pickups"). */
  extras: string[];
}

export interface ControlLabel {
  button: LogicalButton;
  label: string;
}

// ---------------------------------------------------------------------------
// Server-owned metadata (meta.json — never model-authored)
// ---------------------------------------------------------------------------

export type GameStatus = 'queued' | 'generating' | 'ready' | 'failed' | 'needs-migration';

/** Provider pricing. A model is billed either by tokens or processed audio time. */
export type PriceRow =
  | {
      /** USD per million tokens. */
      inputPerM: number;
      /** USD per million tokens. */
      outputPerM: number;
      /** Defaults to inputPerM when absent (conservative). */
      cachedInputPerM?: number;
      audioPerHour?: never;
    }
  | {
      /** USD per hour of audio processed. */
      audioPerHour: number;
      inputPerM?: never;
      outputPerM?: never;
      cachedInputPerM?: never;
    };

export interface CostBreakdownEntry {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Portion of inputTokens billed at the cached rate. */
  cachedTokens: number;
  /** Provider-billed processed audio time, when this is a speech request. */
  audioSeconds?: number;
  costUsd: number | null;
  failed: boolean;
  repair: boolean;
  at: string;
}

export interface GameMetaFile {
  id: string;
  status: GameStatus;
  createdAt: string;
  archetype: ArchetypeId;
  seed: number;
  engineVersion: string;
  archetypeVersion: string;
  specVersion: number;
  title: string;
  tagline: string;
  /** The confirmed prompt text the player approved (or preset/surprise text). */
  sourcePrompt: string;
  sourceKind: 'voice' | 'preset' | 'surprise';
  /** Explicit engine selected by the player; absent on legacy automatic jobs. */
  requestedArchetype?: ArchetypeId;
  /** Structured guided-creation inputs retained for provenance and retries. */
  creationBrief?: CreationBrief;
  presetId?: string;
  hadPhoto: boolean;
  model: string;
  provider: string;
  costUsd: number | null;
  costBreakdown: CostBreakdownEntry[];
  priceSnapshot: Record<string, PriceRow>;
  /** Fixed image price captured by this run (separate from token pricing). */
  imagePriceSnapshot?: { model: string; perImageUsd: number | null };
  /** Confirms that the required generated Fighter roster was published. */
  fighterArt?: {
    mode: 'generated';
    attempted: true;
  };
  /** QA/readiness signal for the one-call ladder/boss Fighter arena sheet. */
  fighterArenaArt?: {
    mode: 'generated' | 'procedural';
    attempted: boolean;
    /** Present when the stable procedural backdrop remains active. */
    reason?: string;
  };
  /** QA/readiness signal for the generated high-density platformer player. */
  platformerPlayerArt?: {
    mode: 'generated';
    attempted: true;
  };
  /** QA/readiness signal for the image-generated platformer finale boss. */
  platformerBossArt?: {
    mode: 'generated' | 'procedural';
    attempted: boolean;
    /** Present when every generated candidate was unavailable or unusable. */
    reason?: string;
  };
  /** QA/readiness signal for the four image-generated platformer enemy roles. */
  platformerEnemyArt?: {
    mode: 'generated' | 'partial' | 'procedural';
    attempted: boolean;
    /** Roles whose generated art passed local processing and was published. */
    generatedRoles?: Array<'walker' | 'flyer' | 'shooter' | 'chaser'>;
    /** Present when at least one role retained its stable library fallback. */
    reason?: string;
  };
  /** QA/readiness signal for small, independently generated gameplay props. */
  platformerPropArt?: {
    mode: 'generated' | 'partial' | 'procedural';
    attempted: boolean;
    /** Prop roles whose generated art passed local processing and was published. */
    generatedRoles?: Array<
      | 'collectible'
      | 'health'
      | 'powerup'
      | 'powerupDoubleJump'
      | 'powerupProjectile'
      | 'powerupShield'
      | 'heroProjectile'
      | 'enemyProjectile'
    >;
    /** Present when at least one role retained its stable library fallback. */
    reason?: string;
  };
  /** QA/readiness signal for the four image-generated platformer stage plates. */
  platformerBackdropArt?: {
    mode: 'generated' | 'partial' | 'procedural';
    attempted: boolean;
    /** Stage plates whose generated art was published. */
    generatedRoles?: Array<'level1' | 'level2' | 'level3' | 'boss'>;
    /** Present when at least one stage retained its procedural backdrop. */
    reason?: string;
  };
  /** QA/readiness signal for the four image-generated H-scroll stage plates. */
  hshooterBackdropArt?: {
    mode: 'generated' | 'partial' | 'procedural';
    attempted: boolean;
    /** Stage plates whose generated art was published. */
    generatedRoles?: Array<'level1' | 'level2' | 'level3' | 'boss'>;
    /** Present when at least one stage retained its procedural backdrop. */
    reason?: string;
  };
  /** QA/readiness signal for the four generated vertical flyover plates. */
  shooterBackdropArt?: {
    mode: 'generated' | 'partial' | 'procedural';
    attempted: boolean;
    generatedRoles?: Array<'level1' | 'level2' | 'level3' | 'boss'>;
    reason?: string;
  };
  /** QA/readiness signal for the story-art-derived H-scroll finale boss. */
  hshooterBossArt?: {
    mode: 'generated';
    attempted: true;
  };
  /** QA/readiness signal for the required five-role generated H-scroll enemy cast. */
  hshooterEnemyArt?: {
    mode: 'generated';
    attempted: true;
    roles: Array<'popcorn' | 'weaver' | 'tank' | 'turret' | 'kamikaze'>;
  };
  /** QA/readiness signal for the required top-down vertical-shooter finale boss. */
  shooterBossArt?: {
    mode: 'generated';
    attempted: true;
  };
  /** QA/readiness signal for the required five-role generated vertical cast. */
  shooterEnemyArt?: {
    mode: 'generated';
    attempted: true;
    roles: Array<'popcorn' | 'weaver' | 'tank' | 'turret' | 'kamikaze'>;
  };
  /** QA/readiness signal for the one-call Adventure room-surface atlas. */
  adventureRoomPlateArt?: {
    mode: 'generated' | 'procedural';
    attempted: boolean;
    /** Present when the stable compact-floor fallback remains active. */
    reason?: string;
  };
  /** QA/readiness signal for the atomic twelve-pose Adventure player set. */
  adventurePlayerArt?: {
    mode: 'generated';
    attempted: true;
  };
  /** QA/readiness signal for the story-art-derived Adventure finale boss. */
  adventureBossArt?: {
    mode: 'generated' | 'procedural';
    attempted: boolean;
    /** Present when the library boss remains active. */
    reason?: string;
  };
  /** QA/readiness signal for the required five-role generated Adventure enemy cast. */
  adventureEnemyArt?: {
    mode: 'generated';
    attempted: true;
    roles: Array<'walker' | 'flyer' | 'shooter' | 'chaser' | 'bruiser'>;
  };
  /** QA/readiness signal for required themed Adventure gameplay objects. */
  adventureObjectArt?: {
    mode: 'generated';
    attempted: true;
    roles: Array<
      'key' | 'item' | 'npc' | 'secondaryEffect' | 'block' | 'switchRaised' | 'switchPressed'
    >;
  };
  /** QA/readiness signal for the likeness-independent H-scroll player craft. */
  hshooterPlayerCraftArt?: {
    mode: 'generated';
    attempted: true;
  };
  /** Required likeness-independent vertical-shooter player craft. */
  shooterPlayerCraftArt?: {
    mode: 'generated';
    attempted: true;
  };
  golden?: boolean;
  failure?: { code: string; message: string; stage: string };
}

// ---------------------------------------------------------------------------
// Jobs & SSE
// ---------------------------------------------------------------------------

export type JobStatus = 'queued' | 'running' | 'waiting-network' | 'done' | 'failed' | 'canceled';

/** Versioned, user-approved inputs from the guided creation flow. Keeping this
 * separate from promptText lets retries preserve exact choices while legacy
 * voice, preset, and Surprise jobs continue to work without a brief. */
export interface CreationBrief {
  version: 1;
  /** Exact spoken character name. Omitted when the player asks Spark to invent one. */
  heroName?: string;
  /** Explicit engine choice; omitted when Spark should classify the request. */
  archetype?: ArchetypeId;
  /** Story, enemies, setting, and aesthetic direction; omitted when Spark should invent them. */
  details?: string;
}

export interface JobRecord {
  id: string;
  gameId: string;
  status: JobStatus;
  stage: JobStage;
  detail: string;
  promptText: string;
  sourceKind: 'voice' | 'preset' | 'surprise';
  /** Explicit engine selected by the player; survives retries. */
  requestedArchetype?: ArchetypeId;
  /** Structured guided-creation inputs. Absent on legacy jobs. */
  creationBrief?: CreationBrief;
  presetId?: string;
  seed: number;
  idempotencyKey: string;
  hasPhoto: boolean;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  costSoFarUsd: number | null;
  error?: { code: string; message: string; stage: string };
  attempt: number;
}

export type GenerationFeedKind = 'progress' | 'decision' | 'asset' | 'complete' | 'failure';

/** One durable, ordered card in the generation screen. Payloads are deliberately
 * small display facts; generated bytes remain behind manifest-verified URLs. */
export interface GenerationFeedEvent {
  id: number;
  jobId: string;
  gameId: string;
  attempt: number;
  kind: GenerationFeedKind;
  stage?: JobStage;
  message: string;
  payload?: Record<string, unknown>;
  at: string;
}

export type JobEvent =
  | {
      type: 'progress';
      jobId: string;
      stage: JobStage;
      detail: string;
      elapsedMs: number;
      costSoFarUsd: number | null;
      /** Completed work units / total, only when backed by real work units. */
      unitsDone?: number;
      unitsTotal?: number;
      waitingForNetwork?: boolean;
      slow?: boolean;
    }
  | { type: 'done'; jobId: string; gameId: string; elapsedMs: number; costUsd: number | null }
  | {
      type: 'failed';
      jobId: string;
      gameId: string;
      code: string;
      message: string;
      stage: JobStage;
      elapsedMs: number;
      costSoFarUsd: number | null;
    }
  | { type: 'feed'; jobId: string; event: GenerationFeedEvent };

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

/**
 * Everything the shell needs to render a library-card cover live: the game's
 * palette plus its most distinctive art — hero (with likeness head overlay
 * when the game has one), a showcase enemy (custom art preferred), and the
 * boss looming behind.
 */
export interface CoverData {
  palette: string[];
  hero: SpriteData | null;
  /** Original hero ref (`lib:...`) so the client can find the head slot. */
  heroRef?: string;
  enemy?: SpriteData | null;
  boss?: SpriteData | null;
  /** True when baked likeness head sprites exist for this game. */
  hasLikeness?: boolean;
  /** True when Muse Image authored a dedicated library-card cover. */
  hasKeyArt?: boolean;
}

/** Provenance and integrity data for one generated binary asset. */
export interface GeneratedGameAsset {
  role: GeneratedGameAssetRole;
  filename: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  model: string;
  promptVersion: string;
  /** Hash of the complete prompt + reference identity, used for retry reuse. */
  promptSha256: string;
  sha256: string;
}

/** Stored beside generated images as assets/manifest.json. */
export interface GameAssetManifest {
  version: 1;
  assets: GeneratedGameAsset[];
}

/** Stable public address reserved by the cloud for a cabinet game. */
export interface PublicGameLink {
  id: string;
  url: string;
}

export type PublicGamePublicationStatus = 'publishing' | 'published' | 'failed';

/** Cabinet-side truth about whether the complete playable game reached the cloud. */
export interface PublicGamePublication {
  status: PublicGamePublicationStatus;
  link: PublicGameLink;
}

export type KioskFeedVisibility = 'listed' | 'unlisted';

export type KioskRegistrationState =
  'disabled' | 'unregistered' | 'pairing' | 'registered' | 'expired' | 'revoked' | 'error';

/** Safe registration state exposed to the cabinet UI. The device credential is never included. */
export interface KioskRegistrationStatus {
  state: KioskRegistrationState;
  origin: string | null;
  name?: string;
  pairingCode?: string;
  expiresAt?: string;
  defaultFeedVisibility?: KioskFeedVisibility;
  message?: string;
  legacy?: boolean;
}

export interface GameListItem {
  id: string;
  title: string;
  tagline: string;
  archetype: ArchetypeId;
  status: GameStatus;
  createdAt: string;
  topScore: { initials: string; score: number } | null;
  costUsd: number | null;
  golden: boolean;
  jobId: string | null;
  /** For rendering the card cover live (no stored images). */
  cover: CoverData | null;
  /** Omitted until this cabinet has reserved a public copy. */
  publication?: PublicGamePublication;
  failure?: { code: string; message: string };
}

export interface ScoreRow {
  initials: string;
  score: number;
  at: string;
}

export interface SystemInfo {
  version: string;
  /** Random per-server-process id; changes on every restart so the kiosk can
   *  hard-reload after an update (the version string alone is static). */
  instanceId: string;
  ip: string;
  diskFreeBytes: number;
  diskTotalBytes: number;
  isPi: boolean;
  forcedPi: boolean;
  model: string;
  /** Image model used for key, story, and player art. */
  imageModel: string;
  provider: string;
  lifetimeSpendUsd: number;
  dataDir: string;
  gameCount: number;
}

export type SoftwareUpdateStatus =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'succeeded' }
  | { state: 'failed'; message: string };

export interface WifiNetwork {
  ssid: string;
  signal: number;
  /** NetworkManager's human-readable security flags, or null for an open network. */
  security: string | null;
  secured: boolean;
  requiresPassword: boolean;
  /** False for enterprise/EAP networks that need credentials beyond one PSK. */
  supported: boolean;
  current: boolean;
}

export interface WifiStatus {
  connected: boolean;
  ssid: string | null;
  ip: string | null;
  mock: boolean;
}

export interface CostEstimate {
  usd: number | null;
  label: string;
}

// ---------------------------------------------------------------------------
// Config (config.json in the data dir)
// ---------------------------------------------------------------------------

export type ProviderKind = 'meta' | 'openai-compatible' | 'anthropic' | 'mock';

export interface ProviderCapabilities {
  structuredOutput: boolean;
  audioIn: boolean;
  imageIn: boolean;
}

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl?: string;
  apiKeyEnv?: string;
  capabilities?: ProviderCapabilities;
  /** Reasoning models only (meta): internal thinking budget. Default "low". */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface StageConfig {
  provider: string;
  model: string;
  /** Reasoning models: thinking budget for this stage (default: the provider's setting). */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface ImageGenerationConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  /** Fixed public price for each successfully returned Muse image. */
  pricePerImageUsd: number;
  /** Provider request size/aspect-ratio hint before local normalization. */
  size?: string;
  timeoutMs?: number;
}

export interface SparkadeConfig {
  providers: Record<string, ProviderConfig>;
  stages: Record<StageName, StageConfig>;
  pricing: Record<string, PriceRow>;
  imageGeneration: ImageGenerationConfig;
  likeness: {
    describeInStory: boolean;
  };
  presets: { id: string; title: string; archetype: ArchetypeId; premise: string; tone: string }[];
  audio: { musicVol: number; sfxVol: number; uiVol: number };
  input: {
    gamepad: Record<string, LogicalButton>;
    keyboard: Record<string, LogicalButton>;
  };
  /** Preferred capture devices (empty → browser default). Chosen in Settings →
   * Camera & Mic; label kept for display + fallback if the deviceId changes. */
  devices: {
    cameraId?: string;
    cameraLabel?: string;
    micId?: string;
    micLabel?: string;
  };
}

// ---------------------------------------------------------------------------
// Provider interface (implemented by every adapter in packages/server/src/providers)
// ---------------------------------------------------------------------------

export interface ProviderUsage {
  input: number;
  output: number;
  /** Portion of `input` served from the provider's prompt cache (billed cheaper). */
  cachedInput?: number;
  /** Provider-billed processed audio time, rounded according to its pricing policy. */
  audioSeconds?: number;
}

export interface CompleteRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  /** Passed through the provider's native structured-output mechanism when capabilities.structuredOutput. */
  jsonSchema?: object;
  image?: Buffer;
  /** Reasoning models: per-call thinking budget (overrides the provider default). */
  effort?: 'minimal' | 'low' | 'medium' | 'high';
  /** Per-call timeout override (ms). Default: GENERATION.perCallTimeoutMs. */
  timeoutMs?: number;
}

export interface CompleteResponse {
  text: string;
  usage: ProviderUsage;
  /** The model that actually served the request when a provider used a fallback. */
  model?: string;
}

export interface TranscriptionResult {
  text: string;
  usage: ProviderUsage;
  /** The model that actually served the request when a provider used a fallback. */
  model?: string;
}

export interface Provider {
  readonly name: string;
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  complete(
    req: CompleteRequest,
    opts?: { model?: string; signal?: AbortSignal },
  ): Promise<CompleteResponse>;
  transcribe?(
    audio: Buffer,
    mime: string,
    opts?: { model?: string; signal?: AbortSignal },
  ): Promise<TranscriptionResult>;
}
