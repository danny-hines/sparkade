// Targeted banking correction for racing craft strips: when a semantic
// review rejects only the banking poses (both banks yaw the same way is the
// classic failure), regenerate the two bank poses as single-object edits of
// the accepted neutral rear and reassemble the strip around the ORIGINAL
// neutral cell. Never a full-strip repaint, never a mirrored pose.
import sharp from 'sharp';
import {
  RACING_CRAFT_CELL,
  RACING_CRAFT_STRIP_HEIGHT,
  RACING_CRAFT_STRIP_WIDTH,
} from '@sparkade/shared';
import {
  FighterPoseImageError,
  processGeneratedFighterPose,
} from './fighter-pose';
import { RACING_CRAFT_SCALE_TOLERANCE } from './racing-craft';

/** Prompt fingerprint for the two single-pose bank edits. */
export const RACING_BANK_PROMPT_VERSION = 'racing-craft-bank-v1';
/**
 * Jetski bank-edit fingerprint. Hover keeps v1 byte-identical so old
 * approved assets reuse correctly.
 */
export const RACING_JETSKI_BANK_PROMPT_VERSION = 'racing-jetski-bank-v2';

export type RacingBankDiscipline = 'hover' | 'jetski';

export function racingBankPromptVersion(discipline: RacingBankDiscipline = 'hover'): string {
  return discipline === 'jetski' ? RACING_JETSKI_BANK_PROMPT_VERSION : RACING_BANK_PROMPT_VERSION;
}

/** Image-call budget for one semantic banking correction (no per-pose retries). */
export const RACING_BANK_CORRECTION_IMAGE_CALLS = 2;

function clean(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export interface RacingBankEditPromptOptions {
  vehicleName: string;
  artDirection?: string;
  colors?: string;
  pose: 'bankLeft' | 'bankRight';
  retryGuidance?: string;
  /** Omitted (or 'hover') preserves the exact legacy vehicle-only prompt. */
  discipline?: RacingBankDiscipline;
  /** A pose guide already carries the desired roll; preserve it, don't rotate twice. */
  posedReference?: boolean;
}

/**
 * One single-pose bank edit prompt. The reference image carries the exact
 * vehicle identity and rear camera; the text pins the one thing the
 * full-strip prompt could not enforce: opposite ROLL with NO yaw.
 * Jetski discipline preserves the seated rider leaning with the hull.
 */
export function buildRacingBankEditPrompt(options: RacingBankEditPromptOptions): string {
  const name = clean(options.vehicleName, 24) ?? 'Racer';
  const artDirection = clean(options.artDirection, 280);
  const colors = clean(options.colors, 300);
  const retry = clean(options.retryGuidance, 320);
  const side = options.pose === 'bankLeft' ? 'LEFT' : 'RIGHT';
  const drop = options.pose === 'bankLeft' ? 'left side dips' : 'right side dips';
  if (options.discipline === 'jetski') {
    return [
      `Paint exactly ONE isolated rear-view jetski pose on flat #00ff00: the SAME watercraft plus its SAME seated adult rider as the reference image (${name}'s craft), banking ${side}. This is the ${side}-bank pose; the opposite bank is a separate image.`,
      artDirection ? `IMMUTABLE ROSTER-WIDE ART DIRECTION: ${artDirection}` : '',
      `Identical watercraft and rider to the reference: same compact hull, handlebars, markings, livery, outfit, and rear head. The rider stays seated astride the hull, leaning together with it; never redesign either and never mirror an asymmetric livery into this pose. The hull touches the water with a small waterline contact patch.`,
      `ROLL ONLY, NO YAW: ${options.posedReference ? 'The reference ALREADY has the exact desired 10-degree roll. Copy its orientation and silhouette; do not rotate it again or straighten it.' : `Tilt rider and craft together roughly 8-12 degrees around the camera axis so its ${drop}.`} The craft still points directly AWAY toward the horizon with the rear camera behind and slightly above: rider back, stern, and jet nozzle stay visible; no bow front, yawed side profile, or face-on view. Never paste a face into the hull and never render the rider standing, detached, or facing the camera.`,
      options.pose === 'bankLeft'
        ? `SCREEN DIRECTION CHECK: ${options.posedReference ? 'the reference is already tilted' : 'rotate the upright reference'} COUNTERCLOCKWISE by 10 degrees as seen on this image. The rider head MUST lie to the LEFT of the rear jet nozzle. The stern edge slopes upward toward the RIGHT. LEFT means screen-left, not the watercraft port/starboard perspective. Do not rotate clockwise.`
        : `SCREEN DIRECTION CHECK: ${options.posedReference ? 'the reference is already tilted' : 'rotate the upright reference'} CLOCKWISE by 10 degrees as seen on this image. The rider head MUST lie to the RIGHT of the rear jet nozzle. The stern edge slopes downward toward the RIGHT. RIGHT means screen-right, not the watercraft port/starboard perspective. Do not rotate counterclockwise.`,
      'No large spray plumes or exhaust flames — a small idle spray hint at most. The runtime owns all water and boost VFX.',
      'One rider only: no second person, passenger, portrait, initials, text, letters, numbers, logo, watermark, signature, UI, border, or scenery.',
      colors ? `Use this limited game color direction with strong contrast: ${colors}.` : '',
      'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, strong outline separation, no antialiasing, blur, gradients, or photorealism.',
      'The craft must be complete and fully visible with ample clear green margins on every side, several percent of image width, so it cuts out cleanly. Nothing may be cropped.',
      'The entire empty background, including every gap around or enclosed by the silhouette, must be perfectly flat solid #00ff00. The craft must not use #00ff00 or a near-neon imitation; darker natural greens are allowed.',
      // Whole-strip judge guidance names BOTH directions, which can override
      // this single-pose edit. The bank contract above is the complete fix.
      `Return ONLY the ${side}-bank pose. Preserve the reference identity and its rear camera.`,
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    `Paint exactly ONE isolated rear-view hovercraft pose on flat #00ff00: the SAME vehicle as the reference image (${name}'s craft), banking ${side}. This is the ${side}-bank pose; the opposite bank is a separate image.`,
    artDirection ? `IMMUTABLE ROSTER-WIDE ART DIRECTION: ${artDirection}` : '',
    `Identical craft to the reference: same silhouette, materials, canopy, markings, and livery. Copy the reference vehicle exactly; never redesign it and never mirror an asymmetric livery into this pose.`,
    `ROLL ONLY, NO YAW: tilt the craft roughly 8-12 degrees around the camera axis so its ${drop} and it leans toward the ${side} of frame, shifting slightly sideways. The craft still points directly AWAY toward the horizon with the rear camera behind and slightly above: thrusters, tail light bar, rear skirt, and canopy rear stay visible; no nose, cockpit front, yawed side profile, or face-on view.`,
    'No large exhaust plumes or thruster flames — a small idle thruster glow at most. The runtime owns all throttle and boost VFX.',
    'Closed or dark readable canopy rear; no person, pilot, rider, passenger, face, head, eyes, portrait, human body, initials, text, letters, numbers, logo, watermark, signature, UI, border, or scenery.',
    colors ? `Use this limited game color direction with strong contrast: ${colors}.` : '',
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, strong outline separation, no antialiasing, blur, gradients, or photorealism.',
    'The craft must be complete and fully visible with ample clear green margins on every side, several percent of image width, so it cuts out cleanly. Nothing may be cropped.',
    'The entire empty background, including every gap around or enclosed by the silhouette, must be perfectly flat solid #00ff00. The craft must not use #00ff00 or a near-neon imitation; darker natural greens are allowed.',
    retry
      ? `ART DIRECTOR CORRECTION: ${retry}. Apply only this correction while preserving vehicle identity, rear orientation, scale, and pixel technique.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Original neutral-rear 64px cell, byte-preserved for reassembly. */
export async function extractRacingNeutralCell(strip: Buffer): Promise<Buffer> {
  const meta = await sharp(strip).metadata();
  if (
    meta.format !== 'png' ||
    meta.width !== RACING_CRAFT_STRIP_WIDTH ||
    meta.height !== RACING_CRAFT_STRIP_HEIGHT
  ) {
    throw new FighterPoseImageError(
      'invalid-image',
      `banking correction needs a ${RACING_CRAFT_STRIP_WIDTH}x${RACING_CRAFT_STRIP_HEIGHT} strip, got ${meta.width}x${meta.height}`,
    );
  }
  return sharp(strip)
    .extract({ left: 0, top: 0, width: RACING_CRAFT_CELL, height: RACING_CRAFT_CELL })
    .png()
    .toBuffer();
}

/**
 * Edit reference from the accepted neutral cell for rivals, where only the
 * normalized strip exists: the rear cell enlarged to edit scale. Never used
 * for the player (the HR presentation reference is always available there).
 */
export async function buildRacingBankEditReference(neutralCell: Buffer): Promise<Buffer> {
  return sharp(neutralCell)
    .resize(512, 512, {
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/** Deterministic pose guide for an image edit, never the final approved art.
 * Rolling the accepted neutral makes left/right unambiguous without mirroring
 * its asymmetric markings. The generated result still passes all art gates.
 */
export async function buildRacingBankPoseGuide(
  neutralCell: Buffer,
  pose: 'bankLeft' | 'bankRight',
): Promise<Buffer> {
  const enlarged = await buildRacingBankEditReference(neutralCell);
  return sharp(enlarged)
    .rotate(pose === 'bankLeft' ? -10 : 10, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(512, 512, { fit: 'contain', kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .flatten({ background: '#00ff00' }).png().toBuffer();
}

export interface NormalizedRacingBankPose {
  /** Normalized 64px bank cell, same fingerprint as the strip cells. */
  png: Buffer;
  /**
   * Subject span as a fraction of the raw canvas (source coordinates, so
   * two banks from the same canvas convention compare meaningfully even
   * though both normalize to 64px).
   */
  spanFrac: number;
}

/**
 * Normalize one generated bank pose with the exact single-cell fingerprint
 * the strip builder uses (64px, 6px padding, green key, crop gate). Throws
 * instead of substituting, mirroring, or copying another pose.
 */
export async function normalizeRacingBankPose(
  raw: Buffer,
  pose: 'bankLeft' | 'bankRight',
): Promise<NormalizedRacingBankPose> {
  let meta;
  try {
    meta = await sharp(raw).metadata();
  } catch {
    throw new FighterPoseImageError('invalid-image', `generated racing bank ${pose} is not decodable`);
  }
  const rawWidth = meta.width ?? 0;
  const rawHeight = meta.height ?? 0;
  if (!rawWidth || !rawHeight) {
    throw new FighterPoseImageError('invalid-image', `generated racing bank ${pose} has no dimensions`);
  }
  let processed;
  try {
    processed = await processGeneratedFighterPose(raw, {
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
    });
  } catch (error) {
    if (error instanceof FighterPoseImageError) {
      throw new FighterPoseImageError(
        error.code,
        `generated racing craft ${pose} rejected: ${error.message}`,
      );
    }
    throw error;
  }
  // Same physical crop gate as the strip cells: a silhouette touching the
  // raw cell boundary is cropped or merged, never a valid bank.
  const b = processed.metrics.sourceBounds;
  if (b.left <= 1 || b.top <= 1 || b.left + b.width >= rawWidth - 1 || b.top + b.height >= rawHeight - 1) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated racing craft ${pose} is cropped by its sheet cell (${b.width}x${b.height} at ${b.left},${b.top})`,
    );
  }
  return {
    png: processed.png,
    spanFrac: Math.max(b.width, b.height) / Math.max(rawWidth, rawHeight),
  };
}

/**
 * Assemble the corrected strip: ORIGINAL neutral cell first, then the two
 * corrected banks. Same fixed geometry and encoding as the strip builder.
 */
export async function assembleRacingBankStrip(
  neutral: Buffer,
  bankLeft: Buffer,
  bankRight: Buffer,
): Promise<Buffer> {
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
      { input: bankLeft, left: RACING_CRAFT_CELL, top: 0 },
      { input: bankRight, left: RACING_CRAFT_CELL * 2, top: 0 },
    ])
    .png({ palette: true, colours: 128, dither: 0, compressionLevel: 9 })
    .toBuffer();
}

/** Relabel swapped bank cells without mirroring or changing the neutral identity.
 * This is a candidate repair only: the caller must run the full semantic
 * review again before approving it. Yaw or same-direction banks still fail.
 */
export async function swapRacingBankCells(strip: Buffer): Promise<Buffer> {
  const cells = await Promise.all([0, 1, 2].map((cell) =>
    sharp(strip).extract({ left: cell * RACING_CRAFT_CELL, top: 0,
      width: RACING_CRAFT_CELL, height: RACING_CRAFT_CELL }).png().toBuffer(),
  ));
  return assembleRacingBankStrip(cells[0]!, cells[2]!, cells[1]!);
}

export interface RacingBankCorrectionOptions {
  /** Original 192x64 gameplay strip: the neutral cell is preserved from here. */
  strip: Buffer;
  vehicleName: string;
  artDirection?: string;
  colors?: string;
  retryGuidance: string;
  /** Omitted (or 'hover') preserves the exact legacy vehicle-only prompts. */
  discipline?: RacingBankDiscipline;
  /** Usage-role prefix, e.g. `racing-craft-player`. */
  rolePrefix: string;
  /**
   * Single image call per pose (accounting/signal/limiter owned by caller).
   * Pass the identity reference here: HR neutral rear for the player, the
   * rear cell enlarged for rivals.
   */
  generate(prompt: string, pose: 'bankLeft' | 'bankRight', posedReference?: Buffer): Promise<Buffer>;
  checkActive(): void;
  validationFailure(role: string): void;
}

/**
 * Run one semantic banking correction: exactly two single-object edits
 * (bankLeft, bankRight), drained together before any throw, then normalized,
 * scale-checked, and reassembled around the byte-preserved neutral cell. No
 * per-pose retries — a bad bank fails the semantic pass loudly.
 */
export async function correctRacingBankPoses(
  options: RacingBankCorrectionOptions,
): Promise<Buffer> {
  const neutral = await extractRacingNeutralCell(options.strip);
  const prompts = {
    bankLeft: buildRacingBankEditPrompt({
      vehicleName: options.vehicleName,
      artDirection: options.artDirection,
      colors: options.colors,
      pose: 'bankLeft',
      retryGuidance: options.retryGuidance,
      discipline: options.discipline,
      posedReference: options.discipline === 'jetski',
    }),
    bankRight: buildRacingBankEditPrompt({
      vehicleName: options.vehicleName,
      artDirection: options.artDirection,
      colors: options.colors,
      pose: 'bankRight',
      retryGuidance: options.retryGuidance,
      discipline: options.discipline,
      posedReference: options.discipline === 'jetski',
    }),
  };
  const runPose = async (pose: 'bankLeft' | 'bankRight'): Promise<NormalizedRacingBankPose> => {
    options.checkActive();
    const guide = options.discipline === 'jetski'
      ? await buildRacingBankPoseGuide(neutral, pose) : undefined;
    const raw = await options.generate(prompts[pose], pose, guide);
    try {
      return await normalizeRacingBankPose(raw, pose);
    } catch (error) {
      options.checkActive();
      options.validationFailure(`${options.rolePrefix}-bank-${pose}`);
      throw error;
    }
  };
  // Drain both edits before reporting: a failed bank must not strand the
  // sibling generation in flight on retry.
  const outcomes = await Promise.allSettled([runPose('bankLeft'), runPose('bankRight')]);
  const [left, right] = outcomes as [
    PromiseSettledResult<NormalizedRacingBankPose>,
    PromiseSettledResult<NormalizedRacingBankPose>,
  ];
  if (left.status === 'rejected') throw left.reason;
  if (right.status === 'rejected') throw right.reason;
  // Scale coherence between the two new banks in raw source coordinates
  // (both come from the same canvas convention, so the fractions compare).
  // The neutral cell is fixed — already accepted — and excluded: its only
  // surviving form is the 64px sprite, a different coordinate space.
  const spans = [left.value.spanFrac, right.value.spanFrac];
  const lo = Math.min(...spans);
  const hi = Math.max(...spans);
  if (lo <= 0 || hi / lo > RACING_CRAFT_SCALE_TOLERANCE) {
    options.validationFailure(`${options.rolePrefix}-bank-scale`);
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `corrected racing bank poses disagree on vehicle scale (${spans.join('/')})`,
    );
  }
  return assembleRacingBankStrip(neutral, left.value.png, right.value.png);
}
