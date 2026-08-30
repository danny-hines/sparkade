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
export {
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
export { lintFighter, estimateFighterDurationS } from './fighter/lint';
export { FIGHTER_POSES, type FighterPose } from '@sparkade/shared';
export {
  lintAdventure,
  estimateAdventureDurationS,
  buildGraph,
  checkKeyTopology,
  reconcileDoors,
} from './adventure/lint';
