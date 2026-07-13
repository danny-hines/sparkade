// Archetype registry — layer 2 of the three-layer architecture.
import type { ArchetypeId } from '@sparkade/shared';
import type { Archetype } from './types';
import { platformer } from './platformer/index';
import { shooter } from './shooter/index';
import { adventure } from './adventure/index';
import { hshooter } from './hshooter/index';

export const archetypes: Record<ArchetypeId, Archetype> = {
  platformer,
  shooter,
  adventure,
  hshooter,
};

export type { Archetype } from './types';
export { lintPlatformer, estimatePlatformerDurationS, reachableCells } from './platformer/lint';
export { lintShooter, estimateShooterDurationS } from './shooter/lint';
export { lintHShooter, estimateHShooterDurationS } from './hshooter/lint';
export {
  lintAdventure,
  estimateAdventureDurationS,
  buildGraph,
  checkKeyTopology,
  reconcileDoors,
} from './adventure/lint';
