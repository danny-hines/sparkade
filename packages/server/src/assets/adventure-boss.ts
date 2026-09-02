import sharp, { type OverlayOptions } from 'sharp';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const ADVENTURE_BOSS_ROLE = 'adventureBoss' as const;
export const ADVENTURE_BOSS_CANDIDATE_IDS = ['B1', 'B2', 'B3', 'B4'] as const;
export const ADVENTURE_BOSS_BOARD_SIZE = 1024;
export const ADVENTURE_BOSS_CELL_SIZE = ADVENTURE_BOSS_BOARD_SIZE / 2;
export const GENERATED_ADVENTURE_BOSS_WIDTH = 192;
export const GENERATED_ADVENTURE_BOSS_HEIGHT = 224;
export const ADVENTURE_BOSS_PROMPT_VERSION = 'adventure-boss-board-v1';
export const ADVENTURE_BOSS_RETRY_PROMPT_VERSION = 'adventure-boss-retry-v1';
export const ADVENTURE_BOSS_JUDGE_PROMPT_VERSION = 'adventure-boss-judge-v1';
export const ADVENTURE_BOSS_PIPELINE_PROMPT_VERSION = 'adventure-boss-pipeline-v1';

export type AdventureBossCandidateId = (typeof ADVENTURE_BOSS_CANDIDATE_IDS)[number] | 'R1';

export interface AdventureBossCandidate {
  id: AdventureBossCandidateId;
  png: Buffer;
  metrics: ProcessedFighterPose['metrics'];
}

export interface AdventureBossCandidateFailure {
  id: AdventureBossCandidateId;
  reason: string;
}

export interface AdventureBossBoardResult {
  candidates: AdventureBossCandidate[];
  failures: AdventureBossCandidateFailure[];
}

export interface AdventureBossCandidateReview {
  id: string;
  scores: {
    villainMatch: number;
    silhouette: number;
    camera: number;
    technical: number;
    gameplayReadability: number;
  };
  issues: string[];
  summary: string;
}

export interface AdventureBossJudgeDecision {
  candidateReviews: AdventureBossCandidateReview[];
  selection: { candidateId: string; confidence: number; rationale: string };
}

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildAdventureBossBoardPrompt(options: {
  bossName: string;
  bossIntro: string;
  colors: string;
}): string {
  return [
    'ADVENTURE BOSS CANDIDATE BOARD CONTRACT: create exactly one square 2x2 board containing four isolated sprite candidates in fixed row-major cells B1, B2, B3, B4. Do not draw grid lines or labels.',
    'Every cell must show the SAME MAIN BOSS from the attached boss-confrontation illustration. The illustration is immutable identity truth: preserve the villain species or person, face or mask, head shape, hair or headwear, body plan, costume or armor construction, palette, materials, appendages, and signature motifs. Never isolate or copy the player hero, a minion, or scenery.',
    `The boss is ${clean(options.bossName, 80)}. Story context for identification only: ${clean(options.bossIntro)}.`,
    'In every cell show one complete, grounded, combat-ready idle sprite in the same top-down three-quarter camera as a classic overhead adventure game, facing toward the bottom edge so the front and face are readable. Keep identity, costume, proportions, and scale consistent; vary only subtle stance and silhouette decisions for art-direction selection.',
    'Center one boss inside each cell with generous empty clearance from every cell edge. Nothing may cross between cells and nothing may be cropped. Make the boss large and imposing, with a silhouette designed to render about twice the gameplay hero volume.',
    `Use this game color direction while preserving the reference boss: ${clean(options.colors)}.`,
    'High-density modern retro pixel art: crisp deliberate square pixel clusters, clean hard contours, rich material detail, controlled limited colors, and readable internal forms. It should feel like premium pixel art without huge chunky blocks. No antialiasing, blur, smooth vector shapes, photorealism, or 3D rendering.',
    'Each cell contains only the boss in one idle pose. No hero, minions, duplicates within a cell, text, letters, numbers, logo, watermark, UI, border, floor, scenery, shadow, glow, particles, or detached props.',
    'The entire board background must be perfectly flat solid #00ff00, including all gaps inside and around every silhouette. Do not use #00ff00 or a near-neon imitation in the boss itself.',
  ].join(' ');
}

export function buildAdventureBossRetryPrompt(options: {
  bossName: string;
  bossIntro: string;
  colors: string;
  failures?: readonly AdventureBossCandidateFailure[];
}): string {
  const correction = options.failures?.length
    ? `Previous board processing failed because: ${clean(options.failures.map(({ reason }) => reason).join('; '), 420)}.`
    : '';
  return [
    `Create exactly ONE isolated full-body gameplay sprite of the MAIN BOSS ${clean(options.bossName, 80)} shown in the attached boss-confrontation illustration.`,
    `Story context for identification only: ${clean(options.bossIntro)}. Preserve the exact villain identity, species or face, body plan, costume or armor, colors, appendages, and signature details; do not use the player hero or a minion.`,
    'Show a complete grounded combat-ready idle in a top-down three-quarter adventure-game camera, facing toward the bottom edge. Center the boss with wide empty clearance and keep every extremity visible.',
    `Color direction: ${clean(options.colors)}.`,
    'Use crisp high-density modern retro pixel art with deliberate square pixel clusters, hard contours, rich readable detail, and no blur, antialiasing, photorealism, or 3D rendering.',
    'No second character, duplicate, text, UI, scenery, floor, shadow, glow, particles, or detached objects.',
    'The entire background must be perfectly flat solid #00ff00, including every enclosed gap. Do not use neon green in the boss.',
    correction,
  ]
    .filter(Boolean)
    .join(' ');
}

export async function processGeneratedAdventureBoss(image: Buffer): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: GENERATED_ADVENTURE_BOSS_WIDTH,
    height: GENERATED_ADVENTURE_BOSS_HEIGHT,
    padding: 10,
    bottomPadding: 0,
    removeGreenSpill: true,
    colors: 64,
  });
  if (processed.metrics.outputBounds.width < 72 || processed.metrics.outputBounds.height < 100) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated Adventure boss is too small (${processed.metrics.outputBounds.width}x${processed.metrics.outputBounds.height})`,
    );
  }
  return processed;
}

export async function splitGeneratedAdventureBossBoard(
  image: Buffer,
): Promise<AdventureBossBoardResult> {
  const normalized = await sharp(image)
    .rotate()
    .resize(ADVENTURE_BOSS_BOARD_SIZE, ADVENTURE_BOSS_BOARD_SIZE, {
      fit: 'cover',
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
  const candidates: AdventureBossCandidate[] = [];
  const failures: AdventureBossCandidateFailure[] = [];
  for (let index = 0; index < ADVENTURE_BOSS_CANDIDATE_IDS.length; index++) {
    const id = ADVENTURE_BOSS_CANDIDATE_IDS[index]!;
    const cell = await sharp(normalized)
      .extract({
        left: (index % 2) * ADVENTURE_BOSS_CELL_SIZE,
        top: Math.floor(index / 2) * ADVENTURE_BOSS_CELL_SIZE,
        width: ADVENTURE_BOSS_CELL_SIZE,
        height: ADVENTURE_BOSS_CELL_SIZE,
      })
      .png()
      .toBuffer();
    try {
      const processed = await processGeneratedAdventureBoss(cell);
      candidates.push({ id, png: processed.png, metrics: processed.metrics });
    } catch (error) {
      failures.push({ id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { candidates, failures };
}

export function buildAdventureBossJudgeSchema(
  candidates: readonly { id: string }[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const score = { type: 'integer', minimum: 0, maximum: 5 };
  return {
    title: 'Adventure finale boss sprite selection',
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
              required: [
                'villainMatch',
                'silhouette',
                'camera',
                'technical',
                'gameplayReadability',
              ],
              properties: {
                villainMatch: score,
                silhouette: score,
                camera: score,
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

export function buildAdventureBossJudgePrompt(candidates: readonly { id: string }[]): {
  system: string;
  user: string;
} {
  return {
    system: [
      'You are the art director selecting the signature finale boss for a premium top-down retro Adventure game.',
      'The top of the attached review board is the boss story art and immutable villain identity truth. The labeled isolated candidates below are processed gameplay sprites.',
      'Score visible fidelity to the same villain face or mask, species, body plan, proportions, costume or armor, palette, appendages, and signature motifs. Reject a polished but unrelated monster or the player hero.',
      'Also score an imposing complete silhouette, a grounded front/down-facing top-down three-quarter camera, crisp high-density pixel technique, and immediate gameplay readability over light, dark, saturated, and noisy floors.',
      'Record cropping, malformed anatomy, wrong camera or facing, residue, extra characters or objects, weak scale, lost identity, or poor contour separation. Score every category from 0 to 5 and select the strongest locally valid candidate even when none is perfect. Return only the requested JSON.',
    ].join(' '),
    user: `Review candidates ${candidates.map(({ id }) => id).join(', ')} against the story-art boss and select exactly one winner.`,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numericScore(value: unknown): number {
  return Math.max(
    0,
    Math.min(5, Math.round(typeof value === 'number' && Number.isFinite(value) ? value : 0)),
  );
}

function text(value: unknown, max = 1200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function bestAdventureBossCandidateId(decision: AdventureBossJudgeDecision): string | null {
  let best: { id: string; score: number } | null = null;
  for (const review of decision.candidateReviews) {
    const score =
      review.scores.villainMatch * 5 +
      review.scores.gameplayReadability * 3 +
      review.scores.silhouette * 3 +
      review.scores.camera * 2 +
      review.scores.technical * 2 -
      review.issues.length * 3;
    if (!best || score > best.score) best = { id: review.id, score };
  }
  return best?.id ?? null;
}

export function normalizeAdventureBossJudgeDecision(
  value: unknown,
  candidates: readonly { id: string }[],
): AdventureBossJudgeDecision {
  const root = record(value);
  const ids = new Set(candidates.map(({ id }) => id));
  const reviews = new Map<string, AdventureBossCandidateReview>();
  for (const raw of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(raw);
    const id = text(review.id, 32);
    if (!ids.has(id) || reviews.has(id)) continue;
    const scores = record(review.scores);
    reviews.set(id, {
      id,
      scores: {
        villainMatch: numericScore(scores.villainMatch),
        silhouette: numericScore(scores.silhouette),
        camera: numericScore(scores.camera),
        technical: numericScore(scores.technical),
        gameplayReadability: numericScore(scores.gameplayReadability),
      },
      issues: Array.isArray(review.issues)
        ? review.issues
            .map((issue) => text(issue, 240))
            .filter(Boolean)
            .slice(0, 8)
        : [],
      summary: text(review.summary),
    });
  }
  const candidateReviews = candidates.map(
    ({ id }): AdventureBossCandidateReview =>
      reviews.get(id) ?? {
        id,
        scores: { villainMatch: 0, silhouette: 0, camera: 0, technical: 0, gameplayReadability: 0 },
        issues: ['Judge omitted this candidate'],
        summary: 'No review was returned.',
      },
  );
  const selection = record(root.selection);
  const requested = text(selection.candidateId, 32);
  const decision: AdventureBossJudgeDecision = {
    candidateReviews,
    selection: {
      candidateId: ids.has(requested) ? requested : '',
      confidence:
        typeof selection.confidence === 'number' && Number.isFinite(selection.confidence)
          ? Math.max(0, Math.min(1, selection.confidence))
          : 0,
      rationale: text(selection.rationale),
    },
  };
  if (!decision.selection.candidateId) {
    decision.selection.candidateId =
      bestAdventureBossCandidateId(decision) ?? candidates[0]?.id ?? '';
  }
  return decision;
}

function labelSvg(width: number, height: number, label: string): Buffer {
  const safe = label.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0a1020"/><text x="${width / 2}" y="${height - 10}" text-anchor="middle" font-family="monospace" font-size="24" font-weight="bold" fill="#53def8">${safe}</text></svg>`,
  );
}

function previewField(width: number, height: number, index: number): Buffer {
  const palettes = [
    ['#e7d9bd', '#88775e'],
    ['#171d2b', '#30384d'],
    ['#694082', '#322242'],
    ['#4e7865', '#24433e'],
  ];
  const [a, b] = palettes[index % palettes.length]!;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${a}"/><path d="M0 0h${width / 2}v${height / 2}H0zm${width / 2} ${height / 2}H${width}V${height}H${width / 2}z" fill="${b}" opacity=".55"/></svg>`,
  );
}

export async function buildAdventureBossJudgeBoard(options: {
  storyBoss: Buffer;
  candidates: readonly { id: string; png: Buffer }[];
}): Promise<Buffer> {
  const width = 1320;
  const storyWidth = 840;
  const storyHeight = 340;
  const candidateWidth = 250;
  const candidateHeight = 290;
  const gap = 26;
  const totalWidth =
    options.candidates.length * candidateWidth + Math.max(0, options.candidates.length - 1) * gap;
  const story = await sharp(options.storyBoss)
    .resize(storyWidth, storyHeight, { fit: 'contain', background: '#0f1528' })
    .png()
    .toBuffer();
  const candidateImages = await Promise.all(
    options.candidates.map(async ({ png }, index) => {
      const sprite = await sharp(png)
        .resize(candidateWidth, candidateHeight, { fit: 'contain', kernel: sharp.kernel.nearest })
        .png()
        .toBuffer();
      return sharp(previewField(candidateWidth, candidateHeight, index))
        .composite([{ input: sprite }])
        .png()
        .toBuffer();
    }),
  );
  const composites: OverlayOptions[] = [
    { input: story, left: Math.floor((width - storyWidth) / 2), top: 46 },
    {
      input: labelSvg(storyWidth, 40, 'BOSS STORY ART · IDENTITY TRUTH'),
      left: Math.floor((width - storyWidth) / 2),
      top: 8,
    },
  ];
  const startX = Math.floor((width - totalWidth) / 2);
  options.candidates.forEach(({ id }, index) => {
    const left = startX + index * (candidateWidth + gap);
    composites.push(
      { input: candidateImages[index]!, left, top: 410 },
      { input: labelSvg(candidateWidth, 40, id), left, top: 694 },
    );
  });
  return sharp({ create: { width, height: 740, channels: 3, background: '#0a1020' } })
    .composite(composites)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
