// Engine-side interfaces shared with archetypes and the shell.
import type { LogicalButton, SpriteData } from '@sparkade/shared';

/** A library sprite entry: 1+ frames of palette-indexed art plus named animations. */
export type HeadView = 'front' | 'side' | 'back';

export interface HeadSlot {
  x: number;
  y: number;
  size: 12 | 16;
  /** Direction the authored body frame faces. Omitted entries use the front view. */
  view?: HeadView;
}

export interface LibraryEntry {
  frames: SpriteData[];
  /** Transitional compatibility for older dual-frame generated packs. New
   * generated packs store source-indexed art directly in `frames`. */
  sourceFrames?: SpriteData[];
  /** Exactly 16 colors used by source-indexed frames; index zero remains transparent. */
  sourcePalette?: string[];
  /** Named frame-index lists, e.g. { idle: [0], walk: [0, 1] }. Every entry has at least `idle`. */
  anims: Record<string, number[]>;
  /**
   * Heroes only: where a baked likeness head lands, per frame (parallel to `frames`).
   * `size` selects the 12×12 or 16×16 sprite; `view` selects its orientation.
   */
  headSlots?: HeadSlot[];
  /**
   * Optional per-frame art redrawn after a likeness head (held props, scarf
   * tips, etc.). Parallel to `frames`; used by presentation transforms.
   */
  likenessOverlays?: SpriteData[];
}

/** Edge-detected view of one logical control. */
export interface ButtonState {
  held: boolean;
  pressed: boolean;
  released: boolean;
}

export type InputSnapshot = Record<LogicalButton, ButtonState>;

/** Generated game art produced by the server, loaded by the shell.  The name is
 * kept for API compatibility with older games that only have likeness heads. */
export interface LikenessAssets {
  head12: CanvasImageSource | null;
  head16: CanvasImageSource | null;
  head12Side?: CanvasImageSource | null;
  head12Back?: CanvasImageSource | null;
  head16Side?: CanvasImageSource | null;
  head16Back?: CanvasImageSource | null;
  portrait: CanvasImageSource | null;
  /** Photo-conditioned expression used on defeat cards. */
  portraitDefeat?: CanvasImageSource | null;
  /** Generated widescreen art used behind the four major story beats. */
  storyIntro?: CanvasImageSource | null;
  storyBoss?: CanvasImageSource | null;
  storyVictory?: CanvasImageSource | null;
  storyDefeat?: CanvasImageSource | null;
  /** Likeness-independent native side-view H-scroll player craft. */
  hshooterPlayerCraft?: CanvasImageSource | null;
  /** Story-art-derived native side-view H-scroll finale boss. */
  hshooterBoss?: CanvasImageSource | null;
  /** Required atomic five-role H-scroll enemy atlas. */
  hshooterEnemyAtlas?: CanvasImageSource | null;
  /** Likeness-independent native top-down vertical-shooter player craft. */
  shooterPlayerCraft?: CanvasImageSource | null;
  /** Generated top-down vertical-shooter finale boss. */
  shooterBoss?: CanvasImageSource | null;
  /** Five 96x96 top-down enemy cells in canonical shooter-role order. */
  shooterEnemyAtlas?: CanvasImageSource | null;
  /** Five complete generated Fighter atlases in player, rung 1-3, boss order. */
  fighterAtlases?: readonly CanvasImageSource[] | null;
  /** Two stacked generated Fighter arena plates: reusable ladder, then boss. */
  fighterArenaAtlas?: CanvasImageSource | null;
  /** Native generated platformer poses. Activated only as one complete set. */
  platformerPoses?: Readonly<Record<string, CanvasImageSource>> | null;
  /** High-density signature boss generated from the platformer's story art. */
  platformerBoss?: CanvasImageSource | null;
  /** Independently generated platformer enemy bodies, keyed by behavior role. */
  platformerEnemies?: Readonly<Record<string, CanvasImageSource>> | null;
  /** Independently generated pickups and projectiles, keyed by gameplay role. */
  platformerProps?: Readonly<Record<string, CanvasImageSource>> | null;
  /** Independently generated panoramic platformer stage plates. */
  platformerBackdrops?: Readonly<Record<string, CanvasImageSource>> | null;
  /** Independently generated panoramic H-scroll stage plates. */
  hshooterBackdrops?: Readonly<Record<string, CanvasImageSource>> | null;
  /** Generated vertical flyover plates keyed by level1..level3 and boss. */
  shooterBackdrops?: Readonly<Record<string, CanvasImageSource>> | null;
  /** One 2x2 atlas of entrance, ordinary, deep, and finale Adventure room surfaces. */
  adventureRoomPlates?: CanvasImageSource | null;
  /** Atomic generated Adventure player directions and motion poses. */
  adventurePlayerPoses?: Readonly<Record<string, CanvasImageSource>> | null;
  /** Story-art-derived high-density Adventure finale boss. */
  adventureBoss?: CanvasImageSource | null;
  /** Required five-role Adventure enemy atlas in walker-to-bruiser order. */
  adventureEnemyAtlas?: CanvasImageSource | null;
  /** Required themed key, item, NPC, and active-secondary Adventure atlas. */
  adventureObjectAtlas?: CanvasImageSource | null;
}

/** What a finished run reports back to the host. */
export interface GameResult {
  outcome: 'won' | 'lost';
  score: number;
  /** Remaining-time bonus seconds (0 when lost). */
  timeBonusSeconds: number;
}

/** Optional direct world transform used to present an integer-zoomed scene
 * while keeping HUD, cards, pause chrome, and final output unchanged. */
export interface WorldZoom {
  scale: number;
  /** Top-left crop in the already-rendered world canvas; defaults to (0,0). */
  sourceX?: number;
  sourceY?: number;
}

/** Live HUD values the substrate draws every frame. */
export interface HudState {
  score: number;
  lives: number;
  health: number;
  maxHealth: number;
  keys: number;
  bombs: number;
  /** Platformer pickup count; optional so older archetypes remain unchanged. */
  collectibles?: number;
  /** Optional boss health while a boss fight is active. */
  boss?: { hp: number; maxHp: number; name: string };
}

/**
 * A running game produced by an archetype's create(). The host calls update at a
 * fixed 60 Hz and render once per rAF; it never calls update while paused or
 * while a substrate-owned overlay (pause, initials) is up.
 */
export interface GameInstance {
  start(): void;
  update(dt: number, input: InputSnapshot): void;
  render(): void;
  /** Restart from the last checkpoint / current level start (pause-menu Restart). */
  restart(): void;
  readonly hud: HudState;
  /** Non-null once the run is over; host then takes over (tally → initials → leaderboard). */
  readonly result: GameResult | null;
  /** Integer world-only presentation transform; omitted leaves original framing. */
  readonly worldZoom?: WorldZoom;
  dispose(): void;
}
