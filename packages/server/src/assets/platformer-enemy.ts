import sharp from 'sharp';
import type { PlatformerEntityType } from '@sparkade/shared';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';

export const GENERATED_PLATFORMER_ENEMIES = ['walker', 'flyer', 'shooter', 'chaser'] as const;

export type GeneratedPlatformerEnemy = Extract<
  PlatformerEntityType,
  (typeof GENERATED_PLATFORMER_ENEMIES)[number]
>;

export const GENERATED_PLATFORMER_ENEMY_SIZE = 96;
export const PLATFORMER_ENEMY_PROMPT_VERSION = 'platformer-enemy-v1';
export const PLATFORMER_ENEMY_JUDGE_PROMPT_VERSION = 'platformer-enemy-judge-v1';
export const PLATFORMER_ENEMY_PIPELINE_PROMPT_VERSION = 'platformer-enemy-pipeline-v1';

export interface PlatformerEnemyPromptOptions {
  gameTitle: string;
  tagline: string;
  role: GeneratedPlatformerEnemy;
  concept: string;
  colors: string;
  candidateId: string;
}

export interface PlatformerEnemyCandidateDescriptor {
  id: string;
  role: GeneratedPlatformerEnemy;
  concept: string;
}

export interface PlatformerEnemyCandidateReview {
  id: string;
  role: GeneratedPlatformerEnemy;
  scores: {
    conceptMatch: number;
    worldStyle: number;
    silhouette: number;
    roleReadability: number;
    technical: number;
  };
  issues: string[];
  summary: string;
}

export interface PlatformerEnemySelection {
  role: GeneratedPlatformerEnemy;
  candidateId: string;
  confidence: number;
  rationale: string;
}

export interface PlatformerEnemyJudgeDecision {
  candidateReviews: PlatformerEnemyCandidateReview[];
  selections: PlatformerEnemySelection[];
}

const ROLE_DIRECTION: Record<GeneratedPlatformerEnemy, string> = {
  walker:
    'A grounded patrol enemy with a low, stable center of gravity, feet or another obvious ground-contact anatomy, and a silhouette that reads as a steady walker.',
  flyer:
    'An airborne enemy with an unmistakable flying silhouette: spread wings, fins, rotors, hovering anatomy, or another clear means of flight. It has no floor or shadow beneath it.',
  shooter:
    'A planted ranged enemy with an integrated muzzle, wand, mouth, cannon, launcher, or other unmistakable forward-firing feature. The weapon is part of the creature or costume, not a detached object.',
  chaser:
    'A compact, aggressive pursuit enemy with a sharp forward-leaning, rolling, pouncing, or darting silhouette that visibly communicates speed and danger.',
};

function clean(value: string, max = 500): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isGeneratedPlatformerEnemy(value: string): value is GeneratedPlatformerEnemy {
  return (GENERATED_PLATFORMER_ENEMIES as readonly string[]).includes(value);
}

export function buildPlatformerEnemyCandidatePrompt(options: PlatformerEnemyPromptOptions): string {
  return [
    'Create exactly ONE isolated, full-body platform-game sprite for an ordinary recurring enemy in the world shown by the attached key art.',
    `Game: ${clean(options.gameTitle, 80)} — ${clean(options.tagline, 120)}.`,
    `Behavior role: ${options.role}. Enemy concept: ${clean(options.concept, 180)}.`,
    ROLE_DIRECTION[options.role],
    'Use the attached key art only as the visual direction for this game world: match its era, shapes, materials, mood, and rendering style. Do not copy the player hero, the main boss, or any complete character from the key art.',
    `Create independent ${options.role} candidate ${clean(options.candidateId, 16)} for evaluation, but do not render that label.`,
    'The enemy faces strictly toward the LEFT side of the image in a readable gameplay-ready idle or contact pose. Keep its complete silhouette visible. Nothing may be cropped.',
    'Fill most of a native 96x96 high-density sprite canvas. It will be displayed around three-quarters of the player height, so favor a bold silhouette and clear face or focal point over tiny details.',
    `Use this game color direction while preserving strong friend-versus-foe contrast: ${clean(options.colors)}.`,
    'Polished 16-bit SNES-era platformer pixel art: crisp square pixel clusters, hard edges, limited flat colors, strong outline separation, and no antialiasing, blur, gradients, or photorealism.',
    'This is one enemy in one pose, NOT a sprite sheet, turnaround, sequence, collage, portrait, story scene, boss, or character-select card.',
    'No player hero, boss, second enemy, text, letters, numbers, logo, watermark, signature, UI, border, scenery, floor, platform, shadow, glow, particles, or detached props.',
    'The entire background must be perfectly flat solid #00ff00, including every enclosed gap. Do not use #00ff00 or a near-neon imitation in the enemy itself; darker natural greens are allowed.',
  ].join(' ');
}

/** Convert one isolated Muse result into a density-4, transparent enemy sprite. */
export async function processGeneratedPlatformerEnemy(
  image: Buffer,
  role: GeneratedPlatformerEnemy,
): Promise<ProcessedFighterPose> {
  const processed = await processGeneratedFighterPose(image, {
    width: GENERATED_PLATFORMER_ENEMY_SIZE,
    height: GENERATED_PLATFORMER_ENEMY_SIZE,
    padding: 4,
    bottomPadding: role === 'flyer' ? 4 : 0,
    removeGreenSpill: true,
    colors: 40,
  });
  // Flying concepts can be either broad-winged or a narrow hovering body; the
  // prompt/judge enforce role readability, so local validation only rejects a
  // genuinely tiny result rather than assuming one silhouette family.
  const minimum = role === 'flyer' ? { width: 30, height: 28 } : { width: 34, height: 42 };
  if (
    processed.metrics.outputBounds.width < minimum.width ||
    processed.metrics.outputBounds.height < minimum.height
  ) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated ${role} enemy is too small (${processed.metrics.outputBounds.width}x${processed.metrics.outputBounds.height})`,
    );
  }
  return processed;
}

function groupedCandidates(candidates: readonly PlatformerEnemyCandidateDescriptor[]) {
  return GENERATED_PLATFORMER_ENEMIES.map((role) => ({
    role,
    candidates: candidates.filter((candidate) => candidate.role === role),
  })).filter(({ candidates: roleCandidates }) => roleCandidates.length > 0);
}

export function buildPlatformerEnemyJudgeSchema(
  candidates: readonly PlatformerEnemyCandidateDescriptor[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const roles = groupedCandidates(candidates).map(({ role }) => role);
  const score = { type: 'integer', minimum: 0, maximum: 5 };
  return {
    title: 'Platformer enemy sprite cast selection',
    type: 'object',
    additionalProperties: false,
    required: ['candidateReviews', 'selections'],
    properties: {
      candidateReviews: {
        type: 'array',
        minItems: candidates.length,
        maxItems: candidates.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'role', 'scores', 'issues', 'summary'],
          properties: {
            id: { type: 'string', enum: ids },
            role: { type: 'string', enum: roles },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: [
                'conceptMatch',
                'worldStyle',
                'silhouette',
                'roleReadability',
                'technical',
              ],
              properties: {
                conceptMatch: score,
                worldStyle: score,
                silhouette: score,
                roleReadability: score,
                technical: score,
              },
            },
            issues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            summary: { type: 'string' },
          },
        },
      },
      selections: {
        type: 'array',
        minItems: roles.length,
        maxItems: roles.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['role', 'candidateId', 'confidence', 'rationale'],
          properties: {
            role: { type: 'string', enum: roles },
            candidateId: { type: 'string', enum: ids },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            rationale: { type: 'string' },
          },
        },
      },
    },
  };
}

export function buildPlatformerEnemyJudgePrompt(
  candidates: readonly PlatformerEnemyCandidateDescriptor[],
): { system: string; user: string } {
  const concepts = groupedCandidates(candidates)
    .map(({ role, candidates: roleCandidates }) => {
      const ids = roleCandidates.map(({ id }) => id).join(', ');
      return `${role} (${ids}): ${roleCandidates[0]!.concept}`;
    })
    .join('\n');
  return {
    system: [
      'You are the art director selecting a coherent ordinary-enemy cast for a premium SNES-style platform game.',
      'The attached review board shows the game KEY ART across the top as world-style truth. Candidate sprites are grouped into labeled behavior rows below it.',
      'Score every candidate for its authored enemy concept, fit with the key art world, crisp complete silhouette, immediately readable behavior role, and native pixel-art technique. Penalize copied hero or boss identity, extra characters, detached objects, residue, cropping, malformed anatomy, unclear facing, weak scale, or a role-confusing silhouette.',
      'Score each category from 0 (unusable) to 5 (excellent). Select exactly one candidate for every represented behavior role. You MUST choose the strongest locally valid candidate in each row even if it is imperfect. A candidate may only win its own role. Return only the requested JSON object.',
    ].join(' '),
    user: `Review and select the platformer enemy cast:\n${concepts}`,
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

export function bestPlatformerEnemyCandidateId(
  role: GeneratedPlatformerEnemy,
  decision: PlatformerEnemyJudgeDecision,
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const review of decision.candidateReviews) {
    if (review.role !== role) continue;
    const scores = review.scores;
    const total =
      scores.conceptMatch * 4 +
      scores.roleReadability * 4 +
      scores.worldStyle * 3 +
      scores.silhouette * 3 +
      scores.technical * 2 -
      review.issues.length * 3;
    if (!best || total > best.score) best = { id: review.id, score: total };
  }
  return best?.id ?? null;
}

export function normalizePlatformerEnemyJudgeDecision(
  value: unknown,
  candidates: readonly PlatformerEnemyCandidateDescriptor[],
): PlatformerEnemyJudgeDecision {
  const root = record(value);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const reviewsById = new Map<string, PlatformerEnemyCandidateReview>();
  for (const rawReview of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(rawReview);
    const id = text(review.id, 32);
    const candidate = candidatesById.get(id);
    if (!candidate || reviewsById.has(id)) continue;
    const scores = record(review.scores);
    reviewsById.set(id, {
      id,
      role: candidate.role,
      scores: {
        conceptMatch: score(scores.conceptMatch),
        worldStyle: score(scores.worldStyle),
        silhouette: score(scores.silhouette),
        roleReadability: score(scores.roleReadability),
        technical: score(scores.technical),
      },
      issues: strings(review.issues),
      summary: text(review.summary),
    });
  }
  const candidateReviews = candidates.map(
    (candidate): PlatformerEnemyCandidateReview =>
      reviewsById.get(candidate.id) ?? {
        id: candidate.id,
        role: candidate.role,
        scores: {
          conceptMatch: 0,
          worldStyle: 0,
          silhouette: 0,
          roleReadability: 0,
          technical: 0,
        },
        issues: ['Judge omitted this candidate'],
        summary: 'No review was returned.',
      },
  );
  const provisional: PlatformerEnemyJudgeDecision = { candidateReviews, selections: [] };
  const requestedByRole = new Map<GeneratedPlatformerEnemy, Record<string, unknown>>();
  for (const rawSelection of Array.isArray(root.selections) ? root.selections : []) {
    const selection = record(rawSelection);
    const role = text(selection.role, 32);
    if (isGeneratedPlatformerEnemy(role) && !requestedByRole.has(role)) {
      requestedByRole.set(role, selection);
    }
  }
  provisional.selections = groupedCandidates(candidates).map(({ role, candidates: choices }) => {
    const requested = requestedByRole.get(role);
    const requestedId = text(requested?.candidateId, 32);
    const belongsToRole = choices.some(({ id }) => id === requestedId);
    return {
      role,
      candidateId:
        (belongsToRole ? requestedId : bestPlatformerEnemyCandidateId(role, provisional)) ??
        choices[0]!.id,
      confidence:
        typeof requested?.confidence === 'number' && Number.isFinite(requested.confidence)
          ? Math.max(0, Math.min(1, requested.confidence))
          : 0,
      rationale: text(requested?.rationale),
    };
  });
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

export async function buildPlatformerEnemyJudgeBoard(options: {
  keyArt: Buffer;
  candidates: readonly (PlatformerEnemyCandidateDescriptor & { processed: Buffer })[];
}): Promise<Buffer> {
  const width = 1200;
  const keyArtWidth = 720;
  const keyArtHeight = 405;
  const candidateSize = 210;
  const candidateGap = 38;
  const rowHeight = 255;
  const groups = groupedCandidates(options.candidates);
  const height = 465 + groups.length * rowHeight;
  const keyArt = await sharp(options.keyArt)
    .resize(keyArtWidth, keyArtHeight, {
      fit: 'contain',
      background: { r: 15, g: 21, b: 40 },
    })
    .png()
    .toBuffer();
  const renderedCandidates = new Map(
    await Promise.all(
      options.candidates.map(
        async (candidate) =>
          [
            candidate.id,
            await sharp(candidate.processed)
              .resize(candidateSize, candidateSize, {
                fit: 'contain',
                kernel: sharp.kernel.nearest,
                background: { r: 15, g: 21, b: 40, alpha: 1 },
              })
              .png()
              .toBuffer(),
          ] as const,
      ),
    ),
  );
  const composites: sharp.OverlayOptions[] = [
    { input: keyArt, left: Math.floor((width - keyArtWidth) / 2), top: 42 },
    {
      input: labelSvg(keyArtWidth, 40, 'KEY ART · WORLD STYLE'),
      left: Math.floor((width - keyArtWidth) / 2),
      top: 4,
    },
  ];
  groups.forEach(({ role, candidates: roleCandidates }, rowIndex) => {
    const top = 465 + rowIndex * rowHeight;
    const rowWidth =
      roleCandidates.length * candidateSize + Math.max(0, roleCandidates.length - 1) * candidateGap;
    const startX = Math.floor((width - rowWidth) / 2);
    roleCandidates.forEach(({ id }, candidateIndex) => {
      const left = startX + candidateIndex * (candidateSize + candidateGap);
      composites.push(
        { input: renderedCandidates.get(id)!, left, top: top + 35 },
        {
          input: labelSvg(candidateSize, 36, `${role.toUpperCase()} · ${id}`),
          left,
          top: top + candidateSize + 30,
        },
      );
    });
  });
  return sharp({
    create: { width, height, channels: 3, background: '#0a1020' },
  })
    .composite(composites)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
