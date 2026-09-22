import {
  characterReferenceInstruction,
  characterReferenceLabel,
  type CharacterReferenceKind,
} from './character-reference';
import sharp from 'sharp';
import { platformerReviewSprite } from './platformer-review';
import { buildPlatformerPosePrompt, type PlatformerPosePromptOptions } from './platformer-pose';

export const PLATFORMER_IDLE_JUDGE_PROMPT_VERSION = 'platformer-idle-judge-v3';

export type PlatformerEyewearState = 'present' | 'absent' | 'uncertain';

export interface PlatformerIdleCandidateDescriptor {
  id: string;
}

export interface PlatformerIdleCandidateReview {
  id: string;
  eyewear: PlatformerEyewearState;
  eyewearMatch: boolean;
  scores: {
    identity: number;
    faceAndHair: number;
    accessories: number;
    costume: number;
    proportions: number;
    pose: number;
    technical: number;
  };
  fatalIssues: string[];
  summary: string;
}

export interface PlatformerIdleJudgeDecision {
  sourceReview: {
    eyewear: PlatformerEyewearState;
    summary: string;
  };
  candidateReviews: PlatformerIdleCandidateReview[];
  selection: {
    accepted: boolean;
    candidateId: string;
    confidence: number;
    rationale: string;
    retryGuidance: string;
  };
}

/** Choose from locally valid candidates even when the art-direction threshold
 * rejects the batch. Spark's scores still decide the winner; it no longer has
 * authority to discard an otherwise processable generated character. */
export function bestPlatformerIdleCandidateId(
  decision: PlatformerIdleJudgeDecision,
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const review of decision.candidateReviews) {
    const scores = review.scores;
    const total =
      scores.identity * 5 +
      scores.faceAndHair * 4 +
      scores.accessories * 3 +
      scores.costume * 2 +
      scores.proportions * 2 +
      scores.pose +
      scores.technical -
      review.fatalIssues.length * 12 -
      (review.eyewearMatch ? 0 : 15);
    if (!best || total > best.score) best = { id: review.id, score: total };
  }
  return best?.id ?? null;
}

export interface PlatformerIdleJudgeBoardCandidate {
  id: string;
  raw: Buffer;
  processed: Buffer;
}

export function buildPlatformerIdleCandidatePrompt(
  candidateId: string,
  options: PlatformerPosePromptOptions & { retryGuidance?: string } = {},
): string {
  const retryGuidance = options.retryGuidance?.replace(/\s+/g, ' ').trim().slice(0, 500);
  return [
    buildPlatformerPosePrompt('idle', options),
    `Generate an independent identity-foundation variation labeled ${candidateId} for evaluation. Do not render this label in the image.`,
    'The face must remain recognizably the same adult. Treat eye sockets, eyebrows, eyelashes, smile lines, and wrinkles as distinct facial features—not glasses. Add eyewear only when it is visibly present in the identity reference (the LEFT photo when a character art board is supplied), and preserve its exact general shape when present.',
    retryGuidance
      ? `RETRY CORRECTION FROM THE ART DIRECTOR: ${retryGuidance} Apply only this visual correction while preserving the source identity.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildPlatformerIdleJudgeSchema(
  candidates: readonly PlatformerIdleCandidateDescriptor[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const score = { type: 'integer', minimum: 0, maximum: 5 };
  const eyewear = { type: 'string', enum: ['present', 'absent', 'uncertain'] };
  return {
    title: 'Platformer front-idle identity foundation judge',
    type: 'object',
    additionalProperties: false,
    required: ['sourceReview', 'candidateReviews', 'selection'],
    properties: {
      sourceReview: {
        type: 'object',
        additionalProperties: false,
        required: ['eyewear', 'summary'],
        properties: {
          eyewear,
          summary: { type: 'string' },
        },
      },
      candidateReviews: {
        type: 'array',
        minItems: candidates.length,
        maxItems: candidates.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'eyewear', 'eyewearMatch', 'scores', 'fatalIssues', 'summary'],
          properties: {
            id: { type: 'string', enum: ids },
            eyewear,
            eyewearMatch: { type: 'boolean' },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: [
                'identity',
                'faceAndHair',
                'accessories',
                'costume',
                'proportions',
                'pose',
                'technical',
              ],
              properties: {
                identity: score,
                faceAndHair: score,
                accessories: score,
                costume: score,
                proportions: score,
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

export function buildPlatformerIdleJudgePrompt(
  candidates: readonly PlatformerIdleCandidateDescriptor[],
  options: Pick<PlatformerPosePromptOptions, 'heroConcept'> & {
    sourceKind?: CharacterReferenceKind;
  } = {},
): { system: string; user: string } {
  const ids = candidates.map(({ id }) => id).join(', ');
  const heroConcept = options.heroConcept?.replace(/\s+/g, ' ').trim().slice(0, 500);
  const sourceName = characterReferenceLabel(options.sourceKind ?? 'photo');
  return {
    system: [
      'You are the exacting identity art director for a premium SNES-style platform game.',
      `Inspect the attached front-idle identity-foundation review board. The ${sourceName} is the canonical identity truth. Judge every candidate independently from that source and its costume against the canonical game-world wardrobe supplied in the user message. Do not let one generated candidate redefine the person or outfit for another.`,
      characterReferenceInstruction(options.sourceKind ?? 'photo'),
      'The large RAW view is the high-resolution image that will seed every downstream edit. Inspect it closely for facial contamination that a tiny runtime sprite may hide. The small PROCESSED view shows the actual 112x128 high-density silhouette and scale.',
      'First classify whether the source visibly has eyewear. Then classify every candidate. Dark pixels, wrinkles, eyebrows, eyelashes, eye sockets, or shading that resemble invented glasses are an eyewear mismatch and a fatal identity artifact when the source has no glasses. Missing or materially changed source eyewear is equally fatal.',
      'Identity includes apparent adult age, face and head shape, skin tone, hairline, hair texture and style, facial hair, eyewear, headwear, and visible head accessories. Costume is a separate score: it must faithfully realize the supplied canonical wardrobe from the neck down, including its garments, colors, materials, silhouette, footwear, and body-worn details. Do not penalize a candidate for replacing the source photo clothing.',
      'Becoming bald, childlike, generically younger, differently proportioned, or gaining or losing a head accessory is fatal. Copying unrelated source-photo clothing instead of the requested costume is a costume failure.',
      'A usable foundation must also show exactly one complete uncropped person, a neutral front-facing idle pose, empty hands, coherent anatomy, readable native-scale pixel technique, and no props, text, scenery, borders, or severe artifacts.',
      'Score every category from 0 (unusable) to 5 (excellent). Select the strongest candidate only if it has no fatal issue, eyewearMatch=true, and every score is at least 4. Otherwise reject all with an empty candidateId and give concrete retry guidance.',
      'Return only the requested JSON object.',
    ].join(' '),
    user: [
      `Review front-idle candidates ${ids}. Compare each RAW and PROCESSED character directly with ${sourceName}, record all candidate reviews, and select the safest identity foundation or reject the batch.`,
      heroConcept
        ? `CANONICAL GAME-WORLD WARDROBE: ${heroConcept}`
        : 'No separate wardrobe brief was supplied; judge costume coherence consistently across the candidate itself.',
    ].join(' '),
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

function eyewearState(value: unknown): PlatformerEyewearState {
  return value === 'present' || value === 'absent' ? value : 'uncertain';
}

export function normalizePlatformerIdleJudgeDecision(
  value: unknown,
  candidates: readonly PlatformerIdleCandidateDescriptor[],
): PlatformerIdleJudgeDecision {
  const root = record(value);
  const source = record(root.sourceReview);
  const sourceEyewear = eyewearState(source.eyewear);
  const expectedIds = new Set(candidates.map(({ id }) => id));
  const reviewsById = new Map<string, PlatformerIdleCandidateReview>();
  for (const rawReview of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(rawReview);
    const id = text(review.id, 32);
    if (!expectedIds.has(id) || reviewsById.has(id)) continue;
    const scores = record(review.scores);
    reviewsById.set(id, {
      id,
      eyewear: eyewearState(review.eyewear),
      eyewearMatch: review.eyewearMatch === true,
      scores: {
        identity: score(scores.identity),
        faceAndHair: score(scores.faceAndHair),
        accessories: score(scores.accessories),
        costume: score(scores.costume),
        proportions: score(scores.proportions),
        pose: score(scores.pose),
        technical: score(scores.technical),
      },
      fatalIssues: strings(review.fatalIssues),
      summary: text(review.summary),
    });
  }
  const candidateReviews = candidates.map(
    ({ id }): PlatformerIdleCandidateReview =>
      reviewsById.get(id) ?? {
        id,
        eyewear: 'uncertain',
        eyewearMatch: false,
        scores: {
          identity: 0,
          faceAndHair: 0,
          accessories: 0,
          costume: 0,
          proportions: 0,
          pose: 0,
          technical: 0,
        },
        fatalIssues: ['Judge omitted this candidate'],
        summary: 'No usable review was returned.',
      },
  );

  const rawSelection = record(root.selection);
  const requestedId = text(rawSelection.candidateId, 32);
  const selected = candidateReviews.find(({ id }) => id === requestedId);
  const scores = selected ? Object.values(selected.scores) : [];
  const eyewearConsistent =
    !!selected &&
    selected.eyewearMatch &&
    (sourceEyewear === 'uncertain' || selected.eyewear === sourceEyewear);
  const accepted =
    rawSelection.accepted === true &&
    !!selected &&
    selected.fatalIssues.length === 0 &&
    eyewearConsistent &&
    scores.every((value) => value >= 4);

  return {
    sourceReview: {
      eyewear: sourceEyewear,
      summary: text(source.summary),
    },
    candidateReviews,
    selection: {
      accepted,
      candidateId: accepted ? requestedId : '',
      confidence:
        typeof rawSelection.confidence === 'number' && Number.isFinite(rawSelection.confidence)
          ? Math.max(0, Math.min(1, rawSelection.confidence))
          : 0,
      rationale: text(rawSelection.rationale),
      retryGuidance: text(rawSelection.retryGuidance),
    },
  };
}

export async function buildPlatformerIdleJudgeBoard(input: {
  source: Buffer;
  sourceKind?: CharacterReferenceKind;
  candidates: readonly PlatformerIdleJudgeBoardCandidate[];
}): Promise<Buffer> {
  const width = 1760;
  const height = 1180;
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  const panel = (x: number, y: number, w: number, h: number, label: string): void => {
    layers.push({
      input: Buffer.from(
        `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="#151a31" stroke="#3b4678" stroke-width="2"/><text x="${w / 2}" y="32" text-anchor="middle" fill="#7ee8fa" font-family="monospace" font-size="20" font-weight="bold">${escapeXml(label)}</text></svg>`,
      ),
      left: x,
      top: y,
    });
  };

  layers.push({
    input: Buffer.from(
      '<svg width="1680" height="70" xmlns="http://www.w3.org/2000/svg"><text x="0" y="30" fill="#f5f7ff" font-family="monospace" font-size="26" font-weight="bold">FRONT-IDLE IDENTITY FOUNDATION REVIEW</text><text x="0" y="58" fill="#aab3d5" font-family="monospace" font-size="16">Source identity truth → inspect high-resolution seed → verify native sprite</text></svg>',
    ),
    left: 40,
    top: 20,
  });
  panel(40, 90, 470, 430, characterReferenceLabel(input.sourceKind ?? 'photo'));
  layers.push({
    input: await sharp(input.source)
      .resize(420, 360, { fit: 'contain', background: '#151a31' })
      .png()
      .toBuffer(),
    left: 65,
    top: 135,
  });
  panel(550, 90, 1170, 430, 'NON-NEGOTIABLE FOUNDATION CHECKS');
  layers.push({
    input: Buffer.from(
      '<svg width="1080" height="330" xmlns="http://www.w3.org/2000/svg"><text x="0" y="34" fill="#ffd75e" font-family="monospace" font-size="22" font-weight="bold">COMPARE EACH CANDIDATE DIRECTLY TO SOURCE</text><text x="0" y="86" fill="#c4cae8" font-family="monospace" font-size="19"><tspan x="0" dy="0">• Classify source eyewear first; reject invented or missing glasses</tspan><tspan x="0" dy="42">• Preserve adult age, face/head shape, hairline and facial hair</tspan><tspan x="0" dy="42">• Match game wardrobe; source clothing below neck may change</tspan><tspan x="0" dy="42">• RAW is the downstream edit seed—inspect eye and face artifacts</tspan><tspan x="0" dy="42">• PROCESSED must be a complete neutral front idle with natural proportions</tspan><tspan x="0" dy="42">• Reject generic identity, props, extra subjects or anatomy defects</tspan></text></svg>',
    ),
    left: 600,
    top: 145,
  });

  for (const [index, candidate] of input.candidates.entries()) {
    const x = 40 + index * 570;
    const y = 560;
    panel(x, y, 540, 580, `${candidate.id} · RAW + PROCESSED`);
    layers.push({
      input: await sharp(candidate.raw)
        .resize(390, 440, { fit: 'contain', background: '#151a31' })
        .png()
        .toBuffer(),
      left: x + 25,
      top: y + 70,
    });
    layers.push({
      input: await enlargedIdleSprite(candidate.processed, 112, 128),
      left: x + 413,
      top: y + 215,
    });
    layers.push({
      input: Buffer.from(
        `<svg width="500" height="48" xmlns="http://www.w3.org/2000/svg"><text x="195" y="24" text-anchor="middle" fill="#aab3d5" font-family="monospace" font-size="15">HIGH-RES SEED</text><text x="445" y="24" text-anchor="middle" fill="#aab3d5" font-family="monospace" font-size="15">PLAYER SPRITE</text></svg>`,
      ),
      left: x + 20,
      top: y + 520,
    });
  }

  return sharp({ create: { width, height, channels: 3, background: '#090c18' } })
    .composite(layers)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function enlargedIdleSprite(sprite: Buffer, width: number, height: number): Promise<Buffer> {
  const checker = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="c" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#202640"/><rect width="8" height="8" fill="#2a3150"/><rect x="8" y="8" width="8" height="8" fill="#2a3150"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`,
  );
  const enlarged = await platformerReviewSprite(sprite, width, height);
  return sharp(checker)
    .composite([{ input: enlarged }])
    .png()
    .toBuffer();
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[char] ?? char;
  });
}
