import sharp, { type OverlayOptions } from 'sharp';
import type { FighterArtDirection } from '@sparkade/shared';
import { fighterArtDirectionPrompt } from './fighter-art-direction';
import type { GeneratedFighterPose } from './fighter-pose';

export const FIGHTER_IDENTITY_JUDGE_PROMPT_VERSION = 'fighter-identity-judge-v2';
export const FIGHTER_POSE_JUDGE_PROMPT_VERSION = 'fighter-pose-judge-v2';
export const FIGHTER_ROSTER_PIPELINE_PROMPT_VERSION = 'fighter-roster-pipeline-v3';

export const FIGHTER_ROSTER_SLOTS = [
  'player',
  'opponent1',
  'opponent2',
  'opponent3',
  'boss',
] as const;
export type FighterRosterSlot = (typeof FIGHTER_ROSTER_SLOTS)[number];

export interface FighterIdentityCandidateDescriptor {
  id: string;
  slot: FighterRosterSlot;
  name: string;
  visualConcept: string;
  photoIdentity: boolean;
}

export interface FighterIdentityCandidateAsset extends FighterIdentityCandidateDescriptor {
  raw: Buffer;
  processed: Buffer;
}

export interface FighterIdentityCandidateReview {
  id: string;
  slot: FighterRosterSlot;
  scores: {
    identity: number;
    concept: number;
    costume: number;
    silhouette: number;
    technical: number;
  };
  fatalIssues: string[];
  summary: string;
}

export interface FighterIdentityJudgeDecision {
  candidateReviews: FighterIdentityCandidateReview[];
  selections: Array<{
    slot: FighterRosterSlot;
    accepted: boolean;
    candidateId: string;
    confidence: number;
    rationale: string;
    retryGuidance: string;
  }>;
  castReview: {
    distinctiveness: number;
    styleConsistency: number;
    fatalIssues: string[];
    summary: string;
  };
}

export interface FighterPoseCandidateDescriptor {
  id: string;
  pose: GeneratedFighterPose;
}

export interface FighterPoseCandidateAsset extends FighterPoseCandidateDescriptor {
  processed: Buffer;
}

export interface FighterPoseCandidateReview {
  id: string;
  pose: GeneratedFighterPose;
  scores: {
    identity: number;
    costume: number;
    pose: number;
    technical: number;
  };
  fatalIssues: string[];
  summary: string;
}

export interface FighterPoseJudgeDecision {
  candidateReviews: FighterPoseCandidateReview[];
  selections: Array<{
    pose: GeneratedFighterPose;
    candidateId: string;
    rationale: string;
  }>;
  setReview: {
    accepted: boolean;
    identityConsistency: number;
    costumeConsistency: number;
    scaleConsistency: number;
    poseReadability: number;
    fatalIssues: string[];
    summary: string;
  };
  retryPoses: Array<{ pose: GeneratedFighterPose; guidance: string }>;
}

const scoreSchema = { type: 'integer', minimum: 0, maximum: 5 } as const;

export function buildFighterIdentityJudgeSchema(
  candidates: readonly FighterIdentityCandidateDescriptor[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  const slots = FIGHTER_ROSTER_SLOTS.filter((slot) =>
    candidates.some((candidate) => candidate.slot === slot),
  );
  return {
    title: 'Fighter roster identity-foundation judge',
    type: 'object',
    additionalProperties: false,
    required: ['candidateReviews', 'selections', 'castReview'],
    properties: {
      candidateReviews: {
        type: 'array',
        minItems: candidates.length,
        maxItems: candidates.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'slot', 'scores', 'fatalIssues', 'summary'],
          properties: {
            id: { type: 'string', enum: ids },
            slot: { type: 'string', enum: FIGHTER_ROSTER_SLOTS },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: ['identity', 'concept', 'costume', 'silhouette', 'technical'],
              properties: {
                identity: scoreSchema,
                concept: scoreSchema,
                costume: scoreSchema,
                silhouette: scoreSchema,
                technical: scoreSchema,
              },
            },
            fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            summary: { type: 'string' },
          },
        },
      },
      selections: {
        type: 'array',
        minItems: slots.length,
        maxItems: slots.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['slot', 'accepted', 'candidateId', 'confidence', 'rationale', 'retryGuidance'],
          properties: {
            slot: { type: 'string', enum: slots },
            accepted: { type: 'boolean' },
            candidateId: { type: 'string', enum: ['', ...ids] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            rationale: { type: 'string' },
            retryGuidance: { type: 'string' },
          },
        },
      },
      castReview: {
        type: 'object',
        additionalProperties: false,
        required: ['distinctiveness', 'styleConsistency', 'fatalIssues', 'summary'],
        properties: {
          distinctiveness: scoreSchema,
          styleConsistency: scoreSchema,
          fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          summary: { type: 'string' },
        },
      },
    },
  };
}

export function buildFighterIdentityJudgePrompt(
  candidates: readonly FighterIdentityCandidateDescriptor[],
  artDirection?: FighterArtDirection,
): { system: string; user: string } {
  const list = candidates
    .map(
      ({ id, slot, name, photoIdentity }) =>
        `${id}=${slot}/${name}${photoIdentity ? '/PHOTO-IDENTITY' : ''}`,
    )
    .join(', ');
  const slots = FIGHTER_ROSTER_SLOTS.filter((slot) =>
    candidates.some((candidate) => candidate.slot === slot),
  );
  const concepts = slots
    .map((slot) => {
      const item = candidates.find((candidate) => candidate.slot === slot);
      return item ? `${slot} ${item.name}: ${item.visualConcept}` : `${slot}: missing`;
    })
    .join('\n');
  return {
    system: [
      'You are the exacting roster art director for a premium SNES-style fighting game.',
      'Inspect the labeled board and judge only visible evidence. Every candidate must be exactly one complete adult fighter in a neutral right-facing guard stance with coherent anatomy and clean native pixel technique.',
      'For PHOTO-IDENTITY candidates, SOURCE PHOTO is the only physical-identity truth. Preserve apparent adult age, face/head shape, jaw, cheek structure, eye size and spacing, nose, mouth, skin tone, hairline, hair texture/style, facial hair, eyewear/headwear, and proportions. The concept may change clothing only. De-aging, childlike or anime facial anatomy, identity drift, invented or missing eyewear, or generic replacement is fatal.',
      'For other candidates, judge fidelity to the named visual concept and the correct reference role. Opponents must not be copies of the player; the boss must visibly read as the primary villain in BOSS STORY ART rather than the hero or a bystander.',
      'Costume construction, hair/headwear, face or mask, footwear, motif, body build, and palette must be stable enough to seed twelve later pose edits. Reject cropped bodies, extra people, props, weapons, text, scenery, green spill, malformed anatomy, or unreadable silhouettes.',
      'Score 0 (unusable) to 5 (excellent). Select one candidate per roster slot only when it has no fatal issue and identity/concept, costume, silhouette, and technical quality are each at least 4. Otherwise return accepted=false for that slot but still review every candidate and give concrete retry guidance.',
      'Finally judge whether the five selected-looking identities form one coherent art style while remaining unmistakable from one another. Return only the requested JSON.',
    ].join(' '),
    user: `Candidate labels: ${list}.\n${artDirection ? `Immutable roster-wide art direction: ${fighterArtDirectionPrompt(artDirection)}\n` : ''}Character directions:\n${concepts}\nReview every candidate, choose one foundation per slot, and assess the cast as a whole.`,
  };
}

export function buildFighterPoseJudgeSchema(
  candidates: readonly FighterPoseCandidateDescriptor[],
  poses: readonly GeneratedFighterPose[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  return {
    title: 'Fighter complete pose-set judge',
    type: 'object',
    additionalProperties: false,
    required: ['candidateReviews', 'selections', 'setReview', 'retryPoses'],
    properties: {
      candidateReviews: {
        type: 'array',
        minItems: candidates.length,
        maxItems: candidates.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'pose', 'scores', 'fatalIssues', 'summary'],
          properties: {
            id: { type: 'string', enum: ids },
            pose: { type: 'string', enum: poses },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: ['identity', 'costume', 'pose', 'technical'],
              properties: {
                identity: scoreSchema,
                costume: scoreSchema,
                pose: scoreSchema,
                technical: scoreSchema,
              },
            },
            fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            summary: { type: 'string' },
          },
        },
      },
      selections: {
        type: 'array',
        minItems: poses.length,
        maxItems: poses.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pose', 'candidateId', 'rationale'],
          properties: {
            pose: { type: 'string', enum: poses },
            candidateId: { type: 'string', enum: ids },
            rationale: { type: 'string' },
          },
        },
      },
      setReview: {
        type: 'object',
        additionalProperties: false,
        required: [
          'accepted',
          'identityConsistency',
          'costumeConsistency',
          'scaleConsistency',
          'poseReadability',
          'fatalIssues',
          'summary',
        ],
        properties: {
          accepted: { type: 'boolean' },
          identityConsistency: scoreSchema,
          costumeConsistency: scoreSchema,
          scaleConsistency: scoreSchema,
          poseReadability: scoreSchema,
          fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          summary: { type: 'string' },
        },
      },
      retryPoses: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pose', 'guidance'],
          properties: {
            pose: { type: 'string', enum: poses },
            guidance: { type: 'string' },
          },
        },
      },
    },
  };
}

export function buildFighterPoseJudgePrompt(
  fighterName: string,
  candidates: readonly FighterPoseCandidateDescriptor[],
  poses: readonly GeneratedFighterPose[],
  artDirection?: FighterArtDirection,
): { system: string; user: string } {
  const list = candidates.map(({ id, pose }) => `${id}=${pose}`).join(', ');
  return {
    system: [
      'You are the exacting character-consistency and combat-animation judge for a premium SNES-style fighting game.',
      'The IDENTITY ANCHOR is truth. Compare every labeled candidate directly against it and judge only visible evidence.',
      'Identity includes apparent adult age, face/head shape, skin tone, hairline and hairstyle, facial hair, eyewear/headwear, body proportions, and signature motifs. Costume includes every garment, trim, accessory, glove, belt, and shoe. Any unexplained drift is fatal.',
      'Each requested pose must be immediately readable: walk is locomotion rather than attack; crouch and block are distinct; grounded high/low punches and kicks strike at clearly different heights; jump has no attack; air punch and air kick are visibly airborne attacks; hit is standing recoil; KO lies fully on the ground.',
      'Reject wrong facing, cropped or merged limbs, extra limbs, props or weapons, duplicate pose silhouettes, inconsistent scale or ground line, green spill, blur, text, scenery, or severe pixel-technique changes.',
      'Review every candidate, then select the strongest candidate for every requested pose. Judge the selected combination as one set. accepted=true requires no fatal issue and scores of at least 4 for identity consistency, costume consistency, scale consistency, and pose readability.',
      'If the set is not accepted, request retries for at most four poses that most limit the set. Give concrete pose-specific corrections; do not request a retry merely for taste. Return only the requested JSON.',
    ].join(' '),
    user: `Review ${fighterName}. ${artDirection ? `Immutable roster-wide art direction: ${fighterArtDirectionPrompt(artDirection)} ` : ''}Candidate labels: ${list}. Required poses: ${poses.join(', ')}. Select the most identity-consistent complete combination and identify only the highest-value retry poses when needed.`,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function score(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(5, Math.round(number)));
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

function confidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function isRosterSlot(value: string): value is FighterRosterSlot {
  return (FIGHTER_ROSTER_SLOTS as readonly string[]).includes(value);
}

export function normalizeFighterIdentityJudgeDecision(
  value: unknown,
  candidates: readonly FighterIdentityCandidateDescriptor[],
): FighterIdentityJudgeDecision {
  const root = record(value);
  const expected = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const reviews = new Map<string, FighterIdentityCandidateReview>();
  for (const raw of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(raw);
    const id = text(review.id, 32);
    const candidate = expected.get(id);
    if (!candidate || reviews.has(id)) continue;
    const scores = record(review.scores);
    reviews.set(id, {
      id,
      slot: candidate.slot,
      scores: {
        identity: score(scores.identity),
        concept: score(scores.concept),
        costume: score(scores.costume),
        silhouette: score(scores.silhouette),
        technical: score(scores.technical),
      },
      fatalIssues: strings(review.fatalIssues),
      summary: text(review.summary),
    });
  }
  const candidateReviews = candidates.map(
    (candidate): FighterIdentityCandidateReview =>
      reviews.get(candidate.id) ?? {
        id: candidate.id,
        slot: candidate.slot,
        scores: { identity: 0, concept: 0, costume: 0, silhouette: 0, technical: 0 },
        fatalIssues: ['Judge omitted this candidate'],
        summary: 'No usable review was returned.',
      },
  );

  const rawSelections = new Map<FighterRosterSlot, Record<string, unknown>>();
  for (const raw of Array.isArray(root.selections) ? root.selections : []) {
    const item = record(raw);
    const slot = text(item.slot, 24);
    if (isRosterSlot(slot) && !rawSelections.has(slot)) rawSelections.set(slot, item);
  }
  const slots = FIGHTER_ROSTER_SLOTS.filter((slot) =>
    candidates.some((candidate) => candidate.slot === slot),
  );
  const selections = slots.map((slot) => {
    const item = rawSelections.get(slot) ?? {};
    const candidateId = text(item.candidateId, 32);
    const review = candidateReviews.find(
      (candidate) => candidate.slot === slot && candidate.id === candidateId,
    );
    const accepted =
      item.accepted === true &&
      !!review &&
      review.fatalIssues.length === 0 &&
      Object.values(review.scores).every((value) => value >= 4);
    return {
      slot,
      accepted,
      candidateId: accepted ? candidateId : '',
      confidence: confidence(item.confidence),
      rationale: text(item.rationale),
      retryGuidance: text(item.retryGuidance, 500),
    };
  });
  const cast = record(root.castReview);
  return {
    candidateReviews,
    selections,
    castReview: {
      distinctiveness: score(cast.distinctiveness),
      styleConsistency: score(cast.styleConsistency),
      fatalIssues: strings(cast.fatalIssues),
      summary: text(cast.summary),
    },
  };
}

export function bestFighterIdentityCandidateIds(
  decision: FighterIdentityJudgeDecision,
): Record<FighterRosterSlot, string | null> {
  return Object.fromEntries(
    FIGHTER_ROSTER_SLOTS.map((slot) => {
      const accepted = decision.selections.find((selection) => selection.slot === slot);
      if (accepted?.candidateId) return [slot, accepted.candidateId];
      let best: { id: string; score: number } | null = null;
      for (const review of decision.candidateReviews.filter((item) => item.slot === slot)) {
        const total =
          review.scores.identity * 5 +
          review.scores.concept * 4 +
          review.scores.costume * 3 +
          review.scores.silhouette * 2 +
          review.scores.technical * 2 -
          review.fatalIssues.length * 16;
        if (!best || total > best.score) best = { id: review.id, score: total };
      }
      return [slot, best?.id ?? null];
    }),
  ) as Record<FighterRosterSlot, string | null>;
}

export function normalizeFighterPoseJudgeDecision(
  value: unknown,
  candidates: readonly FighterPoseCandidateDescriptor[],
  poses: readonly GeneratedFighterPose[],
): FighterPoseJudgeDecision {
  const root = record(value);
  const expected = new Map(candidates.map((candidate) => [candidate.id, candidate.pose]));
  const reviews = new Map<string, FighterPoseCandidateReview>();
  for (const raw of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(raw);
    const id = text(review.id, 32);
    const pose = expected.get(id);
    if (!pose || reviews.has(id)) continue;
    const scores = record(review.scores);
    reviews.set(id, {
      id,
      pose,
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
    ({ id, pose }): FighterPoseCandidateReview =>
      reviews.get(id) ?? {
        id,
        pose,
        scores: { identity: 0, costume: 0, pose: 0, technical: 0 },
        fatalIssues: ['Judge omitted this candidate'],
        summary: 'No usable review was returned.',
      },
  );

  const rawSelections = new Map<GeneratedFighterPose, Record<string, unknown>>();
  for (const raw of Array.isArray(root.selections) ? root.selections : []) {
    const item = record(raw);
    const pose = text(item.pose, 32) as GeneratedFighterPose;
    if (poses.includes(pose) && !rawSelections.has(pose)) rawSelections.set(pose, item);
  }
  const selections = poses.map((pose) => {
    const item = rawSelections.get(pose) ?? {};
    const candidateId = text(item.candidateId, 32);
    const valid = candidates.some(
      (candidate) => candidate.pose === pose && candidate.id === candidateId,
    );
    return { pose, candidateId: valid ? candidateId : '', rationale: text(item.rationale) };
  });
  const set = record(root.setReview);
  const setReview = {
    accepted: false,
    identityConsistency: score(set.identityConsistency),
    costumeConsistency: score(set.costumeConsistency),
    scaleConsistency: score(set.scaleConsistency),
    poseReadability: score(set.poseReadability),
    fatalIssues: strings(set.fatalIssues),
    summary: text(set.summary),
  };
  setReview.accepted =
    set.accepted === true &&
    selections.every(({ candidateId }) => candidateId !== '') &&
    setReview.fatalIssues.length === 0 &&
    [
      setReview.identityConsistency,
      setReview.costumeConsistency,
      setReview.scaleConsistency,
      setReview.poseReadability,
    ].every((value) => value >= 4);

  const retrySeen = new Set<GeneratedFighterPose>();
  const retryPoses: Array<{ pose: GeneratedFighterPose; guidance: string }> = [];
  for (const raw of Array.isArray(root.retryPoses) ? root.retryPoses : []) {
    const item = record(raw);
    const pose = text(item.pose, 32) as GeneratedFighterPose;
    if (!poses.includes(pose) || retrySeen.has(pose) || retryPoses.length >= 4) continue;
    retrySeen.add(pose);
    retryPoses.push({ pose, guidance: text(item.guidance, 500) });
  }
  return { candidateReviews, selections, setReview, retryPoses };
}

export function bestFighterPoseCandidateIds(
  decision: FighterPoseJudgeDecision,
  poses: readonly GeneratedFighterPose[],
): Record<GeneratedFighterPose, string | null> {
  return Object.fromEntries(
    poses.map((pose) => {
      const selected = decision.selections.find((item) => item.pose === pose)?.candidateId;
      if (selected) return [pose, selected];
      let best: { id: string; score: number } | null = null;
      for (const review of decision.candidateReviews.filter((item) => item.pose === pose)) {
        const total =
          review.scores.identity * 5 +
          review.scores.costume * 3 +
          review.scores.pose * 4 +
          review.scores.technical * 2 -
          review.fatalIssues.length * 16;
        if (!best || total > best.score) best = { id: review.id, score: total };
      }
      return [pose, best?.id ?? null];
    }),
  ) as Record<GeneratedFighterPose, string | null>;
}

export function fighterPosesNeedingRetry(
  decision: FighterPoseJudgeDecision,
  poses: readonly GeneratedFighterPose[],
  max = 4,
): Array<{ pose: GeneratedFighterPose; guidance: string }> {
  const requested = new Map(decision.retryPoses.map((item) => [item.pose, item.guidance]));
  const best = bestFighterPoseCandidateIds(decision, poses);
  const ranked = poses
    .map((pose) => {
      const review = decision.candidateReviews.find((item) => item.id === best[pose]);
      const minimum = review ? Math.min(...Object.values(review.scores)) : 0;
      const fatal = review?.fatalIssues.length ?? 1;
      return { pose, review, weakness: fatal * 10 + (5 - minimum) };
    })
    .filter(
      ({ pose, review }) =>
        requested.has(pose) ||
        !review ||
        review.fatalIssues.length > 0 ||
        Object.values(review.scores).some((value) => value < 4),
    )
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, max);
  return ranked.map(({ pose, review }) => ({
    pose,
    guidance:
      requested.get(pose) ||
      review?.fatalIssues.join('; ') ||
      review?.summary ||
      'Preserve the anchor identity and make the requested pose unmistakable.',
  }));
}

export async function buildFighterIdentityJudgeBoard(input: {
  sourcePhoto?: Buffer;
  keyArt?: Buffer;
  bossArt?: Buffer;
  candidates: readonly FighterIdentityCandidateAsset[];
}): Promise<Buffer> {
  const width = 1800;
  const columns = 5;
  const panelWidth = 340;
  const panelHeight = 300;
  const top = 450;
  const rows = Math.ceil(input.candidates.length / columns);
  const height = top + rows * panelHeight + 30;
  const layers: OverlayOptions[] = [];
  layers.push({
    input: svg(
      width - 60,
      70,
      '<text x="0" y="32" fill="#f5f7ff" font-family="monospace" font-size="28" font-weight="bold">FIGHTER ROSTER · IDENTITY FOUNDATIONS</text><text x="0" y="62" fill="#aab3d5" font-family="monospace" font-size="17">Choose one stable seed per slot; preserve identity and make the cast distinct</text>',
    ),
    left: 30,
    top: 20,
  });
  const refs = [
    ...(input.sourcePhoto ? [{ label: 'SOURCE PHOTO', image: input.sourcePhoto }] : []),
    ...(input.keyArt ? [{ label: 'KEY ART', image: input.keyArt }] : []),
    ...(input.bossArt ? [{ label: 'BOSS STORY ART', image: input.bossArt }] : []),
  ];
  if (refs.length === 0) throw new Error('fighter identity review board needs a reference image');
  const referenceWidth = Math.floor((width - 60 - (refs.length - 1) * 20) / refs.length);
  for (const [index, reference] of refs.entries()) {
    const left = 30 + index * (referenceWidth + 20);
    layers.push({ input: panelSvg(referenceWidth, 330, reference.label), left, top: 95 });
    layers.push({
      input: await sharp(reference.image)
        .resize(referenceWidth - 40, 265, { fit: 'contain', background: '#151a31' })
        .png()
        .toBuffer(),
      left: left + 20,
      top: 145,
    });
  }
  for (const [index, candidate] of input.candidates.entries()) {
    const left = 30 + (index % columns) * (panelWidth + 12);
    const y = top + Math.floor(index / columns) * panelHeight;
    layers.push({
      input: panelSvg(
        panelWidth,
        panelHeight - 12,
        `${candidate.id} · ${candidate.slot} · ${candidate.name}`,
      ),
      left,
      top: y,
    });
    layers.push({
      input: await sharp(candidate.raw)
        .resize(205, 205, { fit: 'contain', background: '#151a31' })
        .png()
        .toBuffer(),
      left: left + 18,
      top: y + 54,
    });
    layers.push({
      input: await enlargedSprite(candidate.processed, 96, 96),
      left: left + 228,
      top: y + 105,
    });
  }
  return sharp({ create: { width, height, channels: 3, background: '#090c18' } })
    .composite(layers)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

export async function buildFighterPoseJudgeBoard(input: {
  fighterName: string;
  anchor: Buffer;
  candidates: readonly FighterPoseCandidateAsset[];
}): Promise<Buffer> {
  const width = 1280;
  const columns = 5;
  const panelWidth = 238;
  const panelHeight = 230;
  const top = 300;
  const rows = Math.ceil(input.candidates.length / columns);
  const height = top + rows * panelHeight + 30;
  const layers: OverlayOptions[] = [];
  layers.push({
    input: svg(
      width - 60,
      75,
      `<text x="0" y="32" fill="#f5f7ff" font-family="monospace" font-size="28" font-weight="bold">${escapeXml(input.fighterName)} · COMPLETE POSE REVIEW</text><text x="0" y="64" fill="#aab3d5" font-family="monospace" font-size="17">Compare every state to the same identity anchor; select one candidate per pose</text>`,
    ),
    left: 30,
    top: 20,
  });
  layers.push({ input: panelSvg(250, 185, 'IDENTITY ANCHOR'), left: 30, top: 95 });
  layers.push({ input: await enlargedSprite(input.anchor, 144, 144), left: 83, top: 126 });
  layers.push({
    input: svg(
      900,
      170,
      '<text x="0" y="28" fill="#ffd75e" font-family="monospace" font-size="21" font-weight="bold">NON-NEGOTIABLE SET CHECKS</text><text x="0" y="68" fill="#c4cae8" font-family="monospace" font-size="17"><tspan x="0" dy="0">• Same face, hair/headwear, body, costume, footwear and pixel technique</tspan><tspan x="0" dy="32">• Grounded versus airborne and high versus low attacks must read instantly</tspan><tspan x="0" dy="32">• Same scale and facing; no props, crops, extra limbs, duplicates or green spill</tspan></text>',
    ),
    left: 325,
    top: 112,
  });
  for (const [index, candidate] of input.candidates.entries()) {
    const left = 30 + (index % columns) * (panelWidth + 12);
    const y = top + Math.floor(index / columns) * panelHeight;
    layers.push({
      input: panelSvg(panelWidth, panelHeight - 12, `${candidate.id} · ${candidate.pose}`),
      left,
      top: y,
    });
    layers.push({
      input: await enlargedSprite(candidate.processed, 160, 160),
      left: left + 39,
      top: y + 48,
    });
  }
  return sharp({ create: { width, height, channels: 3, background: '#090c18' } })
    .composite(layers)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

function panelSvg(width: number, height: number, label: string): Buffer {
  return svg(
    width,
    height,
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="12" fill="#151a31" stroke="#3b4678" stroke-width="2"/><text x="${width / 2}" y="31" text-anchor="middle" fill="#7ee8fa" font-family="monospace" font-size="16" font-weight="bold">${escapeXml(label)}</text>`,
  );
}

function svg(width: number, height: number, body: string): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
  );
}

async function enlargedSprite(sprite: Buffer, width: number, height: number): Promise<Buffer> {
  const checker = svg(
    width,
    height,
    `<defs><pattern id="c" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#202640"/><rect width="8" height="8" fill="#2a3150"/><rect x="8" y="8" width="8" height="8" fill="#2a3150"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/>`,
  );
  const enlarged = await sharp(sprite)
    .resize(width, height, { fit: 'contain', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
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
