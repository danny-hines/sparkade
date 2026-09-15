import sharp from 'sharp';
import { RACING_MOTION_FRAMES, type RacingMotion, type RacingTraversal } from '@sparkade/shared';
import { processGeneratedFighterPose } from './fighter-pose';
import { splitRacingStripCells, validateRacingCraftStrip } from './racing-craft';

export const RACING_LOCOMOTION_VERSION = 'racing-locomotion-v1';
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
  return [
    'RACING LOCOMOTION SHEET: exactly SIX temporal frames in a rigid THREE-column TWO-row grid, read left to right then top to bottom.',
    `Animate ${MOTION_BRIEFS[motion]}.`,
    `The attached approved rear view is identity truth. Subject: ${concept}. Art direction: ${art}.`,
    `Keep identical adult proportions, outfit, conveyance, colors and rear-facing camera. Rider contract: ${traversal.rider}; propulsion: ${traversal.propulsion}; surface: ${traversal.surface}.`,
    'All frames face directly AWAY toward the horizon. No turns, banking, camera changes, face-on views, redesign, passengers or extra subjects. No conveyance when rider is onFoot; no rider when rider is none.',
    'Same framing, scale and grounded support baseline in every cell. Preserve the torso or rigid chassis while limbs and flexible parts visibly move. Final frame leads naturally into the first. Every complete subject has wide empty gutters; no cropping or overlapping cells.',
    'Crisp pixel art. No text, labels, scenery, shadows, exhaust or effects. All empty space including enclosed gaps must be perfectly flat #00ff00; no neon green on the subject.',
  ].join(' ');
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

export const racingLocomotionJudgeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accepted', 'reason'],
  properties: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
};

export function racingLocomotionJudgePrompt(motion: RacingMotion): string {
  return `Review this racing motion atlas. Row 1 contains the approved rear/left/right identity reference. Rows 2 and 3 are six temporal ${motion} frames, read left to right. Accept ONLY if all six preserve the exact reference subject, outfit/conveyance, rear orientation, scale, pixel art and support baseline, and form readable coherent ${motion} locomotion with meaningful limb/flexible-part changes and a plausible loop. No missing/extra limbs, identity drift, frozen duplicate poses, green screen residue, cropping or viewpoint changes. Return JSON accepted:boolean and reason:string. A visually attractive but mechanically wrong cycle must fail.`;
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
