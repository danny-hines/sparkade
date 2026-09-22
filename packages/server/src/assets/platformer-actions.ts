import { characterReferenceInstruction, type CharacterReferenceKind } from './character-reference';
import { settleAll } from '../pipeline/parallel';
import { ArtifactCache } from '../pipeline/artifact-cache';
import sharp from 'sharp';
import {
  PLATFORMER_ACTION_ASSET_ROLES,
  PLATFORMER_ACTION_DESCRIPTIONS,
  platformerActionReference,
  requiredPlatformerActionPoses,
  type PlatformerActionPose,
  type PlatformerBasePose,
  type PlatformerSpec,
} from '@sparkade/shared';
import { imagePromptHash, type GameAssetWorkspace } from './manifest';
import {
  buildPlatformerPosePrompt,
  prepareGeneratedPlatformerReference,
  processGeneratedPlatformerPose,
  recoverGeneratedPlatformerGreenPanel,
  type PlatformerPosePromptOptions,
} from './platformer-pose';
import {
  buildPlatformerJumpJudgeBoard,
  buildPlatformerJumpJudgeSchema,
  normalizePlatformerJumpJudgeDecision,
} from './platformer-jump-judge';

export const PLATFORMER_ACTION_PROMPT_VERSION = 'platformer-actions-v6';
export const PLATFORMER_ACTION_MAX_CANDIDATES = 4;

interface ActionRepair {
  candidates: number;
  guidance: string;
}

interface ReviewCandidate {
  id: PlatformerActionPose;
  processed: Buffer;
  candidate: number;
}

/** Repair-only arm diagram: the approved sprite remains identity/stride truth.
 * Give the model visible aiming geometry after a text-only correction failed. */
export async function buildPlatformerActionReference(
  pose: PlatformerActionPose,
  approved: Buffer,
  repair: boolean,
  referenceMode: 'pose' | 'identity' = 'pose',
): Promise<Buffer> {
  if (platformerActionReference(pose) === 'wallSlide') referenceMode = 'pose';
  if (!repair || !pose.includes('Up')) return prepareGeneratedPlatformerReference(approved);
  const character = await sharp(approved)
    .resize(704, 800, { fit: 'contain', kernel: 'nearest', background: '#00ff00' })
    .png()
    .toBuffer();
  const guide = Buffer.from(`<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <rect width="1024" height="1024" fill="#eeeeee"/>
    <text x="28" y="52" font-size="28" font-family="sans-serif">APPROVED CHARACTER / ${referenceMode === 'pose' ? 'KEEP STRIDE' : 'IDENTITY ONLY'}</text>
    <text x="720" y="120" font-size="22" font-family="sans-serif">ARM AIM ONLY</text>
    <path d="M765 650 L890 650 L890 410" fill="none" stroke="#333333" stroke-width="26" stroke-linejoin="round"/>
    <path d="M850 405 Q890 445 930 405" fill="none" stroke="#333333" stroke-width="16"/>
    <path d="M890 340 L890 230 M860 265 L890 230 L920 265" fill="none" stroke="#555555" stroke-width="10"/>
    <text x="770" y="710" font-size="23" font-family="sans-serif">Bent elbow</text>
    <text x="747" y="750" font-size="23" font-family="sans-serif">Empty palm UP</text>
    <text x="28" y="972" font-size="24" font-family="sans-serif">Output ONE character only. Omit diagram, labels and arrows.</text>
  </svg>`);
  return sharp(guide)
    .composite([{ input: character, left: 0, top: 100 }])
    .png()
    .toBuffer();
}

export function buildPlatformerActionPrompt(
  pose: PlatformerActionPose,
  options: PlatformerPosePromptOptions = {},
  referenceMode: 'pose' | 'identity' = 'pose',
): string {
  const base = buildPlatformerPosePrompt('sideIdle', options).replace('112x128', '160x128');
  const description =
    referenceMode === 'identity'
      ? PLATFORMER_ACTION_DESCRIPTIONS[pose].replace('; preserve the reference running legs', '')
      : PLATFORMER_ACTION_DESCRIPTIONS[pose];
  return (
    base.replace(
      /Pose: .*?\. Show the complete silhouette/,
      `Pose: ${description}. Show the complete silhouette`,
    ) +
    ` Action frame ID: ${pose}. The reference is an approved frame of this character. Preserve its exact head, costume, body scale and proportions while changing ONLY the limbs and orientation needed for this action. Hands remain empty; the runtime draws the bolt or energy arc. Keep all limbs compact enough to fit the same canvas. Do not add effects or scenery.` +
    (referenceMode === 'identity' && platformerActionReference(pose) !== 'wallSlide'
      ? ' The standing reference establishes IDENTITY AND COSTUME ONLY. Replace its neutral limb posture with the requested action: running needs a wide separated stride, and jumping needs bent knees with both feet airborne. Never preserve standing legs for a running or airborne action.'
      : '') +
    (platformerActionReference(pose) === 'wallSlide'
      ? ' The attached reference is the APPROVED WALL-SLIDE frame. Keep the exact bent legs, both feet pressing toward the RIGHT wall, body position and one braced hand from that frame. Change only the head turn and FREE ARM needed to aim. Remain suspended on that imaginary wall, never stand or crouch on a floor.'
      : '')
  );
}

export interface PlatformerActionGenerationOptions {
  spec: PlatformerSpec;
  base: Pick<Record<PlatformerBasePose, Buffer>, 'idle' | 'sideIdle'> &
    Partial<Record<PlatformerBasePose, Buffer>>;
  /** Identity mode starts actions alongside movement generation. All named-pose
   * reviews remain required; wall attacks still use the approved wall slide. */
  referenceMode?: 'pose' | 'identity';
  source: Buffer;
  sourceKind: CharacterReferenceKind;
  wardrobe: PlatformerPosePromptOptions;
  workspace: GameAssetWorkspace;
  cache: ArtifactCache;
  /** User retry starts a new bounded budget; workflow resumes keep this value. */
  attempt: number;
  generate(pose: PlatformerActionPose, prompt: string, reference: Buffer): Promise<Buffer>;
  judge(
    prompt: { system: string; user: string },
    schema: Record<string, unknown>,
    board: Buffer,
    mockDecision: unknown,
  ): Promise<unknown>;
  report(message: string): void;
  rejected?(pose: PlatformerActionPose): void;
}

/** Each reviewed action is durable independently of the base set and other actions.
 * A late failure retries only unfinished poses. Never substitute idle for a required action. */
export async function generatePlatformerActions(
  options: PlatformerActionGenerationOptions,
): Promise<Partial<Record<PlatformerActionPose, Buffer>>> {
  const o = options;
  const required = requiredPlatformerActionPoses(o.spec);
  const accepted: Partial<Record<PlatformerActionPose, Buffer>> = {};
  const hashes = new Map<PlatformerActionPose, string>();
  const repairs = new Map<PlatformerActionPose, ActionRepair>();
  const repairKey = (pose: PlatformerActionPose) =>
    `repair:${hashes.get(pose)}:attempt:${o.attempt}`;
  const reject = (pose: PlatformerActionPose, guidance: string) => {
    const repair = repairs.get(pose)!;
    repair.candidates++;
    repair.guidance = guidance.slice(0, 1200);
    o.cache.write(repairKey(pose), repair);
    o.rejected?.(pose);
  };
  const referenceFor = (pose: PlatformerActionPose) => {
    const ref = platformerActionReference(pose);
    return ref === 'wallSlide'
      ? accepted.wallSlide
      : o.referenceMode === 'identity'
        ? o.base.sideIdle
        : o.base[ref];
  };
  // Wall combat edits the accepted slide so it cannot lose its contact posture.
  const groups = [
    required.filter((p) => platformerActionReference(p) !== 'wallSlide'),
    required.filter((p) => platformerActionReference(p) === 'wallSlide'),
  ];
  let resolveWallSlide!: () => void;
  let rejectWallSlide!: (reason: unknown) => void;
  const wallSlide = new Promise<void>((resolve, reject) => {
    resolveWallSlide = resolve;
    rejectWallSlide = reject;
  });
  void wallSlide.catch(() => {});
  const processGroup = async (group: PlatformerActionPose[]) => {
    if (group.some((pose) => !referenceFor(pose))) return;
    for (const pose of group) {
      const hash = imagePromptHash(
        PLATFORMER_ACTION_PROMPT_VERSION +
          buildPlatformerActionPrompt(pose, o.wardrobe, o.referenceMode),
        Buffer.concat([o.source, o.base.idle, referenceFor(pose)!]),
      );
      hashes.set(pose, hash);
      repairs.set(
        pose,
        o.cache.read<ActionRepair>(repairKey(pose)) ?? { candidates: 0, guidance: '' },
      );
      const cached = o.workspace.load(
        PLATFORMER_ACTION_ASSET_ROLES[pose],
        PLATFORMER_ACTION_PROMPT_VERSION,
        hash,
      );
      if (cached) {
        accepted[pose] = cached;
        if (pose === 'wallSlide') resolveWallSlide();
      }
    }
    const batchesKey = `review-batches:${o.attempt}:${imagePromptHash(JSON.stringify(group.map((pose) => hashes.get(pose))))}`;
    const plannedBatches = o.cache.read<ReviewCandidate[][]>(batchesKey) ?? [];
    for (let round = 0; round < PLATFORMER_ACTION_MAX_CANDIDATES; round++) {
      const pending = group.filter(
        (pose) =>
          !accepted[pose] && repairs.get(pose)!.candidates < PLATFORMER_ACTION_MAX_CANDIDATES,
      );
      if (!pending.length) break;
      o.report(
        `${pending.some((p) => repairs.get(p)!.candidates) ? 'Repairing' : 'Painting'} ${pending.length} mechanic-specific player poses…`,
      );
      // The caller owns provider concurrency and retry limits.
      const generated = await Promise.allSettled(
        pending.map(async (pose) => {
          const repair = repairs.get(pose)!;
          const reference = await o.cache.getOrCompute(
            `reference:${hashes.get(pose)}:${repair.candidates > 0}`,
            () =>
              buildPlatformerActionReference(
                pose,
                referenceFor(pose)!,
                repair.candidates > 0,
                o.referenceMode,
              ),
          );
          const prompt =
            buildPlatformerActionPrompt(pose, o.wardrobe, o.referenceMode) +
            ` Candidate ${repair.candidates + 1} of ${PLATFORMER_ACTION_MAX_CANDIDATES}.` +
            (repair.guidance ? ` Retry correction: ${repair.guidance}` : '') +
            (repair.candidates > 0 && pose.includes('Up')
              ? ` The reference LEFT panel is the approved character: preserve its identity and costume${o.referenceMode === 'identity' && platformerActionReference(pose) !== 'wallSlide' ? ', then use the requested action leg posture' : ' and leg pose'}. The RIGHT panel is an arm geometry guide only: use a bent elbow and visibly upward-facing empty palm. Never copy its colors, diagram, arrow or labels. Output one full character on green.`
              : '');
          const candidate = await o.cache.getOrCompute(
            `candidate:${o.attempt}:${imagePromptHash(prompt, reference)}`,
            async () => {
              const raw = await o.generate(pose, prompt, reference);
              try {
                const recovered = await recoverGeneratedPlatformerGreenPanel(raw);
                const { png } = await processGeneratedPlatformerPose(recovered.image, {
                  width: 160,
                });
                return { processed: png, error: '' };
              } catch (error) {
                return {
                  processed: null,
                  error: `The image failed sprite normalization: ${error instanceof Error ? error.message : String(error)}. Keep one complete compact character on flat green.`,
                };
              }
            },
          );
          if (!candidate.processed) {
            reject(pose, candidate.error);
            return null;
          }
          return { id: pose, processed: candidate.processed, candidate: repair.candidates };
        }),
      );
      const candidates = generated.flatMap((result) =>
        result.status === 'fulfilled' && result.value ? [result.value] : [],
      );
      // Freeze a review's membership before dispatch. Newly completed images
      // must not replace an already-running review with a different board.
      const assigned = new Set(plannedBatches.flat().map((c) => `${c.id}:${c.candidate}`));
      const unassigned = candidates.filter((c) => !assigned.has(`${c.id}:${c.candidate}`));
      for (let index = 0; index < unassigned.length; index += 6)
        plannedBatches.push(unassigned.slice(index, index + 6));
      if (unassigned.length) o.cache.write(batchesKey, plannedBatches);
      const current = (c: ReviewCandidate) =>
        !accepted[c.id] && repairs.get(c.id)!.candidates === c.candidate;
      const batches = plannedBatches.filter((batch) => batch.some(current));
      await settleAll(
        batches.map(async (batch) => {
          const wallReference =
            platformerActionReference(batch[0]!.id) === 'wallSlide'
              ? accepted.wallSlide
              : undefined;
          const boardKey = imagePromptHash(
            JSON.stringify(['action-board-v1', o.sourceKind, batch.map((c) => c.id)]),
            Buffer.concat([
              o.source,
              o.base.idle,
              o.base.sideIdle,
              ...batch.map((c) => c.processed),
              ...(wallReference ? [wallReference] : []),
            ]),
          );
          const board = await o.cache.getOrCompute(boardKey, () =>
            buildPlatformerJumpJudgeBoard({
              source: o.source,
              sourceKind: o.sourceKind,
              idle: o.base.idle,
              sideAnchor: o.base.sideIdle,
              candidates:
                platformerActionReference(batch[0]!.id) === 'wallSlide'
                  ? [
                      { id: 'REFERENCE wallSlide (keep feet)', processed: accepted.wallSlide! },
                      ...batch,
                    ]
                  : batch,
              purpose: 'actions',
            }),
          );
          const schema = buildPlatformerJumpJudgeSchema(batch);
          const prompt = {
            system:
              characterReferenceInstruction(o.sourceKind) +
              ' ' +
              'A panel labeled REFERENCE wallSlide is approved context, not a candidate; compare wall-shot legs and body contact against it and do not return a review for the reference. You review mechanic-specific platformer animation. Inspect the labeled board. SOURCE is identity truth; FRONT IDLE and SIDE ANCHOR define immutable costume and proportions. Judge EVERY candidate independently against its named action below. Reject identity or wardrobe drift, changed head accessories, changed body scale, extra limbs, cropping, held objects, effects, scenery, wrong facing, wrong aim, a standing pose for airborne actions, or missing wall contact posture. Running actions must preserve a clearly separated running stride while aiming; a natural flight phase with both feet airborne is valid. Never accept a standing shot as a running shot. Wall poses have an imaginary wall to the RIGHT; wallShoot aims LEFT away from it, wallShootUp aims UP. No actual wall should be drawn. UP aiming needs a visibly upward-facing empty palm with a bent elbow; slight diagonal forearms or a hand near/slightly above head height are acceptable when aim reads clearly. Do not invent a floor requirement for isolated sprites. Judge gameplay readability and character continuity, not exact joint angles. Score identity/costume/pose/technical from 0 to 5 and list fatal issues. Scores must be identity/costume/pose >=4 and technical >=3 to pass. Return a candidateReviews entry for every ID. The selection field is unused; leave accepted=false, candidateId="", confidence=0 and give concise retry guidance.',
            user:
              batch.map((c) => `${c.id}: ${PLATFORMER_ACTION_DESCRIPTIONS[c.id]}`).join('\n') +
              `\nCostume contract: ${o.wardrobe.heroConcept ?? 'Exactly match the approved base frames.'}`,
          };
          const mockDecision = {
            candidateReviews: batch.map(({ id }) => ({
              id,
              scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
              fatalIssues: [],
              summary: 'Mock fixture; semantic review is bypassed in mock mode.',
            })),
            selection: {
              accepted: false,
              candidateId: '',
              confidence: 0,
              rationale: '',
              retryGuidance: '',
            },
          };
          const decision = normalizePlatformerJumpJudgeDecision(
            await o.cache.getOrCompute(
              `review:${o.attempt}:${imagePromptHash(JSON.stringify([prompt, schema, batch.map((c) => c.candidate)]), board)}`,
              () => o.judge(prompt, schema, board, mockDecision),
            ),
            batch,
          );
          for (const candidate of batch) {
            if (!current(candidate)) continue;
            const review = decision.candidateReviews.find((r) => r.id === candidate.id)!;
            if (
              !review.fatalIssues.length &&
              review.scores.identity >= 4 &&
              review.scores.costume >= 4 &&
              review.scores.pose >= 4 &&
              review.scores.technical >= 3
            ) {
              await o.workspace.store(
                PLATFORMER_ACTION_ASSET_ROLES[candidate.id],
                candidate.processed,
                PLATFORMER_ACTION_PROMPT_VERSION,
                hashes.get(candidate.id)!,
              );
              accepted[candidate.id] = candidate.processed;
              if (candidate.id === 'wallSlide') resolveWallSlide();
            } else {
              reject(
                candidate.id,
                [review.summary, ...review.fatalIssues, decision.selection.retryGuidance]
                  .join(' ')
                  .slice(0, 1200),
              );
            }
          }
        }),
      );
      const failed = generated.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed) throw failed.reason;
    }
  };
  const independent = processGroup(groups[0]!);
  // Start wall attacks as soon as their own reference is accepted. Drain both
  // branches on suspension/failure so sibling progress reaches the checkpoint.
  void independent.then(
    () => resolveWallSlide(),
    (error) => rejectWallSlide(error),
  );
  await settleAll([
    independent,
    groups[1]!.length ? wallSlide.then(() => processGroup(groups[1]!)) : Promise.resolve(),
  ]);
  const missing = required.filter((pose) => !accepted[pose]);
  if (missing.length)
    throw new Error(
      `Required platformer actions failed review: ${missing.join(', ')}. Accepted poses were saved for retry.`,
    );
  if (required.length)
    o.report(
      `Player animation ready: ${required.length} mechanic-specific poses plus the five base poses`,
    );
  return accepted;
}
