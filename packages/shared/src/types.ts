// Sparkade shared types. These mirror the JSON Schemas in ./schemas exactly —
// the schemas are the contract (embedded verbatim in LLM prompts); these types
// are the compile-time view of the same shapes.

import type {
  ArchetypeId,
  BackdropVariantId,
  JobStage,
  LightingMode,
  LogicalButton,
  SfxEvent,
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
}

/** `lib:<id>` (built-in library) or `custom:<id>` (defined in sprites.custom). */
export type SpriteRef = string;

export interface SpritesBlock {
  custom: Record<string, SpriteData>;
  /** role → sprite ref. `hero` and `boss` are always present. */
  assign: Record<string, SpriteRef>;
}

// ---------------------------------------------------------------------------
// Story / meta / scoring
// ---------------------------------------------------------------------------

export interface GameMetaBlock {
  title: string;
  tagline: string;
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
  kind?: 'doubleJump' | 'projectile' | 'shield';
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
  pickups: { t: number; type: ShooterPickupType }[];
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
// Adventure spec
// ---------------------------------------------------------------------------

export type AdventureTileType =
  | 'floor'
  | 'wall'
  | 'hazard'
  | 'block'
  | 'pit'
  | 'switch'
  | 'decoration';

export type AdventureEntityType =
  | 'walker'
  | 'flyer'
  | 'shooter'
  | 'chaser'
  | 'bruiser'
  | 'npc'
  | 'key'
  | 'heart'
  | 'item';

export type AdventureSecondaryItem = 'boomerang' | 'bombs' | 'bow';
export type AdventureDoor = 'none' | 'open' | 'locked' | 'boss';

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
  /** Procedural parallax backdrop scene; omitted → mood-based pick from the seed. */
  backdrop?: BackdropVariantId;
  /** Ambient weather/particle overlay; omitted → 'none' (clear). */
  weather?: WeatherKind;
  /** Lighting mood wash over the scene; omitted → 'none' (untinted). */
  lighting?: LightingMode;
  /** VFX intensity multiplier for screen-shake (0–1.5); omitted → 1 (default). */
  juice?: number;
  music: MusicBlock;
  sfx?: SfxBlock;
  scoring: ScoringBlock;
}

export interface PlatformerSpec extends GameSpecBase {
  archetype: 'platformer';
  levels: PlatformerLevel[];
  boss: PlatformerBoss;
}

export interface ShooterSpec extends GameSpecBase {
  archetype: 'shooter';
  levels: ShooterLevel[];
  boss: ShooterBoss;
}

export interface AdventureSpec extends GameSpecBase {
  archetype: 'adventure';
  levels: AdventureDungeon[];
  boss: AdventureBoss;
}

export type GameSpec = PlatformerSpec | ShooterSpec | AdventureSpec;

// ---------------------------------------------------------------------------
// Design doc (output of the design pass; design.schema.json)
// ---------------------------------------------------------------------------

export interface DesignDoc {
  title: string;
  tagline: string;
  archetype: ArchetypeId;
  palette: string[];
  heroConcept: string;
  story: StoryBlock;
  levelPlan: { name: string; summary: string }[];
  cast: { role: string; concept: string }[];
  musicBrief: { key: string; bpm: number; themeMood: string; bossMood: string };
  scoring: ScoringBlock;
  difficulty: 'chill' | 'standard' | 'spicy';
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

/** USD per million tokens. cachedInputPerM defaults to inputPerM when absent (conservative). */
export interface PriceRow {
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM?: number;
}

export interface CostBreakdownEntry {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Portion of inputTokens billed at the cached rate. */
  cachedTokens: number;
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
  presetId?: string;
  hadPhoto: boolean;
  model: string;
  provider: string;
  costUsd: number | null;
  costBreakdown: CostBreakdownEntry[];
  priceSnapshot: Record<string, PriceRow>;
  golden?: boolean;
  failure?: { code: string; message: string; stage: string };
}

// ---------------------------------------------------------------------------
// Jobs & SSE
// ---------------------------------------------------------------------------

export type JobStatus = 'queued' | 'running' | 'waiting-network' | 'done' | 'failed' | 'canceled';

export interface JobRecord {
  id: string;
  gameId: string;
  status: JobStatus;
  stage: JobStage;
  detail: string;
  promptText: string;
  sourceKind: 'voice' | 'preset' | 'surprise';
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
    };

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
  provider: string;
  lifetimeSpendUsd: number;
  dataDir: string;
  gameCount: number;
}

export interface WifiNetwork {
  ssid: string;
  signal: number;
  secured: boolean;
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

export interface SparkadeConfig {
  providers: Record<string, ProviderConfig>;
  stages: Record<StageName, StageConfig>;
  pricing: Record<string, PriceRow>;
  likeness: { describeInStory: boolean; smartFeatures?: boolean };
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
}

export interface Provider {
  readonly name: string;
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  complete(req: CompleteRequest, opts?: { model?: string; signal?: AbortSignal }): Promise<CompleteResponse>;
  transcribe?(
    audio: Buffer,
    mime: string,
    opts?: { model?: string; signal?: AbortSignal },
  ): Promise<{ text: string; usage: ProviderUsage }>;
}
