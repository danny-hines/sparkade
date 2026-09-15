// Single-rear foundation for animated racing cups (generation side).
//
// For authored non-static traversal.motion the ENGINE owns continuous
// steering lean; the image model owns one approved neutral-rear identity
// plus six generated locomotion frames. This module builds that one rear
// image prompt, normalizes it (64px runtime cell + HR reference), assembles
// the compatible 192x64 foundation (the neutral cell repeated in all three
// row-0 storage cells as explicit placeholders — never claimed as generated
// bank poses), and judges it with a bank-free semantic gate. Static or
// absent motion keeps the legacy three-pose strips byte-identical.
import sharp from 'sharp';
import {
  RACING_CRAFT_CELL,
  RACING_CRAFT_STRIP_HEIGHT,
  RACING_CRAFT_STRIP_WIDTH,
  resolveTraversal,
  type RacingTraversal,
} from '@sparkade/shared';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
} from './fighter-pose';
import { processGeneratedRacingCraftReference } from './racing-craft';
import {
  racingConveyanceAxisLine,
  racingPeopleBanLine,
  racingSubjectNoun,
} from './racing-traversal-art';
import type { RacingPropulsion } from '@sparkade/shared';

/**
 * Exhaust/VFX fiction for the single rear: same propulsion rules as the
 * strip line, but with no banking-pose tail — no bank poses exist here.
 */
function racingFoundationExhaustLine(propulsion: RacingPropulsion | undefined, water: boolean): string {
  if (propulsion === 'human') {
    return 'Human-powered fiction: no motor exhaust flames, engine plumes, or mechanical exhaust anywhere — the runtime owns all motion VFX.';
  }
  if (propulsion === 'magic') {
    return 'Magic propulsion: no mechanical exhaust or engine plumes — a small idle shimmer at most. The runtime owns all motion VFX.';
  }
  return water
    ? 'No baked wakes, spray plumes, or exhaust flames — the runtime owns all water and boost VFX.'
    : 'No baked boost exhaust flames or drive plumes — the runtime owns all throttle and boost VFX.';
}

/** Motion-only foundation lineage. Legacy strips keep their versions. */
export const RACING_FOUNDATION_PROMPT_VERSION = 'racing-foundation-v1';

/** Image-call budget for one foundation identity (single rear image). */
export const RACING_FOUNDATION_IMAGE_CALLS = 1;

function clean(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export interface RacingFoundationPromptOptions {
  name: string;
  concept: string;
  artDirection?: string;
  colors?: string;
  traversal?: RacingTraversal;
  retryGuidance?: string;
}

/**
 * One single neutral-rear image prompt. No strips, no banks, no sequences:
 * the engine applies lean at runtime and the run cycle is produced
 * separately from the approved rear. The roster concept supplies identity
 * wording only — never camera, pose count, or motion.
 */
export function buildRacingFoundationPrompt(options: RacingFoundationPromptOptions): string {
  const name = clean(options.name, 24) ?? 'Racer';
  const traversal = resolveTraversal(options.traversal);
  const rider = traversal?.rider ?? 'none';
  const water = traversal?.surface === 'water';
  const subject = racingSubjectNoun(rider);
  const concept =
    clean(options.concept, 280) ?? `distinctive rear-view racing ${subject}`;
  const artDirection = clean(options.artDirection, 280);
  const colors = clean(options.colors, 300);
  const retry = clean(options.retryGuidance, 320);
  return [
    `RACING FOUNDATION: paint exactly ONE isolated rear-view ${subject} on flat #00ff00 for ${name}: a single neutral-rear pose with the camera behind and slightly above, the subject pointing directly AWAY toward the horizon. One subject only.`,
    artDirection ? `IMMUTABLE ROSTER-WIDE ART DIRECTION: ${artDirection}` : '',
    `Rear identity: ${concept}. Same silhouette, materials, outfit, markings, and livery as the roster concept.`,
    'The roster concept above describes identity only: use its silhouette, outfit, markings, and color wording. Any run-cycle, animation-frame, stride-sequence, or motion wording in the concept does NOT add poses, frames, or subjects and never turns the camera.',
    rider === 'onFoot'
      ? 'On-foot rear identity: freeze ONE mid-stride phase with opposite arm-and-leg positions. Rear anatomy only: the back of the head, back, clothes, arms, legs, and heels are visible. No face, eyes, chest, or front of the torso. Facial likeness belongs to the separate portrait art; this image identifies the runner by outfit and rear silhouette only.'
      : '',
    `Rear camera only: ${rider === 'onFoot' ? 'runner back, rear head, and stride silhouette are visible; never a face-on view' : rider === 'none' ? 'tail, stern, and rear markings are visible; no front, cockpit front, or face-on view' : 'rider back, conveyance stern and rear, and tail markings are visible; no front, cockpit front, or face-on view'}. Never render the subject standing detached, floating beside, facing the camera, or pasted into a second view.`,
    racingConveyanceAxisLine(rider),
    water ? 'Water cup: the subject touches the water with a small waterline contact patch.' : '',
    racingFoundationExhaustLine(traversal?.propulsion, water),
    racingPeopleBanLine(rider),
    colors ? `Use this limited game color direction with strong contrast: ${colors}.` : '',
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, strong outline separation, no antialiasing, blur, gradients, or photorealism.',
    'This is ONE rear view, NOT a strip, turnaround sheet, character sheet, animation sequence, collage, story scene, icon, card, screenshot, or concept-art page. No banks, lean variants, or second poses.',
    'The subject must be complete and fully visible with ample clear green margins on every side, several percent of image width, so it cuts out cleanly. Nothing may be cropped.',
    'The entire empty background, including every gap around or enclosed by the silhouette, must be perfectly flat solid #00ff00. The subject must not use #00ff00 or a near-neon imitation; darker natural greens are allowed.',
    retry
      ? `ART DIRECTOR CORRECTION: ${retry}. Apply only this correction while preserving identity, rear orientation, scale, and pixel technique.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface ProcessedRacingFoundation {
  /** Normalized 64px runtime neutral cell, same fingerprint as strip cells. */
  png: Buffer;
  /** HR presentation reference from generated pixels (key/story art source). */
  reference: Buffer;
}

/**
 * Normalize one generated foundation rear with the exact single-cell
 * fingerprint the strip builder uses, plus the HR reference lineage.
 * Throws instead of substituting — malformed or uncropped subjects fail.
 */
export async function processGeneratedRacingFoundation(
  raw: Buffer,
): Promise<ProcessedRacingFoundation> {
  let meta;
  try {
    meta = await sharp(raw).metadata();
  } catch {
    throw new FighterPoseImageError('invalid-image', 'generated racing foundation is not decodable');
  }
  if (!meta.width || !meta.height) {
    throw new FighterPoseImageError('invalid-image', 'generated racing foundation has no dimensions');
  }
  let png: Buffer;
  try {
    png = (
      await processGeneratedFighterPose(raw, {
        width: RACING_CRAFT_CELL,
        height: RACING_CRAFT_CELL,
        padding: 6,
        bottomPadding: 6,
        removeGreenSpill: true,
        isolatePrimarySubject: true,
        colors: 40,
        minSubjectFraction: 0.02,
        maxSubjectFraction: 0.8,
        minSubjectSpanFraction: 0.12,
      })
    ).png;
  } catch (error) {
    if (error instanceof FighterPoseImageError) {
      throw new FighterPoseImageError(error.code, `generated racing foundation rejected: ${error.message}`);
    }
    throw error;
  }
  return { png, reference: await processGeneratedRacingCraftReference(raw) };
}

/**
 * Compatible 192x64 foundation: the approved neutral cell repeated in all
 * three row-0 storage cells. Cells 2/3 are explicit compatibility
 * placeholders for the legacy bank slots — the engine never reads a bank
 * angle from them. Same fixed geometry and encoding as strip assembly.
 */
export async function assembleRacingFoundationStrip(neutral: Buffer): Promise<Buffer> {
  return sharp({
    create: {
      width: RACING_CRAFT_STRIP_WIDTH,
      height: RACING_CRAFT_STRIP_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: neutral, left: 0, top: 0 },
      { input: neutral, left: RACING_CRAFT_CELL, top: 0 },
      { input: neutral, left: RACING_CRAFT_CELL * 2, top: 0 },
    ])
    .png({ palette: true, colours: 128, dither: 0, compressionLevel: 9 })
    .toBuffer();
}

export interface RacingFoundationSlot {
  id: string;
  name: string;
  concept: string;
}

export interface RacingFoundationDecision {
  accepted: boolean;
  rejectedIds: string[];
  retryGuidance: string;
  slotGuidance: Record<string, string>;
}

/**
 * Bank-free semantic gate for foundation rears: true rear camera, correct
 * conveyance axis, outfit/body identity, no malformed anatomy, scale and
 * transparency, distinctness against frozen references. Banking is never
 * assessed — the engine owns lean.
 */
export function buildRacingFoundationJudgePrompt(
  slots: readonly RacingFoundationSlot[],
  references: readonly RacingFoundationSlot[],
  traversal?: RacingTraversal,
): { system: string; user: string } {
  const rider = resolveTraversal(traversal)?.rider ?? 'none';
  const subject =
    rider === 'none'
      ? 'rear-view vehicle portraits'
      : rider === 'onFoot'
        ? 'rear-view runner portraits'
        : 'rear-view rider-plus-conveyance portraits';
  return {
    system:
      'You are Muse Spark, the art director selecting gameplay identity art. Judge only the labeled TARGET images; REFERENCE images are frozen prior approvals shown for distinctness comparison. Return strict JSON.',
    user: [
      `Review the ${slots.length} TARGET ${subject} in order: ${slots.map((s) => `${s.id} (${s.name})`).join(', ')}.`,
      ...slots.map((s) => `${s.id} concept: ${s.concept}.`),
      references.length
        ? `Frozen REFERENCE images (already approved, never judge, never list in slotReviews or rejectedIds): ${references.map((s) => `${s.id} (${s.name})`).join(', ')}. Compare every target against the references for distinctness — a target duplicating a reference subject is fatal.`
        : '',
      'Required: true rear camera (behind and slightly above, subject pointing away), the SAME subject as its concept, readable rear silhouette, no green panels, no text, no cropping. Every image must show exactly one complete rear subject.',
      'Banking is never assessed and never requested: accept or reject on rear-camera truth only. A rear view with no lean is correct; do not demand bank angles.',
      'A fatal issue is a wrong camera direction (face-on, front, or side view), a sideways conveyance deck, a missing or doubled subject, a conveyance on an on-foot runner (or vice versa), malformed anatomy (missing or extra limbs, detached parts), motor exhaust on a human-powered subject, cropped/multiple subjects, duplicated subjects across targets or references, or broken transparency.',
      'accepted should be true only when every target has no fatal issue and is production quality. Even when accepted is false, retryGuidance must describe the single most important correction for the rejected targets, and each rejected target needs its own fix in guidance.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

export function buildRacingFoundationJudgeSchema(
  slots: readonly RacingFoundationSlot[],
): Record<string, unknown> {
  const ids = slots.map(({ id }) => id);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['slotReviews', 'selection'],
    properties: {
      slotReviews: {
        type: 'array',
        minItems: slots.length,
        maxItems: slots.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'fatalIssues', 'summary', 'guidance'],
          properties: {
            id: { type: 'string', enum: ids },
            fatalIssues: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            summary: { type: 'string' },
            guidance: { type: 'string' },
          },
        },
      },
      selection: {
        type: 'object',
        additionalProperties: false,
        required: ['accepted', 'rejectedIds', 'rationale', 'retryGuidance'],
        properties: {
          accepted: { type: 'boolean' },
          rejectedIds: { type: 'array', items: { type: 'string', enum: ids } },
          rationale: { type: 'string' },
          retryGuidance: { type: 'string' },
        },
      },
    },
  };
}

/**
 * Fail-closed normalization of the foundation review. Unknown shapes
 * reject; a target carrying fatalIssues contradicts an acceptance.
 */
export function normalizeRacingFoundationDecision(
  raw: unknown,
  slots: readonly RacingFoundationSlot[],
): RacingFoundationDecision {
  const ids = slots.map(({ id }) => id);
  const idSet = new Set(ids);
  const fail = (retryGuidance: string): RacingFoundationDecision => ({
    accepted: false,
    rejectedIds: [...ids],
    retryGuidance,
    slotGuidance: Object.fromEntries(ids.map((id) => [id, ''])),
  });
  if (typeof raw !== 'object' || raw === null) return fail('Unparseable foundation review.');
  const { slotReviews, selection } = raw as {
    slotReviews?: unknown;
    selection?: unknown;
  };
  if (!Array.isArray(slotReviews) || typeof selection !== 'object' || selection === null) {
    return fail('Foundation review has no selection.');
  }
  const { accepted, rejectedIds, retryGuidance } = selection as {
    accepted?: unknown;
    rejectedIds?: unknown;
    retryGuidance?: unknown;
  };
  if (typeof accepted !== 'boolean' || !Array.isArray(rejectedIds) ||
      rejectedIds.some((id) => typeof id !== 'string' || !idSet.has(id))) {
    return fail('Unparseable foundation selection.');
  }
  const seen = new Set<string>();
  const fatalById = new Map<string, string[]>();
  const guidanceById = new Map<string, string>();
  for (const review of slotReviews) {
    if (typeof review !== 'object' || review === null) return fail('Unparseable foundation review.');
    const { id, fatalIssues, guidance } = review as {
      id?: unknown;
      fatalIssues?: unknown;
      guidance?: unknown;
    };
    if (typeof id !== 'string' || !idSet.has(id) || seen.has(id)) {
      return fail('Unparseable foundation review.');
    }
    if (!Array.isArray(fatalIssues) || fatalIssues.some((issue) => typeof issue !== 'string')) {
      return fail('Unparseable foundation fatal issues.');
    }
    seen.add(id);
    fatalById.set(
      id,
      fatalIssues,
    );
    guidanceById.set(id, typeof guidance === 'string' ? guidance : '');
  }
  if (seen.size !== ids.length) return fail('Foundation review has no selection.');
  const rejected = new Set<string>();
  for (const id of rejectedIds) rejected.add(id);
  for (const [id, fatals] of fatalById) {
    if (fatals.length > 0) rejected.add(id);
  }
  // A partial rejection preserves all explicitly clean targets. An
  // unexplained overall rejection still fails the whole pending set.
  if (!accepted && rejected.size === 0) for (const id of ids) rejected.add(id);
  const rejectedList = [...rejected];
  return {
    accepted: accepted === true && rejectedList.length === 0,
    rejectedIds: accepted === true && rejectedList.length === 0 ? [] : rejectedList.length ? rejectedList : [...ids],
    retryGuidance: typeof retryGuidance === 'string' && retryGuidance ? retryGuidance : '',
    slotGuidance: Object.fromEntries(ids.map((id) => [id, guidanceById.get(id) ?? '']),
    ),
  };
}
