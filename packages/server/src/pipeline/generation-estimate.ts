import { GENERATION, type ArchetypeId, type SparkadeConfig } from '@sparkade/shared';
import { estimateGenerationCost, estimateImageCount, formatUsd } from './cost';

/** One estimate contract for local development and the cloud worker. */
export function generationEstimate(
  c: SparkadeConfig,
  hasPhoto: boolean,
  archetype: ArchetypeId | undefined,
  busy: boolean,
) {
  const model = c.stages.design.model;
  const textUsd = estimateGenerationCost(model, c.pricing, {
    platformerPoseJudges: hasPhoto && (archetype === undefined || archetype === 'platformer'),
    platformerBossJudge: archetype === undefined || archetype === 'platformer',
    hshooterBossJudge: archetype === undefined || archetype === 'hshooter',
    hshooterEnemyJudge: archetype === undefined || archetype === 'hshooter',
    shooterBossJudge: archetype === undefined || archetype === 'shooter',
    shooterEnemyJudge: archetype === undefined || archetype === 'shooter',
    platformerEnemyJudge: archetype === undefined || archetype === 'platformer',
    adventurePlayerIdentityJudge: hasPhoto && archetype === 'adventure',
    adventurePlayerSetJudge: archetype === 'adventure',
    adventureBossJudge: archetype === 'adventure',
    adventureEnemyJudge: archetype === 'adventure',
    adventureObjectJudge: archetype === 'adventure',
    racingRosterJudge: archetype === undefined || archetype === 'racing',
  });
  const conservativeUpperBound = hasPhoto && archetype === undefined;
  const happyPathImages = estimateImageCount(hasPhoto, archetype);
  const imageUsd = happyPathImages * Math.max(0, c.imageGeneration.pricePerImageUsd);
  const usd = textUsd === null ? null : textUsd + imageUsd;
  return {
    usd,
    label:
      usd === null
        ? 'cost unavailable'
        : `${conservativeUpperBound ? 'up to' : 'about'} ${formatUsd(usd)} (estimate)`,
    model,
    imageModel: c.imageGeneration.model,
    busy,
    maxRecordingSeconds: GENERATION.maxRecordingSeconds,
  };
}
