// Archetype registry — layer 2 of the three-layer architecture.
import type { ArchetypeId } from '@sparkade/shared';
import type { Archetype } from './types';
import { platformer } from './platformer/index';
import { shooter } from './shooter/index';
import { adventure } from './adventure/index';
import { hshooter } from './hshooter/index';
import { fighter } from './fighter/index';

export const archetypes: Record<ArchetypeId, Archetype> = {
  platformer,
  shooter,
  adventure,
  hshooter,
  fighter,
};

export type { Archetype } from './types';
export { platformerStyleExample, towerExampleLevel } from './platformer/examples';
export { compilePlatformerEncounterRoute, lintPlatformerEncounters } from './platformer/encounters';
export {
  analyzePlatformerTraversal,
  lintPlatformer,
  estimatePlatformerDurationS,
  platformerEntityReachabilityIssue,
  platformerReachabilityBlockage,
  reachableCells,
} from './platformer/lint';
export {
  inferSolidInnerRef,
  PlatformerSolidAutotiles,
  solidNeighborMask,
  solidTileVariant,
  terrainAtlasFrame,
} from './platformer/autotile';
export { lintShooter, estimateShooterDurationS } from './shooter/lint';
export { lintHShooter, estimateHShooterDurationS } from './hshooter/lint';
export {
  analyzeHShooterRoute,
  HSHOOTER_PLAYER_HITBOX,
  HSHOOTER_PLAYER_MAX_SCREEN_X,
  HSHOOTER_PLAYER_MIN_SCREEN_X,
  HSHOOTER_PLAYER_SPEED_HIGH,
  HSHOOTER_PLAYER_SPEED_LOW,
  HSHOOTER_ROUTE_REACTION_S,
  type HShooterRouteAnalysis,
} from './hshooter/traversal';
export { lintFighter, estimateFighterDurationS } from './fighter/lint';
export { FIGHTER_POSES, type FighterPose } from '@sparkade/shared';
export {
  lintAdventure,
  estimateAdventureDurationS,
  buildGraph,
  checkKeyTopology,
  reconcileDoors,
  safelyReachableRoomCells,
} from './adventure/lint';
export {
  ADVENTURE_ENCOUNTER_MIN_SPREAD_CELLS,
  ADVENTURE_SHOOTER_MIN_LANE_CELLS,
  adventureBossArenaRequirements,
  adventureCellIsCalmFloor,
  adventureCellIsSafe,
  adventureDoorReactionCells,
  adventureEnemyEncounterSpread,
  adventureInteractionCells,
  adventureInteractionSpaceClear,
  adventureProjectileLineClear,
  adventureRoomTileKind,
  adventureShooterHasClearLane,
  analyzeAdventureBossArena,
  type AdventureBossArenaAnalysis,
  type AdventureBossArenaRequirements,
  type AdventureBossPattern,
  type AdventureCell,
} from './adventure/encounters';

export { shooterStyleExample } from './shooter/examples';
export { adventureStyleExample } from './adventure/examples';
