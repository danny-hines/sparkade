import sharp from 'sharp';
import { RACING_MOTION_FRAMES, type RacingMotion, type RacingTraversal } from '@sparkade/shared';
import { processGeneratedFighterPose } from './fighter-pose';
import { GeneratedAssetStorageError, imagePromptHash } from './manifest';
import { splitRacingStripCells, validateRacingCraftStrip } from './racing-craft';
import { racingConveyanceAxisLine } from './racing-traversal-art';

// v3 rejects opaque background panels, including previously approved v2
// candidates. Old ready games are unchanged; generation approvals refresh.
export const RACING_LOCOMOTION_VERSION = 'racing-locomotion-v3';
const MOTION_BRIEFS: Record<Exclude<RacingMotion, 'static'>, string> = {
  pedal:
    'one complete alternating pedal rotation, with knees and feet moving through six evenly spaced crank positions while hands stay on the controls',
  stride:
    'one complete running stride: left contact, left support, left flight, right contact, right support, right flight; opposite arms swing naturally',
  push: 'one complete push and recover: riding foot planted, pushing foot lowers, presses backward against the ground, lifts, returns and plants on the conveyance',
  pulse:
    'one complete subtle organic propulsion cycle, with the same flexible parts extending, contracting and returning; keep the rigid body identity unchanged',
};

export function buildRacingLocomotionPrompt(
  traversal: RacingTraversal,
  concept: string,
  art: string,
): string {
  const motion = traversal.motion;
  if (!motion || motion === 'static') throw new Error('Locomotion requires an authored motion');
  const axis = racingConveyanceAxisLine(traversal.rider);
  return [
    'RACING LOCOMOTION SHEET: exactly SIX temporal frames in a rigid THREE-column TWO-row grid, read left to right then top to bottom.',
    `Animate ${MOTION_BRIEFS[motion]}.`,
    `The attached approved rear view is identity truth. Subject: ${concept}. Art direction: ${art}.`,
    `Keep identical adult proportions, outfit, conveyance, colors and rear-facing camera. Rider contract: ${traversal.rider}; propulsion: ${traversal.propulsion}; surface: ${traversal.surface}.`,
    'All frames face directly AWAY toward the horizon. No turns, banking, camera changes, face-on views, redesign, passengers or extra subjects. No conveyance when rider is onFoot; no rider when rider is none.',
    axis,
    'Same framing, scale and grounded support baseline in every cell. Preserve the torso or rigid chassis while limbs and flexible parts visibly move. Final frame leads naturally into the first. Every complete subject has wide empty gutters; no cropping or overlapping cells.',
    'Crisp pixel art. No text, labels, scenery, shadows, exhaust or effects. All empty space including enclosed gaps must be perfectly flat #00ff00; no neon green on the subject.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Cut real generated frames; never synthesize, mirror or duplicate missing motion. */
export async function processRacingLocomotion(raw: Buffer): Promise<Buffer[]> {
  const meta = await sharp(raw).metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.width < 300 ||
    meta.height < 200 ||
    meta.width / meta.height < 1.2 ||
    meta.width / meta.height > 1.8
  ) {
    throw new Error('Locomotion sheet must have a 3:2 grid of six complete frames');
  }
  const h = Math.floor(meta.height / 2);
  const frames: Buffer[] = [];
  const spans: number[] = [];
  for (let row = 0; row < 2; row++) {
    const strip = await sharp(raw)
      .extract({ left: 0, top: row * h, width: meta.width, height: h })
      .png()
      .toBuffer();
    const { cells } = await splitRacingStripCells(strip);
    for (const cell of cells) {
      const pose = await processGeneratedFighterPose(cell, {
        width: 64,
        height: 64,
        padding: 6,
        bottomPadding: 6,
        removeGreenSpill: true,
        isolatePrimarySubject: true,
        colors: 40,
        minSubjectFraction: 0.015,
        maxSubjectFraction: 0.85,
        minSubjectSpanFraction: 0.1,
      });
      await assertRacingMotionSilhouette(pose.png);
      spans.push(pose.metrics.sourceBounds.height);
      frames.push(pose.png);
    }
  }
  if (frames.length !== RACING_MOTION_FRAMES || Math.max(...spans) / Math.min(...spans) > 1.4)
    throw new Error('Locomotion frames have missing or inconsistent subjects');
  // A static sheet must not pass as animation; raw normalization preserves exact duplicates.
  if (new Set(frames.map((b) => b.toString('base64'))).size !== RACING_MOTION_FRAMES)
    throw new Error('Locomotion needs six distinct temporal frames');
  return frames;
}

/** Transparent outer padding is insufficient when a painted matte remains
 * behind the subject. A nearly full large rectangle dominated by one flat
 * color is a background panel, not a cutout. Small palette variations
 * and a differently colored border must not conceal the matte. */
export async function assertRacingMotionSilhouette(frame: Buffer): Promise<void> {
  const { data, info } = await sharp(frame).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3]! < 128) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < x0 || y1 < y0) throw new Error('Locomotion frame has no subject');
  let opaque = 0;
  const colors = new Map<number, number>();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const offset = (y * info.width + x) * 4;
    if (data[offset + 3]! < 128) continue;
    opaque++;
    const color = ((data[offset]! >> 3) << 10) | ((data[offset + 1]! >> 3) << 5) | (data[offset + 2]! >> 3);
    colors.set(color, (colors.get(color) ?? 0) + 1);
  }
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  const dominant = Math.max(...colors.values());
  if (area >= info.width * info.height * 0.4 && opaque / area > 0.98 && dominant / area > 0.6)
    throw new Error('Locomotion frame contains an opaque rectangular background; retain only the subject silhouette on transparency');
}

export async function composeRacingLocomotion(strip: Buffer, frames: Buffer[]): Promise<Buffer> {
  await validateRacingCraftStrip(strip);
  if (frames.length !== 6) throw new Error('Locomotion needs six frames');
  for (const frame of frames) {
    const meta = await sharp(frame).metadata();
    if (meta.width !== 64 || meta.height !== 64 || !meta.hasAlpha)
      throw new Error('Locomotion frame must be a transparent 64x64 PNG');
  }
  const pixels = Buffer.alloc(192 * 192 * 4);
  const sources = [strip, ...frames];
  for (let i = 0; i < sources.length; i++) {
    const width = i === 0 ? 192 : 64;
    const x = i === 0 ? 0 : ((i - 1) % 3) * 64;
    const y = i === 0 ? 0 : (1 + Math.floor((i - 1) / 3)) * 64;
    const raw = await sharp(sources[i]!).ensureAlpha().raw().toBuffer();
    for (let row = 0; row < 64; row++)
      raw.copy(pixels, ((y + row) * 192 + x) * 4, row * width * 4, (row + 1) * width * 4);
  }
  return sharp(pixels, { raw: { width: 192, height: 192, channels: 4 } })
    .png()
    .toBuffer();
}

export class RacingLocomotionImageError extends Error {}

/** Editing scaffold only: repeat the approved rear in the target layout
 * so a correction can articulate limbs without inventing a new scale or
 * camera. These identical cells cannot pass the actual motion validator. */
export async function buildRacingLocomotionReference(base: Buffer): Promise<Buffer> {
  await validateRacingCraftStrip(base);
  const neutral = await sharp(base).extract({ left: 0, top: 0, width: 64, height: 64 }).png().toBuffer();
  const sheet = await sharp({ create: { width: 192, height: 128, channels: 4, background: '#00ff00' } })
    .composite(Array.from({ length: 6 }, (_, i) => ({ input: neutral, left: i % 3 * 64, top: Math.floor(i / 3) * 64 })))
    .png().toBuffer();
  return sharp(sheet).resize(1536, 1024, { kernel: 'nearest' }).png().toBuffer();
}

/** One initial sheet and at most one quality correction. Provider errors
 * from generation or review propagate immediately; only malformed pixels
 * or a completed semantic rejection qualify for another candidate. */
export async function generateReviewedRacingLocomotion(options: {
  base: Buffer;
  prompt: string;
  motion: RacingMotion;
  generate: (prompt: string, correction: boolean) => Promise<Buffer>;
  review: (atlas: Buffer) => Promise<unknown>;
}): Promise<Buffer> {
  let reason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? options.prompt : [
      options.prompt,
      `MOTION SHEET CORRECTION: ${reason.slice(0, 320)}.`,
      'The attached six-cell editing scaffold repeats the approved neutral rear identity. Keep its exact body size, silhouette, camera, torso, outfit and rigid conveyance pixels. Change only the articulating limbs/flexible parts into six successive motion phases; do not return the unchanged scaffold or redesign the racer.',
      'The art direction supplies ONLY pixel technique and palette. Omit all landscape, architecture, mountains, trees and background scenery mentioned in it. The grid is imaginary: never draw boxes, panels, borders or dividing lines. Each cell contains only the isolated subject on identical flat #00ff00.',
      'Keep all six complete subjects inside their individual cells, with solid green margins on every outer edge and a wide empty horizontal gutter between rows. Preserve the approved rear identity and all six distinct temporal phases.',
      options.motion === 'pedal'
        ? 'Rear-view pedal mechanics: knees bend and feet alternate mainly UP and DOWN close to the conveyance centerline, in the forward/backward plane of travel. Feet stay attached to the rotating pedals; never splay legs or kick feet sideways. The rigid frame, wheel alignment, pannier width, torso and hands stay fixed while the knees and feet cycle. Use six successive crank phases at 60-degree intervals, with left and right pedals opposite each other.'
        : '',
    ].filter(Boolean).join(' ');
    // Deliberately outside the quality catch: refusals and transport errors
    // must never turn into a rephrased image request.
    const raw = await options.generate(prompt, attempt > 0);
    let atlas: Buffer;
    try {
      atlas = await composeRacingLocomotion(options.base, await processRacingLocomotion(raw));
    } catch (error) {
      reason = error instanceof Error ? error.message : 'Malformed six-frame motion sheet';
      continue;
    }
    const verdict = await options.review(atlas);
    if (verdict && typeof verdict === 'object' && 'accepted' in verdict && verdict.accepted === true) return atlas;
    reason = verdict && typeof verdict === 'object' && 'reason' in verdict && typeof verdict.reason === 'string'
      ? verdict.reason : 'The six-frame cycle did not pass the motion review';
  }
  throw new RacingLocomotionImageError(reason);
}

export const racingLocomotionJudgeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accepted', 'reason'],
  properties: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
};

export function racingLocomotionJudgePrompt(motion: RacingMotion): string {
  return `Review this racing motion atlas. Row 1 contains the approved identity reference: legacy rear/left/right cells or neutral placeholder cells repeating the approved rear. Rows 2 and 3 are six temporal ${motion} frames, read left to right. Accept ONLY if all six preserve the exact reference subject, outfit/conveyance, rear orientation, scale, pixel art and support baseline, and form readable coherent ${motion} locomotion with meaningful limb/flexible-part changes and a plausible loop. No missing/extra limbs, identity drift, frozen duplicate poses, green screen residue, cropping or viewpoint changes. Every cell must have transparent negative space around the actual subject silhouette: reject any opaque black/green/colored panel or painted scenery behind it, even with transparent outer padding. Independently verify the reference orientation itself: reject when any conveyance deck or board lies sideways across the road (screen-left to screen-right) instead of nose-tail aligned with travel into the screen (rear closest, nose farthest, foreshortened rear perspective); six frames faithfully copying a wrong reference still fail, since matching the reference never excuses a sideways deck. Return JSON accepted:boolean and reason:string. A visually attractive but mechanically wrong cycle must fail.`;
}

export const RACING_BASE_ROLES = [
  'racingBase0',
  'racingBase1',
  'racingBase2',
  'racingBase3',
  'racingBase4',
] as const;
export const RACING_MOTION_ROLES = [
  'racingMotion0',
  'racingMotion1',
  'racingMotion2',
  'racingMotion3',
  'racingMotion4',
] as const;

/** Terminal per-racer motion outcome persisted across unrelated retries. */
export interface RacingMotionTerminalOutcome {
  version: string;
  key: string;
  outcome: 'refused' | 'rejected' | 'provider-failed';
  reason: string;
}

/** Bind a terminal outcome to its approved base, prompt, and code version. */
export function racingMotionTerminalKey(base: Buffer, prompt: string): string {
  return imagePromptHash(`${RACING_LOCOMOTION_VERSION}\n${prompt}`, base);
}

/** Restore a terminal outcome only when it still describes this base+prompt. */
export function parseRacingMotionTerminalOutcome(
  raw: string | null | undefined,
  key: string,
): RacingMotionTerminalOutcome | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RacingMotionTerminalOutcome>;
    if (!parsed || typeof parsed.version !== 'string' || typeof parsed.key !== 'string')
      throw new Error('Malformed terminal motion record');
    if (parsed.version !== RACING_LOCOMOTION_VERSION || parsed.key !== key) return null;
    if (parsed.outcome !== 'refused' && parsed.outcome !== 'rejected' && parsed.outcome !== 'provider-failed')
      throw new Error('Invalid terminal motion outcome');
    if (typeof parsed.reason !== 'string' || !parsed.reason) throw new Error('Missing motion outcome reason');
    return { version: parsed.version, key: parsed.key, outcome: parsed.outcome, reason: parsed.reason };
  } catch (error) {
    throw new GeneratedAssetStorageError('Invalid saved motion outcome; refusing to repeat an uncertain request', error);
  }
}

export type RacingMotionOptionalResult =
  | { kind: 'animated'; atlas: Buffer }
  | { kind: 'neutral'; outcome: RacingMotionTerminalOutcome['outcome']; reason: string };

/** Pipeline error codes that must keep propagating out of optional motion. */
const FATAL_MOTION_ERROR_CODES = new Set(['suspended', 'canceled', 'storage', 'auth']);

/**
 * Bounded optional per-racer motion. A recorded terminal outcome reuses the
 * approved neutral without any provider call. Otherwise one reviewed attempt
 * (at most one quality correction) runs: approved motion returns the atlas;
 * a quality rejection or an optional provider failure returns the neutral
 * fallback with an honest outcome and reason. Provider refusal ends that
 * request immediately — never rewritten, never provider-switched, never
 * retried, and never continued into its correction. Suspension,
 * cancellation, storage, auth, and programming errors propagate.
 */
export async function generateOptionalRacingMotion(options: {
  base: Buffer;
  prompt: string;
  motion: RacingMotion;
  terminal: RacingMotionTerminalOutcome | null;
  generate: (prompt: string, correction: boolean) => Promise<Buffer>;
  review: (atlas: Buffer) => Promise<unknown>;
  checkActive: () => void;
  isCancelled: () => boolean;
}): Promise<RacingMotionOptionalResult> {
  options.checkActive();
  if (options.isCancelled())
    throw Object.assign(new Error('Racing motion generation canceled'), { code: 'canceled' });
  if (options.terminal) {
    return { kind: 'neutral', outcome: options.terminal.outcome, reason: options.terminal.reason };
  }
  try {
    const atlas = await generateReviewedRacingLocomotion({
      base: options.base,
      prompt: options.prompt,
      motion: options.motion,
      generate: options.generate,
      review: options.review,
    });
    return { kind: 'animated', atlas };
  } catch (error) {
    options.checkActive();
    if (options.isCancelled()) throw error;
    const message = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
    if (error instanceof RacingLocomotionImageError) {
      return {
        kind: 'neutral',
        outcome: 'rejected',
        reason: `Locomotion quality review rejected this racer: ${message}`,
      };
    }
    const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
    if (
      (error instanceof Error && error.name === 'GeneratedAssetStorageError') ||
      (typeof code === 'string' && FATAL_MOTION_ERROR_CODES.has(code))
    ) {
      throw error;
    }
    if (error instanceof Error && typeof code === 'string' && code === 'image-content-policy') {
      return {
        kind: 'neutral',
        outcome: 'refused',
        reason: `The animation provider refused this racer: ${message}`,
      };
    }
    if (
      error instanceof Error &&
      typeof code === 'string' &&
      (code === 'image-provider-error' || code === 'provider-error' || code === 'provider-unavailable' || code === 'call-timeout')
    ) {
      return {
        kind: 'neutral',
        outcome: 'provider-failed',
        reason: `The animation provider failed this racer (${code}): ${message}`,
      };
    }
    throw error;
  }
}
