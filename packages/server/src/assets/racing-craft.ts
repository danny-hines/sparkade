import { RACING_REAR_CAMERA } from './racing-camera';
import sharp, { type OverlayOptions } from 'sharp';
import {
  RACING_CRAFT_CELL,
  RACING_CRAFT_POSES,
  RACING_CRAFT_STRIP_HEIGHT,
  RACING_CRAFT_STRIP_WIDTH,
  type RacingCraftPose,
} from '@sparkade/shared';
import {
  FighterPoseImageError,
  isFighterGreenScreenPixel,
  processGeneratedFighterPose,
  type ProcessedFighterPose,
} from './fighter-pose';
import { resolveTraversal, type RacingTraversal } from '@sparkade/shared';
import {
  racingBankLine,
  racingConveyanceAxisLine,
  racingExhaustLine,
  racingPeopleBanLine,
  racingRearCameraLine,
  racingRiderIdentityLine,
  racingSubjectNoun,
} from './racing-traversal-art';

export const RACING_CRAFT_STRIP_PROMPT_VERSION = 'racing-craft-strip-v4';
/** Each lineage requires low rear elevation, including every banking pose. */
export const RACING_JETSKI_STRIP_PROMPT_VERSION = 'racing-jetski-strip-v2';
export const RACING_TRAVERSAL_STRIP_PROMPT_VERSION = 'racing-traversal-strip-v4';

/** Runtime movement discipline selecting hover vs jetski strip semantics. */
export type RacingStripDiscipline = 'hover' | 'jetski';

/** Prompt version owning the given discipline's cache lineage. */
export function racingCraftStripPromptVersion(
  discipline: RacingStripDiscipline = 'hover',
  traversal?: RacingTraversal,
): string {
  if (resolveTraversal(traversal) !== undefined) return RACING_TRAVERSAL_STRIP_PROMPT_VERSION;
  return discipline === 'jetski'
    ? RACING_JETSKI_STRIP_PROMPT_VERSION
    : RACING_CRAFT_STRIP_PROMPT_VERSION;
}
/** Gutter search half-window around each expected third divider (fraction of width). */
export const RACING_STRIP_GUTTER_SEARCH_FRACTION = 0.11;
/** A column counts as gutter when this fraction of its pixels key green. */
export const RACING_STRIP_GUTTER_GREEN_FRACTION = 0.98;
/** Presentation reference derived from the player rear cell (private artifact). */
export const RACING_CRAFT_REFERENCE_SIZE = { width: 1024, height: 512 } as const;
/** Identity board: key-art-scale composition, same contract as H-scroll craft. */
export const RACING_IDENTITY_BOARD_SIZE = { width: 1024, height: 1024 } as const;
/** Max allowed subject-span ratio across the three poses of one strip. */
export const RACING_CRAFT_SCALE_TOLERANCE = 1.4;

export interface RacingCraftStripPromptOptions {
  /** Roster name (pilot or rival driver); never rendered as text. */
  name: string;
  /** Authored rear-view vehicle concept for this roster slot. */
  vehicleConcept: string;
  /** Immutable roster-wide art direction shared by all five strips. */
  artDirection: string;
  /** Optional palette color direction. Green is always forbidden. */
  colors?: string;
  candidateId?: string;
  retryGuidance?: string;
  /**
   * Movement discipline. Omitted (or 'hover') preserves the exact legacy
   * vehicle-only hovercraft prompt; 'jetski' requires a visible seated rider.
   */
  discipline?: RacingStripDiscipline;
  /**
   * Validated composable traversal. When present, the surface/rider/
   * propulsion axes drive a generic rear-view prompt (own cache lineage);
   * the freeform label is never read. Absent traversal keeps legacy output.
   */
  traversal?: RacingTraversal;
}

function clean(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

/**
 * One 3-pose rear-view strip for a single roster vehicle. The premise governs
 * the vehicle; the camera stays directly behind at a low chase-camera height, every pose points
 * away toward the horizon, and no pilot is ever shown on the chassis.
 * Jetski discipline instead requires one visible seated adult rider astride
 * each watercraft (same rider and hull across all three cells).
 */
export function buildRacingCraftStripPrompt(options: RacingCraftStripPromptOptions): string {
  const name = clean(options.name, 24) ?? 'Racer';
  const traversal = resolveTraversal(options.traversal);
  if (traversal) return buildTraversalRacingCraftStripPrompt(options, traversal, name);
  const jetski = options.discipline === 'jetski';
  const concept =
    clean(options.vehicleConcept, 280) ??
    (jetski
      ? 'distinctive compact jet-ski watercraft with a seated rider'
      : 'distinctive rear-view hovercraft');
  const artDirection = clean(options.artDirection, 280);
  const colors = clean(options.colors, 300);
  const retry = clean(options.retryGuidance, 320);
  if (jetski) {
    return [
      `Create exactly ONE isolated rear-view jetski turnaround strip for ${name}: THREE poses of the SAME watercraft plus its SAME seated rider side by side in one row, left to right: neutral-rear cruise, banking LEFT, banking RIGHT. Do not render pose labels.`,
      artDirection ? `IMMUTABLE ROSTER-WIDE ART DIRECTION: ${artDirection}` : '',
      `Watercraft and rider identity: ${concept}. Keep one identical compact-hull watercraft with handlebars across all three cells: same silhouette, materials, markings, and livery. The hull touches the water with a small waterline contact patch. The SAME adult rider sits astride it in every cell: same outfit, same rear head, leaning physically together with the hull. Banking poses tilt rider and craft together gently, roughly 8-12 degrees, and shift them sideways; never redesign either and never mirror an asymmetric livery into a missing pose.`,
      RACING_REAR_CAMERA,
      'Rear camera orientation: the camera sits at a low chase-camera height directly behind every craft and all three point directly AWAY toward the horizon. Rear-view composition only: rider back, watercraft stern, jet nozzle, and tail markings are visible; no bow front, cockpit front, or face-on view. The rider may show the rear of the head; never paste a face into the hull and never render the rider standing, detached, floating beside, or facing the camera.',
      'No baked wakes, spray plumes, or exhaust flames on the neutral-rear cruise pose — the runtime owns all water and boost VFX. Banking poses may show a small idle spray hint at most.',
      'No second person, passenger, portrait, initials, text, letters, numbers, logo, watermark, signature, UI, border, or scenery.',
      colors ? `Use this limited game color direction with strong contrast: ${colors}.` : '',
      'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, strong outline separation, no antialiasing, blur, gradients, or photorealism.',
      'This is one rigid rider-plus-watercraft in three rear states, NOT three different craft, a character sheet, sequence, collage, story scene, icon, card, screenshot, or concept-art page.',
      'Each craft must be complete and fully visible with ample clear green gutters and margins: fully empty green bands between the poses and around the outer edges, several percent of image width, so each craft cuts out without touching a neighbor. Nothing may be cropped and poses must not touch or overlap each other.',
      'The entire empty background, including every gap around or enclosed by each silhouette, must be perfectly flat solid #00ff00. No craft may use #00ff00 or a near-neon imitation; darker natural greens are allowed.',
      options.candidateId
        ? `Generate independent strip candidate ${clean(options.candidateId, 12) ?? 'A'} for evaluation. Do not render this label.`
        : '',
      retry
        ? `ART DIRECTOR CORRECTION: ${retry}. Apply only this correction while preserving rider and watercraft identity, rear orientation, scale, and pixel technique.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    `Create exactly ONE isolated rear-view hovercraft turnaround strip for ${name}: THREE poses of the SAME vehicle side by side in one row, left to right: neutral-rear cruise, banking LEFT, banking RIGHT. Do not render pose labels.`,
    artDirection ? `IMMUTABLE ROSTER-WIDE ART DIRECTION: ${artDirection}` : '',
    `Vehicle identity: ${concept}. Keep one identical vehicle across all three cells: same silhouette, materials, canopy, markings, and livery. Banking poses tilt the SAME craft gently, roughly 8-12 degrees, and shift it sideways; never redesign it and never mirror an asymmetric livery into a missing pose.`,
    RACING_REAR_CAMERA,
    'Rear camera orientation: the camera sits at a low chase-camera height directly behind every craft and all three point directly AWAY toward the horizon. Rear-view composition only: thrusters, tail light bar, rear skirt, and canopy rear are visible; no nose, cockpit front, or face-on view.',
    'No baked boost exhaust flames or thruster plumes on the neutral-rear cruise pose — the runtime owns all throttle and boost VFX. Banking poses may show a small idle thruster glow but no large exhaust plumes.',
    'This vehicle identity is independent from the human pilot. Closed or dark readable canopy rear; no person, pilot, rider, passenger, face, head, eyes, portrait, human body, initials, text, letters, numbers, logo, watermark, signature, UI, border, or scenery.',
    colors ? `Use this limited game color direction with strong contrast: ${colors}.` : '',
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, strong outline separation, no antialiasing, blur, gradients, or photorealism.',
    'This is one rigid vehicle in three rear states, NOT three different craft, a character sheet, sequence, collage, story scene, icon, card, screenshot, or concept-art page.',
    'Each craft must be complete and fully visible with ample clear green gutters and margins: fully empty green bands between the poses and around the outer edges, several percent of image width, so each craft cuts out without touching a neighbor. Nothing may be cropped and poses must not touch or overlap each other.',
    'The entire empty background, including every gap around or enclosed by each silhouette, must be perfectly flat solid #00ff00. No craft may use #00ff00 or a near-neon imitation; darker natural greens are allowed.',
    options.candidateId
      ? `Generate independent strip candidate ${clean(options.candidateId, 12) ?? 'A'} for evaluation. Do not render this label.`
      : '',
    retry
      ? `ART DIRECTOR CORRECTION: ${retry}. Apply only this correction while preserving vehicle identity, rear orientation, scale, and pixel technique.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Generic 3-pose rear-view strip for a validated traversal. Driven ONLY by
 * the surface/rider/propulsion axes: rear, bank-left, and bank-right poses
 * with inward roll, rider-plus-conveyance consistency, and propulsion
 * fiction (never motor exhaust on human power). The label is never read.
 * This is a rear-camera steering strip, never a front/side/back turnaround
 * sheet: the roster concept supplies identity wording only, while the
 * orientation contract below owns the camera, the pose count, and the
 * per-cell roll directions.
 */
function buildTraversalRacingCraftStripPrompt(
  options: RacingCraftStripPromptOptions,
  traversal: RacingTraversal,
  name: string,
): string {
  const rider = traversal.rider;
  const water = traversal.surface === 'water';
  const subject = racingSubjectNoun(rider);
  const concept =
    clean(options.vehicleConcept, 280) ??
    (rider === 'none'
      ? 'distinctive rear-view racing vehicle'
      : rider === 'onFoot'
        ? 'distinctive rear-view racing runner mid-stride'
        : 'distinctive rear-view racing conveyance with its rider');
  const artDirection = clean(options.artDirection, 280);
  const colors = clean(options.colors, 300);
  const retry = clean(options.retryGuidance, 320);
  return [
    `Create exactly ONE isolated rear-view steering strip for ${name}: THREE rear-camera views of the SAME ${subject} side by side in one row, left to right: neutral-rear cruise (upright), banking LEFT (screen-left edge low, screen-right edge high), banking RIGHT (screen-right edge low, screen-left edge high). Every cell shows the SAME rear view direction. Do not render pose labels.`,
    artDirection ? `IMMUTABLE ROSTER-WIDE ART DIRECTION: ${artDirection}` : '',
    `${racingRiderIdentityLine(rider, concept)} ${racingBankLine(rider)}`,
    'The roster concept above describes identity only: use its silhouette, outfit, markings, and color wording. Any run-cycle, animation-frame, stride-sequence, or motion wording in the concept does NOT add poses, advance motion across cells, or turn the camera.',
    rider === 'onFoot'
      ? 'On-foot steering pose: freeze ONE identical mid-stride phase — the same opposite arm-and-leg positions — in all three cells, then apply only the per-cell roll above. Do NOT advance the stride across cells and do NOT render a multi-frame run sequence; the full run cycle is produced separately from the approved strip.'
      : '',
    RACING_REAR_CAMERA,
    racingRearCameraLine(rider),
    rider === 'onFoot'
      ? 'Rear anatomy only: the back of the head, back, clothes, arms, legs, and heels are visible. No face, eyes, chest, or front of the torso in any cell. Preserve rear-visible identity, including headwear and hair, without turning the head to show facial likeness.'
      : '',
    racingConveyanceAxisLine(rider),
    water ? 'Water cup: the subject touches the water with a small waterline contact patch.' : '',
    racingExhaustLine(traversal.propulsion, water),
    racingPeopleBanLine(rider),
    colors ? `Use this limited game color direction with strong contrast: ${colors}.` : '',
    'Polished high-density 16-bit SNES-era pixel art: crisp square pixel clusters, hard edges, limited flat color ramps, strong outline separation, no antialiasing, blur, gradients, or photorealism.',
    `This is one rigid ${subject} in three rear states, NOT three different subjects, a front/side/back turnaround sheet, a character sheet, an animation sequence, collage, story scene, icon, card, screenshot, or concept-art page.`,
    'Each pose must be complete and fully visible with ample clear green gutters and margins: fully empty green bands between the poses and around the outer edges, several percent of image width, so each pose cuts out without touching a neighbor. Nothing may be cropped and poses must not touch or overlap each other.',
    'The entire empty background, including every gap around or enclosed by each silhouette, must be perfectly flat solid #00ff00. No subject may use #00ff00 or a near-neon imitation; darker natural greens are allowed.',
    options.candidateId
      ? `Generate independent strip candidate ${clean(options.candidateId, 12) ?? 'A'} for evaluation. Do not render this label.`
      : '',
    retry
      ? `ART DIRECTOR CORRECTION: ${retry}. Apply only this correction while preserving rider and conveyance identity, rear orientation, scale, and pixel technique.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface ProcessedRacingCraftStrip {
  /** Per-pose normalized cells keyed by pose, in strip order. */
  poses: Record<RacingCraftPose, ProcessedFighterPose>;
  /** Assembled fixed-geometry strip PNG (rear | bankLeft | bankRight). */
  png: Buffer;
}

interface CraftSilhouette {
  size: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  sumX: number;
  sumY: number;
}

/** Chebyshev gap between two inclusive bounding boxes (0 when touching). */
function silhouetteGap(a: CraftSilhouette, b: CraftSilhouette): number {
  const dx = Math.max(a.left - b.right - 1, b.left - a.right - 1, 0);
  const dy = Math.max(a.top - b.bottom - 1, b.top - a.bottom - 1, 0);
  return Math.max(dx, dy);
}

/**
 * Split a generated strip by green-screen connected-component segmentation.
 * Banking tips routinely share X ranges at different Y with the next pose,
 * so no vertical gutter can separate them; instead every non-green subject
 * pixel is labeled with 8-connectivity and the strip must resolve to exactly
 * three major silhouettes, returned left-to-right. Nearby meaningful islands
 * (thruster glow, detached trim) merge into the closest larger silhouette;
 * disconnected tiny specks are ignored. A silhouette spanning two pose
 * thirds, or two similar-size silhouettes in one third, fails as merged; a
 * subject touching the sheet edge fails as genuinely cropped; missing poses
 * pad with green so downstream names the absent pose. Each cell keeps only
 * its own silhouette's pixels (neighbors masked back to green), preserving
 * full tips with no synth or mirror substitution.
 */
export interface RacingStripCellBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export async function splitRacingStripCells(
  image: Buffer,
): Promise<{ cells: Buffer[]; cellWidth: number; bounds: RacingStripCellBounds[] }> {
  let meta;
  try {
    meta = await sharp(image).metadata();
  } catch {
    throw new FighterPoseImageError('invalid-image', 'generated racing strip is not decodable');
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height || width < 24 || height < 8) {
    throw new FighterPoseImageError(
      'invalid-image',
      'generated racing strip is too small to split',
    );
  }
  const { data } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const total = width * height;
  const subject = new Uint8Array(total);
  let totalGreen = 0;
  for (let pixel = 0; pixel < total; pixel++) {
    const o = pixel * 4;
    if (data[o + 3]! <= 8) continue;
    if (isFighterGreenScreenPixel(data[o]!, data[o + 1]!, data[o + 2]!)) {
      totalGreen++;
      continue;
    }
    subject[pixel] = 1;
  }
  if (totalGreen / total < 0.05) {
    throw new FighterPoseImageError(
      'missing-green-background',
      'generated racing strip has too little green background to find gutters',
    );
  }
  // Genuinely image-edge-cropped sheets: content touches the outer border.
  for (let pixel = 0; pixel < total; pixel++) {
    if (!subject[pixel]) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) {
      throw new FighterPoseImageError(
        'invalid-image',
        'generated racing strip is cropped by the sheet edge (content touches the border)',
      );
    }
  }
  // 8-connected components over subject pixels (union-find, two passes).
  const labels = new Int32Array(total).fill(-1);
  const parent: number[] = [];
  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[a] !== root) {
      const next = parent[a]!;
      parent[a] = root;
      a = next;
    }
    return root;
  };
  const neighbors: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!subject[pixel]) continue;
      neighbors.length = 0;
      if (x > 0 && labels[pixel - 1]! >= 0) neighbors.push(labels[pixel - 1]!);
      if (y > 0) {
        const up = pixel - width;
        if (x > 0 && labels[up - 1]! >= 0) neighbors.push(labels[up - 1]!);
        if (labels[up]! >= 0) neighbors.push(labels[up]!);
        if (x < width - 1 && labels[up + 1]! >= 0) neighbors.push(labels[up + 1]!);
      }
      if (neighbors.length === 0) {
        parent.push(parent.length);
        labels[pixel] = parent.length - 1;
      } else {
        const root = find(neighbors[0]!);
        for (let k = 1; k < neighbors.length; k++) {
          const other = find(neighbors[k]!);
          if (other !== root) parent[other] = root;
        }
        labels[pixel] = root;
      }
    }
  }
  const byRoot = new Map<number, CraftSilhouette>();
  for (let pixel = 0; pixel < total; pixel++) {
    if (!subject[pixel]) continue;
    const root = find(labels[pixel]!);
    labels[pixel] = root;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const s = byRoot.get(root);
    if (!s) {
      byRoot.set(root, { size: 1, left: x, top: y, right: x, bottom: y, sumX: x, sumY: y });
    } else {
      s.size++;
      if (x < s.left) s.left = x;
      if (x > s.right) s.right = x;
      if (y < s.top) s.top = y;
      if (y > s.bottom) s.bottom = y;
      s.sumX += x;
      s.sumY += y;
    }
  }
  const comps = [...byRoot.values()];
  const speckFloor = Math.max(64, Math.round(total * 0.0002));
  const majorFloor = Math.max(256, Math.round(total * 0.002));
  const mergeGap = Math.max(6, Math.round(width * 0.008));
  // Merge group per component index; only small-but-meaningful islands merge,
  // always into a strictly larger silhouette within the gap.
  const groupOf = comps.map((_, i) => i);
  const gfind = (a: number): number => {
    let root = a;
    while (groupOf[root] !== root) root = groupOf[root]!;
    while (groupOf[a] !== root) {
      const next = groupOf[a]!;
      groupOf[a] = root;
      a = next;
    }
    return root;
  };
  const aggregate = (): Map<number, CraftSilhouette> => {
    const groups = new Map<number, CraftSilhouette>();
    for (let i = 0; i < comps.length; i++) {
      const g = gfind(i);
      const c = comps[i]!;
      const s = groups.get(g);
      if (!s) {
        groups.set(g, { ...c });
      } else {
        s.size += c.size;
        s.left = Math.min(s.left, c.left);
        s.top = Math.min(s.top, c.top);
        s.right = Math.max(s.right, c.right);
        s.bottom = Math.max(s.bottom, c.bottom);
        s.sumX += c.sumX;
        s.sumY += c.sumY;
      }
    }
    return groups;
  };
  let merged = true;
  while (merged) {
    merged = false;
    const groups = aggregate();
    for (const [gi, g] of groups) {
      if (g.size >= majorFloor || g.size < speckFloor) continue;
      let best: number | null = null;
      let bestGap = Infinity;
      for (const [hj, h] of groups) {
        if (hj === gi || h.size <= g.size) continue;
        const d = silhouetteGap(g, h);
        if (d <= mergeGap && d < bestGap) {
          best = hj;
          bestGap = d;
        }
      }
      if (best !== null) {
        groupOf[gi] = best;
        merged = true;
      }
    }
  }
  // A silhouette spanning two pose thirds is a merged pair, not a wide pose.
  const centers = [width / 6, width / 2, (5 * width) / 6];
  const covered = (s: CraftSilhouette): number =>
    centers.filter((c) => s.left <= c && c <= s.right).length;
  let groups = aggregate();
  for (const g of groups.values()) {
    if (g.size >= majorFloor && covered(g) >= 2) {
      throw new FighterPoseImageError(
        'missing-green-background',
        'generated racing strip has no clear gutter (poses merged or overlapping)',
      );
    }
  }
  // One third holds one pose: two similar-size silhouettes sharing a third
  // are an overlap failure, while a small fragment joins its slot owner and
  // downstream isolation drops it (as stray pieces always were).
  const slotOf = (cx: number): number => {
    let slot = 0;
    for (let k = 1; k < centers.length; k++) {
      if (Math.abs(cx - centers[k]!) < Math.abs(cx - centers[slot]!)) slot = k;
    }
    return slot;
  };
  let settled = false;
  while (!settled) {
    settled = true;
    groups = aggregate();
    const occupants = new Map<number, Array<[number, CraftSilhouette]>>();
    for (const [gi, g] of groups) {
      if (g.size < majorFloor) continue;
      const slot = slotOf(g.sumX / g.size);
      const list = occupants.get(slot);
      if (list) list.push([gi, g]);
      else occupants.set(slot, [[gi, g]]);
    }
    for (const list of occupants.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => b[1].size - a[1].size);
      const [ownerGi, owner] = list[0]!;
      for (const [gi, g] of list.slice(1)) {
        if (g.size < owner.size * 0.5) {
          groupOf[gi] = ownerGi;
          settled = false;
        } else {
          throw new FighterPoseImageError(
            'missing-green-background',
            'generated racing strip has no clear gutter (poses merged or overlapping)',
          );
        }
      }
    }
  }
  groups = aggregate();
  const majors = [...groups.entries()].filter(([, g]) => g.size >= majorFloor);
  const slotGroup = new Map<number, number>();
  for (const [gi, g] of majors) slotGroup.set(slotOf(g.sumX / g.size), gi);
  // Per-pixel owner group for masked extraction (specks drop out as green).
  const rootComp = new Map<number, number>();
  const componentRoots = [...byRoot.keys()];
  comps.forEach((_, i) => rootComp.set(componentRoots[i]!, i));
  const owner = new Int32Array(total).fill(-1);
  for (let pixel = 0; pixel < total; pixel++) {
    if (!subject[pixel]) continue;
    owner[pixel] = gfind(rootComp.get(labels[pixel]!)!);
  }
  // Breathing room doubles as occupancy headroom: the downstream normalizer
  // rejects subjects covering more than 80% of their cell, so solid
  // silhouettes need a real margin, not a 1px halo.
  const margin = Math.max(8, Math.round(width * 0.02));
  const cells: Buffer[] = [];
  const bounds: RacingStripCellBounds[] = [];
  for (let slot = 0; slot < 3; slot++) {
    const gi = slotGroup.get(slot);
    if (gi === undefined) {
      // Missing pose: keep the nominal third green so downstream processing
      // names the absent pose instead of substituting another.
      const left = Math.floor((slot * width) / 3);
      const right = Math.floor(((slot + 1) * width) / 3);
      const w = Math.max(1, right - left);
      cells.push(
        await sharp({ create: { width: w, height, channels: 4, background: '#00ff00' } })
          .png()
          .toBuffer(),
      );
      bounds.push({ left, top: 0, width: w, height });
      continue;
    }
    const g = groups.get(gi)!;
    const left = Math.max(0, g.left - margin);
    const top = Math.max(0, g.top - margin);
    const right = Math.min(width, g.right + 1 + margin);
    const bottom = Math.min(height, g.bottom + 1 + margin);
    const cw = right - left;
    const ch = bottom - top;
    const out = Buffer.alloc(cw * ch * 4);
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const pixel = y * width + x;
        const o = pixel * 4;
        const d = ((y - top) * cw + (x - left)) * 4;
        if (!subject[pixel] || owner[pixel] === gi) {
          out[d] = data[o]!;
          out[d + 1] = data[o + 1]!;
          out[d + 2] = data[o + 2]!;
          out[d + 3] = data[o + 3]!;
        } else {
          out[d] = 0;
          out[d + 1] = 255;
          out[d + 2] = 0;
          out[d + 3] = 255;
        }
      }
    }
    cells.push(
      await sharp(out, { raw: { width: cw, height: ch, channels: 4 } })
        .png()
        .toBuffer(),
    );
    bounds.push({ left, top, width: cw, height: ch });
  }
  return { cells, cellWidth: Math.floor(width / 3), bounds };
}

/**
 * Reject subjects clipped by the sheet crop. Cells are full-height, so
 * top/bottom are sheet edges and any touch means genuine cropping. Inner
 * left/right edges include overlap to preserve banking tips. After primary
 * isolation every edge must still have a clear margin; reaching an expanded
 * cell boundary indicates a cropped or merged silhouette.
 */
function rejectCroppedCell(
  processed: ProcessedFighterPose,
  cellWidth: number,
  cellHeight: number,
  pose: string,
): void {
  const b = processed.metrics.sourceBounds;
  if (
    b.left <= 1 ||
    b.top <= 1 ||
    b.left + b.width >= cellWidth - 1 ||
    b.top + b.height >= cellHeight - 1
  ) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated racing craft ${pose} is cropped by its sheet cell (${b.width}x${b.height} at ${b.left},${b.top})`,
    );
  }
}

/**
 * Key, split, and normalize one generated 3-pose strip. Every cell is
 * processed independently — a missing or malformed pose fails the strip and
 * is never substituted, mirrored, or copied from another pose.
 */
export async function processGeneratedRacingCraftStrip(
  image: Buffer,
): Promise<ProcessedRacingCraftStrip> {
  const { cells } = await splitRacingStripCells(image);
  const poses = {} as Record<RacingCraftPose, ProcessedFighterPose>;
  for (const [index, pose] of RACING_CRAFT_POSES.entries()) {
    const cellMeta = await sharp(cells[index]!).metadata();
    const processed = await processGeneratedFighterPose(cells[index]!, {
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
    }).catch((error) => {
      if (error instanceof FighterPoseImageError) {
        throw new FighterPoseImageError(
          error.code,
          `generated racing craft ${pose} rejected: ${error.message}`,
        );
      }
      throw error;
    });
    rejectCroppedCell(processed, cellMeta.width ?? 0, cellMeta.height ?? 0, pose);
    poses[pose] = processed;
  }
  // Scale coherence: the same vehicle must read at one scale across poses.
  const spans = RACING_CRAFT_POSES.map((pose) => {
    const b = poses[pose]!.metrics.sourceBounds;
    return Math.max(b.width, b.height);
  });
  const lo = Math.min(...spans);
  const hi = Math.max(...spans);
  if (lo <= 0 || hi / lo > RACING_CRAFT_SCALE_TOLERANCE) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated racing craft poses disagree on vehicle scale (${spans.join('/')})`,
    );
  }
  const png = await sharp({
    create: {
      width: RACING_CRAFT_STRIP_WIDTH,
      height: RACING_CRAFT_STRIP_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      RACING_CRAFT_POSES.map((pose, index) => ({
        input: poses[pose]!.png,
        left: index * RACING_CRAFT_CELL,
        top: 0,
      })),
    )
    .png({ palette: true, colours: 128, dither: 0, compressionLevel: 9 })
    .toBuffer();
  return { poses, png };
}

/** Fixed-geometry + format gate for a stored craft strip. */
export async function validateRacingCraftStrip(strip: Buffer): Promise<void> {
  let metadata;
  try {
    metadata = await sharp(strip).metadata();
  } catch (error) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing craft strip is not decodable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    metadata.format !== 'png' ||
    metadata.width !== RACING_CRAFT_STRIP_WIDTH ||
    metadata.height !== RACING_CRAFT_STRIP_HEIGHT
  ) {
    throw new FighterPoseImageError(
      'invalid-image',
      `racing craft strip must be a ${RACING_CRAFT_STRIP_WIDTH}x${RACING_CRAFT_STRIP_HEIGHT} PNG`,
    );
  }
}

/**
 * Presentation reference from a high-resolution generated rear cell: keyed
 * and normalized at illustration scale for key/story art. Always sourced
 * from generated pixels — never an enlargement of the 64px runtime sprite.
 * Vehicle-first, so key art can reference the craft without the craft
 * waiting on key art.
 */
async function normalizeCraftReferenceCell(image: Buffer): Promise<Buffer> {
  const processed = await processGeneratedFighterPose(image, {
    width: RACING_CRAFT_REFERENCE_SIZE.width,
    height: RACING_CRAFT_REFERENCE_SIZE.height,
    padding: 40,
    bottomPadding: 40,
    removeGreenSpill: true,
    isolatePrimarySubject: true,
    colors: 128,
    minSubjectFraction: 0.01,
    maxSubjectFraction: 0.86,
    minSubjectSpanFraction: 0.08,
  });
  // Rounded and tall hovercraft are valid rear silhouettes: require only a
  // minimum readable size on top of the normalizer's own occupancy floors.
  // Camera correctness stays with the automated semantic judge, never with
  // an aspect-ratio guess.
  const { width, height } = processed.metrics.outputBounds;
  if (width < 96 || height < 64) {
    throw new FighterPoseImageError(
      'inconsistent-scale',
      `generated racing craft reference is too small to ground key art (${width}x${height})`,
    );
  }
  return processed.png;
}

/** Reference from a standalone generated rear-pose source image. */
export async function processGeneratedRacingCraftReference(image: Buffer): Promise<Buffer> {
  return normalizeCraftReferenceCell(image);
}

/**
 * Reference from the RAW generated strip: the rear third is cropped from the
 * provider pixels before keying, preserving full generated detail. The
 * pipeline companion must use this — never the normalized 64px cell.
 */
export async function processGeneratedRacingCraftStripReference(strip: Buffer): Promise<Buffer> {
  const { cells } = await splitRacingStripCells(strip);
  return normalizeCraftReferenceCell(cells[0]!);
}

/**
 * Identity board stacking optional key-art identity over the
 * presentation-scale player craft, so downstream prompts preserve both
 * without ever deriving the vehicle from the player's face.
 */
export async function buildRacingIdentityReference(
  primary: Buffer | undefined,
  presentationCraft: Buffer,
): Promise<Buffer> {
  const background = { r: 13, g: 19, b: 31, alpha: 1 };
  const craftPanel = await sharp(presentationCraft)
    .resize(RACING_IDENTITY_BOARD_SIZE.width - 144, primary ? 360 : 600, {
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const composites: OverlayOptions[] = [{ input: craftPanel, left: 72, top: primary ? 624 : 212 }];
  if (primary) {
    const primaryPanel = await sharp(primary)
      .resize(1024, 576, { fit: 'contain', background, kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    composites.unshift({ input: primaryPanel, left: 0, top: 0 });
  }
  return sharp({
    create: { ...RACING_IDENTITY_BOARD_SIZE, channels: 4, background },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
