import sharp from 'sharp';
import { platformerReviewSprite } from './platformer-review';
import type { ProviderUsage } from '@sparkade/shared';
import { buildPlatformerPosePrompt, type PlatformerPosePromptOptions } from './platformer-pose';

export const PLATFORMER_POSE_LAB_PROMPT_VERSION = 'platformer-pose-lab-v3';
export const PLATFORMER_POSE_JUDGE_PROMPT_VERSION = 'platformer-pose-judge-v5';
export const PLATFORMER_PLAYER_PIPELINE_PROMPT_VERSION = 'platformer-player-pipeline-v2';

export type PlatformerPoseCandidateKind = 'phase-a' | 'phase-b';

export interface PlatformerPoseCandidateDescriptor {
  id: string;
  kind: PlatformerPoseCandidateKind;
}

export interface PlatformerPoseJudgeBoardAsset {
  id: string;
  kind: PlatformerPoseCandidateKind;
  processed: Buffer;
}

export interface PlatformerPoseScore {
  identity: number;
  costume: number;
  pose: number;
  technical: number;
}

export interface PlatformerPoseCandidateReview {
  id: string;
  kind: PlatformerPoseCandidateKind;
  scores: PlatformerPoseScore;
  fatalIssues: string[];
  summary: string;
}

export interface PlatformerPosePairReview {
  phaseAId: string;
  phaseBId: string;
  legAlternation: number;
  armAlternation: number;
  pairConsistency: number;
  fatalIssues: string[];
  summary: string;
}

export interface PlatformerPoseAnchorReview {
  identity: number;
  sideView: number;
  costume: number;
  fatalIssues: string[];
  summary: string;
}

export interface PlatformerPosePairSelection {
  accepted: boolean;
  phaseAId: string;
  phaseBId: string;
  legAlternation: number;
  armAlternation: number;
  pairConsistency: number;
  confidence: number;
  rationale: string;
  retryGuidance: string;
}

export interface PlatformerPoseJudgeDecision {
  anchorReview: PlatformerPoseAnchorReview;
  candidateReviews: PlatformerPoseCandidateReview[];
  pairReviews: PlatformerPosePairReview[];
  selection: PlatformerPosePairSelection;
}

export interface PlatformerPoseJudgeResult {
  raw: string;
  decision: PlatformerPoseJudgeDecision;
  usage: ProviderUsage;
  model: string;
  provider: string;
}

export interface BestPlatformerPosePair {
  phaseAId: string;
  phaseBId: string;
}

/** Rank every locally valid A+B pair using Spark's semantic reviews. The
 * caller has already removed images that cannot be processed as sprites, so
 * this always returns the strongest available animation instead of allowing
 * an aesthetic threshold to discard the complete generated character. */
export function bestPlatformerPosePair(
  decision: PlatformerPoseJudgeDecision,
): BestPlatformerPosePair | null {
  const reviews = new Map(decision.candidateReviews.map((review) => [review.id, review]));
  let best: { pair: BestPlatformerPosePair; score: number } | null = null;
  for (const pair of decision.pairReviews) {
    const phaseA = reviews.get(pair.phaseAId);
    const phaseB = reviews.get(pair.phaseBId);
    if (!phaseA || !phaseB) continue;
    const candidateScore = (review: PlatformerPoseCandidateReview) =>
      review.scores.identity * 5 +
      review.scores.costume * 2 +
      review.scores.pose * 2 +
      review.scores.technical -
      review.fatalIssues.length * 12;
    const total =
      candidateScore(phaseA) +
      candidateScore(phaseB) +
      pair.legAlternation * 6 +
      pair.pairConsistency * 3 +
      pair.armAlternation -
      pair.fatalIssues.length * 12;
    if (!best || total > best.score) {
      best = {
        pair: { phaseAId: pair.phaseAId, phaseBId: pair.phaseBId },
        score: total,
      };
    }
  }
  return best?.pair ?? null;
}

function clean(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 500) : null;
}

function commonIdentityConstraints(): string[] {
  return [
    'Preserve the exact same character identity, apparent adult age, face shape, skin tone, hairline, hair texture and style, facial hair, eyewear, headwear, costume, footwear, accessories, and body proportions visible in the reference.',
    'Change only the requested pose and camera angle. Do not simplify the person into a child, make them bald, invent hair, invent glasses, remove glasses, or replace their face with a generic character.',
    'Keep both hands empty. Do not add a lantern, light, tool, weapon, bag, artifact, or any other prop.',
  ];
}

function commonSpriteConstraints(colors?: string): string[] {
  const colorDirection = clean(colors);
  return [
    colorDirection ? `Preserve this costume color direction: ${colorDirection}.` : '',
    'Show exactly one complete, uncropped full-body character from the top of the hair or headwear through both feet.',
    'Polished 16-bit SNES-era platformer pixel art authored for a native 112x128 high-density player sprite: crisp square pixel clusters, hard edges, a limited flat palette, and no antialiasing, blur, gradients, or photorealism.',
    'Preserve natural broad or round character proportions. Wider silhouettes may use a wider canvas at the same height; never stretch them into a narrow humanoid to fit.',
    'Keep the character centered, at the same scale, with the feet on the same ground line.',
    'This is one sprite in one pose, not a sprite sheet, turnaround, sequence, collage, portrait, or character-select card.',
    'No text, letters, numbers, logos, watermark, signature, UI, border, scenery, floor, platform, shadow, glow, particles, extra objects, or second character.',
    'The entire background must be perfectly flat solid #00ff00, including every gap enclosed by the arms and legs. Do not use #00ff00 or a near-neon imitation in the character.',
  ].filter(Boolean);
}

/** The lab keeps this intermediate private. It gives every action candidate the
 * same side-view identity, costume, scale, and pixel technique without also
 * locking all candidates into an already-extended running pose. */
export function buildPlatformerSideAnchorPrompt(
  options: {
    colors?: string;
  } = {},
): string {
  return [
    'Create exactly ONE isolated, full-body platform-game sprite from the exact character in the attached FRONT idle reference.',
    ...commonIdentityConstraints(),
    'Turn the character into a strict RIGHT-facing side profile in a neutral standing pose. Both feet are planted close beneath the hips, both legs are relaxed, the torso is upright, and the arms rest naturally at the sides. This is an identity and costume anchor, not a running, walking, jumping, attacking, or action pose.',
    'Make the face, nose, chin, hair silhouette, and any eyewear or headwear legible in side view while retaining the same person.',
    ...commonSpriteConstraints(options.colors),
  ].join(' ');
}

export function buildPlatformerPhaseACandidatePrompt(
  candidateNumber: number,
  options: { colors?: string } = {},
): string {
  return [
    'Create exactly ONE isolated, full-body platform-game sprite from the exact RIGHT-facing character in the attached neutral side-view reference.',
    ...commonIdentityConstraints(),
    `Generate run-cycle PHASE A candidate A${candidateNumber}. Change only the pose. Keep the character in a strict RIGHT-facing side profile; do not mirror or turn the whole character. The CAMERA-SIDE (near) LEG—the leg visually layered closest to the viewer—must reach forward toward the RIGHT edge, with its shoe clearly ahead of the hips. The FAR-SIDE LEG must stretch backward toward the LEFT edge, with its shoe clearly behind the hips. The FAR-SIDE ARM must swing forward toward the RIGHT edge while the CAMERA-SIDE ARM swings backward toward the LEFT edge.`,
    'This exact limb-depth assignment is mandatory. Make a wide, extended ground-contact stride with green background visible between the legs, a slight forward torso lean, both shoes fully visible, and both feet near the common ground line. Do not merge or overlap the legs, do not choose the leading limbs arbitrarily, and do not generate the opposite Phase B pose.',
    ...commonSpriteConstraints(options.colors),
  ].join(' ');
}

export function buildPlatformerPhaseBCandidatePrompt(
  candidateNumber: number,
  options: { colors?: string } = {},
): string {
  return [
    'Create exactly ONE isolated, full-body platform-game sprite from the exact RIGHT-facing character in the attached neutral side-view reference.',
    ...commonIdentityConstraints(),
    `Generate run-cycle PHASE B candidate B${candidateNumber}. Change only the pose. Keep the character in a strict RIGHT-facing side profile; do not mirror or turn the whole character. The FAR-SIDE LEG—the leg visually layered behind the camera-side leg—must reach forward toward the RIGHT edge, with its shoe clearly ahead of the hips. The CAMERA-SIDE (near) LEG must stretch backward toward the LEFT edge, with its shoe clearly behind the hips. The CAMERA-SIDE ARM must swing forward toward the RIGHT edge while the FAR-SIDE ARM swings backward toward the LEFT edge.`,
    'This exact limb-depth assignment is mandatory and is the inverse of Phase A. Make a wide, extended ground-contact stride with green background visible between the legs, a slight forward torso lean, both shoes fully visible, and both feet near the common ground line. Do not merely bend or wiggle the same leading leg, do not merge or overlap the legs, and do not generate the Phase A pose.',
    ...commonSpriteConstraints(options.colors),
  ].join(' ');
}

export function buildPlatformerJumpCandidatePrompt(
  candidateNumber: number,
  options: PlatformerPosePromptOptions & { retryGuidance?: string } = {},
): string {
  const retryGuidance = clean(options.retryGuidance);
  return [
    buildPlatformerPosePrompt('jump', options),
    `Generate an independent jump-pose variation labeled J${candidateNumber} for evaluation. Do not render this label in the image.`,
    retryGuidance
      ? `TARGETED RETRY GUIDANCE: ${retryGuidance}. Correct that problem while preserving the exact identity, complete canonical costume, proportions, scale, and RIGHT-facing airborne pose.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildPlatformerPoseJudgeSchema(
  candidates: readonly PlatformerPoseCandidateDescriptor[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const phaseAIds = candidates.filter(({ kind }) => kind === 'phase-a').map(({ id }) => id);
  const phaseBIds = candidates.filter(({ kind }) => kind === 'phase-b').map(({ id }) => id);
  const pairCount = phaseAIds.length * phaseBIds.length;
  const score = { type: 'integer', minimum: 0, maximum: 5 };
  return {
    title: 'Platformer pose pairwise semantic judge',
    type: 'object',
    additionalProperties: false,
    required: ['anchorReview', 'candidateReviews', 'pairReviews', 'selection'],
    properties: {
      anchorReview: {
        type: 'object',
        additionalProperties: false,
        required: ['identity', 'sideView', 'costume', 'fatalIssues', 'summary'],
        properties: {
          identity: score,
          sideView: score,
          costume: score,
          fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
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
          required: ['id', 'kind', 'scores', 'fatalIssues', 'summary'],
          properties: {
            id: { type: 'string', enum: ids },
            kind: { type: 'string', enum: ['phase-a', 'phase-b'] },
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
      pairReviews: {
        type: 'array',
        minItems: pairCount,
        maxItems: pairCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'phaseAId',
            'phaseBId',
            'legAlternation',
            'armAlternation',
            'pairConsistency',
            'fatalIssues',
            'summary',
          ],
          properties: {
            phaseAId: { type: 'string', enum: phaseAIds },
            phaseBId: { type: 'string', enum: phaseBIds },
            legAlternation: score,
            armAlternation: score,
            pairConsistency: score,
            fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            summary: { type: 'string' },
          },
        },
      },
      selection: {
        type: 'object',
        additionalProperties: false,
        required: ['accepted', 'phaseAId', 'phaseBId', 'confidence', 'rationale', 'retryGuidance'],
        properties: {
          accepted: { type: 'boolean' },
          phaseAId: { type: 'string', enum: ['', ...phaseAIds] },
          phaseBId: { type: 'string', enum: ['', ...phaseBIds] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          rationale: { type: 'string' },
          retryGuidance: { type: 'string' },
        },
      },
    },
  };
}

export function buildPlatformerPoseJudgePrompt(
  candidates: readonly PlatformerPoseCandidateDescriptor[],
): { system: string; user: string } {
  const list = candidates.map(({ id, kind }) => `${id}=${kind}`).join(', ');
  return {
    system: [
      'You are the exacting art director and animation QA judge for a premium SNES-style platform game.',
      'Inspect the attached labeled review board. Judge only what is visibly present. Do not excuse a failure because the art is attractive.',
      'The SOURCE PHOTO is immutable identity truth from the neck up. Its clothing below the neck is not identity. FRONT IDLE establishes the canonical game-world costume and body presentation; SIDE ANCHOR carries both into profile. The A and B labels describe generation intent only; they are not evidence that a particular anatomical limb actually occupies the requested depth layer.',
      'Identity means the same recognizable person from the neck up: apparent age, head and face shape, skin tone, hairline, hair texture/style, facial hair, eyewear, headwear, and visible head accessories. Costume is judged separately against FRONT IDLE. Becoming bald, childlike, generically younger, differently proportioned, or gaining/losing a head accessory is a fatal identity failure.',
      'First review each candidate only for identity, costume, readable running pose, facing, grounding, and technical integrity. Do not reject an individual candidate by trying to name its camera-side or far-side leading limb in isolation.',
      'Then evaluate every labeled A+B comparison cell on the board. Compare the visible pixels around the hips, crotch, knees, shoes, shoulders, elbows, and hands. Ask whether the foreground/background limb contours exchange roles strongly enough that alternating the two images reads as a stride rather than one character wiggling in place. You do not need to assign anatomical near/far labels to either isolated image.',
      'A valid two-frame pair must depict the same character at the same scale, side angle, pixel density, palette, costume, and ground line. Clear visible leg alternation is the non-negotiable gate. Arm alternation is important but secondary and must not by itself reject an otherwise convincing stride.',
      'Candidate fatal failures include identity drift, invented props, lanterns, tools, weapons, detached objects, extra limbs, merged or cropped legs, wrong facing direction, and severe technical defects. Pair fatal failures include no visible leg swap and severe scale, framing, or ground-line inconsistency.',
      'Score each category from 0 (unusable) to 5 (excellent). Select a pair only if both candidates have no fatal issue, identity, costume, and pose are each at least 4, the selected pair has no fatal issue, legAlternation is at least 4, and pairConsistency is at least 4. Otherwise reject all by returning accepted=false and empty candidate IDs.',
      'Return only the requested JSON object.',
    ].join(' '),
    user: [
      `Candidate labels: ${list}.`,
      'First evaluate the shared SIDE ANCHOR against SOURCE PHOTO and FRONT IDLE. Then review each candidate for standalone quality. Next score every possible A+B pair shown on the board, with one pairReviews entry per labeled comparison cell. Finally choose the strongest visibly alternating pair, or reject the batch. Give concise, concrete retry guidance when anything falls short.',
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

/** Structured output is still normalized because the Meta endpoint currently
 * runs JSON Schema with strict:false. Unknown IDs can never become selected
 * asset paths, and an incomplete decision fails closed. */
export function normalizePlatformerPoseJudgeDecision(
  value: unknown,
  candidates: readonly PlatformerPoseCandidateDescriptor[],
): PlatformerPoseJudgeDecision {
  const root = record(value);
  const anchor = record(root.anchorReview);
  const expected = new Map(candidates.map((candidate) => [candidate.id, candidate.kind]));
  const reviewsById = new Map<string, PlatformerPoseCandidateReview>();
  for (const rawReview of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(rawReview);
    const id = text(review.id, 32);
    const expectedKind = expected.get(id);
    if (!expectedKind || reviewsById.has(id)) continue;
    const scores = record(review.scores);
    reviewsById.set(id, {
      id,
      kind: expectedKind,
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
    ({ id, kind }) =>
      reviewsById.get(id) ?? {
        id,
        kind,
        scores: { identity: 0, costume: 0, pose: 0, technical: 0 },
        fatalIssues: ['Judge omitted this candidate'],
        summary: 'No usable review was returned.',
      },
  );

  const phaseAIds = candidates.filter(({ kind }) => kind === 'phase-a').map(({ id }) => id);
  const phaseBIds = candidates.filter(({ kind }) => kind === 'phase-b').map(({ id }) => id);
  const pairReviewsByKey = new Map<string, PlatformerPosePairReview>();
  for (const rawPair of Array.isArray(root.pairReviews) ? root.pairReviews : []) {
    const pair = record(rawPair);
    const phaseAId = text(pair.phaseAId, 32);
    const phaseBId = text(pair.phaseBId, 32);
    const key = `${phaseAId}\u0000${phaseBId}`;
    if (
      !phaseAIds.includes(phaseAId) ||
      !phaseBIds.includes(phaseBId) ||
      pairReviewsByKey.has(key)
    ) {
      continue;
    }
    pairReviewsByKey.set(key, {
      phaseAId,
      phaseBId,
      legAlternation: score(pair.legAlternation),
      armAlternation: score(pair.armAlternation),
      pairConsistency: score(pair.pairConsistency),
      fatalIssues: strings(pair.fatalIssues),
      summary: text(pair.summary),
    });
  }
  const pairReviews = phaseAIds.flatMap((phaseAId) =>
    phaseBIds.map(
      (phaseBId): PlatformerPosePairReview =>
        pairReviewsByKey.get(`${phaseAId}\u0000${phaseBId}`) ?? {
          phaseAId,
          phaseBId,
          legAlternation: 0,
          armAlternation: 0,
          pairConsistency: 0,
          fatalIssues: ['Judge omitted this pair'],
          summary: 'No usable pair review was returned.',
        },
    ),
  );

  const rawSelection = record(root.selection);
  const requestedPhaseA = text(rawSelection.phaseAId, 32);
  const requestedPhaseB = text(rawSelection.phaseBId, 32);
  const phaseAReview = candidateReviews.find(
    ({ id, kind }) => id === requestedPhaseA && kind === 'phase-a',
  );
  const phaseBReview = candidateReviews.find(
    ({ id, kind }) => id === requestedPhaseB && kind === 'phase-b',
  );
  const selectedPair = pairReviews.find(
    (pair) => pair.phaseAId === requestedPhaseA && pair.phaseBId === requestedPhaseB,
  );
  const legAlternation = selectedPair?.legAlternation ?? 0;
  const armAlternation = selectedPair?.armAlternation ?? 0;
  const pairConsistency = selectedPair?.pairConsistency ?? 0;
  const anchorReview: PlatformerPoseAnchorReview = {
    identity: score(anchor.identity),
    sideView: score(anchor.sideView),
    costume: score(anchor.costume),
    fatalIssues: strings(anchor.fatalIssues),
    summary: text(anchor.summary),
  };
  const eligible = (review: PlatformerPoseCandidateReview | undefined): boolean =>
    !!review &&
    review.fatalIssues.length === 0 &&
    review.scores.identity >= 4 &&
    review.scores.costume >= 4 &&
    review.scores.pose >= 4;
  const accepted =
    rawSelection.accepted === true &&
    anchorReview.fatalIssues.length === 0 &&
    anchorReview.identity >= 4 &&
    anchorReview.sideView >= 4 &&
    anchorReview.costume >= 4 &&
    eligible(phaseAReview) &&
    eligible(phaseBReview) &&
    selectedPair?.fatalIssues.length === 0 &&
    legAlternation >= 4 &&
    pairConsistency >= 4;

  return {
    anchorReview,
    candidateReviews,
    pairReviews,
    selection: {
      accepted,
      phaseAId: accepted ? requestedPhaseA : '',
      phaseBId: accepted ? requestedPhaseB : '',
      legAlternation,
      armAlternation,
      pairConsistency,
      confidence:
        typeof rawSelection.confidence === 'number' && Number.isFinite(rawSelection.confidence)
          ? Math.max(0, Math.min(1, rawSelection.confidence))
          : 0,
      rationale: text(rawSelection.rationale),
      retryGuidance: text(rawSelection.retryGuidance),
    },
  };
}

/** Assemble one stable, labeled comparison image so the multimodal judge can
 * inspect identity anchors and every possible A+B pairing in a single call. */
export async function buildPlatformerPoseJudgeBoard(input: {
  source: Buffer;
  idle: Buffer;
  sideAnchor: Buffer;
  candidates: readonly PlatformerPoseJudgeBoardAsset[];
}): Promise<Buffer> {
  const width = 1720;
  const height = 1420;
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
      '<svg width="1640" height="70" xmlns="http://www.w3.org/2000/svg"><text x="0" y="30" fill="#f5f7ff" font-family="monospace" font-size="26" font-weight="bold">PLATFORMER POSE PAIRWISE REVIEW</text><text x="0" y="58" fill="#aab3d5" font-family="monospace" font-size="16">Identity truth → shared anchors → compare every A + B animation pair</text></svg>',
    ),
    left: 40,
    top: 20,
  });

  panel(40, 90, 300, 380, 'SOURCE PHOTO');
  layers.push({
    input: await sharp(input.source)
      .resize(270, 320, { fit: 'contain', background: '#151a31' })
      .png()
      .toBuffer(),
    left: 55,
    top: 130,
  });
  panel(380, 90, 300, 380, 'FRONT IDLE');
  layers.push({ input: await enlargedSprite(input.idle, 224, 256), left: 418, top: 145 });
  panel(720, 90, 300, 380, 'SIDE ANCHOR');
  layers.push({ input: await enlargedSprite(input.sideAnchor, 224, 256), left: 758, top: 145 });
  layers.push({
    input: Buffer.from(
      '<svg width="610" height="300" xmlns="http://www.w3.org/2000/svg"><text x="0" y="30" fill="#ffd75e" font-family="monospace" font-size="20" font-weight="bold">JUDGE EACH A + B PAIR</text><text x="0" y="72" fill="#c4cae8" font-family="monospace" font-size="17"><tspan x="0" dy="0">• Same person, apparent age, hair and face</tspan><tspan x="0" dy="34">• Same costume, proportions, scale and angle</tspan><tspan x="0" dy="34">• Compare visible hip, knee and shoe contours</tspan><tspan x="0" dy="34">• Legs must exchange roles across the pair</tspan><tspan x="0" dy="34">• Arms should reverse but are secondary</tspan><tspan x="0" dy="34">• Reject props, drift, wobble or bad grounding</tspan></text></svg>',
    ),
    left: 1070,
    top: 130,
  });

  const phaseA = input.candidates
    .filter(({ kind }) => kind === 'phase-a')
    .sort((a, b) => a.id.localeCompare(b.id));
  const phaseB = input.candidates
    .filter(({ kind }) => kind === 'phase-b')
    .sort((a, b) => a.id.localeCompare(b.id));
  const pairs = phaseA.flatMap((candidateA) =>
    phaseB.map((candidateB) => ({ candidateA, candidateB })),
  );
  for (const [index, { candidateA, candidateB }] of pairs.entries()) {
    const x = 35 + (index % 3) * 560;
    const y = 510 + Math.floor(index / 3) * 290;
    panel(x, y, 530, 260, `${candidateA.id} + ${candidateB.id}`);
    layers.push({
      input: await enlargedSprite(candidateA.processed, 180, 206),
      left: x + 70,
      top: y + 43,
    });
    layers.push({
      input: await enlargedSprite(candidateB.processed, 180, 206),
      left: x + 280,
      top: y + 43,
    });
    layers.push({
      input: Buffer.from(
        `<svg width="490" height="226" xmlns="http://www.w3.org/2000/svg"><text x="150" y="220" text-anchor="middle" fill="#aab3d5" font-family="monospace" font-size="15">${escapeXml(candidateA.id)} · frame 1</text><text x="360" y="220" text-anchor="middle" fill="#aab3d5" font-family="monospace" font-size="15">${escapeXml(candidateB.id)} · frame 2</text><text x="255" y="140" text-anchor="middle" fill="#ffd75e" font-family="monospace" font-size="24">⇄</text></svg>`,
      ),
      left: x + 20,
      top: y + 32,
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
