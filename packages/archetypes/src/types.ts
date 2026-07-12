// The archetype interface — layer 2 of the three-layer architecture.
import type { EngineContext, GameInstance } from '@sparkade/engine';
import type { ArchetypeId, ContentFloors, ControlLabel, GameSpec, LintError } from '@sparkade/shared';

export interface Archetype {
  id: ArchetypeId;
  version: string;
  /** Full JSON Schema for this archetype's game.json (from @sparkade/shared). */
  schema: Record<string, unknown>;
  /** Semantic checks beyond schema; errors carry {code, path, message}. */
  lint(spec: GameSpec): LintError[];
  /** Crude duration estimate (seconds of meaningful interactive play). */
  estimateDurationS(spec: GameSpec): number;
  create(engine: EngineContext, spec: GameSpec): GameInstance;
  /** Shown on the pre-game "how to play" card and the pause Controls screen. */
  controlHelp: ControlLabel[];
  /** Machine-checkable minimums (also listed in prompt templates). */
  contentFloors: ContentFloors;
}
