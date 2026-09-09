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

export const PLATFORMER_ACTION_PROMPT_VERSION = 'platformer-actions-v3';

export function buildPlatformerActionPrompt(
  pose: PlatformerActionPose,
  options: PlatformerPosePromptOptions = {},
): string {
  const base = buildPlatformerPosePrompt('sideIdle', options).replace('112x128', '160x128');
  return (
    base.replace(
      /Pose: .*?\. Show the complete silhouette/,
      `Pose: ${PLATFORMER_ACTION_DESCRIPTIONS[pose]}. Show the complete silhouette`,
    ) +
    ` Action frame ID: ${pose}. The reference is an approved frame of this character. Preserve its exact head, costume, body scale and proportions while changing ONLY the limbs and orientation needed for this action. Hands remain empty; the runtime draws the bolt or energy arc. Keep all limbs compact enough to fit the same canvas. Do not add effects or scenery.` +
    (platformerActionReference(pose) === 'wallSlide'
      ? ' The attached reference is the APPROVED WALL-SLIDE frame. Keep the exact bent legs, both feet pressing toward the RIGHT wall, body position and one braced hand from that frame. Change only the head turn and FREE ARM needed to aim. Remain suspended on that imaginary wall, never stand or crouch on a floor.'
      : '')
  );
}

export interface PlatformerActionGenerationOptions {
  spec: PlatformerSpec;
  base: Record<PlatformerBasePose, Buffer>;
  source: Buffer;
  sourceKind: 'photo' | 'key-art';
  wardrobe: PlatformerPosePromptOptions;
  workspace: GameAssetWorkspace;
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
  const guidance = new Map<PlatformerActionPose, string>();
  const referenceFor = (pose: PlatformerActionPose) => {
    const ref = platformerActionReference(pose);
    return ref === 'wallSlide' ? accepted.wallSlide : o.base[ref];
  };
  // Wall combat edits the accepted slide so it cannot lose its contact posture.
  const groups = [
    required.filter((p) => platformerActionReference(p) !== 'wallSlide'),
    required.filter((p) => platformerActionReference(p) === 'wallSlide'),
  ];
  for (const group of groups) {
    if (group.some((pose) => !referenceFor(pose))) continue;
    for (const pose of group) {
      const hash = imagePromptHash(
        buildPlatformerActionPrompt(pose, o.wardrobe),
        Buffer.concat([o.source, o.base.idle, referenceFor(pose)!]),
      );
      hashes.set(pose, hash);
      const cached = o.workspace.load(
        PLATFORMER_ACTION_ASSET_ROLES[pose],
        PLATFORMER_ACTION_PROMPT_VERSION,
        hash,
      );
      if (cached) accepted[pose] = cached;
    }
    for (let round = 0; round < 2; round++) {
      const pending = group.filter((pose) => !accepted[pose]);
      if (!pending.length) break;
      o.report(
        `${round ? 'Retrying' : 'Painting'} ${pending.length} mechanic-specific player poses…`,
      );
      // The caller owns provider concurrency and retry limits.
      const generated = await Promise.allSettled(
        pending.map(async (pose) => {
          const reference = await prepareGeneratedPlatformerReference(referenceFor(pose)!);
          const prompt =
            buildPlatformerActionPrompt(pose, o.wardrobe) +
            (guidance.has(pose) ? ` Retry correction: ${guidance.get(pose)}` : '');
          const raw = await o.generate(pose, prompt, reference);
          try {
            const recovered = await recoverGeneratedPlatformerGreenPanel(raw);
            const { png } = await processGeneratedPlatformerPose(recovered.image, { width: 160 });
            return { id: pose, processed: png };
          } catch (error) {
            guidance.set(
              pose,
              `The image failed sprite normalization: ${error instanceof Error ? error.message : String(error)}. Keep one complete compact character on flat green.`,
            );
            o.rejected?.(pose);
            return null;
          }
        }),
      );
      const candidates = generated.flatMap((result) =>
        result.status === 'fulfilled' && result.value ? [result.value] : [],
      );
      for (let offset = 0; offset < candidates.length; offset += 6) {
        const batch = candidates.slice(offset, offset + 6);
        const board = await buildPlatformerJumpJudgeBoard({
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
        });
        const schema = buildPlatformerJumpJudgeSchema(batch);
        const prompt = {
          system:
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
          await o.judge(prompt, schema, board, mockDecision),
          batch,
        );
        for (const candidate of batch) {
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
          } else {
            o.rejected?.(candidate.id);
            guidance.set(
              candidate.id,
              [review.summary, ...review.fatalIssues, decision.selection.retryGuidance]
                .join(' ')
                .slice(0, 1200),
            );
          }
        }
      }
      const failed = generated.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed) throw failed.reason;
    }
  }
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
