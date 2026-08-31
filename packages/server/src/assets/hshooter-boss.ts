import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const GENERATED_HSHOOTER_BOSS_WIDTH = 192;
export const GENERATED_HSHOOTER_BOSS_HEIGHT = 128;
export const HSHOOTER_BOSS_PROMPT_VERSION = 'hshooter-boss-v1';
export const HSHOOTER_BOSS_JUDGE_PROMPT_VERSION = 'hshooter-boss-judge-v1';
export const HSHOOTER_BOSS_PIPELINE_PROMPT_VERSION = 'hshooter-boss-pipeline-v1';

export interface HShooterBossPromptOptions {
  bossName: string;
  bossIntro: string;
  colors: string;
  candidateId: string;
  retryGuidance?: string;
}

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildHShooterBossCandidatePrompt(options: HShooterBossPromptOptions): string {
  return [
    'Create exactly ONE isolated horizontal-shooter MAIN BOSS gameplay sprite based on the villain in the attached boss-confrontation illustration.',
    `The boss is named ${clean(options.bossName, 80)}. Story context for identification only: ${clean(options.bossIntro)}.`,
    'The attached illustration is immutable visual identity truth. Preserve the same creature, machine, or vehicle class; head or command section; body plan; armor or hide; colors; materials; appendages; and signature details. Do not copy the player pilot or player craft, and do not invent an unrelated generic boss.',
    `Create independent candidate ${clean(options.candidateId, 16)} for evaluation, but do not render that label.`,
    'Show the boss in a strict LEFT-facing side profile, confronting a player craft approaching from the left. Use one neutral combat-ready hover or flight pose. Keep the complete silhouette visible, including every horn, fin, wing, tentacle, engine, tail, weapon mount, and lower underside. Nothing may be cropped.',
    'Fill most of a native 192x128 high-density boss canvas with a broad, imposing horizontal silhouette that remains readable in a fast-moving shooter. Favor one cohesive body with clear negative space and a recognizable forward-facing attack side.',
    `Use this game color direction while preserving the reference villain: ${clean(options.colors)}.`,
    'Polished 16-bit SNES-era horizontal-shooter pixel art: crisp square pixel clusters, hard edges, limited flat colors, strong outline separation, and no antialiasing, blur, gradients, photorealism, or smooth 3D rendering.',
    'This is one boss in one idle pose, NOT a sprite sheet, turnaround, animation sequence, collage, portrait, story scene, icon, or card.',
    'No player, pilot, player craft, minion, orbiting pod, second character, projectile, beam, muzzle flash, exhaust trail, particles, text, letters, numbers, logo, watermark, signature, UI, border, scenery, floor, shadow, or detached object.',
    'The entire empty background must be perfectly flat solid #00ff00, including every gap around or enclosed by the silhouette. Do not use #00ff00 or a near-neon imitation in the boss itself; preserve darker natural greens from the reference.',
    options.retryGuidance
      ? `REPLACEMENT-POOL CORRECTION: ${clean(options.retryGuidance, 420)}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Convert one story-art-derived candidate into a keyed native H-scroll boss. */
export async function processGeneratedHShooterBoss(image: Buffer): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: GENERATED_HSHOOTER_BOSS_WIDTH,
    height: GENERATED_HSHOOTER_BOSS_HEIGHT,
    padding: 8,
    bottomPadding: 8,
    removeGreenSpill: true,
    colors: 64,
    minSubjectFraction: 0.02,
    maxSubjectFraction: 0.9,
    minSubjectSpanFraction: 0.1,
  });
  const { width, height } = processed.metrics.outputBounds;
  if (width < 88 || height < 40 || width / Math.max(1, height) < 1.15) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated H-scroll boss needs a broad side-view silhouette (${width}x${height})`,
    );
  }
  return processed;
}

export function buildHShooterBossJudgePrompt(candidateIds: readonly string[]): {
  system: string;
  user: string;
} {
  return {
    system: [
      'You are the art director selecting the signature boss sprite for a premium SNES-style horizontal shooter.',
      'The attached review board shows the BOSS STORY ART across the top; treat its main villain as immutable identity truth. The isolated processed candidates appear below with labels.',
      'Score how faithfully each candidate preserves the same villain class or species, command section or face, body plan, proportions, armor or hide, colors, appendages, and signature details. Do not reward a polished but unrelated generic monster or vehicle.',
      'Also score silhouette clarity, strict left-facing side profile, a complete uncropped combat-ready hover pose, crisp native pixel technique, and readability during fast projectile-heavy play. Record copied player features, extra subjects, detached objects, residue, cropping, malformed anatomy, unclear facing, or a weak tiny silhouette as issues.',
      'Use the supplied JSON schema. Score every category from 0 (unusable) to 5 (excellent), select the strongest locally valid candidate, and return only the JSON object.',
    ].join(' '),
    user: `Review H-scroll boss candidates ${candidateIds.join(', ')} against the boss story art and select exactly one winner.`,
  };
}
