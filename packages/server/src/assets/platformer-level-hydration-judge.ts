import sharp, { type OverlayOptions } from 'sharp';
import type { PlatformerLevelHydrationResult } from './platformer-level-lab';

export const PLATFORMER_LEVEL_HYDRATION_JUDGE_PROMPT_VERSION =
  'platformer-level-hydration-judge-v1';

export interface PlatformerLevelHydrationGeometryReview {
  id: string;
  score: number;
  viable: boolean;
  reasons: string[];
  metrics: PlatformerLevelHydrationResult['metrics'];
}

export interface PlatformerLevelHydrationAestheticReview {
  id: string;
  scores: {
    craftsmanship: number;
    materialRichness: number;
    visualCohesion: number;
    gameplayReadability: number;
  };
  issues: string[];
  summary: string;
}

export interface PlatformerLevelHydrationJudgeDecision {
  candidateReviews: PlatformerLevelHydrationAestheticReview[];
  selection: {
    candidateId: string;
    confidence: number;
    rationale: string;
  };
}

export function reviewPlatformerLevelHydrationGeometry(
  id: string,
  metrics: PlatformerLevelHydrationResult['metrics'],
): PlatformerLevelHydrationGeometryReview {
  const reasons: string[] = [];
  if (metrics.paintOutsideVisualMaskRatio > 0.24) {
    reasons.push(
      `${Math.round(metrics.paintOutsideVisualMaskRatio * 100)}% of air outside the render mask was painted`,
    );
  }
  if (metrics.rejectedPaintRatio > 0.45) {
    reasons.push(
      `${Math.round(metrics.rejectedPaintRatio * 100)}% of generated paint was rejected`,
    );
  }
  if (metrics.collisionCoverageRatio < 0.52) {
    reasons.push(
      `only ${Math.round(metrics.collisionCoverageRatio * 100)}% of collision received source paint`,
    );
  }
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          metrics.rejectedPaintRatio * 65 -
          metrics.missingTerrainRatio * 38 -
          metrics.paintOutsideVisualMaskRatio * 22,
      ),
    ),
  );
  return { id, score, viable: reasons.length === 0, reasons, metrics };
}

export function buildPlatformerLevelHydrationJudgeSchema(
  candidates: readonly PlatformerLevelHydrationGeometryReview[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const score = { type: 'integer', minimum: 0, maximum: 5 };
  return {
    title: 'Platformer level hydration art-direction selection',
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
                'craftsmanship',
                'materialRichness',
                'visualCohesion',
                'gameplayReadability',
              ],
              properties: {
                craftsmanship: score,
                materialRichness: score,
                visualCohesion: score,
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

export function buildPlatformerLevelHydrationJudgePrompt(
  concept: string,
  candidates: readonly PlatformerLevelHydrationGeometryReview[],
): { system: string; user: string } {
  const candidateSummary = candidates
    .map(
      ({ id, score, metrics }) =>
        `${id}: geometry ${score}/100, accepted paint ${Math.round(metrics.acceptedPaintRatio * 100)}%, source collision coverage ${Math.round(metrics.collisionCoverageRatio * 100)}%`,
    )
    .join('; ');
  return {
    system: [
      'You are the art director selecting terrain hydration for a premium SNES-style platform game.',
      'The attached labeled board shows the canonical collision guide first, followed by locally processed candidate terrain on a neutral dark background.',
      'Every shown candidate has already passed deterministic geometry gates. Do not reject candidates or second-guess collision placement; compare their visual quality only.',
      'Score crisp pixel craftsmanship, material richness, stylistic cohesion across the entire level, and gameplay readability of walkable surfaces, hazards, and depth hierarchy.',
      'Penalize ugly stretched fills, repetitive slabs, abrupt seams, malformed architecture, muddy silhouettes, excessive empty-looking collision, or scenery that makes terrain hard to read.',
      'Select exactly one strongest available candidate. Return only the requested JSON object.',
    ].join(' '),
    user: `Level concept: ${clean(concept)}. Review ${candidateSummary} and select the best-looking viable hydration.`,
  };
}

export async function buildPlatformerLevelHydrationJudgeBoard(input: {
  guide: Buffer;
  candidates: Array<{
    id: string;
    safeTerrain: Buffer;
    geometry: PlatformerLevelHydrationGeometryReview;
  }>;
}): Promise<Buffer> {
  const width = 1200;
  const imageHeight = 225;
  const labelHeight = 34;
  const gap = 10;
  const rowHeight = labelHeight + imageHeight + gap;
  const totalHeight = rowHeight * (input.candidates.length + 1) + gap;
  const composites: OverlayOptions[] = [];
  const guide = await sharp(input.guide)
    .resize(width, imageHeight, { fit: 'fill', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  composites.push({ input: guide, left: 0, top: labelHeight });
  composites.push({
    input: labelSvg(width, labelHeight, 'CANONICAL COLLISION GUIDE'),
    left: 0,
    top: 0,
  });

  for (let index = 0; index < input.candidates.length; index++) {
    const candidate = input.candidates[index]!;
    const top = (index + 1) * rowHeight;
    const terrain = await sharp({
      create: { width, height: imageHeight, channels: 3, background: '#15192a' },
    })
      .composite([
        {
          input: await sharp(candidate.safeTerrain)
            .resize(width, imageHeight, { fit: 'fill', kernel: sharp.kernel.nearest })
            .png()
            .toBuffer(),
        },
      ])
      .png()
      .toBuffer();
    const label = `${candidate.id} · GEOMETRY ${candidate.geometry.score}/100 · ACCEPTED ${Math.round(candidate.geometry.metrics.acceptedPaintRatio * 100)}%`;
    composites.push({ input: labelSvg(width, labelHeight, label), left: 0, top });
    composites.push({ input: terrain, left: 0, top: top + labelHeight });
  }

  return sharp({
    create: { width, height: totalHeight, channels: 3, background: '#090c18' },
  })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

export function normalizePlatformerLevelHydrationJudgeDecision(
  value: unknown,
  candidates: readonly PlatformerLevelHydrationGeometryReview[],
): PlatformerLevelHydrationJudgeDecision {
  const root = record(value);
  const ids = new Set(candidates.map(({ id }) => id));
  const reviews = new Map<string, PlatformerLevelHydrationAestheticReview>();
  for (const raw of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(raw);
    const id = text(review.id, 24);
    if (!ids.has(id) || reviews.has(id)) continue;
    const scores = record(review.scores);
    reviews.set(id, {
      id,
      scores: {
        craftsmanship: boundedScore(scores.craftsmanship),
        materialRichness: boundedScore(scores.materialRichness),
        visualCohesion: boundedScore(scores.visualCohesion),
        gameplayReadability: boundedScore(scores.gameplayReadability),
      },
      issues: strings(review.issues),
      summary: text(review.summary),
    });
  }
  for (const candidate of candidates) {
    if (reviews.has(candidate.id)) continue;
    reviews.set(candidate.id, {
      id: candidate.id,
      scores: {
        craftsmanship: 0,
        materialRichness: 0,
        visualCohesion: 0,
        gameplayReadability: 0,
      },
      issues: ['judge omitted this candidate'],
      summary: '',
    });
  }
  const requestedId = text(record(root.selection).candidateId, 24);
  const candidateId = ids.has(requestedId)
    ? requestedId
    : [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0]!.id;
  return {
    candidateReviews: candidates.map(({ id }) => reviews.get(id)!),
    selection: {
      candidateId,
      confidence: boundedConfidence(record(root.selection).confidence),
      rationale: text(record(root.selection).rationale),
    },
  };
}

function labelSvg(width: number, height: number, label: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#202746"/><text x="16" y="23" fill="#eef1ff" font-family="monospace" font-size="16" font-weight="700">${escapeXml(label)}</text></svg>`,
  );
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedScore(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(5, Math.round(numeric)));
}

function boundedConfidence(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, numeric));
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

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    if (character === '"') return '&quot;';
    return '&apos;';
  });
}
