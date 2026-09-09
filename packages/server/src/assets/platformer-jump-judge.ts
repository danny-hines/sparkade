import sharp from 'sharp';
import { platformerReviewSprite } from './platformer-review';

export const PLATFORMER_JUMP_JUDGE_PROMPT_VERSION = 'platformer-jump-judge-v1';

export interface PlatformerJumpCandidateDescriptor {
  id: string;
}

export interface PlatformerJumpJudgeBoardAsset {
  id: string;
  processed: Buffer;
}

export interface PlatformerJumpCandidateReview {
  id: string;
  scores: {
    identity: number;
    costume: number;
    pose: number;
    technical: number;
  };
  fatalIssues: string[];
  summary: string;
}

export interface PlatformerJumpJudgeDecision {
  candidateReviews: PlatformerJumpCandidateReview[];
  selection: {
    accepted: boolean;
    candidateId: string;
    confidence: number;
    rationale: string;
    retryGuidance: string;
  };
}

export function bestPlatformerJumpCandidateId(
  decision: PlatformerJumpJudgeDecision,
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const review of decision.candidateReviews) {
    const score =
      review.scores.identity * 5 +
      review.scores.costume * 5 +
      review.scores.pose * 2 +
      review.scores.technical -
      review.fatalIssues.length * 20;
    if (!best || score > best.score) best = { id: review.id, score };
  }
  return best?.id ?? null;
}

export function buildPlatformerJumpJudgeSchema(
  candidates: readonly PlatformerJumpCandidateDescriptor[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const score = { type: 'integer', minimum: 0, maximum: 5 };
  return {
    title: 'Platformer jump identity and costume judge',
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
          required: ['id', 'scores', 'fatalIssues', 'summary'],
          properties: {
            id: { type: 'string', enum: ids },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: ['identity', 'costume', 'pose', 'technical'],
              properties: {
                identity: score,
                costume: score,
                pose: score,
                technical: score,
              },
            },
            fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            summary: { type: 'string' },
          },
        },
      },
      selection: {
        type: 'object',
        additionalProperties: false,
        required: ['accepted', 'candidateId', 'confidence', 'rationale', 'retryGuidance'],
        properties: {
          accepted: { type: 'boolean' },
          candidateId: { type: 'string', enum: ['', ...ids] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          rationale: { type: 'string' },
          retryGuidance: { type: 'string' },
        },
      },
    },
  };
}

export function buildPlatformerJumpJudgePrompt(
  candidates: readonly PlatformerJumpCandidateDescriptor[],
  options: { heroConcept?: string; sourceKind: 'photo' | 'key-art' },
): { system: string; user: string } {
  const sourceRule =
    options.sourceKind === 'photo'
      ? 'SOURCE PHOTO is immutable identity truth from the neck up; its clothing below the neck is not wardrobe truth.'
      : 'SOURCE KEY ART provides the original character identity when no photo exists.';
  return {
    system: [
      'You are the exacting character-continuity and animation QA judge for a premium SNES-style platform game.',
      'Inspect the attached labeled review board and judge only what is visibly present.',
      sourceRule,
      'FRONT IDLE establishes the canonical game-world costume, body presentation, palette placement, and proportions. SIDE ANCHOR carries that exact identity and costume into profile.',
      options.heroConcept
        ? `The canonical written costume contract is: ${clean(options.heroConcept, 500)}.`
        : '',
      'Every J candidate must show the same recognizable person and exact costume as FRONT IDLE and SIDE ANCHOR. A jump may change limb placement and fabric folds, but it may not remove or replace a jacket, shirt, sleeves, armor, gloves, trousers, footwear, patches, belts, or body-worn accessories; expose newly bare skin; or change their colors and materials.',
      'The pose must be a readable RIGHT-facing airborne platforming jump with both feet off the ground, knees bent, both hands empty, and no attack or invented prop.',
      'Fatal issues include identity drift, any wardrobe substitution or missing garment, invented/removed eyewear or headwear, changed apparent age or body proportions, props, extra limbs, cropping, wrong facing, grounded feet, and severe technical defects.',
      'Score identity, costume, pose, and technical quality from 0 (unusable) to 5 (excellent). Select a candidate only when it has no fatal issue, identity/costume/pose are each at least 4, and technical is at least 3. Otherwise return accepted=false with an empty candidateId and concrete retry guidance.',
      'Return only the requested JSON object.',
    ]
      .filter(Boolean)
      .join(' '),
    user: [
      `Jump candidates: ${candidates.map(({ id }) => id).join(', ')}.`,
      'Compare every candidate directly against FRONT IDLE and SIDE ANCHOR. Prioritize identity and exact wardrobe continuity, then choose the strongest readable jump pose.',
    ].join(' '),
  };
}

export function normalizePlatformerJumpJudgeDecision(
  value: unknown,
  candidates: readonly PlatformerJumpCandidateDescriptor[],
): PlatformerJumpJudgeDecision {
  const root = record(value);
  const validIds = new Set(candidates.map(({ id }) => id));
  const byId = new Map<string, PlatformerJumpCandidateReview>();
  for (const rawReview of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(rawReview);
    const id = text(review.id, 32);
    if (!validIds.has(id) || byId.has(id)) continue;
    const scores = record(review.scores);
    byId.set(id, {
      id,
      scores: {
        identity: score(scores.identity),
        costume: score(scores.costume),
        pose: score(scores.pose),
        technical: score(scores.technical),
      },
      fatalIssues: strings(review.fatalIssues),
      summary: text(review.summary),
    });
  }
  const candidateReviews = candidates.map(
    ({ id }) =>
      byId.get(id) ?? {
        id,
        scores: { identity: 0, costume: 0, pose: 0, technical: 0 },
        fatalIssues: ['Judge omitted this candidate'],
        summary: 'No usable review was returned.',
      },
  );
  const rawSelection = record(root.selection);
  const requestedId = text(rawSelection.candidateId, 32);
  const selected = candidateReviews.find(({ id }) => id === requestedId);
  const accepted =
    rawSelection.accepted === true &&
    !!selected &&
    selected.fatalIssues.length === 0 &&
    selected.scores.identity >= 4 &&
    selected.scores.costume >= 4 &&
    selected.scores.pose >= 4 &&
    selected.scores.technical >= 3;
  return {
    candidateReviews,
    selection: {
      accepted,
      candidateId: accepted ? requestedId : '',
      confidence: clampNumber(rawSelection.confidence, 0, 1),
      rationale: text(rawSelection.rationale),
      retryGuidance: text(rawSelection.retryGuidance),
    },
  };
}

export async function buildPlatformerJumpJudgeBoard(input: {
  source: Buffer;
  sourceKind: 'photo' | 'key-art';
  idle: Buffer;
  sideAnchor: Buffer;
  candidates: readonly PlatformerJumpJudgeBoardAsset[];
  purpose?: 'actions';
}): Promise<Buffer> {
  const width = 1720;
  const columns = 3;
  const candidateRows = Math.max(1, Math.ceil(input.candidates.length / columns));
  const height = 500 + candidateRows * 350;
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  const panel = (x: number, y: number, w: number, h: number, label: string): void => {
    layers.push({
      input: Buffer.from(
        `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="#151a31" stroke="#3b4678" stroke-width="2"/><text x="${w / 2}" y="30" text-anchor="middle" fill="#7ee8fa" font-family="monospace" font-size="20" font-weight="bold">${escapeXml(label)}</text></svg>`,
      ),
      left: x,
      top: y,
    });
  };

  layers.push({
    input: Buffer.from(
      '<svg width="1640" height="70" xmlns="http://www.w3.org/2000/svg"><text x="0" y="30" fill="#f5f7ff" font-family="monospace" font-size="26" font-weight="bold">PLATFORMER JUMP CONTINUITY REVIEW</text><text x="0" y="58" fill="#aab3d5" font-family="monospace" font-size="16">Identity truth → canonical costume → select one airborne pose</text></svg>'
        .replace(
          'PLATFORMER JUMP CONTINUITY REVIEW',
          input.purpose === 'actions'
            ? 'PLATFORMER ACTION CONTINUITY REVIEW'
            : 'PLATFORMER JUMP CONTINUITY REVIEW',
        )
        .replace(
          'select one airborne pose',
          input.purpose === 'actions' ? 'review each required action' : 'select one airborne pose',
        ),
    ),
    left: 40,
    top: 20,
  });
  panel(40, 90, 300, 370, input.sourceKind === 'photo' ? 'SOURCE PHOTO' : 'SOURCE KEY ART');
  layers.push({
    input: await sharp(input.source)
      .resize(270, 310, { fit: 'contain', background: '#151a31' })
      .png()
      .toBuffer(),
    left: 55,
    top: 130,
  });
  panel(380, 90, 300, 370, 'FRONT IDLE · COSTUME');
  layers.push({ input: await enlargedSprite(input.idle, 224, 256), left: 418, top: 140 });
  panel(720, 90, 300, 370, 'SIDE ANCHOR');
  layers.push({ input: await enlargedSprite(input.sideAnchor, 224, 256), left: 758, top: 140 });
  layers.push({
    input: Buffer.from(
      '<svg width="610" height="300" xmlns="http://www.w3.org/2000/svg"><text x="0" y="30" fill="#ffd75e" font-family="monospace" font-size="20" font-weight="bold">WARDROBE IS IMMUTABLE</text><text x="0" y="72" fill="#c4cae8" font-family="monospace" font-size="17"><tspan x="0" dy="0">• Same person, face, hair and head accessories</tspan><tspan x="0" dy="34">• Same jacket, sleeves, shirt, armor and gloves</tspan><tspan x="0" dy="34">• Same trousers, belt, footwear and color placement</tspan><tspan x="0" dy="34">• Both feet visibly airborne in a clear jump</tspan><tspan x="0" dy="34">• Reject exposed skin caused by missing clothing</tspan><tspan x="0" dy="34">• Reject props, cropping, drift or extra limbs</tspan></text></svg>'.replace(
        'Both feet visibly airborne in a clear jump',
        input.purpose === 'actions'
          ? 'Match each requested movement and attack'
          : 'Both feet visibly airborne in a clear jump',
      ),
    ),
    left: 1070,
    top: 130,
  });

  input.candidates.forEach(({ id }, index) => {
    const x = 40 + (index % columns) * 560;
    const y = 490 + Math.floor(index / columns) * 350;
    panel(x, y, 520, 320, id);
  });
  for (let index = 0; index < input.candidates.length; index++) {
    const x = 40 + (index % columns) * 560;
    const y = 490 + Math.floor(index / columns) * 350;
    layers.push({
      input: await enlargedSprite(
        input.candidates[index]!.processed,
        input.purpose === 'actions' ? 320 : 224,
        256,
      ),
      left: x + (input.purpose === 'actions' ? 100 : 148),
      top: y + 50,
    });
  }

  return sharp({ create: { width, height, channels: 3, background: '#090c18' } })
    .composite(layers)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function enlargedSprite(sprite: Buffer, width: number, height: number): Promise<Buffer> {
  const checker = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="c" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#202640"/><rect width="12" height="12" fill="#2a3150"/><rect x="12" y="12" width="12" height="12" fill="#2a3150"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`,
  );
  const enlarged = await platformerReviewSprite(sprite, width, height);
  return sharp(checker)
    .composite([{ input: enlarged }])
    .png()
    .toBuffer();
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, max = 1200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function clean(value: string | undefined, max: number): string {
  return value?.replace(/\s+/g, ' ').trim().slice(0, max) ?? '';
}

function score(value: unknown): number {
  return Math.round(clampNumber(value, 0, 5));
}

function clampNumber(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : min;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => text(item, 240))
        .filter(Boolean)
        .slice(0, 8)
    : [];
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character] ?? character;
  });
}
