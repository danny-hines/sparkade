import sharp from 'sharp';
import type { AdventureCombatKit } from '@sparkade/shared';
import {
  GENERATED_ADVENTURE_PLAYER_POSES,
  type GeneratedAdventurePlayerPose,
} from './adventure-player';

export const ADVENTURE_PLAYER_SET_JUDGE_PROMPT_VERSION = 'adventure-player-set-judge-v4';

export interface AdventurePlayerCandidateDescriptor {
  id: string;
  pose: GeneratedAdventurePlayerPose;
}

export interface AdventurePlayerCandidateAsset extends AdventurePlayerCandidateDescriptor {
  processed: Buffer;
}

export interface AdventurePlayerCandidateReview extends AdventurePlayerCandidateDescriptor {
  scores: {
    identity: number;
    accessories: number;
    costume: number;
    orientation: number;
    motion: number;
    equipment: number;
    technical: number;
  };
  fatalIssues: string[];
  summary: string;
}

export interface AdventurePlayerSetJudgeDecision {
  candidateReviews: AdventurePlayerCandidateReview[];
  selections: Array<{
    pose: GeneratedAdventurePlayerPose;
    candidateId: string;
    rationale: string;
  }>;
  setReview: {
    accepted: boolean;
    identityConsistency: number;
    accessoryConsistency: number;
    costumeConsistency: number;
    directionReadability: number;
    motionReadability: number;
    equipmentConsistency: number;
    scaleConsistency: number;
    fatalIssues: string[];
    summary: string;
  };
  retryPoses: Array<{ pose: GeneratedAdventurePlayerPose; guidance: string }>;
}

const scoreSchema = { type: 'integer', minimum: 0, maximum: 5 } as const;

export function buildAdventurePlayerSetJudgeSchema(
  candidates: readonly AdventurePlayerCandidateDescriptor[],
): Record<string, unknown> {
  const ids = candidates.map(({ id }) => id);
  return {
    title: 'Adventure complete directional player-set judge',
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
            pose: { type: 'string', enum: GENERATED_ADVENTURE_PLAYER_POSES },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: [
                'identity',
                'accessories',
                'costume',
                'orientation',
                'motion',
                'equipment',
                'technical',
              ],
              properties: {
                identity: scoreSchema,
                accessories: scoreSchema,
                costume: scoreSchema,
                orientation: scoreSchema,
                motion: scoreSchema,
                equipment: scoreSchema,
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
        minItems: GENERATED_ADVENTURE_PLAYER_POSES.length,
        maxItems: GENERATED_ADVENTURE_PLAYER_POSES.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pose', 'candidateId', 'rationale'],
          properties: {
            pose: { type: 'string', enum: GENERATED_ADVENTURE_PLAYER_POSES },
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
          'accessoryConsistency',
          'costumeConsistency',
          'directionReadability',
          'motionReadability',
          'equipmentConsistency',
          'scaleConsistency',
          'fatalIssues',
          'summary',
        ],
        properties: {
          accepted: { type: 'boolean' },
          identityConsistency: scoreSchema,
          accessoryConsistency: scoreSchema,
          costumeConsistency: scoreSchema,
          directionReadability: scoreSchema,
          motionReadability: scoreSchema,
          equipmentConsistency: scoreSchema,
          scaleConsistency: scoreSchema,
          fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          summary: { type: 'string' },
        },
      },
      retryPoses: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pose', 'guidance'],
          properties: {
            pose: { type: 'string', enum: GENERATED_ADVENTURE_PLAYER_POSES },
            guidance: { type: 'string' },
          },
        },
      },
    },
  };
}

export function buildAdventurePlayerSetJudgePrompt(
  candidates: readonly AdventurePlayerCandidateDescriptor[],
  heroConcept?: string,
  combatKit?: AdventureCombatKit,
): { system: string; user: string } {
  const list = candidates.map(({ id, pose }) => `${id}=${pose}`).join(', ');
  const wardrobe = heroConcept?.replace(/\s+/g, ' ').trim().slice(0, 500);
  const equipment = combatKit
    ? [
        combatKit.primary.unarmed
          ? `PRIMARY ${combatKit.primary.name}: ${combatKit.primary.visualConcept}; ${combatKit.primary.profile}; explicitly unarmed.`
          : `PRIMARY ${combatKit.primary.name}: ${combatKit.primary.visualConcept}; ${combatKit.primary.profile}; its main grip stays in the anatomical RIGHT hand and it remains visible in movement, melee, and secondary-use poses; it must never become a generic sword or move to the back.`,
        combatKit.primary.unarmed
          ? `SECONDARY ${combatKit.secondary.name}: ${combatKit.secondary.visualConcept}; ${combatKit.secondary.behavior}; it appears in secondary-use poses in the anatomical RIGHT hand, without a launched effect.`
          : `SECONDARY ${combatKit.secondary.name}: ${combatKit.secondary.visualConcept}; ${combatKit.secondary.behavior}; it appears in the anatomical LEFT hand only in secondary-use poses while the primary remains low in the anatomical RIGHT hand, without a launched effect.`,
      ].join(' ')
    : '';
  return {
    system: [
      'You are the exacting identity, direction, and animation judge for a premium SNES-style top-down Adventure game.',
      'The SELECTED DOWN-IDLE ANCHOR is immutable truth. Compare every labeled candidate directly against it and judge only visible evidence.',
      'Identity includes apparent adult age, face and head shape, skin tone, hairline, hair texture and style, facial hair, glasses, headwear, and every visible head accessory. Inventing, removing, or replacing any of these is fatal. Costume includes every garment, material, color, collar, belt, pouch, body-worn accessory, trouser, and shoe.',
      'Direction must be unmistakable. Down poses face the bottom edge in the same top-down three-quarter camera. Up poses are true rear views with correct rear hair, headwear, eyewear arms, collar, and costume back—and absolutely no face on the back of the head. Side poses face right with the same readable profile and are mirrored by the engine for left.',
      'Idle, walk, melee, and secondary must have immediately distinct silhouettes. Walk poses need a clear contact stride while preserving camera, identity, costume, equipment, proportions, scale, and foot ground line. Melee poses must be unmistakable contact frames. Secondary poses must be unmistakable release/use frames and must not include a launched projectile, trail, or explosion.',
      "The combat-kit contract is immutable and the hero is canonically right-handed. Track ANATOMICAL hands across camera rotation: the hero's RIGHT hand appears on the viewer's LEFT in DOWN/front poses, on the viewer's RIGHT in UP/back poses, and is the near/lower arm in generated RIGHT-facing side poses. It is wrong to keep the weapon on one viewer-side by swapping anatomical hands.",
      'For an armed hero, the exact primary must keep its main grip in the anatomical RIGHT hand in every movement and melee pose. It must never migrate into the anatomical left hand, onto the back or shoulder, or onto the belt between poses. The same silhouette, length, active end, handle, palette, grip ordering, and carry location must persist. Armed idle and walk poses carry it LOW AND PASSIVE beside the hip or thigh with the anatomical left hand free and low; a long item may extend upward only along the outer side of the body. If movement equipment is centered above the head, raised overhead, brandished across the chest, extended toward the facing direction, aimed, wound up, or otherwise attack-like, score motion and equipment below 4 and mark it fatal. Only melee poses may visibly raise, swing, thrust, or extend the primary at contact; the anatomical left hand may assist only for clearly two-handed equipment.',
      'For an armed hero, secondary-use poses operate the exact secondary with the anatomical LEFT hand while the primary remains visibly low and passive in the anatomical RIGHT hand; omitting, slinging, sheathing, or moving the primary to the back is fatal. For an unarmed-primary hero, secondary-use poses operate the secondary with the anatomical RIGHT hand. Missing equipment, generic substitutions, inconsistent construction, a hand swap, a changed stow location, or an incorrect two-item arrangement must score equipment below 4 and be marked fatal.',
      'Technical quality includes gameplay visibility. Use the mixed light, dark, saturated, and noisy floor-preview fields on the board to verify that the complete head-to-foot silhouette, major limb separations, and ground contact remain immediately legible. Reject weak or broken contour separation.',
      'Reject crops, extra or merged limbs, wrong facing, props, weapons, duplicate idle/walk silhouettes, inconsistent identity or wardrobe, major scale drift, green spill, blur, text, scenery, or severe pixel-technique changes.',
      'Review every candidate, select one candidate for every required pose, then judge the selected combination as one set. accepted=true requires no fatal issue and every set score at least 4.',
      'If the set is not accepted, request retries for at most three poses that most limit the set. Give concrete pose-specific corrections rather than matters of taste. Return only the requested JSON.',
    ].join(' '),
    user: [
      `Candidate labels: ${list}. Required poses: ${GENERATED_ADVENTURE_PLAYER_POSES.join(', ')}. Select the most identity-consistent complete combination.`,
      wardrobe ? `CANONICAL GAME-WORLD WARDROBE: ${wardrobe}` : '',
      equipment ? `IMMUTABLE COMBAT KIT: ${equipment}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
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

function isPose(value: string): value is GeneratedAdventurePlayerPose {
  return (GENERATED_ADVENTURE_PLAYER_POSES as readonly string[]).includes(value);
}

export function normalizeAdventurePlayerSetJudgeDecision(
  value: unknown,
  candidates: readonly AdventurePlayerCandidateDescriptor[],
): AdventurePlayerSetJudgeDecision {
  const root = record(value);
  const expected = new Map(candidates.map((candidate) => [candidate.id, candidate.pose]));
  const reviews = new Map<string, AdventurePlayerCandidateReview>();
  for (const raw of Array.isArray(root.candidateReviews) ? root.candidateReviews : []) {
    const review = record(raw);
    const id = text(review.id, 48);
    const pose = expected.get(id);
    if (!pose || reviews.has(id)) continue;
    const scores = record(review.scores);
    reviews.set(id, {
      id,
      pose,
      scores: {
        identity: score(scores.identity),
        accessories: score(scores.accessories),
        costume: score(scores.costume),
        orientation: score(scores.orientation),
        motion: score(scores.motion),
        equipment: score(scores.equipment),
        technical: score(scores.technical),
      },
      fatalIssues: strings(review.fatalIssues),
      summary: text(review.summary),
    });
  }
  const candidateReviews = candidates.map(
    ({ id, pose }): AdventurePlayerCandidateReview =>
      reviews.get(id) ?? {
        id,
        pose,
        scores: {
          identity: 0,
          accessories: 0,
          costume: 0,
          orientation: 0,
          motion: 0,
          equipment: 0,
          technical: 0,
        },
        fatalIssues: ['Judge omitted this candidate'],
        summary: 'No usable review was returned.',
      },
  );

  const rawSelections = new Map<GeneratedAdventurePlayerPose, Record<string, unknown>>();
  for (const raw of Array.isArray(root.selections) ? root.selections : []) {
    const item = record(raw);
    const pose = text(item.pose, 32);
    if (isPose(pose) && !rawSelections.has(pose)) rawSelections.set(pose, item);
  }
  const selections = GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => {
    const item = rawSelections.get(pose) ?? {};
    const candidateId = text(item.candidateId, 48);
    const valid = candidates.some(
      (candidate) => candidate.pose === pose && candidate.id === candidateId,
    );
    return { pose, candidateId: valid ? candidateId : '', rationale: text(item.rationale) };
  });
  const set = record(root.setReview);
  const setReview = {
    accepted: false,
    identityConsistency: score(set.identityConsistency),
    accessoryConsistency: score(set.accessoryConsistency),
    costumeConsistency: score(set.costumeConsistency),
    directionReadability: score(set.directionReadability),
    motionReadability: score(set.motionReadability),
    equipmentConsistency: score(set.equipmentConsistency),
    scaleConsistency: score(set.scaleConsistency),
    fatalIssues: strings(set.fatalIssues),
    summary: text(set.summary),
  };
  setReview.accepted =
    set.accepted === true &&
    selections.every(({ candidateId }) => candidateId !== '') &&
    setReview.fatalIssues.length === 0 &&
    [
      setReview.identityConsistency,
      setReview.accessoryConsistency,
      setReview.costumeConsistency,
      setReview.directionReadability,
      setReview.motionReadability,
      setReview.equipmentConsistency,
      setReview.scaleConsistency,
    ].every((value) => value >= 4);

  const retrySeen = new Set<GeneratedAdventurePlayerPose>();
  const retryPoses: Array<{ pose: GeneratedAdventurePlayerPose; guidance: string }> = [];
  for (const raw of Array.isArray(root.retryPoses) ? root.retryPoses : []) {
    const item = record(raw);
    const pose = text(item.pose, 32);
    if (!isPose(pose) || retrySeen.has(pose) || retryPoses.length >= 3) continue;
    retrySeen.add(pose);
    retryPoses.push({ pose, guidance: text(item.guidance, 500) });
  }
  return { candidateReviews, selections, setReview, retryPoses };
}

export function bestAdventurePlayerCandidateIds(
  decision: AdventurePlayerSetJudgeDecision,
): Record<GeneratedAdventurePlayerPose, string | null> {
  return Object.fromEntries(
    GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => {
      const selected = decision.selections.find((item) => item.pose === pose)?.candidateId;
      if (selected) return [pose, selected];
      let best: { id: string; score: number } | null = null;
      for (const review of decision.candidateReviews.filter((item) => item.pose === pose)) {
        const total = adventurePlayerCandidateQuality(review);
        if (!best || total > best.score) best = { id: review.id, score: total };
      }
      return [pose, best?.id ?? null];
    }),
  ) as Record<GeneratedAdventurePlayerPose, string | null>;
}

function adventurePlayerCandidateQuality(review: AdventurePlayerCandidateReview): number {
  return (
    review.scores.identity * 5 +
    review.scores.accessories * 5 +
    review.scores.costume * 4 +
    review.scores.orientation * 4 +
    review.scores.motion * 3 +
    review.scores.equipment * 5 +
    review.scores.technical * 2 -
    review.fatalIssues.length * 20
  );
}

async function footAnchoredOpaqueHeight(image: Buffer): Promise<number | null> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minY = info.height;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3]! <= 8) continue;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return maxY === info.height - 1 ? maxY - minY + 1 : null;
}

/** Preserve Spark's visual ranking while choosing a combination that satisfies
 * the runtime's common-height contract. This prevents one individually strong
 * pose from invalidating an otherwise complete mechanically valid candidate pool. */
export async function bestScaleConsistentAdventurePlayerCandidateIds(
  decision: AdventurePlayerSetJudgeDecision,
  candidates: readonly AdventurePlayerCandidateAsset[],
  maximumHeightDelta = 10,
): Promise<Record<GeneratedAdventurePlayerPose, string> | null> {
  const heights = new Map(
    await Promise.all(
      candidates.map(
        async (candidate) =>
          [candidate.id, await footAnchoredOpaqueHeight(candidate.processed)] as const,
      ),
    ),
  );
  const reviews = new Map(decision.candidateReviews.map((review) => [review.id, review]));
  const preferred = new Map(
    decision.selections.map(({ pose, candidateId }) => [pose, candidateId]),
  );
  const possibleMinimums = [
    ...new Set([...heights.values()].filter((height): height is number => height !== null)),
  ].sort((a, b) => a - b);
  let best: { ids: Record<GeneratedAdventurePlayerPose, string>; score: number } | null = null;

  for (const minimum of possibleMinimums) {
    const entries: Array<readonly [GeneratedAdventurePlayerPose, string]> = [];
    let total = 0;
    for (const pose of GENERATED_ADVENTURE_PLAYER_POSES) {
      let chosen: { id: string; score: number } | null = null;
      for (const candidate of candidates) {
        if (candidate.pose !== pose) continue;
        const height = heights.get(candidate.id);
        if (
          height === null ||
          height === undefined ||
          height < minimum ||
          height > minimum + maximumHeightDelta
        )
          continue;
        const review = reviews.get(candidate.id);
        const score =
          (review ? adventurePlayerCandidateQuality(review) : -1000) +
          (preferred.get(pose) === candidate.id ? 0.25 : 0);
        if (!chosen || score > chosen.score) chosen = { id: candidate.id, score };
      }
      if (!chosen) {
        entries.length = 0;
        break;
      }
      entries.push([pose, chosen.id]);
      total += chosen.score;
    }
    if (entries.length !== GENERATED_ADVENTURE_PLAYER_POSES.length) continue;
    const ids = Object.fromEntries(entries) as Record<GeneratedAdventurePlayerPose, string>;
    if (!best || total > best.score) best = { ids, score: total };
  }

  return best?.ids ?? null;
}

export function adventurePlayerPosesNeedingRetry(
  decision: AdventurePlayerSetJudgeDecision,
  max = 3,
): Array<{ pose: GeneratedAdventurePlayerPose; guidance: string }> {
  const requested = new Map(decision.retryPoses.map((item) => [item.pose, item.guidance]));
  const best = bestAdventurePlayerCandidateIds(decision);
  const ranked = GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => {
    const review = decision.candidateReviews.find((item) => item.id === best[pose]);
    const minimum = review ? Math.min(...Object.values(review.scores)) : 0;
    const fatal = review?.fatalIssues.length ?? 1;
    return { pose, review, weakness: fatal * 10 + (5 - minimum) };
  })
    .filter(
      ({ pose, review }) =>
        pose !== 'downIdle' &&
        (requested.has(pose) ||
          !review ||
          review.fatalIssues.length > 0 ||
          Object.values(review.scores).some((value) => value < 4)),
    )
    .sort((a, b) => b.weakness - a.weakness);
  const targets =
    ranked.length > 0
      ? ranked.slice(0, max)
      : decision.setReview.accepted
        ? []
        : GENERATED_ADVENTURE_PLAYER_POSES.filter((pose) => pose !== 'downIdle')
            .slice(0, max)
            .map((pose) => ({
              pose,
              review: decision.candidateReviews.find((item) => item.id === best[pose]),
              weakness: 0,
            }));
  return targets.map(({ pose, review }) => ({
    pose,
    guidance:
      requested.get(pose) ||
      review?.fatalIssues.join('; ') ||
      decision.setReview.fatalIssues.join('; ') ||
      decision.setReview.summary ||
      review?.summary ||
      'Preserve the exact anchor identity and make the requested direction and locomotion unmistakable.',
  }));
}

export async function buildAdventurePlayerSetJudgeBoard(input: {
  anchor: Buffer;
  candidates: readonly AdventurePlayerCandidateAsset[];
}): Promise<Buffer> {
  const width = 1280;
  const columns = 5;
  const panelWidth = 238;
  const panelHeight = 230;
  const top = 300;
  const rows = Math.ceil(input.candidates.length / columns);
  const height = top + rows * panelHeight + 30;
  const layers: sharp.OverlayOptions[] = [
    {
      input: svg(
        width - 60,
        75,
        '<text x="0" y="32" fill="#f5f7ff" font-family="monospace" font-size="28" font-weight="bold">ADVENTURE HERO · MOVEMENT + COMBAT REVIEW</text><text x="0" y="64" fill="#aab3d5" font-family="monospace" font-size="17">Select one identity- and equipment-consistent candidate for every state</text>',
      ),
      left: 30,
      top: 20,
    },
    { input: panelSvg(250, 185, 'SELECTED DOWN-IDLE ANCHOR'), left: 30, top: 95 },
    { input: await enlargedSprite(input.anchor, 144, 144), left: 83, top: 126 },
    {
      input: svg(
        900,
        170,
        '<text x="0" y="28" fill="#ffd75e" font-family="monospace" font-size="21" font-weight="bold">NON-NEGOTIABLE SET CHECKS</text><text x="0" y="68" fill="#c4cae8" font-family="monospace" font-size="17"><tspan x="0" dy="0">• Same adult face, accessories, wardrobe, proportions and pixel technique</tspan><tspan x="0" dy="32">• Down, true rear-up and right-side views read instantly; no rear face</tspan><tspan x="0" dy="32">• Primary stays in anatomical RIGHT hand, never swaps or moves to the back</tspan><tspan x="0" dy="32">• Movement carry is low; melee raises it; secondary uses LEFT hand</tspan></text>',
      ),
      left: 325,
      top: 112,
    },
  ];
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

function svg(width: number, height: number, body: string): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
  );
}

function panelSvg(width: number, height: number, label: string): Buffer {
  return svg(
    width,
    height,
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="12" fill="#151a31" stroke="#3b4678" stroke-width="2"/><text x="${width / 2}" y="31" text-anchor="middle" fill="#7ee8fa" font-family="monospace" font-size="16" font-weight="bold">${escapeXml(label)}</text>`,
  );
}

async function enlargedSprite(sprite: Buffer, width: number, height: number): Promise<Buffer> {
  const checker = svg(
    width,
    height,
    '<defs><pattern id="noise" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#299a8f"/><rect width="4" height="4" fill="#98d6b7"/><rect x="7" y="6" width="3" height="3" fill="#174f55"/></pattern></defs><rect width="50%" height="50%" fill="#d9c79f"/><rect x="50%" width="50%" height="50%" fill="#20283a"/><rect y="50%" width="50%" height="50%" fill="url(#noise)"/><rect x="50%" y="50%" width="50%" height="50%" fill="#d9dde2"/><path d="M0 80H160M80 0V160" stroke="#111827" stroke-opacity=".24"/>',
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
