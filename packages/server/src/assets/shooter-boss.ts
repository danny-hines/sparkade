import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const GENERATED_SHOOTER_BOSS_WIDTH = 128;
export const GENERATED_SHOOTER_BOSS_HEIGHT = 192;
export const SHOOTER_BOSS_PROMPT_VERSION = 'shooter-boss-v1';
export const SHOOTER_BOSS_JUDGE_PROMPT_VERSION = 'shooter-boss-judge-v1';
export const SHOOTER_BOSS_PIPELINE_PROMPT_VERSION = 'shooter-boss-pipeline-v1';

export interface ShooterBossPromptOptions {
  bossName: string;
  bossIntro: string;
  colors: string;
  candidateId: string;
  retryGuidance?: string;
}

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildShooterBossCandidatePrompt(options: ShooterBossPromptOptions): string {
  return [
    'Create exactly ONE isolated vertical-shooter MAIN BOSS gameplay sprite based on the villain in the attached boss-confrontation illustration.',
    `The boss is named ${clean(options.bossName, 80)}. Story context for identity only: ${clean(options.bossIntro)}.`,
    'The illustration is immutable identity truth. Preserve the same creature, machine, or vehicle class; command section or face; body plan; armor or hide; colors; materials; appendages; and signature details. Never copy the player pilot or player craft and never substitute an unrelated generic boss.',
    `Create independent candidate ${clean(options.candidateId, 16)} for evaluation, but do not render that label.`,
    'Show the complete boss from a strict TOP-DOWN overhead camera, with its attack end pointing DOWN toward a player below it. Use one neutral combat-ready hover or flight pose. Keep every wing, fin, horn, tentacle, engine, tail, weapon mount, and underside completely inside the canvas.',
    'Fill most of a native 128x192 high-density boss canvas with an imposing vertical silhouette. Favor one cohesive body with clear negative space, bilateral readability where appropriate, and an unmistakable downward-facing attack end.',
    `Use this game color direction while preserving the reference villain: ${clean(options.colors)}.`,
    'Polished 16-bit SNES-era top-down shooter pixel art: crisp square pixel clusters, hard edges, limited flat colors, strong outline separation, and no antialiasing, blur, gradients, photorealism, or smooth 3D rendering.',
    'This is one boss in one idle pose, not a sheet, turnaround, sequence, collage, portrait, story scene, icon, or card.',
    'No player, pilot, player craft, minion, orbiting pod, second subject, projectile, beam, muzzle flash, exhaust, particles, text, logo, watermark, UI, border, scenery, floor, shadow, or detached object.',
    'The entire empty background must be perfectly flat solid #00ff00, including gaps inside and around the silhouette. Do not use #00ff00 or near-neon imitation in the boss itself.',
    options.retryGuidance
      ? `REPLACEMENT-POOL CORRECTION: ${clean(options.retryGuidance, 420)}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export async function processGeneratedShooterBoss(image: Buffer): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: GENERATED_SHOOTER_BOSS_WIDTH,
    height: GENERATED_SHOOTER_BOSS_HEIGHT,
    padding: 8,
    bottomPadding: 8,
    removeGreenSpill: true,
    colors: 64,
    minSubjectFraction: 0.02,
    maxSubjectFraction: 0.9,
    minSubjectSpanFraction: 0.1,
  });
  const { width, height } = processed.metrics.outputBounds;
  if (width < 46 || height < 86 || height / Math.max(1, width) < 1.12) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated vertical boss needs a tall top-down silhouette (${width}x${height})`,
    );
  }
  return processed;
}

export function buildShooterBossJudgePrompt(candidateIds: readonly string[]): {
  system: string;
  user: string;
} {
  return {
    system: [
      'You are the art director selecting the signature boss sprite for a premium vertical SNES-style shooter.',
      'The review board shows immutable BOSS STORY ART across the top and isolated processed candidates below.',
      'Score identity fidelity, a complete readable TOP-DOWN silhouette, unmistakable DOWNWARD attack orientation, crisp native pixel technique, and projectile-heavy gameplay readability. Penalize copied player features, extra subjects, detached objects, residue, cropping, malformed anatomy, side-view perspective, or a weak tiny silhouette.',
      'Use the supplied JSON schema, score every category from 0 to 5, select the strongest locally valid candidate, and return only JSON.',
    ].join(' '),
    user: `Review vertical-shooter boss candidates ${candidateIds.join(', ')} against the boss story art and select exactly one winner.`,
  };
}
