import sharp, { type OverlayOptions } from 'sharp';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const GENERATED_PLATFORMER_BOSS_WIDTH = 192;
export const GENERATED_PLATFORMER_BOSS_HEIGHT = 192;
export const PLATFORMER_BOSS_PROMPT_VERSION = 'platformer-boss-v1';
export const PLATFORMER_BOSS_JUDGE_PROMPT_VERSION = 'platformer-boss-judge-v1';
export const PLATFORMER_BOSS_PIPELINE_PROMPT_VERSION = 'platformer-boss-pipeline-v1';

export interface PlatformerBossPromptOptions {
  bossName: string;
  bossIntro: string;
  colors: string;
  candidateId: string;
}

export interface PlatformerBossCandidateDescriptor {
  id: string;
}

export interface PlatformerBossCandidateReview {
  id: string;
  scores: {
    villainMatch: number;
    silhouette: number;
    pose: number;
    technical: number;
    gameplayReadability: number;
  };
  issues: string[];
  summary: string;
}

export interface PlatformerBossJudgeDecision {
  candidateReviews: PlatformerBossCandidateReview[];
  selection: {
    candidateId: string;
    confidence: number;
    rationale: string;
  };
}

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildPlatformerBossCandidatePrompt(options: PlatformerBossPromptOptions): string {
  return [
    'Create exactly ONE isolated, full-body platform-game sprite of the MAIN BOSS shown in the attached boss-confrontation illustration.',
    `The boss is named ${clean(options.bossName, 80)}. Story context for identification only: ${clean(options.bossIntro)}.`,
    'The attached illustration is the immutable visual identity reference. Preserve the same creature or character species, head and face, body plan, proportions, costume or armor, colors, materials, appendages, and signature details. Do not copy the player hero or invent a different villain.',
    `Create independent boss candidate ${clean(options.candidateId, 16)} for evaluation, but do not render that label.`,
    'Show the boss in a strict LEFT-facing side view, grounded in a powerful combat-ready idle stance as if confronting the player to its left. Keep the complete silhouette visible from its highest horn, hair, crown, wing, or head detail through every hand, claw, tail, and foot or grounded underside. Nothing may be cropped.',
    'Fill most of a native 192x192 high-density boss sprite canvas. The final gameplay boss will appear roughly one-and-a-half times the player height, so use a bold, large, instantly readable silhouette rather than a small distant figure.',
    `Use this game color direction while preserving the reference villain: ${clean(options.colors)}.`,
    'Polished 16-bit SNES-era platformer pixel art: crisp square pixel clusters, hard edges, limited flat colors, strong outline separation, and no antialiasing, blur, gradients, or photorealism.',
    'This is one boss in one idle pose, NOT a sprite sheet, turnaround, sequence, collage, portrait, story scene, or character-select card.',
    'No player hero, minions, second character, text, letters, numbers, logo, watermark, signature, UI, border, scenery, floor, platform, shadow, glow, particles, or detached props.',
    'The entire background must be perfectly flat solid #00ff00, including gaps between limbs, wings, horns, tails, clothing, and equipment. Do not use #00ff00 or a near-neon imitation in the boss itself; preserve darker natural greens from the reference.',
  ].join(' ');
}

/** Convert one isolated Muse result into a palette-indexed density-4 boss. */
export async function processGeneratedPlatformerBoss(image: Buffer): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: GENERATED_PLATFORMER_BOSS_WIDTH,
    height: GENERATED_PLATFORMER_BOSS_HEIGHT,
    padding: 8,
    bottomPadding: 0,
    removeGreenSpill: true,
    colors: 48,
  });
  if (processed.metrics.outputBounds.width < 64 || processed.metrics.outputBounds.height < 80) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated platformer boss is too small (${processed.metrics.outputBounds.width}x${processed.metrics.outputBounds.height})`,
    );
  }
  return processed;
}

export function buildPlatformerBossJudgeSchema(
  candidates: readonly PlatformerBossCandidateDescriptor[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const score = { type: 'integer', minimum: 0, maximum: 5 };
  return {
    title: 'Platformer boss sprite art-direction selection',
    type: 'object',
    additionalProperties: false,
    required: ['candidateReviews', 'selection'],
    properties: {
      candidateReviews: {
        type: 'array',
        minItems: candidates.length,
        maxItems: candidates.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'scores', 'issues', 'summary'],
          properties: {
            id: { type: 'string', enum: ids },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: ['villainMatch', 'silhouette', 'pose', 'technical', 'gameplayReadability'],
              properties: {
                villainMatch: score,
                silhouette: score,
                pose: score,
                technical: score,
                gameplayReadability: score,
              },
            },
            issues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            summary: { type: 'string' },
          },
        },
      },
      selection: {
        type: 'object',
        additionalProperties: false,
        required: ['candidateId', 'confidence', 'rationale'],
        properties: {
          candidateId: { type: 'string', enum: ids },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          rationale: { type: 'string' },
        },
      },
    },
  };
}

export function buildPlatformerBossJudgePrompt(
  candidates: readonly PlatformerBossCandidateDescriptor[],
): { system: string; user: string } {
  const ids = candidates.map(({ id }) => id).join(', ');
  return {
    system: [
      'You are the art director selecting the signature boss sprite for a premium SNES-style platform game.',
      'The attached review board shows the BOSS STORY ART across the top; treat the main villain in that scene as immutable identity truth. The isolated processed sprite candidates appear below with labels.',
      'Score how faithfully each sprite preserves the same villain species or character, head and face, body plan, proportions, costume or armor, colors, appendages, and signature details. Do not reward a polished but unrelated generic monster.',
      'Also score silhouette clarity, a grounded left-facing combat-ready idle pose, complete uncropped anatomy, crisp native pixel technique, and readability at gameplay size. Record visible problems such as copied hero features, extra characters, detached objects, residue, cropping, malformed anatomy, unclear facing, or a weak tiny silhouette.',
      'Score each category from 0 (unusable) to 5 (excellent). You MUST select the strongest available candidate even if none is perfect; local processing has already removed technically invalid images. Return only the requested JSON object.',
    ].join(' '),
    user: `Review boss candidates ${ids}, score every candidate against the boss story art, and select exactly one winner.`,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function score(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(5, Math.round(numeric)));
}

function text(value: unknown, max = 1200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => text(item, 240))
        .filter(Boolean)
        .slice(0, 8)
    : [];
}

export function bestPlatformerBossCandidateId(
  decision: PlatformerBossJudgeDecision,
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const review of decision.candidateReviews) {
    const scores = review.scores;
    const total =
      scores.villainMatch * 5 +
      scores.silhouette * 3 +
      scores.gameplayReadability * 3 +
      scores.pose * 2 +
      scores.technical * 2 -
      review.issues.length * 3;
    if (!best || total > best.score) best = { id: review.id, score: total };
  }
  return best?.id ?? null;
}

export function normalizePlatformerBossJudgeDecision(
  value: unknown,
  candidates: readonly PlatformerBossCandidateDescriptor[],
): PlatformerBossJudgeDecision {
  const root = record(value);
  const expectedIds = new Set(candidates.map(({ id }) => id));
  const reviewsById = new Map<string, PlatformerBossCandidateReview>();
  for (const rawReview of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(rawReview);
    const id = text(review.id, 32);
    if (!expectedIds.has(id) || reviewsById.has(id)) continue;
    const scores = record(review.scores);
    reviewsById.set(id, {
      id,
      scores: {
        villainMatch: score(scores.villainMatch),
        silhouette: score(scores.silhouette),
        pose: score(scores.pose),
        technical: score(scores.technical),
        gameplayReadability: score(scores.gameplayReadability),
      },
      issues: strings(review.issues),
      summary: text(review.summary),
    });
  }
  const candidateReviews = candidates.map(
    ({ id }): PlatformerBossCandidateReview =>
      reviewsById.get(id) ?? {
        id,
        scores: {
          villainMatch: 0,
          silhouette: 0,
          pose: 0,
          technical: 0,
          gameplayReadability: 0,
        },
        issues: ['Judge omitted this candidate'],
        summary: 'No review was returned.',
      },
  );
  const rawSelection = record(root.selection);
  const requestedId = text(rawSelection.candidateId, 32);
  const provisional: PlatformerBossJudgeDecision = {
    candidateReviews,
    selection: {
      candidateId: expectedIds.has(requestedId) ? requestedId : (candidates[0]?.id ?? ''),
      confidence:
        typeof rawSelection.confidence === 'number' && Number.isFinite(rawSelection.confidence)
          ? Math.max(0, Math.min(1, rawSelection.confidence))
          : 0,
      rationale: text(rawSelection.rationale),
    },
  };
  if (!expectedIds.has(requestedId)) {
    provisional.selection.candidateId =
      bestPlatformerBossCandidateId(provisional) ?? candidates[0]?.id ?? '';
  }
  return provisional;
}

function labelSvg(width: number, height: number, textValue: string): Buffer {
  const safe = textValue.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[char]!;
  });
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0a1020"/><text x="${width / 2}" y="${height - 10}" text-anchor="middle" font-family="monospace" font-size="24" font-weight="bold" fill="#53def8">${safe}</text></svg>`,
  );
}

export async function buildPlatformerBossJudgeBoard(options: {
  storyBoss: Buffer;
  candidates: readonly { id: string; processed: Buffer }[];
}): Promise<Buffer> {
  const width = 1320;
  const storyWidth = 840;
  const storyHeight = 360;
  const candidateSize = 320;
  const gap = 40;
  const candidatesWidth =
    options.candidates.length * candidateSize + Math.max(0, options.candidates.length - 1) * gap;
  const story = await sharp(options.storyBoss)
    .resize(storyWidth, storyHeight, {
      fit: 'contain',
      background: { r: 15, g: 21, b: 40 },
    })
    .png()
    .toBuffer();
  const candidateImages = await Promise.all(
    options.candidates.map(({ processed }) =>
      sharp(processed)
        .resize(candidateSize, candidateSize, {
          fit: 'contain',
          kernel: sharp.kernel.nearest,
          background: { r: 15, g: 21, b: 40, alpha: 1 },
        })
        .png()
        .toBuffer(),
    ),
  );
  const height = 760;
  const composites: OverlayOptions[] = [
    { input: story, left: Math.floor((width - storyWidth) / 2), top: 46 },
    {
      input: labelSvg(storyWidth, 40, 'BOSS STORY ART · IDENTITY TRUTH'),
      left: Math.floor((width - storyWidth) / 2),
      top: 8,
    },
  ];
  const startX = Math.floor((width - candidatesWidth) / 2);
  options.candidates.forEach(({ id }, index) => {
    const left = startX + index * (candidateSize + gap);
    composites.push(
      { input: candidateImages[index]!, left, top: 410 },
      { input: labelSvg(candidateSize, 40, id), left, top: 716 },
    );
  });
  return sharp({
    create: { width, height, channels: 3, background: '#0a1020' },
  })
    .composite(composites)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
