// Engine-side interfaces shared with archetypes and the shell.
import type { LogicalButton, SpriteData } from '@sparkade/shared';

/** A library sprite entry: 1+ frames of palette-indexed art plus named animations. */
export interface LibraryEntry {
  frames: SpriteData[];
  /** Named frame-index lists, e.g. { idle: [0], walk: [0, 1] }. Every entry has at least `idle`. */
  anims: Record<string, number[]>;
  /**
   * Heroes only: where a baked likeness head lands, per frame (parallel to `frames`).
   * `size` selects the 12×12 or 16×16 baked head sprite.
   */
  headSlots?: { x: number; y: number; size: 12 | 16 }[];
}

/** Edge-detected view of one logical control. */
export interface ButtonState {
  held: boolean;
  pressed: boolean;
  released: boolean;
}

export type InputSnapshot = Record<LogicalButton, ButtonState>;

/** Baked likeness artifacts produced by the server, loaded by the shell. */
export interface LikenessAssets {
  head12: CanvasImageSource | null;
  head16: CanvasImageSource | null;
  portrait: CanvasImageSource | null;
}

/** What a finished run reports back to the host. */
export interface GameResult {
  outcome: 'won' | 'lost';
  score: number;
  /** Remaining-time bonus seconds (0 when lost). */
  timeBonusSeconds: number;
}

/** Live HUD values the substrate draws every frame. */
export interface HudState {
  score: number;
  lives: number;
  health: number;
  maxHealth: number;
  keys: number;
  bombs: number;
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
  dispose(): void;
}
