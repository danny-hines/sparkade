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
export { lintPlatformer, estimatePlatformerDurationS, reachableCells } from './platformer/lint';
export {
  inferSolidInnerRef,
  PlatformerSolidAutotiles,
  solidNeighborMask,
  solidTileVariant,
} from './platformer/autotile';
export { lintShooter, estimateShooterDurationS } from './shooter/lint';
export { lintHShooter, estimateHShooterDurationS } from './hshooter/lint';
export { lintFighter, estimateFighterDurationS } from './fighter/lint';
export {
  FIGHTER_POSES,
  drawFighterAvatarHead,
  drawFighter,
  fighterColorsForPalette,
  fighterIdentitySeed,
  fighterScaleForBuild,
  resolveFighterAvatarHead,
  type FighterAvatarHead,
  type FighterAvatarDetail,
  type FighterAvatarEyeStyle,
  type FighterAvatarFaceShape,
  type FighterAvatarFacialHair,
  type FighterAvatarHairRole,
  type FighterAvatarHairStyle,
  type FighterColors,
  type FighterPose,
  type FigureOpts,
} from './fighter/figure';
export {
  FIGHTER_COLOR_ROLES,
  FIGHTER_FOOT_PRESETS,
  FIGHTER_FOOT_SHAPES,
  FIGHTER_HAND_SHAPES,
  FIGHTER_LEG_ACCENTS,
  FIGHTER_OUTFIT_IDS,
  FIGHTER_OUTFIT_RIG_BOUNDS,
  FIGHTER_OUTFIT_RIG_DOCUMENT,
  FIGHTER_OUTFIT_RIGS,
  FIGHTER_TORSO_DETAILS,
  cloneFighterOutfitRig,
  cloneFighterOutfitRigDocument,
  cloneFighterOutfitRigs,
  validateFighterOutfitRig,
  validateFighterOutfitRigDocument,
  validateFighterOutfitRigs,
  type FighterColorRole,
  type FighterFootPreset,
  type FighterFootShape,
  type FighterHandShape,
  type FighterLegAccent,
  type FighterOutfitRig,
  type FighterOutfitRigDocument,
  type FighterOutfitRigMap,
  type FighterOutfitValidationResult,
  type FighterTorsoDetail,
} from './fighter/outfits';
export {
  lintAdventure,
  estimateAdventureDurationS,
  buildGraph,
  checkKeyTopology,
  reconcileDoors,
} from './adventure/lint';
