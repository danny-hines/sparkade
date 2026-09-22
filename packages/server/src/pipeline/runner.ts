import {
  RACING_BASE_ROLES,
  RACING_MOTION_ROLES,
  RACING_LOCOMOTION_VERSION,
  buildRacingLocomotionPrompt,
  buildRacingLocomotionReference,
  buildRacingStrideFramePrompt,
  buildRacingMotionReviewBoard,
  generateOptionalRacingMotion,
  parseRacingMotionTerminalOutcome,
  racingMotionTerminalKey,
  racingLocomotionJudgePrompt,
  racingLocomotionJudgeSchema,
} from '../assets/racing-locomotion';
// The durable generation job runner (one job at a time — this is a 1 GB device).
// Jobs are persisted BEFORE work starts; all output goes to staging/<jobId>/
// and is atomically renamed into games/<gameId>/ only after every gate passes.
// On boot the server reconciles: interrupted jobs become failed-retryable.
import { generatePlatformerActions } from '../assets/platformer-actions';
import { randomInt } from 'node:crypto';
import { alignRacingCast, racingIdentityProblems } from './racing-identity';
import { PipelineSuspended, type DurablePipelineCalls, type PipelineStore } from './durable';
import { settleAll } from './parallel';
import { ArtifactCache } from './artifact-cache';
import { compactArtReview } from '../assets/compact-art-review';
import { loadGolden } from '@sparkade/generation';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { archetypes } from '@sparkade/archetypes';
import {
  mechanicalFingerprint,
  platformerMechanics,
  platformerStyleDiagnostics,
  platformerPlayStyle,
  type MechanicalFingerprint,
  ENGINE_VERSION,
  GENERATION,
  nearestMood,
  paletteProblems,
  SPEC_VERSION,
  stageSchema,
  type ArchetypeId,
  type CreationBrief,
  type DesignDoc,
  type FighterCharacter,
  type FighterSpec,
  type GameMetaFile,
  type GeneratedGameAssetRole,
  type RacingMotionRacerStatus,
  type GenerationFeedKind,
  type GameSpec,
  type JobEvent,
  type JobStage,
  type LintError,
  type PartialSpec,
  type PlatformerAbility,
  type PlatformerAbilityKind,
  type PlatformerSpec,
  type SparkadeConfig,
  type StageName,
} from '@sparkade/shared';
import {
  GENERATED_DEFEAT_PORTRAIT_PROMPT_VERSION,
  GENERATED_PORTRAIT_PROMPT_VERSION,
  describeVisibleTraits,
  generateDefeatPortrait,
  generatePortrait,
  type LikenessImageEdit,
} from '../likeness/portrait-gen';
import { buildPortraitIdentityReference } from '../likeness/portrait-reference';
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderNetworkError,
  stageProvider,
} from '../providers/index';
import { MetaImageAdapter, META_IMAGE_DEFAULT_API_KEY_ENV } from '../providers/meta-image';
import {
  buildKeyArtPrompt,
  buildKeyArtPolicyFallbackPrompt,
  buildStoryArtPrompt,
  buildStoryArtPolicyFallbackPrompt,
  KEY_ART_ASPECT_HINT,
  KEY_ART_PROMPT_VERSION,
  mockGeneratedImage,
  normalizeKeyArt,
  normalizeStoryArt,
  prepareImageReference,
  STORY_ART_ASPECT_HINT,
  STORY_ART_PROMPT_VERSION,
  type StoryArtRole,
} from '../assets/game-art';
import { fighterArtDirectionPrompt } from '../assets/fighter-art-direction';
import {
  FIGHTER_ARENA_ASSET_ROLE,
  FIGHTER_ARENA_PROMPT_VERSION,
  buildFighterArenaPrompt,
  normalizeFighterArenaAtlas,
} from '../assets/fighter-arena';
import {
  GENERATED_FIGHTER_ATLAS_PROMPT_VERSION,
  GENERATED_FIGHTER_POSES,
  GENERATED_FIGHTER_POSE_PROMPT_VERSION,
  bestAvailableFighterPoseFallback,
  buildFighterIdentityCandidatePrompt,
  buildGeneratedFighterAtlas,
  buildFighterPosePrompt,
  prepareGeneratedFighterReference,
  processGeneratedFighterPose,
  validateGeneratedFighterAtlas,
  type GeneratedFighterPose,
} from '../assets/fighter-pose';
import {
  FIGHTER_POSE_SHEET_GROUPS,
  FIGHTER_POSE_SHEET_PROMPT_VERSION,
  actionPosesFromSheets,
  buildFighterPoseSheetPrompt,
  buildFighterPoseSheetSeed,
  recoverRejectedFighterSheetCells,
  splitGeneratedFighterPoseSheet,
  type FighterPoseSheetCellResult,
  type FighterPoseSheetGroup,
} from '../assets/fighter-pose-sheet';
import {
  FIGHTER_IDENTITY_JUDGE_PROMPT_VERSION,
  FIGHTER_POSE_JUDGE_PROMPT_VERSION,
  FIGHTER_ROSTER_PIPELINE_PROMPT_VERSION,
  FIGHTER_ROSTER_SLOTS,
  bestFighterIdentityCandidateIds,
  bestFighterPoseCandidateIds,
  buildFighterIdentityJudgeBoard,
  buildFighterIdentityJudgePrompt,
  buildFighterIdentityJudgeSchema,
  buildFighterPoseJudgeBoard,
  buildFighterPoseJudgePrompt,
  buildFighterPoseJudgeSchema,
  fighterPosesNeedingRetry,
  normalizeFighterIdentityJudgeDecision,
  normalizeFighterPoseJudgeDecision,
  type FighterIdentityCandidateDescriptor,
  type FighterPoseCandidateDescriptor,
  type FighterRosterSlot,
} from '../assets/fighter-pose-judge';
import {
  GENERATED_PLATFORMER_POSES,
  GENERATED_PLATFORMER_POSE_PROMPT_VERSION,
  alignGeneratedPlatformerPoseCanvases,
  prepareGeneratedPlatformerReference,
  processGeneratedPlatformerPose,
  recoverGeneratedPlatformerGreenPanel,
  validateGeneratedPlatformerPoseSet,
  type GeneratedPlatformerPose,
} from '../assets/platformer-pose';
import {
  PLATFORMER_IDLE_JUDGE_PROMPT_VERSION,
  bestPlatformerIdleCandidateId,
  buildPlatformerIdleCandidatePrompt,
  buildPlatformerIdleJudgeBoard,
  buildPlatformerIdleJudgePrompt,
  buildPlatformerIdleJudgeSchema,
  normalizePlatformerIdleJudgeDecision,
  type PlatformerIdleCandidateDescriptor,
} from '../assets/platformer-idle-judge';
import {
  PLATFORMER_JUMP_JUDGE_PROMPT_VERSION,
  bestPlatformerJumpCandidateId,
  buildPlatformerJumpJudgeBoard,
  buildPlatformerJumpJudgePrompt,
  buildPlatformerJumpJudgeSchema,
  normalizePlatformerJumpJudgeDecision,
  type PlatformerJumpCandidateDescriptor,
} from '../assets/platformer-jump-judge';
import {
  PLATFORMER_PLAYER_PIPELINE_PROMPT_VERSION,
  PLATFORMER_POSE_JUDGE_PROMPT_VERSION,
  bestPlatformerPosePair,
  buildPlatformerPhaseACandidatePrompt,
  buildPlatformerPhaseBCandidatePrompt,
  buildPlatformerJumpCandidatePrompt,
  buildPlatformerPoseJudgeBoard,
  buildPlatformerPoseJudgePrompt,
  buildPlatformerPoseJudgeSchema,
  buildPlatformerSideAnchorPrompt,
  normalizePlatformerPoseJudgeDecision,
  type PlatformerPoseCandidateDescriptor,
} from '../assets/platformer-pose-judge';
import {
  PLATFORMER_BOSS_JUDGE_PROMPT_VERSION,
  PLATFORMER_BOSS_PIPELINE_PROMPT_VERSION,
  PLATFORMER_BOSS_PROMPT_VERSION,
  bestPlatformerBossCandidateId,
  buildPlatformerBossCandidatePrompt,
  buildPlatformerBossJudgeBoard,
  buildPlatformerBossJudgePrompt,
  buildPlatformerBossJudgeSchema,
  normalizePlatformerBossJudgeDecision,
  processGeneratedPlatformerBoss,
  type PlatformerBossCandidateDescriptor,
} from '../assets/platformer-boss';
import {
  GENERATED_PLATFORMER_ENEMIES,
  PLATFORMER_ENEMY_JUDGE_PROMPT_VERSION,
  PLATFORMER_ENEMY_PIPELINE_PROMPT_VERSION,
  PLATFORMER_ENEMY_PROMPT_VERSION,
  buildPlatformerEnemyCandidatePrompt,
  buildPlatformerEnemyJudgeBoard,
  buildPlatformerEnemyJudgePrompt,
  buildPlatformerEnemyJudgeSchema,
  normalizePlatformerEnemyJudgeDecision,
  processGeneratedPlatformerEnemy,
  type GeneratedPlatformerEnemy,
  type PlatformerEnemyCandidateDescriptor,
} from '../assets/platformer-enemy';
import {
  GENERATED_PLATFORMER_BACKDROPS,
  PLATFORMER_BACKDROP_ASPECT_HINT,
  PLATFORMER_BACKDROP_ASSET_ROLES,
  PLATFORMER_BACKDROP_PROMPT_VERSION,
  buildPlatformerBackdropPrompt,
  normalizePlatformerBackdrop,
  type GeneratedPlatformerBackdrop,
} from '../assets/platformer-backdrop';
import {
  ADVENTURE_ROOM_PLATE_ASPECT_HINT,
  ADVENTURE_ROOM_PLATE_PROMPT_VERSION,
  ADVENTURE_ROOM_PLATE_ROLE,
  buildAdventureRoomPlatePrompt,
  normalizeAdventureRoomPlates,
} from '../assets/adventure-room-plates';
import {
  ADVENTURE_BOSS_JUDGE_PROMPT_VERSION,
  ADVENTURE_BOSS_PIPELINE_PROMPT_VERSION,
  ADVENTURE_BOSS_PROMPT_VERSION,
  ADVENTURE_BOSS_RETRY_PROMPT_VERSION,
  ADVENTURE_BOSS_ROLE,
  bestAdventureBossCandidateId,
  buildAdventureBossBoardPrompt,
  buildAdventureBossJudgeBoard,
  buildAdventureBossJudgePrompt,
  buildAdventureBossJudgeSchema,
  buildAdventureBossRetryPrompt,
  normalizeAdventureBossJudgeDecision,
  processGeneratedAdventureBoss,
  splitGeneratedAdventureBossBoard,
  type AdventureBossCandidate,
} from '../assets/adventure-boss';
import {
  ADVENTURE_ENEMY_ATLAS_ROLE,
  ADVENTURE_ENEMY_BOARD_PROMPT_VERSION,
  ADVENTURE_ENEMY_JUDGE_PROMPT_VERSION,
  ADVENTURE_ENEMY_PIPELINE_PROMPT_VERSION,
  GENERATED_ADVENTURE_ENEMIES,
  bestAdventureEnemyCandidateId,
  buildAdventureEnemyBoardPrompt,
  buildAdventureEnemyJudgeBoard,
  buildAdventureEnemyJudgePrompt,
  buildAdventureEnemyJudgeSchema,
  buildGeneratedAdventureEnemyAtlas,
  normalizeAdventureEnemyJudgeDecision,
  splitGeneratedAdventureEnemyBoard,
  validateGeneratedAdventureEnemyAtlas,
  type GeneratedAdventureEnemy,
} from '../assets/adventure-enemy';
import {
  ADVENTURE_OBJECT_ATLAS_ROLE,
  ADVENTURE_OBJECT_BOARD_PROMPT_VERSION,
  ADVENTURE_OBJECT_JUDGE_PROMPT_VERSION,
  ADVENTURE_OBJECT_PIPELINE_PROMPT_VERSION,
  GENERATED_ADVENTURE_OBJECTS,
  bestAdventureObjectCandidateId,
  buildAdventureObjectBoardPrompt,
  buildAdventureObjectJudgeBoard,
  buildAdventureObjectJudgePrompt,
  buildAdventureObjectJudgeSchema,
  buildGeneratedAdventureObjectAtlas,
  normalizeAdventureObjectJudgeDecision,
  splitGeneratedAdventureObjectBoard,
  validateGeneratedAdventureObjectAtlas,
  type AdventureObjectPromptOptions,
  type GeneratedAdventureObject,
} from '../assets/adventure-object';
import {
  ADVENTURE_PLAYER_PIPELINE_PROMPT_VERSION,
  ADVENTURE_PLAYER_POSE_PROMPT_VERSION,
  GENERATED_ADVENTURE_PLAYER_POSES,
  buildAdventurePlayerIdentityJudgePrompt,
  buildAdventurePlayerIdentityPrompt,
  buildAdventurePlayerIdentityReference,
  buildAdventurePlayerPosePrompt,
  buildAdventurePortraitIdentityReference,
  buildAdventureStoryIdentityReference,
  prepareGeneratedAdventurePlayerReference,
  processGeneratedAdventurePlayerPose,
  validateGeneratedAdventurePlayerPoseSet,
  type GeneratedAdventurePlayerPose,
} from '../assets/adventure-player';
import {
  ADVENTURE_PLAYER_SHEET_GROUPS,
  ADVENTURE_PLAYER_SHEET_PROMPT_VERSION,
  buildAdventurePlayerSheetPrompt,
  buildAdventurePlayerSheetSeed,
  splitGeneratedAdventurePlayerSheet,
  type AdventurePlayerSheetGroup,
} from '../assets/adventure-player-sheet';
import {
  ADVENTURE_PLAYER_SET_JUDGE_PROMPT_VERSION,
  adventurePlayerPosesNeedingRetry,
  adventurePlayerScaleRetryPoses,
  bestAdventurePlayerCandidateIds,
  bestScaleConsistentAdventurePlayerCandidateIds,
  buildAdventurePlayerSetJudgeBoard,
  buildAdventurePlayerSetJudgePrompt,
  buildAdventurePlayerSetJudgeSchema,
  normalizeAdventurePlayerSetJudgeDecision,
  type AdventurePlayerCandidateDescriptor,
  type AdventurePlayerSetJudgeDecision,
} from '../assets/adventure-player-judge';
import {
  PLATFORMER_PROP_PIPELINE_PROMPT_VERSION,
  PLATFORMER_PROP_PROMPT_VERSION,
  buildPlatformerPropPrompt,
  buildPlatformerPropBoardPrompt,
  platformerPropBoardLayout,
  processGeneratedPlatformerProp,
  processGeneratedPlatformerPropBoard,
  type GeneratedPlatformerProp,
} from '../assets/platformer-prop';
import {
  HSHOOTER_CRAFT_PROMPT_VERSION,
  buildHShooterCraftPrompt,
  buildHShooterIdentityReference,
  processGeneratedHShooterCraft,
  processGeneratedHShooterCraftReference,
} from '../assets/hshooter-craft';
import {
  SHOOTER_CRAFT_PROMPT_VERSION,
  buildShooterCraftPrompt,
  processGeneratedShooterCraft,
  processGeneratedShooterCraftReference,
} from '../assets/shooter-craft';
import {
  PLAYER_CRAFT_JUDGE_PROMPT_VERSION,
  bestPlayerCraftCandidateId,
  buildPlayerCraftJudgeBoard,
  buildPlayerCraftJudgePrompt,
  buildPlayerCraftJudgeSchema,
  normalizePlayerCraftJudgeDecision,
  type PlayerCraftCandidateDescriptor,
  type PlayerCraftOrientation,
} from '../assets/player-craft-judge';
import {
  buildRacingIdentityReference,
  processGeneratedRacingCraftStrip,
  processGeneratedRacingCraftStripReference,
} from '../assets/racing-craft';
import { racingArtSubject } from '../assets/racing-traversal-art';
import {
  buildRacingPhotoReviewReference,
  racingPlayerIdentityReview,
} from '../assets/racing-photo-identity';
import {
  buildRacingBankEditReference,
  correctRacingBankPoses,
  extractRacingNeutralCell,
  swapRacingBankCells,
} from '../assets/racing-bank';
import {
  assembleRacingFoundationStrip,
  buildRacingFoundationJudgePrompt,
  buildRacingFoundationJudgeSchema,
  normalizeRacingFoundationDecision,
  processGeneratedRacingFoundation,
} from '../assets/racing-foundation';
import { processGeneratedRacingPanorama } from '../assets/racing-scenery';
import { generateRacingSceneryPack } from '../assets/racing-scenery-pack';
import { generateRacingJetskiMaterialsPack, processGeneratedRacingMaterials } from '../assets/racing-materials';
import {
  RACING_PACK_REQUIRED_ROLES,
  reviewPendingRacingStrips,
  buildRacingPackPlan,
  racingPlayerArtConcept,
  buildRacingRosterJudgeBoard,
  buildRacingRosterJudgePrompt,
  buildRacingRosterJudgeSchema,
  normalizeRacingRosterJudgeDecision,
  racingRosterSlots,
  racingPackDiscipline,
  type RacingPackEntry,
  type RacingRosterSlotDescriptor,
  type RacingSlotCorrectionKind,
} from '../assets/racing-pack';
import {
  GENERATED_HSHOOTER_BACKDROPS,
  HSHOOTER_BACKDROP_ASPECT_HINT,
  HSHOOTER_BACKDROP_ASSET_ROLES,
  HSHOOTER_BACKDROP_PROMPT_VERSION,
  buildHShooterBackdropPrompt,
  normalizeHShooterBackdrop,
  type GeneratedHShooterBackdrop,
} from '../assets/hshooter-backdrop';
import {
  GENERATED_SHOOTER_BACKDROPS,
  SHOOTER_BACKDROP_ASPECT_HINT,
  SHOOTER_BACKDROP_ASSET_ROLES,
  SHOOTER_BACKDROP_PROMPT_VERSION,
  buildShooterBackdropPrompt,
  normalizeShooterBackdrop,
  type GeneratedShooterBackdrop,
} from '../assets/shooter-backdrop';
import {
  HSHOOTER_BOSS_JUDGE_PROMPT_VERSION,
  HSHOOTER_BOSS_PIPELINE_PROMPT_VERSION,
  HSHOOTER_BOSS_PROMPT_VERSION,
  buildHShooterBossCandidatePrompt,
  buildHShooterBossJudgePrompt,
  processGeneratedHShooterBoss,
} from '../assets/hshooter-boss';
import {
  SHOOTER_BOSS_JUDGE_PROMPT_VERSION,
  SHOOTER_BOSS_PIPELINE_PROMPT_VERSION,
  SHOOTER_BOSS_PROMPT_VERSION,
  buildShooterBossCandidatePrompt,
  buildShooterBossJudgePrompt,
  processGeneratedShooterBoss,
} from '../assets/shooter-boss';
import {
  GENERATED_HSHOOTER_ENEMIES,
  HSHOOTER_ENEMY_ATLAS_ROLE,
  HSHOOTER_ENEMY_BOARD_PROMPT_VERSION,
  HSHOOTER_ENEMY_JUDGE_PROMPT_VERSION,
  HSHOOTER_ENEMY_PIPELINE_PROMPT_VERSION,
  HSHOOTER_ENEMY_REPLACEMENT_PROMPT_VERSION,
  bestHShooterEnemyCandidateId,
  buildGeneratedHShooterEnemyAtlas,
  buildHShooterEnemyBoardPrompt,
  buildHShooterEnemyJudgeBoard,
  buildHShooterEnemyJudgePrompt,
  buildHShooterEnemyJudgeSchema,
  buildHShooterEnemyReplacementPrompt,
  normalizeHShooterEnemyJudgeDecision,
  processGeneratedHShooterEnemy,
  splitGeneratedHShooterEnemyBoard,
  validateGeneratedHShooterEnemyAtlas,
  type GeneratedHShooterEnemy,
  type HShooterEnemyCandidate,
} from '../assets/hshooter-enemy';
import {
  GENERATED_SHOOTER_ENEMIES,
  SHOOTER_ENEMY_ATLAS_ROLE,
  SHOOTER_ENEMY_BOARD_PROMPT_VERSION,
  SHOOTER_ENEMY_JUDGE_PROMPT_VERSION,
  SHOOTER_ENEMY_PIPELINE_PROMPT_VERSION,
  SHOOTER_ENEMY_REPLACEMENT_PROMPT_VERSION,
  bestShooterEnemyCandidateId,
  buildGeneratedShooterEnemyAtlas,
  buildShooterEnemyBoardPrompt,
  buildShooterEnemyJudgeBoard,
  buildShooterEnemyJudgePrompt,
  buildShooterEnemyJudgeSchema,
  buildShooterEnemyReplacementPrompt,
  normalizeShooterEnemyJudgeDecision,
  processGeneratedShooterEnemy,
  splitGeneratedShooterEnemyBoard,
  validateGeneratedShooterEnemyAtlas,
  type GeneratedShooterEnemy,
  type ShooterEnemyCandidate,
} from '../assets/shooter-enemy';
import {
  GameAssetWorkspace,
  GeneratedAssetStorageError,
  imagePromptHash,
  RACING_MOTION_OUTCOME_ROLES,
  sha256,
  type PrivateGeneratedAssetRole,
} from '../assets/manifest';
import type { ConfigStore } from '../storage/config';
import type { GameRow } from '../storage/db';
import type { GameFiles, RawStageName } from '../storage/files';
import {
  detectIncidentRuntime,
  hasSubstantiveRepair,
  IncidentStore,
  type GenerationIncident,
  type IncidentOutcome,
} from '../storage/incidents';
import { costOf, type PriceSnapshot } from './cost';
import { applyPatch, PatchError, type JsonPatchOp } from './patch';
import {
  buildDesignPrompt,
  buildEntitiesPrompt,
  buildLevelRegenerationPrompt,
  buildLevelsPrompt,
  buildMusicPrompt,
  buildPlatformerAbilityLoadoutPrompt,
  buildRepairPrompt,
  parseModelJson,
  type RecentUse,
  type BuiltPrompt,
  type RepairOwner,
} from './prompts';
import { compileTileRunsStage, TileRunsError } from './tile-runs';
import {
  assertPatchTargetsOwner,
  diagnosticOwner,
  diagnosticSignature,
  diagnosticsForOwner,
  failingLevelIndexes,
  groupDiagnostics,
  repairMadeProgress,
} from './repair-policy';
import type { SseHub } from './sse';
import {
  applySpriteFallbacks,
  applySpriteFallbacksForRepair,
  customBossSpriteDiagnostics,
  ensureLikenessHeroBody,
  ensurePlatformerImageCharacterFallbacks,
  normalizeGeneratedSpec,
  normalizeTileGrids,
  repairPlatformerExitRoutes,
  securityScan,
  tooSimilar,
  validateDesignSchema,
  validateGameSchema,
  validateAgainst,
} from './validate';
import { ensureDir, nowIso, sleep } from '../util';

export class PipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly stage: JobStage = 'failed',
  ) {
    super(message);
  }
}

type PipelineLlmCall = (
  stage: StageName,
  prompt: BuiltPrompt,
  opts: {
    temperature?: number;
    repair?: boolean;
    image?: Buffer;
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
    checkpoint?: RawStageName;
    /** Optional enhancements skip provider retry/network waits. */
    optional?: boolean;
    label: string;
    stage: JobStage;
  },
) => Promise<unknown>;

function abilityLoadoutIsOnlyDesignError(candidate: unknown): boolean {
  const errors = designOutputDiagnostics(candidate);
  return (
    errors.length > 0 &&
    errors.every((error) => error.code === 'SCHEMA' && error.path === '/abilityLoadout')
  );
}

async function completeDesignAbilityContract(
  callLlm: PipelineLlmCall,
  candidate: unknown,
): Promise<unknown> {
  if (!isRecord(candidate)) return candidate;
  if (candidate.archetype !== 'platformer') {
    return Object.prototype.hasOwnProperty.call(candidate, 'abilityLoadout')
      ? candidate
      : { ...candidate, abilityLoadout: [] };
  }
  if (Array.isArray(candidate.abilityLoadout) && candidate.abilityLoadout.length > 0) {
    return candidate;
  }

  try {
    const completion = await callLlm('design', buildPlatformerAbilityLoadoutPrompt(candidate), {
      label: 'Abilities selected',
      stage: 'designing',
      repair: true,
      reasoningEffort: 'minimal',
    });
    if (isRecord(completion) && Array.isArray(completion.abilityLoadout)) {
      return { ...candidate, abilityLoadout: completion.abilityLoadout };
    }
  } catch (error) {
    if (
      error instanceof PipelineError &&
      ['auth', 'timeout', 'call-timeout', 'provider-unavailable'].includes(error.code)
    ) {
      throw error;
    }
    // Let the ordinary full-design redraft path handle a malformed focused response.
  }
  return candidate;
}

function isOptionalGeneratedArtProviderFailure(error: unknown): boolean {
  return (
    error instanceof PipelineError &&
    (error.code === 'image-provider-error' || error.code === 'image-content-policy')
  );
}

function isImageContentPolicyViolation(error: unknown): boolean {
  return (
    error instanceof ProviderHttpError &&
    error.status === 400 &&
    /content_policy_violation|content management policy/i.test(`${error.body} ${error.message}`)
  );
}

export interface NewJobInputs {
  promptText: string;
  sourceKind: 'voice' | 'preset' | 'surprise' | 'typed';
  presetId?: string;
  /** Explicit engine chosen by the player; authoritative over model classification. */
  requestedArchetype?: ArchetypeId;
  /** User-approved guided creation inputs. */
  creationBrief?: CreationBrief;
  photo?: Buffer;
  idempotencyKey: string;
}

const FIGHTER_ROSTER_ASSET_ROLES = {
  player: 'fighterPlayerAtlas',
  opponent1: 'fighterOpponent1Atlas',
  opponent2: 'fighterOpponent2Atlas',
  opponent3: 'fighterOpponent3Atlas',
  boss: 'fighterBossAtlas',
} as const satisfies Record<FighterRosterSlot, GeneratedGameAssetRole>;

const PLATFORMER_ASSET_ROLES = {
  idle: 'platformerIdle',
  sideIdle: 'platformerSideIdle',
  walk1: 'platformerWalk1',
  walk2: 'platformerWalk2',
  jump: 'platformerJump',
} as const satisfies Record<GeneratedPlatformerPose, GeneratedGameAssetRole>;

const ADVENTURE_PLAYER_ASSET_ROLES = {
  downIdle: 'adventurePlayerDownIdle',
  downWalk: 'adventurePlayerDownWalk',
  upIdle: 'adventurePlayerUpIdle',
  upWalk: 'adventurePlayerUpWalk',
  sideIdle: 'adventurePlayerSideIdle',
  sideWalk: 'adventurePlayerSideWalk',
  downMelee: 'adventurePlayerDownMelee',
  upMelee: 'adventurePlayerUpMelee',
  sideMelee: 'adventurePlayerSideMelee',
  downSecondary: 'adventurePlayerDownSecondary',
  upSecondary: 'adventurePlayerUpSecondary',
  sideSecondary: 'adventurePlayerSideSecondary',
} as const satisfies Record<GeneratedAdventurePlayerPose, GeneratedGameAssetRole>;

const PLATFORMER_ENEMY_ASSET_ROLES = {
  walker: 'platformerEnemyWalker',
  flyer: 'platformerEnemyFlyer',
  shooter: 'platformerEnemyShooter',
  chaser: 'platformerEnemyChaser',
} as const satisfies Record<GeneratedPlatformerEnemy, GeneratedGameAssetRole>;

const PLATFORMER_PROP_ASSET_ROLES = {
  collectible: 'platformerPropCollectible',
  health: 'platformerPropHealth',
  powerup: 'platformerPropPowerup',
  powerupDoubleJump: 'platformerPropPowerupDoubleJump',
  powerupProjectile: 'platformerPropPowerupProjectile',
  powerupShield: 'platformerPropPowerupShield',
  heroProjectile: 'platformerPropHeroProjectile',
  enemyProjectile: 'platformerPropEnemyProjectile',
} as const satisfies Record<GeneratedPlatformerProp, GeneratedGameAssetRole>;

const PLATFORMER_ABILITY_PROP_ROLES = {
  doubleJump: 'powerupDoubleJump',
  projectile: 'powerupProjectile',
  shield: 'powerupShield',
} as const satisfies Record<PlatformerAbilityKind, GeneratedPlatformerProp>;

const PLATFORMER_PROP_ABILITY_KINDS: Partial<
  Record<GeneratedPlatformerProp, PlatformerAbilityKind>
> = {
  powerupDoubleJump: 'doubleJump',
  powerupProjectile: 'projectile',
  powerupShield: 'shield',
  heroProjectile: 'projectile',
};

function generatedPlatformerPropRoles(spec: PlatformerSpec): GeneratedPlatformerProp[] {
  if (!spec.abilityLoadout?.length) {
    return ['collectible', 'health', 'powerup', 'heroProjectile', 'enemyProjectile'];
  }
  return [
    'collectible',
    'health',
    ...spec.abilityLoadout.map(({ kind }) => PLATFORMER_ABILITY_PROP_ROLES[kind]),
    ...(spec.abilityLoadout.some(({ kind }) => kind === 'projectile')
      ? (['heroProjectile'] as const)
      : []),
    'enemyProjectile',
  ];
}

function platformerPropAbility(
  spec: PlatformerSpec,
  role: GeneratedPlatformerProp,
): PlatformerAbility | undefined {
  const kind = PLATFORMER_PROP_ABILITY_KINDS[role];
  return kind ? spec.abilityLoadout?.find((ability) => ability.kind === kind) : undefined;
}

const HSHOOTER_ENEMY_REPLACEMENT_ASSET_ROLES = {
  popcorn: 'hshooterEnemyReplacementPopcorn',
  weaver: 'hshooterEnemyReplacementWeaver',
  tank: 'hshooterEnemyReplacementTank',
  turret: 'hshooterEnemyReplacementTurret',
  kamikaze: 'hshooterEnemyReplacementKamikaze',
} as const satisfies Record<GeneratedHShooterEnemy, PrivateGeneratedAssetRole>;

const SHOOTER_ENEMY_REPLACEMENT_ASSET_ROLES = {
  popcorn: 'shooterEnemyReplacementPopcorn',
  weaver: 'shooterEnemyReplacementWeaver',
  tank: 'shooterEnemyReplacementTank',
  turret: 'shooterEnemyReplacementTurret',
  kamikaze: 'shooterEnemyReplacementKamikaze',
} as const satisfies Record<GeneratedShooterEnemy, PrivateGeneratedAssetRole>;

/** The player's structured engine choice is authoritative; the design model still gets
 * the instruction, but cannot silently relabel the job by returning another id. */
export function enforceRequestedArchetype(
  design: DesignDoc,
  requestedArchetype?: ArchetypeId,
): DesignDoc {
  return requestedArchetype ? { ...design, archetype: requestedArchetype } : design;
}

function dedupeDiagnostics(diagnostics: readonly LintError[]): LintError[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}\u0000${diagnostic.path}\u0000${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compileGeneratedLevels(
  archetype: ArchetypeId,
  output: unknown,
  requireCompact = false,
): unknown {
  if (archetype === 'adventure') {
    const result = structuredClone(output);
    const levels = Array.isArray(result) ? result : isRecord(result) ? result['levels'] : null;
    if (Array.isArray(levels))
      for (const dungeon of levels) {
        if (!isRecord(dungeon) || !Array.isArray(dungeon['rooms'])) continue;
        for (const room of dungeon['rooms'])
          if (isRecord(room) && isRecord(room['puzzle'])) {
            const puzzle = room['puzzle'];
            if (
              ['pushLane', 'cornerTurn', 'splitPlates'].includes(String(puzzle['pattern'])) &&
              [0, 1, 2].includes(Number(puzzle['variant']))
            )
              Object.assign(
                room,
                adventurePuzzleGeometry(
                  puzzle as unknown as import('@sparkade/shared').AdventurePuzzle,
                ),
              );
          }
      }
    return result;
  }
  if (archetype !== 'platformer' && archetype !== 'hshooter') return output;
  if (requireCompact) {
    const levels = Array.isArray(output) ? output : isRecord(output) ? output['levels'] : null;
    if (!Array.isArray(levels)) throw new TileRunsError('$.levels', 'expected an array');
    levels.forEach((level, index) => {
      if (
        !isRecord(level) ||
        !(
          Object.prototype.hasOwnProperty.call(level, 'tileRuns') ||
          (archetype === 'platformer' &&
            (Object.prototype.hasOwnProperty.call(level, 'towerRoute') ||
              Object.prototype.hasOwnProperty.call(level, 'encounterRoute')))
        )
      ) {
        throw new TileRunsError(
          `$.levels[${index}].tileRuns`,
          'compact generation output must include tileRuns (or encounterRoute/towerRoute for platformers) instead of tiles',
        );
      }
    });
  }
  return compileTileRunsStage(archetype, output, { normalizeWidths: true });
}

function compileGeneratedLevel(archetype: ArchetypeId, level: unknown): unknown {
  if (archetype !== 'platformer' && archetype !== 'hshooter') return level;
  if (
    !isRecord(level) ||
    !(
      Object.prototype.hasOwnProperty.call(level, 'tileRuns') ||
      (archetype === 'platformer' &&
        (Object.prototype.hasOwnProperty.call(level, 'towerRoute') ||
          Object.prototype.hasOwnProperty.call(level, 'encounterRoute')))
    )
  ) {
    throw new TileRunsError(
      '$.levels[0].tileRuns',
      'compact generation output must include tileRuns (or encounterRoute/towerRoute for platformers) instead of tiles',
    );
  }
  const compiled = compileTileRunsStage(
    archetype,
    { levels: [level] },
    { normalizeWidths: true },
  ) as { levels: unknown[] };
  return compiled.levels[0];
}

function canonicalLevelsFallback(
  archetype: ArchetypeId,
  output: unknown,
  compactError: TileRunsError,
): unknown {
  const canonical = compileGeneratedLevels(archetype, output);
  const errors = validateAgainst(
    `canonical-fallback:${archetype}:levels`,
    stageSchema(archetype, 'levels'),
    canonical,
  );
  if (errors.length) throw compactError;
  return canonical;
}

function canonicalLevelFallback(level: unknown, compactError: TileRunsError): unknown {
  if (
    isRecord(level) &&
    Array.isArray(level['tiles']) &&
    !Object.prototype.hasOwnProperty.call(level, 'tileRuns')
  ) {
    return level;
  }
  throw compactError;
}

function tileRunsDiagnostic(error: TileRunsError, levelIndex?: number): LintError {
  let pointer = error.path
    .replace(/^\$\.?/, '/')
    .replace(/\[(\d+)\]/g, '/$1')
    .replace(/\./g, '/')
    .replace(/\/{2,}/g, '/');
  if (levelIndex !== undefined) {
    pointer = pointer.replace(/^\/levels\/0(?=\/|$)/, `/levels/${levelIndex}`);
  }
  return {
    code: 'TILE_RUNS_INVALID',
    path: pointer.startsWith('/') ? pointer : '/levels',
    message: error.message,
  };
}

export function designOutputDiagnostics(raw: unknown): LintError[] {
  const schema = validateDesignSchema(raw);
  if (schema.length || !isRecord(raw)) return schema;
  if (raw.archetype === 'platformer' && Array.isArray(raw.abilityLoadout)) {
    const kinds = raw.abilityLoadout.flatMap((ability) =>
      isRecord(ability) && typeof ability.kind === 'string' ? [ability.kind] : [],
    );
    if (new Set(kinds).size !== kinds.length) {
      return [
        {
          code: 'PLAT_ABILITY_DUPLICATE',
          path: '/abilityLoadout',
          message: 'choose distinct platformer ability behavior kinds',
        },
      ];
    }
  }
  if (raw.archetype === 'platformer') {
    const styleErrors = platformerStyleDiagnostics(raw as unknown as PlatformerSpec);
    if (styleErrors.length) return styleErrors;
  }
  // Reuse the same inert-string scan applied to the assembled game. Supplying
  // an empty sprite roster keeps design fields at their natural JSON paths.
  return securityScan({
    ...raw,
    sprites: { custom: {}, assign: {} },
  } as unknown as GameSpec);
}

/**
 * A JSON parse failure at the model's completion ceiling is usually truncation,
 * not a request that benefits from repeating the same ceiling. Grow only the
 * retry allowance, conservatively and with a hard +4k cap, so a rare malformed
 * response cannot turn into an unbounded generation bill.
 */
export function parseRetryTokenBudget(baseTokens: number, retryAttempt: number): number {
  const base = Number.isFinite(baseTokens) ? Math.max(1, Math.round(baseTokens)) : 1;
  const attempt = Number.isFinite(retryAttempt) ? Math.max(1, Math.floor(retryAttempt)) : 1;
  return Math.min(base + 4000, Math.ceil(base * (1 + attempt * 0.25)));
}

/**
 * Level geometry already gets its creative direction from the design pass.
 * Live Muse runs at temperature 1 spent 10.5k tokens and truncated, while the
 * otherwise identical temperature-0 retries completed in 6.5-7.1k tokens.
 * Keep that heavy structured stage deterministic from its first call; every
 * retry remains deterministic for all stages.
 */
export function generationTemperature(
  stage: StageName,
  retryAttempt: number,
  requested?: number,
): number | undefined {
  return retryAttempt > 0 || stage === 'levels' ? 0 : requested;
}

interface SpecParts {
  player?: unknown;
  levels?: unknown;
  entities?: {
    sprites: unknown;
    boss: unknown;
    sfx?: unknown;
    backdrop?: unknown;
    weather?: unknown;
    lighting?: unknown;
    juice?: unknown;
  };
  music?: unknown;
}

/** One player-strip candidate: gameplay strip plus its HR reference. */
export interface RacingPlayerStripCandidate {
  gameplay: Buffer;
  presentationReference: Buffer;
}

/** Semantic verdict for one player-strip review, in judge vocabulary. */
export interface RacingPlayerStripVerdict {
  accepted: boolean;
  /** Fail-closed category: 'none' on a reject means a full repaint. */
  kind: RacingSlotCorrectionKind;
  guidance: string;
}

export type RacingPlayerReviewPhase = 'initial' | 'corrected' | 'verify';

/**
 * Injected player-strip operations. Every review MUST run the same complete
 * semantic gate; repairBanks MUST preserve the accepted neutral cell and its
 * HR presentation reference (no unrelated story/portrait regeneration).
 * Provider policy refusals propagate out of every op — the sequence never
 * catches them into another repair attempt.
 */
export interface RacingPlayerStripRepairOps {
  generateInitial(): Promise<RacingPlayerStripCandidate>;
  review(gameplay: Buffer, phase: RacingPlayerReviewPhase): Promise<RacingPlayerStripVerdict>;
  repaint(guidance: string): Promise<RacingPlayerStripCandidate>;
  repairBanks(
    current: RacingPlayerStripCandidate,
    guidance: string,
  ): Promise<RacingPlayerStripCandidate>;
  swapBankCells(gameplay: Buffer): Promise<Buffer>;
  onRepair(kind: 'banking' | 'vehicle' | 'swap'): void;
}

/**
 * Bounded category-aware player-strip repair BEFORE the reference freezes.
 * Re-reads the CURRENT verdict category every round: at most one full
 * repaint (vehicle verdict) and one two-image bank repair (banking verdict).
 * The bank cell swap runs at most once, only after a bank correction and
 * only while the verdict is still banking. Every candidate — initial,
 * repaint, bank repair, swap — passes the SAME complete semantic gate; a
 * still-rejected strip fails loudly with image-invalid, never a loosened
 * gate or a silent artless fallback. Image budget: 1 initial + 1 repaint +
 * 2 bank edits; reviews: at most 4.
 */
export async function runRacingPlayerStripRepair(
  ops: RacingPlayerStripRepairOps,
): Promise<RacingPlayerStripCandidate> {
  let candidate = await ops.generateInitial();
  let verdict = await ops.review(candidate.gameplay, 'initial');
  let didRepaint = false;
  let didBankRepair = false;
  let didSwap = false;
  while (!verdict.accepted) {
    const banking = verdict.kind === 'banking';
    if (banking && !didBankRepair) {
      ops.onRepair('banking');
      candidate = await ops.repairBanks(candidate, verdict.guidance);
      didBankRepair = true;
      verdict = await ops.review(candidate.gameplay, 'corrected');
    } else if (!banking && !didRepaint) {
      ops.onRepair('vehicle');
      candidate = await ops.repaint(verdict.guidance);
      didRepaint = true;
      verdict = await ops.review(candidate.gameplay, 'corrected');
    } else if (banking && didBankRepair && !didSwap) {
      // Image edits sometimes return correct opposite rolls under the wrong
      // labels. One cell-order repair after the bank correction, then the
      // same complete review; never mirror or waive a verdict.
      ops.onRepair('swap');
      candidate = { ...candidate, gameplay: await ops.swapBankCells(candidate.gameplay) };
      didSwap = true;
      verdict = await ops.review(candidate.gameplay, 'verify');
    } else {
      break;
    }
  }
  if (!verdict.accepted) {
    throw new PipelineError(
      'image-invalid',
      `Player vehicle review rejected the strip${verdict.guidance ? `: ${verdict.guidance.slice(0, 200)}` : ''}`,
      'building-assets',
    );
  }
  return candidate;
}

/** One rival's correction in a repair round. `exhausted` spends no call. */
export type RacingRivalRepairAction = 'repaint' | 'bank' | 'swap' | 'exhausted';

/** Per-rival repair budgets consumed by the round loop below. */
export interface RacingRivalRepairState {
  didRepaint: boolean;
  didBankRepair: boolean;
  didSwap: boolean;
}

export function freshRacingRivalRepairState(): RacingRivalRepairState {
  return { didRepaint: false, didBankRepair: false, didSwap: false };
}

/** Backstop on correction rounds; natural termination needs at most 4
 * (repaint, bank, swap, then an all-exhausted pass that breaks). */
export const RACING_RIVAL_REPAIR_MAX_ROUNDS = 4;

/**
 * One rival's repair for the CURRENT verdict category: a banking verdict
 * takes the neutral-preserving two-image bank correction, anything else
 * (vehicle, none, unknown — fail-closed) takes one full repaint, and the
 * cell-order swap runs only after a bank correction while the verdict is
 * still banking. Each budget spends once; afterwards the rival is exhausted
 * and must not be retried.
 */
export function planRacingRivalRepair(
  kind: RacingSlotCorrectionKind,
  state: RacingRivalRepairState,
): RacingRivalRepairAction {
  if (kind === 'banking' && !state.didBankRepair) return 'bank';
  if (kind !== 'banking' && !state.didRepaint) return 'repaint';
  if (kind === 'banking' && state.didBankRepair && !state.didSwap) return 'swap';
  return 'exhausted';
}

export interface RacingRivalRoundAction {
  id: string;
  action: RacingRivalRepairAction;
}

/**
 * Pure per-round plan for the rival repair loop. Re-reads the CURRENT
 * rejected ids and categories every round: approved rivals (durable
 * selections riding as reference-only rows) are never redone, and each
 * pending rival gets exactly its planner action — including `exhausted`,
 * which the loop must answer with no call.
 */
export function planRacingRivalRepairRound(
  rejectedIds: readonly string[],
  correctionKinds: Readonly<Record<string, RacingSlotCorrectionKind>>,
  approvedIds: ReadonlySet<string>,
  states: ReadonlyMap<string, RacingRivalRepairState>,
): RacingRivalRoundAction[] {
  const actions: RacingRivalRoundAction[] = [];
  for (const id of rejectedIds) {
    if (approvedIds.has(id)) continue;
    const kind = correctionKinds[id] ?? 'vehicle';
    actions.push({
      id,
      action: planRacingRivalRepair(kind, states.get(id) ?? freshRacingRivalRepairState()),
    });
  }
  return actions;
}

export class GenerationRunner {
  private queue: string[] = [];
  private active = new Set<string>(); // jobs currently running (up to maxConcurrent)
  private readonly maxConcurrent = Math.max(
    1,
    Number(process.env.SPARKADE_GEN_CONCURRENCY) || GENERATION.maxConcurrentJobs,
  );
  private aborts = new Map<string, AbortController>();
  private canceled = new Set<string>();
  private activeImageCalls = 0;
  private readonly maxConcurrentImageCalls = Math.max(
    1,
    Number(process.env.SPARKADE_IMAGE_CONCURRENCY) || GENERATION.maxConcurrentImageCalls,
  );
  private imageCallWaiters: Array<{
    signal: AbortSignal;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    onAbort: () => void;
  }> = [];
  private readonly incidents: IncidentStore | null;

  constructor(
    private db: PipelineStore,
    private files: GameFiles,
    private configStore: Pick<ConfigStore, 'get'>,
    private hub: SseHub,
    private readonly historyForJob?: (jobId: string) => GameRow[],
    private readonly durable?: DurablePipelineCalls,
  ) {
    // A few pure semaphore tests intentionally provide a minimal file-store
    // double. Incident capture is best-effort telemetry, never a prerequisite
    // for constructing or running the generation machinery.
    this.incidents = typeof files.dir === 'string' ? new IncidentStore(files.dir) : null;
  }

  /** Called at boot: interrupted jobs -> failed-retryable (never stuck "Generating"). */
  reconcile(): void {
    this.db.reconcileInterruptedJobs();
  }

  isBusy(): boolean {
    return this.active.size > 0;
  }

  private publishFeed(input: {
    jobId: string;
    gameId: string;
    attempt: number;
    kind: GenerationFeedKind;
    stage?: JobStage;
    message: string;
    payload?: Record<string, unknown>;
  }): void {
    try {
      const event = this.db.appendGenerationEvent(input);
      this.hub.emit({ type: 'feed', jobId: input.jobId, event });
    } catch (error) {
      // The canonical job row remains the source of truth if the optional
      // presentation history cannot be written (for example, a nearly-full disk).
      console.warn('could not append generation feed event:', error);
    }
  }

  createJob(
    inputs: NewJobInputs,
    options: { defer?: boolean } = {},
  ): { jobId: string; gameId: string } {
    const existing = this.db.getJobByIdempotencyKey(inputs.idempotencyKey);
    if (existing) return { jobId: existing.id, gameId: existing.gameId };

    const gameId = `g-${nanoid(10)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, 'x')}`;
    const jobId = `j-${nanoid(12)}`;
    const seed = randomInt(0, 2147483647);
    const config = this.configStore.get();
    const snapshot = this.snapshotPricing(config);
    const title = inputs.promptText.slice(0, 28).trim() || 'New game';

    // Persist BEFORE any work: photo to staging, then job + game rows.
    if (inputs.photo) {
      const dir = this.files.stagingFor(jobId);
      writeFileSync(join(dir, 'photo.jpg'), inputs.photo, { mode: 0o600 });
    }
    this.db.insertJob(
      {
        id: jobId,
        gameId,
        status: 'queued',
        stage: 'queued',
        detail: 'Waiting in line',
        promptText: inputs.promptText,
        sourceKind: inputs.sourceKind,
        ...(inputs.presetId ? { presetId: inputs.presetId } : {}),
        ...(inputs.requestedArchetype ? { requestedArchetype: inputs.requestedArchetype } : {}),
        ...(inputs.creationBrief ? { creationBrief: inputs.creationBrief } : {}),
        seed,
        idempotencyKey: inputs.idempotencyKey,
        hasPhoto: !!inputs.photo,
        createdAt: nowIso(),
        costSoFarUsd: 0,
        attempt: 1,
      },
      snapshot,
      {
        model: config.imageGeneration.model,
        perImageUsd: Number.isFinite(config.imageGeneration.pricePerImageUsd)
          ? Math.max(0, config.imageGeneration.pricePerImageUsd)
          : null,
      },
    );
    this.db.upsertGame({
      id: gameId,
      title,
      tagline: 'Generating…',
      archetype: inputs.requestedArchetype ?? 'platformer',
      status: 'queued',
      createdAt: nowIso(),
      golden: false,
      jobId,
      costUsd: 0,
      cover: null,
      failure: null,
      engineVersion: ENGINE_VERSION,
      archetypeVersion: '',
    });
    this.publishFeed({
      jobId,
      gameId,
      attempt: 1,
      kind: 'progress',
      stage: 'queued',
      message: 'Creation brief approved — waiting in line',
      ...(inputs.creationBrief
        ? {
            payload: {
              archetype: inputs.creationBrief.archetype ?? null,
              heroName: inputs.creationBrief.heroName ?? null,
              details: inputs.creationBrief.details ?? null,
            },
          }
        : {}),
    });
    if (!options.defer) this.enqueue(jobId);
    return { jobId, gameId };
  }

  /** Cloud ownership and job rows commit together before execution starts. */
  startJob(jobId: string): void {
    if (this.db.getJob(jobId)?.status === 'queued' && !this.active.has(jobId)) this.enqueue(jobId);
  }

  /** A persistent cloud worker recovers queued work and bounded interrupted
   * attempts. Ordinary failed jobs still require an explicit retry. */
  recoverCloudJobs(): void {
    const interrupted = this.db
      .listJobs()
      .filter((job) => ['running', 'waiting-network'].includes(job.status));
    for (const job of interrupted) {
      this.db.updateJob(job.id, {
        status: 'failed',
        stage: 'failed',
        error: {
          code: 'interrupted',
          message: 'The generation worker restarted. Retry to continue.',
          stage: job.stage,
        },
      });
      this.db.setGameStatus(job.gameId, 'failed');
      if (job.attempt < 3) this.retryJob(job.gameId);
    }
    for (const job of this.db.listJobs()) if (job.status === 'queued') this.startJob(job.id);
  }

  /** Re-run failed generation from stored inputs; cost history is preserved. */
  retryJob(gameId: string): { jobId: string } | null {
    const job = this.db.getJobForGame(gameId);
    if (!job || (job.status !== 'failed' && job.status !== 'canceled')) return null;
    this.canceled.delete(job.id);
    try {
      this.incidents?.markRetry(job.id, job.attempt, job.attempt + 1, 'running');
    } catch (error) {
      console.warn('could not update generation incident retry state:', error);
    }
    this.db.updateJob(job.id, {
      status: 'queued',
      stage: 'queued',
      detail: 'Retrying',
      error: null,
      attempt: job.attempt + 1,
    });
    // Clear only the visible preview. Durable raw checkpoints remain available
    // to the next attempt, which validates and restores every healthy completed
    // stage while regenerating the recorded failing owner. The photo and cost
    // history are preserved as before.
    this.db.resetGameForRetry(gameId, job.promptText.slice(0, 28).trim() || 'New game');
    this.files.clearPartial(job.id);
    this.publishFeed({
      jobId: job.id,
      gameId,
      attempt: job.attempt + 1,
      kind: 'progress',
      stage: 'queued',
      message: `Retry ${job.attempt + 1} queued — restoring completed work`,
    });
    this.enqueue(job.id);
    return { jobId: job.id };
  }

  /** Cancel a running/queued job (used by game delete). */
  cancelForGame(gameId: string): void {
    const job = this.db.getJobForGame(gameId);
    if (!job) return;
    this.canceled.add(job.id);
    this.queue = this.queue.filter((j) => j !== job.id);
    this.aborts.get(job.id)?.abort();
    if (job.status === 'queued' || job.status === 'running' || job.status === 'waiting-network') {
      this.db.updateJob(job.id, { status: 'canceled', finishedAt: nowIso() });
    }
    this.files.discardStaging(job.id);
  }

  private enqueue(jobId: string): void {
    if (!this.queue.includes(jobId)) this.queue.push(jobId);
    this.pump();
  }

  /** Start jobs until the concurrency cap is reached. Jobs run independently
   *  (isolated staging + abort + DB rows), so several proceed in parallel and
   *  their model-call waits overlap. */
  private pump(): void {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const jobId = this.queue.shift()!;
      this.active.add(jobId);
      void this.runOne(jobId);
    }
  }

  private async runOne(jobId: string): Promise<void> {
    try {
      await this.execute(jobId);
    } finally {
      this.active.delete(jobId);
      this.pump(); // fill the freed slot
    }
  }

  private snapshotPricing(config: SparkadeConfig): PriceSnapshot {
    return structuredClone(config.pricing);
  }

  /** FIFO semaphore shared by every running job. The slot is held only for the
   * provider request itself, never validation, local image work, or backoff. */
  private async withImageCallSlot<T>(signal: AbortSignal, call: () => Promise<T>): Promise<T> {
    const release = await this.acquireImageCallSlot(signal);
    try {
      return await call();
    } finally {
      release();
    }
  }

  private acquireImageCallSlot(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new Error('image request canceled'));
    if (this.activeImageCalls < this.maxConcurrentImageCalls) {
      this.activeImageCalls++;
      return Promise.resolve(() => this.releaseImageCallSlot());
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.imageCallWaiters.indexOf(waiter);
          if (index >= 0) this.imageCallWaiters.splice(index, 1);
          signal.removeEventListener('abort', waiter.onAbort);
          reject(new Error('image request canceled'));
        },
      };
      this.imageCallWaiters.push(waiter);
      signal.addEventListener('abort', waiter.onAbort, { once: true });
    });
  }

  private releaseImageCallSlot(): void {
    for (;;) {
      const waiter = this.imageCallWaiters.shift();
      if (!waiter) {
        this.activeImageCalls--;
        return;
      }
      waiter.signal.removeEventListener('abort', waiter.onAbort);
      if (waiter.signal.aborted) {
        waiter.reject(new Error('image request canceled'));
        continue;
      }
      waiter.resolve(() => this.releaseImageCallSlot());
      return;
    }
  }

  // ------------------------------------------------------------------ execute

  /** Await one execution pass; cloud callers persist its state between steps. */
  async execute(jobId: string): Promise<void> {
    const job = this.db.getJob(jobId);
    if (!job || this.canceled.has(jobId)) return;
    const gameId = job.gameId;
    const config = this.configStore.get();
    const snapshot = this.db.jobPriceSnapshot(jobId);
    const imageSnapshot = this.db.jobImagePriceSnapshot(jobId) ?? {
      model: config.imageGeneration.model,
      perImageUsd: Number.isFinite(config.imageGeneration.pricePerImageUsd)
        ? Math.max(0, config.imageGeneration.pricePerImageUsd)
        : null,
    };
    const abort = this.durable?.abort ?? new AbortController();
    this.aborts.set(jobId, abort);
    const startedAt = this.durable && job.startedAt ? Date.parse(job.startedAt) : Date.now();
    let slow = false;
    const softTimer = setTimeout(() => {
      slow = true;
    }, GENERATION.softBudgetMs);
    const hardTimer = setTimeout(() => abort.abort(), GENERATION.hardBudgetMs);
    const throwIfSuspended = (error?: unknown) => {
      if (error instanceof PipelineSuspended) throw error;
      if (this.durable?.suspended() && abort.signal.aborted)
        throw new PipelineError('suspended', 'Waiting for cloud steps');
    };
    let lastFeedProgress = '';

    const feed = (
      kind: GenerationFeedKind,
      message: string,
      stage?: JobStage,
      payload?: Record<string, unknown>,
    ) =>
      this.publishFeed({
        jobId,
        gameId,
        attempt: job.attempt,
        kind,
        ...(stage ? { stage } : {}),
        message,
        ...(payload ? { payload } : {}),
      });

    const emit = (
      stage: JobStage,
      detail: string,
      extra: Partial<Extract<JobEvent, { type: 'progress' }>> = {},
    ) => {
      this.db.updateJob(jobId, { stage, detail });
      const feedSignature = `${stage}\u0000${detail}`;
      if (feedSignature !== lastFeedProgress) {
        lastFeedProgress = feedSignature;
        feed('progress', detail, stage, {
          ...(extra.unitsDone !== undefined ? { unitsDone: extra.unitsDone } : {}),
          ...(extra.unitsTotal !== undefined ? { unitsTotal: extra.unitsTotal } : {}),
          ...(extra.waitingForNetwork ? { waitingForNetwork: true } : {}),
          ...(slow ? { slow: true } : {}),
        });
      }
      this.hub.emit({
        type: 'progress',
        jobId,
        stage,
        detail,
        elapsedMs: Date.now() - startedAt,
        costSoFarUsd: this.db.gameCost(gameId),
        slow,
        ...extra,
      });
    };

    const callLlm: PipelineLlmCall = async (stageName, prompt, opts): Promise<unknown> => {
      const { provider, providerName, model } = stageProvider(config, stageName);
      if (opts.image && !provider.capabilities.imageIn) {
        throw new Error(`provider "${providerName}" does not support image input`);
      }
      let attempt = 0;
      let activePrompt =
        opts.image && opts.stage === 'building-assets' ? compactArtReview(prompt) : prompt;
      for (;;) {
        if (abort.signal.aborted)
          throw new PipelineError('timeout', 'generation hit the time limit', opts.stage);
        try {
          const stageCfg = config.stages[stageName];
          const complete: typeof provider.complete = this.durable
            ? (request, options) =>
                this.durable!.complete(stageName, request, options?.model ?? model)
            : provider.complete.bind(provider);
          const res = await complete(
            {
              system: activePrompt.system,
              user: activePrompt.user,
              maxTokens: activePrompt.maxTokens,
              temperature: generationTemperature(stageName, attempt, opts.temperature),
              ...(opts.reasoningEffort
                ? { effort: opts.reasoningEffort }
                : stageCfg?.reasoningEffort
                  ? { effort: stageCfg.reasoningEffort }
                  : {}),
              ...(activePrompt.timeoutMs ? { timeoutMs: activePrompt.timeoutMs } : {}),
              ...(provider.capabilities.structuredOutput
                ? { jsonSchema: activePrompt.jsonSchema }
                : {}),
              ...(opts.image && provider.capabilities.imageIn ? { image: opts.image } : {}),
            },
            { model, signal: abort.signal },
          );
          const servedModel = res.model ?? model;
          this.db.insertUsage({
            jobId,
            gameId,
            stage: stageName,
            model: servedModel,
            provider: providerName,
            requestId: (res as { durableRequestId?: string }).durableRequestId,
            inputTokens: res.usage.input,
            outputTokens: res.usage.output,
            cachedTokens: res.usage.cachedInput ?? 0,
            costUsd: costOf(servedModel, res.usage, snapshot),
            failed: false,
            repair: opts.repair ?? false,
          });
          emit(opts.stage, opts.label, {});
          const parsed = parseModelJson(res.text);
          if (opts.checkpoint) {
            try {
              this.files.writeRawStageCheckpoint(jobId, job.attempt, opts.checkpoint, parsed);
            } catch {
              // Checkpointing is evidence/resume infrastructure; a full disk or
              // permissions issue must not turn a valid, already-billed model
              // response into an identical provider retry.
            }
          }
          return parsed;
        } catch (e) {
          throwIfSuspended(e);
          if (abort.signal.aborted)
            throw new PipelineError('timeout', 'generation hit the time limit', opts.stage);
          if (e instanceof ProviderAuthError) {
            throw new PipelineError('auth', e.message, opts.stage);
          }
          if (e instanceof ProviderNetworkError && !opts.optional) {
            // Offline: wait rather than fail. The hard cap still bounds the job.
            this.db.updateJob(jobId, { status: 'waiting-network' });
            emit(opts.stage, 'Waiting for network…', { waitingForNetwork: true });
            await sleep(8000, abort.signal).catch(() => {
              throw new PipelineError('timeout', 'generation hit the time limit', opts.stage);
            });
            this.db.updateJob(jobId, { status: 'running' });
            continue; // network waits don't consume transient-retry budget
          }
          const transient = e instanceof ProviderHttpError && e.transient;
          const parseIssue = e instanceof Error && /JSON|parse/i.test(e.message);
          if (opts.optional && !parseIssue && !(e instanceof ProviderHttpError) && !(e instanceof ProviderNetworkError))
            throw e;
          this.db.insertUsage({
            jobId,
            gameId,
            stage: stageName,
            model,
            provider: providerName,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            failed: true,
            repair: opts.repair ?? false,
          });
          if (!opts.optional && (transient || parseIssue) && attempt < GENERATION.maxTransientRetriesPerCall) {
            attempt++;
            if (parseIssue) {
              activePrompt = {
                ...prompt,
                user: `${prompt.user}\n\nRETRY NOTE: The previous response was not valid JSON. Return one complete JSON value matching the response schema, with every string escaped and no prose or markdown.`,
                maxTokens: parseRetryTokenBudget(prompt.maxTokens, attempt),
              };
            }
            const retryAfter =
              e instanceof ProviderHttpError && e.retryAfterS ? e.retryAfterS * 1000 : 0;
            const backoff =
              Math.max(retryAfter, 1000 * Math.pow(3, attempt - 1)) + Math.random() * 500;
            emit(opts.stage, `Retrying (${attempt}/${GENERATION.maxTransientRetriesPerCall})…`);
            await sleep(backoff, abort.signal).catch(() => {
              throw new PipelineError('timeout', 'generation hit the time limit', opts.stage);
            });
            continue;
          }
          const timedOut = e instanceof ProviderHttpError && e.status === 408;
          throw new PipelineError(
            timedOut ? 'call-timeout' : transient || e instanceof ProviderNetworkError ? 'provider-unavailable' : 'provider-error',
            e instanceof Error ? e.message : String(e),
            opts.stage,
          );
        }
      }
    };

    const mockImages = process.env.SPARKADE_PROVIDER === 'mock';
    const imageConfig = config.imageGeneration;
    const imageModel = mockImages ? 'mock-image' : imageSnapshot.model;
    // Construct lazily inside callImage's guarded try. Invalid live config must
    // become a persisted job failure, not reject execute before its outer
    // failure/finally handling has started.
    let imageAdapter: MetaImageAdapter | null = null;
    const getImageAdapter = (): MetaImageAdapter | null => {
      if (mockImages) return null;
      imageAdapter ??= new MetaImageAdapter({
        baseUrl: imageConfig.baseUrl,
        model: imageModel,
        apiKeyEnv: imageConfig.apiKeyEnv,
        timeoutMs: imageConfig.timeoutMs,
      });
      return imageAdapter;
    };
    const imagePrice = mockImages ? 0 : imageSnapshot.perImageUsd;
    const callImage = async (opts: {
      optional?: boolean;
      role: string;
      label: string;
      prompt: string;
      reference?: Buffer;
      size?: string;
    }): Promise<Buffer> => {
      let attempt = 0;
      for (;;) {
        if (abort.signal.aborted) {
          throw new PipelineError('timeout', 'generation hit the time limit', 'building-assets');
        }
        try {
          const adapter = getImageAdapter();
          const localImageCall = () =>
            this.withImageCallSlot(abort.signal, async () =>
              adapter
                ? opts.reference
                  ? adapter.edit(
                      {
                        prompt: opts.prompt,
                        image: opts.reference,
                        imageMimeType: 'image/png',
                        imageFilename: 'reference.png',
                        outputFormat: 'png',
                        size: opts.size ?? imageConfig.size,
                        user: gameId,
                      },
                      { signal: abort.signal },
                    )
                  : adapter.generate(
                      {
                        prompt: opts.prompt,
                        outputFormat: 'png',
                        size: opts.size ?? imageConfig.size,
                        user: gameId,
                      },
                      { signal: abort.signal },
                    )
                : Promise.resolve({
                    image: await mockGeneratedImage(opts.prompt),
                    imageCount: 1,
                  }),
            );
          const result = this.durable
            ? await this.durable.image({ ...opts, size: opts.size ?? imageConfig.size })
            : await localImageCall();
          this.db.insertUsage({
            jobId,
            gameId,
            requestId: (result as { durableRequestId?: string }).durableRequestId,
            stage: `image:${opts.role}`,
            model: imageModel,
            provider: mockImages ? 'mock' : 'meta-image',
            inputTokens: 0,
            outputTokens: 0,
            costUsd:
              mockImages || imagePrice === null
                ? mockImages
                  ? 0
                  : null
                : imagePrice * result.imageCount,
            failed: false,
            repair: false,
          });
          emit('building-assets', opts.label);
          return result.image;
        } catch (error) {
          throwIfSuspended(error);
          if (abort.signal.aborted) {
            throw new PipelineError('timeout', 'generation hit the time limit', 'building-assets');
          }
          if (error instanceof ProviderAuthError) {
            throw new PipelineError('auth', error.message, 'building-assets');
          }
          if (error instanceof ProviderNetworkError && !opts.optional) {
            this.db.updateJob(jobId, { status: 'waiting-network' });
            emit('building-assets', 'Waiting for network…', { waitingForNetwork: true });
            await sleep(8000, abort.signal).catch(() => {
              throw new PipelineError(
                'timeout',
                'generation hit the time limit',
                'building-assets',
              );
            });
            this.db.updateJob(jobId, { status: 'running' });
            continue;
          }

          this.db.insertUsage({
            jobId,
            gameId,
            stage: `image:${opts.role}`,
            model: imageModel,
            provider: mockImages ? 'mock' : 'meta-image',
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            failed: true,
            repair: false,
          });
          const malformed =
            error instanceof Error &&
            /image response|base64|decoded|empty image|JSON|unexpected token|unexpected end/i.test(
              error.message,
            );
          const transient = error instanceof ProviderHttpError && error.transient;
          if (opts.optional && !malformed && !(error instanceof ProviderHttpError) && !(error instanceof ProviderNetworkError))
            throw error;
          if (!opts.optional && (transient || malformed) && attempt < GENERATION.maxTransientRetriesPerCall) {
            attempt++;
            const rateLimited = error instanceof ProviderHttpError && error.status === 429;
            const retryAfter =
              error instanceof ProviderHttpError && error.retryAfterS
                ? error.retryAfterS * 1000
                : 0;
            const backoff =
              Math.max(retryAfter, 1000 * Math.pow(3, attempt - 1)) + Math.random() * 500;
            if (rateLimited) {
              console.warn(
                `Muse Image rate limited ${opts.role}; retrying in ${Math.ceil(backoff)}ms (${attempt}/${GENERATION.maxTransientRetriesPerCall})`,
              );
            }
            emit(
              'building-assets',
              rateLimited
                ? `Muse Image rate limited ${opts.label.toLowerCase()}; retrying (${attempt}/${GENERATION.maxTransientRetriesPerCall})…`
                : `Retrying ${opts.label.toLowerCase()} (${attempt}/${GENERATION.maxTransientRetriesPerCall})…`,
            );
            await sleep(backoff, abort.signal).catch(() => {
              throw new PipelineError(
                'timeout',
                'generation hit the time limit',
                'building-assets',
              );
            });
            continue;
          }
          const timedOut = error instanceof ProviderHttpError && error.status === 408;
          const contentPolicy = isImageContentPolicyViolation(error);
          throw new PipelineError(
            timedOut
              ? 'call-timeout'
              : transient
                ? 'provider-unavailable'
                : contentPolicy
                  ? 'image-content-policy'
                  : 'image-provider-error',
            error instanceof Error ? error.message : String(error),
            'building-assets',
          );
        }
      }
    };
    const recordEarlyRepairEvent = (
      owner: RepairOwner,
      action: string,
      before: readonly LintError[],
      after: readonly LintError[],
      started: number,
      outcome: string,
    ): void => {
      try {
        const pass =
          this.db
            .repairEventsForJob(jobId)
            .filter((event) => event.attempt === job.attempt && event.owner === owner)
            .reduce((max, event) => Math.max(max, event.pass), 0) + 1;
        this.db.insertRepairEvent({
          jobId,
          gameId,
          attempt: job.attempt,
          pass,
          owner,
          action,
          diagnosticsBefore: before,
          diagnosticsAfter: after,
          elapsedMs: Date.now() - started,
          outcome,
        });
      } catch {
        /* telemetry must not fail generation */
      }
    };
    const captureIncident = (
      outcome: IncidentOutcome,
      trigger: { code: string; message: string; stage: JobStage },
      completedSpec?: GameSpec,
    ): GenerationIncident | null => {
      if (!this.incidents) return null;
      try {
        const partial = this.files.readPartial(jobId);
        const game = this.db.getGame(gameId);
        const partialArchetype =
          partial?.archetype && partial.archetype in archetypes
            ? (partial.archetype as ArchetypeId)
            : undefined;
        const archetype: ArchetypeId =
          completedSpec?.archetype ??
          partialArchetype ??
          game?.archetype ??
          job.requestedArchetype ??
          'platformer';
        const title =
          completedSpec?.meta.title ??
          partial?.title ??
          (game?.tagline !== 'Generating…' ? game?.title : undefined) ??
          'Untitled generation';
        const repairs = this.db
          .repairEventsForJob(jobId)
          .filter((event) => event.attempt === job.attempt);
        return this.incidents.capture({
          outcome,
          job,
          game: { title, archetype },
          trigger,
          repairs,
          checkpoints: this.files.listRawStageCheckpoints(jobId, job.attempt),
          runtime: detectIncidentRuntime({
            engineVersion: ENGINE_VERSION,
            archetypeVersion: archetypes[archetype].version,
            provider: process.env.SPARKADE_PROVIDER ?? config.stages.design.provider,
            textModel: config.stages.design.model,
            imageModel,
          }),
          cumulativeCostUsd: this.db.gameCost(gameId),
        });
      } catch (error) {
        throwIfSuspended(error);
        console.warn('could not capture generation incident:', error);
        return null;
      }
    };

    try {
      this.db.updateJob(jobId, {
        status: 'running',
        startedAt: this.durable ? (job.startedAt ?? nowIso()) : nowIso(),
      });
      this.db.setGameStatus(gameId, 'generating');

      // Muse Image is mandatory for every newly generated game. Validate its
      // local configuration and credential before incurring any text-model cost.
      if (!mockImages && !this.durable) {
        try {
          getImageAdapter();
        } catch (error) {
          throwIfSuspended(error);
          throw new PipelineError(
            'image-config',
            error instanceof Error ? error.message : String(error),
            'building-assets',
          );
        }
        const imageKeyEnv = imageConfig.apiKeyEnv.trim() || META_IMAGE_DEFAULT_API_KEY_ENV;
        if (!process.env[imageKeyEnv]?.trim()) {
          throw new PipelineError(
            'auth',
            `${imageKeyEnv} is not set (required for Muse Image)`,
            'building-assets',
          );
        }
      }

      emit('designing', 'Dreaming up the design…');

      const photoPath = join(this.files.stagingFor(jobId), 'photo.jpg');
      const photo = job.hasPhoto && existsSync(photoPath) ? readFileSync(photoPath) : undefined;
      const describeInStory = config.likeness.describeInStory;

      // ---- Design pass ---------------------------------------------------
      const recentGames = (this.historyForJob?.(jobId) ?? this.db.listGames())
        .filter((g) => g.status === 'ready' && g.id !== gameId)
        .slice(0, GENERATION.antiCollisionGames);
      const existingGames = recentGames.map((g) => ({ title: g.title, tagline: g.tagline }));

      // Body-level anti-collision for the entities stage: premise variety comes
      // from titles/taglines above; cast + palette variety needs the actual picks.
      const recentUse = {
        heroes: [] as string[],
        bosses: [] as string[],
        backdrops: [] as string[],
      };
      const recentMoods: string[] = [];
      const recentMechanics: MechanicalFingerprint[] = [];
      for (const g of recentGames) {
        const s = this.files.readSpec(g.id);
        if (!s) continue;
        recentMechanics.push(mechanicalFingerprint(s));
        const assign = (s.sprites?.assign ?? {}) as Record<string, string>;
        if (assign['hero']?.startsWith('lib:')) recentUse.heroes.push(assign['hero']);
        if (assign['boss']?.startsWith('lib:')) recentUse.bosses.push(assign['boss']);
        if (s.backdrop) recentUse.backdrops.push(s.backdrop);
        if (Array.isArray(s.palette) && s.palette.length === 16)
          recentMoods.push(nearestMood(s.palette).name);
      }

      const requiredArchetypeNote = job.requestedArchetype
        ? `REQUIRED ARCHETYPE: ${job.requestedArchetype}. Design every level, character, control implication, and story beat for ${job.requestedArchetype}; do not choose a different archetype.`
        : undefined;
      const recordDesignRedraft = (
        before: readonly LintError[],
        after: readonly LintError[],
        started: number,
      ) =>
        recordEarlyRepairEvent(
          'document',
          'design-redraft',
          before,
          after,
          started,
          after.length ? 'failed' : 'fixed',
        );

      const priorAttempt = this.durable ? job.attempt : job.attempt > 1 ? job.attempt - 1 : null;
      const failedOwnersByAttempt = new Map<number, Set<string>>();
      for (const event of priorAttempt ? this.db.repairEventsForJob(jobId) : []) {
        if (
          event.outcome !== 'failed' ||
          (event.action !== 'terminal' && event.action !== 'regenerate')
        ) {
          continue;
        }
        const owners = failedOwnersByAttempt.get(event.attempt) ?? new Set<string>();
        owners.add(event.owner);
        failedOwnersByAttempt.set(event.attempt, owners);
      }
      let priorDesign: unknown;
      if (priorAttempt) {
        for (let attempt = priorAttempt; attempt >= 1 && priorDesign === undefined; attempt--) {
          const documentFailed = failedOwnersByAttempt.get(attempt)?.has('document') ?? false;
          const candidates = this.files
            .listRawStageCheckpoints(jobId, attempt)
            .filter((checkpoint) => checkpoint.stage === 'design')
            .reverse();
          priorDesign = candidates.find((checkpoint) => {
            const diagnostics = designOutputDiagnostics(checkpoint.document);
            const abilityOnly = abilityLoadoutIsOnlyDesignError(checkpoint.document);
            return documentFailed ? abilityOnly : diagnostics.length === 0 || abilityOnly;
          })?.document;
          // A terminal document failure still blocks older design revisions;
          // only the narrowly recoverable checkpoint from this attempt may resume.
          if (documentFailed) break;
        }
      }
      let design: DesignDoc;
      if (priorDesign !== undefined) {
        const resumed = await completeDesignAbilityContract(callLlm, structuredClone(priorDesign));
        if (designOutputDiagnostics(resumed).length === 0) {
          design = resumed as DesignDoc;
          emit('designing', 'Resuming the completed design…');
        } else {
          design = await this.designPass(callLlm, {
            promptText: job.promptText,
            hasPhoto: !!photo,
            describeInStory,
            antiCollision: existingGames,
            recentMoods,
            recentMechanics,
            photo: describeInStory ? photo : undefined,
            creationBrief: job.creationBrief,
            extraNote: requiredArchetypeNote,
            onRepair: recordDesignRedraft,
          });
        }
      } else {
        design = await this.designPass(callLlm, {
          promptText: job.promptText,
          hasPhoto: !!photo,
          describeInStory,
          antiCollision: existingGames,
          recentMoods,
          recentMechanics,
          photo: describeInStory ? photo : undefined,
          creationBrief: job.creationBrief,
          extraNote: requiredArchetypeNote,
          onRepair: recordDesignRedraft,
        });
      }
      design = enforceRequestedArchetype(design, job.requestedArchetype);

      // Similarity gate: too close to an existing game → regenerate the design once.
      const collision = tooSimilar(
        design.title,
        existingGames.map((g) => g.title),
      );
      if (collision) {
        const collisionRepairStarted = Date.now();
        const collisionBefore = [
          {
            code: 'DESIGN_TOO_SIMILAR',
            path: '/title',
            message: `title was too similar to ${collision}`,
          },
        ];
        emit('designing', 'Too similar to an existing game — redesigning…');
        design = await this.designPass(callLlm, {
          promptText: job.promptText,
          hasPhoto: !!photo,
          describeInStory,
          antiCollision: existingGames,
          recentMoods,
          recentMechanics,
          photo: describeInStory ? photo : undefined,
          creationBrief: job.creationBrief,
          extraNote: [
            requiredArchetypeNote,
            `Your previous title "${design.title}" was too similar to "${collision}". Choose a clearly different title and premise.`,
          ]
            .filter(Boolean)
            .join(' '),
          onRepair: recordDesignRedraft,
        });
        design = enforceRequestedArchetype(design, job.requestedArchetype);
        const repeatedCollision = tooSimilar(
          design.title,
          existingGames.map((g) => g.title),
        );
        recordEarlyRepairEvent(
          'document',
          'design-collision-redraft',
          collisionBefore,
          repeatedCollision
            ? [
                {
                  code: 'DESIGN_TOO_SIMILAR',
                  path: '/title',
                  message: `redrafted title was still too similar to ${repeatedCollision}`,
                },
              ]
            : [],
          collisionRepairStarted,
          repeatedCollision ? 'fallback' : 'fixed',
        );
        if (repeatedCollision) {
          design.title = `${design.title.slice(0, 29)} II`;
        }
      }

      // Palette legibility gate: a palette can clear the JSON schema yet be
      // unplayable (hero lost in the background, unreadable text). If the model's
      // palette fails, snap to the nearest curated mood — guaranteed legible and
      // still in the model's intended hue family — rather than shipping it.
      const palProblems = paletteProblems(design.palette);
      if (palProblems.length) {
        const mood = nearestMood(design.palette);
        emit('designing', `Palette adjusted for legibility → ${mood.name}`);
        design = { ...design, palette: [...mood.colors] };
      }
      const designMatchesResumedCheckpoint =
        priorDesign !== undefined && JSON.stringify(design) === JSON.stringify(priorDesign);

      // This revision includes deterministic archetype/palette/collision gates,
      // so retry resume picks up the actual design used by the stage passes.
      try {
        this.files.writeRawStageCheckpoint(jobId, job.attempt, 'design', design);
      } catch {
        /* see callLlm checkpoint note */
      }

      const archetype = design.archetype;
      this.db.upsertGame({
        id: gameId,
        title: design.title,
        tagline: design.tagline,
        archetype,
        status: 'generating',
        createdAt: job.createdAt,
        golden: false,
        jobId,
        costUsd: this.db.gameCost(gameId),
        cover: null,
        failure: null,
        engineVersion: ENGINE_VERSION,
        archetypeVersion: archetypes[archetype].version,
      });

      // Surface stable pieces to the generation screen the instant each pass
      // lands — palette/title now, sprites and music as they finish — so the
      // wait shows the model's real output instead of a spinner. Best-effort:
      // a failed partial write never derails generation.
      const partial: PartialSpec = {
        archetype,
        title: design.title,
        tagline: design.tagline,
        palette: [...design.palette],
      };
      const pushPartial = (patch: Partial<PartialSpec>) => {
        Object.assign(partial, patch);
        try {
          this.files.writePartial(jobId, partial);
        } catch {
          /* preview is a nicety — never fail generation over it */
        }
      };
      pushPartial({});
      feed('decision', `Spark chose “${design.title}”`, 'designing', {
        title: design.title,
        tagline: design.tagline,
        archetype: design.archetype,
        palette: design.palette,
        heroConcept: design.heroConcept,
        difficulty: design.difficulty,
        levelNames: design.levelPlan.map((level) => level.name),
      });

      let resumedValidatedSpec: GameSpec | undefined;
      if (priorAttempt && designMatchesResumedCheckpoint) {
        for (let attempt = priorAttempt; attempt >= 1; attempt--) {
          const checkpoint = this.files.readValidatedSpecCheckpoint<DesignDoc>(jobId, attempt);
          if (
            !checkpoint ||
            checkpoint.engineVersion !== ENGINE_VERSION ||
            checkpoint.specVersion !== SPEC_VERSION ||
            checkpoint.archetypeVersion !== archetypes[archetype].version ||
            JSON.stringify(checkpoint.design) !== JSON.stringify(design) ||
            checkpoint.spec.archetype !== archetype ||
            checkpoint.spec.seed !== job.seed
          ) {
            continue;
          }
          const candidate = ensureLikenessHeroBody(structuredClone(checkpoint.spec), !!photo);
          if (this.collectDiagnostics(candidate, archetype).length === 0) {
            resumedValidatedSpec = candidate;
            break;
          }
        }
      }

      let spec: GameSpec;
      let musicPending = false;
      if (resumedValidatedSpec) {
        spec = resumedValidatedSpec;
        pushPartial({ sprites: spec.sprites, music: spec.music });
        emit('validating', 'Restored the validated game…');
      } else {
        // ---- Spec passes (parallel) --------------------------------------
        emit('writing-spec', 'Writing levels, entities and music…', {
          unitsDone: 0,
          unitsTotal: 3,
        });
        let unitsDone = 0;
        const tick = (what: string) => {
          unitsDone++;
          emit('writing-spec', `${what} done (${unitsDone}/3)`, { unitsDone, unitsTotal: 3 });
        };
        const parts: SpecParts = {};
        const resumeStage = (stage: Exclude<RawStageName, 'design'>): unknown | undefined => {
          if (!priorAttempt || !designMatchesResumedCheckpoint) return undefined;
          for (let attempt = priorAttempt; attempt >= 1; attempt--) {
            const failedOwners = failedOwnersByAttempt.get(attempt);
            if (failedOwners?.has('document') || failedOwners?.has(stage)) continue;
            const attemptDesign = this.files.readRawStageCheckpoint(
              jobId,
              attempt,
              'design',
            )?.document;
            if (JSON.stringify(attemptDesign) !== JSON.stringify(design)) continue;
            const checkpoints = this.files
              .listRawStageCheckpoints(jobId, attempt)
              .filter((checkpoint) => checkpoint.stage === stage)
              .reverse();
            for (const checkpoint of checkpoints) {
              try {
                const candidate =
                  stage === 'levels'
                    ? compileGeneratedLevels(archetype, checkpoint.document)
                    : structuredClone(checkpoint.document);
                if (
                  validateAgainst(
                    `resume:${archetype}:${stage}`,
                    stageSchema(archetype, stage),
                    candidate,
                  ).length
                ) {
                  continue;
                }
                this.files.writeRawStageCheckpoint(jobId, job.attempt, stage, checkpoint.document);
                return candidate;
              } catch {
                continue;
              }
            }
          }
          return undefined;
        };
        const resumedLevels = resumeStage('levels');
        const resumedEntities = resumeStage('entities');
        const resumedMusic = resumeStage('music');
        const loadLevels = async (): Promise<unknown> => {
          if (resumedLevels !== undefined) return resumedLevels;
          const raw = await callLlm(
            'levels',
            buildLevelsPrompt(archetype, design, [], recentMechanics),
            {
              stage: 'writing-spec',
              checkpoint: 'levels',
              label: 'Building levels…',
            },
          );
          try {
            return compileGeneratedLevels(archetype, raw, true);
          } catch (error) {
            throwIfSuspended(error);
            if (!(error instanceof TileRunsError)) throw error;
            const diagnostic = tileRunsDiagnostic(error);
            const retryStarted = Date.now();
            try {
              const retryRaw = await callLlm(
                'levels',
                buildLevelsPrompt(archetype, design, [diagnostic], recentMechanics),
                {
                  stage: 'writing-spec',
                  checkpoint: 'levels',
                  label: error.path.includes('encounterRoute')
                    ? 'Correcting level encounters…'
                    : 'Correcting compact level rows…',
                  reasoningEffort: 'minimal',
                },
              );
              let compiled: unknown;
              try {
                compiled = compileGeneratedLevels(archetype, retryRaw, true);
              } catch (retryError) {
                throwIfSuspended(retryError);
                if (!(retryError instanceof TileRunsError)) throw retryError;
                compiled = canonicalLevelsFallback(archetype, retryRaw, retryError);
              }
              recordEarlyRepairEvent(
                'levels',
                'compile-retry',
                [diagnostic],
                [],
                retryStarted,
                'fixed',
              );
              return compiled;
            } catch (retryError) {
              throwIfSuspended(retryError);
              const after =
                retryError instanceof TileRunsError
                  ? [tileRunsDiagnostic(retryError)]
                  : [diagnostic];
              recordEarlyRepairEvent(
                'levels',
                'compile-retry',
                [diagnostic],
                after,
                retryStarted,
                'failed',
              );
              throw retryError;
            }
          }
        };
        // One shared levels promise: racing entities depend on the canonical
        // circuits (no duplicate level generation), every other archetype
        // keeps full levels/entities/music parallelism.
        const levelsPromise = loadLevels();
        const canonicalLevelsOf = (canonical: unknown): unknown => {
          const roster = isRecord(canonical) ? canonical : null;
          return roster?.['levels'] ?? canonical;
        };
        const results = await Promise.allSettled([
          levelsPromise.then((canonical) => {
            parts.levels = canonicalLevelsOf(canonical);
            const roster = isRecord(canonical) ? canonical : null;
            if (archetype === 'fighter') parts.player = roster?.['player'];
            tick(resumedLevels !== undefined ? 'Levels restored' : 'Levels');
          }),
          (resumedEntities !== undefined
            ? Promise.resolve(resumedEntities)
            : archetype === 'racing'
              ? levelsPromise.then((canonical) =>
                  callLlm(
                    'entities',
                    buildEntitiesPrompt(
                      archetype,
                      design,
                      !!photo,
                      recentUse,
                      [],
                      canonicalLevelsOf(canonical),
                    ),
                    {
                      stage: 'writing-spec',
                      checkpoint: 'entities',
                      label: 'Casting entities…',
                    },
                  ),
                )
              : callLlm('entities', buildEntitiesPrompt(archetype, design, !!photo, recentUse), {
                  stage: 'writing-spec',
                  checkpoint: 'entities',
                  label: 'Casting entities…',
                })
          ).then((r) => {
            parts.entities = r as SpecParts['entities'];
            pushPartial({ sprites: parts.entities?.sprites as PartialSpec['sprites'] });
            tick(resumedEntities !== undefined ? 'Entities restored' : 'Entities');
          }),
          (resumedMusic !== undefined
            ? Promise.resolve(resumedMusic)
            : callLlm('music', buildMusicPrompt(archetype, design), {
                stage: 'writing-spec',
                checkpoint: 'music',
                label: 'Composing music…',
              })
          ).then((r) => {
            parts.music = isRecord(r) ? (r['music'] ?? r) : r;
            pushPartial({ music: parts.music as PartialSpec['music'] });
            const music = isRecord(parts.music) ? parts.music : {};
            feed(
              'decision',
              resumedMusic !== undefined ? 'Restored the composed soundtrack' : 'Theme composed',
              'writing-spec',
              {
                ...(typeof music['key'] === 'string' ? { key: music['key'] } : {}),
                ...(typeof music['bpm'] === 'number' ? { bpm: music['bpm'] } : {}),
              },
            );
            tick(resumedMusic !== undefined ? 'Music restored' : 'Music');
          }),
        ]);
        if (
          this.durable &&
          results[0]?.status === 'fulfilled' &&
          results[1]?.status === 'fulfilled' &&
          results[2]?.status === 'rejected' &&
          results[2].reason instanceof PipelineSuspended
        ) {
          musicPending = true;
          parts.music = structuredClone(loadGolden(archetype).music);
        }
        const firstFailure = results.find(
          (r, index): r is PromiseRejectedResult =>
            r.status === 'rejected' && !(musicPending && index === 2),
        );
        if (firstFailure) throw firstFailure.reason;

        // ---- Assemble + validate + repair ----------------------------------
        spec = ensurePlatformerImageCharacterFallbacks(
          ensureLikenessHeroBody(
            this.assemble(job.seed, archetype, design, parts, !!photo),
            !!photo,
          ),
          recentUse.bosses,
        );
        emit('validating', 'Checking every rule…');
        spec = await this.validateAndRepair(
          spec,
          archetype,
          design,
          callLlm,
          emit,
          !!photo,
          recentUse,
          { jobId, gameId, attempt: job.attempt },
          recentMechanics,
        );
        spec = ensureLikenessHeroBody(spec, !!photo);
      }

      spec = ensurePlatformerImageCharacterFallbacks(spec, recentUse.bosses);
      if (this.durable?.suspended() && !musicPending) return;
      // Repairs may alter geometry, but the committed presentation remains design-owned.
      if (spec.archetype === 'platformer')
        spec.presentationFamily = design.presentationFamily ?? 'arcade';
      if (
        spec.archetype === 'platformer' &&
        (platformerPlayStyle(spec) !== (design.playStyle ?? 'acrobat') ||
          JSON.stringify(platformerMechanics(spec)) !== JSON.stringify(platformerMechanics(design)))
      ) {
        throw new PipelineError(
          'validation-failed',
          'The validated game must preserve the design-selected platformer play style.',
          'validating',
        );
      }

      if (
        spec.archetype === 'fighter' &&
        (spec.fighterStyle !== design.fighterStyle ||
          spec.player.combatProfile !== design.fighterStyle)
      )
        throw new PipelineError(
          'validation-failed',
          'Repair changed the committed Fighter kit',
          'validating',
        );
      if (
        spec.archetype === 'fighter' &&
        [spec.player, ...spec.levels.map((l) => l.opponent), spec.boss].some(
          (c) => c.combatProfile === 'rangedControl' && !c.projectile,
        )
      )
        throw new PipelineError(
          'validation-failed',
          'A newly generated ranged fighter lost its named projectile theme during repair',
          'validating',
        );
      if (spec.archetype === 'shooter' && spec.shooterStyle !== design.shooterStyle) {
        throw new PipelineError(
          'validation-failed',
          'The validated game must preserve the design-selected shooter style.',
          'validating',
        );
      }
      if (
        spec.archetype === 'adventure' &&
        spec.adventureStyle !== (design.adventureStyle ?? 'dungeonExpedition')
      ) {
        throw new PipelineError(
          'validation-failed',
          'The validated game must preserve the design-selected Adventure objective.',
          'validating',
        );
      }

      const identityProblems = racingIdentityProblems(spec, design);
      if (identityProblems.length) {
        throw new PipelineError('validation-failed', identityProblems[0]!.message, 'validating');
      }

      try {
        if (!musicPending)
          this.files.writeValidatedSpecCheckpoint(jobId, job.attempt, {
            engineVersion: ENGINE_VERSION,
            specVersion: SPEC_VERSION,
            archetypeVersion: archetypes[archetype].version,
            design,
            spec,
          });
      } catch {
        // A valid in-memory spec can still publish if checkpoint storage is
        // unavailable; a future retry will fall back to raw-stage restoration.
      }

      // ---- Build Muse Image assets + atomic publish -----------------------
      emit('building-assets', 'Painting the game art…');
      const staging = this.files.stagingFor(jobId);
      const assetsDir = ensureDir(join(staging, 'assets'));
      const assetWorkspace = new GameAssetWorkspace(assetsDir, imageModel, (asset) => {
        const label = asset.role.replace(/([A-Z])/g, ' $1').toLowerCase();
        feed('asset', `Finished ${label}`, 'building-assets', {
          role: asset.role,
          filename: asset.filename,
          width: asset.width,
          height: asset.height,
        });
      });
      // Directional head patches existed only to keep library player bodies
      // usable. They are not part of any generated-player contract now; clear
      // them from interrupted pre-migration attempts before a retry publishes.
      await assetWorkspace.discard([
        'generatedHead12',
        'generatedHead12Side',
        'generatedHead12Back',
        'generatedHead16',
        'generatedHead16Side',
        'generatedHead16Back',
      ]);

      // Production personalization deliberately relies on the models' direct
      // view of the photo instead of squeezing identity through the legacy,
      // finite FaceFeatures taxonomy. Muse Image authors the hero; detailed
      // platformers also give the design-stage provider labeled review boards.
      const feat = null;

      const validationFailure = (role: string): void => {
        this.db.insertUsage({
          jobId,
          gameId,
          stage: `image-validation:${role}`,
          model: imageModel,
          provider: mockImages ? 'mock' : 'meta-image',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          failed: true,
          repair: false,
        });
      };
      const generatedResult = (image: Buffer) => ({
        image,
        usage: undefined,
        outputFormat: 'png' as const,
        imageCount: 1,
      });
      const imageEditFor =
        (role: string, label: string): LikenessImageEdit =>
        async (request) =>
          generatedResult(
            await callImage({
              role,
              label,
              prompt: request.prompt,
              reference: request.image,
              size: request.size,
            }),
          );
      type CachedGeneratedAssetOptions = {
        role: GeneratedGameAssetRole;
        promptVersion: string;
        prompt: string;
        policyFallbackPrompt?: string;
        label: string;
        reference?: Buffer;
        size?: string;
        normalize(image: Buffer): Promise<Buffer>;
      };
      type PrivateGeneratedAssetCompanion = {
        role: PrivateGeneratedAssetRole;
        normalize(image: Buffer): Promise<Buffer>;
      };
      type GeneratedAssetWithCompanion = { image: Buffer; companion: Buffer };

      async function cachedGeneratedAsset(
        opts: CachedGeneratedAssetOptions & {
          privateCompanion: PrivateGeneratedAssetCompanion;
        },
      ): Promise<GeneratedAssetWithCompanion>;
      async function cachedGeneratedAsset(opts: CachedGeneratedAssetOptions): Promise<Buffer>;
      async function cachedGeneratedAsset(
        opts: CachedGeneratedAssetOptions & {
          privateCompanion?: PrivateGeneratedAssetCompanion;
        },
      ): Promise<Buffer | GeneratedAssetWithCompanion> {
        const correctionPrompt = (prompt: string) =>
          `${prompt} RETRY CORRECTION: obey every composition, format, and no-text constraint exactly.`;
        const cachePrompts = [
          opts.prompt,
          correctionPrompt(opts.prompt),
          ...(opts.policyFallbackPrompt
            ? [opts.policyFallbackPrompt, correctionPrompt(opts.policyFallbackPrompt)]
            : []),
        ];
        for (const prompt of new Set(cachePrompts)) {
          const cached = assetWorkspace.load(
            opts.role,
            opts.promptVersion,
            imagePromptHash(prompt, opts.reference),
          );
          if (!cached) continue;
          if (!opts.privateCompanion) return cached;
          const companion = assetWorkspace.loadPrivate(
            opts.privateCompanion.role,
            opts.promptVersion,
            imagePromptHash(prompt, opts.reference),
          );
          if (companion) return { image: cached, companion };
        }

        let lastError: unknown;
        let activePrompt = opts.prompt;
        let usedPolicyFallback = false;
        let usedValidationRetry = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const promptSha = imagePromptHash(activePrompt, opts.reference);
          try {
            const raw = await callImage({
              role: opts.role,
              label: opts.label,
              prompt: activePrompt,
              ...(opts.reference ? { reference: opts.reference } : {}),
              ...(opts.size ? { size: opts.size } : {}),
            });
            const normalized = await opts.normalize(raw);
            const companion = opts.privateCompanion
              ? await opts.privateCompanion.normalize(raw)
              : null;
            if (companion && opts.privateCompanion) {
              // Declare the public runtime asset only after its private
              // presentation source is durable, so retries never fall back to
              // enlarging the tiny gameplay sprite.
              await assetWorkspace.storePrivate(
                opts.privateCompanion.role,
                companion,
                opts.promptVersion,
                promptSha,
              );
            }
            await assetWorkspace.store(opts.role, normalized, opts.promptVersion, promptSha);
            return companion ? { image: normalized, companion } : normalized;
          } catch (error) {
            throwIfSuspended(error);
            if (error instanceof PipelineError) {
              // Racing preserves provider content-policy refusals as
              // terminal failures: a refused racing image (key art, story
              // scenes, strips) must stop the job immediately, never
              // rephrase into a fallback prompt. Other archetypes keep the
              // existing safe-rephrase behavior.
              if (
                error.code === 'image-content-policy' &&
                opts.policyFallbackPrompt &&
                !usedPolicyFallback &&
                spec.archetype !== 'racing'
              ) {
                lastError = error;
                usedPolicyFallback = true;
                activePrompt = opts.policyFallbackPrompt;
                emit('building-assets', `Rephrasing ${opts.label.toLowerCase()} safely…`);
                continue;
              }
              throw error;
            }
            if (error instanceof GeneratedAssetStorageError) {
              throw new PipelineError('storage', error.message, 'building-assets');
            }
            lastError = error;
            validationFailure(opts.role);
            if (!usedValidationRetry) {
              usedValidationRetry = true;
              activePrompt = correctionPrompt(activePrompt);
              emit('building-assets', `Repainting ${opts.label.toLowerCase()}…`);
              continue;
            }
            break;
          }
        }
        throw new PipelineError(
          'image-invalid',
          `${opts.label} failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
          'building-assets',
        );
      }

      const photoReference = photo ? await prepareImageReference(photo) : undefined;
      const canonicalHeroConcept = spec.meta.heroConcept ?? design.heroConcept;
      const assetArtifacts = new ArtifactCache(join(this.files.checkpointsDir, jobId, 'asset-processing'));
      const playerCraftIdentity =
        spec.archetype === 'shooter' || spec.archetype === 'hshooter'
          ? spec.playerCraft
          : undefined;
      let hshooterPlayerCraftArtStatus: GameMetaFile['hshooterPlayerCraftArt'];
      let shooterPlayerCraftArtStatus: GameMetaFile['shooterPlayerCraftArt'];
      type PlayerCraftAssets = {
        gameplay: Buffer;
        presentationReference: Buffer;
      };
      const playerCraftTask: Promise<PlayerCraftAssets | null> = playerCraftIdentity
        ? (async () => {
            const horizontal = spec.archetype === 'hshooter';
            const orientation: PlayerCraftOrientation = horizontal ? 'side-view' : 'top-down';
            const role: GeneratedGameAssetRole = horizontal
              ? 'hshooterPlayerCraft'
              : 'shooterPlayerCraft';
            const privateRole: PrivateGeneratedAssetRole = horizontal
              ? 'hshooterCraftReference'
              : 'shooterCraftReference';
            const craftPromptVersion = horizontal
              ? HSHOOTER_CRAFT_PROMPT_VERSION
              : SHOOTER_CRAFT_PROMPT_VERSION;
            const pipelineFingerprint = JSON.stringify({
              promptVersion: craftPromptVersion,
              judgeVersion: PLAYER_CRAFT_JUDGE_PROMPT_VERSION,
              orientation,
              visualConcept: playerCraftIdentity.visualConcept,
              colors: spec.palette,
            });
            const pipelineSha = imagePromptHash(pipelineFingerprint);
            const cachedGameplay = assetWorkspace.load(
              role,
              PLAYER_CRAFT_JUDGE_PROMPT_VERSION,
              pipelineSha,
            );
            const cachedPresentation = assetWorkspace.loadPrivate(
              privateRole,
              PLAYER_CRAFT_JUDGE_PROMPT_VERSION,
              pipelineSha,
            );
            if (cachedGameplay && cachedPresentation) {
              if (horizontal) hshooterPlayerCraftArtStatus = { mode: 'generated', attempted: true };
              else shooterPlayerCraftArtStatus = { mode: 'generated', attempted: true };
              return { gameplay: cachedGameplay, presentationReference: cachedPresentation };
            }

            interface CraftCandidate {
              id: string;
              gameplay: Buffer;
              presentation: Buffer;
            }
            const generateCandidateUncached = async (
              id: string,
              retryGuidance = '',
            ): Promise<CraftCandidate | null> => {
              const promptOptions = {
                gameTitle: spec.meta.title,
                tagline: spec.meta.tagline,
                visualConcept: playerCraftIdentity.visualConcept,
                colors: spec.palette.join(', '),
                candidateId: id,
                ...(retryGuidance ? { retryGuidance } : {}),
              };
              let raw: Buffer;
              try {
                raw = await callImage({
                  role: `${horizontal ? 'hshooter' : 'shooter'}-player-craft-${id}`,
                  label: `${horizontal ? 'H-scroll' : 'vertical'} player craft candidate ${id}`,
                  prompt: horizontal
                    ? buildHShooterCraftPrompt(promptOptions)
                    : buildShooterCraftPrompt(promptOptions),
                  size: horizontal ? '1536x1024' : '1024x1536',
                });
              } catch (error) {
                throwIfSuspended(error);
                if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                validationFailure(`${horizontal ? 'hshooter' : 'shooter'}-player-craft-${id}`);
                emit(
                  'building-assets',
                  `Player craft candidate ${id} was unavailable; continuing…`,
                );
                return null;
              }
              try {
                const [gameplay, presentation] = await settleAll([
                  horizontal
                    ? processGeneratedHShooterCraft(raw).then((result) => result.png)
                    : processGeneratedShooterCraft(raw).then((result) => result.png),
                  horizontal
                    ? processGeneratedHShooterCraftReference(raw)
                    : processGeneratedShooterCraftReference(raw),
                ]);
                return { id, gameplay, presentation };
              } catch (_error) {
                throwIfSuspended(_error);
                validationFailure(`${horizontal ? 'hshooter' : 'shooter'}-player-craft-${id}`);
                emit('building-assets', `Player craft candidate ${id} was unusable; continuing…`);
                return null;
              }
            };

            const generateCandidate = (...args: Parameters<typeof generateCandidateUncached>) =>
              assetArtifacts.getOrCompute(
                JSON.stringify(['craft-candidate-v1', job.attempt, pipelineSha, spec.meta, args]),
                () => generateCandidateUncached(...args),
              );
            emit('building-assets', 'Painting three player craft candidates…');
            let candidates = (
              await settleAll(['A', 'B', 'C'].map((id) => generateCandidate(id)))
            ).filter((candidate): candidate is CraftCandidate => candidate !== null);
            if (candidates.length === 0) {
              emit('building-assets', 'Repainting the player craft candidate pool…');
              candidates = (
                await settleAll(
                  ['D', 'E', 'F'].map((id) =>
                    generateCandidate(
                      id,
                      `Return one uncropped craft in strict ${orientation}; emphasize a clean readable silhouette`,
                    ),
                  ),
                )
              ).filter((candidate): candidate is CraftCandidate => candidate !== null);
            }
            if (candidates.length === 0) {
              throw new PipelineError(
                'image-invalid',
                `No mechanically valid generated ${orientation} player craft was available`,
                'building-assets',
              );
            }
            const descriptors: PlayerCraftCandidateDescriptor[] = candidates.map(({ id }) => ({
              id,
            }));
            const board = await buildPlayerCraftJudgeBoard({
              candidates: candidates.map(({ id, gameplay: processed }) => ({ id, processed })),
              orientation,
            });
            const mockDecision = {
              candidateReviews: descriptors.map(({ id }) => ({
                id,
                concept: 5,
                orientation: 5,
                silhouette: 5,
                readability: 5,
                technical: 5,
                fatalIssues: [],
                summary: 'Mock production-ready craft.',
              })),
              selection: {
                accepted: true,
                candidateId: descriptors[0]!.id,
                rationale: 'Mock selection.',
                retryGuidance: '',
              },
            };
            const rawDecision = mockImages
              ? mockDecision
              : await callLlm(
                  'design',
                  {
                    ...buildPlayerCraftJudgePrompt(descriptors, {
                      orientation,
                      visualConcept: playerCraftIdentity.visualConcept,
                    }),
                    jsonSchema: buildPlayerCraftJudgeSchema(descriptors),
                    maxTokens: 2400,
                    timeoutMs: 120_000,
                  },
                  {
                    stage: 'building-assets',
                    label: 'Spark selected the player craft',
                    image: board,
                    reasoningEffort: 'low',
                  },
                );
            const decision = normalizePlayerCraftJudgeDecision(rawDecision, descriptors);
            const selectedId = decision.selection.accepted
              ? decision.selection.candidateId
              : bestPlayerCraftCandidateId(decision);
            const selected = candidates.find(({ id }) => id === selectedId)!;
            emit(
              'building-assets',
              decision.selection.accepted
                ? `Spark selected player craft ${selectedId}`
                : `Spark selected ${selectedId} as the best available player craft`,
            );
            await assetWorkspace.storePrivate(
              privateRole,
              selected.presentation,
              PLAYER_CRAFT_JUDGE_PROMPT_VERSION,
              pipelineSha,
            );
            await assetWorkspace.store(
              role,
              selected.gameplay,
              PLAYER_CRAFT_JUDGE_PROMPT_VERSION,
              pipelineSha,
            );
            if (horizontal) hshooterPlayerCraftArtStatus = { mode: 'generated', attempted: true };
            else shooterPlayerCraftArtStatus = { mode: 'generated', attempted: true };
            return { gameplay: selected.gameplay, presentationReference: selected.presentation };
          })()
        : Promise.resolve(null);
      // Visible racers establish one costumed character in key art first.
      // Vehicle-only cups still establish the craft before presentation art.
      const racingSpec = spec.archetype === 'racing' ? spec : null;
      const racingIdentity = racingSpec?.identity;
      const visibleRacingPlayer = !!racingIdentity && racingArtSubject(racingIdentity).rider !== 'none';
      const racingPlayerPhoto = visibleRacingPlayer ? photoReference : undefined;
      const paintKeyArt = (reference: Buffer | undefined, craftBrief?: { visualConcept: string }) =>
        cachedGeneratedAsset({
          role: 'keyArt',
          promptVersion: KEY_ART_PROMPT_VERSION,
          prompt: buildKeyArtPrompt(spec, !!photo, canonicalHeroConcept, craftBrief),
          policyFallbackPrompt: buildKeyArtPolicyFallbackPrompt(spec, !!photo, canonicalHeroConcept, craftBrief),
          label: 'Key art',
          ...(reference ? { reference } : {}),
          size: KEY_ART_ASPECT_HINT,
          normalize: normalizeKeyArt,
        });
      const racingCharacterArtTask = visibleRacingPlayer
        ? paintKeyArt(photoReference)
        : Promise.resolve(null);
      const racingPlayerReferenceTask = racingCharacterArtTask.then((keyArt) => keyArt
        ? racingPlayerPhoto ? buildPortraitIdentityReference(racingPlayerPhoto, keyArt) : keyArt
        : undefined);
      const racingAssetFailure = (error: unknown): never => {
        throwIfSuspended(error);
        if (error instanceof PipelineError || error instanceof GeneratedAssetStorageError)
          throw error;
        throw new PipelineError(
          'image-invalid',
          error instanceof Error ? error.message : String(error),
          'building-assets',
        );
      };
      const generatePlayerStrip = async (retryGuidance = ''): Promise<PlayerCraftAssets> => {
        if (!racingSpec) throw new Error('racing pack needs an identity-bearing racing spec');
        const entry = buildRacingPackPlan(racingSpec, !!racingPlayerPhoto).playerStrip;
        const reference = await racingPlayerReferenceTask;
        const result = await cachedGeneratedAsset({
          role: entry.role,
          promptVersion: entry.promptVersion,
          prompt: retryGuidance
            ? `${entry.prompt} ART DIRECTOR CORRECTION: ${retryGuidance.slice(0, 320)}.`
            : entry.prompt,
          label: entry.label,
          ...(entry.size ? { size: entry.size } : {}),
          ...(reference ? { reference } : {}),
          normalize: (raw) => processGeneratedRacingCraftStrip(raw).then((strip) => strip.png),
          privateCompanion: {
            role: 'racingCraftReference',
            normalize: (raw) => processGeneratedRacingCraftStripReference(raw),
          },
        });
        return { gameplay: result.image, presentationReference: result.companion };
      };
      // Review the gameplay character before animation and story references
      // freeze. Visible racers must match the established character artwork,
      // not only the camera or photo. One bounded repaint, then fail clearly.
      const reviewRacingStrips = async (
        buffers: Buffer[],
        reviewSlots: readonly RacingRosterSlotDescriptor[],
        label: string,
        references: readonly { slot: RacingRosterSlotDescriptor; png: Buffer }[] = [],
      ): Promise<ReturnType<typeof normalizeRacingRosterJudgeDecision>> => {
        let board = await buildRacingRosterJudgeBoard([
          ...buffers.map((png, k) => ({ id: reviewSlots[k]!.id, png })),
          ...references.map(({ slot, png }) => ({ id: slot.id, png, referenceOnly: true })),
        ]);
        if (mockImages) {
          return { accepted: true, rejectedIds: [], retryGuidance: '', correctionKinds: {}, slotGuidance: {} };
        }
        const reviewIdentity = visibleRacingPlayer && reviewSlots.some((slot) => slot.id === 'player');
        const prompt = buildRacingRosterJudgePrompt(
          reviewSlots,
          references.map(({ slot }) => slot),
          racingSpec ? racingPackDiscipline(racingSpec) : 'hover',
          racingSpec?.identity?.traversal,
        );
        if (reviewIdentity) {
          board = await buildRacingPhotoReviewReference((await racingPlayerReferenceTask)!, board);
          prompt.user += ` ${racingPlayerIdentityReview(!!racingPlayerPhoto)}`;
        }
        const rawDecision = await callLlm(
          'design',
          {
            ...prompt,
            jsonSchema: buildRacingRosterJudgeSchema(reviewSlots),
            maxTokens: 1600,
            timeoutMs: 120_000,
          },
          {
            stage: 'building-assets',
            label,
            image: board,
            reasoningEffort: 'low',
          },
        );
        return normalizeRacingRosterJudgeDecision(rawDecision, reviewSlots);
      };
      // Animated cups (authored non-static traversal.motion): the engine
      // owns continuous steering lean, so identity is one approved
      // neutral-rear foundation per racer — never generated bank poses.
      // Static or absent motion keeps the legacy three-pose strips.
      const foundationMotion = racingSpec?.identity?.traversal?.motion;
      const useFoundation = !!foundationMotion && foundationMotion !== 'static';
      const generatePlayerFoundation = async (retryGuidance = ''): Promise<PlayerCraftAssets> => {
        if (!racingSpec) throw new Error('racing pack needs an identity-bearing racing spec');
        const entry = buildRacingPackPlan(racingSpec, !!racingPlayerPhoto).playerStrip;
        const prompt = retryGuidance
          ? `${entry.prompt} ART DIRECTOR CORRECTION: ${retryGuidance.slice(0, 320)}.`
          : entry.prompt;
        const reference = await racingPlayerReferenceTask;
        const result = await cachedGeneratedAsset({
          role: entry.role,
          promptVersion: entry.promptVersion,
          prompt,
          label: entry.label,
          ...(entry.size ? { size: entry.size } : {}),
          ...(reference ? { reference } : {}),
          normalize: async (raw) =>
            assembleRacingFoundationStrip((await processGeneratedRacingFoundation(raw)).png),
          privateCompanion: {
            role: 'racingCraftReference',
            normalize: (raw) => processGeneratedRacingFoundation(raw).then((foundation) => foundation.reference),
          },
        });
        return { gameplay: result.image, presentationReference: result.companion };
      };
      // Bank-free foundation gate over the neutral cells: strips stay
      // strip-shaped end to end (approval stores, restore, locomotion), so
      // only cell 0 is judged — never a bank angle.
      const reviewRacingFoundation = async (
        strips: Buffer[],
        reviewSlots: readonly RacingRosterSlotDescriptor[],
        label: string,
        references: readonly { slot: RacingRosterSlotDescriptor; png: Buffer }[] = [],
      ): Promise<ReturnType<typeof normalizeRacingFoundationDecision>> => {
        const toFoundationSlot = (slot: RacingRosterSlotDescriptor) => ({
          id: slot.id,
          name: slot.name,
          concept: slot.vehicleConcept,
        });
        let board = await buildRacingRosterJudgeBoard([
          ...await settleAll(strips.map(async (png, k) => ({ id: reviewSlots[k]!.id, png: await extractRacingNeutralCell(png) }))),
          ...await settleAll(references.map(async ({ slot, png }) => ({ id: slot.id, png: await extractRacingNeutralCell(png), referenceOnly: true }))),
        ]);
        if (mockImages) {
          return { accepted: true, rejectedIds: [], retryGuidance: '', slotGuidance: {} };
        }
        const reviewIdentity = visibleRacingPlayer && reviewSlots.some((slot) => slot.id === 'player');
        const prompt = buildRacingFoundationJudgePrompt(
          reviewSlots.map(toFoundationSlot),
          references.map(({ slot }) => toFoundationSlot(slot)),
          racingSpec?.identity?.traversal,
        );
        if (reviewIdentity) {
          board = await buildRacingPhotoReviewReference((await racingPlayerReferenceTask)!, board);
          prompt.user += ` ${racingPlayerIdentityReview(!!racingPlayerPhoto)}`;
        }
        const rawDecision = await callLlm(
          'design',
          {
            ...prompt,
            jsonSchema: buildRacingFoundationJudgeSchema(reviewSlots.map(toFoundationSlot)),
            maxTokens: 1600,
            timeoutMs: 120_000,
          },
          {
            stage: 'building-assets',
            label,
            image: board,
            reasoningEffort: 'low',
          },
        );
        return normalizeRacingFoundationDecision(rawDecision, reviewSlots.map(toFoundationSlot));
      };
      const racingPlayerStripTask: Promise<PlayerCraftAssets | null> = racingIdentity
        ? (async () => {
            if (!racingSpec) throw new Error('racing pack needs an identity-bearing racing spec');
            // Persist the reviewed selection under the immutable design key.
            // A correction prompt changes the candidate hash; without this
            // selection checkpoint, retrying unrelated scenery repaints the
            // player and invalidates every dependent story image.
            const entry = buildRacingPackPlan(racingSpec, !!racingPlayerPhoto).playerStrip;
            const acceptedVersion = `${entry.promptVersion}-approved-v1`;
            const acceptedHash = imagePromptHash(entry.prompt, await racingPlayerReferenceTask);
            const acceptedImage = assetWorkspace.load(entry.role, acceptedVersion, acceptedHash) ?? assetWorkspace.loadPrivate(RACING_BASE_ROLES[0], acceptedVersion, acceptedHash);
            const acceptedReference = assetWorkspace.loadPrivate(
              'racingCraftReference',
              acceptedVersion,
              acceptedHash,
            );
            if (acceptedImage && acceptedReference) {
              emit('building-assets', 'Restored the reviewed player vehicle');
              return { gameplay: acceptedImage, presentationReference: acceptedReference };
            }
            emit('building-assets', useFoundation ? 'Painting the player foundation…' : 'Painting the player vehicle strip…');
            const playerSlots = racingRosterSlots(racingSpec).slice(0, 1);
            // Foundation cups: one approved neutral rear, bank-free gate,
            // at most one identity repaint — bank correction never runs,
            // even on a malformed banking verdict. A still-rejected rear
            // fails loudly; it is never accepted.
            const strip = useFoundation
              ? await (async () => {
                  let foundation = await generatePlayerFoundation();
                  let verdict = await reviewRacingFoundation(
                    [foundation.gameplay],
                    playerSlots,
                    'Spark reviews the player foundation',
                  );
                  if (!verdict.accepted) {
                    const guidance =
                      verdict.slotGuidance['player'] ||
                      verdict.retryGuidance ||
                      'Correct the rejected player rear identity to match its concept and rear camera.';
                    emit('building-assets', 'Repainting the player foundation…');
                    foundation = await generatePlayerFoundation(guidance).catch(racingAssetFailure);
                    verdict = await reviewRacingFoundation(
                      [foundation.gameplay],
                      playerSlots,
                      'Spark re-reviews the player foundation',
                    );
                  }
                  if (!verdict.accepted) {
                    throw new PipelineError(
                      'image-invalid',
                      `Player foundation review rejected the rear${verdict.retryGuidance ? `: ${verdict.retryGuidance.slice(0, 200)}` : ''}`,
                      'building-assets',
                    );
                  }
                  return foundation;
                })()
              // Bounded category-aware repair BEFORE the reference freezes:
              // the CURRENT verdict picks a full repaint (vehicle) or the
              // neutral-preserving two-image bank repair (banking), at most
              // one of each, then at most one cell-order swap after a bank
              // correction. Every candidate faces the same complete review.
              : await runRacingPlayerStripRepair({
              generateInitial: () => generatePlayerStrip(),
              review: async (gameplay, phase) =>
                reviewRacingStrips(
                  [gameplay],
                  playerSlots,
                  phase === 'initial'
                    ? 'Spark reviews the player vehicle'
                    : phase === 'verify'
                      ? 'Spark verifies the player bank order'
                      : 'Spark re-reviews the player vehicle',
                ).then((reviewed) => ({
                  accepted: reviewed.accepted,
                  kind: reviewed.correctionKinds['player'] ?? 'vehicle',
                  guidance:
                    reviewed.slotGuidance['player'] ||
                    reviewed.retryGuidance ||
                    'Correct the rejected player vehicle to match its concept and rear camera.',
                })),
              repaint: (guidance) => generatePlayerStrip(guidance).catch(racingAssetFailure),
              repairBanks: async (current, guidance) => {
                // Banking keeps the accepted neutral cell and its HR
                // presentation reference; only the two banks are remade
                // while key/story art can still render from the reference.
                const playerIdentity = racingSpec.identity!;
                const correctedPlayer = await correctRacingBankPoses({
                  strip: current.gameplay,
                  vehicleName: playerSlots[0]!.name,
                  artDirection: playerIdentity.artDirection,
                  colors: racingSpec.palette.join(', '),
                  retryGuidance: guidance,
                  discipline: racingPackDiscipline(racingSpec),
                  traversal: playerIdentity.traversal,
                  rolePrefix: 'racing-craft-player',
                  generate: (prompt, pose, posedReference) =>
                    callImage({
                      role: `racing-craft-player-bank-${pose}`,
                      label: `Player bank ${pose === 'bankLeft' ? 'left' : 'right'} correction`,
                      prompt,
                      reference: posedReference ?? current.presentationReference,
                      size: '1024x1024',
                    }),
                  checkActive: throwIfSuspended,
                  validationFailure,
                }).catch(racingAssetFailure);
                return {
                  gameplay: correctedPlayer,
                  presentationReference: current.presentationReference,
                };
              },
              swapBankCells: (gameplay) => swapRacingBankCells(gameplay),
              onRepair: (kind) => {
                if (kind === 'banking')
                  emit('building-assets', 'Correcting the player banking poses…');
                else if (kind === 'vehicle')
                  emit('building-assets', 'Repainting the player vehicle strip…');
              },
            });
            await assetWorkspace.storePrivate(
              'racingCraftReference',
              strip.presentationReference,
              acceptedVersion,
              acceptedHash,
            );
            await assetWorkspace.store(entry.role, strip.gameplay, acceptedVersion, acceptedHash);
            return strip;
          })()
        : Promise.resolve(null);
      const keyArtTask: Promise<Buffer> = visibleRacingPlayer
        ? racingCharacterArtTask.then((keyArt) => keyArt!)
        : settleAll([playerCraftTask, racingPlayerStripTask]).then(
        async ([craftAssets, racingCraft]) => {
          const craftBrief = craftAssets
            ? playerCraftIdentity
            : racingCraft && racingIdentity
              ? { visualConcept: racingIdentity.playerCraftConcept }
              : undefined;
          const reference = craftAssets
            ? await buildHShooterIdentityReference(
                photoReference,
                craftAssets.presentationReference,
              )
            : racingCraft
              ? await buildRacingIdentityReference(
                  photoReference,
                  racingCraft.presentationReference,
                )
              : photoReference;
          return paintKeyArt(reference, craftBrief);
        },
      );

      let resolveAdventurePortraitReference!: (reference: Buffer) => void;
      let rejectAdventurePortraitReference!: (error: unknown) => void;
      const adventurePortraitReferenceTask = new Promise<Buffer>((resolve, reject) => {
        resolveAdventurePortraitReference = resolve;
        rejectAdventurePortraitReference = reject;
      });
      const portraitReferenceLayout = spec.archetype === 'adventure'
        ? 'adventure-hero-board' as const
        : 'game-hero-board' as const;
      // Share one likeness/style board between expressions. This reuses key art
      // already required by the scenes; it introduces no new model call.
      const portraitReferenceTask = photo
        ? visibleRacingPlayer
          ? racingPlayerReferenceTask.then((reference) => reference!)
          : spec.archetype === 'adventure'
          ? adventurePortraitReferenceTask
          : keyArtTask.then((keyArt) => buildPortraitIdentityReference(photo, keyArt))
        : Promise.resolve(null);
      const identityKey = JSON.stringify({
        portraitVersion: GENERATED_PORTRAIT_PROMPT_VERSION,
        defeatPortraitVersion: GENERATED_DEFEAT_PORTRAIT_PROMPT_VERSION,
        features: feat,
        heroConcept: canonicalHeroConcept,
      });
      const portraitTask: Promise<Buffer | null> = photo
        ? (async () => {
            const reference = (await portraitReferenceTask)!;
            const portraitSha = imagePromptHash(
              `${GENERATED_PORTRAIT_PROMPT_VERSION}:${identityKey}:${portraitReferenceLayout}`,
              reference,
            );
            let portrait = assetWorkspace.load(
              'generatedPortrait',
              GENERATED_PORTRAIT_PROMPT_VERSION,
              portraitSha,
            );
            if (!portrait) {
              let lastError: unknown;
              for (let pass = 0; pass < 2 && !portrait; pass++) {
                try {
                  portrait = await generatePortrait(
                    reference,
                    feat,
                    imageEditFor('portrait', 'Player portrait'),
                    {
                      size: '1024x1024',
                      user: gameId,
                      heroConcept: canonicalHeroConcept,
                      referenceLayout: portraitReferenceLayout,
                    },
                  );
                } catch (error) {
                  throwIfSuspended(error);
                  if (error instanceof PipelineError) throw error;
                  lastError = error;
                  validationFailure('portrait');
                  emit('building-assets', 'Repainting the player portrait…');
                }
              }
              if (!portrait) {
                throw new PipelineError(
                  'image-invalid',
                  `Player portrait failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
                  'building-assets',
                );
              }
              await assetWorkspace.store(
                'generatedPortrait',
                portrait,
                GENERATED_PORTRAIT_PROMPT_VERSION,
                portraitSha,
              );
            }
            return portrait;
          })()
        : Promise.resolve(null);

      const portraitDefeatTask: Promise<Buffer | null> = photo
        ? (async () => {
            const reference = (await portraitReferenceTask)!;
            const defeatContext = [
              `${spec.meta.title} is a ${spec.archetype} game.`,
              spec.story.defeat.join(' '),
            ].join(' ');
            const defeatPortraitSha = imagePromptHash(
              `${GENERATED_DEFEAT_PORTRAIT_PROMPT_VERSION}:${identityKey}:${defeatContext}`,
              reference,
            );
            let portraitDefeat = assetWorkspace.load(
              'generatedPortraitDefeat',
              GENERATED_DEFEAT_PORTRAIT_PROMPT_VERSION,
              defeatPortraitSha,
            );
            if (!portraitDefeat) {
              let lastError: unknown;
              for (let pass = 0; pass < 2 && !portraitDefeat; pass++) {
                try {
                  portraitDefeat = await generateDefeatPortrait(
                    reference,
                    feat,
                    defeatContext,
                    imageEditFor('portrait-defeat', 'Defeat portrait'),
                    {
                      size: '1024x1024',
                      user: gameId,
                      heroConcept: canonicalHeroConcept,
                      referenceLayout: portraitReferenceLayout,
                    },
                  );
                } catch (error) {
                  throwIfSuspended(error);
                  if (error instanceof PipelineError) throw error;
                  lastError = error;
                  validationFailure('portrait-defeat');
                  emit('building-assets', 'Repainting the defeat portrait…');
                }
              }
              if (!portraitDefeat) {
                throw new PipelineError(
                  'image-invalid',
                  `Defeat portrait failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
                  'building-assets',
                );
              }
              await assetWorkspace.store(
                'generatedPortraitDefeat',
                portraitDefeat,
                GENERATED_DEFEAT_PORTRAIT_PROMPT_VERSION,
                defeatPortraitSha,
              );
            }
            return portraitDefeat;
          })()
        : Promise.resolve(null);

      let adventurePlayerArtStatus: GameMetaFile['adventurePlayerArt'];
      let resolveAdventureIdentity!: (image: Buffer | null) => void;
      let rejectAdventureIdentity!: (error: unknown) => void;
      const adventureIdentityTask = new Promise<Buffer | null>((resolve, reject) => {
        resolveAdventureIdentity = resolve;
        rejectAdventureIdentity = reject;
      });
      // Observe early failures until story/portrait branches attach below.
      void adventureIdentityTask.catch(() => {});
      const adventurePlayerTask: Promise<Buffer | null> =
        spec.archetype === 'adventure'
          ? keyArtTask.then(async (keyArt): Promise<Buffer | null> => {
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              try {
                const identityReference = await buildAdventurePlayerIdentityReference(
                  keyArt,
                  photoReference,
                );
                const pipelineFingerprint = JSON.stringify({
                  promptVersions: {
                    pose: ADVENTURE_PLAYER_POSE_PROMPT_VERSION,
                    sheet: ADVENTURE_PLAYER_SHEET_PROMPT_VERSION,
                    setJudge: ADVENTURE_PLAYER_SET_JUDGE_PROMPT_VERSION,
                  },
                  heroConcept: canonicalHeroConcept,
                  colors,
                  combatKit: spec.combatKit,
                  hasPhoto: !!photoReference,
                });
                const pipelineSha = imagePromptHash(pipelineFingerprint, identityReference);
                const adventureArtifacts = new ArtifactCache(
                  join(this.files.checkpointsDir, jobId, 'adventure'),
                );
                const cached = Object.fromEntries(
                  GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => [
                    pose,
                    assetWorkspace.load(
                      ADVENTURE_PLAYER_ASSET_ROLES[pose],
                      ADVENTURE_PLAYER_PIPELINE_PROMPT_VERSION,
                      pipelineSha,
                    ),
                  ]),
                ) as Record<GeneratedAdventurePlayerPose, Buffer | null>;
                const poseSetHash = (poses: Record<GeneratedAdventurePlayerPose, Buffer>) =>
                  imagePromptHash(
                    'adventure-reviewed-set-v1',
                    Buffer.concat(GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => poses[pose])),
                  );
                const poseCandidateKey = (pose: GeneratedAdventurePlayerPose, png: Buffer) =>
                  `pose:${pipelineSha}:${pose}:${sha256(png)}`;
                const cachedScaleGuidance = new Map<GeneratedAdventurePlayerPose, string>();
                if (GENERATED_ADVENTURE_PLAYER_POSES.every((pose) => cached[pose])) {
                  const restored = cached as Record<GeneratedAdventurePlayerPose, Buffer>;
                  try {
                    await validateGeneratedAdventurePlayerPoseSet(restored);
                    if (
                      adventureArtifacts.read<string>(`reviewed-set:${pipelineSha}`) ===
                      poseSetHash(restored)
                    ) {
                      adventurePlayerArtStatus = { mode: 'generated', attempted: true };
                      emit('building-assets', 'Restored the reviewed Adventure player');
                      resolveAdventureIdentity(restored.downIdle);
                      return restored.downIdle;
                    }
                  } catch (error) {
                    throwIfSuspended(error);
                    const repairs =
                      error instanceof Error && error.message.includes('change character height')
                        ? await adventurePlayerScaleRetryPoses(
                            GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => ({
                              id: pose,
                              pose,
                              processed: restored[pose],
                            })),
                          )
                        : [];
                    const discarded = repairs.length
                      ? repairs.map(({ pose }) => pose)
                      : GENERATED_ADVENTURE_PLAYER_POSES;
                    await assetWorkspace.discard(
                      discarded.map((pose) => ADVENTURE_PLAYER_ASSET_ROLES[pose]),
                    );
                    for (const pose of discarded) cached[pose] = null;
                    for (const { pose, guidance } of repairs)
                      cachedScaleGuidance.set(pose, guidance);
                    emit(
                      'building-assets',
                      `Discarded ${discarded.length} inconsistent Adventure pose checkpoints (${error instanceof Error ? error.message.slice(0, 140) : 'set validation failed'})`,
                    );
                  }
                }

                interface Candidate {
                  id: string;
                  reference: Buffer;
                  png: Buffer;
                }
                interface PoseCandidate extends Candidate {
                  pose: GeneratedAdventurePlayerPose;
                }
                const checkpointed = { ...cached };
                const checkpointPose = async (candidate: PoseCandidate): Promise<void> => {
                  if (checkpointed[candidate.pose]?.equals(candidate.png)) return;
                  await assetWorkspace.store(
                    ADVENTURE_PLAYER_ASSET_ROLES[candidate.pose],
                    candidate.png,
                    ADVENTURE_PLAYER_PIPELINE_PROMPT_VERSION,
                    pipelineSha,
                  );
                  adventureArtifacts.write(
                    poseCandidateKey(candidate.pose, candidate.png),
                    candidate,
                  );
                  checkpointed[candidate.pose] = candidate.png;
                };
                const resumedWithPoseCheckpoints = GENERATED_ADVENTURE_PLAYER_POSES.some(
                  (pose) => pose !== 'downIdle' && cached[pose] !== null,
                );
                const generateCandidateUncached = async (
                  id: string,
                  label: string,
                  prompt: string,
                  reference: Buffer,
                ): Promise<Candidate | null> => {
                  let raw: Buffer;
                  try {
                    raw = await callImage({
                      role: `adventure-player-${id}`,
                      label,
                      prompt,
                      reference,
                      size: '1024x1024',
                    });
                  } catch (error) {
                    throwIfSuspended(error);
                    if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                    validationFailure(`adventure-player-${id}`);
                    emit('building-assets', `${label} was rejected; continuing…`);
                    return null;
                  }
                  try {
                    let normalizedReference = raw;
                    let png: Buffer;
                    try {
                      png = await processGeneratedAdventurePlayerPose(raw);
                    } catch (initialError) {
                      throwIfSuspended(initialError);
                      const recovery = await recoverGeneratedPlatformerGreenPanel(raw);
                      if (!recovery.recovered) throw initialError;
                      normalizedReference = recovery.image;
                      png = await processGeneratedAdventurePlayerPose(normalizedReference);
                    }
                    return { id, reference: normalizedReference, png };
                  } catch (error) {
                    throwIfSuspended(error);
                    validationFailure(`adventure-player-${id}`);
                    const reason =
                      error instanceof Error
                        ? error.message.replace(/\s+/g, ' ').slice(0, 160)
                        : '';
                    emit(
                      'building-assets',
                      `${label} failed local sprite validation${reason ? ` (${reason})` : ''}`,
                    );
                    return null;
                  }
                };

                const generateCandidate = (...args: Parameters<typeof generateCandidateUncached>) =>
                  adventureArtifacts.getOrCompute(
                    imagePromptHash(
                      JSON.stringify(['candidate', job.attempt, pipelineSha, args[0], args[2]]),
                      args[3],
                    ),
                    () => generateCandidateUncached(...args),
                  );
                let downIdle: Candidate | null = cached.downIdle
                  ? (adventureArtifacts.read<Candidate>(
                      poseCandidateKey('downIdle', cached.downIdle),
                    ) ?? {
                      id: 'checkpoint-downIdle',
                      reference: cached.downIdle,
                      png: cached.downIdle,
                    })
                  : null;
                let identityApproved =
                  !!downIdle &&
                  adventureArtifacts.read<string>(`approved-identity:${pipelineSha}`) ===
                    sha256(downIdle.png);
                let retryGuidance = '';
                if (downIdle) {
                  emit('building-assets', 'Restored the Adventure player identity checkpoint');
                }
                for (let round = 1; round <= 2 && !downIdle; round++) {
                  emit(
                    'building-assets',
                    round === 1
                      ? 'Painting three Adventure player identity foundations…'
                      : 'Repainting the Adventure player identity with Spark guidance…',
                  );
                  const offset = (round - 1) * 3;
                  const candidates = (
                    await settleAll(
                      [1, 2, 3].map((index) => {
                        const id = `I${offset + index}`;
                        return generateCandidate(
                          id,
                          `Adventure player identity candidate ${id}`,
                          buildAdventurePlayerIdentityPrompt(id, {
                            hasPhoto: !!photoReference,
                            heroConcept: canonicalHeroConcept,
                            colors,
                            combatKit: spec.combatKit,
                            ...(retryGuidance ? { retryGuidance } : {}),
                          }),
                          identityReference,
                        );
                      }),
                    )
                  ).filter((candidate): candidate is Candidate => candidate !== null);
                  if (candidates.length === 0) {
                    retryGuidance =
                      'Return exactly one centered, uncropped adult in a down-facing top-down three-quarter idle on flat green';
                    continue;
                  }
                  const descriptors: PlatformerIdleCandidateDescriptor[] = candidates.map(
                    ({ id }) => ({ id }),
                  );
                  const board = await buildPlatformerIdleJudgeBoard({
                    source: photoReference ?? keyArt,
                    candidates: candidates.map(({ id, reference: raw, png: processed }) => ({
                      id,
                      raw,
                      processed,
                    })),
                  });
                  const mockDecision = {
                    sourceReview: { eyewear: 'uncertain', summary: 'Mock source identity.' },
                    candidateReviews: descriptors.map(({ id }) => ({
                      id,
                      eyewear: 'absent',
                      eyewearMatch: true,
                      scores: {
                        identity: 5,
                        faceAndHair: 5,
                        accessories: 5,
                        costume: 5,
                        proportions: 5,
                        pose: 5,
                        technical: 5,
                      },
                      fatalIssues: [],
                      summary: 'Mock identity-safe Adventure foundation.',
                    })),
                    selection: {
                      accepted: true,
                      candidateId: descriptors[0]!.id,
                      confidence: 1,
                      rationale: 'Mock selection.',
                      retryGuidance: '',
                    },
                  };
                  const rawDecision = mockImages
                    ? mockDecision
                    : await callLlm(
                        'design',
                        {
                          ...buildAdventurePlayerIdentityJudgePrompt(
                            descriptors,
                            canonicalHeroConcept,
                            spec.combatKit,
                            photoReference ? 'photo' : 'key-art',
                          ),
                          jsonSchema: buildPlatformerIdleJudgeSchema(descriptors),
                          maxTokens: 2600,
                          timeoutMs: 120_000,
                        },
                        {
                          stage: 'building-assets',
                          label: 'Spark selected the Adventure player identity',
                          image: board,
                          reasoningEffort: 'low',
                        },
                      );
                  const decision = normalizePlatformerIdleJudgeDecision(rawDecision, descriptors);
                  const selectedId = decision.selection.accepted
                    ? decision.selection.candidateId
                    : bestPlatformerIdleCandidateId(decision);
                  downIdle = candidates.find(({ id }) => id === selectedId) ?? null;
                  identityApproved = decision.selection.accepted && !!downIdle;
                  retryGuidance = decision.selection.retryGuidance;
                }
                if (!downIdle) {
                  throw new Error('no identity-safe Adventure player foundation was available');
                }

                const downIdlePose: PoseCandidate = { ...downIdle, pose: 'downIdle' };
                await checkpointPose(downIdlePose);
                if (identityApproved) {
                  adventureArtifacts.write(
                    `approved-identity:${pipelineSha}`,
                    sha256(downIdle.png),
                  );
                  emit('building-assets', 'Adventure player identity ready');
                  resolveAdventureIdentity(downIdle.png);
                }
                const downReference = await prepareGeneratedAdventurePlayerReference(
                  downIdle.reference,
                );
                const sheetSeed = await buildAdventurePlayerSheetSeed(downIdle.png);
                const generateSheetUncached = async (
                  group: AdventurePlayerSheetGroup,
                ): Promise<PoseCandidate[]> => {
                  let raw: Buffer;
                  try {
                    raw = await callImage({
                      role: `adventure-player-sheet-${group.id}`,
                      label: `Adventure player ${group.id} sheet`,
                      prompt: buildAdventurePlayerSheetPrompt(group, {
                        heroConcept: canonicalHeroConcept,
                        colors,
                        combatKit: spec.combatKit,
                      }),
                      reference: sheetSeed,
                      size: '1024x1024',
                    });
                  } catch (error) {
                    throwIfSuspended(error);
                    if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                    validationFailure(`adventure-player-sheet-${group.id}`);
                    emit(
                      'building-assets',
                      `Adventure player ${group.id} sheet was unavailable; recovering its poses individually…`,
                    );
                    return [];
                  }
                  let cells;
                  try {
                    cells = await splitGeneratedAdventurePlayerSheet(raw, group);
                  } catch (_error) {
                    throwIfSuspended(_error);
                    validationFailure(`adventure-player-sheet-${group.id}`);
                    emit(
                      'building-assets',
                      `Adventure player ${group.id} sheet could not be segmented`,
                    );
                    return [];
                  }
                  const candidates: PoseCandidate[] = [];
                  for (const cell of cells) {
                    if (cell.pose === 'downIdle' || cached[cell.pose]) continue;
                    if (!cell.processed) {
                      validationFailure(`adventure-player-${cell.pose}-sheet-${group.id}`);
                      emit(
                        'building-assets',
                        `Adventure player ${cell.pose} from the ${group.id} sheet failed local validation${cell.error ? ` (${cell.error.replace(/\s+/g, ' ').slice(0, 160)})` : ''}`,
                      );
                      continue;
                    }
                    const candidate: PoseCandidate = {
                      id: cell.id,
                      pose: cell.pose,
                      reference: cell.raw,
                      png: cell.processed,
                    };
                    await checkpointPose(candidate);
                    candidates.push(candidate);
                  }
                  return candidates;
                };

                const sheetAttemptKey = (group: AdventurePlayerSheetGroup) =>
                  `sheet-attempt:${pipelineSha}:${group.id}`;
                const generateSheet = (group: AdventurePlayerSheetGroup) => {
                  adventureArtifacts.write(sheetAttemptKey(group), job.attempt);
                  return adventureArtifacts.getOrCompute(
                    imagePromptHash(
                      JSON.stringify(['sheet-v1', job.attempt, pipelineSha, group.id]),
                      sheetSeed,
                    ),
                    () => generateSheetUncached(group),
                  );
                };
                const restoredPoseCandidates = GENERATED_ADVENTURE_PLAYER_POSES.flatMap(
                  (pose): PoseCandidate[] => {
                    const png = cached[pose];
                    return png
                      ? [
                          adventureArtifacts.read<PoseCandidate>(poseCandidateKey(pose, png)) ?? {
                            id: `checkpoint-${pose}`,
                            pose,
                            reference: png,
                            png,
                          },
                        ]
                      : [];
                  },
                ).filter((candidate) => candidate.pose !== 'downIdle');
                emit(
                  'building-assets',
                  resumedWithPoseCheckpoints
                    ? `Restored ${restoredPoseCandidates.length + 1} healthy Adventure player pose checkpoints`
                    : 'Painting Adventure movement and combat pose sheets…',
                );
                const poseCandidates: PoseCandidate[] = [
                  downIdlePose,
                  ...restoredPoseCandidates,
                  ...(
                    await settleAll(
                      ADVENTURE_PLAYER_SHEET_GROUPS.filter(
                        (group) =>
                          // Resume an in-flight sheet within this attempt. An
                          // explicit retry repairs only the missing saved poses.
                          (!resumedWithPoseCheckpoints ||
                            adventureArtifacts.read<number>(sheetAttemptKey(group)) ===
                              job.attempt) &&
                          group.poses.some(
                            (pose) =>
                              pose !== 'downIdle' &&
                              !cached[pose] &&
                              !cachedScaleGuidance.has(pose),
                          ),
                      ).map((group) => generateSheet(group)),
                    )
                  )
                    .flat()
                    .filter((candidate) => !cached[candidate.pose]),
                ];

                const generateIsolatedPose = async (
                  pose: Exclude<GeneratedAdventurePlayerPose, 'downIdle'>,
                  suffix: string,
                  guidance: string,
                  reference: Buffer,
                ): Promise<PoseCandidate | null> => {
                  const correction = guidance
                    ? ` RETRY CORRECTION FROM THE ART DIRECTOR: ${guidance}. Preserve every other identity, accessory, wardrobe, scale, camera, and ground-line detail.`
                    : '';
                  const candidate = await generateCandidate(
                    `${pose}-${suffix}`,
                    `Adventure player ${pose} ${suffix}`,
                    `${buildAdventurePlayerPosePrompt(pose, {
                      heroConcept: canonicalHeroConcept,
                      colors,
                      combatKit: spec.combatKit,
                    })}${correction}`,
                    reference,
                  );
                  if (!candidate) return null;
                  const poseCandidate: PoseCandidate = { ...candidate, pose };
                  await checkpointPose(poseCandidate);
                  return poseCandidate;
                };

                const missingAfterSheets = GENERATED_ADVENTURE_PLAYER_POSES.filter(
                  (pose): pose is Exclude<GeneratedAdventurePlayerPose, 'downIdle'> =>
                    pose !== 'downIdle' &&
                    !poseCandidates.some((candidate) => candidate.pose === pose),
                );
                if (missingAfterSheets.length > 0) {
                  emit(
                    'building-assets',
                    `Recovering ${missingAfterSheets.length} Adventure poses missing from both sheets…`,
                  );
                  const recoveries = await settleAll(
                    missingAfterSheets.map(async (pose) => {
                      for (let attempt = 1; attempt <= 2; attempt++) {
                        const candidate = await generateIsolatedPose(
                          pose,
                          `sheet-recovery-${attempt}`,
                          cachedScaleGuidance.get(pose) ??
                            'Both grouped-sheet cells failed extraction. Return one complete uncropped silhouette on perfectly flat #00ff00 and make the requested direction and motion unmistakable',
                          downReference,
                        );
                        if (candidate) return candidate;
                      }
                      return null;
                    }),
                  );
                  for (const candidate of recoveries) {
                    if (candidate) poseCandidates.push(candidate);
                  }
                }
                const stillMissing = GENERATED_ADVENTURE_PLAYER_POSES.filter(
                  (pose) => !poseCandidates.some((candidate) => candidate.pose === pose),
                );
                if (stillMissing.length > 0) {
                  throw new Error(
                    `no locally valid Adventure candidate was available for ${stillMissing.join(', ')}`,
                  );
                }

                // A finished repair can replace a pose checkpoint while its
                // sibling is still pending. Keep the original review pool so
                // resume reuses that review and its exact repair requests.
                const reviewPoolKey = `review-pool-v1:${job.attempt}:${pipelineSha}`;
                const savedReviewPool = adventureArtifacts.read<PoseCandidate[]>(reviewPoolKey);
                if (savedReviewPool) {
                  poseCandidates.splice(0, poseCandidates.length, ...savedReviewPool);
                } else {
                  adventureArtifacts.write(reviewPoolKey, poseCandidates);
                }

                const reviewPoseSet = async (
                  pool: readonly PoseCandidate[],
                ): Promise<AdventurePlayerSetJudgeDecision> => {
                  const descriptors: AdventurePlayerCandidateDescriptor[] = pool.map(
                    ({ id, pose }) => ({ id, pose }),
                  );
                  const board = await buildAdventurePlayerSetJudgeBoard({
                    anchor: downIdle.png,
                    candidates: pool.map(({ id, pose, png: processed }) => ({
                      id,
                      pose,
                      processed,
                    })),
                  });
                  const firstByPose = Object.fromEntries(
                    GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => [
                      pose,
                      descriptors.find((candidate) => candidate.pose === pose)!,
                    ]),
                  ) as Record<GeneratedAdventurePlayerPose, AdventurePlayerCandidateDescriptor>;
                  const mockDecision = {
                    candidateReviews: descriptors.map(({ id, pose }) => ({
                      id,
                      pose,
                      scores: {
                        identity: 5,
                        accessories: 5,
                        costume: 5,
                        orientation: 5,
                        motion: 5,
                        equipment: 5,
                        technical: 5,
                      },
                      fatalIssues: [],
                      summary: 'Mock identity-consistent Adventure pose.',
                    })),
                    selections: GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => ({
                      pose,
                      candidateId: firstByPose[pose].id,
                      rationale: 'Mock selection.',
                    })),
                    setReview: {
                      accepted: true,
                      identityConsistency: 5,
                      accessoryConsistency: 5,
                      costumeConsistency: 5,
                      directionReadability: 5,
                      motionReadability: 5,
                      equipmentConsistency: 5,
                      scaleConsistency: 5,
                      fatalIssues: [],
                      summary: 'Mock complete movement and combat set.',
                    },
                    retryPoses: [],
                  };
                  const rawDecision = mockImages
                    ? mockDecision
                    : await callLlm(
                        'design',
                        {
                          ...buildAdventurePlayerSetJudgePrompt(
                            descriptors,
                            canonicalHeroConcept,
                            spec.combatKit,
                          ),
                          jsonSchema: buildAdventurePlayerSetJudgeSchema(descriptors),
                          maxTokens: 7000,
                          timeoutMs: 120_000,
                        },
                        {
                          stage: 'building-assets',
                          label: 'Spark reviewed the complete Adventure player set',
                          image: board,
                          reasoningEffort: 'low',
                        },
                      );
                  return normalizeAdventurePlayerSetJudgeDecision(rawDecision, descriptors);
                };

                let setDecision = await reviewPoseSet(poseCandidates);
                if (!setDecision.setReview.accepted) {
                  const retryPoses = adventurePlayerPosesNeedingRetry(setDecision, 3);
                  if (retryPoses.length > 0) {
                    emit(
                      'building-assets',
                      `Repainting ${retryPoses.length} weak Adventure poses with Spark guidance…`,
                    );
                    const selectedIds = bestAdventurePlayerCandidateIds(setDecision);
                    const alternatives = (
                      await settleAll(
                        retryPoses.flatMap(({ pose, guidance }) => {
                          if (pose === 'downIdle') return [];
                          const directionAnchorPose =
                            pose === 'upWalk' || pose === 'upMelee' || pose === 'upSecondary'
                              ? 'upIdle'
                              : pose === 'sideWalk' ||
                                  pose === 'sideMelee' ||
                                  pose === 'sideSecondary'
                                ? 'sideIdle'
                                : 'downIdle';
                          const directionAnchor = poseCandidates.find(
                            (candidate) =>
                              candidate.pose === directionAnchorPose &&
                              candidate.id === selectedIds[directionAnchorPose],
                          );
                          const referenceTask = directionAnchor
                            ? prepareGeneratedAdventurePlayerReference(directionAnchor.reference)
                            : Promise.resolve(downReference);
                          return ['R1', 'R2'].map(async (suffix) =>
                            generateIsolatedPose(pose, suffix, guidance, await referenceTask),
                          );
                        }),
                      )
                    ).filter((candidate): candidate is PoseCandidate => candidate !== null);
                    poseCandidates.push(...alternatives);
                    setDecision = await reviewPoseSet(poseCandidates);
                  }
                }
                if (!setDecision.setReview.accepted) {
                  emit(
                    'building-assets',
                    'Spark selected the best locally valid Adventure pose combination below the ideal quality bar',
                  );
                }
                let selectedIds = await bestScaleConsistentAdventurePlayerCandidateIds(
                  setDecision,
                  poseCandidates.map(({ id, pose, png }) => ({ id, pose, processed: png })),
                );
                if (!selectedIds) {
                  const repairs = await adventurePlayerScaleRetryPoses(
                    poseCandidates.map(({ id, pose, png }) => ({ id, pose, processed: png })),
                  );
                  if (repairs.length) {
                    emit(
                      'building-assets',
                      `Repainting ${repairs.length} Adventure poses to match the hero's scale…`,
                    );
                    const alternatives = await settleAll(
                      repairs.map(async ({ pose, guidance }) => {
                        const anchorPose = pose.startsWith('side')
                          ? 'sideIdle'
                          : pose.startsWith('up')
                            ? 'upIdle'
                            : 'downIdle';
                        const anchor = poseCandidates.find(
                          (candidate) => candidate.pose === anchorPose,
                        );
                        const reference = anchor
                          ? await prepareGeneratedAdventurePlayerReference(anchor.reference)
                          : downReference;
                        return generateIsolatedPose(pose, 'scale-recovery', guidance, reference);
                      }),
                    );
                    poseCandidates.push(
                      ...alternatives.filter(
                        (candidate): candidate is PoseCandidate => candidate !== null,
                      ),
                    );
                    setDecision = await reviewPoseSet(poseCandidates);
                    selectedIds = await bestScaleConsistentAdventurePlayerCandidateIds(
                      setDecision,
                      poseCandidates.map(({ id, pose, png }) => ({ id, pose, processed: png })),
                    );
                  }
                }
                if (!selectedIds) {
                  throw new Error('no scale-consistent Adventure player combination was available');
                }
                const generated = Object.fromEntries(
                  GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => {
                    const selected = poseCandidates.find(
                      (candidate) => candidate.pose === pose && candidate.id === selectedIds[pose],
                    );
                    if (!selected) throw new Error(`Spark did not select Adventure ${pose}`);
                    return [pose, selected.png];
                  }),
                ) as Record<GeneratedAdventurePlayerPose, Buffer>;
                await validateGeneratedAdventurePlayerPoseSet(generated);
                if (identityApproved && !generated.downIdle.equals(downIdle.png))
                  throw new Error('Adventure foundation changed after story identity was frozen');
                await settleAll(
                  GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => {
                    const selected = poseCandidates.find(
                      (candidate) => candidate.pose === pose && candidate.id === selectedIds[pose],
                    )!;
                    return checkpointPose(selected);
                  }),
                );
                adventureArtifacts.write(`reviewed-set:${pipelineSha}`, poseSetHash(generated));
                adventurePlayerArtStatus = { mode: 'generated', attempted: true };
                emit('building-assets', 'Finished the generated Adventure player');
                return generated.downIdle;
              } catch (error) {
                throwIfSuspended(error);
                if (abort.signal.aborted) throw error;
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated Adventure player set failed validation';
                emit(
                  'building-assets',
                  `Adventure player generation failed without a mechanically valid complete set (${reason.slice(0, 120)})`,
                );
                if (error instanceof PipelineError || error instanceof GeneratedAssetStorageError) {
                  throw error;
                }
                throw new PipelineError('image-invalid', reason, 'building-assets');
              }
            })
          : Promise.resolve(null);

      void adventurePlayerTask.then(resolveAdventureIdentity, rejectAdventureIdentity);
      if (spec.archetype === 'adventure' && photo) {
        void settleAll([keyArtTask, adventureIdentityTask])
          .then(async ([keyArt, adventurePlayer]) => {
            if (!adventurePlayer) {
              throw new Error('Adventure portrait requires the selected gameplay hero');
            }
            return buildAdventurePortraitIdentityReference(
              photoReference ?? photo,
              keyArt,
              adventurePlayer,
            );
          })
          .then(resolveAdventurePortraitReference, rejectAdventurePortraitReference);
      }

      const storyAssetTask = (
        role: StoryArtRole,
        assetRole: GeneratedGameAssetRole,
      ): Promise<Buffer> =>
        settleAll([keyArtTask, playerCraftTask, racingPlayerStripTask, adventureIdentityTask]).then(
          async ([keyArt, craftAssets, racingCraft, adventurePlayer]) => {
            const craftBrief = craftAssets
              ? playerCraftIdentity
              : racingCraft && racingIdentity
                ? { visualConcept: racingIdentity.playerCraftConcept }
                : undefined;
            const adventureReference = adventurePlayer
              ? await buildAdventureStoryIdentityReference(keyArt, adventurePlayer)
              : null;
            const storyReference = adventureReference
              ? adventureReference
              : craftAssets
                ? await buildHShooterIdentityReference(keyArt, craftAssets.presentationReference)
                : racingCraft
                  ? await buildRacingIdentityReference(keyArt, racingCraft.presentationReference)
                  : keyArt;
            const reference = storyReference;
            return cachedGeneratedAsset({
              role: assetRole,
              promptVersion: STORY_ART_PROMPT_VERSION,
              prompt: buildStoryArtPrompt(
                spec,
                role,
                canonicalHeroConcept,
                craftBrief,
                !!adventureReference,
              ),
              policyFallbackPrompt: buildStoryArtPolicyFallbackPrompt(
                spec,
                role,
                canonicalHeroConcept,
                craftBrief,
                !!adventureReference,
              ),
              label: `${role} scene`,
              reference,
              size: STORY_ART_ASPECT_HINT,
              normalize: normalizeStoryArt,
            });
          },
        );
      const storyAssets = {
        intro: storyAssetTask('intro', 'storyIntro'),
        boss: storyAssetTask('boss', 'storyBoss'),
        victory: storyAssetTask('victory', 'storyVictory'),
        defeat: storyAssetTask('defeat', 'storyDefeat'),
      } satisfies Record<StoryArtRole, Promise<Buffer>>;
      const storyTask = settleAll(Object.values(storyAssets)).then(() => undefined);

      // Racing world + roster pack. Required for identity-bearing cups: every
      // one of the ten roles must validate, and the five-strip roster must
      // pass one semantic review (with a single bounded correction) before
      // the job can go ready. Nothing degrades to generic art silently.
      let racingArtStatus: GameMetaFile['racingArt'];
      const racingPackTask: Promise<void> = racingIdentity
        ? settleAll([keyArtTask, racingPlayerStripTask]).then(async ([keyArt, playerStrip]) => {
            if (!playerStrip) {
              throw new PipelineError(
                'image-invalid',
                'Player vehicle strip did not complete',
                'building-assets',
              );
            }
            if (!racingSpec) throw new Error('racing pack needs an identity-bearing racing spec');
            const plan = buildRacingPackPlan(racingSpec, !!racingPlayerPhoto);
            const slots = racingRosterSlots(racingSpec);
            const generateStrip = (entry: RacingPackEntry): Promise<Buffer> => {
              const approved = assetWorkspace.load(
                entry.role,
                `${entry.promptVersion}-approved-v1`,
                imagePromptHash(entry.prompt),
              );
              const baseIndex = plan.rivalStrips.indexOf(entry) + 1;
              const savedBase = assetWorkspace.loadPrivate(
                RACING_BASE_ROLES[baseIndex]!,
                `${entry.promptVersion}-approved-v1`,
                imagePromptHash(entry.prompt),
              );
              if (approved || savedBase) return Promise.resolve((approved ?? savedBase)!);
              return cachedGeneratedAsset({
                role: entry.role,
                promptVersion: entry.promptVersion,
                prompt: entry.prompt,
                label: entry.label,
                ...(entry.size ? { size: entry.size } : {}),
                normalize: useFoundation
                  ? async (raw) =>
                      assembleRacingFoundationStrip(
                        (await processGeneratedRacingFoundation(raw)).png,
                      )
                  : (raw) => processGeneratedRacingCraftStrip(raw).then((strip) => strip.png),
              });
            };
            const generateEntry = (
              entry: RacingPackEntry,
              normalize: (raw: Buffer) => Promise<Buffer>,
              reference?: Buffer,
            ): Promise<Buffer> =>
              cachedGeneratedAsset({
                role: entry.role,
                promptVersion: entry.promptVersion,
                prompt: entry.prompt,
                label: entry.label,
                ...(entry.size ? { size: entry.size } : {}),
                ...(reference ? { reference } : {}),
                normalize,
              });
            emit('building-assets', 'Painting rival strips, panoramas, and the world pack…');
            const plannedRoles = [
              plan.playerStrip.role,
              ...plan.rivalStrips.map((entry) => entry.role),
              ...plan.panoramas.map((entry) => entry.role),
              plan.scenery.role,
              plan.materials.role,
            ];
            if (!RACING_PACK_REQUIRED_ROLES.every((role) => plannedRoles.includes(role))) {
              throw new Error('racing pack plan does not cover the ten-file contract');
            }
            // Drain every started image call before reporting failure, so
            // retries cannot overlap old writes or omit their usage receipts.
            const drain = async <T>(tasks: Promise<T>[]): Promise<T[]> => {
              const outcomes = await Promise.allSettled(tasks);
              const failed = outcomes.find((result) => result.status === 'rejected');
              if (failed?.status === 'rejected') throw failed.reason;
              return outcomes.map((result) => (result as PromiseFulfilledResult<T>).value);
            };
            const worldTask = drain<Buffer[]>([
              drain(
                plan.panoramas.map((entry) =>
                  generateEntry(
                    entry,
                    (raw) => processGeneratedRacingPanorama(raw, racingPackDiscipline(racingSpec)),
                    entry.reference === 'keyArt' ? keyArt : undefined,
                  ),
                ),
              ),
              generateRacingSceneryPack({
                spec: racingSpec,
                workspace: assetWorkspace,
                reference: keyArt,
                generate: (prompt, slot) =>
                  callImage({
                    role: `racing-scenery-object-${slot + 1}`,
                    label: `Roadside object ${slot + 1} of 6`,
                    prompt,
                    reference: keyArt,
                    size: '1024x1024',
                  }),
                checkActive: throwIfSuspended,
                validationFailure,
              })
                .catch(racingAssetFailure)
                .then((image) => [image]),
              (racingPackDiscipline(racingSpec) === 'jetski'
                ? generateRacingJetskiMaterialsPack({
                    spec: racingSpec,
                    workspace: assetWorkspace,
                    generate: (prompt, slot) =>
                      callImage({
                        role: `racing-material-tile-${slot + 1}`,
                        label: `Water material ${slot + 1} of 4`,
                        prompt,
                        size: '1024x1024',
                      }),
                    checkActive: throwIfSuspended,
                    validationFailure,
                  }).catch(racingAssetFailure)
                : generateEntry(plan.materials, (raw) => processGeneratedRacingMaterials(raw))
              ).then((image) => [image]),
            ]);
            // Review and repair the roster as soon as its strips are ready.
            // Scenery is independent, but both branches must drain before checkpointing.
            const rosterTask = (async () => {
              const rivalBuffers = await drain(
                plan.rivalStrips.map((entry) => generateStrip(entry)),
              );
              // Rival-only review: the player strip was already reviewed
              // before its reference froze into key/story art, so it rides
              // the board as a reference-only row and can never receive a
              // new random verdict. Only rival targets can reject here.
              const buffers = [playerStrip.gameplay, ...rivalBuffers!];
              const approvedIds = new Set(['player']);
              for (const [index, entry] of plan.rivalStrips.entries()) {
                if (
                  assetWorkspace.load(
                    entry.role,
                    `${entry.promptVersion}-approved-v1`,
                    imagePromptHash(entry.prompt),
                  ) ||
                  assetWorkspace.loadPrivate(
                    RACING_BASE_ROLES[index + 1]!,
                    `${entry.promptVersion}-approved-v1`,
                    imagePromptHash(entry.prompt),
                  )
                ) {
                  approvedIds.add(slots[index + 1]!.id);
                }
              }
              const reviewPending = (label: string) =>
                reviewPendingRacingStrips({
                  slots,
                  buffers,
                  approvedIds,
                  review: async (pending, targets, references) => {
                    if (!useFoundation)
                      return reviewRacingStrips(pending, targets, label, references);
                    // Foundation rejects are always identity rejects (the gate
                    // has no banking vocabulary), so every pending rival maps to
                    // a full repaint. The existing round planner then gives at
                    // most one repaint and never a bank correction or swap —
                    // even a malformed banking verdict cannot occur here.
                    const verdict = await reviewRacingFoundation(
                      pending,
                      targets,
                      label,
                      references,
                    );
                    return {
                      ...verdict,
                      correctionKinds: Object.fromEntries(
                        targets.map((target) => [target.id, 'vehicle' as const]),
                      ),
                    };
                  },
                  approve: async (id, png) => {
                    const index = slots.findIndex((slot) => slot.id === id);
                    const entry = plan.rivalStrips[index - 1]!;
                    await assetWorkspace.store(
                      entry.role,
                      png,
                      `${entry.promptVersion}-approved-v1`,
                      imagePromptHash(entry.prompt),
                    );
                    approvedIds.add(id);
                  },
                });
              let decision = await reviewPending('Spark reviews the vehicle roster');
              // Bounded category-aware rival repair. The CURRENT rejected ids
              // and categories are re-read every round: per rival at most one
              // full repaint (vehicle verdict — bad neutral identity, the
              // distinctness case, or any doubt) and one two-image bank
              // correction (banking verdict, neutral cell preserved), then at
              // most one cell-order swap after a bank correction. No exhausted
              // category is ever retried. Approvals persist immediately inside
              // reviewPending, so approved rivals ride as reference-only rows
              // and are never redone; every round re-runs the same full
              // pending-vs-approved reference gate. Guidance is always the
              // judge's own slot wording — never a new invented theme.
              // Provider policy refusals propagate out of the correction calls
              // below (racingAssetFailure rethrows); the loop never catches
              // them into another attempt.
              const rivalRepairStates = new Map<string, RacingRivalRepairState>();
              for (
                let round = 0;
                round < RACING_RIVAL_REPAIR_MAX_ROUNDS && !decision.accepted;
                round++
              ) {
                if (decision.rejectedIds.includes(slots[0]!.id)) {
                  throw new PipelineError(
                    'image-invalid',
                    'Vehicle roster review rejected the frozen player strip; key and story art already rendered from it',
                    'building-assets',
                  );
                }
                const retryIds = decision.rejectedIds.length
                  ? decision.rejectedIds
                  : slots.filter((slot) => !approvedIds.has(slot.id)).map((slot) => slot.id);
                const roundActions = planRacingRivalRepairRound(
                  retryIds,
                  decision.correctionKinds,
                  approvedIds,
                  rivalRepairStates,
                ).filter(({ action }) => action !== 'exhausted');
                if (!roundActions.length) break;
                emit(
                  'building-assets',
                  roundActions.every(
                    ({ id }) => (decision.correctionKinds[id] ?? 'vehicle') === 'banking',
                  )
                    ? 'Correcting rejected rival banking poses…'
                    : 'Correcting rejected rival vehicles…',
                );
                let swapsOnly = true;
                await settleAll(
                  roundActions.map(async ({ id, action }) => {
                    const k = slots.findIndex((slot) => slot.id === id);
                    if (k <= 0) {
                      throw new PipelineError(
                        'image-invalid',
                        'Vehicle roster review rejected the frozen player strip; key and story art already rendered from it',
                        'building-assets',
                      );
                    }
                    const state = rivalRepairStates.get(id) ?? freshRacingRivalRepairState();
                    rivalRepairStates.set(id, state);
                    const entry = plan.rivalStrips[k - 1]!;
                    const slot = slots[k]!;
                    const guidance =
                      decision.slotGuidance[id] ||
                      decision.retryGuidance ||
                      'Correct this rejected vehicle to match its concept, rear camera and distinct silhouette.';
                    if (action === 'repaint') {
                      // One full-strip regeneration with the slot-specific
                      // distinctness guidance, cached under the correction
                      // hash by cachedGeneratedAsset.
                      buffers[k] = await cachedGeneratedAsset({
                        role: entry.role,
                        promptVersion: entry.promptVersion,
                        prompt: `${entry.prompt} ART DIRECTOR VEHICLE CORRECTION: ${guidance.slice(0, 320)}.`,
                        label: entry.label,
                        ...(entry.size ? { size: entry.size } : {}),
                        normalize: useFoundation
                          ? async (raw) =>
                              assembleRacingFoundationStrip(
                                (await processGeneratedRacingFoundation(raw)).png,
                              )
                          : (raw) =>
                              processGeneratedRacingCraftStrip(raw).then((strip) => strip.png),
                      }).catch(racingAssetFailure);
                      await assetWorkspace.store(
                        entry.role,
                        buffers[k]!,
                        entry.promptVersion,
                        imagePromptHash(entry.prompt),
                      );
                      state.didRepaint = true;
                      swapsOnly = false;
                      return;
                    }
                    if (action === 'bank') {
                      // Targeted banking correction: preserve the accepted
                      // neutral cell, regenerate only the two banks as
                      // single-object edits of the enlarged rear cell. The
                      // corrected strip persists under the correction hash so an
                      // unrelated later retry reuses the approved selection.
                      const correctedPrompt = `${entry.prompt} ART DIRECTOR BANKING CORRECTION: ${guidance.slice(0, 320)}.`;
                      const correctedHash = imagePromptHash(correctedPrompt);
                      const cachedCorrected = assetWorkspace.load(
                        entry.role,
                        entry.promptVersion,
                        correctedHash,
                      );
                      if (cachedCorrected) {
                        buffers[k] = cachedCorrected;
                      } else {
                        const bankReference = await buildRacingBankEditReference(
                          await extractRacingNeutralCell(buffers[k]!),
                        );
                        const rivalIdentity = racingSpec.identity!;
                        const corrected = await correctRacingBankPoses({
                          strip: buffers[k]!,
                          vehicleName: slot.name,
                          artDirection: rivalIdentity.artDirection,
                          colors: racingSpec.palette.join(', '),
                          retryGuidance: guidance,
                          discipline: racingPackDiscipline(racingSpec),
                          traversal: rivalIdentity.traversal,
                          rolePrefix: `racing-craft-${slot.id}`,
                          generate: (prompt, pose, posedReference) =>
                            callImage({
                              role: `racing-craft-${slot.id}-bank-${pose}`,
                              label: `${slot.name} bank ${pose === 'bankLeft' ? 'left' : 'right'} correction`,
                              prompt,
                              reference: posedReference ?? bankReference,
                              size: '1024x1024',
                            }),
                          checkActive: throwIfSuspended,
                          validationFailure,
                        }).catch(racingAssetFailure);
                        await assetWorkspace.store(
                          entry.role,
                          corrected,
                          entry.promptVersion,
                          correctedHash,
                        );
                        buffers[k] = corrected;
                        await assetWorkspace.store(
                          entry.role,
                          corrected,
                          entry.promptVersion,
                          imagePromptHash(entry.prompt),
                        );
                      }
                      state.didBankRepair = true;
                      swapsOnly = false;
                      return;
                    }
                    // Image edits sometimes return correct opposite rolls under
                    // the wrong labels. One cell-order repair after the bank
                    // correction, then the same complete review; never mirror
                    // or waive a verdict.
                    buffers[k] = await swapRacingBankCells(buffers[k]!);
                    state.didSwap = true;
                  }),
                );
                // Each approval is already durable. Only remaining rejected
                // candidates are targets; all unchanged slots are references.
                decision = await reviewPending(
                  swapsOnly
                    ? 'Spark verifies the rival bank order'
                    : 'Spark re-reviews the corrected vehicles',
                );
              }
              if (!decision.accepted) {
                throw new PipelineError(
                  'image-invalid',
                  `Vehicle roster review rejected the pack${decision.retryGuidance ? `: ${decision.retryGuidance.slice(0, 200)}` : ''}`,
                  'building-assets',
                );
              }
              // Store the reviewed selection under its immutable design key;
              // arbitrary correction text must not force another repaint on retry.
              for (const [index, entry] of plan.rivalStrips.entries()) {
                await assetWorkspace.store(
                  entry.role,
                  buffers[index + 1]!,
                  `${entry.promptVersion}-approved-v1`,
                  imagePromptHash(entry.prompt),
                );
              }
              const motion = racingIdentity.traversal?.motion;
              const motionStatuses: RacingMotionRacerStatus[] = [];
              if (motion && motion !== 'static') {
                const entries = [plan.playerStrip, ...plan.rivalStrips];
                if (
                  entries.length !== RACING_BASE_ROLES.length ||
                  buffers.length !== entries.length
                )
                  throw new PipelineError(
                    'image-invalid',
                    'Locomotion requires one player and four approved rivals',
                    'building-assets',
                  );
                // Keep approved identity strips private before publishing expanded atlases.
                // A later unrelated retry restores both identity and animation without repainting.
                for (let i = 0; i < entries.length; i++) {
                  const entry = entries[i]!;
                  await assetWorkspace.storePrivate(
                    RACING_BASE_ROLES[i]!,
                    buffers[i]!,
                    `${entry.promptVersion}-approved-v1`,
                    imagePromptHash(entry.prompt, i === 0 ? await racingPlayerReferenceTask : undefined),
                  );
                }
                // Motion publishes as a 192x192 atlas. The on-foot player
                // requires a valid stride; other racers can retain the approved
                // neutral with a recorded optional-motion outcome. Required-art,
                // suspension, cancellation, storage, and programming errors
                // always fail the job.
                const outcomes = await settleAll(
                  entries.map(async (entry, i): Promise<RacingMotionRacerStatus> => {
                    const concept =
                      i === 0
                        ? racingPlayerArtConcept(racingSpec)
                        : racingIdentity.rivalCrafts[i - 1]!.vehicleConcept;
                    const prompt = buildRacingLocomotionPrompt(
                      racingIdentity.traversal!,
                      concept,
                      racingIdentity.artDirection,
                    );
                    const hash = imagePromptHash(prompt, buffers[i]!);
                    const version = `${RACING_LOCOMOTION_VERSION}-approved`;
                    const outcomeRole = RACING_MOTION_OUTCOME_ROLES[i]!;
                    const key = racingMotionTerminalKey(buffers[i]!, prompt);
                    const approved = assetWorkspace.loadPrivate(
                      RACING_MOTION_ROLES[i]!,
                      version,
                      hash,
                    );
                    if (approved) {
                      await assetWorkspace.store(entry.role, approved, version, hash);
                      return { racer: slots[i]!.id, status: 'animated' };
                    }
                    const terminal = parseRacingMotionTerminalOutcome(
                      assetWorkspace.loadMotionOutcome(outcomeRole),
                      key,
                    );
                    if (!terminal)
                      emit('building-assets', `Animating ${slots[i]!.name}: ${motion} cycle…`);
                    const reference = i === 0
                      ? playerStrip.presentationReference
                      : await buildRacingBankEditReference(await extractRacingNeutralCell(buffers[i]!));
                    const result = await generateOptionalRacingMotion({
                      base: buffers[i]!,
                      prompt,
                      motion,
                      terminal,
                      generate: async (candidatePrompt, correction) => {
                        const activeReference = correction
                          ? await buildRacingLocomotionReference(buffers[i]!)
                          : reference;
                        const candidate = await callImage({
                          role: `racing-motion-${i}`,
                          optional: true,
                          label: `${slots[i]!.name} locomotion${correction ? ' correction' : ''}`,
                          prompt: candidatePrompt,
                          reference: activeReference,
                          size: '1536x1024',
                        });
                        // Preserve the latest sheet for failed-job diagnosis;
                        // this private, unapproved version is never restored
                        // as an accepted atlas or copied into a ready game.
                        await assetWorkspace.storePrivate(
                          RACING_MOTION_ROLES[i]!,
                          candidate,
                          `${RACING_LOCOMOTION_VERSION}-candidate`,
                          imagePromptHash(candidatePrompt, activeReference),
                        );
                        return candidate;
                      },
                      ...(i === 0 && motion === 'stride' && racingIdentity.traversal?.rider === 'onFoot'
                        ? { generateFrames: async () => {
                            emit('building-assets', 'Recovering the player run cycle with six individual poses…');
                            // Cache each completed edit during durable resumes. A rejected
                            // set can be repainted on an explicit new job attempt.
                            return settleAll(Array.from({ length: 6 }, (_, frame) => {
                              const framePrompt = buildRacingStrideFramePrompt(concept, racingIdentity.artDirection, frame);
                              const frameKey = `racing-stride:${job.attempt}:${imagePromptHash(framePrompt, reference)}`;
                              return assetArtifacts.getOrCompute(frameKey, async () => {
                                const result = await callImage({
                                  role: `racing-motion-${i}-frame-${frame}`,
                                  optional: true,
                                  label: `${slots[i]!.name} run pose ${frame + 1}/6`,
                                  prompt: framePrompt,
                                  reference,
                                  size: '1024x1024',
                                });
                                return result;
                              });
                            }));
                          } }
                        : {}),
                      review: async (candidate) =>
                        mockImages
                          ? { accepted: true }
                          : callLlm(
                              'design',
                              {
                                system: racingLocomotionJudgePrompt(motion),
                                user: `Subject: ${concept}. Art direction: ${racingIdentity.artDirection}.`,
                                jsonSchema: racingLocomotionJudgeSchema,
                                maxTokens: 700,
                                timeoutMs: 120_000,
                              },
                              {
                                stage: 'building-assets',
                                label: `Spark reviews ${slots[i]!.name} locomotion`,
                                image: await buildRacingMotionReviewBoard(candidate),
                                reasoningEffort: 'low',
                                optional: true,
                              },
                            ),
                      checkActive: throwIfSuspended,
                      isCancelled: () => abort.signal.aborted,
                    });
                    if (result.kind === 'animated') {
                      await assetWorkspace.storePrivate(
                        RACING_MOTION_ROLES[i]!,
                        result.atlas,
                        version,
                        hash,
                      );
                      await assetWorkspace.store(entry.role, result.atlas, version, hash);
                      return { racer: slots[i]!.id, status: 'animated' };
                    } else {
                      if (i === 0 && motion === 'stride' && racingIdentity.traversal?.rider === 'onFoot') {
                        // Running is the player's core motion, not decoration. Never
                        // publish a frozen runner as a successfully animated game.
                        throw new PipelineError(
                          result.outcome === 'refused' ? 'image-content-policy' : 'image-invalid',
                          `Player run cycle did not pass; retry can recover it. ${result.reason}`,
                          'building-assets',
                        );
                      }
                      // Terminal for this base+prompt: an unrelated later retry
                      // restores the recorded outcome instead of rerolling it.
                      if (!terminal)
                        await assetWorkspace.storeMotionOutcome(
                          outcomeRole,
                          JSON.stringify({
                            version: RACING_LOCOMOTION_VERSION,
                            key,
                            outcome: result.outcome,
                            reason: result.reason,
                          }),
                        );
                      const neutral = await extractRacingNeutralCell(buffers[i]!).catch(
                        racingAssetFailure,
                      );
                      await assetWorkspace.store(entry.role, neutral, version, hash);
                      validationFailure(`racing-motion-${i}`);
                      emit(
                        'building-assets',
                        `${slots[i]!.name} keeps the approved rear (${result.outcome})`,
                      );
                      return { racer: slots[i]!.id, status: 'neutral', reason: result.reason };
                    }
                  }),
                );
                motionStatuses.push(...outcomes);
              }
              return motionStatuses;
            })();
            const [motionStatuses] = await settleAll([rosterTask, worldTask]);
            racingArtStatus = {
              mode: 'generated',
              attempted: true,
              ...(motionStatuses.length ? { motion: motionStatuses } : {}),
            };
            emit('building-assets', 'Finished the generated racing world and roster');
          })
        : Promise.resolve();

      let platformerBackdropArtStatus: GameMetaFile['platformerBackdropArt'] =
        spec.archetype === 'platformer'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated platformer backgrounds did not complete',
            }
          : undefined;
      const platformerBackdropTask =
        spec.archetype === 'platformer'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const generationStarted = Date.now();
              const generated = new Set<GeneratedPlatformerBackdrop>();
              const colors = spec.palette.join(', ');
              const sceneFor = (role: GeneratedPlatformerBackdrop) => {
                if (role === 'boss') {
                  return {
                    sceneName: 'Final arena',
                    sceneBeat: spec.meta.tagline,
                  };
                }
                const index = Number.parseInt(role.slice(-1), 10) - 1;
                return {
                  sceneName: spec.levels[index]?.name ?? `Level ${index + 1}`,
                  sceneBeat: spec.story.levelIntros[index] ?? spec.meta.tagline,
                };
              };

              emit('building-assets', 'Painting four panoramic level backgrounds in parallel…');
              await settleAll(
                GENERATED_PLATFORMER_BACKDROPS.map(async (role) => {
                  const scene = sceneFor(role);
                  const prompt = buildPlatformerBackdropPrompt({
                    gameTitle: spec.meta.title,
                    tagline: spec.meta.tagline,
                    role,
                    ...scene,
                    backdrop: spec.backdrop ?? 'the game-specific environment shown in the key art',
                    colors,
                  });
                  try {
                    await cachedGeneratedAsset({
                      role: PLATFORMER_BACKDROP_ASSET_ROLES[role],
                      promptVersion: PLATFORMER_BACKDROP_PROMPT_VERSION,
                      prompt,
                      label:
                        role === 'boss' ? 'Boss arena background' : `${scene.sceneName} background`,
                      reference: keyArt,
                      size: PLATFORMER_BACKDROP_ASPECT_HINT,
                      normalize: normalizePlatformerBackdrop,
                    });
                    generated.add(role);
                  } catch (error) {
                    throwIfSuspended(error);
                    if (
                      abort.signal.aborted ||
                      error instanceof GeneratedAssetStorageError ||
                      (error instanceof PipelineError && error.code === 'storage')
                    ) {
                      throw error;
                    }
                    validationFailure(`platformer-backdrop-${role}`);
                    emit(
                      'building-assets',
                      `${scene.sceneName} background was unavailable; keeping its procedural scene`,
                    );
                  }
                }),
              );

              const generatedRoles = GENERATED_PLATFORMER_BACKDROPS.filter((role) =>
                generated.has(role),
              );
              const missingRoles = GENERATED_PLATFORMER_BACKDROPS.filter(
                (role) => !generated.has(role),
              );
              if (missingRoles.length === 0) {
                platformerBackdropArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  generatedRoles,
                };
                emit('building-assets', 'Finished the panoramic platformer backgrounds');
                return;
              }

              const reason = `No valid generated background for ${missingRoles.join(', ')}`;
              platformerBackdropArtStatus = {
                mode: generatedRoles.length ? 'partial' : 'procedural',
                attempted: true,
                ...(generatedRoles.length ? { generatedRoles } : {}),
                reason,
              };
              recordEarlyRepairEvent(
                'entities',
                'platformer-backdrop-art-fallback',
                missingRoles.map((role) => ({
                  code: 'PLATFORMER_BACKDROP_ART_FALLBACK',
                  path: `/assets/platformer-backdrop/${role}`,
                  message: reason,
                })),
                [],
                generationStarted,
                'downgraded',
              );
            })
          : Promise.resolve();

      let hshooterBackdropArtStatus: GameMetaFile['hshooterBackdropArt'] =
        spec.archetype === 'hshooter'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated H-scroll backgrounds did not complete',
            }
          : undefined;
      const hshooterBackdropTask =
        spec.archetype === 'hshooter'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const generationStarted = Date.now();
              const generated = new Set<GeneratedHShooterBackdrop>();
              const colors = spec.palette.join(', ');
              const sceneFor = (role: GeneratedHShooterBackdrop) => {
                if (role === 'boss') {
                  return {
                    sceneName: 'Final flight arena',
                    sceneBeat: spec.meta.tagline,
                  };
                }
                const index = Number.parseInt(role.slice(-1), 10) - 1;
                return {
                  sceneName: spec.levels[index]?.name ?? `Flight stage ${index + 1}`,
                  sceneBeat: spec.story.levelIntros[index] ?? spec.meta.tagline,
                };
              };

              emit('building-assets', 'Painting four panoramic H-scroll backgrounds in parallel…');
              await settleAll(
                GENERATED_HSHOOTER_BACKDROPS.map(async (role) => {
                  const scene = sceneFor(role);
                  const prompt = buildHShooterBackdropPrompt({
                    gameTitle: spec.meta.title,
                    tagline: spec.meta.tagline,
                    role,
                    ...scene,
                    backdrop: spec.backdrop ?? 'the game-specific environment shown in the key art',
                    colors,
                  });
                  try {
                    await cachedGeneratedAsset({
                      role: HSHOOTER_BACKDROP_ASSET_ROLES[role],
                      promptVersion: HSHOOTER_BACKDROP_PROMPT_VERSION,
                      prompt,
                      label:
                        role === 'boss'
                          ? 'H-scroll boss arena background'
                          : `${scene.sceneName} background`,
                      reference: keyArt,
                      size: HSHOOTER_BACKDROP_ASPECT_HINT,
                      normalize: normalizeHShooterBackdrop,
                    });
                    generated.add(role);
                  } catch (error) {
                    throwIfSuspended(error);
                    if (
                      abort.signal.aborted ||
                      error instanceof GeneratedAssetStorageError ||
                      (error instanceof PipelineError &&
                        error.code !== 'image-invalid' &&
                        !isOptionalGeneratedArtProviderFailure(error))
                    ) {
                      throw error;
                    }
                    validationFailure(`hshooter-backdrop-${role}`);
                    emit(
                      'building-assets',
                      `${scene.sceneName} background was unavailable; keeping its procedural scene`,
                    );
                  }
                }),
              );

              const generatedRoles = GENERATED_HSHOOTER_BACKDROPS.filter((role) =>
                generated.has(role),
              );
              const missingRoles = GENERATED_HSHOOTER_BACKDROPS.filter(
                (role) => !generated.has(role),
              );
              if (missingRoles.length === 0) {
                hshooterBackdropArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  generatedRoles,
                };
                emit('building-assets', 'Finished the panoramic H-scroll backgrounds');
                return;
              }

              const reason = `No valid generated background for ${missingRoles.join(', ')}`;
              hshooterBackdropArtStatus = {
                mode: generatedRoles.length ? 'partial' : 'procedural',
                attempted: true,
                ...(generatedRoles.length ? { generatedRoles } : {}),
                reason,
              };
              recordEarlyRepairEvent(
                'entities',
                'hshooter-backdrop-art-fallback',
                missingRoles.map((role) => ({
                  code: 'HSHOOTER_BACKDROP_ART_FALLBACK',
                  path: `/assets/hshooter-backdrop/${role}`,
                  message: reason,
                })),
                [],
                generationStarted,
                'downgraded',
              );
            })
          : Promise.resolve();

      let shooterBackdropArtStatus: GameMetaFile['shooterBackdropArt'] =
        spec.archetype === 'shooter'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated vertical-shooter backgrounds did not complete',
            }
          : undefined;
      const shooterBackdropTask =
        spec.archetype === 'shooter'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const generationStarted = Date.now();
              const generated = new Set<GeneratedShooterBackdrop>();
              const colors = spec.palette.join(', ');
              const sceneFor = (role: GeneratedShooterBackdrop) => {
                if (role === 'boss') {
                  return { sceneName: 'Final flyover arena', sceneBeat: spec.meta.tagline };
                }
                const index = Number.parseInt(role.slice(-1), 10) - 1;
                return {
                  sceneName: spec.levels[index]?.name ?? `Flight stage ${index + 1}`,
                  sceneBeat: spec.story.levelIntros[index] ?? spec.meta.tagline,
                };
              };

              emit('building-assets', 'Painting four vertical flyover backgrounds in parallel…');
              await settleAll(
                GENERATED_SHOOTER_BACKDROPS.map(async (role) => {
                  const scene = sceneFor(role);
                  const prompt = buildShooterBackdropPrompt({
                    gameTitle: spec.meta.title,
                    tagline: spec.meta.tagline,
                    role,
                    ...scene,
                    backdrop: spec.backdrop ?? 'the game-specific environment shown in the key art',
                    colors,
                  });
                  try {
                    await cachedGeneratedAsset({
                      role: SHOOTER_BACKDROP_ASSET_ROLES[role],
                      promptVersion: SHOOTER_BACKDROP_PROMPT_VERSION,
                      prompt,
                      label:
                        role === 'boss'
                          ? 'Vertical shooter boss flyover background'
                          : `${scene.sceneName} flyover background`,
                      reference: keyArt,
                      size: SHOOTER_BACKDROP_ASPECT_HINT,
                      normalize: normalizeShooterBackdrop,
                    });
                    generated.add(role);
                  } catch (error) {
                    throwIfSuspended(error);
                    if (
                      abort.signal.aborted ||
                      error instanceof GeneratedAssetStorageError ||
                      (error instanceof PipelineError &&
                        error.code !== 'image-invalid' &&
                        !isOptionalGeneratedArtProviderFailure(error))
                    ) {
                      throw error;
                    }
                    validationFailure(`shooter-backdrop-${role}`);
                    emit(
                      'building-assets',
                      `${scene.sceneName} flyover was unavailable; keeping procedural depth`,
                    );
                  }
                }),
              );

              const generatedRoles = GENERATED_SHOOTER_BACKDROPS.filter((role) =>
                generated.has(role),
              );
              const missingRoles = GENERATED_SHOOTER_BACKDROPS.filter(
                (role) => !generated.has(role),
              );
              if (missingRoles.length === 0) {
                shooterBackdropArtStatus = { mode: 'generated', attempted: true, generatedRoles };
                emit('building-assets', 'Finished the vertical flyover backgrounds');
                return;
              }
              const reason = `No valid generated background for ${missingRoles.join(', ')}`;
              shooterBackdropArtStatus = {
                mode: generatedRoles.length ? 'partial' : 'procedural',
                attempted: true,
                ...(generatedRoles.length ? { generatedRoles } : {}),
                reason,
              };
              recordEarlyRepairEvent(
                'entities',
                'shooter-backdrop-art-fallback',
                missingRoles.map((role) => ({
                  code: 'SHOOTER_BACKDROP_ART_FALLBACK',
                  path: `/assets/shooter-backdrop/${role}`,
                  message: reason,
                })),
                [],
                generationStarted,
                'downgraded',
              );
            })
          : Promise.resolve();

      let adventureRoomPlateArtStatus: GameMetaFile['adventureRoomPlateArt'] =
        spec.archetype === 'adventure'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated Adventure room surfaces did not complete',
            }
          : undefined;
      const adventureRoomPlateTask =
        spec.archetype === 'adventure'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const generationStarted = Date.now();
              try {
                emit('building-assets', 'Painting the Adventure room surfaces…');
                await cachedGeneratedAsset({
                  role: ADVENTURE_ROOM_PLATE_ROLE,
                  promptVersion: ADVENTURE_ROOM_PLATE_PROMPT_VERSION,
                  prompt: buildAdventureRoomPlatePrompt({
                    gameTitle: spec.meta.title,
                    tagline: spec.meta.tagline,
                    backdrop: spec.backdrop ?? 'the game-specific environment shown in the key art',
                    colors: spec.palette.join(', '),
                  }),
                  label: 'Adventure room-surface atlas',
                  reference: keyArt,
                  size: ADVENTURE_ROOM_PLATE_ASPECT_HINT,
                  normalize: normalizeAdventureRoomPlates,
                });
                adventureRoomPlateArtStatus = { mode: 'generated', attempted: true };
                emit('building-assets', 'Finished the Adventure room surfaces');
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof GeneratedAssetStorageError ||
                  (error instanceof PipelineError &&
                    error.code !== 'image-invalid' &&
                    !isOptionalGeneratedArtProviderFailure(error))
                ) {
                  throw error;
                }
                await assetWorkspace.discard([ADVENTURE_ROOM_PLATE_ROLE]);
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated Adventure room surfaces failed validation';
                adventureRoomPlateArtStatus = {
                  mode: 'procedural',
                  attempted: true,
                  reason,
                };
                recordEarlyRepairEvent(
                  'entities',
                  'adventure-room-plate-art-fallback',
                  [
                    {
                      code: 'ADVENTURE_ROOM_PLATE_ART_FALLBACK',
                      path: '/assets/adventure-room-plates',
                      message: reason,
                    },
                  ],
                  [],
                  generationStarted,
                  'downgraded',
                );
                emit(
                  'building-assets',
                  `Adventure room surfaces were unavailable; using the compact floor (${reason.slice(0, 120)})`,
                );
              }
            })
          : Promise.resolve();

      let adventureEnemyArtStatus: GameMetaFile['adventureEnemyArt'];
      const adventureEnemyTask =
        spec.archetype === 'adventure'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              const fallbackConcepts: Record<GeneratedAdventureEnemy, string> = {
                walker: 'a grounded patrol enemy native to this world',
                flyer: 'an airborne nuisance native to this world',
                shooter: 'a premise-specific ranged attacker',
                chaser: 'a fast aggressive pursuer',
                bruiser: 'a large armored or physically powerful elite enemy',
              };
              const concepts = Object.fromEntries(
                GENERATED_ADVENTURE_ENEMIES.map((role) => [
                  role,
                  design.cast.find((member) => member.role === role)?.concept ??
                    fallbackConcepts[role],
                ]),
              ) as Record<GeneratedAdventureEnemy, string>;
              const boardPrompt = buildAdventureEnemyBoardPrompt({
                gameTitle: spec.meta.title,
                tagline: spec.meta.tagline,
                concepts,
                colors,
              });
              const pipelineFingerprint = JSON.stringify({
                promptVersions: {
                  board: ADVENTURE_ENEMY_BOARD_PROMPT_VERSION,
                  judge: ADVENTURE_ENEMY_JUDGE_PROMPT_VERSION,
                },
                concepts,
                colors,
              });
              const pipelineSha = imagePromptHash(pipelineFingerprint, keyArt);
              const cached = assetWorkspace.load(
                ADVENTURE_ENEMY_ATLAS_ROLE,
                ADVENTURE_ENEMY_PIPELINE_PROMPT_VERSION,
                pipelineSha,
              );
              if (cached) {
                try {
                  await validateGeneratedAdventureEnemyAtlas(cached);
                  adventureEnemyArtStatus = {
                    mode: 'generated',
                    attempted: true,
                    roles: [...GENERATED_ADVENTURE_ENEMIES],
                  };
                  emit('building-assets', 'Restored the generated Adventure enemy cast');
                  return;
                } catch {
                  await assetWorkspace.discard([ADVENTURE_ENEMY_ATLAS_ROLE]);
                }
              }

              try {
                let rawBoard = assetWorkspace.loadPrivate(
                  'adventureEnemyBoard',
                  ADVENTURE_ENEMY_BOARD_PROMPT_VERSION,
                  pipelineSha,
                );
                if (rawBoard) {
                  emit('building-assets', 'Resuming the Adventure enemy cast review');
                } else {
                  emit(
                    'building-assets',
                    'Painting two candidates for all five Adventure enemies in one board…',
                  );
                  rawBoard = await callImage({
                    role: 'adventure-enemy-board',
                    label: 'Adventure enemy candidate board',
                    prompt: boardPrompt,
                    reference: keyArt,
                    size: '1024x1024',
                  });
                  await assetWorkspace.storePrivate(
                    'adventureEnemyBoard',
                    rawBoard,
                    ADVENTURE_ENEMY_BOARD_PROMPT_VERSION,
                    pipelineSha,
                  );
                }

                const split = await splitGeneratedAdventureEnemyBoard(rawBoard);
                split.failures.forEach(({ id }) =>
                  validationFailure(`adventure-enemy-board-${id}`),
                );
                const missingRoles = GENERATED_ADVENTURE_ENEMIES.filter(
                  (role) => !split.candidates.some((candidate) => candidate.role === role),
                );
                if (missingRoles.length) {
                  await assetWorkspace.discardPrivate('adventureEnemyBoard');
                  throw new PipelineError(
                    'image-invalid',
                    `Adventure enemy board had no usable candidate for ${missingRoles.join(', ')}`,
                    'building-assets',
                  );
                }

                const descriptors = split.candidates.map(({ id, role }) => ({ id, role }));
                const reviewBoard = await buildAdventureEnemyJudgeBoard({
                  keyArt,
                  candidates: split.candidates,
                });
                const mockDecision = {
                  candidateReviews: descriptors.map(({ id, role }) => ({
                    id,
                    role,
                    scores: {
                      conceptMatch: 5,
                      castCohesion: 5,
                      silhouette: 5,
                      roleReadability: 5,
                      technical: 5,
                    },
                    issues: [],
                    summary: 'Mock coherent Adventure enemy candidate.',
                  })),
                  selections: GENERATED_ADVENTURE_ENEMIES.map((role) => ({
                    role,
                    candidateId: descriptors.find((candidate) => candidate.role === role)!.id,
                    confidence: 1,
                    rationale: 'Mock selection.',
                  })),
                  castSummary: 'Mock coherent cast.',
                };
                let rawDecision: unknown = mockDecision;
                if (!mockImages) {
                  rawDecision = await callLlm(
                    'design',
                    {
                      ...buildAdventureEnemyJudgePrompt(descriptors, concepts),
                      jsonSchema: buildAdventureEnemyJudgeSchema(descriptors),
                      maxTokens: 2800,
                      timeoutMs: 120_000,
                    },
                    {
                      stage: 'building-assets',
                      label: 'Spark selected the Adventure enemy cast',
                      image: reviewBoard,
                      reasoningEffort: 'low',
                    },
                  );
                }
                const decision = normalizeAdventureEnemyJudgeDecision(rawDecision, descriptors);
                const selected = Object.fromEntries(
                  GENERATED_ADVENTURE_ENEMIES.map((role) => {
                    const requested = decision.selections.find(
                      (selection) => selection.role === role,
                    )?.candidateId;
                    const id =
                      requested ?? bestAdventureEnemyCandidateId(role, decision) ?? undefined;
                    const candidate = split.candidates.find(
                      (entry) => entry.role === role && entry.id === id,
                    );
                    if (!candidate) {
                      throw new Error(`Spark did not select a valid ${role} candidate`);
                    }
                    return [role, candidate.png];
                  }),
                ) as Record<GeneratedAdventureEnemy, Buffer>;
                const atlas = await buildGeneratedAdventureEnemyAtlas(selected);
                await assetWorkspace.store(
                  ADVENTURE_ENEMY_ATLAS_ROLE,
                  atlas,
                  ADVENTURE_ENEMY_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                await assetWorkspace.discardPrivate('adventureEnemyBoard');
                adventureEnemyArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  roles: [...GENERATED_ADVENTURE_ENEMIES],
                };
                emit('building-assets', 'Finished the generated Adventure enemy cast');
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof PipelineError ||
                  error instanceof GeneratedAssetStorageError
                ) {
                  throw error;
                }
                throw new PipelineError(
                  'image-invalid',
                  `Adventure enemy cast failed validation: ${error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)}`,
                  'building-assets',
                );
              }
            })
          : Promise.resolve();

      let adventureObjectArtStatus: GameMetaFile['adventureObjectArt'];
      const adventureObjectTask =
        spec.archetype === 'adventure'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              const promptOptions: AdventureObjectPromptOptions = {
                gameTitle: spec.meta.title,
                tagline: spec.meta.tagline,
                keyConcept:
                  design.cast.find((member) => member.role === 'key')?.concept ??
                  `a signature gate-opening relic or credential specific to ${spec.meta.title}`,
                itemName: spec.combatKit.secondary.name,
                itemConcept: spec.combatKit.secondary.visualConcept,
                npcConcept:
                  design.cast.find((member) => member.role === 'npc')?.concept ??
                  'a friendly guide, keeper, survivor, technician, or witness native to this world',
                secondaryBehavior: spec.combatKit.secondary.behavior,
                colors,
              };
              const boardPrompt = buildAdventureObjectBoardPrompt(promptOptions);
              const pipelineFingerprint = JSON.stringify({
                promptVersions: {
                  board: ADVENTURE_OBJECT_BOARD_PROMPT_VERSION,
                  judge: ADVENTURE_OBJECT_JUDGE_PROMPT_VERSION,
                },
                promptOptions,
              });
              const pipelineSha = imagePromptHash(pipelineFingerprint, keyArt);
              const cached = assetWorkspace.load(
                ADVENTURE_OBJECT_ATLAS_ROLE,
                ADVENTURE_OBJECT_PIPELINE_PROMPT_VERSION,
                pipelineSha,
              );
              if (cached) {
                try {
                  await validateGeneratedAdventureObjectAtlas(cached);
                  adventureObjectArtStatus = {
                    mode: 'generated',
                    attempted: true,
                    roles: [...GENERATED_ADVENTURE_OBJECTS],
                  };
                  emit('building-assets', 'Restored the themed Adventure gameplay objects');
                  return;
                } catch {
                  await assetWorkspace.discard([ADVENTURE_OBJECT_ATLAS_ROLE]);
                }
              }

              try {
                let rawBoard = assetWorkspace.loadPrivate(
                  'adventureObjectBoard',
                  ADVENTURE_OBJECT_BOARD_PROMPT_VERSION,
                  pipelineSha,
                );
                if (rawBoard) {
                  emit('building-assets', 'Resuming the Adventure gameplay-object review');
                } else {
                  emit(
                    'building-assets',
                    'Painting themed keys, equipment, NPCs, fixtures, and active-item candidates in one board…',
                  );
                  rawBoard = await callImage({
                    role: 'adventure-object-board',
                    label: 'Adventure themed gameplay-object board',
                    prompt: boardPrompt,
                    reference: keyArt,
                    size: '1024x1024',
                  });
                  await assetWorkspace.storePrivate(
                    'adventureObjectBoard',
                    rawBoard,
                    ADVENTURE_OBJECT_BOARD_PROMPT_VERSION,
                    pipelineSha,
                  );
                }

                const split = await splitGeneratedAdventureObjectBoard(rawBoard);
                split.failures.forEach(({ id }) =>
                  validationFailure(`adventure-object-board-${id}`),
                );
                const missingRoles = GENERATED_ADVENTURE_OBJECTS.filter(
                  (role) => !split.candidates.some((candidate) => candidate.role === role),
                );
                if (missingRoles.length) {
                  await assetWorkspace.discardPrivate('adventureObjectBoard');
                  throw new PipelineError(
                    'image-invalid',
                    `Adventure gameplay-object board had no usable candidate for ${missingRoles.join(', ')}`,
                    'building-assets',
                  );
                }

                const descriptors = split.candidates.map(({ id, role }) => ({ id, role }));
                const reviewBoard = await buildAdventureObjectJudgeBoard({
                  keyArt,
                  candidates: split.candidates,
                });
                const mockDecision = {
                  candidateReviews: descriptors.map(({ id, role }) => ({
                    id,
                    role,
                    scores: {
                      conceptMatch: 5,
                      worldStyle: 5,
                      silhouette: 5,
                      gameplayReadability: 5,
                      technical: 5,
                    },
                    issues: [],
                    summary: 'Mock themed Adventure gameplay object.',
                  })),
                  selections: GENERATED_ADVENTURE_OBJECTS.map((role) => ({
                    role,
                    candidateId: descriptors.find((candidate) => candidate.role === role)!.id,
                    confidence: 1,
                    rationale: 'Mock selection.',
                  })),
                  setSummary: 'Mock coherent gameplay-object set.',
                };
                let rawDecision: unknown = mockDecision;
                if (!mockImages) {
                  rawDecision = await callLlm(
                    'design',
                    {
                      ...buildAdventureObjectJudgePrompt(descriptors, promptOptions),
                      jsonSchema: buildAdventureObjectJudgeSchema(descriptors),
                      maxTokens: 3200,
                      timeoutMs: 120_000,
                    },
                    {
                      stage: 'building-assets',
                      label: 'Spark selected the themed Adventure gameplay objects',
                      image: reviewBoard,
                      reasoningEffort: 'low',
                    },
                  );
                }
                const decision = normalizeAdventureObjectJudgeDecision(rawDecision, descriptors);
                const selected = Object.fromEntries(
                  GENERATED_ADVENTURE_OBJECTS.map((role) => {
                    const requested = decision.selections.find(
                      (selection) => selection.role === role,
                    )?.candidateId;
                    const id =
                      requested ?? bestAdventureObjectCandidateId(role, decision) ?? undefined;
                    const candidate = split.candidates.find(
                      (entry) => entry.role === role && entry.id === id,
                    );
                    if (!candidate) {
                      throw new Error(`Spark did not select a valid ${role} candidate`);
                    }
                    return [role, candidate.png];
                  }),
                ) as Record<GeneratedAdventureObject, Buffer>;
                const atlas = await buildGeneratedAdventureObjectAtlas(selected);
                await assetWorkspace.store(
                  ADVENTURE_OBJECT_ATLAS_ROLE,
                  atlas,
                  ADVENTURE_OBJECT_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                await assetWorkspace.discardPrivate('adventureObjectBoard');
                adventureObjectArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  roles: [...GENERATED_ADVENTURE_OBJECTS],
                };
                emit('building-assets', 'Finished the themed Adventure gameplay objects');
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof PipelineError ||
                  error instanceof GeneratedAssetStorageError
                ) {
                  throw error;
                }
                throw new PipelineError(
                  'image-invalid',
                  `Adventure gameplay-object set failed validation: ${error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)}`,
                  'building-assets',
                );
              }
            })
          : Promise.resolve();

      let adventureBossArtStatus: GameMetaFile['adventureBossArt'] =
        spec.archetype === 'adventure'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated Adventure boss art did not complete',
            }
          : undefined;
      const adventureBossTask =
        spec.archetype === 'adventure'
          ? storyAssets.boss.then(async (storyBoss): Promise<void> => {
              const generationStarted = Date.now();
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              try {
                const pipelineFingerprint = JSON.stringify({
                  promptVersions: {
                    board: ADVENTURE_BOSS_PROMPT_VERSION,
                    retry: ADVENTURE_BOSS_RETRY_PROMPT_VERSION,
                    judge: ADVENTURE_BOSS_JUDGE_PROMPT_VERSION,
                  },
                  bossName: spec.boss.name,
                  bossIntro: spec.story.bossIntro,
                  colors,
                });
                const pipelineSha = imagePromptHash(pipelineFingerprint, storyBoss);
                const cached = assetWorkspace.load(
                  ADVENTURE_BOSS_ROLE,
                  ADVENTURE_BOSS_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                if (cached) {
                  adventureBossArtStatus = { mode: 'generated', attempted: true };
                  emit('building-assets', 'Restored the selected Adventure boss');
                  return;
                }

                emit('building-assets', 'Painting four Adventure boss candidates in one board…');
                const rawBoard = await callImage({
                  role: 'adventure-boss-board',
                  label: 'Adventure boss candidate board',
                  prompt: buildAdventureBossBoardPrompt({
                    bossName: spec.boss.name,
                    bossIntro: spec.story.bossIntro,
                    colors,
                  }),
                  reference: storyBoss,
                  size: '1024x1024',
                });
                let candidates: AdventureBossCandidate[] = [];
                let failures: Awaited<
                  ReturnType<typeof splitGeneratedAdventureBossBoard>
                >['failures'] = [];
                try {
                  const split = await splitGeneratedAdventureBossBoard(rawBoard);
                  candidates = split.candidates;
                  failures = split.failures;
                } catch (error) {
                  throwIfSuspended(error);
                  failures = [
                    {
                      id: 'B1',
                      reason: error instanceof Error ? error.message : String(error),
                    },
                  ];
                }
                failures.forEach(({ id }) => validationFailure(`adventure-boss-board-${id}`));

                if (candidates.length === 0) {
                  emit(
                    'building-assets',
                    'The Adventure boss board had no usable cells; repainting one isolated candidate…',
                  );
                  const retryRaw = await callImage({
                    role: 'adventure-boss-retry',
                    label: 'Adventure boss isolated retry',
                    prompt: buildAdventureBossRetryPrompt({
                      bossName: spec.boss.name,
                      bossIntro: spec.story.bossIntro,
                      colors,
                      failures,
                    }),
                    reference: storyBoss,
                    size: '1024x1024',
                  });
                  try {
                    let processed;
                    try {
                      processed = await processGeneratedAdventureBoss(retryRaw);
                    } catch (initialError) {
                      throwIfSuspended(initialError);
                      const recovery = await recoverGeneratedPlatformerGreenPanel(retryRaw);
                      if (!recovery.recovered) throw initialError;
                      processed = await processGeneratedAdventureBoss(recovery.image);
                    }
                    candidates.push({ id: 'R1', png: processed.png, metrics: processed.metrics });
                  } catch (error) {
                    throwIfSuspended(error);
                    validationFailure('adventure-boss-retry');
                    throw new Error(
                      `isolated Adventure boss retry failed validation: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                }

                const descriptors = candidates.map(({ id }) => ({ id }));
                const reviewBoard = await buildAdventureBossJudgeBoard({
                  storyBoss,
                  candidates,
                });
                const judgePrompt = buildAdventureBossJudgePrompt(descriptors);
                const mockDecision = {
                  candidateReviews: descriptors.map(({ id }) => ({
                    id,
                    scores: {
                      villainMatch: 5,
                      silhouette: 5,
                      camera: 5,
                      technical: 5,
                      gameplayReadability: 5,
                    },
                    issues: [],
                    summary: 'Mock story-faithful Adventure boss candidate.',
                  })),
                  selection: {
                    candidateId: descriptors[0]!.id,
                    confidence: 1,
                    rationale: 'Mock selection.',
                  },
                };
                let rawDecision: unknown = mockDecision;
                if (!mockImages) {
                  try {
                    rawDecision = await callLlm(
                      'design',
                      {
                        ...judgePrompt,
                        jsonSchema: buildAdventureBossJudgeSchema(descriptors),
                        maxTokens: 1800,
                        timeoutMs: 120_000,
                      },
                      {
                        stage: 'building-assets',
                        label: 'Spark selected the Adventure finale boss',
                        image: reviewBoard,
                        reasoningEffort: 'low',
                      },
                    );
                  } catch (error) {
                    throwIfSuspended(error);
                    if (abort.signal.aborted) throw error;
                    throw new Error(
                      `Adventure boss art review failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                }
                const decision = normalizeAdventureBossJudgeDecision(rawDecision, descriptors);
                const selectedId =
                  decision.selection.candidateId || bestAdventureBossCandidateId(decision);
                const selected = candidates.find(({ id }) => id === selectedId) ?? candidates[0]!;
                await assetWorkspace.store(
                  ADVENTURE_BOSS_ROLE,
                  selected.png,
                  ADVENTURE_BOSS_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                adventureBossArtStatus = { mode: 'generated', attempted: true };
                emit(
                  'building-assets',
                  `Spark selected ${selected.id} as the Adventure finale boss`,
                );
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof GeneratedAssetStorageError ||
                  (error instanceof PipelineError && !isOptionalGeneratedArtProviderFailure(error))
                ) {
                  throw error;
                }
                await assetWorkspace.discard([ADVENTURE_BOSS_ROLE]);
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated Adventure boss failed validation';
                adventureBossArtStatus = { mode: 'procedural', attempted: true, reason };
                recordEarlyRepairEvent(
                  'entities',
                  'adventure-boss-art-fallback',
                  [
                    {
                      code: 'ADVENTURE_BOSS_ART_FALLBACK',
                      path: '/assets/adventure-boss',
                      message: reason,
                    },
                  ],
                  [],
                  generationStarted,
                  'downgraded',
                );
                emit(
                  'building-assets',
                  `Generated Adventure boss was unavailable; using the library boss (${reason.slice(0, 120)})`,
                );
              }
            })
          : Promise.resolve();

      let hshooterBossArtStatus: GameMetaFile['hshooterBossArt'];
      const hshooterBossTask =
        spec.archetype === 'hshooter'
          ? storyAssets.boss.then(async (storyBoss): Promise<void> => {
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              try {
                const pipelineFingerprint = JSON.stringify({
                  promptVersions: {
                    candidate: HSHOOTER_BOSS_PROMPT_VERSION,
                    judge: HSHOOTER_BOSS_JUDGE_PROMPT_VERSION,
                  },
                  bossName: spec.boss.name,
                  bossIntro: spec.story.bossIntro,
                  colors,
                });
                const pipelineSha = imagePromptHash(pipelineFingerprint, storyBoss);
                const cached = assetWorkspace.load(
                  'hshooterBoss',
                  HSHOOTER_BOSS_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                if (cached) {
                  hshooterBossArtStatus = { mode: 'generated', attempted: true };
                  emit('building-assets', 'Restored the selected H-scroll boss');
                  return;
                }

                interface BossCandidate {
                  id: string;
                  png: Buffer;
                }
                const generateBossCandidateUncached = async (
                  index: number,
                  retryGuidance = '',
                ): Promise<BossCandidate | null> => {
                  const id = `B${index}`;
                  let raw: Buffer;
                  try {
                    raw = await callImage({
                      role: `hshooter-boss-${id}`,
                      label: `H-scroll boss candidate ${id}`,
                      prompt: buildHShooterBossCandidatePrompt({
                        bossName: spec.boss.name,
                        bossIntro: spec.story.bossIntro,
                        colors,
                        candidateId: id,
                        ...(retryGuidance ? { retryGuidance } : {}),
                      }),
                      reference: storyBoss,
                      size: '1536x1024',
                    });
                  } catch (error) {
                    throwIfSuspended(error);
                    if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                    validationFailure(`hshooter-boss-${id}`);
                    emit(
                      'building-assets',
                      `H-scroll boss candidate ${id} was unavailable; continuing…`,
                    );
                    return null;
                  }
                  try {
                    const processed = await processGeneratedHShooterBoss(raw);
                    return { id, png: processed.png };
                  } catch {
                    validationFailure(`hshooter-boss-${id}`);
                    emit(
                      'building-assets',
                      `H-scroll boss candidate ${id} failed local sprite validation`,
                    );
                    return null;
                  }
                };
                const generateBossCandidate = (
                  ...args: Parameters<typeof generateBossCandidateUncached>
                ) =>
                  assetArtifacts.getOrCompute(
                    JSON.stringify(['hshooter-boss-candidate-v1', job.attempt, pipelineSha, args]),
                    () => generateBossCandidateUncached(...args),
                  );
                emit('building-assets', 'Painting three H-scroll boss candidates…');
                let candidates = (
                  await settleAll([1, 2, 3].map((index) => generateBossCandidate(index)))
                ).filter((candidate): candidate is BossCandidate => candidate !== null);
                if (candidates.length === 0) {
                  emit(
                    'building-assets',
                    'The first boss pool was mechanically unusable; painting three replacements…',
                  );
                  candidates = (
                    await settleAll(
                      [4, 5, 6].map((index) =>
                        generateBossCandidate(
                          index,
                          'Return one complete, uncropped, broad LEFT-facing boss with a single cohesive body and a perfectly flat green background',
                        ),
                      ),
                    )
                  ).filter((candidate): candidate is BossCandidate => candidate !== null);
                }
                if (candidates.length === 0) {
                  throw new Error(
                    'both generated H-scroll boss candidate pools failed mechanical validation',
                  );
                }

                const descriptors: PlatformerBossCandidateDescriptor[] = candidates.map(
                  ({ id }) => ({ id }),
                );
                const board = await buildPlatformerBossJudgeBoard({
                  storyBoss,
                  candidates: candidates.map(({ id, png: processed }) => ({ id, processed })),
                });
                const mockDecision = {
                  candidateReviews: descriptors.map(({ id }) => ({
                    id,
                    scores: {
                      villainMatch: 5,
                      silhouette: 5,
                      pose: 5,
                      technical: 5,
                      gameplayReadability: 5,
                    },
                    issues: [],
                    summary: 'Mock story-faithful H-scroll boss candidate.',
                  })),
                  selection: {
                    candidateId: descriptors[0]!.id,
                    confidence: 1,
                    rationale: 'Mock selection.',
                  },
                };
                let rawDecision: unknown = mockDecision;
                if (!mockImages) {
                  try {
                    rawDecision = await callLlm(
                      'design',
                      {
                        ...buildHShooterBossJudgePrompt(descriptors.map(({ id }) => id)),
                        jsonSchema: buildPlatformerBossJudgeSchema(descriptors),
                        maxTokens: 2200,
                        timeoutMs: 120_000,
                      },
                      {
                        stage: 'building-assets',
                        label: 'Spark selected the signature H-scroll boss',
                        image: board,
                        reasoningEffort: 'low',
                      },
                    );
                  } catch (error) {
                    throwIfSuspended(error);
                    if (abort.signal.aborted) throw error;
                    throw new Error(
                      `H-scroll boss art review failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                }
                const decision = normalizePlatformerBossJudgeDecision(rawDecision, descriptors);
                const selectedId =
                  decision.selection.candidateId || bestPlatformerBossCandidateId(decision);
                const selected = candidates.find(({ id }) => id === selectedId) ?? candidates[0]!;
                await assetWorkspace.store(
                  'hshooterBoss',
                  selected.png,
                  HSHOOTER_BOSS_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                hshooterBossArtStatus = { mode: 'generated', attempted: true };
                emit('building-assets', `Spark selected ${selected.id} as the H-scroll boss`);
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof GeneratedAssetStorageError ||
                  (error instanceof PipelineError && !isOptionalGeneratedArtProviderFailure(error))
                ) {
                  throw error;
                }
                await assetWorkspace.discard(['hshooterBoss']);
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated H-scroll boss failed validation';
                emit(
                  'building-assets',
                  `Required H-scroll boss art did not pass; stopping generation (${reason.slice(0, 120)})`,
                );
                throw new PipelineError(
                  'image-invalid',
                  `Required H-scroll boss art failed: ${reason}`,
                  'building-assets',
                );
              }
            })
          : Promise.resolve();

      let hshooterEnemyArtStatus: GameMetaFile['hshooterEnemyArt'];
      const hshooterEnemyTask =
        spec.archetype === 'hshooter'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              const fallbackConcepts: Record<GeneratedHShooterEnemy, string> = {
                popcorn: 'a small disposable scout native to the hostile faction',
                weaver: 'a slim agile enemy that darts through the flight lane',
                tank: 'a broad slow armored ordinary war machine or creature',
                turret: 'a surface-mounted gun native to the stage architecture',
                kamikaze: 'a pointed high-speed impact attacker',
              };
              const concepts = Object.fromEntries(
                GENERATED_HSHOOTER_ENEMIES.map((role) => [
                  role,
                  design.cast.find((member) => member.role === role)?.concept ??
                    fallbackConcepts[role],
                ]),
              ) as Record<GeneratedHShooterEnemy, string>;
              const promptOptions = {
                gameTitle: spec.meta.title,
                tagline: spec.meta.tagline,
                concepts,
                colors,
              };
              const boardPrompt = buildHShooterEnemyBoardPrompt(promptOptions);
              const pipelineFingerprint = JSON.stringify({
                promptVersions: {
                  board: HSHOOTER_ENEMY_BOARD_PROMPT_VERSION,
                  replacement: HSHOOTER_ENEMY_REPLACEMENT_PROMPT_VERSION,
                  judge: HSHOOTER_ENEMY_JUDGE_PROMPT_VERSION,
                },
                concepts,
                colors,
              });
              const pipelineSha = imagePromptHash(pipelineFingerprint, keyArt);
              const cached = assetWorkspace.load(
                HSHOOTER_ENEMY_ATLAS_ROLE,
                HSHOOTER_ENEMY_PIPELINE_PROMPT_VERSION,
                pipelineSha,
              );
              if (cached) {
                try {
                  await validateGeneratedHShooterEnemyAtlas(cached);
                  spec.hshooterEnemyArtVersion = 1;
                  hshooterEnemyArtStatus = {
                    mode: 'generated',
                    attempted: true,
                    roles: [...GENERATED_HSHOOTER_ENEMIES],
                  };
                  emit('building-assets', 'Restored the generated H-scroll enemy cast');
                  return;
                } catch {
                  await assetWorkspace.discard([HSHOOTER_ENEMY_ATLAS_ROLE]);
                }
              }

              try {
                let rawBoard = assetWorkspace.loadPrivate(
                  'hshooterEnemyBoard',
                  HSHOOTER_ENEMY_BOARD_PROMPT_VERSION,
                  pipelineSha,
                );
                if (rawBoard) {
                  emit('building-assets', 'Resuming the H-scroll enemy cast review');
                } else {
                  emit(
                    'building-assets',
                    'Painting two candidates for all five H-scroll enemies in one board…',
                  );
                  rawBoard = await callImage({
                    role: 'hshooter-enemy-board',
                    label: 'H-scroll enemy candidate board',
                    prompt: boardPrompt,
                    reference: keyArt,
                    size: '1024x1024',
                  });
                  await assetWorkspace.storePrivate(
                    'hshooterEnemyBoard',
                    rawBoard,
                    HSHOOTER_ENEMY_BOARD_PROMPT_VERSION,
                    pipelineSha,
                  );
                }

                const split = await assetArtifacts.getOrCompute(
                  imagePromptHash(`hshooter-enemy-split-v1:${pipelineSha}`, rawBoard),
                  () => splitGeneratedHShooterEnemyBoard(rawBoard!),
                );
                split.failures.forEach(({ id }) => validationFailure(`hshooter-enemy-board-${id}`));
                const candidates: HShooterEnemyCandidate[] = [...split.candidates];
                const missingRoles = GENERATED_HSHOOTER_ENEMIES.filter(
                  (role) => !candidates.some((candidate) => candidate.role === role),
                );
                if (missingRoles.length) {
                  emit(
                    'building-assets',
                    `Repairing ${missingRoles.join(', ')} with one bounded role-specific replacement each…`,
                  );
                }
                const replacements = await settleAll(
                  missingRoles.map(async (role) => {
                    const privateRole = HSHOOTER_ENEMY_REPLACEMENT_ASSET_ROLES[role];
                    const roleFailures = split.failures
                      .filter((failure) => failure.role === role)
                      .map((failure) => failure.reason)
                      .join('; ');
                    const replacementPrompt = buildHShooterEnemyReplacementPrompt({
                      ...promptOptions,
                      role,
                      correction:
                        roleFailures ||
                        'Return one complete broad silhouette with clean separation from the green background',
                    });
                    const replacementSha = imagePromptHash(replacementPrompt, keyArt);
                    let rawReplacement = assetWorkspace.loadPrivate(
                      privateRole,
                      HSHOOTER_ENEMY_REPLACEMENT_PROMPT_VERSION,
                      replacementSha,
                    );
                    if (!rawReplacement) {
                      rawReplacement = await callImage({
                        role: `hshooter-enemy-replacement-${role}`,
                        label: `H-scroll ${role} replacement`,
                        prompt: replacementPrompt,
                        reference: keyArt,
                        size: '1024x1024',
                      });
                      await assetWorkspace.storePrivate(
                        privateRole,
                        rawReplacement,
                        HSHOOTER_ENEMY_REPLACEMENT_PROMPT_VERSION,
                        replacementSha,
                      );
                    }
                    try {
                      const processed = await assetArtifacts.getOrCompute(
                        imagePromptHash(
                          `hshooter-enemy-replacement-v1:${pipelineSha}:${role}`,
                          rawReplacement,
                        ),
                        () => processGeneratedHShooterEnemy(rawReplacement!, role),
                      );
                      return {
                        id: `${role}-replacement`,
                        role,
                        png: processed.png,
                        metrics: processed.metrics,
                      };
                    } catch (error) {
                      throwIfSuspended(error);
                      validationFailure(`hshooter-enemy-replacement-${role}`);
                      await assetWorkspace.discardPrivate(privateRole);
                      throw new PipelineError(
                        'image-invalid',
                        `Required H-scroll ${role} replacement failed validation: ${error instanceof Error ? error.message : String(error)}`,
                        'building-assets',
                      );
                    }
                  }),
                );
                candidates.push(...replacements);

                const unresolved = GENERATED_HSHOOTER_ENEMIES.filter(
                  (role) => !candidates.some((candidate) => candidate.role === role),
                );
                if (unresolved.length) {
                  throw new PipelineError(
                    'image-invalid',
                    `H-scroll enemy cast has no mechanically valid ${unresolved.join(', ')}`,
                    'building-assets',
                  );
                }

                const descriptors = candidates.map(({ id, role }) => ({ id, role }));
                const reviewBoard = await buildHShooterEnemyJudgeBoard({ keyArt, candidates });
                const mockDecision = {
                  candidateReviews: descriptors.map(({ id, role }) => ({
                    id,
                    role,
                    scores: {
                      conceptMatch: 5,
                      castCohesion: 5,
                      silhouette: 5,
                      roleReadability: 5,
                      technical: 5,
                    },
                    issues: [],
                    summary: 'Mock coherent H-scroll enemy candidate.',
                  })),
                  selections: GENERATED_HSHOOTER_ENEMIES.map((role) => ({
                    role,
                    candidateId: descriptors.find((candidate) => candidate.role === role)!.id,
                    confidence: 1,
                    rationale: 'Mock selection.',
                  })),
                  castSummary: 'Mock coherent H-scroll cast.',
                };
                const rawDecision = mockImages
                  ? mockDecision
                  : await callLlm(
                      'design',
                      {
                        ...buildHShooterEnemyJudgePrompt(descriptors, concepts),
                        jsonSchema: buildHShooterEnemyJudgeSchema(descriptors),
                        maxTokens: 2800,
                        timeoutMs: 120_000,
                      },
                      {
                        stage: 'building-assets',
                        label: 'Spark selected the H-scroll enemy cast',
                        image: reviewBoard,
                        reasoningEffort: 'low',
                      },
                    );
                const decision = normalizeHShooterEnemyJudgeDecision(rawDecision, descriptors);
                const selected = Object.fromEntries(
                  GENERATED_HSHOOTER_ENEMIES.map((role) => {
                    const requested = decision.selections.find(
                      (selection) => selection.role === role,
                    )?.candidateId;
                    const id =
                      requested ?? bestHShooterEnemyCandidateId(role, decision) ?? undefined;
                    const candidate = candidates.find(
                      (entry) => entry.role === role && entry.id === id,
                    );
                    if (!candidate)
                      throw new Error(`Spark did not select a valid ${role} candidate`);
                    return [role, candidate.png];
                  }),
                ) as Record<GeneratedHShooterEnemy, Buffer>;
                const atlas = await buildGeneratedHShooterEnemyAtlas(selected);
                await assetWorkspace.store(
                  HSHOOTER_ENEMY_ATLAS_ROLE,
                  atlas,
                  HSHOOTER_ENEMY_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                await settleAll([
                  assetWorkspace.discardPrivate('hshooterEnemyBoard'),
                  ...GENERATED_HSHOOTER_ENEMIES.map((role) =>
                    assetWorkspace.discardPrivate(HSHOOTER_ENEMY_REPLACEMENT_ASSET_ROLES[role]),
                  ),
                ]);
                spec.hshooterEnemyArtVersion = 1;
                hshooterEnemyArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  roles: [...GENERATED_HSHOOTER_ENEMIES],
                };
                emit('building-assets', 'Finished the generated H-scroll enemy cast');
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof PipelineError ||
                  error instanceof GeneratedAssetStorageError
                ) {
                  throw error;
                }
                throw new PipelineError(
                  'image-invalid',
                  `Required H-scroll enemy cast failed validation: ${error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)}`,
                  'building-assets',
                );
              }
            })
          : Promise.resolve();

      let shooterBossArtStatus: GameMetaFile['shooterBossArt'];
      const shooterBossTask =
        spec.archetype === 'shooter'
          ? storyAssets.boss.then(async (storyBoss): Promise<void> => {
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              try {
                const pipelineFingerprint = JSON.stringify({
                  promptVersions: {
                    candidate: SHOOTER_BOSS_PROMPT_VERSION,
                    judge: SHOOTER_BOSS_JUDGE_PROMPT_VERSION,
                  },
                  bossName: spec.boss.name,
                  bossIntro: spec.story.bossIntro,
                  colors,
                });
                const pipelineSha = imagePromptHash(pipelineFingerprint, storyBoss);
                const cached = assetWorkspace.load(
                  'shooterBoss',
                  SHOOTER_BOSS_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                if (cached) {
                  shooterBossArtStatus = { mode: 'generated', attempted: true };
                  emit('building-assets', 'Restored the selected vertical-shooter boss');
                  return;
                }

                interface BossCandidate {
                  id: string;
                  png: Buffer;
                }
                const generateBossCandidateUncached = async (
                  index: number,
                  retryGuidance = '',
                ): Promise<BossCandidate | null> => {
                  const id = `B${index}`;
                  let raw: Buffer;
                  try {
                    raw = await callImage({
                      role: `shooter-boss-${id}`,
                      label: `Vertical-shooter boss candidate ${id}`,
                      prompt: buildShooterBossCandidatePrompt({
                        bossName: spec.boss.name,
                        bossIntro: spec.story.bossIntro,
                        colors,
                        candidateId: id,
                        ...(retryGuidance ? { retryGuidance } : {}),
                      }),
                      reference: storyBoss,
                      size: '1024x1536',
                    });
                  } catch (error) {
                    throwIfSuspended(error);
                    if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                    validationFailure(`shooter-boss-${id}`);
                    emit(
                      'building-assets',
                      `Vertical-shooter boss candidate ${id} was unavailable; continuing…`,
                    );
                    return null;
                  }
                  try {
                    const processed = await processGeneratedShooterBoss(raw);
                    return { id, png: processed.png };
                  } catch {
                    validationFailure(`shooter-boss-${id}`);
                    emit(
                      'building-assets',
                      `Vertical-shooter boss candidate ${id} failed local silhouette validation`,
                    );
                    return null;
                  }
                };
                const generateBossCandidate = (
                  ...args: Parameters<typeof generateBossCandidateUncached>
                ) =>
                  assetArtifacts.getOrCompute(
                    JSON.stringify(['shooter-boss-candidate-v1', job.attempt, pipelineSha, args]),
                    () => generateBossCandidateUncached(...args),
                  );

                emit('building-assets', 'Painting three vertical-shooter boss candidates…');
                let candidates = (
                  await settleAll([1, 2, 3].map((index) => generateBossCandidate(index)))
                ).filter((candidate): candidate is BossCandidate => candidate !== null);
                if (candidates.length === 0) {
                  emit(
                    'building-assets',
                    'The first vertical boss pool was unusable; painting one corrective pool…',
                  );
                  candidates = (
                    await settleAll(
                      [4, 5, 6].map((index) =>
                        generateBossCandidate(
                          index,
                          'Return one complete uncropped tall TOP-DOWN boss with its attack end pointing DOWN and a perfectly flat green background',
                        ),
                      ),
                    )
                  ).filter((candidate): candidate is BossCandidate => candidate !== null);
                }
                if (candidates.length === 0) {
                  throw new Error(
                    'both generated vertical-shooter boss pools failed mechanical validation',
                  );
                }

                const descriptors: PlatformerBossCandidateDescriptor[] = candidates.map(
                  ({ id }) => ({ id }),
                );
                const board = await buildPlatformerBossJudgeBoard({
                  storyBoss,
                  candidates: candidates.map(({ id, png: processed }) => ({ id, processed })),
                });
                const mockDecision = {
                  candidateReviews: descriptors.map(({ id }) => ({
                    id,
                    scores: {
                      villainMatch: 5,
                      silhouette: 5,
                      pose: 5,
                      technical: 5,
                      gameplayReadability: 5,
                    },
                    issues: [],
                    summary: 'Mock story-faithful vertical boss candidate.',
                  })),
                  selection: {
                    candidateId: descriptors[0]!.id,
                    confidence: 1,
                    rationale: 'Mock selection.',
                  },
                };
                const rawDecision = mockImages
                  ? mockDecision
                  : await callLlm(
                      'design',
                      {
                        ...buildShooterBossJudgePrompt(descriptors.map(({ id }) => id)),
                        jsonSchema: buildPlatformerBossJudgeSchema(descriptors),
                        maxTokens: 2200,
                        timeoutMs: 120_000,
                      },
                      {
                        stage: 'building-assets',
                        label: 'Spark selected the signature vertical-shooter boss',
                        image: board,
                        reasoningEffort: 'low',
                      },
                    );
                const decision = normalizePlatformerBossJudgeDecision(rawDecision, descriptors);
                const selectedId =
                  decision.selection.candidateId || bestPlatformerBossCandidateId(decision);
                const selected = candidates.find(({ id }) => id === selectedId) ?? candidates[0]!;
                await assetWorkspace.store(
                  'shooterBoss',
                  selected.png,
                  SHOOTER_BOSS_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                shooterBossArtStatus = { mode: 'generated', attempted: true };
                emit('building-assets', `Spark selected ${selected.id} as the vertical boss`);
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof GeneratedAssetStorageError ||
                  (error instanceof PipelineError && !isOptionalGeneratedArtProviderFailure(error))
                ) {
                  throw error;
                }
                await assetWorkspace.discard(['shooterBoss']);
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated vertical-shooter boss failed validation';
                throw new PipelineError(
                  'image-invalid',
                  `Required vertical-shooter boss art failed: ${reason}`,
                  'building-assets',
                );
              }
            })
          : Promise.resolve();

      let shooterEnemyArtStatus: GameMetaFile['shooterEnemyArt'];
      const shooterEnemyTask =
        spec.archetype === 'shooter'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              const fallbackConcepts: Record<GeneratedShooterEnemy, string> = {
                popcorn: 'a small disposable scout native to the hostile faction',
                weaver: 'a slim agile enemy that darts laterally across the flight field',
                tank: 'a broad slow armored ordinary war machine or creature',
                turret: 'a stable free-flying gun platform native to the hostile faction',
                kamikaze: 'a pointed high-speed impact attacker',
              };
              const concepts = Object.fromEntries(
                GENERATED_SHOOTER_ENEMIES.map((role) => [
                  role,
                  design.cast.find((member) => member.role === role)?.concept ??
                    fallbackConcepts[role],
                ]),
              ) as Record<GeneratedShooterEnemy, string>;
              const promptOptions = {
                gameTitle: spec.meta.title,
                tagline: spec.meta.tagline,
                concepts,
                colors,
              };
              const boardPrompt = buildShooterEnemyBoardPrompt(promptOptions);
              const pipelineFingerprint = JSON.stringify({
                promptVersions: {
                  board: SHOOTER_ENEMY_BOARD_PROMPT_VERSION,
                  replacement: SHOOTER_ENEMY_REPLACEMENT_PROMPT_VERSION,
                  judge: SHOOTER_ENEMY_JUDGE_PROMPT_VERSION,
                },
                concepts,
                colors,
              });
              const pipelineSha = imagePromptHash(pipelineFingerprint, keyArt);
              const cached = assetWorkspace.load(
                SHOOTER_ENEMY_ATLAS_ROLE,
                SHOOTER_ENEMY_PIPELINE_PROMPT_VERSION,
                pipelineSha,
              );
              if (cached) {
                try {
                  await validateGeneratedShooterEnemyAtlas(cached);
                  spec.shooterGameplayArtVersion = 1;
                  shooterEnemyArtStatus = {
                    mode: 'generated',
                    attempted: true,
                    roles: [...GENERATED_SHOOTER_ENEMIES],
                  };
                  emit('building-assets', 'Restored the generated vertical enemy cast');
                  return;
                } catch {
                  await assetWorkspace.discard([SHOOTER_ENEMY_ATLAS_ROLE]);
                }
              }

              try {
                let rawBoard = assetWorkspace.loadPrivate(
                  'shooterEnemyBoard',
                  SHOOTER_ENEMY_BOARD_PROMPT_VERSION,
                  pipelineSha,
                );
                if (!rawBoard) {
                  emit(
                    'building-assets',
                    'Painting two candidates for all five vertical-shooter enemies in one board…',
                  );
                  rawBoard = await callImage({
                    role: 'shooter-enemy-board',
                    label: 'Vertical-shooter enemy candidate board',
                    prompt: boardPrompt,
                    reference: keyArt,
                    size: '1024x1024',
                  });
                  await assetWorkspace.storePrivate(
                    'shooterEnemyBoard',
                    rawBoard,
                    SHOOTER_ENEMY_BOARD_PROMPT_VERSION,
                    pipelineSha,
                  );
                }

                const split = await assetArtifacts.getOrCompute(
                  imagePromptHash(`shooter-enemy-split-v1:${pipelineSha}`, rawBoard),
                  () => splitGeneratedShooterEnemyBoard(rawBoard!),
                );
                split.failures.forEach(({ id }) => validationFailure(`shooter-enemy-board-${id}`));
                const candidates: ShooterEnemyCandidate[] = [...split.candidates];
                const missingRoles = GENERATED_SHOOTER_ENEMIES.filter(
                  (role) => !candidates.some((candidate) => candidate.role === role),
                );
                if (missingRoles.length) {
                  emit(
                    'building-assets',
                    `Repairing ${missingRoles.join(', ')} with one bounded role-specific call each…`,
                  );
                }
                const replacements = await settleAll(
                  missingRoles.map(async (role) => {
                    const privateRole = SHOOTER_ENEMY_REPLACEMENT_ASSET_ROLES[role];
                    const correction =
                      split.failures
                        .filter((failure) => failure.role === role)
                        .map((failure) => failure.reason)
                        .join('; ') ||
                      'Return one complete top-down silhouette cleanly separated from the green background';
                    const replacementPrompt = buildShooterEnemyReplacementPrompt({
                      ...promptOptions,
                      role,
                      correction,
                    });
                    const replacementSha = imagePromptHash(replacementPrompt, keyArt);
                    let rawReplacement = assetWorkspace.loadPrivate(
                      privateRole,
                      SHOOTER_ENEMY_REPLACEMENT_PROMPT_VERSION,
                      replacementSha,
                    );
                    if (!rawReplacement) {
                      rawReplacement = await callImage({
                        role: `shooter-enemy-replacement-${role}`,
                        label: `Vertical-shooter ${role} replacement`,
                        prompt: replacementPrompt,
                        reference: keyArt,
                        size: '1024x1024',
                      });
                      await assetWorkspace.storePrivate(
                        privateRole,
                        rawReplacement,
                        SHOOTER_ENEMY_REPLACEMENT_PROMPT_VERSION,
                        replacementSha,
                      );
                    }
                    try {
                      const processed = await assetArtifacts.getOrCompute(
                        imagePromptHash(
                          `shooter-enemy-replacement-v1:${pipelineSha}:${role}`,
                          rawReplacement,
                        ),
                        () => processGeneratedShooterEnemy(rawReplacement!, role),
                      );
                      return {
                        id: `${role}-replacement`,
                        role,
                        png: processed.png,
                        metrics: processed.metrics,
                      };
                    } catch (error) {
                      throwIfSuspended(error);
                      validationFailure(`shooter-enemy-replacement-${role}`);
                      await assetWorkspace.discardPrivate(privateRole);
                      throw new PipelineError(
                        'image-invalid',
                        `Required vertical ${role} replacement failed validation: ${error instanceof Error ? error.message : String(error)}`,
                        'building-assets',
                      );
                    }
                  }),
                );
                candidates.push(...replacements);

                const unresolved = GENERATED_SHOOTER_ENEMIES.filter(
                  (role) => !candidates.some((candidate) => candidate.role === role),
                );
                if (unresolved.length) {
                  throw new PipelineError(
                    'image-invalid',
                    `Vertical enemy cast has no mechanically valid ${unresolved.join(', ')}`,
                    'building-assets',
                  );
                }

                const descriptors = candidates.map(({ id, role }) => ({ id, role }));
                const reviewBoard = await buildShooterEnemyJudgeBoard({ keyArt, candidates });
                const mockDecision = {
                  candidateReviews: descriptors.map(({ id, role }) => ({
                    id,
                    role,
                    scores: {
                      conceptMatch: 5,
                      castCohesion: 5,
                      silhouette: 5,
                      roleReadability: 5,
                      technical: 5,
                    },
                    issues: [],
                    summary: 'Mock coherent vertical enemy candidate.',
                  })),
                  selections: GENERATED_SHOOTER_ENEMIES.map((role) => ({
                    role,
                    candidateId: descriptors.find((candidate) => candidate.role === role)!.id,
                    confidence: 1,
                    rationale: 'Mock selection.',
                  })),
                  castSummary: 'Mock coherent vertical cast.',
                };
                const rawDecision = mockImages
                  ? mockDecision
                  : await callLlm(
                      'design',
                      {
                        ...buildShooterEnemyJudgePrompt(descriptors, concepts),
                        jsonSchema: buildShooterEnemyJudgeSchema(descriptors),
                        maxTokens: 2800,
                        timeoutMs: 120_000,
                      },
                      {
                        stage: 'building-assets',
                        label: 'Spark selected the vertical-shooter enemy cast',
                        image: reviewBoard,
                        reasoningEffort: 'low',
                      },
                    );
                const decision = normalizeShooterEnemyJudgeDecision(rawDecision, descriptors);
                const selected = Object.fromEntries(
                  GENERATED_SHOOTER_ENEMIES.map((role) => {
                    const requested = decision.selections.find(
                      (selection) => selection.role === role,
                    )?.candidateId;
                    const id =
                      requested ?? bestShooterEnemyCandidateId(role, decision) ?? undefined;
                    const candidate = candidates.find(
                      (entry) => entry.role === role && entry.id === id,
                    );
                    if (!candidate) throw new Error(`Spark did not select a valid ${role}`);
                    return [role, candidate.png];
                  }),
                ) as Record<GeneratedShooterEnemy, Buffer>;
                const atlas = await buildGeneratedShooterEnemyAtlas(selected);
                await assetWorkspace.store(
                  SHOOTER_ENEMY_ATLAS_ROLE,
                  atlas,
                  SHOOTER_ENEMY_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                await settleAll([
                  assetWorkspace.discardPrivate('shooterEnemyBoard'),
                  ...GENERATED_SHOOTER_ENEMIES.map((role) =>
                    assetWorkspace.discardPrivate(SHOOTER_ENEMY_REPLACEMENT_ASSET_ROLES[role]),
                  ),
                ]);
                spec.shooterGameplayArtVersion = 1;
                shooterEnemyArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  roles: [...GENERATED_SHOOTER_ENEMIES],
                };
                emit('building-assets', 'Finished the generated vertical enemy cast');
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof PipelineError ||
                  error instanceof GeneratedAssetStorageError
                ) {
                  throw error;
                }
                throw new PipelineError(
                  'image-invalid',
                  `Required vertical enemy cast failed validation: ${error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)}`,
                  'building-assets',
                );
              }
            })
          : Promise.resolve();

      let platformerBossArtStatus: GameMetaFile['platformerBossArt'] =
        spec.archetype === 'platformer'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated platformer boss art did not complete',
            }
          : undefined;
      const platformerBossTask =
        spec.archetype === 'platformer'
          ? storyAssets.boss.then(async (storyBoss): Promise<void> => {
              const generationStarted = Date.now();
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              try {
                const pipelineFingerprint = JSON.stringify({
                  promptVersions: {
                    candidate: PLATFORMER_BOSS_PROMPT_VERSION,
                    judge: PLATFORMER_BOSS_JUDGE_PROMPT_VERSION,
                  },
                  bossName: spec.boss.name,
                  bossIntro: spec.story.bossIntro,
                  colors,
                });
                const pipelineSha = imagePromptHash(pipelineFingerprint, storyBoss);
                const cached = assetWorkspace.load(
                  'platformerBoss',
                  PLATFORMER_BOSS_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                if (cached) {
                  platformerBossArtStatus = { mode: 'generated', attempted: true };
                  emit('building-assets', 'Restored the selected platformer boss');
                  return;
                }

                interface BossCandidate {
                  id: string;
                  png: Buffer;
                }
                emit('building-assets', 'Painting three signature boss candidates…');
                const candidates = (
                  await settleAll(
                    [1, 2, 3].map(async (index): Promise<BossCandidate | null> => {
                      const id = `B${index}`;
                      let raw: Buffer;
                      try {
                        raw = await callImage({
                          role: `platformer-boss-${id}`,
                          label: `Boss candidate ${id}`,
                          prompt: buildPlatformerBossCandidatePrompt({
                            bossName: spec.boss.name,
                            bossIntro: spec.story.bossIntro,
                            colors,
                            candidateId: id,
                          }),
                          reference: storyBoss,
                          size: '1024x1024',
                        });
                      } catch (error) {
                        throwIfSuspended(error);
                        if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                        validationFailure(`platformer-boss-${id}`);
                        emit(
                          'building-assets',
                          `Boss candidate ${id} was rejected; continuing the candidate pool…`,
                        );
                        return null;
                      }
                      try {
                        let processed;
                        try {
                          processed = await processGeneratedPlatformerBoss(raw);
                        } catch (initialError) {
                          throwIfSuspended(initialError);
                          const recovery = await recoverGeneratedPlatformerGreenPanel(raw);
                          if (!recovery.recovered) throw initialError;
                          processed = await processGeneratedPlatformerBoss(recovery.image);
                        }
                        return { id, png: processed.png };
                      } catch {
                        validationFailure(`platformer-boss-${id}`);
                        emit(
                          'building-assets',
                          `Boss candidate ${id} failed local sprite validation`,
                        );
                        return null;
                      }
                    }),
                  )
                ).filter((candidate): candidate is BossCandidate => candidate !== null);
                if (candidates.length === 0) {
                  throw new Error('no locally valid platformer boss candidate was available');
                }

                const descriptors: PlatformerBossCandidateDescriptor[] = candidates.map(
                  ({ id }) => ({ id }),
                );
                const board = await buildPlatformerBossJudgeBoard({
                  storyBoss,
                  candidates: candidates.map(({ id, png: processed }) => ({ id, processed })),
                });
                const judgePrompt = buildPlatformerBossJudgePrompt(descriptors);
                const mockDecision = {
                  candidateReviews: descriptors.map(({ id }) => ({
                    id,
                    scores: {
                      villainMatch: 5,
                      silhouette: 5,
                      pose: 5,
                      technical: 5,
                      gameplayReadability: 5,
                    },
                    issues: [],
                    summary: 'Mock story-faithful boss candidate.',
                  })),
                  selection: {
                    candidateId: descriptors[0]!.id,
                    confidence: 1,
                    rationale: 'Mock selection.',
                  },
                };
                let rawDecision: unknown = mockDecision;
                if (!mockImages) {
                  try {
                    rawDecision = await callLlm(
                      'design',
                      {
                        ...judgePrompt,
                        jsonSchema: buildPlatformerBossJudgeSchema(descriptors),
                        maxTokens: 2200,
                        timeoutMs: 120_000,
                      },
                      {
                        stage: 'building-assets',
                        label: 'Spark selected the signature boss',
                        image: board,
                        reasoningEffort: 'low',
                      },
                    );
                  } catch (error) {
                    throwIfSuspended(error);
                    if (abort.signal.aborted) throw error;
                    throw new Error(
                      `platformer boss art review failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                }
                const decision = normalizePlatformerBossJudgeDecision(rawDecision, descriptors);
                const selectedId =
                  decision.selection.candidateId || bestPlatformerBossCandidateId(decision);
                const selected = candidates.find(({ id }) => id === selectedId) ?? candidates[0]!;
                await assetWorkspace.store(
                  'platformerBoss',
                  selected.png,
                  PLATFORMER_BOSS_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                platformerBossArtStatus = { mode: 'generated', attempted: true };
                emit('building-assets', `Spark selected ${selected.id} as the signature boss`);
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof GeneratedAssetStorageError ||
                  (error instanceof PipelineError && !isOptionalGeneratedArtProviderFailure(error))
                ) {
                  throw error;
                }
                await assetWorkspace.discard(['platformerBoss']);
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated platformer boss failed validation';
                platformerBossArtStatus = {
                  mode: 'procedural',
                  attempted: true,
                  reason,
                };
                recordEarlyRepairEvent(
                  'entities',
                  'platformer-boss-art-fallback',
                  [
                    {
                      code: 'PLATFORMER_BOSS_ART_FALLBACK',
                      path: '/assets/platformer-boss',
                      message: reason,
                    },
                  ],
                  [],
                  generationStarted,
                  'downgraded',
                );
                emit(
                  'building-assets',
                  `Generated boss was unavailable; using the stable library boss (${reason.slice(0, 120)})`,
                );
              }
            })
          : Promise.resolve();

      let platformerEnemyArtStatus: GameMetaFile['platformerEnemyArt'] =
        spec.archetype === 'platformer'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated platformer enemy art did not complete',
            }
          : undefined;
      const platformerEnemyTask =
        spec.archetype === 'platformer'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const generationStarted = Date.now();
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              const concepts = Object.fromEntries(
                GENERATED_PLATFORMER_ENEMIES.map((role) => [
                  role,
                  design.cast.find((member) => member.role === role)?.concept ??
                    `A distinctive ${role} enemy from ${spec.meta.title}`,
                ]),
              ) as Record<GeneratedPlatformerEnemy, string>;
              const promptHashes = Object.fromEntries(
                GENERATED_PLATFORMER_ENEMIES.map((role) => [
                  role,
                  imagePromptHash(
                    JSON.stringify({
                      promptVersions: {
                        candidate: PLATFORMER_ENEMY_PROMPT_VERSION,
                        judge: PLATFORMER_ENEMY_JUDGE_PROMPT_VERSION,
                      },
                      gameTitle: spec.meta.title,
                      tagline: spec.meta.tagline,
                      role,
                      concept: concepts[role],
                      colors,
                    }),
                    keyArt,
                  ),
                ]),
              ) as Record<GeneratedPlatformerEnemy, string>;
              const generated = new Set<GeneratedPlatformerEnemy>();
              try {
                for (const role of GENERATED_PLATFORMER_ENEMIES) {
                  if (
                    assetWorkspace.load(
                      PLATFORMER_ENEMY_ASSET_ROLES[role],
                      PLATFORMER_ENEMY_PIPELINE_PROMPT_VERSION,
                      promptHashes[role],
                    )
                  ) {
                    generated.add(role);
                  }
                }
                if (generated.size === GENERATED_PLATFORMER_ENEMIES.length) {
                  platformerEnemyArtStatus = {
                    mode: 'generated',
                    attempted: true,
                    generatedRoles: [...GENERATED_PLATFORMER_ENEMIES],
                  };
                  emit('building-assets', 'Restored the selected platformer enemy cast');
                  return;
                }

                interface EnemyCandidate extends PlatformerEnemyCandidateDescriptor {
                  png: Buffer;
                }
                const missing = GENERATED_PLATFORMER_ENEMIES.filter((role) => !generated.has(role));
                emit(
                  'building-assets',
                  `Painting ${missing.length * 2} enemy candidates in parallel…`,
                );
                const candidates = (
                  await settleAll(
                    missing.flatMap((role) =>
                      [1, 2].map(async (index): Promise<EnemyCandidate | null> => {
                        const id = `${role[0]!.toUpperCase()}${index}`;
                        let raw: Buffer;
                        try {
                          raw = await callImage({
                            role: `platformer-enemy-${role}-${id}`,
                            label: `${role} candidate ${id}`,
                            prompt: buildPlatformerEnemyCandidatePrompt({
                              gameTitle: spec.meta.title,
                              tagline: spec.meta.tagline,
                              role,
                              concept: concepts[role],
                              colors,
                              candidateId: id,
                            }),
                            reference: keyArt,
                            size: '1024x1024',
                          });
                        } catch (error) {
                          throwIfSuspended(error);
                          if (abort.signal.aborted) throw error;
                          if (!(error instanceof PipelineError)) throw error;
                          validationFailure(`platformer-enemy-${role}-${id}`);
                          emit(
                            'building-assets',
                            `${role} candidate ${id} was unavailable; continuing the cast…`,
                          );
                          return null;
                        }
                        try {
                          let processed;
                          try {
                            processed = await processGeneratedPlatformerEnemy(raw, role);
                          } catch (initialError) {
                            throwIfSuspended(initialError);
                            const recovery = await recoverGeneratedPlatformerGreenPanel(raw);
                            if (!recovery.recovered) throw initialError;
                            processed = await processGeneratedPlatformerEnemy(recovery.image, role);
                          }
                          return {
                            id,
                            role,
                            concept: concepts[role],
                            png: processed.png,
                          };
                        } catch {
                          validationFailure(`platformer-enemy-${role}-${id}`);
                          emit(
                            'building-assets',
                            `${role} candidate ${id} failed local sprite validation`,
                          );
                          return null;
                        }
                      }),
                    ),
                  )
                ).filter((candidate): candidate is EnemyCandidate => candidate !== null);

                if (candidates.length > 0) {
                  const descriptors: PlatformerEnemyCandidateDescriptor[] = candidates.map(
                    ({ id, role, concept }) => ({ id, role, concept }),
                  );
                  const board = await buildPlatformerEnemyJudgeBoard({
                    keyArt,
                    candidates: candidates.map(({ id, role, concept, png: processed }) => ({
                      id,
                      role,
                      concept,
                      processed,
                    })),
                  });
                  const judgePrompt = buildPlatformerEnemyJudgePrompt(descriptors);
                  const localDecision = {
                    candidateReviews: descriptors.map(({ id, role }) => ({
                      id,
                      role,
                      scores: {
                        conceptMatch: 5,
                        worldStyle: 5,
                        silhouette: 5,
                        roleReadability: 5,
                        technical: 5,
                      },
                      issues: [],
                      summary: 'Locally valid enemy candidate.',
                    })),
                    selections: GENERATED_PLATFORMER_ENEMIES.flatMap((role) => {
                      const candidate = descriptors.find((item) => item.role === role);
                      return candidate
                        ? [
                            {
                              role,
                              candidateId: candidate.id,
                              confidence: mockImages ? 1 : 0,
                              rationale: mockImages
                                ? 'Mock selection.'
                                : 'Spark review was unavailable; retained a locally valid candidate.',
                            },
                          ]
                        : [];
                    }),
                  };
                  let rawDecision: unknown = localDecision;
                  if (!mockImages) {
                    try {
                      rawDecision = await callLlm(
                        'design',
                        {
                          ...judgePrompt,
                          jsonSchema: buildPlatformerEnemyJudgeSchema(descriptors),
                          maxTokens: 3600,
                          timeoutMs: 120_000,
                        },
                        {
                          stage: 'building-assets',
                          label: 'Spark selected the platformer enemy cast',
                          image: board,
                          reasoningEffort: 'low',
                        },
                      );
                    } catch (error) {
                      throwIfSuspended(error);
                      if (abort.signal.aborted) throw error;
                      emit(
                        'building-assets',
                        'Enemy art review was unavailable; retaining locally valid candidates',
                      );
                    }
                  }
                  const decision = normalizePlatformerEnemyJudgeDecision(rawDecision, descriptors);
                  await settleAll(
                    decision.selections.map(async ({ role, candidateId }) => {
                      const selected = candidates.find(
                        (candidate) => candidate.role === role && candidate.id === candidateId,
                      );
                      if (!selected) return;
                      await assetWorkspace.store(
                        PLATFORMER_ENEMY_ASSET_ROLES[role],
                        selected.png,
                        PLATFORMER_ENEMY_PIPELINE_PROMPT_VERSION,
                        promptHashes[role],
                      );
                      generated.add(role);
                    }),
                  );
                }

                const generatedRoles = GENERATED_PLATFORMER_ENEMIES.filter((role) =>
                  generated.has(role),
                );
                const missingRoles = GENERATED_PLATFORMER_ENEMIES.filter(
                  (role) => !generated.has(role),
                );
                if (missingRoles.length === 0) {
                  platformerEnemyArtStatus = {
                    mode: 'generated',
                    attempted: true,
                    generatedRoles,
                  };
                  emit('building-assets', 'Spark selected the complete platformer enemy cast');
                  return;
                }

                const reason = `No valid generated art for ${missingRoles.join(', ')}`;
                platformerEnemyArtStatus = {
                  mode: generatedRoles.length ? 'partial' : 'procedural',
                  attempted: true,
                  ...(generatedRoles.length ? { generatedRoles } : {}),
                  reason,
                };
                recordEarlyRepairEvent(
                  'entities',
                  'platformer-enemy-art-fallback',
                  missingRoles.map((role) => ({
                    code: 'PLATFORMER_ENEMY_ART_FALLBACK',
                    path: `/assets/platformer-enemy-${role}`,
                    message: reason,
                  })),
                  [],
                  generationStarted,
                  'downgraded',
                );
                emit(
                  'building-assets',
                  `Using stable library art for ${missingRoles.join(', ')}; the remaining enemies are generated`,
                );
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof GeneratedAssetStorageError ||
                  (error instanceof PipelineError && error.code === 'storage')
                ) {
                  throw error;
                }
                const generatedRoles = GENERATED_PLATFORMER_ENEMIES.filter((role) =>
                  generated.has(role),
                );
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated platformer enemy art failed';
                platformerEnemyArtStatus = {
                  mode: generatedRoles.length ? 'partial' : 'procedural',
                  attempted: true,
                  ...(generatedRoles.length ? { generatedRoles } : {}),
                  reason,
                };
                recordEarlyRepairEvent(
                  'entities',
                  'platformer-enemy-art-fallback',
                  [
                    {
                      code: 'PLATFORMER_ENEMY_ART_FALLBACK',
                      path: '/assets/platformer-enemies',
                      message: reason,
                    },
                  ],
                  [],
                  generationStarted,
                  'downgraded',
                );
                emit(
                  'building-assets',
                  `Generated enemy cast was incomplete; using stable fallbacks where needed (${reason.slice(0, 120)})`,
                );
              }
            })
          : Promise.resolve();

      let platformerPropArtStatus: GameMetaFile['platformerPropArt'] =
        spec.archetype === 'platformer'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated platformer prop art did not complete',
            }
          : undefined;
      const platformerPropTask =
        spec.archetype === 'platformer'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const platformerSpec = spec as PlatformerSpec;
              const propRoles = generatedPlatformerPropRoles(platformerSpec);
              const generationStarted = Date.now();
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              const premise = [spec.meta.tagline, ...spec.story.intro].join(' ');
              const promptHashes = Object.fromEntries(
                propRoles.map((role) => [
                  role,
                  imagePromptHash(
                    JSON.stringify({
                      promptVersion: PLATFORMER_PROP_PROMPT_VERSION,
                      gameTitle: spec.meta.title,
                      tagline: spec.meta.tagline,
                      premise,
                      role,
                      ability: platformerPropAbility(platformerSpec, role),
                      colors,
                    }),
                    keyArt,
                  ),
                ]),
              ) as Record<GeneratedPlatformerProp, string>;
              const generated = new Set<GeneratedPlatformerProp>();

              for (const role of propRoles) {
                if (
                  assetWorkspace.load(
                    PLATFORMER_PROP_ASSET_ROLES[role],
                    PLATFORMER_PROP_PIPELINE_PROMPT_VERSION,
                    promptHashes[role],
                  )
                ) {
                  generated.add(role);
                }
              }
              const missing = propRoles.filter((role) => !generated.has(role));
              if (missing.length === 0) {
                platformerPropArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  generatedRoles: [...propRoles],
                };
                emit('building-assets', 'Restored the generated platformer gameplay props');
                return;
              }

              if (missing.length > 1) {
                emit(
                  'building-assets',
                  `Painting ${propRoles.length} gameplay props on one sheet…`,
                );
                try {
                  const layout = platformerPropBoardLayout(propRoles.length);
                  const raw = await callImage({
                    role: 'platformer-prop-board',
                    label: 'Gameplay prop sheet',
                    prompt: buildPlatformerPropBoardPrompt(
                      propRoles.map((role) => ({
                        gameTitle: spec.meta.title,
                        tagline: spec.meta.tagline,
                        premise,
                        role,
                        ability: platformerPropAbility(platformerSpec, role),
                        colors,
                      })),
                    ),
                    reference: keyArt,
                    size: `${layout.width}x${layout.height}`,
                  });
                  const cells = await processGeneratedPlatformerPropBoard(raw, propRoles);
                  await settleAll(
                    cells.map(async (cell) => {
                      if (!cell.png || generated.has(cell.role)) return;
                      await assetWorkspace.store(
                        PLATFORMER_PROP_ASSET_ROLES[cell.role],
                        cell.png,
                        PLATFORMER_PROP_PIPELINE_PROMPT_VERSION,
                        promptHashes[cell.role],
                      );
                      generated.add(cell.role);
                    }),
                  );
                } catch (error) {
                  throwIfSuspended(error);
                  if (
                    abort.signal.aborted ||
                    error instanceof GeneratedAssetStorageError ||
                    (error instanceof PipelineError &&
                      !isOptionalGeneratedArtProviderFailure(error))
                  )
                    throw error;
                  validationFailure('platformer-prop-board');
                }
              }
              const individual = propRoles.filter((role) => !generated.has(role));
              if (individual.length)
                emit(
                  'building-assets',
                  `Painting ${individual.length} remaining gameplay props individually…`,
                );
              await settleAll(
                individual.map(async (role) => {
                  try {
                    const raw = await callImage({
                      role: `platformer-prop-${role}`,
                      label: `${role} gameplay prop`,
                      prompt: buildPlatformerPropPrompt({
                        gameTitle: spec.meta.title,
                        tagline: spec.meta.tagline,
                        premise,
                        role,
                        ability: platformerPropAbility(platformerSpec, role),
                        colors,
                      }),
                      reference: keyArt,
                      size: '1024x1024',
                    });
                    let processed;
                    try {
                      processed = await processGeneratedPlatformerProp(raw, role);
                    } catch (initialError) {
                      throwIfSuspended(initialError);
                      const recovery = await recoverGeneratedPlatformerGreenPanel(raw);
                      if (!recovery.recovered) throw initialError;
                      processed = await processGeneratedPlatformerProp(recovery.image, role);
                    }
                    await assetWorkspace.store(
                      PLATFORMER_PROP_ASSET_ROLES[role],
                      processed.png,
                      PLATFORMER_PROP_PIPELINE_PROMPT_VERSION,
                      promptHashes[role],
                    );
                    generated.add(role);
                  } catch (error) {
                    throwIfSuspended(error);
                    if (
                      abort.signal.aborted ||
                      error instanceof GeneratedAssetStorageError ||
                      (error instanceof PipelineError && error.code === 'storage')
                    ) {
                      throw error;
                    }
                    validationFailure(`platformer-prop-${role}`);
                    emit(
                      'building-assets',
                      `${role} prop was unavailable; keeping its stable library fallback`,
                    );
                  }
                }),
              );

              const generatedRoles = propRoles.filter((role) => generated.has(role));
              const missingRoles = propRoles.filter((role) => !generated.has(role));
              if (missingRoles.length === 0) {
                platformerPropArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  generatedRoles,
                };
                emit('building-assets', 'Generated the complete platformer gameplay prop set');
                return;
              }

              const reason = `No valid generated art for ${missingRoles.join(', ')}`;
              platformerPropArtStatus = {
                mode: generatedRoles.length ? 'partial' : 'procedural',
                attempted: true,
                ...(generatedRoles.length ? { generatedRoles } : {}),
                reason,
              };
              recordEarlyRepairEvent(
                'entities',
                'platformer-prop-art-fallback',
                missingRoles.map((role) => ({
                  code: 'PLATFORMER_PROP_ART_FALLBACK',
                  path: `/assets/platformer-prop-${role}`,
                  message: reason,
                })),
                [],
                generationStarted,
                'downgraded',
              );
            })
          : Promise.resolve();

      let fighterArtStatus: GameMetaFile['fighterArt'];
      let fighterArenaArtStatus: GameMetaFile['fighterArenaArt'] =
        spec.archetype === 'fighter'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated Fighter arenas did not complete',
            }
          : undefined;
      const fighterArenaTask =
        spec.archetype === 'fighter'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const fighterSpec = spec as FighterSpec;
              try {
                await cachedGeneratedAsset({
                  role: FIGHTER_ARENA_ASSET_ROLE,
                  promptVersion: FIGHTER_ARENA_PROMPT_VERSION,
                  prompt: buildFighterArenaPrompt(fighterSpec),
                  label: 'Fighter ladder and boss arenas',
                  reference: keyArt,
                  size: '1024x1024',
                  normalize: normalizeFighterArenaAtlas,
                });
                fighterArenaArtStatus = { mode: 'generated', attempted: true };
                emit('building-assets', 'Finished the generated ladder and boss arenas');
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof GeneratedAssetStorageError ||
                  (error instanceof PipelineError && !isOptionalGeneratedArtProviderFailure(error))
                ) {
                  throw error;
                }
                await assetWorkspace.discard([FIGHTER_ARENA_ASSET_ROLE]);
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated Fighter arenas failed validation';
                fighterArenaArtStatus = { mode: 'procedural', attempted: true, reason };
                emit(
                  'building-assets',
                  `Generated arenas did not pass; using the stable stage backdrop (${reason.slice(0, 120)})`,
                );
              }
            })
          : Promise.resolve();

      const fighterTask =
        spec.archetype === 'fighter'
          ? (async (): Promise<void> => {
              const fighterSpec = spec as FighterSpec;
              const keyArt = await keyArtTask;
              const player: FighterCharacter = fighterSpec.player;
              const boss: FighterCharacter = {
                name: fighterSpec.boss.name,
                visualConcept: fighterSpec.boss.visualConcept,
                build: fighterSpec.boss.build,
                outfit: fighterSpec.boss.outfit,
                colorSlot: fighterSpec.boss.colorSlot,
                hp: fighterSpec.boss.hp,
                speedScale: fighterSpec.boss.speedScale,
                powerScale: fighterSpec.boss.powerScale,
                combatProfile: fighterSpec.boss.combatProfile,
                projectile: fighterSpec.boss.projectile,
              };
              interface RosterEntry {
                slot: FighterRosterSlot;
                character: FighterCharacter;
                source: Buffer | Promise<Buffer>;
                sourceKind: 'photo' | 'key-art' | 'boss-art';
                photoIdentity: boolean;
              }
              const roster: RosterEntry[] = [
                {
                  slot: 'player',
                  character: player,
                  source: photoReference ?? keyArt,
                  sourceKind: photoReference ? 'photo' : 'key-art',
                  photoIdentity: !!photoReference,
                },
                ...fighterSpec.levels.map((level, index): RosterEntry => ({
                  slot: `opponent${index + 1}` as FighterRosterSlot,
                  character: level.opponent,
                  source: keyArt,
                  sourceKind: 'key-art',
                  photoIdentity: false,
                })),
                {
                  slot: 'boss',
                  character: boss,
                  source: storyAssets.boss,
                  sourceKind: 'boss-art',
                  photoIdentity: false,
                },
              ];
              if (
                roster.length !== FIGHTER_ROSTER_SLOTS.length ||
                !FIGHTER_ROSTER_SLOTS.every((slot, index) => roster[index]?.slot === slot)
              ) {
                throw new Error('fighter roster does not match the five-slot atlas contract');
              }

              const conceptFor = (character: FighterCharacter): string =>
                [
                  character.visualConcept,
                  ...(character.projectile
                    ? [
                        `The character releases ${character.projectile.name} (${character.projectile.kind}); its power source fits the costume and story, but the blast itself is drawn by the runtime.`,
                      ]
                    : []),
                  character.combatProfile === 'rushdown'
                    ? 'Combat kit: crisp compact low-punch, high-punch and high-kick silhouettes form a readable short chain.'
                    : character.combatProfile === 'counter'
                      ? 'Combat kit: a clearly braced blocking pose and decisive high-punch retaliation.'
                      : character.combatProfile === 'rangedControl'
                        ? 'Combat kit: the high-punch pose also releases an engine-drawn energy pulse from the forward fist. Keep that fist visible and uncropped. Paint only the fighter, with no projectile, glow or particles.'
                        : '',
                ]
                  .filter(Boolean)
                  .join(' ');
              const colorsFor = (character: FighterCharacter): string =>
                [
                  fighterSpec.palette[character.colorSlot],
                  fighterSpec.palette[Math.max(5, character.colorSlot - 1)],
                  fighterSpec.palette[13],
                  fighterSpec.palette[14],
                  fighterSpec.palette[15],
                ]
                  .filter((color): color is string => !!color)
                  .filter((hex) => {
                    const r = Number.parseInt(hex.slice(1, 3), 16);
                    const g = Number.parseInt(hex.slice(3, 5), 16);
                    const b = Number.parseInt(hex.slice(5, 7), 16);
                    return !(g > r * 1.15 && g > b * 1.15);
                  })
                  .join(', ');
              const identity = photoReference ? describeVisibleTraits(feat) : undefined;
              const artDirection = fighterArtDirectionPrompt(fighterSpec.artDirection);
              const pipelineFingerprint = JSON.stringify({
                promptVersions: {
                  identity: GENERATED_FIGHTER_POSE_PROMPT_VERSION,
                  poseSheet: FIGHTER_POSE_SHEET_PROMPT_VERSION,
                  atlas: GENERATED_FIGHTER_ATLAS_PROMPT_VERSION,
                  identityJudge: FIGHTER_IDENTITY_JUDGE_PROMPT_VERSION,
                  poseJudge: FIGHTER_POSE_JUDGE_PROMPT_VERSION,
                  pipeline: FIGHTER_ROSTER_PIPELINE_PROMPT_VERSION,
                },
                roster: roster.map(({ slot, character, photoIdentity }) => ({
                  slot,
                  character,
                  photoIdentity,
                })),
                artDirection: fighterSpec.artDirection,
                keyArt: sha256(keyArt),
                photo: photoReference ? sha256(photoReference) : null,
              });
              const pipelineHashes = new Map<FighterRosterSlot, string>();
              const cached: Partial<Record<FighterRosterSlot, Buffer>> = {};
              const fighterArtifacts = new ArtifactCache(
                join(this.files.checkpointsDir, jobId, 'fighter'),
              );

              interface IdentityCandidate extends FighterIdentityCandidateDescriptor {
                raw: Buffer;
                processed: Buffer;
              }
              interface PoseCandidate extends FighterPoseCandidateDescriptor {
                processed: Buffer;
              }
              const generatedCandidateUncached = async (opts: {
                role: string;
                label: string;
                prompt: string;
                reference: Buffer;
              }): Promise<{ raw: Buffer; processed: Buffer } | null> => {
                let raw: Buffer;
                try {
                  raw = await callImage({
                    role: opts.role,
                    label: opts.label,
                    prompt: opts.prompt,
                    reference: opts.reference,
                    size: '1024x1024',
                  });
                } catch (error) {
                  throwIfSuspended(error);
                  if (abort.signal.aborted) throw error;
                  if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                  validationFailure(opts.role);
                  emit('building-assets', `${opts.label} was unavailable; continuing the pool…`);
                  return null;
                }
                try {
                  const processed = await processGeneratedFighterPose(raw, {
                    removeGreenSpill: true,
                  });
                  return { raw, processed: processed.png };
                } catch {
                  validationFailure(opts.role);
                  emit('building-assets', `${opts.label} failed local sprite validation`);
                  return null;
                }
              };

              const generatedCandidate = (opts: Parameters<typeof generatedCandidateUncached>[0]) =>
                fighterArtifacts.getOrCompute(
                  imagePromptHash(
                    JSON.stringify([
                      'candidate-v1',
                      job.attempt,
                      GENERATED_FIGHTER_POSE_PROMPT_VERSION,
                      opts.role,
                      opts.prompt,
                    ]),
                    opts.reference,
                  ),
                  () => generatedCandidateUncached(opts),
                );
              emit('building-assets', 'Preparing unfinished fighter identity foundations…');
              // Each character starts when its own source is ready. The boss's
              // story illustration must not hold up the other four identities.
              const identityPools = await settleAll(
                roster.map(async (entry) => {
                  const source = await entry.source;
                  const hash = imagePromptHash(pipelineFingerprint, source);
                  pipelineHashes.set(entry.slot, hash);
                  const atlas = assetWorkspace.load(
                    FIGHTER_ROSTER_ASSET_ROLES[entry.slot],
                    FIGHTER_ROSTER_PIPELINE_PROMPT_VERSION,
                    hash,
                  );
                  if (atlas) {
                    try {
                      await validateGeneratedFighterAtlas(atlas);
                      cached[entry.slot] = atlas;
                      return [];
                    } catch {
                      await assetWorkspace.discard([FIGHTER_ROSTER_ASSET_ROLES[entry.slot]]);
                    }
                  }
                  return settleAll(
                    [1, 2, 3].map(async (index): Promise<IdentityCandidate | null> => {
                      const id = `${entry.slot}-I${index}`;
                      const result = await generatedCandidate({
                        role: `fighter-${id}`,
                        label: `${entry.character.name} identity ${index}`,
                        prompt: buildFighterIdentityCandidatePrompt({
                          candidateId: id,
                          name: entry.character.name,
                          visualConcept: conceptFor(entry.character),
                          build: entry.character.build,
                          outfit: entry.character.outfit,
                          artDirection,
                          colors: colorsFor(entry.character),
                          source: entry.sourceKind,
                          ...(entry.photoIdentity && identity ? { identity } : {}),
                        }),
                        reference: source,
                      });
                      return result
                        ? {
                            id,
                            slot: entry.slot,
                            name: entry.character.name,
                            visualConcept: conceptFor(entry.character),
                            photoIdentity: entry.photoIdentity,
                            ...result,
                          }
                        : null;
                    }),
                  );
                }),
              );
              const pendingRoster = roster.filter((entry) => !cached[entry.slot]);
              const restoredCount = roster.length - pendingRoster.length;
              if (restoredCount)
                emit(
                  'building-assets',
                  `Restored ${restoredCount}/5 completed fighter atlases; generating only the unfinished roster slots`,
                );
              if (!pendingRoster.length) {
                fighterArtStatus = { mode: 'generated', attempted: true };
                return;
              }
              const bossArt = await storyAssets.boss;
              const identityCandidates = identityPools
                .flat()
                .filter((candidate): candidate is IdentityCandidate => candidate !== null);
              for (const entry of pendingRoster) {
                if (!identityCandidates.some((candidate) => candidate.slot === entry.slot)) {
                  throw new Error(
                    `${entry.character.name} has no locally valid identity foundation`,
                  );
                }
              }

              // A completed atlas must not change the already-approved identity
              // selection for unfinished fighters and trigger another cast review.
              const selectionKey = imagePromptHash(
                JSON.stringify([
                  'fighter-identity-selection-v1',
                  job.attempt,
                  pipelineFingerprint,
                  FIGHTER_ROSTER_SLOTS.map((slot) => pipelineHashes.get(slot)),
                ]),
              );
              const selectedIdentityIds = await fighterArtifacts.getOrCompute(
                selectionKey,
                async () => {
                  const identityDescriptors: FighterIdentityCandidateDescriptor[] =
                    identityCandidates.map(({ id, slot, name, visualConcept, photoIdentity }) => ({
                      id,
                      slot,
                      name,
                      visualConcept,
                      photoIdentity,
                    }));
                  const identityBoard = await buildFighterIdentityJudgeBoard({
                    ...(photoReference ? { sourcePhoto: photoReference } : {}),
                    keyArt,
                    bossArt,
                    candidates: identityCandidates,
                  });
                  const firstIdentityBySlot = Object.fromEntries(
                    pendingRoster.map(({ slot }) => [
                      slot,
                      identityDescriptors.find((candidate) => candidate.slot === slot)!,
                    ]),
                  ) as Partial<Record<FighterRosterSlot, FighterIdentityCandidateDescriptor>>;
                  const mockIdentityDecision = {
                    candidateReviews: identityDescriptors.map(({ id, slot }) => ({
                      id,
                      slot,
                      scores: { identity: 5, concept: 5, costume: 5, silhouette: 5, technical: 5 },
                      fatalIssues: [],
                      summary: 'Mock identity-safe roster foundation.',
                    })),
                    selections: pendingRoster.map(({ slot }) => ({
                      slot,
                      accepted: true,
                      candidateId: firstIdentityBySlot[slot]!.id,
                      confidence: 1,
                      rationale: 'Mock selection.',
                      retryGuidance: '',
                    })),
                    castReview: {
                      distinctiveness: 5,
                      styleConsistency: 5,
                      fatalIssues: [],
                      summary: 'Mock coherent and distinct cast.',
                    },
                  };
                  let rawIdentityDecision: unknown = mockIdentityDecision;
                  if (!mockImages) {
                    const prompt = buildFighterIdentityJudgePrompt(
                      identityDescriptors,
                      fighterSpec.artDirection,
                    );
                    rawIdentityDecision = await callLlm(
                      'design',
                      {
                        ...prompt,
                        jsonSchema: buildFighterIdentityJudgeSchema(identityDescriptors),
                        maxTokens: 5200,
                        timeoutMs: 120_000,
                      },
                      {
                        stage: 'building-assets',
                        label: 'Spark selected the fighter identity foundations',
                        image: identityBoard,
                        reasoningEffort: 'low',
                      },
                    );
                  }
                  const identityDecision = normalizeFighterIdentityJudgeDecision(
                    rawIdentityDecision,
                    identityDescriptors,
                  );
                  const selectedIds = bestFighterIdentityCandidateIds(identityDecision);
                  for (const { slot } of pendingRoster)
                    if (
                      !identityCandidates.some(
                        (candidate) =>
                          candidate.slot === slot && candidate.id === selectedIds[slot],
                      )
                    )
                      throw new Error(`Spark did not select a ${slot} identity`);
                  return selectedIds;
                },
              );
              const selectedFoundations = Object.fromEntries(
                pendingRoster.map(({ slot }) => {
                  const selected = identityCandidates.find(
                    (candidate) =>
                      candidate.slot === slot && candidate.id === selectedIdentityIds[slot],
                  );
                  if (!selected) throw new Error(`Spark did not select a ${slot} identity`);
                  return [slot, selected];
                }),
              ) as Partial<Record<FighterRosterSlot, IdentityCandidate>>;
              emit(
                'building-assets',
                `Spark selected ${pendingRoster.length} fighter identit${pendingRoster.length === 1 ? 'y' : 'ies'}`,
              );

              const actionPoses = actionPosesFromSheets();
              const atlasResults = await Promise.allSettled(
                pendingRoster.map(async (entry): Promise<readonly [FighterRosterSlot, Buffer]> => {
                  const foundation = selectedFoundations[entry.slot]!;
                  const anchor = await prepareGeneratedFighterReference(foundation.raw);
                  const generatePoseCandidate = async (
                    pose: GeneratedFighterPose,
                    suffix: string,
                    retryGuidance?: string,
                  ): Promise<PoseCandidate | null> => {
                    const id = `${entry.slot}-${pose}-${suffix}`;
                    const result = await generatedCandidate({
                      role: `fighter-${id}`,
                      label: `${entry.character.name} ${pose} ${suffix}`,
                      prompt: buildFighterPosePrompt(pose, {
                        artDirection,
                        outfit: conceptFor(entry.character),
                        colors: colorsFor(entry.character),
                        candidateId: id,
                        ...(entry.photoIdentity && identity ? { identity } : {}),
                        ...(retryGuidance ? { retryGuidance } : {}),
                      }),
                      reference: anchor,
                    });
                    return result ? { id, pose, processed: result.processed } : null;
                  };

                  const sheetSeed = await buildFighterPoseSheetSeed(anchor);
                  const generatePoseSheetUncached = async (
                    group: FighterPoseSheetGroup,
                  ): Promise<PoseCandidate[]> => {
                    const id = `${entry.slot}-sheet-${group.id}`;
                    let raw: Buffer;
                    try {
                      raw = await callImage({
                        role: `fighter-${id}`,
                        label: `${entry.character.name} ${group.label.toLowerCase()} sheet`,
                        prompt: buildFighterPoseSheetPrompt(group, {
                          artDirection,
                          outfit: conceptFor(entry.character),
                          colors: colorsFor(entry.character),
                          candidateId: id,
                          ...(entry.photoIdentity && identity ? { identity } : {}),
                        }),
                        reference: sheetSeed,
                        size: '1024x1024',
                      });
                    } catch (error) {
                      throwIfSuspended(error);
                      if (abort.signal.aborted) throw error;
                      if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                      validationFailure(`fighter-${id}`);
                      emit(
                        'building-assets',
                        `${entry.character.name}'s ${group.id} sheet was unavailable; recovering its poses individually…`,
                      );
                      return [];
                    }

                    let cells: FighterPoseSheetCellResult[];
                    try {
                      cells = await splitGeneratedFighterPoseSheet(raw, group);
                    } catch {
                      validationFailure(`fighter-${id}`);
                      emit(
                        'building-assets',
                        `${entry.character.name}'s ${group.id} sheet could not be split; recovering its poses individually…`,
                      );
                      return [];
                    }
                    const valid = cells.flatMap((cell): PoseCandidate[] => {
                      if (!cell.processed) {
                        validationFailure(`fighter-${entry.slot}-${cell.pose}-sheet-cell`);
                        emit(
                          'building-assets',
                          `${entry.character.name}'s ${cell.pose} sheet cell failed local validation`,
                        );
                        return [];
                      }
                      return [
                        {
                          id: `${entry.slot}-${cell.pose}-S`,
                          pose: cell.pose,
                          processed: cell.processed,
                        },
                      ];
                    });
                    const reclaimed = cells.reduce(
                      (total, cell) => total + cell.segmentation.reclaimedBleedPixels,
                      0,
                    );
                    const excluded = cells.reduce(
                      (total, cell) => total + cell.segmentation.excludedNeighborPixels,
                      0,
                    );
                    emit(
                      'building-assets',
                      `${entry.character.name}'s ${group.id} sheet yielded ${valid.length}/6 poses${reclaimed || excluded ? ` (${reclaimed} bleed pixels reclaimed, ${excluded} neighbor pixels reassigned)` : ''}`,
                    );
                    return valid;
                  };

                  const generatePoseSheet = (group: FighterPoseSheetGroup) =>
                    fighterArtifacts.getOrCompute(
                      imagePromptHash(
                        JSON.stringify([
                          'sheet-v1',
                          job.attempt,
                          FIGHTER_POSE_SHEET_PROMPT_VERSION,
                          pipelineHashes.get(entry.slot),
                          group.id,
                        ]),
                        sheetSeed,
                      ),
                      () => generatePoseSheetUncached(group),
                    );
                  const candidates = (
                    await settleAll(
                      FIGHTER_POSE_SHEET_GROUPS.map((group) => generatePoseSheet(group)),
                    )
                  ).flat();
                  const missing = actionPoses.filter(
                    (pose) => !candidates.some((candidate) => candidate.pose === pose),
                  );
                  if (missing.length > 0) {
                    emit(
                      'building-assets',
                      `Repainting ${missing.length} rejected ${entry.character.name} sheet cells individually, with one bounded second attempt if needed…`,
                    );
                    const recoveries = await recoverRejectedFighterSheetCells(
                      missing,
                      generatePoseCandidate,
                    );
                    candidates.push(...recoveries);
                  }
                  const unrecovered = actionPoses.filter(
                    (pose) => !candidates.some((candidate) => candidate.pose === pose),
                  );
                  const availablePoses = new Set<GeneratedFighterPose>([
                    'idle',
                    ...candidates.map(({ pose }) => pose),
                  ]);
                  const mechanicalFallbacks: Array<{
                    pose: GeneratedFighterPose;
                    sourcePose: GeneratedFighterPose;
                  }> = [];
                  for (const pose of unrecovered) {
                    const sourcePose = bestAvailableFighterPoseFallback(pose, availablePoses);
                    const processed =
                      sourcePose === 'idle'
                        ? foundation.processed
                        : candidates.find((candidate) => candidate.pose === sourcePose)?.processed;
                    if (!sourcePose || !processed) {
                      throw new Error(
                        `${entry.character.name} has no mechanically valid fallback for ${pose}`,
                      );
                    }
                    candidates.push({
                      id: `${entry.slot}-${pose}-F-${sourcePose}`,
                      pose,
                      processed,
                    });
                    mechanicalFallbacks.push({ pose, sourcePose });
                  }
                  if (mechanicalFallbacks.length > 0) {
                    emit(
                      'building-assets',
                      `${entry.character.name} kept playable fallback states after bounded recovery: ${mechanicalFallbacks.map(({ pose, sourcePose }) => `${pose}←${sourcePose}`).join(', ')}`,
                    );
                  }

                  const review = async (
                    pool: readonly PoseCandidate[],
                  ): Promise<ReturnType<typeof normalizeFighterPoseJudgeDecision>> => {
                    const descriptors: FighterPoseCandidateDescriptor[] = pool.map(
                      ({ id, pose }) => ({ id, pose }),
                    );
                    const board = await buildFighterPoseJudgeBoard({
                      fighterName: entry.character.name,
                      anchor: foundation.processed,
                      candidates: pool,
                    });
                    const firstByPose = Object.fromEntries(
                      actionPoses.map((pose) => [
                        pose,
                        descriptors.find((candidate) => candidate.pose === pose)!,
                      ]),
                    ) as Record<GeneratedFighterPose, FighterPoseCandidateDescriptor>;
                    const mockDecision = {
                      candidateReviews: descriptors.map(({ id, pose }) => ({
                        id,
                        pose,
                        scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
                        fatalIssues: [],
                        summary: 'Mock identity-consistent pose.',
                      })),
                      selections: actionPoses.map((pose) => ({
                        pose,
                        candidateId: firstByPose[pose].id,
                        rationale: 'Mock selection.',
                      })),
                      setReview: {
                        accepted: true,
                        identityConsistency: 5,
                        costumeConsistency: 5,
                        scaleConsistency: 5,
                        poseReadability: 5,
                        fatalIssues: [],
                        summary: 'Mock complete pose set.',
                      },
                      retryPoses: [],
                    };
                    let rawDecision: unknown = mockDecision;
                    if (!mockImages) {
                      const prompt = buildFighterPoseJudgePrompt(
                        entry.character.name,
                        descriptors,
                        actionPoses,
                        fighterSpec.artDirection,
                      );
                      rawDecision = await callLlm(
                        'design',
                        {
                          ...prompt,
                          jsonSchema: buildFighterPoseJudgeSchema(descriptors, actionPoses),
                          maxTokens: 6200,
                          timeoutMs: 120_000,
                        },
                        {
                          stage: 'building-assets',
                          label: `Spark reviewed ${entry.character.name}'s complete pose set`,
                          image: board,
                          reasoningEffort: 'low',
                        },
                      );
                    }
                    return normalizeFighterPoseJudgeDecision(rawDecision, descriptors, actionPoses);
                  };

                  let decision = await review(candidates);
                  if (!decision.setReview.accepted) {
                    const retryPoses = fighterPosesNeedingRetry(decision, actionPoses, 4);
                    if (retryPoses.length > 0) {
                      emit(
                        'building-assets',
                        `Repainting ${retryPoses.length} weak ${entry.character.name} poses with Spark guidance…`,
                      );
                      const alternatives = (
                        await settleAll(
                          retryPoses.flatMap(({ pose, guidance }) => [
                            generatePoseCandidate(pose, 'B', guidance),
                            generatePoseCandidate(pose, 'C', guidance),
                          ]),
                        )
                      ).filter((candidate): candidate is PoseCandidate => candidate !== null);
                      candidates.push(...alternatives);
                      decision = await review(candidates);
                    }
                  }
                  if (!decision.setReview.accepted) {
                    emit(
                      'building-assets',
                      `Spark still rejected ${entry.character.name}'s pose set after the bounded retry; using its highest-scoring locally valid combination`,
                    );
                  }
                  const selectedIds = bestFighterPoseCandidateIds(decision, actionPoses);
                  const selectedPoses = { idle: foundation.processed } as Record<
                    GeneratedFighterPose,
                    Buffer
                  >;
                  for (const pose of actionPoses) {
                    const selected = candidates.find(
                      (candidate) => candidate.pose === pose && candidate.id === selectedIds[pose],
                    );
                    if (!selected)
                      throw new Error(`Spark did not select ${entry.character.name} ${pose}`);
                    selectedPoses[pose] = selected.processed;
                  }
                  if (
                    mechanicalFallbacks.length === 0 &&
                    new Set(GENERATED_FIGHTER_POSES.map((pose) => sha256(selectedPoses[pose])))
                      .size !== GENERATED_FIGHTER_POSES.length
                  ) {
                    throw new Error(`${entry.character.name} pose set contained duplicate states`);
                  }
                  const atlas = await buildGeneratedFighterAtlas(selectedPoses);
                  await validateGeneratedFighterAtlas(atlas);
                  await assetWorkspace.store(
                    FIGHTER_ROSTER_ASSET_ROLES[entry.slot],
                    atlas,
                    FIGHTER_ROSTER_PIPELINE_PROMPT_VERSION,
                    pipelineHashes.get(entry.slot)!,
                  );
                  return [entry.slot, atlas] as const;
                }),
              );
              for (const result of atlasResults) {
                if (result.status === 'rejected') throw result.reason;
              }
              fighterArtStatus = { mode: 'generated', attempted: true };
            })()
          : Promise.resolve();

      let platformerPlayerArtStatus: GameMetaFile['platformerPlayerArt'];

      type PlatformerIdentityFrames = { idle: Buffer; sideIdle: Buffer };
      let resolvePlatformerIdentity!: (frames: PlatformerIdentityFrames) => void;
      let rejectPlatformerIdentity!: (reason: unknown) => void;
      const platformerIdentityTask = new Promise<PlatformerIdentityFrames>((resolve, reject) => {
        resolvePlatformerIdentity = resolve;
        rejectPlatformerIdentity = reject;
      });
      void platformerIdentityTask.catch(() => {});
      const platformerPlayerSource = photoReference ? Promise.resolve(photoReference) : keyArtTask;
      const platformerPlayerTask =
        spec.archetype === 'platformer'
          ? platformerPlayerSource.then(async (playerReference): Promise<void> => {
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              try {
                const pipelineFingerprint = JSON.stringify({
                  promptVersions: {
                    pose: GENERATED_PLATFORMER_POSE_PROMPT_VERSION,
                    idleJudge: PLATFORMER_IDLE_JUDGE_PROMPT_VERSION,
                    poseJudge: PLATFORMER_POSE_JUDGE_PROMPT_VERSION,
                    jumpJudge: PLATFORMER_JUMP_JUDGE_PROMPT_VERSION,
                  },
                  heroConcept: canonicalHeroConcept,
                  colors,
                  sourceKind: photoReference ? 'photo' : 'key-art',
                });
                const pipelineSha = imagePromptHash(pipelineFingerprint, playerReference);
                const identityFrameCache = new ArtifactCache(
                  join(this.files.checkpointsDir, jobId, 'platformer-identity'),
                );
                const cached = Object.fromEntries(
                  GENERATED_PLATFORMER_POSES.map((pose) => [
                    pose,
                    assetWorkspace.load(
                      PLATFORMER_ASSET_ROLES[pose],
                      PLATFORMER_PLAYER_PIPELINE_PROMPT_VERSION,
                      pipelineSha,
                    ),
                  ]),
                ) as Record<GeneratedPlatformerPose, Buffer | null>;
                if (GENERATED_PLATFORMER_POSES.every((pose) => cached[pose])) {
                  const restored = cached as Record<GeneratedPlatformerPose, Buffer>;
                  await validateGeneratedPlatformerPoseSet(restored, { strictMotion: false });
                  resolvePlatformerIdentity(
                    identityFrameCache.read<PlatformerIdentityFrames>(pipelineSha) ?? {
                      idle: restored.idle,
                      sideIdle: restored.sideIdle,
                    },
                  );
                  emit('building-assets', 'Restored the selected platformer player animation');
                  platformerPlayerArtStatus = { mode: 'generated', attempted: true };
                  return;
                }

                type CandidateKind = 'idle' | 'side-anchor' | 'phase-a' | 'phase-b' | 'jump';
                interface Candidate {
                  id: string;
                  kind: CandidateKind;
                  reference: Buffer;
                  png: Buffer;
                }
                const generateCandidateUncached = async (
                  id: string,
                  kind: CandidateKind,
                  label: string,
                  prompt: string,
                  reference: Buffer,
                ): Promise<Candidate | null> => {
                  let raw: Buffer;
                  try {
                    raw = await callImage({
                      role: `platformer-${id}`,
                      label,
                      prompt,
                      reference,
                      size: '1024x1024',
                    });
                  } catch (error) {
                    throwIfSuspended(error);
                    if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                    validationFailure(`platformer-${id}`);
                    emit(
                      'building-assets',
                      `${label} was rejected; continuing the candidate pool…`,
                    );
                    return null;
                  }
                  try {
                    let normalizedReference = raw;
                    let processed;
                    try {
                      processed = await processGeneratedPlatformerPose(raw);
                    } catch (initialError) {
                      throwIfSuspended(initialError);
                      const recovery = await recoverGeneratedPlatformerGreenPanel(raw);
                      if (!recovery.recovered) throw initialError;
                      normalizedReference = recovery.image;
                      processed = await processGeneratedPlatformerPose(normalizedReference);
                    }
                    return {
                      id,
                      kind,
                      png: processed.png,
                      // Only identity foundations are used as future model
                      // references. Keep animation cache entries tiny.
                      reference:
                        kind === 'idle' || kind === 'side-anchor'
                          ? normalizedReference
                          : processed.png,
                    };
                  } catch (error) {
                    throwIfSuspended(error);
                    validationFailure(`platformer-${id}`);
                    feed(
                      'decision',
                      `${label} could not fit the sprite constraints`,
                      'building-assets',
                      {
                        category: 'sprite-validation',
                        candidateId: id,
                        reason: (error instanceof Error ? error.message : String(error)).slice(
                          0,
                          500,
                        ),
                      },
                    );
                    emit('building-assets', `${label} failed local sprite validation`);
                    return null;
                  }
                };

                const candidateCache = new ArtifactCache(
                  join(this.files.checkpointsDir, jobId, 'artifacts'),
                );
                const generateCandidate = (...args: Parameters<typeof generateCandidateUncached>) =>
                  candidateCache.getOrCompute(
                    imagePromptHash(
                      JSON.stringify([
                        'platformer-candidate-v1',
                        job.attempt,
                        GENERATED_PLATFORMER_POSE_PROMPT_VERSION,
                        args[0],
                        args[1],
                        args[3],
                      ]),
                      args[4],
                    ),
                    () => generateCandidateUncached(...args),
                  );

                const judge = async (
                  prompt: { system: string; user: string },
                  jsonSchema: Record<string, unknown>,
                  image: Buffer,
                  maxTokens: number,
                  label: string,
                  mockDecision: unknown,
                ): Promise<unknown> => {
                  if (mockImages) return mockDecision;
                  try {
                    return await callLlm(
                      'design',
                      {
                        ...prompt,
                        jsonSchema,
                        maxTokens,
                        timeoutMs: 120_000,
                      },
                      {
                        stage: 'building-assets',
                        label,
                        image,
                        reasoningEffort: 'low',
                      },
                    );
                  } catch (error) {
                    throwIfSuspended(error);
                    if (abort.signal.aborted) throw error;
                    throw new Error(
                      `platformer art review failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                };

                let idle: Candidate | undefined;
                let retryGuidance = '';
                let idleRetried = false;
                const idleRetryStarted = Date.now();
                for (let round = 1; round <= 2 && !idle; round++) {
                  emit(
                    'building-assets',
                    round === 1
                      ? 'Painting three player identity foundations…'
                      : 'Repainting the player identity foundations with Spark guidance…',
                  );
                  const offset = (round - 1) * 3;
                  const idleCandidates = (
                    await settleAll(
                      [1, 2, 3].map((index) => {
                        const id = `I${offset + index}`;
                        return generateCandidate(
                          id,
                          'idle',
                          `Player identity candidate ${id}`,
                          buildPlatformerIdleCandidatePrompt(id, {
                            heroConcept: canonicalHeroConcept,
                            colors,
                            ...(retryGuidance ? { retryGuidance } : {}),
                          }),
                          playerReference,
                        );
                      }),
                    )
                  ).filter((candidate): candidate is Candidate => candidate !== null);
                  if (idleCandidates.length === 0) {
                    idleRetried = true;
                    retryGuidance =
                      'Return exactly one centered, uncropped adult character on a completely flat #00ff00 background.';
                    continue;
                  }
                  const descriptors: PlatformerIdleCandidateDescriptor[] = idleCandidates.map(
                    ({ id }) => ({ id }),
                  );
                  const board = await buildPlatformerIdleJudgeBoard({
                    source: playerReference,
                    candidates: idleCandidates.map(({ id, reference: raw, png: processed }) => ({
                      id,
                      raw,
                      processed,
                    })),
                  });
                  const judgePrompt = buildPlatformerIdleJudgePrompt(descriptors, {
                    heroConcept: canonicalHeroConcept,
                    sourceKind: photoReference ? 'photo' : 'key-art',
                  });
                  const mockDecision = {
                    sourceReview: { eyewear: 'absent', summary: 'Mock source identity.' },
                    candidateReviews: descriptors.map(({ id }) => ({
                      id,
                      eyewear: 'absent',
                      eyewearMatch: true,
                      scores: {
                        identity: 5,
                        faceAndHair: 5,
                        accessories: 5,
                        costume: 5,
                        proportions: 5,
                        pose: 5,
                        technical: 5,
                      },
                      fatalIssues: [],
                      summary: 'Mock identity-safe foundation.',
                    })),
                    selection: {
                      accepted: true,
                      candidateId: descriptors[0]!.id,
                      confidence: 1,
                      rationale: 'Mock selection.',
                      retryGuidance: '',
                    },
                  };
                  const decision = normalizePlatformerIdleJudgeDecision(
                    await judge(
                      judgePrompt,
                      buildPlatformerIdleJudgeSchema(descriptors),
                      board,
                      2600,
                      'Spark selected the player identity foundation',
                      mockDecision,
                    ),
                    descriptors,
                  );
                  const selectedId = decision.selection.accepted
                    ? decision.selection.candidateId
                    : bestPlatformerIdleCandidateId(decision);
                  idle = idleCandidates.find(({ id }) => id === selectedId);
                  emit(
                    'building-assets',
                    decision.selection.accepted
                      ? `Spark selected ${selectedId} as the player identity foundation`
                      : `Spark selected ${selectedId} as the best available player identity foundation`,
                  );
                }
                if (!idle) {
                  throw new Error('no locally valid front-idle identity foundation was available');
                }
                if (idleRetried) {
                  recordEarlyRepairEvent(
                    'entities',
                    'platformer-idle-candidate-retry',
                    [
                      {
                        code: 'PLATFORMER_IDLE_FOUNDATION_REJECTED',
                        path: '/assets/platformer-player/idle',
                        message: retryGuidance.slice(0, 240),
                      },
                    ],
                    [],
                    idleRetryStarted,
                    'fixed',
                  );
                }
                const idleReference = await prepareGeneratedPlatformerReference(idle.reference);

                const sideAnchor = await generateCandidate(
                  'side-anchor',
                  'side-anchor',
                  'Player neutral side identity anchor',
                  buildPlatformerSideAnchorPrompt({ colors }),
                  idleReference,
                );
                if (!sideAnchor) {
                  throw new Error('the neutral side identity anchor failed local validation');
                }
                const identityFrames = { idle: idle.png, sideIdle: sideAnchor.png };
                identityFrameCache.write(pipelineSha, identityFrames);
                resolvePlatformerIdentity(identityFrames);
                const sideReference = await prepareGeneratedPlatformerReference(
                  sideAnchor.reference,
                );

                emit('building-assets', 'Painting six run candidates and three jump poses…');
                const runTasks: Array<Promise<Candidate | null>> = [];
                for (let index = 1; index <= 3; index++) {
                  runTasks.push(
                    generateCandidate(
                      `A${index}`,
                      'phase-a',
                      `Player run Phase A candidate ${index}`,
                      buildPlatformerPhaseACandidatePrompt(index, { colors }),
                      sideReference,
                    ),
                    generateCandidate(
                      `B${index}`,
                      'phase-b',
                      `Player run Phase B candidate ${index}`,
                      buildPlatformerPhaseBCandidatePrompt(index, { colors }),
                      sideReference,
                    ),
                  );
                }
                const [runResults, jumpResults] = await settleAll([
                  settleAll(runTasks),
                  settleAll(
                    [1, 2, 3].map((index) =>
                      generateCandidate(
                        `J${index}`,
                        'jump',
                        `Player jump candidate ${index}`,
                        buildPlatformerJumpCandidatePrompt(index, {
                          heroConcept: canonicalHeroConcept,
                          colors,
                        }),
                        sideReference,
                      ),
                    ),
                  ),
                ]);
                const sourceKind = photoReference ? ('photo' as const) : ('key-art' as const);
                const selectJump = async () => {
                  const jumpCandidates = jumpResults.filter(
                    (candidate): candidate is Candidate => candidate !== null,
                  );
                  const reviewJumpCandidates = async (candidates: Candidate[]) => {
                    const jumpDescriptors: PlatformerJumpCandidateDescriptor[] = candidates.map(
                      ({ id }) => ({ id }),
                    );
                    const board = await buildPlatformerJumpJudgeBoard({
                      source: playerReference,
                      sourceKind,
                      idle: idle.png,
                      sideAnchor: sideAnchor.png,
                      candidates: candidates.map(({ id, png: processed }) => ({ id, processed })),
                    });
                    const mockDecision = {
                      candidateReviews: jumpDescriptors.map(({ id }) => ({
                        id,
                        scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
                        fatalIssues: [],
                        summary: 'Mock identity-safe jump candidate.',
                      })),
                      selection: {
                        accepted: true,
                        candidateId: jumpDescriptors[0]!.id,
                        confidence: 1,
                        rationale: 'Mock selection.',
                        retryGuidance: '',
                      },
                    };
                    return normalizePlatformerJumpJudgeDecision(
                      await judge(
                        buildPlatformerJumpJudgePrompt(jumpDescriptors, {
                          heroConcept: canonicalHeroConcept,
                          sourceKind,
                        }),
                        buildPlatformerJumpJudgeSchema(jumpDescriptors),
                        board,
                        2400,
                        'Spark selected the player jump pose',
                        mockDecision,
                      ),
                      jumpDescriptors,
                    );
                  };

                  let jumpDecision =
                    jumpCandidates.length > 0
                      ? await reviewJumpCandidates(jumpCandidates)
                      : undefined;
                  const initialJumpGuidance =
                    jumpDecision?.selection.retryGuidance ||
                    'Return the same complete canonical costume and adult identity in a clear RIGHT-facing airborne jump.';
                  let jumpRetried = false;
                  const jumpRetryStarted = Date.now();
                  if (!jumpDecision?.selection.accepted) {
                    jumpRetried = true;
                    emit(
                      'building-assets',
                      'Repainting three jump poses with Spark wardrobe guidance…',
                    );
                    const retryResults = await settleAll(
                      [4, 5, 6].map((index) =>
                        generateCandidate(
                          `J${index}`,
                          'jump',
                          `Player jump retry candidate ${index}`,
                          buildPlatformerJumpCandidatePrompt(index, {
                            heroConcept: canonicalHeroConcept,
                            colors,
                            retryGuidance: initialJumpGuidance,
                          }),
                          sideReference,
                        ),
                      ),
                    );
                    const retryCandidates = retryResults.filter(
                      (candidate): candidate is Candidate => candidate !== null,
                    );
                    jumpCandidates.push(...retryCandidates);
                    if (retryCandidates.length > 0) {
                      jumpDecision = await reviewJumpCandidates(jumpCandidates);
                    }
                  }
                  const selectedJumpId = jumpDecision?.selection.accepted
                    ? jumpDecision.selection.candidateId
                    : jumpDecision
                      ? bestPlatformerJumpCandidateId(jumpDecision)
                      : null;
                  const selectedJump = jumpCandidates.find(({ id }) => id === selectedJumpId);
                  const jump = selectedJump?.png ?? sideAnchor.png;
                  if (selectedJump) {
                    emit(
                      'building-assets',
                      jumpDecision?.selection.accepted
                        ? `Spark selected ${selectedJump.id} for the player jump pose`
                        : `Spark selected ${selectedJump.id} as the best available player jump pose`,
                    );
                  } else {
                    emit(
                      'building-assets',
                      'Jump candidates were unusable; keeping the generated side pose for jumping',
                    );
                  }
                  if (jumpRetried) {
                    recordEarlyRepairEvent(
                      'entities',
                      'platformer-jump-candidate-retry',
                      [
                        {
                          code: 'PLATFORMER_JUMP_CONTINUITY_REJECTED',
                          path: '/assets/platformer-player/jump',
                          message: initialJumpGuidance.slice(0, 240),
                        },
                      ],
                      [],
                      jumpRetryStarted,
                      jumpDecision?.selection.accepted ? 'fixed' : 'downgraded',
                    );
                  }
                  return jump;
                };
                const selectRun = async () => {
                  const runCandidates = runResults.filter(
                    (candidate): candidate is Candidate & { kind: 'phase-a' | 'phase-b' } =>
                      candidate?.kind === 'phase-a' || candidate?.kind === 'phase-b',
                  );
                  const descriptors: PlatformerPoseCandidateDescriptor[] = runCandidates.map(
                    ({ id, kind }) => ({ id, kind }),
                  );
                  if (!descriptors.some(({ kind }) => kind === 'phase-a')) {
                    throw new Error('all Phase A run candidates failed local validation');
                  }
                  if (!descriptors.some(({ kind }) => kind === 'phase-b')) {
                    throw new Error('all Phase B run candidates failed local validation');
                  }
                  const pairBoard = await buildPlatformerPoseJudgeBoard({
                    source: playerReference,
                    idle: idle.png,
                    sideAnchor: sideAnchor.png,
                    candidates: runCandidates.map(({ id, kind, png: processed }) => ({
                      id,
                      kind,
                      processed,
                    })),
                  });
                  const pairPrompt = buildPlatformerPoseJudgePrompt(descriptors);
                  const firstA = descriptors.find(({ kind }) => kind === 'phase-a')!.id;
                  const firstB = descriptors.find(({ kind }) => kind === 'phase-b')!.id;
                  const mockPairDecision = {
                    anchorReview: {
                      identity: 5,
                      sideView: 5,
                      costume: 5,
                      fatalIssues: [],
                      summary: 'Mock side anchor.',
                    },
                    candidateReviews: descriptors.map(({ id, kind }) => ({
                      id,
                      kind,
                      scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
                      fatalIssues: [],
                      summary: 'Mock usable run candidate.',
                    })),
                    pairReviews: descriptors
                      .filter(({ kind }) => kind === 'phase-a')
                      .flatMap(({ id: phaseAId }) =>
                        descriptors
                          .filter(({ kind }) => kind === 'phase-b')
                          .map(({ id: phaseBId }) => ({
                            phaseAId,
                            phaseBId,
                            legAlternation: 5,
                            armAlternation: 5,
                            pairConsistency: 5,
                            fatalIssues: [],
                            summary: 'Mock visibly alternating pair.',
                          })),
                      ),
                    selection: {
                      accepted: true,
                      phaseAId: firstA,
                      phaseBId: firstB,
                      confidence: 1,
                      rationale: 'Mock selection.',
                      retryGuidance: '',
                    },
                  };
                  const pairDecision = normalizePlatformerPoseJudgeDecision(
                    await judge(
                      pairPrompt,
                      buildPlatformerPoseJudgeSchema(descriptors),
                      pairBoard,
                      4000,
                      'Spark selected the player run animation',
                      mockPairDecision,
                    ),
                    descriptors,
                  );
                  const selectedPair = pairDecision.selection.accepted
                    ? pairDecision.selection
                    : bestPlatformerPosePair(pairDecision);
                  if (!selectedPair) throw new Error('Spark did not return any run-pair reviews');
                  const walk1 = runCandidates.find(({ id }) => id === selectedPair.phaseAId)!;
                  const walk2 = runCandidates.find(({ id }) => id === selectedPair.phaseBId)!;
                  emit(
                    'building-assets',
                    pairDecision.selection.accepted
                      ? `Spark selected ${walk1.id} + ${walk2.id} for the player run animation`
                      : `Spark selected ${walk1.id} + ${walk2.id} as the best available run animation`,
                  );

                  return { walk1, walk2 };
                };
                const [jump, { walk1, walk2 }] = await settleAll([selectJump(), selectRun()]);

                const generated = await alignGeneratedPlatformerPoseCanvases({
                  idle: idle.png,
                  sideIdle: sideAnchor.png,
                  walk1: walk1.png,
                  walk2: walk2.png,
                  jump,
                });
                await validateGeneratedPlatformerPoseSet(generated, { strictMotion: false });
                await settleAll(
                  GENERATED_PLATFORMER_POSES.map((pose) =>
                    assetWorkspace.store(
                      PLATFORMER_ASSET_ROLES[pose],
                      generated[pose],
                      PLATFORMER_PLAYER_PIPELINE_PROMPT_VERSION,
                      pipelineSha,
                    ),
                  ),
                );
                platformerPlayerArtStatus = { mode: 'generated', attempted: true };
              } catch (error) {
                throwIfSuspended(error);
                if (abort.signal.aborted) throw error;
                await settleAll([
                  assetWorkspace.discard(Object.values(PLATFORMER_ASSET_ROLES)),
                  assetWorkspace.discardPrivate('platformerReference'),
                  assetWorkspace.discardPrivate('platformerSideReference'),
                ]);
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated platformer pose set failed validation';
                emit(
                  'building-assets',
                  `Platformer player generation failed without a mechanically valid complete set (${reason.slice(0, 120)})`,
                );
                if (error instanceof PipelineError || error instanceof GeneratedAssetStorageError) {
                  throw error;
                }
                throw new PipelineError('image-invalid', reason, 'building-assets');
              }
            })
          : Promise.resolve();

      void platformerPlayerTask.catch(rejectPlatformerIdentity);
      const platformerActionsTask =
        spec.archetype === 'platformer' && spec.actionPoseVersion === 1
          ? platformerIdentityTask.then(async (base) => {
              try {
                await generatePlatformerActions({
                  cache: new ArtifactCache(join(this.files.checkpointsDir, jobId, 'actions')),
                  attempt: job.attempt,
                  spec,
                  base,
                  referenceMode: 'identity',
                  source: photoReference ?? (await keyArtTask),
                  sourceKind: photoReference ? 'photo' : 'key-art',
                  wardrobe: {
                    heroConcept: canonicalHeroConcept,
                    colors: spec.palette
                      .filter((hex) => {
                        const r = parseInt(hex.slice(1, 3), 16),
                          g = parseInt(hex.slice(3, 5), 16),
                          b = parseInt(hex.slice(5, 7), 16);
                        return !(g > r * 1.15 && g > b * 1.15);
                      })
                      .join(', '),
                  },
                  workspace: assetWorkspace,
                  generate: (pose, prompt, reference) =>
                    callImage({
                      role: `platformer-action-${pose}`,
                      label: `Painting player ${pose}`,
                      prompt,
                      reference,
                      size: '1024x1024',
                    }),
                  judge: async (prompt, jsonSchema, image, mockDecision) =>
                    mockImages
                      ? mockDecision
                      : callLlm(
                          'design',
                          { ...prompt, jsonSchema, maxTokens: 3000, timeoutMs: 120_000 },
                          {
                            stage: 'building-assets',
                            label: 'Reviewing player action poses',
                            image,
                            reasoningEffort: 'low',
                          },
                        ),
                  report: (message) => emit('building-assets', message),
                  rejected: (pose) => validationFailure(`platformer-action-${pose}`),
                });
              } catch (error) {
                throwIfSuspended(error);
                if (
                  abort.signal.aborted ||
                  error instanceof PipelineError ||
                  error instanceof GeneratedAssetStorageError
                )
                  throw error;
                throw new PipelineError(
                  'image-invalid',
                  error instanceof Error ? error.message : String(error),
                  'building-assets',
                );
              }
            })
          : Promise.resolve();

      const finishingAssets = await Promise.allSettled([
        storyTask,
        racingPackTask,
        platformerBackdropTask,
        hshooterBackdropTask,
        shooterBackdropTask,
        hshooterBossTask,
        hshooterEnemyTask,
        shooterBossTask,
        shooterEnemyTask,
        adventureRoomPlateTask,
        adventureEnemyTask,
        adventureObjectTask,
        adventureBossTask,
        platformerBossTask,
        platformerEnemyTask,
        platformerPropTask,
        fighterArenaTask,
        fighterTask,
        platformerPlayerTask,
        platformerActionsTask,
        adventurePlayerTask,
        portraitTask,
        portraitDefeatTask,
        playerCraftTask,
      ]);
      if (this.durable?.suspended()) return;
      const finishingFailure = finishingAssets.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (finishingFailure) throw finishingFailure.reason;
      writeFileSync(join(staging, 'game.json'), JSON.stringify(spec, null, 1));
      writeFileSync(
        join(staging, 'mechanics.json'),
        JSON.stringify(mechanicalFingerprint(spec), null, 2),
      );
      const stageCfg = config.stages.design;
      const meta: GameMetaFile = {
        id: gameId,
        status: 'ready',
        createdAt: job.createdAt,
        archetype,
        seed: job.seed,
        engineVersion: ENGINE_VERSION,
        archetypeVersion: archetypes[archetype].version,
        specVersion: SPEC_VERSION,
        title: spec.meta.title,
        tagline: spec.meta.tagline,
        sourcePrompt: job.promptText,
        sourceKind: job.sourceKind,
        ...(job.presetId ? { presetId: job.presetId } : {}),
        ...(job.requestedArchetype ? { requestedArchetype: job.requestedArchetype } : {}),
        ...(job.creationBrief ? { creationBrief: job.creationBrief } : {}),
        hadPhoto: !!photo,
        model: stageCfg.model,
        provider: process.env.SPARKADE_PROVIDER ?? stageCfg.provider,
        costUsd: this.db.gameCost(gameId),
        costBreakdown: this.db.usageForGame(gameId),
        priceSnapshot: snapshot,
        imagePriceSnapshot: {
          model: imageModel,
          perImageUsd: mockImages ? 0 : imagePrice,
        },
        ...(fighterArtStatus ? { fighterArt: fighterArtStatus } : {}),
        ...(racingArtStatus ? { racingArt: racingArtStatus } : {}),
        ...(fighterArenaArtStatus ? { fighterArenaArt: fighterArenaArtStatus } : {}),
        ...(platformerPlayerArtStatus ? { platformerPlayerArt: platformerPlayerArtStatus } : {}),
        ...(platformerBossArtStatus ? { platformerBossArt: platformerBossArtStatus } : {}),
        ...(platformerEnemyArtStatus ? { platformerEnemyArt: platformerEnemyArtStatus } : {}),
        ...(platformerPropArtStatus ? { platformerPropArt: platformerPropArtStatus } : {}),
        ...(platformerBackdropArtStatus
          ? { platformerBackdropArt: platformerBackdropArtStatus }
          : {}),
        ...(hshooterBackdropArtStatus ? { hshooterBackdropArt: hshooterBackdropArtStatus } : {}),
        ...(shooterBackdropArtStatus ? { shooterBackdropArt: shooterBackdropArtStatus } : {}),
        ...(hshooterBossArtStatus ? { hshooterBossArt: hshooterBossArtStatus } : {}),
        ...(hshooterEnemyArtStatus ? { hshooterEnemyArt: hshooterEnemyArtStatus } : {}),
        ...(shooterBossArtStatus ? { shooterBossArt: shooterBossArtStatus } : {}),
        ...(shooterEnemyArtStatus ? { shooterEnemyArt: shooterEnemyArtStatus } : {}),
        ...(adventureRoomPlateArtStatus
          ? { adventureRoomPlateArt: adventureRoomPlateArtStatus }
          : {}),
        ...(adventurePlayerArtStatus ? { adventurePlayerArt: adventurePlayerArtStatus } : {}),
        ...(adventureBossArtStatus ? { adventureBossArt: adventureBossArtStatus } : {}),
        ...(adventureEnemyArtStatus ? { adventureEnemyArt: adventureEnemyArtStatus } : {}),
        ...(adventureObjectArtStatus ? { adventureObjectArt: adventureObjectArtStatus } : {}),
        ...(hshooterPlayerCraftArtStatus
          ? { hshooterPlayerCraftArt: hshooterPlayerCraftArtStatus }
          : {}),
        ...(shooterPlayerCraftArtStatus
          ? { shooterPlayerCraftArt: shooterPlayerCraftArtStatus }
          : {}),
      };
      writeFileSync(join(staging, 'meta.json'), JSON.stringify(meta, null, 2));

      if (this.canceled.has(jobId)) throw new PipelineError('canceled', 'canceled', 'failed');
      this.files.publish(jobId, gameId);

      this.db.upsertGame({
        id: gameId,
        title: spec.meta.title,
        tagline: spec.meta.tagline,
        archetype,
        status: 'ready',
        createdAt: job.createdAt,
        golden: false,
        jobId,
        costUsd: meta.costUsd,
        cover: this.files.coverFor(spec, gameId),
        failure: null,
        engineVersion: ENGINE_VERSION,
        archetypeVersion: archetypes[archetype].version,
      });
      this.db.updateJob(jobId, {
        status: 'done',
        stage: 'done',
        detail: 'Ready to play',
        finishedAt: nowIso(),
      });
      const completedRepairs = this.db
        .repairEventsForJob(jobId)
        .filter((event) => event.attempt === job.attempt);
      const recoveredIncident = hasSubstantiveRepair(completedRepairs)
        ? captureIncident(
            'recovered',
            {
              code: 'repaired-generation',
              message: `generation published after ${completedRepairs.filter((event) => event.action !== 'normalize').length} repair action(s)`,
              stage: 'validating',
            },
            spec,
          )
        : null;
      if (job.attempt > 1) {
        try {
          this.incidents?.markRetry(
            jobId,
            job.attempt - 1,
            job.attempt,
            'succeeded',
            recoveredIncident?.id,
          );
        } catch (error) {
          throwIfSuspended(error);
          console.warn('could not update generation incident retry outcome:', error);
        }
      }
      feed('complete', `${spec.meta.title} is ready to play`, 'done', {
        title: spec.meta.title,
        tagline: spec.meta.tagline,
        archetype,
        costUsd: meta.costUsd,
        elapsedMs: Date.now() - startedAt,
      });
      this.hub.emit({
        type: 'done',
        jobId,
        gameId,
        elapsedMs: Date.now() - startedAt,
        costUsd: meta.costUsd,
      });
    } catch (e) {
      // Suspending for a durable provider step is not a failed attempt.
      if (this.durable?.suspended()) return;
      if (this.canceled.has(jobId)) {
        this.db.updateJob(jobId, { status: 'canceled', finishedAt: nowIso() });
        return;
      }
      const err =
        e instanceof PipelineError
          ? e
          : e instanceof TileRunsError
            ? new PipelineError('validation-failed', e.message, 'writing-spec')
            : e instanceof GeneratedAssetStorageError
              ? new PipelineError('storage', e.message, 'building-assets')
              : new PipelineError('internal', e instanceof Error ? e.message : String(e));
      const friendly = {
        code: err.code,
        message: err.message.slice(0, 500),
        stage: err.stage,
      };
      this.db.updateJob(jobId, {
        status: 'failed',
        stage: 'failed',
        error: friendly,
        finishedAt: nowIso(),
      });
      this.db.setGameStatus(gameId, 'failed', { code: friendly.code, message: friendly.message });
      this.db.setGameCost(gameId, this.db.gameCost(gameId));
      const failedIncident = captureIncident('failed', friendly);
      if (job.attempt > 1) {
        try {
          this.incidents?.markRetry(
            jobId,
            job.attempt - 1,
            job.attempt,
            'failed',
            failedIncident?.id,
          );
        } catch (error) {
          throwIfSuspended(error);
          console.warn('could not update generation incident retry outcome:', error);
        }
      }
      feed('failure', friendly.message, err.stage, {
        code: friendly.code,
        costSoFarUsd: this.db.gameCost(gameId),
        elapsedMs: Date.now() - startedAt,
      });
      this.hub.emit({
        type: 'failed',
        jobId,
        gameId,
        code: friendly.code,
        message: friendly.message,
        stage: err.stage,
        elapsedMs: Date.now() - startedAt,
        costSoFarUsd: this.db.gameCost(gameId),
      });
    } finally {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      this.aborts.delete(jobId);
    }
  }

  private async designPass(
    callLlm: PipelineLlmCall,
    opts: {
      promptText: string;
      hasPhoto: boolean;
      describeInStory: boolean;
      antiCollision: { title: string; tagline: string }[];
      recentMoods?: string[];
      recentMechanics?: MechanicalFingerprint[];
      photo?: Buffer;
      creationBrief?: CreationBrief;
      extraNote?: string;
      onRepair?: (
        before: readonly LintError[],
        after: readonly LintError[],
        started: number,
      ) => void;
    },
  ): Promise<DesignDoc> {
    const prompt = buildDesignPrompt(opts);
    let raw = await completeDesignAbilityContract(
      callLlm,
      await callLlm('design', prompt, {
        label: 'Design drafted',
        stage: 'designing',
        checkpoint: 'design',
        ...(opts.photo ? { image: opts.photo } : {}),
      }),
    );
    let errors = designOutputDiagnostics(raw);
    if (errors.length) {
      const before = errors;
      const repairStarted = Date.now();
      const retryPrompt = buildDesignPrompt({
        ...opts,
        extraNote: [
          opts.extraNote,
          `Your previous output failed validation: ${errors
            .slice(0, 8)
            .map((e) => `${e.path}: ${e.message}`)
            .join('; ')}. Fix these and follow the schema exactly.`,
        ]
          .filter(Boolean)
          .join(' '),
      });
      raw = await completeDesignAbilityContract(
        callLlm,
        await callLlm('design', retryPrompt, {
          label: 'Design redrafted',
          stage: 'designing',
          checkpoint: 'design',
          ...(opts.photo ? { image: opts.photo } : {}),
        }),
      );
      errors = designOutputDiagnostics(raw);
      opts.onRepair?.(before, errors, repairStarted);
      if (errors.length) {
        throw new PipelineError(
          'design-invalid',
          `the design pass failed validation twice (${errors[0]!.path}: ${errors[0]!.message})`,
          'designing',
        );
      }
    }
    return raw as DesignDoc;
  }

  private assemble(
    seed: number,
    archetype: ArchetypeId,
    design: DesignDoc,
    parts: SpecParts,
    hasPhoto: boolean,
  ): GameSpec {
    const authoredFighterPlayer =
      archetype === 'fighter' ? (parts.player as FighterCharacter | undefined) : undefined;
    const fighterPlayer = authoredFighterPlayer
      ? { ...authoredFighterPlayer, visualConcept: design.heroConcept }
      : undefined;
    const canonicalHeroConcept = design.heroConcept;
    return alignRacingCast({
      specVersion: 1,
      archetype,
      seed,
      meta: {
        title: design.title,
        tagline: design.tagline,
        heroConcept: canonicalHeroConcept,
      },
      ...(archetype === 'adventure' && design.combatKit
        ? { combatKit: structuredClone(design.combatKit) }
        : {}),
      ...(archetype === 'adventure'
        ? { adventureStyle: design.adventureStyle ?? 'dungeonExpedition' }
        : {}),
      ...((archetype === 'hshooter' || archetype === 'shooter') && design.vehicleConcept
        ? { playerCraft: { visualConcept: design.vehicleConcept } }
        : {}),
      ...(archetype === 'fighter' ? { fighterStyle: design.fighterStyle ?? 'rushdown' } : {}),
      ...(archetype === 'fighter' && design.fighterArtDirection
        ? { artDirection: design.fighterArtDirection }
        : {}),
      // Racing identity flows design → spec verbatim (levels/entities/music
      // never author it, so repair of those regions cannot disturb it).
      ...(archetype === 'racing' && design.racingIdentity
        ? { identity: structuredClone(design.racingIdentity) }
        : {}),
      palette: design.palette,
      story: design.story,
      sprites: (parts.entities?.sprites ?? { custom: {}, assign: {} }) as GameSpec['sprites'],
      ...(archetype === 'fighter' && fighterPlayer ? { player: fighterPlayer } : {}),
      levels: (parts.levels ?? []) as never,
      boss: (parts.entities?.boss ?? {}) as never,
      music: (parts.music ?? {}) as never,
      ...(parts.entities?.sfx ? { sfx: parts.entities.sfx as GameSpec['sfx'] } : {}),
      ...(parts.entities?.backdrop
        ? { backdrop: parts.entities.backdrop as GameSpec['backdrop'] }
        : {}),
      ...(parts.entities?.weather
        ? { weather: parts.entities.weather as GameSpec['weather'] }
        : {}),
      ...(parts.entities?.lighting
        ? { lighting: parts.entities.lighting as GameSpec['lighting'] }
        : {}),
      ...(parts.entities?.juice !== undefined
        ? { juice: parts.entities.juice as GameSpec['juice'] }
        : {}),
      ...(design.difficulty ? { difficulty: design.difficulty } : {}),
      ...(archetype === 'platformer'
        ? {
            playStyle: design.playStyle ?? ('acrobat' as const),
            presentationFamily: design.presentationFamily ?? ('arcade' as const),
            mechanics: platformerMechanics(design),
            actionPoseVersion: 1 as const,
            ...((parts.levels as PlatformerSpec['levels'] | undefined)?.some(
              (level) => level.encounters,
            )
              ? { encounterVersion: 1 as const }
              : {}),
            ...(design.chargeShot ? { chargeShot: design.chargeShot } : {}),
            playerHeightTiles: 2 as const,
            platformerScale: design.platformerScale ?? ('heroic' as const),
            platformerArtDensity:
              design.platformerArtDensity ??
              (hasPhoto ? ('detailed' as const) : ('chunky' as const)),
            movementProfile: design.movementProfile ?? ('balanced' as const),
            ...(design.abilityLoadout
              ? { abilityLoadout: structuredClone(design.abilityLoadout) }
              : {}),
          }
        : {}),
      ...(archetype === 'shooter'
        ? { shooterStyle: design.shooterStyle ?? ('chargeSpecialist' as const) }
        : {}),
      ...(archetype === 'hshooter' ? { hshooterArtDensity: 'detailed' as const } : {}),
      ...(archetype === 'platformer' && design.feel ? { feel: design.feel } : {}),
      scoring: design.scoring,
    } as GameSpec);
  }

  private collectDiagnostics(spec: GameSpec, archetype: ArchetypeId): LintError[] {
    const schemaErrors = validateGameSchema(archetype, spec);
    const scan = securityScan(spec);
    // Semantic linters assume schema-valid input, but independent security
    // findings should not be hidden behind a schema failure. Once schema-safe,
    // collect every independent diagnostic in one pass so a malformed custom
    // boss cannot mask a broken level until the next paid repair call.
    if (schemaErrors.length) return dedupeDiagnostics([...schemaErrors, ...scan]);
    const bossSpriteErrors = customBossSpriteDiagnostics(spec);
    return dedupeDiagnostics([...scan, ...bossSpriteErrors, ...archetypes[archetype].lint(spec)]);
  }

  /**
   * Normalize deterministic defects, then repair independently-owned document
   * regions. A stalled/no-op owner immediately advances to regeneration rather
   * than spending the same prompt twice. Only failed levels are regenerated.
   */
  private async validateAndRepair(
    input: GameSpec,
    archetype: ArchetypeId,
    design: DesignDoc,
    callLlm: (
      stage: StageName,
      prompt: BuiltPrompt,
      opts: {
        temperature?: number;
        repair?: boolean;
        reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
        checkpoint?: RawStageName;
    /** Optional enhancements skip provider retry/network waits. */
    optional?: boolean;
        label: string;
        stage: JobStage;
      },
    ) => Promise<unknown>,
    emit: (stage: JobStage, detail: string) => void,
    hasPhoto: boolean,
    recentUse?: RecentUse,
    repairContext?: { jobId: string; gameId: string; attempt: number },
    recentMechanics: readonly MechanicalFingerprint[] = [],
  ): Promise<GameSpec> {
    const fallbackOptions = { recentBosses: recentUse?.bosses };
    const passByOwner = new Map<string, number>();
    if (repairContext) {
      try {
        for (const event of this.db.repairEventsForJob(repairContext.jobId)) {
          if (event.attempt !== repairContext.attempt) continue;
          passByOwner.set(event.owner, Math.max(passByOwner.get(event.owner) ?? 0, event.pass));
        }
      } catch {
        /* telemetry continuity is best-effort */
      }
    }
    const nextPass = (owner: string): number => {
      const pass = (passByOwner.get(owner) ?? 0) + 1;
      passByOwner.set(owner, pass);
      return pass;
    };
    const outcomeOf = (before: readonly LintError[], after: readonly LintError[]): string =>
      after.length === 0
        ? 'fixed'
        : after.length < before.length
          ? 'improved'
          : diagnosticSignature(after) === diagnosticSignature(before)
            ? 'unchanged'
            : after.length > before.length
              ? 'worsened'
              : 'changed';
    const record = (
      owner: string,
      action: string,
      before: readonly LintError[],
      after: readonly LintError[],
      patch: unknown,
      startedAt: number,
      outcome = outcomeOf(before, after),
    ): void => {
      if (!repairContext) return;
      try {
        this.db.insertRepairEvent({
          ...repairContext,
          pass: nextPass(owner),
          owner,
          action,
          diagnosticsBefore: before,
          diagnosticsAfter: after,
          patch,
          elapsedMs: Date.now() - startedAt,
          outcome,
        });
      } catch {
        // Telemetry must never make a playable spec fail validation.
      }
    };
    const prepareForRepair = (
      candidate: GameSpec,
    ): { spec: GameSpec; fixes: ReturnType<typeof normalizeGeneratedSpec>['fixes'] } => {
      // Normalizers intentionally operate on the richer GameSpec types, while
      // this boundary also receives schema-invalid model output. Never let a
      // missing nested array/object bypass the diagnostics and repair path by
      // throwing from a deterministic cleanup first.
      let normalized: ReturnType<typeof normalizeGeneratedSpec>;
      try {
        normalized = normalizeGeneratedSpec(candidate);
      } catch {
        normalized = { spec: candidate, fixes: [] };
      }
      try {
        return {
          spec: applySpriteFallbacksForRepair(normalized.spec, fallbackOptions),
          fixes: normalized.fixes,
        };
      } catch {
        return normalized;
      }
    };
    const applyFallbacksSafely = (candidate: GameSpec): ReturnType<typeof applySpriteFallbacks> => {
      try {
        return applySpriteFallbacks(normalizeTileGrids(candidate), fallbackOptions);
      } catch {
        // A schema-invalid owner must reach owner regeneration. Sprite/grid
        // downgrade helpers are opportunistic and cannot assume it is valid.
        return { spec: candidate, downgraded: [] };
      }
    };

    const initialDiagnostics = this.collectDiagnostics(input, archetype);
    const initialPrepareStarted = Date.now();
    const prepared = prepareForRepair(input);
    let spec = prepared.spec;
    let diagnostics = this.collectDiagnostics(spec, archetype);
    if (prepared.fixes.length || JSON.stringify(spec) !== JSON.stringify(input)) {
      const owners = new Set<RepairOwner>(
        prepared.fixes.map((fix) =>
          diagnosticOwner({ code: fix.code, path: fix.path, message: fix.message }),
        ),
      );
      const ownersToRecord: RepairOwner[] = owners.size ? [...owners] : ['entities'];
      for (const owner of ownersToRecord) {
        record(
          owner,
          'normalize',
          diagnosticsForOwner(initialDiagnostics, owner),
          diagnosticsForOwner(diagnostics, owner),
          prepared.fixes.filter(
            (fix) =>
              diagnosticsForOwner([{ code: fix.code, path: fix.path, message: fix.message }], owner)
                .length > 0,
          ),
          initialPrepareStarted,
        );
      }
    }
    if (!diagnostics.length) return spec;

    const stalledRepairOwners = new Set<RepairOwner>();
    let modelRepairCalls = 0;
    // Owner fairness without an unbounded 4 owners × 2 passes × cleanup bill.
    // Regeneration remains available after this surgical-call ceiling.
    const maxModelRepairCalls = GENERATION.maxRepairCallsPerAttempt;
    const repairBudgetAvailable = (): boolean => {
      if (!repairContext) return true;
      try {
        return (this.db.gameCost(repairContext.gameId) ?? 0) < GENERATION.repairCostBudgetUsd;
      } catch {
        // A telemetry read must not disable validation recovery.
        return true;
      }
    };
    const tryOwnerRepairs = async (owner: RepairOwner, budget: number): Promise<void> => {
      if (stalledRepairOwners.has(owner)) return;
      for (
        let i = 0;
        i < budget && modelRepairCalls < maxModelRepairCalls && repairBudgetAvailable();
        i++
      ) {
        const before = diagnosticsForOwner(diagnostics, owner);
        if (!before.length) return;
        emit('repairing', `Repairing ${owner} (${i + 1}/${budget}) — ${before.length} issue(s)…`);
        const prompt = buildRepairPrompt(archetype, spec, before, owner);
        const started = Date.now();
        try {
          modelRepairCalls++;
          const patch = (await callLlm('repair', prompt, {
            temperature: 0,
            repair: true,
            reasoningEffort: 'minimal',
            label: 'Patch applied',
            stage: 'repairing',
          })) as JsonPatchOp[];
          assertPatchTargetsOwner(patch, owner, before);
          const patched = applyPatch(spec, patch);
          if (JSON.stringify(patched) === JSON.stringify(spec)) {
            record(owner, 'model-repair', before, before, patch, started, 'unchanged');
            stalledRepairOwners.add(owner);
            return;
          }
          const nextPrepared = prepareForRepair(patched);
          const nextDiagnostics = this.collectDiagnostics(nextPrepared.spec, archetype);
          const after = diagnosticsForOwner(nextDiagnostics, owner);
          const progress = repairMadeProgress(before, after);
          record(
            owner,
            'model-repair',
            before,
            after,
            { operations: patch, normalizationFixes: nextPrepared.fixes },
            started,
            outcomeOf(before, after),
          );
          if (after.length === 0 || progress) {
            spec = nextPrepared.spec;
            diagnostics = nextDiagnostics;
          }
          if (after.length === 0) return;
          if (!progress) {
            stalledRepairOwners.add(owner);
            return;
          }
        } catch (e) {
          if (this.durable?.suspended() && this.durable.abort.signal.aborted) throw e;
          const recoverableProviderFailure =
            e instanceof PipelineError && ['provider-error', 'call-timeout'].includes(e.code);
          if (e instanceof PatchError || recoverableProviderFailure) {
            record(owner, 'model-repair', before, before, null, started, 'failed');
            stalledRepairOwners.add(owner);
            return;
          }
          throw e;
        }
      }
    };
    const repairOwners = async (budget: number): Promise<void> => {
      const priority: RepairOwner[] = ['document', 'entities', 'music', 'levels'];
      for (
        let round = 0;
        round < budget && modelRepairCalls < maxModelRepairCalls && repairBudgetAvailable();
        round++
      ) {
        for (const owner of priority) {
          if (modelRepairCalls >= maxModelRepairCalls || !repairBudgetAvailable()) return;
          await tryOwnerRepairs(owner, 1);
        }
      }
    };

    await repairOwners(GENERATION.maxRepairAttemptsPerStage);
    if (!diagnostics.length) return spec;

    // Authored sprite problems have now had a surgical repair opportunity.
    // Downgrade only the still-invalid art before spending on regeneration.
    const fallbackBefore = diagnostics;
    const fallbackStarted = Date.now();
    let fallbackResult = applyFallbacksSafely(spec);
    spec = fallbackResult.spec;
    diagnostics = this.collectDiagnostics(spec, archetype);
    if (fallbackResult.downgraded.length) {
      record(
        'entities',
        'fallback',
        diagnosticsForOwner(fallbackBefore, 'entities'),
        diagnosticsForOwner(diagnostics, 'entities'),
        fallbackResult.downgraded,
        fallbackStarted,
      );
    }
    const bossDowngrade = fallbackResult.downgraded.find((message) =>
      message.startsWith('assign.boss fell back'),
    );
    if (bossDowngrade) emit('validating', `Authored boss could not be repaired; ${bossDowngrade}.`);
    if (!diagnostics.length) return spec;

    // Recompute after every stage: fixing a schema-invalid owner can uncover
    // semantic diagnostics in another owner that the linter could not safely
    // inspect before. Each owner gets at most one regeneration in this pass.
    const regeneratedOwners = new Set<RepairOwner>();
    for (;;) {
      if (!repairBudgetAvailable()) break;
      const owner = (['levels', 'entities', 'music'] as const).find(
        (candidate) =>
          !regeneratedOwners.has(candidate) &&
          diagnosticsForOwner(diagnostics, candidate).length > 0,
      );
      if (!owner) break;
      regeneratedOwners.add(owner);
      const before = diagnosticsForOwner(diagnostics, owner);
      emit('writing-spec', `Regenerating ${owner}…`);
      const started = Date.now();
      try {
        if (owner === 'levels') {
          const levelCount = Array.isArray(spec.levels) ? spec.levels.length : 0;
          const indexes = failingLevelIndexes(before).filter((index) => index < levelCount);
          const onlyIndexedFailures =
            indexes.length > 0 &&
            before.every((diagnostic) =>
              indexes.some((index) => diagnostic.path.startsWith(`/levels/${index}`)),
            );
          if (onlyIndexedFailures) {
            const currentLevels = structuredClone(spec.levels) as unknown[];
            const replacements = await settleAll(
              indexes.map(async (index) => {
                const levelDiagnostics = before.filter((diagnostic) =>
                  diagnostic.path.startsWith(`/levels/${index}`),
                );
                const requestReplacement = (issues: readonly LintError[], label: string) =>
                  callLlm(
                    'levels',
                    buildLevelRegenerationPrompt(
                      archetype,
                      design,
                      index,
                      currentLevels,
                      issues,
                      recentMechanics,
                    ),
                    { label, stage: 'writing-spec', reasoningEffort: 'minimal' },
                  );
                const checkpointReplacement = (document: unknown): void => {
                  try {
                    if (repairContext) {
                      this.files.writeRawStageCheckpoint(
                        repairContext.jobId,
                        repairContext.attempt,
                        'levels',
                        document,
                      );
                    }
                  } catch {
                    /* best-effort raw evidence */
                  }
                };
                let raw = await requestReplacement(levelDiagnostics, `Level ${index + 1} rebuilt`);
                checkpointReplacement(raw);
                try {
                  const level = isRecord(raw) ? (raw['level'] ?? raw) : raw;
                  return [index, compileGeneratedLevel(archetype, level)] as const;
                } catch (error) {
                  if (this.durable?.suspended() && this.durable.abort.signal.aborted) throw error;
                  if (!(error instanceof TileRunsError)) throw error;
                  const compileDiagnostic = tileRunsDiagnostic(error, index);
                  const retryStarted = Date.now();
                  raw = await requestReplacement(
                    [...levelDiagnostics, compileDiagnostic],
                    `Level ${index + 1} rows corrected`,
                  );
                  checkpointReplacement(raw);
                  const level = isRecord(raw) ? (raw['level'] ?? raw) : raw;
                  let replacement: unknown;
                  try {
                    replacement = compileGeneratedLevel(archetype, level);
                  } catch (retryError) {
                    if (this.durable?.suspended() && this.durable.abort.signal.aborted)
                      throw retryError;
                    if (!(retryError instanceof TileRunsError)) throw retryError;
                    replacement = canonicalLevelFallback(level, retryError);
                  }
                  record(
                    'levels',
                    'compile-retry',
                    [compileDiagnostic],
                    [],
                    null,
                    retryStarted,
                    'fixed',
                  );
                  return [index, replacement] as const;
                }
              }),
            );
            const levels = structuredClone(spec.levels) as unknown[];
            for (const [index, replacement] of replacements) levels[index] = replacement;
            spec = { ...spec, levels: levels as never };
            try {
              if (repairContext) {
                this.files.writeRawStageCheckpoint(
                  repairContext.jobId,
                  repairContext.attempt,
                  'levels',
                  {
                    ...(archetype === 'fighter' && 'player' in spec ? { player: spec.player } : {}),
                    levels,
                  },
                );
              }
            } catch {
              /* best-effort canonical checkpoint */
            }
          } else {
            let raw = await callLlm(
              'levels',
              buildLevelsPrompt(archetype, design, before, recentMechanics),
              {
                label: 'Levels rebuilt',
                stage: 'writing-spec',
                checkpoint: 'levels',
                reasoningEffort: 'minimal',
              },
            );
            let canonical: unknown;
            try {
              canonical = compileGeneratedLevels(archetype, raw, true);
            } catch (error) {
              if (this.durable?.suspended() && this.durable.abort.signal.aborted) throw error;
              if (!(error instanceof TileRunsError)) throw error;
              const compileDiagnostic = tileRunsDiagnostic(error);
              const retryStarted = Date.now();
              raw = await callLlm(
                'levels',
                buildLevelsPrompt(
                  archetype,
                  design,
                  [...before, compileDiagnostic],
                  recentMechanics,
                ),
                {
                  label: 'Correcting rebuilt level rows…',
                  stage: 'writing-spec',
                  checkpoint: 'levels',
                  reasoningEffort: 'minimal',
                },
              );
              try {
                canonical = compileGeneratedLevels(archetype, raw, true);
              } catch (retryError) {
                if (this.durable?.suspended() && this.durable.abort.signal.aborted)
                  throw retryError;
                if (!(retryError instanceof TileRunsError)) throw retryError;
                canonical = canonicalLevelsFallback(archetype, raw, retryError);
              }
              record(
                'levels',
                'compile-retry',
                [compileDiagnostic],
                [],
                null,
                retryStarted,
                'fixed',
              );
            }
            const roster = isRecord(canonical) ? canonical : null;
            spec = {
              ...spec,
              ...(archetype === 'fighter' && roster?.['player']
                ? { player: roster['player'] as never }
                : {}),
              levels: (roster?.['levels'] ?? canonical) as never,
            };
          }
        } else if (owner === 'entities') {
          const raw = await callLlm(
            'entities',
            buildEntitiesPrompt(
              archetype,
              design,
              hasPhoto,
              recentUse,
              before,
              // Repair re-casts against the current spec's circuits, so the
              // boss keeps copying the established finale rival verbatim.
              archetype === 'racing' ? (spec as { levels?: unknown }).levels : undefined,
            ),
            {
              label: 'Entities recast',
              stage: 'writing-spec',
              checkpoint: 'entities',
              reasoningEffort: 'minimal',
            },
          );
          const r = isRecord(raw) ? raw : {};
          const {
            sprites: _sprites,
            boss: _boss,
            sfx: _sfx,
            backdrop: _backdrop,
            weather: _weather,
            lighting: _lighting,
            juice: _juice,
            ...unowned
          } = spec;
          spec = {
            ...unowned,
            sprites: r['sprites'] as GameSpec['sprites'],
            boss: r['boss'] as never,
            ...(r['sfx'] ? { sfx: r['sfx'] as GameSpec['sfx'] } : {}),
            ...(r['backdrop'] ? { backdrop: r['backdrop'] as never } : {}),
            ...(r['weather'] ? { weather: r['weather'] as GameSpec['weather'] } : {}),
            ...(r['lighting'] ? { lighting: r['lighting'] as GameSpec['lighting'] } : {}),
            ...(r['juice'] !== undefined ? { juice: r['juice'] as GameSpec['juice'] } : {}),
          };
        } else {
          const raw = await callLlm('music', buildMusicPrompt(archetype, design, before), {
            label: 'Music recomposed',
            stage: 'writing-spec',
            checkpoint: 'music',
            reasoningEffort: 'minimal',
          });
          spec = { ...spec, music: (isRecord(raw) ? (raw['music'] ?? raw) : raw) as never };
        }
        const regenerated = prepareForRepair(spec);
        spec = regenerated.spec;
        diagnostics = this.collectDiagnostics(spec, archetype);
        record(
          owner,
          'regenerate',
          before,
          diagnosticsForOwner(diagnostics, owner),
          { normalizationFixes: regenerated.fixes },
          started,
        );
        stalledRepairOwners.delete(owner);
      } catch (error) {
        if (this.durable?.suspended() && this.durable.abort.signal.aborted) throw error;
        record(
          owner,
          'regenerate',
          before,
          before,
          { error: error instanceof Error ? error.message : String(error) },
          started,
          'failed',
        );
        throw error;
      }
    }
    if (!diagnostics.length) return spec;

    // A fresh stage gets the normal repair allowance. Productive patches keep
    // going; tryOwnerRepairs stops immediately on a no-op/stall, while the
    // per-attempt call cap and cumulative cost ceiling bound the work.
    await repairOwners(GENERATION.maxRepairAttemptsPerStage);
    if (!diagnostics.length) return spec;

    const finalFallbackBefore = diagnostics;
    const finalFallbackStarted = Date.now();
    fallbackResult = applyFallbacksSafely(spec);
    spec = fallbackResult.spec;
    diagnostics = this.collectDiagnostics(spec, archetype);
    if (fallbackResult.downgraded.length) {
      record(
        'entities',
        'fallback',
        diagnosticsForOwner(finalFallbackBefore, 'entities'),
        diagnosticsForOwner(diagnostics, 'entities'),
        fallbackResult.downgraded,
        finalFallbackStarted,
      );
    }
    const regeneratedBossDowngrade = fallbackResult.downgraded.find((message) =>
      message.startsWith('assign.boss fell back'),
    );
    if (regeneratedBossDowngrade) {
      emit('validating', `Authored boss could not be repaired; ${regeneratedBossDowngrade}.`);
    }
    if (!diagnostics.length) return spec;

    // Generated platformer topology is uniquely amenable to a safe mechanical
    // fallback: if the document is otherwise valid, lay one continuous low
    // route through each still-disconnected level. This is preferable to
    // throwing away the complete game (and all of its later image work) over a
    // map-model mistake that repeated repair prompts could not localize.
    const routeCodes = new Set([
      'PLAT_EXIT_UNREACHABLE',
      'PLAT_SOFTLOCK_REGION',
      'PLAT_NO_CHECKPOINT',
    ]);
    const routeIndexes = failingLevelIndexes(diagnostics);
    const onlyRouteTopologyDiagnostics =
      archetype === 'platformer' &&
      routeIndexes.length > 0 &&
      diagnostics.every(
        (diagnostic) =>
          routeCodes.has(diagnostic.code) &&
          routeIndexes.some(
            (index) =>
              diagnostic.path === `/levels/${index}` ||
              diagnostic.path.startsWith(`/levels/${index}/`),
          ),
      );
    if (onlyRouteTopologyDiagnostics) {
      const before = diagnostics;
      const started = Date.now();
      const routeFallback = repairPlatformerExitRoutes(spec, routeIndexes);
      if (routeFallback.fixes.length) {
        const preparedRoute = prepareForRepair(routeFallback.spec);
        spec = preparedRoute.spec;
        diagnostics = this.collectDiagnostics(spec, archetype);
        record(
          'levels',
          'fallback',
          diagnosticsForOwner(before, 'levels'),
          diagnosticsForOwner(diagnostics, 'levels'),
          { normalizationFixes: [...routeFallback.fixes, ...preparedRoute.fixes] },
          started,
        );
        emit('validating', 'Connected the remaining unreachable platformer route(s).');
      }
    }
    if (!diagnostics.length) return spec;

    for (const [owner, ownerDiagnostics] of groupDiagnostics(diagnostics)) {
      record(owner, 'terminal', ownerDiagnostics, ownerDiagnostics, null, Date.now(), 'failed');
    }

    const summary = diagnostics
      .slice(0, 5)
      .map((d) => `[${d.code}] ${d.path}: ${d.message}`)
      .join('; ');
    throw new PipelineError(
      'validation-failed',
      `the generated game kept failing validation: ${summary}`,
      'validating',
    );
  }
}
import { adventurePuzzleGeometry } from '@sparkade/shared';
