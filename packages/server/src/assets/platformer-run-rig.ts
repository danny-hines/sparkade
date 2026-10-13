// Rigid-limb run in-betweens for generated platformer heroes. Meta SAM 3.1
// concept prompts split each run contact frame into body, arms and legs; each
// limb then turns as one piece a third of the way toward straight down about
// its joint, so knees and elbows keep the bends the art drew. Frames whose
// segmentation can't drive that fall back per region to pixel shift (the
// on-device algorithm in @sparkade/shared/run-inbetweens). Only original pixels
// move, so no new colors appear. The lab review lives in
// scripts/platformer-sam-rig-lab.mts.
//
// Layers:
//  - SAM input: nearest-neighbor upscale onto a flat background (tiny sprites
//    segment poorly at native size); masks are mapped back onto sprite pixels.
//  - Part assignment: every opaque pixel belongs to exactly one rigid unit
//    (the body, or one arm/leg with its hand/foot); split limb pieces are
//    joined and a near arm takes its own outline.
//  - Motion: rigid layers composited in depth order, per-frame checks deciding
//    rigid, rigid arms over pixel shift, or pixel shift.
import { decodeMaskToRaster, type SegmentationMaskRecord } from '@meta-sam/parser';
import {
  alignRgbaFrames,
  buildRunInbetweens,
  RUN_INBETWEEN_T,
  runInbetweenField,
} from '@sparkade/shared/run-inbetweens';
import sharp from 'sharp';

export const SAM_RIG_VERSION = 1;

/** RGBA pixels, row-major; any sprite or frame on one canvas. */
export interface RigImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

const ALPHA = 8;
const opaqueAt = (image: RigImage, p: number) => image.data[p * 4 + 3]! > ALPHA;

// ---------------------------------------------------------------------------
// SAM input and mask coverage

export const SAM_BACKGROUNDS = {
  gray: [128, 128, 128],
  white: [255, 255, 255],
} as const satisfies Record<string, readonly [number, number, number]>;
export type SamBackground = keyof typeof SAM_BACKGROUNDS;

export interface SamInputOptions {
  /** Nearest-neighbor upscale factor. */
  scale: number;
  /** Sprite pixels of background margin on every side, before scaling. */
  pad: number;
  background: SamBackground;
}

/** Raw RGB of the upscaled sprite composited onto a flat background. */
export function samInputPixels(image: RigImage, options: SamInputOptions): RigImage {
  const { scale, pad } = options;
  const [br, bg, bb] = SAM_BACKGROUNDS[options.background];
  const width = (image.width + pad * 2) * scale;
  const height = (image.height + pad * 2) * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([br, bg, bb, 255], p * 4);
  for (let sy = 0; sy < image.height; sy++)
    for (let sx = 0; sx < image.width; sx++) {
      const s = (sy * image.width + sx) * 4;
      const a = image.data[s + 3]! / 255;
      if (a <= 0) continue;
      const rgb = [
        Math.round(image.data[s]! * a + br * (1 - a)),
        Math.round(image.data[s + 1]! * a + bg * (1 - a)),
        Math.round(image.data[s + 2]! * a + bb * (1 - a)),
        255,
      ];
      for (let dy = 0; dy < scale; dy++) {
        const row = ((sy + pad) * scale + dy) * width;
        for (let dx = 0; dx < scale; dx++) data.set(rgb, (row + (sx + pad) * scale + dx) * 4);
      }
    }
  return { data, width, height };
}

export function encodeRigImage(image: RigImage): Promise<Buffer> {
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

export async function decodeRigImage(png: Buffer): Promise<RigImage> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

/** A SAM mask raster and the half-open box (in SAM input pixels) it covers.
 * The raster's own size can differ from the box; it is stretched to fit. */
export interface DecodedMask {
  bounds: { left: number; top: number; right: number; bottom: number };
  width: number;
  height: number;
  raster: Uint8Array;
}

export function decodeSamMask(record: SegmentationMaskRecord): DecodedMask {
  return {
    bounds: { ...record.bounds },
    width: record.mask.width,
    height: record.mask.height,
    raster: decodeMaskToRaster(record.mask),
  };
}

/** Fraction (0..1) of each sprite pixel's upscaled block inside the mask,
 * sampled at every upscaled pixel center. Transparent sprite pixels get 0. */
export function maskCoverage(
  mask: DecodedMask,
  sprite: RigImage,
  options: Pick<SamInputOptions, 'scale' | 'pad'>,
): Float32Array {
  const { scale, pad } = options;
  const { left, top, right, bottom } = mask.bounds;
  const boxW = right - left;
  const boxH = bottom - top;
  const coverage = new Float32Array(sprite.width * sprite.height);
  if (boxW <= 0 || boxH <= 0) return coverage;
  for (let sy = 0; sy < sprite.height; sy++)
    for (let sx = 0; sx < sprite.width; sx++) {
      const p = sy * sprite.width + sx;
      if (!opaqueAt(sprite, p)) continue;
      let hits = 0;
      for (let dy = 0; dy < scale; dy++) {
        const uy = (sy + pad) * scale + dy + 0.5;
        if (uy < top || uy >= bottom) continue;
        const ry = Math.min(mask.height - 1, Math.floor(((uy - top) * mask.height) / boxH));
        for (let dx = 0; dx < scale; dx++) {
          const ux = (sx + pad) * scale + dx + 0.5;
          if (ux < left || ux >= right) continue;
          const rx = Math.min(mask.width - 1, Math.floor(((ux - left) * mask.width) / boxW));
          hits += mask.raster[ry * mask.width + rx]!;
        }
      }
      coverage[p] = hits / (scale * scale);
    }
  return coverage;
}

// ---------------------------------------------------------------------------
// Part assignment

/** What a SAM concept contributes to the rig. A "lower body" mask (both legs
 * and feet of a standing pose, where "leg" finds nothing) acts as one leg. */
export type MaskRole = 'arm' | 'hand' | 'leg' | 'foot' | 'head' | 'torso';
export const CONCEPT_ROLES: Record<string, MaskRole> = {
  arm: 'arm',
  // "arm" often stops at a sleeve or fur line; "upper arm" finds the rest,
  // and the two pieces are joined end to end.
  'upper arm': 'arm',
  hand: 'hand',
  leg: 'leg',
  'lower body': 'leg',
  foot: 'foot',
  shoe: 'foot',
  head: 'head',
  torso: 'torso',
};

/** One SAM instance mapped onto sprite pixels. */
export interface RigMask {
  concept: string;
  objectId: string;
  coverage: Float32Array;
}

export type UnitKind = 'body' | 'arm' | 'leg';
export type Depth = 'near' | 'far';
export type Point = [number, number];

/** Per-pixel segment code, for overlays only; motion follows units. */
export const SEGMENTS = ['none', 'body', 'head', 'arm', 'hand', 'leg', 'foot'] as const;
export type Segment = (typeof SEGMENTS)[number];

export interface RigUnit {
  id: number;
  kind: UnitKind;
  depth: Depth;
  pixels: number;
  /** Concept and object ids of the SAM instances that formed this unit. */
  sources: string[];
  /** Limb bone: root at the shoulder/hip end, joint at the elbow/knee
   * (geodesic middle), tip at the hand/foot end. */
  root?: Point;
  joint?: Point;
  tip?: Point;
  /** Geodesic root → tip length in pixels. */
  length?: number;
  /** Bone direction root → tip, radians, image space (y down). */
  angle?: number;
}

export interface PartMap {
  width: number;
  height: number;
  /** Unit id per pixel (body is 0), -1 for transparent pixels. */
  unit: Int16Array;
  segment: Uint8Array;
  units: RigUnit[];
  shoulder?: Point;
  hip?: Point;
  /** Hand and foot masks that joined no limb: they stay on the body. */
  unattached: string[];
  warnings: string[];
}

const COVERED = 0.5;
const EDGE_COVERED = 0.2;
const MIN_MASK_PIXELS = 6;
const MAX_LIMB_SHARE = 0.45;

interface Candidate {
  role: MaskRole;
  source: string;
  coverage: Float32Array;
  area: number;
  pixels: number[];
  unit: number;
}

const luma = (image: RigImage, p: number) =>
  0.299 * image.data[p * 4]! + 0.587 * image.data[p * 4 + 1]! + 0.114 * image.data[p * 4 + 2]!;

/** Assign every opaque pixel to exactly one rigid unit: the body (head, torso
 * and anything unclaimed) or one arm/leg with its attached hand/foot. A pixel
 * covered by several limb masks goes to the smallest (most specific) mask;
 * head/torso masks only claim pixels no limb mask covers. */
export function assignParts(image: RigImage, masks: readonly RigMask[]): PartMap {
  const { width, height } = image;
  const size = width * height;
  const warnings: string[] = [];
  let opaqueCount = 0;
  for (let p = 0; p < size; p++) if (opaqueAt(image, p)) opaqueCount++;
  const candidates: Candidate[] = [];
  for (const mask of masks) {
    const role = CONCEPT_ROLES[mask.concept];
    if (!role) continue;
    const pixels: number[] = [];
    for (let p = 0; p < size; p++)
      if (mask.coverage[p]! >= COVERED && opaqueAt(image, p)) pixels.push(p);
    const source = `${mask.concept}#${mask.objectId}`;
    if (pixels.length < MIN_MASK_PIXELS) {
      warnings.push(`${source}: ignored, ${pixels.length} px`);
      continue;
    }
    const limb = role !== 'head' && role !== 'torso';
    if (limb && pixels.length > opaqueCount * MAX_LIMB_SHARE) {
      warnings.push(
        `${source}: ignored, covers ${Math.round((100 * pixels.length) / opaqueCount)}% of the sprite`,
      );
      continue;
    }
    candidates.push({
      role,
      source,
      coverage: mask.coverage,
      area: pixels.length,
      pixels,
      unit: 0,
    });
  }
  // Duplicate instances of one role (IoU > 0.6): keep the larger.
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (a.unit < 0 || b.unit < 0 || a.role !== b.role) continue;
      const inA = new Set(a.pixels);
      const shared = b.pixels.filter((p) => inA.has(p)).length;
      if (shared / (a.area + b.area - shared) > 0.6) {
        const drop = a.area >= b.area ? b : a;
        drop.unit = -1;
        warnings.push(`${drop.source}: duplicate of ${(drop === a ? b : a).source}`);
      }
    }
  const live = candidates.filter((c) => c.unit >= 0);
  const units: RigUnit[] = [{ id: 0, kind: 'body', depth: 'near', pixels: 0, sources: [] }];
  const unattached: string[] = [];
  for (const c of live)
    if (c.role === 'arm' || c.role === 'leg') {
      c.unit = units.length;
      units.push({ id: c.unit, kind: c.role, depth: 'near', pixels: 0, sources: [c.source] });
    }
  // Hands and feet join the limb they overlap most, else the nearest limb
  // within reach; a hand or foot with no limb nearby stays with the body.
  for (const c of live) {
    if (c.role !== 'hand' && c.role !== 'foot') continue;
    const kind = c.role === 'hand' ? 'arm' : 'leg';
    const limbs = live.filter((l) => l.role === kind);
    let best: Candidate | null = null;
    let bestScore = -Infinity;
    for (const limb of limbs) {
      const inLimb = new Set(limb.pixels);
      const overlap = c.pixels.filter((p) => inLimb.has(p)).length;
      let score = overlap;
      if (!overlap) {
        let nearest = Infinity;
        for (const p of c.pixels)
          for (const q of limb.pixels) {
            const d = Math.hypot(
              (p % width) - (q % width),
              Math.floor(p / width) - Math.floor(q / width),
            );
            if (d < nearest) nearest = d;
          }
        score = nearest <= 10 ? -nearest : -Infinity;
      }
      if (score > bestScore) {
        bestScore = score;
        best = limb;
      }
    }
    if (best && bestScore > -Infinity) {
      c.unit = best.unit;
      units[best.unit]!.sources.push(c.source);
    } else {
      c.unit = 0;
      unattached.push(c.source);
      warnings.push(`${c.source}: no ${kind} nearby, left on the body`);
    }
  }
  const unit = new Int16Array(size).fill(-1);
  const segment = new Uint8Array(size);
  const segmentOf: Record<MaskRole, Segment> = {
    arm: 'arm',
    hand: 'hand',
    leg: 'leg',
    foot: 'foot',
    head: 'head',
    torso: 'body',
  };
  for (let p = 0; p < size; p++) {
    if (!opaqueAt(image, p)) continue;
    let pick: Candidate | null = null;
    let edge: Candidate | null = null;
    for (const c of live) {
      const v = c.coverage[p]!;
      const limb = c.role !== 'head' && c.role !== 'torso' && c.unit > 0;
      if (v >= COVERED) {
        const pickLimb = pick && pick.role !== 'head' && pick.role !== 'torso' && pick.unit > 0;
        if (!pick || (limb && !pickLimb) || (limb === pickLimb && c.area < pick.area)) pick = c;
      } else if (limb && v >= EDGE_COVERED && (!edge || v > edge.coverage[p]!)) edge = c;
    }
    const chosen = pick ?? edge;
    unit[p] = chosen ? chosen.unit : 0;
    segment[p] = SEGMENTS.indexOf(chosen ? segmentOf[chosen.role] : 'body');
  }
  cleanupFragments(unit, segment, width, height, units.length);
  for (const u of units) u.pixels = 0;
  for (let p = 0; p < size; p++) if (unit[p]! >= 0) units[unit[p]!]!.pixels++;
  const map: PartMap = { width, height, unit, segment, units, unattached, warnings };
  for (const u of units)
    if (u.id > 0 && u.pixels < MIN_MASK_PIXELS)
      warnings.push(`unit ${u.id} (${u.kind}) is nearly empty`);
  assignDepth(image, map);
  computeBones(map);
  if (mergeLimbPieces(map)) {
    assignDepth(image, map);
    computeBones(map);
  }
  absorbArmOutlines(image, map);
  return map;
}

/** How much darker than both sides a pixel must be to count as an outline. */
const OUTLINE_STEP = 25;

/** SAM masks on upscaled pixel art often stop inside a limb's dark outline,
 * leaving it on the body, where it stays as a ghost outline when a near arm
 * (drawn over the body) swings away. Body pixels touching a near arm that
 * are darker than both the arm pixel beside them and the body pixel beyond
 * (or that sit on the silhouette's edge) join the arm, up to two deep. A dark
 * garment is no darker than the body beyond it, so it stays. */
function absorbArmOutlines(image: RigImage, map: PartMap) {
  const { width, height, unit, segment } = map;
  for (const u of map.units) {
    if (u.kind !== 'arm' || u.depth !== 'near') continue;
    for (let ring = 0; ring < 2; ring++) {
      const take: number[] = [];
      for (let p = 0; p < unit.length; p++) {
        if (unit[p] !== u.id) continue;
        const x = p % width;
        const y = Math.floor(p / width);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const qx = x + dx;
          const qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
          const q = qy * width + qx;
          if (unit[q] !== 0) continue;
          const rx = qx + dx;
          const ry = qy + dy;
          const r = rx < 0 || ry < 0 || rx >= width || ry >= height ? -1 : ry * width + rx;
          const beyond = r < 0 || unit[r]! < 0 ? Infinity : luma(image, r);
          const dark = luma(image, q) + OUTLINE_STEP;
          if (dark <= luma(image, p) && dark <= beyond) take.push(q);
        }
      }
      if (!take.length) break;
      for (const q of take) {
        unit[q] = u.id;
        segment[q] = SEGMENTS.indexOf('arm');
      }
    }
  }
  for (const u of map.units) u.pixels = 0;
  for (let p = 0; p < unit.length; p++) if (unit[p]! >= 0) map.units[unit[p]!]!.pixels++;
}

/** Most pixels between two pieces of one limb that still count as a split. */
const JOIN_GAP = 4;
/** How far from a bone end a piece's pixels count as that end. */
const END_REACH = 8;

/** Joins limb pieces SAM split in two. A piece whose root end comes within
 * JOIN_GAP pixels of another piece's tip end absorbs it (an arm cut at a
 * wristband, a shoe apart from its shin), together with the body pixels
 * between the two ends; limbs that meet root to root (two legs at the hip)
 * stay apart. Then, while a frame still has more than two arms (or legs), the
 * two pieces sharing the longest border join: a bent arm split at the elbow
 * touches across the limb's whole width, two separate arms barely at all.
 * Returns whether anything was joined. */
function mergeLimbPieces(map: PartMap): boolean {
  const { width, height, unit, segment } = map;
  const at = (p: number): Point => [(p % width) + 0.5, Math.floor(p / width) + 0.5];
  const distance = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const near = (p: number, q: Point, r: number) => distance(at(p), q) <= r;
  const pixelsOf = (id: number) => {
    const out: number[] = [];
    for (let p = 0; p < unit.length; p++) if (unit[p] === id) out.push(p);
    return out;
  };
  /** Pixels within `r` (Chebyshev) of any of `pixels`. */
  const around = (pixels: readonly number[], r: number) => {
    const mask = new Uint8Array(unit.length);
    for (const p of pixels) {
      const x = p % width;
      const y = Math.floor(p / width);
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) mask[ny * width + nx] = 1;
        }
    }
    return mask;
  };
  const absorb = (keep: RigUnit, drop: RigUnit, bridge: (p: number) => boolean, why: string) => {
    for (let p = 0; p < unit.length; p++)
      if (unit[p] === 0 && bridge(p)) {
        unit[p] = keep.id;
        segment[p] = SEGMENTS.indexOf(keep.kind);
      }
    for (let p = 0; p < unit.length; p++) if (unit[p] === drop.id) unit[p] = keep.id;
    keep.sources.push(...drop.sources);
    map.warnings.push(`unit ${drop.id} (${drop.kind}) joined unit ${keep.id}: ${why}`);
    const kept = map.units.filter((u) => u !== drop);
    const renumber = new Map(kept.map((u, i) => [u.id, i]));
    for (let p = 0; p < unit.length; p++) if (unit[p]! > 0) unit[p] = renumber.get(unit[p]!)!;
    kept.forEach((u, i) => (u.id = i));
    map.units = kept;
    for (const u of kept) u.pixels = 0;
    for (let p = 0; p < unit.length; p++) if (unit[p]! >= 0) kept[unit[p]!]!.pixels++;
  };
  let merged = false;
  for (let guard = 0; guard < 8; guard++) {
    const limbs = map.units.filter((u) => u.kind !== 'body' && u.root && u.tip && u.pixels > 0);
    let join: { a: RigUnit; b: RigUnit; ends: [number[], number[]] } | null = null;
    for (const a of limbs) {
      const tipEnd = pixelsOf(a.id).filter((p) => near(p, a.tip!, END_REACH));
      for (const b of limbs) {
        if (a === b || a.kind !== b.kind || join) continue;
        // b must start at a's tip and carry on away from a, not sit beside it.
        const gap = distance(a.tip!, b.root!);
        if (
          gap > END_REACH + JOIN_GAP ||
          distance(a.root!, b.root!) <= gap + JOIN_GAP ||
          distance(a.root!, b.tip!) <= distance(a.root!, b.root!)
        )
          continue;
        const rootEnd = pixelsOf(b.id).filter((p) => near(p, b.root!, END_REACH));
        const close = tipEnd.some((p) => rootEnd.some((q) => near(p, at(q), JOIN_GAP + 1)));
        if (close) join = { a, b, ends: [tipEnd, rootEnd] };
      }
      if (join) break;
    }
    if (!join) break;
    const { a, b, ends } = join;
    // Body pixels sandwiched between the two ends (a wristband) join too.
    const [nearA, nearB] = ends.map((end) => around(end, JOIN_GAP));
    const keep = a.pixels >= b.pixels ? a : b;
    absorb(keep, keep === a ? b : a, (p) => !!nearA![p] && !!nearB![p], 'one limb split in two');
    merged = true;
  }
  for (const kind of ['arm', 'leg'] as const)
    for (let guard = 0; guard < 4; guard++) {
      const pieces = map.units.filter((u) => u.kind === kind && u.pixels > 0);
      if (pieces.length <= 2) break;
      let best: { keep: RigUnit; drop: RigUnit; contact: number } | null = null;
      const masks = new Map(pieces.map((u) => [u.id, around(pixelsOf(u.id), 2)]));
      for (const a of pieces)
        for (const b of pieces) {
          if (a.id >= b.id) continue;
          const [small, large] = a.pixels <= b.pixels ? [a, b] : [b, a];
          const mask = masks.get(large.id)!;
          const contact = pixelsOf(small.id).filter((p) => mask[p]).length;
          if (!best || contact > best.contact) best = { keep: large, drop: small, contact };
        }
      if (!best || best.contact < MIN_CONTACT) break;
      const nearKeep = masks.get(best.keep.id)!;
      const nearDrop = masks.get(best.drop.id)!;
      absorb(best.keep, best.drop, (p) => !!nearKeep[p] && !!nearDrop[p], `more than two ${kind}s`);
      merged = true;
    }
  return merged;
}

/** Fewest border pixels for two extra limb pieces to count as one limb. */
const MIN_CONTACT = 3;

/** 8-connected components of pixels with `unit[p] === id`. */
function components(unit: Int16Array, width: number, height: number, id: number): number[][] {
  const seen = new Uint8Array(unit.length);
  const out: number[][] = [];
  for (let start = 0; start < unit.length; start++) {
    if (seen[start] || unit[start] !== id) continue;
    const group: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      group.push(p);
      const x = p % width;
      const y = Math.floor(p / width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (!seen[q] && unit[q] === id) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
    out.push(group);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Small limb fragments detached from their limb's main piece fall back to
 * the body; small body islands enclosed by one limb (mask holes) join it. */
function cleanupFragments(
  unit: Int16Array,
  segment: Uint8Array,
  width: number,
  height: number,
  unitCount: number,
) {
  const body = SEGMENTS.indexOf('body');
  for (let id = 1; id < unitCount; id++) {
    const parts = components(unit, width, height, id);
    for (const part of parts.slice(1))
      if (part.length < Math.max(8, parts[0]!.length * 0.2))
        for (const p of part) {
          unit[p] = 0;
          segment[p] = body;
        }
  }
  const islands = components(unit, width, height, 0);
  for (const island of islands.slice(1)) {
    if (island.length > Math.max(24, islands[0]!.length * 0.05)) continue;
    const votes = new Map<number, number>();
    for (const p of island) {
      const x = p % width;
      const y = Math.floor(p / width);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const u = unit[ny * width + nx]!;
        if (u > 0) votes.set(u, (votes.get(u) ?? 0) + 1);
      }
    }
    const [winner] = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (!winner) continue;
    const seg = segment[island[0]!]!;
    for (const p of island) {
      unit[p] = winner[0];
      segment[p] = seg === SEGMENTS.indexOf('head') ? SEGMENTS.indexOf('arm') : seg;
    }
  }
}

/** Fraction of a unit's pixels with body pixels on both sides along their
 * row or column (within 16 px): an arm drawn over the torso scores high. */
function overBody(map: PartMap, id: number): number {
  const { width, height, unit } = map;
  let inside = 0;
  let total = 0;
  const hits = (x: number, y: number, dx: number, dy: number) => {
    for (let k = 1; k <= 16; k++) {
      const nx = x + dx * k;
      const ny = y + dy * k;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
      const u = unit[ny * width + nx]!;
      if (u === 0) return true;
      if (u < 0) return false;
    }
    return false;
  };
  for (let p = 0; p < unit.length; p++) {
    if (unit[p] !== id) continue;
    total++;
    const x = p % width;
    const y = Math.floor(p / width);
    if ((hits(x, y, -1, 0) && hits(x, y, 1, 0)) || (hits(x, y, 0, -1) && hits(x, y, 0, 1)))
      inside++;
  }
  return total ? inside / total : 0;
}

/** Outline vote at the seam between units a and b: pixel art outlines the
 * occluding shape, so the darker side of each adjacent pair is likely in
 * front. Positive means a is in front. */
function occlusionVote(image: RigImage, map: PartMap, a: number, b: number): number {
  const { width, height, unit } = map;
  let vote = 0;
  let pairs = 0;
  for (let p = 0; p < unit.length; p++) {
    if (unit[p] !== a) continue;
    const x = p % width;
    const y = Math.floor(p / width);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const q = ny * width + nx;
      if (unit[q] !== b) continue;
      pairs++;
      const diff = luma(image, q) - luma(image, p);
      if (diff > 12) vote++;
      else if (diff < -12) vote--;
    }
  }
  return pairs ? vote / pairs : 0;
}

/** Near/far for each pair of arms and pair of legs. Arms: the one drawn over
 * the torso (and outlined against it) is near. Legs: the outline vote at
 * their shared seam, else the brighter leg is near (far limbs are shaded). */
function assignDepth(image: RigImage, map: PartMap) {
  for (const kind of ['arm', 'leg'] as const) {
    const limbs = map.units.filter((u) => u.kind === kind && u.pixels > 0);
    for (const u of limbs) u.depth = 'near';
    if (limbs.length < 2) continue;
    const meanLuma = (id: number) => {
      let sum = 0;
      let n = 0;
      for (let p = 0; p < map.unit.length; p++)
        if (map.unit[p] === id) {
          sum += luma(image, p);
          n++;
        }
      return n ? sum / n : 0;
    };
    const score = (u: RigUnit) =>
      kind === 'arm'
        ? overBody(map, u.id) + 0.5 * occlusionVote(image, map, u.id, 0) + meanLuma(u.id) / 2550
        : meanLuma(u.id) / 255;
    const ranked = [...limbs].sort((a, b) => score(b) - score(a));
    if (kind === 'leg' && limbs.length === 2) {
      const vote = occlusionVote(image, map, limbs[0]!.id, limbs[1]!.id);
      if (Math.abs(vote) > 0.15) {
        ranked[0] = vote > 0 ? limbs[0]! : limbs[1]!;
        ranked[1] = vote > 0 ? limbs[1]! : limbs[0]!;
      }
    }
    ranked.forEach((u, i) => (u.depth = i === 0 ? 'near' : 'far'));
  }
}

function centroid(points: number[], width: number): Point {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += (p % width) + 0.5;
    sy += Math.floor(p / width) + 0.5;
  }
  return [sx / points.length, sy / points.length];
}

/** Anchors: shoulder at the top of the arms, hip where the legs meet the
 * body. Each limb's bone runs from its geodesic end nearer its anchor
 * (root) through its middle (joint) to the other end (tip). */
function computeBones(map: PartMap) {
  const { width, height, unit, segment } = map;
  const head: number[] = [];
  const body: number[] = [];
  const legSeam: number[] = [];
  for (let p = 0; p < unit.length; p++) {
    if (unit[p] === 0) {
      body.push(p);
      if (segment[p] === SEGMENTS.indexOf('head')) head.push(p);
    }
    const u = unit[p]!;
    if (u > 0 && map.units[u]!.kind === 'leg') {
      const x = p % width;
      const y = Math.floor(p / width);
      if (
        (y > 0 && unit[p - width] === 0) ||
        (x > 0 && unit[p - 1] === 0) ||
        (x < width - 1 && unit[p + 1] === 0)
      )
        legSeam.push(p);
    }
  }
  if (!body.length) return;
  // Shoulders: the top of the highest arm (a head mask can include long
  // hair, so "just below the head" is unreliable), centered on the body.
  const armTops = map.units
    .filter((u) => u.kind === 'arm')
    .map((u) => {
      let top = Infinity;
      for (let p = 0; p < unit.length; p++)
        if (unit[p] === u.id) top = Math.min(top, Math.floor(p / width));
      return top;
    })
    .filter(Number.isFinite);
  const bodyTop = Math.min(...body.map((p) => Math.floor(p / width)));
  const bodyBottom = Math.max(...body.map((p) => Math.floor(p / width)));
  const shoulderY = armTops.length
    ? Math.min(height - 1, Math.min(...armTops) + 3)
    : bodyTop + 0.35 * (bodyBottom - bodyTop);
  const row = body.filter(
    (p) => Math.abs(Math.floor(p / width) - shoulderY) <= 4 && !head.includes(p),
  );
  map.shoulder = [(row.length ? centroid(row, width) : centroid(body, width))[0], shoulderY + 0.5];
  if (legSeam.length) map.hip = centroid(legSeam, width);
  else {
    const legs = [] as number[];
    for (let p = 0; p < unit.length; p++)
      if (unit[p]! > 0 && map.units[unit[p]!]!.kind === 'leg') legs.push(p);
    if (legs.length) {
      const top = Math.min(...legs.map((p) => Math.floor(p / width)));
      map.hip = [centroid(legs, width)[0], top + 0.5];
    }
  }
  for (const u of map.units) {
    if (u.kind === 'body') continue;
    const pts: number[] = [];
    for (let p = 0; p < unit.length; p++) if (unit[p] === u.id) pts.push(p);
    if (pts.length < MIN_MASK_PIXELS) continue;
    const anchor = u.kind === 'arm' ? map.shoulder : map.hip;
    const bone = boneOf(pts, width, anchor);
    u.root = bone.root;
    u.joint = bone.joint;
    u.tip = bone.tip;
    u.length = bone.length;
    u.angle = Math.atan2(bone.tip[1] - bone.root[1], bone.tip[0] - bone.root[0]);
  }
}

/** Bone of a limb's pixels from geodesic distance inside the limb (5/7
 * chamfer steps) from the pixel nearest `anchor` (else the upper geodesic
 * end): root, joint and tip are the centroids of the first 12%, middle 12%
 * and last 12% of that range. Unlike a straight principal axis, geodesic ends follow a
 * bent elbow or knee. Pixels the walk can't reach take their nearest reached
 * pixel's distance plus the gap. */
export function boneOf(
  points: readonly number[],
  width: number,
  anchor?: Point,
): { root: Point; joint: Point; tip: Point; length: number } {
  const at = (p: number): Point => [(p % width) + 0.5, Math.floor(p / width) + 0.5];
  const index = new Map<number, number>();
  points.forEach((p, i) => index.set(p, i));
  const reached: number[] = [];
  /** 5/7 chamfer geodesic distances from `seed` within the point set. */
  const walk = (seed: number): Float64Array => {
    const dist = new Float64Array(points.length).fill(Infinity);
    const buckets: number[][] = [];
    dist[index.get(seed)!] = 0;
    buckets[0] = [seed];
    for (let cost = 0; cost < buckets.length; cost++) {
      const bucket = buckets[cost];
      if (!bucket) continue;
      for (const p of bucket) {
        if (dist[index.get(p)!]! < cost) continue;
        const x = p % width;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if ((x === 0 && dx < 0) || (x === width - 1 && dx > 0)) continue;
            const q = p + dy * width + dx;
            const i = index.get(q);
            if (i === undefined) continue;
            const next = cost + (dx && dy ? 7 : 5);
            if (next < dist[i]!) {
              dist[i] = next;
              (buckets[next] ??= []).push(q);
            }
          }
      }
    }
    reached.length = 0;
    points.forEach((p, i) => Number.isFinite(dist[i]!) && reached.push(p));
    points.forEach((p, i) => {
      if (Number.isFinite(dist[i]!)) return;
      const [x, y] = at(p);
      let nearest = Infinity;
      let base = 0;
      for (const q of reached) {
        const [qx, qy] = at(q);
        const d = Math.hypot(x - qx, y - qy);
        if (d < nearest) {
          nearest = d;
          base = dist[index.get(q)!]!;
        }
      }
      dist[i] = base + nearest * 5;
    });
    return dist;
  };
  const farthest = (dist: Float64Array) => {
    let best = 0;
    for (let i = 1; i < dist.length; i++) if (dist[i]! > dist[best]!) best = i;
    return points[best]!;
  };
  // Root: the pixel nearest the anchor (where the limb meets the body);
  // without one, the upper of the limb's two geodesic ends.
  let dist: Float64Array;
  if (anchor) {
    let seed = points[0]!;
    let best = Infinity;
    for (const p of points) {
      const [x, y] = at(p);
      const d = Math.hypot(x - anchor[0], y - anchor[1]);
      if (d < best) {
        best = d;
        seed = p;
      }
    }
    dist = walk(seed);
  } else {
    const endA = farthest(walk(points[0]!));
    const fromA = walk(endA);
    const endB = farthest(fromA);
    dist = at(endA)[1] <= at(endB)[1] ? fromA : walk(endB);
  }
  const max = Math.max(...dist);
  const band = (lo: number, hi: number) =>
    centroid(
      points.filter((_p, i) => dist[i]! >= lo * max && dist[i]! <= hi * max),
      width,
    );
  return {
    root: band(0, 0.12),
    joint: band(0.44, 0.56),
    tip: band(0.88, 1),
    length: max / 5,
  };
}

// ---------------------------------------------------------------------------
// Rigid transforms and compositing

/** Affine map [a, b, c, d, e, f]: x' = a x + b y + c, y' = d x + e y + f. */
export type Affine = [number, number, number, number, number, number];
export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

/** Rotate by `angle` about `pivot`, then translate by (dx, dy). */
export function rigid(angle: number, pivot: Point, dx = 0, dy = 0): Affine {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [px, py] = pivot;
  return [cos, -sin, px - cos * px + sin * py + dx, sin, cos, py - sin * px - cos * py + dy];
}

/** `outer` after `inner`. */
export function compose(outer: Affine, inner: Affine): Affine {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [
    a * A + b * D,
    a * B + b * E,
    a * C + b * F + c,
    d * A + e * D,
    d * B + e * E,
    d * C + e * F + f,
  ];
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * e - b * d;
  return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det];
}

export function apply(m: Affine, x: number, y: number): Point {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
}

/** Back-to-front unit order: far arm, far leg, near leg, body, near arm.
 * Legs sit behind the body so the hip seam stays hidden as they swing. */
export function depthOrder(map: PartMap): number[] {
  const rank = (u: RigUnit) =>
    u.kind === 'body'
      ? 3
      : u.kind === 'arm'
        ? u.depth === 'far'
          ? 0
          : 4
        : u.depth === 'far'
          ? 1
          : 2;
  return [...map.units].sort((a, b) => rank(a) - rank(b) || a.id - b.id).map((u) => u.id);
}

/** Body colors guessed under the near arms: an arm pixel with body pixels
 * on both sides of its row (or column) within 20 px takes the nearer side's
 * color. Revealed when the arm swings away; moves with the body. */
export function bodyUnderlay(map: PartMap): Int32Array {
  const { width, height, unit } = map;
  const under = new Int32Array(width * height).fill(-1);
  const near = new Set(
    map.units.filter((u) => u.kind === 'arm' && u.depth === 'near').map((u) => u.id),
  );
  const probe = (x: number, y: number, dx: number, dy: number): [number, number] | null => {
    for (let k = 1; k <= 20; k++) {
      const nx = x + dx * k;
      const ny = y + dy * k;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return null;
      const q = ny * width + nx;
      if (unit[q] === 0) return [q, k];
      if (!near.has(unit[q]!)) return null;
    }
    return null;
  };
  for (let p = 0; p < unit.length; p++) {
    if (!near.has(unit[p]!)) continue;
    const x = p % width;
    const y = Math.floor(p / width);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const a = probe(x, y, -dx, -dy);
      const b = probe(x, y, dx, dy);
      if (a && b) {
        under[p] = a[1] <= b[1] ? a[0] : b[0];
        break;
      }
    }
  }
  return under;
}

/** One rigid layer: the source pixels it owns, where they go, and (for
 * the body) underlay colors for pixels a near arm covered. */
export interface RigLayer {
  name: string;
  member: Uint8Array;
  transform: Affine;
  underlay?: Int32Array;
  /** Pixels this layer reads instead of the shared image (same canvas), for
   * limb extensions drawn where the body already has pixels. */
  source?: RigImage;
}

/** Composite layers (front first) by inverse mapping each output pixel
 * through each layer's transform, nearest neighbor, original colors only.
 * The first layer that owns the source pixel wins. Same canvas size. */
export function renderLayers(image: RigImage, layers: readonly RigLayer[]): RigImage {
  const { width, height } = image;
  const inverse = layers.map((layer) => [layer, invert(layer.transform)] as const);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      for (const [layer, inv] of inverse) {
        const [fx, fy] = apply(inv, x + 0.5, y + 0.5);
        const sx = Math.floor(fx);
        const sy = Math.floor(fy);
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        const s = sy * width + sx;
        let from = layer.member[s] ? s : -1;
        if (from < 0 && layer.underlay && layer.underlay[s]! >= 0) from = layer.underlay[s]!;
        if (from < 0) continue;
        const src = layer.source ?? image;
        data.set(src.data.subarray(from * 4, from * 4 + 4), (y * width + x) * 4);
        break;
      }
    }
  return { data, width, height };
}

/** Composite whole units, each through its own transform (identity when
 * missing), in depth order. */
export function renderRig(
  image: RigImage,
  map: PartMap,
  transforms: ReadonlyMap<number, Affine>,
  options: { underlay?: Int32Array } = {},
): RigImage {
  const layers = depthOrder(map)
    .reverse()
    .map((id) => ({
      name: `unit-${id}`,
      member: Uint8Array.from(map.unit, (u) => (u === id ? 1 : 0)),
      transform: transforms.get(id) ?? IDENTITY,
      underlay: id === 0 ? options.underlay : undefined,
    }));
  return renderLayers(image, layers);
}

/** Close enclosed transparent pockets up to `maxHole` pixels by growing
 * neighbor colors inward, then one-pixel cracks with opaque pixels on both
 * sides. Original colors only. With `reference` (the same frame without the
 * limb motion), gaps whose 3x3 neighborhood is unchanged belong to the art
 * and are left open. */
export function fillHoles(image: RigImage, maxHole = 48, reference?: RigImage): RigImage {
  const { width, height } = image;
  const data = new Uint8ClampedArray(image.data);
  const unchanged = (p: number) => {
    if (!reference) return false;
    const x = p % width;
    const y = Math.floor(p / width);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = (ny * width + nx) * 4;
        for (let k = 0; k < 4; k++) if (image.data[q + k] !== reference.data[q + k]) return false;
      }
    return true;
  };
  const clear = new Int16Array(width * height);
  for (let p = 0; p < clear.length; p++) clear[p] = data[p * 4 + 3]! > ALPHA ? -1 : 1;
  for (const hole of components(clear, width, height, 1)) {
    if (hole.length > maxHole || hole.every(unchanged)) continue;
    if (
      hole.some(
        (p) => p % width === 0 || p % width === width - 1 || p < width || p >= width * (height - 1),
      )
    )
      continue;
    let pending = new Set(hole);
    for (let guard = 0; pending.size && guard < 64; guard++) {
      const next = new Set<number>();
      const fills: Array<[number, number]> = [];
      for (const p of pending) {
        const x = p % width;
        let src = -1;
        for (const q of [p - 1, p + 1, p - width, p + width])
          if (
            (q !== p - 1 || x > 0) &&
            (q !== p + 1 || x < width - 1) &&
            data[q * 4 + 3]! > ALPHA
          ) {
            src = q;
            break;
          }
        if (src >= 0) fills.push([p, src]);
        else next.add(p);
      }
      if (!fills.length) break;
      for (const [p, src] of fills) data.set(data.subarray(src * 4, src * 4 + 4), p * 4);
      pending = next;
    }
  }
  const out = new Uint8ClampedArray(data);
  const solid = (n: number) => data[n * 4 + 3]! > ALPHA;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (solid(p) || unchanged(p)) continue;
      const src =
        solid(p - 1) && solid(p + 1)
          ? p - 1
          : solid(p - width) && solid(p + width)
            ? p - width
            : -1;
      if (src >= 0) out.set(data.subarray(src * 4, src * 4 + 4), p * 4);
    }
  return { data: out, width, height };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const angleOf = (from: Point, to: Point) => Math.atan2(to[1] - from[1], to[0] - from[0]);

// ---------------------------------------------------------------------------
// Rigid-limb in-betweens

export interface RigidLimbMotion {
  unit: number;
  kind: 'arm' | 'leg';
  depth: Depth;
  pivot: Point;
  /** Rotation about the pivot, radians (positive turns clockwise on screen). */
  turn: number;
}

export interface RigidInbetween {
  image: RigImage;
  shoulder: Point | null;
  hip: Point | null;
  limbs: RigidLimbMotion[];
  /** Vertical scale of the legs about the top of the legs: below 1 only
   * when the rise is capped. */
  legSquash: number;
  /** Rows the whole figure moved up to put its lowest pixel back on the
   * contact's ground row (negative: moved down). */
  rise: number;
  /** Rows added above the canvas so the raised head is not clipped. */
  grownTop: number;
  riseCap: number | null;
  warnings: string[];
}

/** Lowest a hip may sit, as a share of the figure's height above its lowest
 * pixel: leg masks that start lower are legs whose tops a robe or tunic hides. */
const HIP_SHARE = 0.3;

/** Joints hidden in the body. The shoulder is the midpoint of the two largest
 * arms' top ends (two arms often leave the torso's outline at opposite edges),
 * or the top end of the only arm. The hip is the midpoint of the two legs' top
 * ends, raised into the body when those tops sit lower than HIP_SHARE of the
 * figure (thighs under a garment). */
export function limbPivots(
  map: PartMap,
  image: RigImage,
): { shoulder: Point | null; hip: Point | null } {
  const midpoint = (kind: UnitKind): Point | null => {
    const [a, b] = map.units
      .filter((u) => u.kind === kind && u.root && u.tip)
      .sort((x, y) => y.pixels - x.pixels);
    if (a && b) return [(a.root![0] + b.root![0]) / 2, (a.root![1] + b.root![1]) / 2];
    return a?.root ?? null;
  };
  const shoulder = midpoint('arm') ?? map.shoulder ?? null;
  let hip = midpoint('leg') ?? map.hip ?? null;
  if (hip) {
    const highest = lowestOpaqueRow(image) + 0.5 - HIP_SHARE * figureHeight(image);
    hip = [hip[0], Math.min(hip[1], highest)];
  }
  return { shoulder, hip };
}

/** The center of a limb's topmost visible edge: its pixels within 2 px of
 * its top end along the root → tip axis. */
function topEnd(map: PartMap, u: RigUnit): Point {
  const { width, unit } = map;
  const length = Math.hypot(u.tip![0] - u.root![0], u.tip![1] - u.root![1]) || 1;
  const ax = (u.tip![0] - u.root![0]) / length;
  const ay = (u.tip![1] - u.root![1]) / length;
  const pixels: number[] = [];
  for (let p = 0; p < unit.length; p++) if (unit[p] === u.id) pixels.push(p);
  const along = (p: number) =>
    ((p % width) + 0.5 - u.root![0]) * ax + (Math.floor(p / width) + 0.5 - u.root![1]) * ay;
  const start = Math.min(...pixels.map(along));
  return centroid(
    pixels.filter((p) => along(p) <= start + 2),
    width,
  );
}

/** Where a limb turns: the camera-facing arm at its own topmost visible
 * point (its shoulder is in view), the far arm at the shared shoulder behind
 * the body, legs at the shared hip. */
function pivotOf(
  u: RigUnit,
  pivots: { shoulder: Point | null; hip: Point | null },
  map: PartMap,
): Point | null {
  if (u.kind === 'leg') return pivots.hip;
  if (!u.root || !u.tip) return null;
  const arms = map.units.filter((v) => v.kind === 'arm' && v.root && v.tip);
  return u.depth === 'near' || arms.length < 2 ? topEnd(map, u) : pivots.shoulder;
}

/** Shortest believable leg, and farthest a limb may start from its pivot,
 * as shares of the figure's height. */
const MIN_LEG_SHARE = 0.12;
const MAX_PIVOT_SHARE = 0.25;

export interface RegionCheck {
  ok: boolean;
  reasons: string[];
}

/** Whether a contact frame's segmentation can drive rigid limbs, for the
 * legs and the arms separately. Legs: both found, believably long, starting
 * near the hip. Arms: at least one long enough to swing, every such arm
 * starting near the shoulder, and SAM's hands one per arm: an arm carrying
 * several hand pieces (bracelets or leaves read as hands) or a hand joined
 * to no arm means the arms are in pieces that would come apart when swung.
 * Characters SAM can't take apart (robots, creatures) fail one or both and
 * keep pixel shift there. */
export function checkRigFrame(
  image: RigImage,
  map: PartMap,
): { ok: boolean; arms: RegionCheck; legs: RegionCheck } {
  const height = Math.max(1, figureHeight(image));
  const { shoulder, hip } = limbPivots(map, image);
  const legs: string[] = [];
  const arms: string[] = [];
  const found = (kind: UnitKind) => map.units.filter((u) => u.kind === kind && u.root && u.tip);
  const length = (u: RigUnit) => Math.hypot(u.tip![0] - u.root![0], u.tip![1] - u.root![1]);
  const far = (u: RigUnit, pivot: Point | null) =>
    pivot && Math.hypot(u.root![0] - pivot[0], u.root![1] - pivot[1]) > MAX_PIVOT_SHARE * height;
  const legUnits = found('leg');
  if (legUnits.length < 2) legs.push(`${legUnits.length} of 2 legs found`);
  for (const u of legUnits) {
    if (length(u) < MIN_LEG_SHARE * height)
      legs.push(`leg ${u.id} is ${Math.round(length(u))} px, too short for a leg`);
    if (far(u, hip)) legs.push(`leg ${u.id} starts far from the hip`);
  }
  const swinging = found('arm').filter((u) => length(u) >= MIN_ARM_SHARE * height);
  if (!swinging.length) arms.push('no arm long enough to swing');
  const isHand = (source: string) => CONCEPT_ROLES[source.split('#')[0]!] === 'hand';
  for (const u of found('arm')) {
    const hands = u.sources.filter(isHand).length;
    if (hands > 1) arms.push(`arm ${u.id} has ${hands} hand pieces`);
  }
  const loose = map.unattached.filter(isHand);
  if (loose.length) arms.push(`${loose.join(', ')} attached to no arm`);
  for (const u of swinging)
    if (far(u, shoulder)) arms.push(`arm ${u.id} starts far from the shoulder`);
  return {
    ok: !legs.length && !arms.length,
    arms: { ok: !arms.length, reasons: arms },
    legs: { ok: !legs.length, reasons: legs },
  };
}

/** Shortest arm that swings, as a share of the figure's height. */
const MIN_ARM_SHARE = 0.12;

/** Rows from the top of the head to the lowest pixel. */
function figureHeight(image: RigImage): number {
  let top = -1;
  for (let p = 0; p < image.width * image.height && top < 0; p++)
    if (opaqueAt(image, p)) top = Math.floor(p / image.width);
  return top < 0 ? 0 : lowestOpaqueRow(image) - top + 1;
}

function lowestOpaqueRow(image: RigImage): number {
  for (let p = image.width * image.height - 1; p >= 0; p--)
    if (opaqueAt(image, p)) return Math.floor(p / image.width);
  return -1;
}

/** Rows taller the figure stands in the standing frame than in a stride
 * frame, top of the head to the lowest pixel; 0 when not taller. Needs no
 * SAM masks, which often find no legs in the standing frame. */
export function standingHeightGain(contact: RigImage, idle: RigImage): number {
  return Math.max(0, figureHeight(idle) - figureHeight(contact));
}

/** Longest extension of a limb into the body, in pixels. */
const MAX_EXTEND = 24;

/** Extends a limb drawn behind the body toward its pivot (the joint hidden
 * in the body): its top cross-section is repeated toward the pivot, or back
 * along the limb's own axis when the pivot isn't inside the body (a hip
 * midpoint in the gap between two legs), but only where the body covers that
 * spot. The extension stays out of sight until turning
 * the limb pulls it out from under a hem or the torso's edge, where it fills
 * what would be a gap. Returns the limb's member mask and source image with
 * the extension added, or null when nothing fits. */
function extendTowardPivot(
  image: RigImage,
  map: PartMap,
  u: RigUnit,
  pivot: Point,
  pixels: readonly number[],
): { member: Uint8Array; source: RigImage } | null {
  const { width, height } = map;
  const axisLength = Math.hypot(u.tip![0] - u.root![0], u.tip![1] - u.root![1]);
  if (axisLength < 1) return null;
  const axis: Point = [
    (u.tip![0] - u.root![0]) / axisLength,
    (u.tip![1] - u.root![1]) / axisLength,
  ];
  const toPivot = Math.hypot(pivot[0] - u.root![0], pivot[1] - u.root![1]);
  const px = Math.floor(pivot[0]);
  const py = Math.floor(pivot[1]);
  const pivotInBody =
    px >= 0 && py >= 0 && px < width && py < height && map.unit[py * width + px] === 0;
  const step: Point =
    pivotInBody && toPivot >= 3
      ? [(pivot[0] - u.root![0]) / toPivot, (pivot[1] - u.root![1]) / toPivot]
      : [-axis[0], -axis[1]];
  const reach = Math.min(MAX_EXTEND, Math.ceil(toPivot) + 6);
  const along = (p: number) =>
    ((p % width) + 0.5 - u.root![0]) * axis[0] +
    (Math.floor(p / width) + 0.5 - u.root![1]) * axis[1];
  const start = Math.min(...pixels.map(along));
  const band = pixels.filter((p) => along(p) <= start + 2);
  const member = new Uint8Array(map.unit.length);
  for (const p of pixels) member[p] = 1;
  const data = new Uint8ClampedArray(image.data);
  let added = 0;
  for (const b of band) {
    const bx = (b % width) + 0.5;
    const by = Math.floor(b / width) + 0.5;
    for (let k = 1; k <= reach; k++) {
      const x = Math.floor(bx + step[0] * k);
      const y = Math.floor(by + step[1] * k);
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      const q = y * width + x;
      if (map.unit[q] === u.id || member[q]) continue;
      if (map.unit[q] !== 0) break;
      member[q] = 1;
      data.set(image.data.subarray(b * 4, b * 4 + 4), q * 4);
      added++;
    }
  }
  return added ? { member, source: { data, width, height } } : null;
}

/** The rigid-limb in-between: the body stays put and every arm and leg turns
 * as one piece, `t` of the way from where it points toward straight down,
 * about its joint (see `pivotOf`), so knees and elbows keep the bends the art
 * drew. Legs and the far arm, drawn behind the body, are extended toward
 * their joint under it so turning them opens no gap at a hem or shoulder.
 * Legs turned toward vertical reach lower, so the whole figure
 * then moves up until its lowest pixel is back on the contact's ground row,
 * and the canvas grows at the top rather than clip the head. With
 * `riseCap`, the legs keep their full turn but are squashed vertically toward
 * the top of the legs so the figure rises at most that many rows. Layers
 * composite front to back: near arm, body, near leg, far leg, far arm. */
export function rigidLimbInbetween(
  contact: RigImage,
  contactMap: PartMap,
  t: number,
  options: { riseCap?: number } = {},
): RigidInbetween {
  const warnings: string[] = [];
  const pad = 40;
  const big = padImage(contact, pad);
  const map = padMap(contactMap, pad);
  const pivots = limbPivots(map, big);
  const { shoulder, hip } = pivots;
  const at = (p: number): Point => [(p % map.width) + 0.5, Math.floor(p / map.width) + 0.5];
  const plans: Array<{ unit: RigUnit; pivot: Point; turn: number; pixels: number[] }> = [];
  const figure = figureHeight(contact);
  for (const u of map.units) {
    if (u.kind === 'body') continue;
    const pivot = pivotOf(u, pivots, map);
    if (!u.tip || !u.root || !pivot) {
      warnings.push(`unit ${u.id} (${u.kind}): no bone, moves with the body`);
      continue;
    }
    // A hand SAM found without its sleeve would swing loose from it.
    const length = Math.hypot(u.tip[0] - u.root[0], u.tip[1] - u.root[1]);
    if (u.kind === 'arm' && length < MIN_ARM_SHARE * figure) {
      warnings.push(`unit ${u.id} (arm): ${Math.round(length)} px, too short to swing; stays`);
      continue;
    }
    const pixels: number[] = [];
    for (let p = 0; p < map.unit.length; p++) if (map.unit[p] === u.id) pixels.push(p);
    plans.push({ unit: u, pivot, turn: t * wrap(Math.PI / 2 - angleOf(pivot, u.tip)), pixels });
  }
  let baseLowest = -Infinity;
  for (let p = 0; p < map.unit.length; p++)
    if (map.unit[p]! >= 0) baseLowest = Math.max(baseLowest, at(p)[1]);
  const turns = new Map<number, Affine>(
    plans.map((plan) => [plan.unit.id, rigid(plan.turn, plan.pivot)]),
  );
  // Squash the turned legs toward the top of the legs until the lowest leg
  // pixel drops at most `riseCap` below the contact's.
  const riseCap = options.riseCap === undefined ? null : Math.max(0, options.riseCap);
  let legSquash = 1;
  const legs = plans.filter((plan) => plan.unit.kind === 'leg');
  let legTop = Infinity;
  let turnedLowest = -Infinity;
  for (const plan of legs)
    for (const p of plan.pixels) {
      legTop = Math.min(legTop, at(p)[1] - 0.5);
      turnedLowest = Math.max(turnedLowest, apply(turns.get(plan.unit.id)!, ...at(p))[1]);
    }
  if (riseCap !== null && turnedLowest > baseLowest + riseCap && turnedLowest > legTop)
    legSquash = Math.max(0, (baseLowest + riseCap - legTop) / (turnedLowest - legTop));
  const squash: Affine = [1, 0, 0, 0, legSquash, legTop * (1 - legSquash)];
  const transforms = new Map<number, Affine>(
    plans.map((plan) => {
      const turn = turns.get(plan.unit.id)!;
      return [plan.unit.id, plan.unit.kind === 'leg' ? compose(squash, turn) : turn];
    }),
  );
  // Limbs drawn behind the body (legs, far arm) reach in toward their pivot.
  const extensions = new Map(
    plans
      .filter((plan) => plan.unit.kind === 'leg' || plan.unit.depth === 'far')
      .map((plan) => [
        plan.unit.id,
        extendTowardPivot(big, map, plan.unit, plan.pivot, plan.pixels),
      ]),
  );
  const layers: RigLayer[] = depthOrder(map)
    .reverse()
    .map((id) => {
      const extension = extensions.get(id);
      return {
        name: id === 0 ? 'body' : `unit-${id}`,
        member: extension?.member ?? Uint8Array.from(map.unit, (u) => (u === id ? 1 : 0)),
        source: extension?.source,
        transform: transforms.get(id) ?? IDENTITY,
        underlay: id === 0 ? bodyUnderlay(map) : undefined,
      };
    });
  // Gaps already in the art stay open.
  const still = renderLayers(
    big,
    layers.map((layer) => ({ ...layer, transform: IDENTITY })),
  );
  const rendered = fillHoles(renderLayers(big, layers), 48, still);
  let top = -1;
  let bottom = -1;
  let clipped = 0;
  for (let p = 0; p < rendered.width * rendered.height; p++)
    if (opaqueAt(rendered, p)) {
      const y = Math.floor(p / rendered.width);
      if (top < 0) top = y;
      bottom = y;
      const x = p % rendered.width;
      if (x < pad || x >= pad + contact.width) clipped++;
    }
  if (clipped) warnings.push(`${clipped} pixels past the canvas sides were clipped`);
  const ground = pad + lowestOpaqueRow(contact);
  const rise = bottom >= 0 ? bottom - ground : 0;
  const grownTop = top >= 0 ? Math.max(0, pad + rise - top) : 0;
  const image = cropImage(
    rendered,
    pad,
    pad + rise - grownTop,
    contact.width,
    contact.height + grownTop,
  );
  const unpad = (p: Point | null): Point | null => (p ? [p[0] - pad, p[1] - pad] : null);
  return {
    image,
    shoulder: unpad(shoulder),
    hip: unpad(hip),
    limbs: plans.map((plan) => ({
      unit: plan.unit.id,
      kind: plan.unit.kind as 'arm' | 'leg',
      depth: plan.unit.depth,
      pivot: unpad(plan.pivot)!,
      turn: plan.turn,
    })),
    legSquash,
    rise,
    grownTop,
    riseCap,
    warnings,
  };
}

/** `runInbetween`'s splat and gap fill, applied to any frame on a field from
 * `runInbetweenField`: moving the contact itself reproduces pixel shift
 * exactly, and moving the contact with its arms taken out moves the body and
 * legs exactly as pixel shift would. */
export function splatAlongField(
  source: RigImage,
  field: (x: number, y: number) => [number, number],
  t: number,
): RigImage {
  const { width, height } = source;
  let out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (source.data[p * 4 + 3]! <= 8) continue;
      const [dx, dy] = field(x, y);
      const nx = x + Math.round(dx * t);
      const ny = y + Math.round(dy * t);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      out.set(source.data.subarray(p * 4, p * 4 + 4), (ny * width + nx) * 4);
    }
  for (let pass = 0; pass < 2; pass++) {
    const next = out.slice();
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        if (out[p * 4 + 3]! > 8) continue;
        const solid = (n: number) => out[n * 4 + 3]! > 8;
        const from =
          solid(p - 1) && solid(p + 1)
            ? p - 1
            : solid(p - width) && solid(p + width)
              ? p - width
              : null;
        if (from !== null) next.set(out.subarray(from * 4, from * 4 + 4), p * 4);
      }
    out = next;
  }
  return { data: out, width, height };
}

export interface RigidArmsInbetween {
  image: RigImage;
  /** Pixel-shift motion of the shoulder the arms ride on, pixels. */
  shift: Point;
  limbs: RigidLimbMotion[];
  warnings: string[];
}

/** For a frame whose arms SAM separated but whose legs it didn't: the body
 * and legs move exactly as pixel shift moves them (the contact with its
 * swinging arms taken out, near-arm spots filled with body colors), and the
 * arms turn rigidly about their joints as in `rigidLimbInbetween` while riding
 * along with pixel shift's motion at the shoulder. Both frames share one
 * canvas. */
export function rigidArmsInbetween(
  contact: RigImage,
  contactMap: PartMap,
  idle: RigImage,
  t: number,
): RigidArmsInbetween {
  const warnings: string[] = [];
  const { width, height } = contact;
  const pivots = limbPivots(contactMap, contact);
  const figure = figureHeight(contact);
  const arms = contactMap.units.filter((u) => {
    if (u.kind !== 'arm' || !u.root || !u.tip) return false;
    const length = Math.hypot(u.tip[0] - u.root[0], u.tip[1] - u.root[1]);
    if (length >= MIN_ARM_SHARE * figure) return true;
    warnings.push(
      `unit ${u.id} (arm): ${Math.round(length)} px, too short to swing; moves with the body`,
    );
    return false;
  });
  // The body and legs without the swinging arms, moved by pixel shift's field.
  const field = runInbetweenField(contact, idle);
  const underlay = bodyUnderlay(contactMap);
  const bodyOnly = new Uint8ClampedArray(contact.data);
  const swinging = new Set(arms.map((u) => u.id));
  for (let p = 0; p < width * height; p++) {
    if (!swinging.has(contactMap.unit[p]!)) continue;
    const under = underlay[p]!;
    if (under >= 0) bodyOnly.set(contact.data.subarray(under * 4, under * 4 + 4), p * 4);
    else bodyOnly.fill(0, p * 4, p * 4 + 4);
  }
  const moved = splatAlongField({ data: bodyOnly, width, height }, field, t);
  const anchor = pivots.shoulder ?? arms[0]?.root ?? [width / 2, height / 2];
  const [fx, fy] = field(Math.floor(anchor[0]), Math.floor(anchor[1]));
  const shift: Point = [Math.round(fx * t), Math.round(fy * t)];
  // Arms on a padded canvas so a swing past the sides is noticed, not wrapped.
  const pad = 40;
  const big = padImage(contact, pad);
  const map = padMap(contactMap, pad);
  const bigPivots = limbPivots(map, big);
  const movedBig = padImage(moved, pad);
  const arm = (u: RigUnit, swing: boolean) => {
    const padded = map.units[u.id]!;
    const pivot = pivotOf(padded, bigPivots, map)!;
    const pixels: number[] = [];
    for (let p = 0; p < map.unit.length; p++) if (map.unit[p] === u.id) pixels.push(p);
    const turn = t * wrap(Math.PI / 2 - angleOf(pivot, padded.tip!));
    const extension =
      padded.depth === 'far' ? extendTowardPivot(big, map, padded, pivot, pixels) : null;
    return {
      motion: {
        unit: u.id,
        kind: 'arm' as const,
        depth: u.depth,
        pivot: [pivot[0] - pad, pivot[1] - pad] as Point,
        turn,
      },
      layer: {
        name: `arm-${u.id}`,
        member: extension?.member ?? Uint8Array.from(map.unit, (v) => (v === u.id ? 1 : 0)),
        source: extension?.source ?? big,
        transform: rigid(swing ? turn : 0, pivot, shift[0], shift[1]),
      } satisfies RigLayer,
    };
  };
  const compose = (swing: boolean) => {
    const near = arms.filter((u) => u.depth === 'near').map((u) => arm(u, swing));
    const far = arms.filter((u) => u.depth === 'far').map((u) => arm(u, swing));
    const body: RigLayer = {
      name: 'pixel-shift body',
      member: Uint8Array.from({ length: movedBig.width * movedBig.height }, (_, p) =>
        movedBig.data[p * 4 + 3]! > ALPHA ? 1 : 0,
      ),
      source: movedBig,
      transform: IDENTITY,
    };
    return {
      motions: [...near, ...far].map((a) => a.motion),
      image: renderLayers(movedBig, [
        ...near.map((a) => a.layer),
        body,
        ...far.map((a) => a.layer),
      ]),
    };
  };
  const still = compose(false).image;
  const swung = compose(true);
  const rendered = fillHoles(swung.image, 48, still);
  let clipped = 0;
  for (let p = 0; p < rendered.width * rendered.height; p++) {
    const x = p % rendered.width;
    const y = Math.floor(p / rendered.width);
    if (opaqueAt(rendered, p) && (x < pad || x >= pad + width || y < pad || y >= pad + height))
      clipped++;
  }
  if (clipped) warnings.push(`${clipped} arm pixels past the canvas were clipped`);
  return {
    image: cropImage(rendered, pad, pad, width, height),
    shift,
    limbs: swung.motions,
    warnings,
  };
}

function padImage(image: RigImage, pad: number): RigImage {
  const width = image.width + pad * 2;
  const height = image.height + pad * 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < image.height; y++)
    data.set(
      image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
      ((y + pad) * width + pad) * 4,
    );
  return { data, width, height };
}

function padMap(map: PartMap, pad: number): PartMap {
  const width = map.width + pad * 2;
  const height = map.height + pad * 2;
  const unit = new Int16Array(width * height).fill(-1);
  const segment = new Uint8Array(width * height);
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      unit[(y + pad) * width + x + pad] = map.unit[y * map.width + x]!;
      segment[(y + pad) * width + x + pad] = map.segment[y * map.width + x]!;
    }
  const move = (p?: Point): Point | undefined => (p ? [p[0] + pad, p[1] + pad] : undefined);
  return {
    ...map,
    width,
    height,
    unit,
    segment,
    units: map.units.map((u) => ({
      ...u,
      root: move(u.root),
      joint: move(u.joint),
      tip: move(u.tip),
    })),
    shoulder: move(map.shoulder),
    hip: move(map.hip),
  };
}

function cropImage(
  image: RigImage,
  left: number,
  top: number,
  width: number,
  height: number,
): RigImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = y + top;
    if (sy < 0 || sy >= image.height) continue;
    for (let x = 0; x < width; x++) {
      const sx = x + left;
      if (sx < 0 || sx >= image.width) continue;
      data.set(
        image.data.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4),
        (y * width + x) * 4,
      );
    }
  }
  return { data, width, height };
}

// ---------------------------------------------------------------------------
// Generation entry point

/** Stored frames carry this as their prompt version; bump it whenever the
 * output would change so games recompute them. */
export const PLATFORMER_RUN_RIG_VERSION = 'platformer-run-rig-v1';
/** "upper arm" finds upper arms that "arm" leaves on the body (sleeves, fur).
 * Rewordings ("whole arm", "arm and hand", "sleeve", "thigh", "whole leg")
 * found nothing new in the lab. */
export const RUN_RIG_CONCEPTS = ['arm', 'upper arm', 'hand', 'leg', 'foot', 'head'] as const;
export const RUN_RIG_SAM_INPUT: SamInputOptions = { scale: 6, pad: 8, background: 'gray' };

export type RunRigSegment = (
  png: Buffer,
  concept: string,
) => Promise<{ masks: readonly SegmentationMaskRecord[] }>;
export type RunRigMethod = 'rigid' | 'rigid arms' | 'pixel shift';
export interface RunRigFrame {
  image: RigImage;
  method: RunRigMethod;
  /** Why a region fell back to pixel shift. */
  reasons: string[];
}
export interface RunRigResult {
  runMid1: RunRigFrame;
  runMid2: RunRigFrame;
  samCalls: number;
}

/** The two run in-betweens for a generated hero from its three run frames, on
 * the frames' shared canvas. Each frame is decided on its own: rigid limbs
 * when SAM separated both legs and a swinging arm, rigid arms over pixel shift
 * when it separated only arms, else the pixel-shift frame the device would
 * compute. All SAM calls start before any is awaited, so a durable pass
 * registers them together; any failure rejects (callers skip the frames). */
export async function buildRigRunInbetweens(
  frames: { walk1: RigImage; sideIdle: RigImage; walk2: RigImage },
  segment: RunRigSegment,
  t = RUN_INBETWEEN_T,
): Promise<RunRigResult> {
  const [walk1, idle, walk2] = alignRgbaFrames([
    frames.walk1,
    frames.sideIdle,
    frames.walk2,
  ]) as RigImage[];
  const contacts = { runMid1: walk1!, runMid2: walk2! };
  const keys = ['runMid1', 'runMid2'] as const;
  const pngs = await Promise.all(
    keys.map((key) => encodeRigImage(samInputPixels(contacts[key], RUN_RIG_SAM_INPUT))),
  );
  const calls = keys.flatMap((key, i) =>
    RUN_RIG_CONCEPTS.map((concept) => ({ key, concept, result: segment(pngs[i]!, concept) })),
  );
  const settled = await Promise.allSettled(calls.map((call) => call.result));
  const failure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) throw failure.reason;
  const pixel = buildRunInbetweens({ walk1: walk1!, sideIdle: idle!, walk2: walk2! });
  const decide = (key: (typeof keys)[number]): RunRigFrame => {
    const contact = contacts[key];
    const masks: RigMask[] = [];
    calls.forEach((call, k) => {
      if (call.key !== key) return;
      const result = (settled[k] as PromiseFulfilledResult<Awaited<ReturnType<RunRigSegment>>>)
        .value;
      result.masks.forEach((record, n) =>
        masks.push({
          concept: call.concept,
          objectId: String(record.objectId ?? n),
          coverage: maskCoverage(decodeSamMask(record), contact, RUN_RIG_SAM_INPUT),
        }),
      );
    });
    const map = assignParts(contact, masks);
    const check = checkRigFrame(contact, map);
    if (check.ok) {
      // Legs squash so the figure rises at most a third of how much taller it
      // stands in the side idle, which keeps it on the canvas.
      const riseCap = t * standingHeightGain(contact, idle!);
      const rigid = rigidLimbInbetween(contact, map, t, { riseCap });
      if (rigid.grownTop === 0) return { image: rigid.image, method: 'rigid', reasons: [] };
      return {
        image: pixel[key] as RigImage,
        method: 'pixel shift',
        reasons: ['the turned figure would leave the canvas'],
      };
    }
    if (check.arms.ok)
      return {
        image: rigidArmsInbetween(contact, map, idle!, t).image,
        method: 'rigid arms',
        reasons: check.legs.reasons,
      };
    return {
      image: pixel[key] as RigImage,
      method: 'pixel shift',
      reasons: [...check.arms.reasons, ...check.legs.reasons],
    };
  };
  return { runMid1: decide('runMid1'), runMid2: decide('runMid2'), samCalls: calls.length };
}
