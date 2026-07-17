// Procedural articulated fighter. Instead of hand-authoring ~11 multi-frame
// sprites per character, we draw a small stick-and-slab figure whose joints are
// posed per state (idle/walk/crouch/jump/punch/kick/block/hit/ko) and colored
// from the game palette. Two distinct fighters = two builds + palette slots.
// All coordinates are figure-local: origin at the feet center, +x is the way
// the fighter FACES, and up is negative — the caller passes facing so the whole
// pose mirrors when the fighters cross over.

import type { FighterBuild, FighterOutfit } from '@sparkade/shared';
import {
  FIGHTER_OUTFIT_RIGS,
  type FighterColorRole,
  type FighterOutfitRig,
} from './outfits';

/** Every pose understood by the procedural fighter renderer, in editor-friendly order. */
export const FIGHTER_POSES = [
  'idle',
  'walk',
  'crouch',
  'jump',
  'punchHigh',
  'punchLow',
  'kickHigh',
  'kickLow',
  'block',
  'hit',
  'ko',
] as const;

export type FighterPose = (typeof FIGHTER_POSES)[number];

export type FighterAvatarFaceShape = 'round' | 'square' | 'angular' | 'wide';
export type FighterAvatarHairStyle = 'bald' | 'crop' | 'swoop' | 'mohawk' | 'afro' | 'ponytail' | 'spikes';
export type FighterAvatarHairRole = 'body' | 'limb' | 'outline';
export type FighterAvatarFacialHair = 'none' | 'stubble' | 'mustache' | 'beard';
export type FighterAvatarEyeStyle = 'open' | 'narrow' | 'glasses';
export type FighterAvatarDetail = 'none' | 'scar' | 'earring' | 'paint';

/** A derived visual identity. It is never model-authored and never affects combat. */
export interface FighterAvatarHead {
  faceShape: FighterAvatarFaceShape;
  hairStyle: FighterAvatarHairStyle;
  hairRole: FighterAvatarHairRole;
  facialHair: FighterAvatarFacialHair;
  eyeStyle: FighterAvatarEyeStyle;
  detail: FighterAvatarDetail;
}

function mixHeadValue(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97) >>> 0;
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

/** Stable identity seed that stays independent of gameplay RNG and clothing. */
export function fighterIdentitySeed(
  gameSeed: number,
  rosterSlot: number,
  characterName: string,
): number {
  let hash = (gameSeed ^ Math.imul(Math.max(0, Math.trunc(rosterSlot)) + 1, 0x9e3779b1)) >>> 0;
  const key = characterName.trim().toLocaleLowerCase('en-US');
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return mixHeadValue(hash ^ 0xa511e9b3);
}

function headTrait<T>(seed: number, salt: number, values: readonly T[]): T {
  return values[mixHeadValue(seed ^ salt) % values.length]!;
}

/** Resolve a fresh, deterministic set of pixel-avatar traits for one fighter. */
export function resolveFighterAvatarHead(identitySeed: number): FighterAvatarHead {
  return {
    faceShape: headTrait(identitySeed, 0x4f1bbcdc, ['round', 'square', 'angular', 'wide'] as const),
    hairStyle: headTrait(identitySeed, 0x8d12e5a7, ['bald', 'crop', 'swoop', 'mohawk', 'afro', 'ponytail', 'spikes'] as const),
    hairRole: headTrait(identitySeed, 0xc2b2ae35, ['body', 'limb', 'outline'] as const),
    facialHair: headTrait(identitySeed, 0x27d4eb2f, ['none', 'none', 'none', 'stubble', 'mustache', 'beard'] as const),
    eyeStyle: headTrait(identitySeed, 0x165667b1, ['open', 'narrow', 'glasses'] as const),
    detail: headTrait(identitySeed, 0xd3a2646c, ['none', 'none', 'scar', 'earring', 'paint'] as const),
  };
}

export interface FighterColors {
  body: string; // gi / torso
  limb: string; // arms + legs
  skin: string; // head
  trim: string; // belt / highlight
  outline: string; // dark outline
}

/** Production size used by both gameplay and isolated figure previews. */
export function fighterScaleForBuild(build: FighterBuild): number {
  return build === 'nimble' ? 0.94 : build === 'heavy' ? 1.16 : 1.05;
}

/** Resolve a generated game's palette slot into the five renderer color roles. */
export function fighterColorsForPalette(
  palette: readonly string[],
  colorSlot: number,
): FighterColors {
  const at = (index: number): string =>
    palette[Math.max(1, Math.min(15, index))] ?? '#ffffff';
  return {
    body: at(colorSlot),
    limb: at(colorSlot - 1),
    skin: at(colorSlot >= 8 ? 10 : 7),
    trim: at(14),
    outline: at(1),
  };
}

export interface FigureOpts {
  cx: number; // feet center, screen px
  feetY: number; // feet baseline, screen px
  facing: 1 | -1; // +1 faces right
  pose: FighterPose;
  t: number; // seconds in the current pose (for wind-up animation)
  anim: number; // global time (idle bob / walk cycle)
  scale: number; // build size (~0.95 nimble .. 1.15 heavy)
  build: FighterBuild;
  outfit: FighterOutfit;
  /** Dev-preview override. Production resolves the global rig for `outfit`. */
  outfitRig?: FighterOutfitRig;
  colors: FighterColors;
  /** Deterministic fallback identity; a real player likeness takes precedence. */
  avatarHead: FighterAvatarHead;
  /** Right-facing likeness head; left-facing fighters mirror it at draw time. */
  likenessHead?: CanvasImageSource | null;
  flash?: boolean; // hit flash (draw solid white)
  /** Draw the immutable articulation skeleton over the figure in dev previews. */
  guides?: boolean;
}

interface Joints {
  hipY: number;
  shY: number; // shoulder
  headY: number;
  lean: number; // torso lean (local x offset at the shoulders)
  fHand: [number, number];
  bHand: [number, number];
  fFoot: [number, number];
  bFoot: [number, number];
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, k));
}

/** Joint targets per pose. Distances line up with the move hitboxes in game.ts. */
function poseJoints(o: FigureOpts): Joints {
  const base: Joints = {
    hipY: -17,
    shY: -32,
    headY: -40,
    lean: 0,
    fHand: [4, -22],
    bHand: [-4, -22],
    fFoot: [7, 0],
    bFoot: [-7, 0],
  };
  const bob = Math.sin(o.anim * 3) * 0.8;
  switch (o.pose) {
    case 'idle':
      base.headY += bob;
      base.shY += bob;
      base.fHand = [5, -21 + bob];
      base.bHand = [-4, -21 + bob];
      return base;
    case 'walk': {
      const s = Math.sin(o.anim * 9);
      base.fFoot = [7 + s * 5, 0];
      base.bFoot = [-7 - s * 5, 0];
      base.fHand = [5 - s * 4, -21];
      base.bHand = [-5 + s * 4, -21];
      return base;
    }
    case 'crouch':
      return { hipY: -10, shY: -20, headY: -27, lean: 1, fHand: [6, -14], bHand: [-4, -14], fFoot: [9, 0], bFoot: [-9, 0] };
    case 'jump':
      return { hipY: -19, shY: -33, headY: -41, lean: 1, fHand: [6, -30], bHand: [-5, -28], fFoot: [6, -10], bFoot: [-7, -6] };
    case 'punchHigh': {
      const ext = lerp(6, 22, o.t / 0.06); // fast startup
      base.lean = 2;
      base.fHand = [ext, -31];
      base.bHand = [-6, -22];
      return base;
    }
    case 'punchLow': {
      const ext = lerp(6, 20, o.t / 0.05);
      base.fHand = [ext, -22];
      base.bHand = [-6, -22];
      return base;
    }
    case 'kickHigh': {
      const ext = lerp(7, 24, o.t / 0.1);
      base.lean = -3;
      base.fFoot = [ext, -22];
      base.bFoot = [-8, 0];
      base.fHand = [-2, -22];
      base.bHand = [-8, -20];
      return base;
    }
    case 'kickLow': {
      const ext = lerp(7, 22, o.t / 0.08);
      base.hipY = -13;
      base.shY = -28;
      base.headY = -36;
      base.fFoot = [ext, -3];
      base.bFoot = [-8, 0];
      base.fHand = [2, -20];
      return base;
    }
    case 'block':
      return { hipY: -15, shY: -29, headY: -37, lean: -2, fHand: [7, -30], bHand: [5, -25], fFoot: [6, 0], bFoot: [-8, 0] };
    case 'hit':
      base.lean = -4;
      base.headY = -39;
      base.fHand = [-6, -20];
      base.bHand = [-9, -18];
      base.fFoot = [5, 0];
      base.bFoot = [-9, 0];
      return base;
    case 'ko':
      // collapsed on the back — drawn specially in drawFighter
      return base;
  }
}

function seg(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: number,
  color: string,
  lineCap: CanvasLineCap = 'round',
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = lineCap;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

type Project = (value: number) => number;

interface FigureGeometry {
  torso: number;
  arm: number;
  leg: number;
}

/** Width changes are visual only; joint locations and combat scale stay fixed. */
const BUILD_GEOMETRY: Record<FighterBuild, FigureGeometry> = {
  nimble: { torso: 6, arm: 3.2, leg: 4 },
  balanced: { torso: 8, arm: 4, leg: 5 },
  heavy: { torso: 11, arm: 5.2, leg: 6.5 },
};

function localRect(
  ctx: CanvasRenderingContext2D,
  X: Project,
  Y: Project,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
): void {
  const x1 = X(cx - w / 2);
  const x2 = X(cx + w / 2);
  const y1 = Y(cy - h / 2);
  const y2 = Y(cy + h / 2);
  ctx.fillStyle = color;
  ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
}

function localPoly(
  ctx: CanvasRenderingContext2D,
  X: Project,
  Y: Project,
  points: Array<readonly [number, number]>,
  color: string,
): void {
  const first = points[0];
  if (!first) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(X(first[0]), Y(first[1]));
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    ctx.lineTo(X(point[0]), Y(point[1]));
  }
  ctx.closePath();
  ctx.fill();
}

/** Draw the right-facing source head, mirroring it around its joint when needed. */
function drawLikenessHead(
  ctx: CanvasRenderingContext2D,
  o: FigureOpts,
  X: Project,
  Y: Project,
  localX: number,
  localY: number,
  rotation = 0,
): boolean {
  if (!o.likenessHead) return false;
  // Keep every head16 source pixel intact. Fighter build changes the body
  // silhouette, not the identity pixels in the player's face.
  const size = 16;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(X(localX)), Math.round(Y(localY)));
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.scale(o.facing, 1);
  if (o.flash) ctx.filter = 'brightness(0) invert(1)';
  const offset = -Math.floor(size / 2);
  ctx.drawImage(o.likenessHead, offset, offset, size, size);
  ctx.restore();
  return true;
}

type HeadPoint = readonly [number, number];

const AVATAR_FACE_OUTLINES: Record<FighterAvatarFaceShape, readonly HeadPoint[]> = {
  round: [[-4, -8], [3, -8], [6, -6], [7, -3], [7, 4], [3, 8], [-4, 8], [-7, 4], [-7, -4]],
  square: [[-5, -8], [4, -8], [7, -5], [7, 5], [4, 8], [-5, 8], [-7, 5], [-7, -5]],
  angular: [[-4, -8], [4, -8], [7, -4], [6, 4], [2, 8], [-3, 8], [-6, 4], [-7, -4]],
  wide: [[-6, -7], [4, -7], [7, -4], [7, 4], [4, 7], [-6, 7], [-8, 4], [-8, -3]],
};

const AVATAR_FACE_INNERS: Record<FighterAvatarFaceShape, readonly HeadPoint[]> = {
  round: [[-3, -7], [3, -7], [5, -5], [6, -2], [6, 3], [3, 7], [-3, 7], [-6, 3], [-6, -3]],
  square: [[-4, -7], [4, -7], [6, -4], [6, 4], [3, 7], [-4, 7], [-6, 4], [-6, -4]],
  angular: [[-3, -7], [3, -7], [6, -3], [5, 3], [2, 7], [-2, 7], [-5, 3], [-6, -3]],
  wide: [[-5, -6], [4, -6], [6, -3], [6, 3], [3, 6], [-5, 6], [-7, 3], [-7, -2]],
};

/** Draw one right-authored, palette-bound pixel avatar with optional KO rotation. */
export function drawFighterAvatarHead(
  ctx: CanvasRenderingContext2D,
  head: FighterAvatarHead,
  outfit: FighterOutfit,
  colors: FighterColors,
  x: number,
  y: number,
  facing: 1 | -1,
  rotation = 0,
): void {
  const poly = (points: readonly HeadPoint[], color: string): void => {
    const first = points[0];
    if (!first) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < points.length; i++) {
      const point = points[i]!;
      ctx.lineTo(point[0], point[1]);
    }
    ctx.closePath();
    ctx.fill();
  };
  const rect = (rx: number, ry: number, width: number, height: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(rx, ry, width, height);
  };
  const hairColor = colors[head.hairRole];

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.scale(facing, 1);

  // Large costume silhouettes sit behind the face and remain readable even
  // when hair happens to share their palette role.
  if (outfit === 'robe') {
    poly([[-8, 5], [-9, -4], [-6, -9], [4, -9], [8, -5], [8, 6], [5, 7], [5, -3], [3, -6], [-4, -6], [-6, -3], [-6, 6]], colors.outline);
    poly([[-7, 5], [-8, -3], [-5, -8], [3, -8], [7, -4], [7, 5], [5, 5], [4, -4], [2, -6], [-3, -6], [-5, -3], [-5, 5]], colors.body);
  } else if (outfit === 'armor') {
    poly([[-7, 3], [-7, -5], [-4, -9], [4, -9], [7, -5], [7, 4]], colors.outline);
    poly([[-6, 2], [-6, -5], [-3, -8], [3, -8], [6, -4], [6, 3]], colors.limb);
  }

  // Back ear and any hair mass that extends beyond the face silhouette.
  rect(-8, -1, 2, 4, colors.outline);
  rect(-7, 0, 1, 2, colors.skin);
  if (head.hairStyle === 'afro') {
    poly([[-8, 1], [-9, -5], [-7, -8], [-4, -10], [3, -10], [7, -7], [8, -2], [6, 1]], colors.outline);
    poly([[-7, 0], [-8, -5], [-6, -7], [-3, -9], [3, -9], [6, -6], [7, -2], [5, 0]], hairColor);
  } else if (head.hairStyle === 'ponytail') {
    rect(-10, -5, 4, 7, colors.outline);
    rect(-9, -4, 3, 5, hairColor);
    rect(-11, -1, 3, 4, colors.outline);
    rect(-10, 0, 2, 2, hairColor);
  }

  poly(AVATAR_FACE_OUTLINES[head.faceShape], colors.outline);
  poly(AVATAR_FACE_INNERS[head.faceShape], colors.skin);
  poly([[5, -2], [8, 0], [5, 2]], colors.outline);
  poly([[5, -1], [7, 0], [5, 1]], colors.skin);

  const crop = (): void => {
    poly([[-7, -4], [-6, -7], [-3, -9], [4, -9], [7, -6], [6, -3], [2, -4], [-3, -3]], colors.outline);
    poly([[-6, -4], [-5, -7], [-2, -8], [3, -8], [6, -6], [5, -4], [2, -5], [-3, -4]], hairColor);
  };
  switch (head.hairStyle) {
    case 'bald':
      rect(-2, -7, 4, 1, colors.trim);
      break;
    case 'crop':
      crop();
      break;
    case 'swoop':
      poly([[-7, -3], [-6, -7], [-3, -9], [4, -9], [7, -6], [5, -3], [2, -1], [0, -5], [-4, -3]], colors.outline);
      poly([[-6, -4], [-5, -7], [-2, -8], [3, -8], [6, -6], [4, -4], [2, -2], [0, -6], [-4, -4]], hairColor);
      break;
    case 'mohawk':
      poly([[-5, -5], [-3, -8], [-2, -10], [0, -8], [2, -10], [4, -8], [6, -5], [4, -3], [-4, -3]], colors.outline);
      poly([[-4, -5], [-2, -7], [-1, -9], [0, -7], [2, -9], [3, -7], [5, -5], [3, -4], [-3, -4]], hairColor);
      break;
    case 'afro':
      rect(-6, -5, 12, 3, hairColor);
      break;
    case 'ponytail':
      crop();
      break;
    case 'spikes':
      poly([[-7, -3], [-6, -7], [-4, -6], [-3, -10], [0, -7], [2, -10], [4, -7], [7, -7], [6, -3]], colors.outline);
      poly([[-6, -4], [-5, -6], [-4, -5], [-3, -8], [0, -6], [2, -8], [3, -6], [6, -6], [5, -4]], hairColor);
      break;
  }

  switch (outfit) {
    case 'gi':
      rect(-8, -5, 15, 3, colors.outline);
      rect(-8, -4, 15, 1, colors.trim);
      rect(-10, -3, 3, 2, colors.trim);
      break;
    case 'boxer':
      poly([[-7, 3], [-8, -4], [-5, -8], [2, -9], [6, -6], [5, -4], [1, -6], [-4, -5], [-5, 3]], colors.outline);
      rect(-6, -3, 2, 7, colors.trim);
      rect(-3, -8, 5, 2, colors.trim);
      break;
    case 'wrestler':
      rect(-6, -3, 12, 4, colors.outline);
      rect(-5, -2, 10, 2, colors.body);
      rect(-3, 4, 8, 2, colors.body);
      break;
    case 'street':
      poly([[-7, -5], [-5, -9], [4, -9], [7, -6], [6, -4], [-6, -4]], colors.outline);
      poly([[-6, -5], [-4, -8], [3, -8], [6, -6], [5, -5]], colors.body);
      rect(4, -5, 5, 2, colors.outline);
      break;
    case 'robe':
      rect(-7, -5, 2, 11, colors.body);
      rect(5, -5, 2, 11, colors.body);
      rect(-4, -8, 8, 2, colors.body);
      break;
    case 'armor':
      rect(-6, -7, 12, 4, colors.limb);
      rect(-6, -4, 13, 2, colors.outline);
      break;
  }

  switch (head.eyeStyle) {
    case 'open':
      rect(1, -2, 4, 3, colors.outline);
      rect(2, -1, 2, 1, colors.trim);
      break;
    case 'narrow':
      rect(1, -1, 4, 1, colors.outline);
      rect(4, -2, 1, 1, colors.trim);
      break;
    case 'glasses':
      rect(0, -3, 6, 4, colors.outline);
      rect(1, -2, 2, 2, colors.trim);
      rect(4, -2, 1, 2, colors.trim);
      break;
  }

  switch (head.detail) {
    case 'scar':
      rect(4, -4, 1, 3, colors.trim);
      rect(3, -2, 1, 1, colors.trim);
      break;
    case 'earring':
      rect(-8, 3, 2, 2, colors.trim);
      break;
    case 'paint':
      rect(1, 1, 5, 1, colors.body);
      break;
    case 'none':
      break;
  }

  switch (head.facialHair) {
    case 'stubble':
      rect(1, 4, 1, 1, hairColor);
      rect(3, 5, 1, 1, hairColor);
      rect(5, 3, 1, 1, hairColor);
      break;
    case 'mustache':
      rect(2, 2, 4, 1, colors.outline);
      rect(4, 3, 2, 1, hairColor);
      break;
    case 'beard':
      poly([[0, 3], [6, 2], [6, 5], [3, 8], [-2, 7], [-3, 5]], colors.outline);
      poly([[1, 4], [5, 3], [5, 5], [2, 7], [-1, 6], [-2, 5]], hairColor);
      break;
    case 'none':
      rect(3, 3, 2, 1, colors.outline);
      break;
  }

  ctx.restore();
}

function drawProceduralHead(
  ctx: CanvasRenderingContext2D,
  o: FigureOpts,
  X: Project,
  Y: Project,
  localX: number,
  localY: number,
  col: FighterColors,
  rotation = 0,
): void {
  drawFighterAvatarHead(
    ctx,
    o.avatarHead,
    o.outfit,
    col,
    X(localX),
    Y(localY),
    o.facing,
    rotation,
  );
}

type Point = readonly [number, number];
type FootDepth = 'front' | 'back';

function roleColor(colors: FighterColors, role: FighterColorRole): string {
  return colors[role];
}

function pointAlong(from: Point, to: Point, amount: number): [number, number] {
  return [lerp(from[0], to[0], amount), lerp(from[1], to[1], amount)];
}

function legEndAboveFootwear(
  hip: Point,
  foot: Point,
  legWidth: number,
  rig: FighterOutfitRig,
): [number, number] {
  if (rig.feet.shape === 'none') return [foot[0], foot[1]];
  const dx = hip[0] - foot[0];
  const dy = hip[1] - foot[1];
  const legLength = Math.hypot(dx, dy);
  if (legLength <= 0) return [foot[0], foot[1]];

  // Foot profiles are axis-aligned and occupy the space above the sole anchor,
  // so recess the visual leg in that same coordinate system. Insetting along
  // the articulated leg vector would still put a round cap below raised kicks.
  // The original endpoint remains unchanged for poses, guides and combat.
  const coverHeight = Math.max(legWidth / 2 + 0.25, rig.feet.height);
  return [foot[0], foot[1] - coverHeight];
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  X: Project,
  Y: Project,
  shoulder: Point,
  hand: Point,
  armWidth: number,
  rig: FighterOutfitRig,
  colors: FighterColors,
  scale: number,
): void {
  seg(
    ctx,
    X(shoulder[0]),
    Y(shoulder[1]),
    X(hand[0]),
    Y(hand[1]),
    armWidth * scale,
    roleColor(colors, rig.arms.baseColor),
  );
  if (rig.arms.sleeveLength <= 0) return;
  const sleeveEnd = pointAlong(shoulder, hand, rig.arms.sleeveLength);
  seg(
    ctx,
    X(shoulder[0]),
    Y(shoulder[1]),
    X(sleeveEnd[0]),
    Y(sleeveEnd[1]),
    (armWidth + rig.arms.sleeveWidthAdd) * scale,
    roleColor(colors, rig.arms.sleeveColor),
  );
}

function drawCuff(
  ctx: CanvasRenderingContext2D,
  X: Project,
  Y: Project,
  shoulder: Point,
  hand: Point,
  armWidth: number,
  rig: FighterOutfitRig,
  colors: FighterColors,
  scale: number,
): void {
  if (rig.hands.cuffLength <= 0) return;
  const distance = Math.hypot(hand[0] - shoulder[0], hand[1] - shoulder[1]);
  if (distance <= 0) return;
  const start = pointAlong(hand, shoulder, Math.min(1, rig.hands.cuffLength / distance));
  seg(
    ctx,
    X(start[0]),
    Y(start[1]),
    X(hand[0]),
    Y(hand[1]),
    (armWidth + 1) * scale,
    roleColor(colors, rig.hands.color),
  );
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  X: Project,
  Y: Project,
  hand: Point,
  rig: FighterOutfitRig,
  colors: FighterColors,
  scale: number,
): void {
  const radius = rig.hands.radius;
  const color = roleColor(colors, rig.hands.color);
  if (rig.hands.shape === 'square') {
    localRect(ctx, X, Y, hand[0], hand[1], radius * 2, radius * 2, color);
    return;
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(X(hand[0]), Y(hand[1]), radius * scale, 0, Math.PI * 2);
  ctx.fill();
  if (rig.hands.shape === 'mitten') {
    ctx.beginPath();
    ctx.arc(
      X(hand[0] + radius * 0.65),
      Y(hand[1] + radius * 0.35),
      radius * 0.52 * scale,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawFoot(
  ctx: CanvasRenderingContext2D,
  X: Project,
  Y: Project,
  hip: Point,
  foot: Point,
  legWidth: number,
  rig: FighterOutfitRig,
  colors: FighterColors,
  scale: number,
  depth: FootDepth,
): void {
  if (rig.feet.shape === 'none') return;
  const color = roleColor(colors, rig.feet.color);
  const detailColor = color === colors.outline ? colors.trim : colors.outline;
  // Keep enough material behind the ankle to cover the lower-leg join. The
  // old 0.32 ratio left more than a pixel of a round leg cap exposed on a
  // balanced build and made the whole foot read as shifted forward.
  const heel = Math.max(1.4, legWidth / 2 + 0.25);
  const fullToe = Math.max(3, legWidth * 0.55) + rig.feet.lengthAdd;
  // The rear foot is farther from camera, so retain its forward direction but
  // foreshorten its toe. This keeps the stance legible without moving joints.
  const toe = depth === 'back'
    ? heel + (fullToe - heel) * 0.28
    : fullToe;

  if (rig.feet.shape === 'boot' && rig.feet.bootLength > 0) {
    const bootTop = pointAlong(foot, hip, rig.feet.bootLength);
    const shaftWidth = Math.max(2, legWidth - 0.6);
    seg(
      ctx,
      X(foot[0]),
      Y(foot[1]),
      X(bootTop[0]),
      Y(bootTop[1]),
      shaftWidth * scale,
      color,
      'butt',
    );

    // A narrow cuff keeps same-color boots from melting into the trouser leg.
    const legDx = foot[0] - bootTop[0];
    const legDy = foot[1] - bootTop[1];
    const legLength = Math.hypot(legDx, legDy) || 1;
    const normalX = -legDy / legLength;
    const normalY = legDx / legLength;
    const cuffHalf = shaftWidth * 0.55;
    seg(
      ctx,
      X(bootTop[0] - normalX * cuffHalf),
      Y(bootTop[1] - normalY * cuffHalf),
      X(bootTop[0] + normalX * cuffHalf),
      Y(bootTop[1] + normalY * cuffHalf),
      Math.max(0.75, scale),
      detailColor,
    );
  }

  // Paint a centered ankle/collar over the leg termination before adding the
  // foot profile. This makes Upper height genuinely own the lower-leg overlap
  // and prevents a wide limb cap from peeking around a narrow shoe vertex.
  const visualLegEnd = legEndAboveFootwear(hip, foot, legWidth, rig);
  const collarTopY = visualLegEnd[1] - 0.25;
  const collarBottomY = foot[1] - Math.max(0.55, Math.min(1.25, rig.feet.height * 0.5));
  const collarTopHalf = legWidth / 2 + 0.2;
  const collarBottomHalf = Math.max(1.1, legWidth * 0.34);
  localPoly(
    ctx,
    X,
    Y,
    [
      [foot[0] - collarTopHalf, collarTopY],
      [foot[0] + collarTopHalf, collarTopY],
      [foot[0] + collarBottomHalf, collarBottomY],
      [foot[0] - collarBottomHalf, collarBottomY],
    ],
    color,
  );

  // Figure-local +x is always the direction the fighter faces; X() performs
  // the left-facing mirror. Both shoes therefore point forward instead of
  // making the rear foot point away from the body.
  const heelX = foot[0] - heel;
  const toeX = foot[0] + toe;
  if (rig.feet.shape === 'bare') {
    localPoly(
      ctx,
      X,
      Y,
      [
        [foot[0] - heel, foot[1]],
        [toeX, foot[1]],
        [toeX - 0.2, foot[1] - rig.feet.height * 0.28],
        [foot[0] + toe * 0.52, foot[1] - rig.feet.height * 0.52],
        [foot[0], foot[1] - rig.feet.height],
        [foot[0] - heel * 0.92, foot[1] - rig.feet.height * 0.5],
      ],
      color,
    );
    return;
  }

  const soleHeight = Math.min(0.8, rig.feet.height * 0.32);
  const upperBottomY = foot[1] - soleHeight;
  localPoly(
    ctx,
    X,
    Y,
    [
      [heelX, upperBottomY],
      [toeX, upperBottomY],
      [toeX - 0.15, foot[1] - Math.max(soleHeight + 0.45, rig.feet.height * 0.42)],
      [foot[0] + toe * 0.38, foot[1] - rig.feet.height * 0.78],
      [foot[0] - legWidth * 0.08, foot[1] - rig.feet.height],
      [foot[0] - heel * 0.92, foot[1] - rig.feet.height * 0.58],
    ],
    color,
  );
  localPoly(
    ctx,
    X,
    Y,
    [
      [heelX - 0.1, upperBottomY],
      [toeX, upperBottomY],
      [toeX - 0.15, foot[1]],
      [heelX, foot[1]],
    ],
    detailColor,
  );
}

function drawTorso(
  ctx: CanvasRenderingContext2D,
  X: Project,
  Y: Project,
  hip: Point,
  shoulder: Point,
  torsoWidth: number,
  rig: FighterOutfitRig,
  colors: FighterColors,
): number {
  const shoulderHalf = torsoWidth / 2 + rig.torso.shoulderAdd;
  const hipHalf = torsoWidth / 2;
  const hemY = Math.min(-2, hip[1] + rig.torso.hemDrop);
  localPoly(
    ctx,
    X,
    Y,
    [
      [shoulder[0] - shoulderHalf, shoulder[1]],
      [shoulder[0] + shoulderHalf, shoulder[1]],
      [hip[0] + hipHalf, hemY],
      [hip[0] - hipHalf, hemY],
    ],
    colors.body,
  );
  return hemY;
}

function drawTorsoDetail(
  ctx: CanvasRenderingContext2D,
  X: Project,
  Y: Project,
  hip: Point,
  shoulder: Point,
  torsoWidth: number,
  hemY: number,
  rig: FighterOutfitRig,
  colors: FighterColors,
  scale: number,
): void {
  const detail = rig.torso.detail;
  if (detail === 'none') return;
  const weight = rig.torso.detailWeight;
  const shoulderWidth = torsoWidth + rig.torso.shoulderAdd * 2;
  const torsoMidX = (hip[0] + shoulder[0]) / 2;
  const torsoMidY = (hip[1] + shoulder[1]) / 2;

  switch (detail) {
    case 'gi':
      localRect(ctx, X, Y, hip[0], hip[1], torsoWidth + 1, 2 * weight, colors.trim);
      seg(ctx, X(shoulder[0] - 2), Y(shoulder[1] + 2), X(torsoMidX), Y(torsoMidY), 1.2 * weight * scale, colors.trim);
      seg(ctx, X(shoulder[0] + 2), Y(shoulder[1] + 2), X(torsoMidX), Y(torsoMidY), 1.2 * weight * scale, colors.trim);
      break;
    case 'boxer': {
      const shortsTop = hip[1] - 1.5;
      const shortsHeight = Math.max(1, hemY - shortsTop);
      localRect(ctx, X, Y, hip[0], shortsTop + shortsHeight / 2, shoulderWidth, shortsHeight, colors.limb);
      localRect(ctx, X, Y, hip[0], shortsTop, shoulderWidth, 2 * weight, colors.trim);
      break;
    }
    case 'wrestler': {
      seg(ctx, X(shoulder[0]), Y(shoulder[1] + 1), X(hip[0]), Y(hip[1]), Math.max(2, torsoWidth * 0.38) * weight * scale, colors.trim);
      const panelTop = hip[1] - 1;
      localRect(ctx, X, Y, hip[0], (panelTop + hemY) / 2, torsoWidth + 2, Math.max(1, hemY - panelTop), colors.body);
      break;
    }
    case 'street':
      localRect(ctx, X, Y, shoulder[0], shoulder[1] + 2, shoulderWidth, 4 * weight, colors.body);
      localRect(ctx, X, Y, torsoMidX, torsoMidY, 2 * weight, Math.max(1, Math.abs(shoulder[1] - hip[1]) - 2), colors.trim);
      localRect(ctx, X, Y, hip[0], hip[1], torsoWidth + 2, 1.5 * weight, colors.outline);
      break;
    case 'robe': {
      const flareTop = hip[1] - 1;
      localPoly(
        ctx,
        X,
        Y,
        [
          [hip[0] - torsoWidth * 0.42, flareTop],
          [hip[0] + torsoWidth * 0.42, flareTop],
          [hip[0] + torsoWidth * 0.72, hemY],
          [hip[0] - torsoWidth * 0.72, hemY],
        ],
        colors.body,
      );
      localRect(ctx, X, Y, hip[0], flareTop, torsoWidth + 2, 2.5 * weight, colors.trim);
      localRect(ctx, X, Y, hip[0], hemY, torsoWidth * 1.45, 1.5 * weight, colors.trim);
      break;
    }
    case 'armor': {
      localRect(ctx, X, Y, torsoMidX, torsoMidY, torsoWidth + 2, Math.max(1, Math.abs(shoulder[1] - hip[1]) - 4), colors.limb);
      localRect(ctx, X, Y, torsoMidX, torsoMidY, torsoWidth * 0.48, 5 * weight, colors.trim);
      const padWidth = Math.max(2, 4 * weight);
      const padOffset = torsoWidth / 2 + rig.torso.shoulderAdd * 0.55;
      localRect(ctx, X, Y, shoulder[0] - padOffset, shoulder[1] + 1, padWidth, 4 * weight, colors.body);
      localRect(ctx, X, Y, shoulder[0] + padOffset, shoulder[1] + 1, padWidth, 4 * weight, colors.body);
      localRect(ctx, X, Y, hip[0], hip[1], torsoWidth + 1, 2 * weight, colors.outline);
      break;
    }
  }
}

function drawKneeAccent(
  ctx: CanvasRenderingContext2D,
  X: Project,
  Y: Project,
  hip: Point,
  foot: Point,
  legWidth: number,
  rig: FighterOutfitRig,
  colors: FighterColors,
): void {
  if (rig.legs.accent !== 'kneePads') return;
  const knee = pointAlong(hip, foot, 0.58);
  localRect(ctx, X, Y, knee[0], knee[1], legWidth + 2, 3, colors.trim);
}

function drawSkeletonGuides(
  ctx: CanvasRenderingContext2D,
  X: Project,
  Y: Project,
  joints: Joints,
  scale: number,
): void {
  const hip: Point = [0, joints.hipY];
  const shoulder: Point = [joints.lean, joints.shY];
  const guide = '#00e5ff';
  const secondary = '#ff4fd8';
  seg(ctx, X(hip[0]), Y(hip[1]), X(shoulder[0]), Y(shoulder[1]), 1, guide);
  seg(ctx, X(hip[0]), Y(hip[1]), X(joints.bFoot[0]), Y(joints.bFoot[1]), 1, guide);
  seg(ctx, X(hip[0]), Y(hip[1]), X(joints.fFoot[0]), Y(joints.fFoot[1]), 1, guide);
  seg(ctx, X(shoulder[0]), Y(shoulder[1]), X(joints.bHand[0]), Y(joints.bHand[1]), 1, guide);
  seg(ctx, X(shoulder[0]), Y(shoulder[1]), X(joints.fHand[0]), Y(joints.fHand[1]), 1, guide);
  seg(ctx, X(shoulder[0]), Y(shoulder[1]), X(joints.lean * 0.6), Y(joints.headY), 1, secondary);
  for (const point of [hip, shoulder, joints.bFoot, joints.fFoot, joints.bHand, joints.fHand] as const) {
    ctx.fillStyle = secondary;
    ctx.beginPath();
    ctx.arc(X(point[0]), Y(point[1]), 1.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = secondary;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(X(joints.lean * 0.6), Y(joints.headY), 7 * scale, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawFighter(ctx: CanvasRenderingContext2D, o: FigureOpts): void {
  const s = o.scale;
  const f = o.facing;
  const X = (lx: number): number => o.cx + f * lx * s;
  const Y = (ly: number): number => o.feetY + ly * s;
  const geometry = BUILD_GEOMETRY[o.build];
  const rig = o.outfitRig ?? FIGHTER_OUTFIT_RIGS[o.outfit];
  const col = o.flash
    ? { body: '#ffffff', limb: '#ffffff', skin: '#ffffff', trim: '#ffffff', outline: '#ffffff' }
    : o.colors;

  const armWidth = geometry.arm + rig.arms.widthAdd;
  const legWidth = geometry.leg + rig.legs.widthAdd;
  const torsoWidth = geometry.torso + rig.torso.widthAdd;
  const legColor = roleColor(col, rig.legs.color);

  if (o.pose === 'ko') {
    // lying on the back, head toward -facing
    const y = Y(-4);
    const legStart: Point = [9, -4];
    const foot: Point = [20, -2];
    const legEnd = legEndAboveFootwear(legStart, foot, legWidth, rig);
    seg(ctx, X(-13), y, X(9), y, (torsoWidth + rig.torso.shoulderAdd) * s, col.body);
    seg(
      ctx,
      X(legStart[0]),
      Y(legStart[1]),
      X(legEnd[0]),
      Y(legEnd[1]),
      legWidth * s,
      legColor,
      rig.feet.shape === 'none' ? 'round' : 'butt',
    );
    drawFoot(ctx, X, Y, legStart, foot, legWidth, rig, col, s, 'front');
    if (rig.torso.detail === 'robe') seg(ctx, X(-2), y, X(13), y, (torsoWidth + 4) * s, col.body);
    if (rig.torso.detail === 'armor') localRect(ctx, X, Y, -1, -4, 10, torsoWidth, col.trim);
    if (!drawLikenessHead(ctx, o, X, Y, -17, -4, -f * Math.PI * 0.5)) {
      drawProceduralHead(ctx, o, X, Y, -17, -4, col, -f * Math.PI * 0.5);
    }
    if (o.guides) {
      seg(ctx, X(-13), y, X(legStart[0]), Y(legStart[1]), 1, '#00e5ff');
      seg(ctx, X(legStart[0]), Y(legStart[1]), X(foot[0]), Y(foot[1]), 1, '#00e5ff');
    }
    return;
  }

  const j = poseJoints(o);
  const hip: [number, number] = [0, j.hipY];
  const sh: [number, number] = [j.lean, j.shY];
  const backLegEnd = legEndAboveFootwear(hip, j.bFoot, legWidth, rig);
  const frontLegEnd = legEndAboveFootwear(hip, j.fFoot, legWidth, rig);

  // back limbs first (behind the torso)
  seg(
    ctx,
    X(hip[0]),
    Y(hip[1]),
    X(backLegEnd[0]),
    Y(backLegEnd[1]),
    legWidth * s,
    legColor,
    rig.feet.shape === 'none' ? 'round' : 'butt',
  );
  drawFoot(ctx, X, Y, hip, j.bFoot, legWidth, rig, col, s, 'back');
  drawArm(ctx, X, Y, sh, j.bHand, armWidth, rig, col, s);
  drawCuff(ctx, X, Y, sh, j.bHand, armWidth, rig, col, s);
  drawHand(ctx, X, Y, j.bHand, rig, col, s);

  // The forward leg remains articulated by the same joint targets, but drawing
  // it before the clothing lets shorts, jackets and robes own their silhouette.
  seg(
    ctx,
    X(hip[0]),
    Y(hip[1]),
    X(frontLegEnd[0]),
    Y(frontLegEnd[1]),
    legWidth * s,
    legColor,
    rig.feet.shape === 'none' ? 'round' : 'butt',
  );
  drawFoot(ctx, X, Y, hip, j.fFoot, legWidth, rig, col, s, 'front');

  // Torso and outfit-specific structure. All additions stay close to the same
  // skeleton, so combat reach and hurtboxes remain owned entirely by game.ts.
  const hemY = drawTorso(ctx, X, Y, hip, sh, torsoWidth, rig, col);
  drawTorsoDetail(ctx, X, Y, hip, sh, torsoWidth, hemY, rig, col, s);

  drawKneeAccent(ctx, X, Y, hip, j.bFoot, legWidth, rig, col);
  drawKneeAccent(ctx, X, Y, hip, j.fFoot, legWidth, rig, col);

  // head
  const headX = j.lean * 0.6;
  if (!drawLikenessHead(ctx, o, X, Y, headX, j.headY)) {
    drawProceduralHead(ctx, o, X, Y, headX, j.headY, col);
  }

  // Front arm over the torso/head, preserving strike readability.
  drawArm(ctx, X, Y, sh, j.fHand, armWidth, rig, col, s);
  drawCuff(ctx, X, Y, sh, j.fHand, armWidth, rig, col, s);
  drawHand(ctx, X, Y, j.fHand, rig, col, s);

  if (o.guides) drawSkeletonGuides(ctx, X, Y, j, s);
}
