import sharp from 'sharp';

export const PLAYER_CRAFT_JUDGE_PROMPT_VERSION = 'player-craft-judge-v1';

export type PlayerCraftOrientation = 'top-down' | 'side-view';

export interface PlayerCraftCandidateDescriptor {
  id: string;
}

export interface PlayerCraftJudgeDecision {
  candidateReviews: Array<{
    id: string;
    concept: number;
    orientation: number;
    silhouette: number;
    readability: number;
    technical: number;
    fatalIssues: string[];
    summary: string;
  }>;
  selection: {
    accepted: boolean;
    candidateId: string;
    rationale: string;
    retryGuidance: string;
  };
}

export async function buildPlayerCraftJudgeBoard(options: {
  candidates: readonly { id: string; processed: Buffer }[];
  orientation: PlayerCraftOrientation;
}): Promise<Buffer> {
  const panelWidth = 300;
  const panelHeight = 300;
  const cells = await Promise.all(
    options.candidates.map(async ({ id, processed }, index) => {
      const sprite = await sharp(processed)
        .resize(220, 220, {
          fit: 'contain',
          kernel: sharp.kernel.nearest,
          background: { r: 25, g: 31, b: 45, alpha: 1 },
        })
        .extend({
          top: 42,
          bottom: 38,
          left: 40,
          right: 40,
          background: { r: 25, g: 31, b: 45, alpha: 1 },
        })
        .composite([
          {
            input: Buffer.from(
              `<svg width="300" height="42"><rect width="300" height="42" fill="#0d1320"/><text x="150" y="29" text-anchor="middle" font-family="monospace" font-size="24" fill="#ffffff">${id}</text></svg>`,
            ),
            top: 0,
            left: 0,
          },
        ])
        .png()
        .toBuffer();
      return { input: sprite, left: index * panelWidth, top: 0 };
    }),
  );
  return sharp({
    create: {
      width: Math.max(1, options.candidates.length) * panelWidth,
      height: panelHeight,
      channels: 4,
      background: { r: 13, g: 19, b: 32, alpha: 1 },
    },
  })
    .composite(cells)
    .png()
    .toBuffer();
}

export function buildPlayerCraftJudgePrompt(
  candidates: readonly PlayerCraftCandidateDescriptor[],
  options: { orientation: PlayerCraftOrientation; visualConcept: string },
): { system: string; user: string } {
  const direction =
    options.orientation === 'top-down'
      ? 'strict top-down view, nose toward the top'
      : 'strict side profile, nose toward the right';
  return {
    system:
      'You are Muse Spark, the art director selecting gameplay vehicle art. Judge only the labeled candidates in the supplied board. Return strict JSON.',
    user: [
      `Select the strongest player craft from: ${candidates.map(({ id }) => id).join(', ')}.`,
      `Canonical concept: ${options.visualConcept}.`,
      `Required orientation: ${direction}.`,
      'Score concept fidelity, exact orientation, silhouette, small gameplay readability, and technical pixel-art quality from 1 to 5. A fatal issue is a wrong camera direction, cropped/multiple craft, person, unreadable silhouette, or broken transparency.',
      'accepted should be true only when the winning candidate has no fatal issue and is production quality. Even when accepted is false, candidateId MUST identify the best available candidate and retryGuidance should describe the most important correction.',
    ].join(' '),
  };
}

export function buildPlayerCraftJudgeSchema(
  candidates: readonly PlayerCraftCandidateDescriptor[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  return {
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
          required: [
            'id',
            'concept',
            'orientation',
            'silhouette',
            'readability',
            'technical',
            'fatalIssues',
            'summary',
          ],
          properties: {
            id: { type: 'string', enum: ids },
            concept: { type: 'integer', minimum: 1, maximum: 5 },
            orientation: { type: 'integer', minimum: 1, maximum: 5 },
            silhouette: { type: 'integer', minimum: 1, maximum: 5 },
            readability: { type: 'integer', minimum: 1, maximum: 5 },
            technical: { type: 'integer', minimum: 1, maximum: 5 },
            fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            summary: { type: 'string' },
          },
        },
      },
      selection: {
        type: 'object',
        additionalProperties: false,
        required: ['accepted', 'candidateId', 'rationale', 'retryGuidance'],
        properties: {
          accepted: { type: 'boolean' },
          candidateId: { type: 'string', enum: ids },
          rationale: { type: 'string' },
          retryGuidance: { type: 'string' },
        },
      },
    },
  };
}

function score(review: PlayerCraftJudgeDecision['candidateReviews'][number]): number {
  return (
    review.concept +
    review.orientation * 1.5 +
    review.silhouette * 1.25 +
    review.readability * 1.25 +
    review.technical -
    review.fatalIssues.length * 8
  );
}

export function normalizePlayerCraftJudgeDecision(
  value: unknown,
  candidates: readonly PlayerCraftCandidateDescriptor[],
): PlayerCraftJudgeDecision {
  const ids = new Set(candidates.map(({ id }) => id));
  const raw = value as Partial<PlayerCraftJudgeDecision>;
  const reviews = Array.isArray(raw?.candidateReviews)
    ? raw.candidateReviews.filter((review) => review && ids.has(String(review.id)))
    : [];
  const byId = new Map(reviews.map((review) => [review.id, review]));
  const normalizedReviews = candidates.map(({ id }) => {
    const review = byId.get(id);
    const clamp = (n: unknown) => Math.max(1, Math.min(5, Number.isFinite(Number(n)) ? Number(n) : 1));
    return {
      id,
      concept: clamp(review?.concept),
      orientation: clamp(review?.orientation),
      silhouette: clamp(review?.silhouette),
      readability: clamp(review?.readability),
      technical: clamp(review?.technical),
      fatalIssues: Array.isArray(review?.fatalIssues)
        ? review.fatalIssues.map(String).filter(Boolean).slice(0, 8)
        : [],
      summary: String(review?.summary ?? ''),
    };
  });
  const requestedId = String(raw?.selection?.candidateId ?? '');
  const best = [...normalizedReviews].sort((a, b) => score(b) - score(a))[0]!;
  const selected = ids.has(requestedId) ? requestedId : best.id;
  return {
    candidateReviews: normalizedReviews,
    selection: {
      accepted: Boolean(raw?.selection?.accepted) && ids.has(requestedId),
      candidateId: selected,
      rationale: String(raw?.selection?.rationale ?? ''),
      retryGuidance: String(raw?.selection?.retryGuidance ?? ''),
    },
  };
}

export function bestPlayerCraftCandidateId(decision: PlayerCraftJudgeDecision): string {
  return [...decision.candidateReviews].sort((a, b) => score(b) - score(a))[0]!.id;
}
