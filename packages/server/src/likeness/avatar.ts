// Feature-driven likeness avatar: instead of quantizing the webcam photo, DRAW a
// clean pixel-art face from the traits the vision model detects (FaceFeatures).
// The model reports not just colours + accessories but PROPORTIONS (face shape,
// chin, nose size, eye spacing/shape, brow thickness/shape, ears), so the drawn
// character varies in structure per person — not just a recolour. Same output
// shape as bakeLikeness so it drops into the pipeline as an alternative.
import sharp from 'sharp';
import { HEAD_SPRITE_SIZES, PORTRAIT_SIZE } from '@sparkade/shared';
import type {
  ChinShape,
  FaceFeatures,
  FaceShape,
  HairRegion,
  NormalizedFaceFeatures,
} from './features';
import { normalizeFaceFeatures } from './features';
import type { LikenessArtifacts } from './likeness';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export type AvatarView = 'front' | 'side' | 'back';

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function hexToRgb(hex: string): Rgb {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}
function normHex(hex: string | undefined, fallback: string): string {
  let h = (hex ?? '').trim();
  if (h && h[0] !== '#') h = '#' + h;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) h = '#' + h[1]! + h[1]! + h[2]! + h[2]! + h[3]! + h[3]!;
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : fallback;
}
function shade(c: Rgb, f: number): Rgb {
  return { r: clampByte(c.r * f), g: clampByte(c.g * f), b: clampByte(c.b * f) };
}
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: clampByte(a.r + (b.r - a.r) * t), g: clampByte(a.g + (b.g - a.g) * t), b: clampByte(a.b + (b.b - a.b) * t) };
}
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
}

// -------------------------------------------------------------- colours ------
interface Colors {
  outline: Rgb;
  skin: Rgb;
  skinLight: Rgb;
  skinShadow: Rgb;
  bald: boolean;
  hair: Rgb;
  hairShadow: Rgb;
  hairLight: Rgb;
  beard: Rgb | null;
  hasHat: boolean;
  hat: Rgb;
  hatShadow: Rgb;
  hatLight: Rgb;
  hatOutline: Rgb;
  brow: Rgb;
  eyeWhite: Rgb;
  eyeDark: Rgb;
  lip: Rgb;
  glass: Rgb | null;
}
function resolveColors(feat: NormalizedFaceFeatures): Colors {
  const skin = hexToRgb(normHex(feat.skinTone, '#c98f6b'));
  const bald =
    feat.hairStyle === 'bald' ||
    (feat.hairStyle !== 'hidden' && (feat.hairColor ?? '').trim().toLowerCase() === 'none');
  const hair = bald ? shade(skin, 0.55) : hexToRgb(normHex(feat.hairColor, '#2a2320'));
  const hasHat = !!feat.headwear && (feat.headwearColor ?? '').trim().toLowerCase() !== 'none';
  const hat = hasHat ? hexToRgb(normHex(feat.headwearColor, '#3a4a63')) : hair;
  const hatLuma = hat.r * 0.2126 + hat.g * 0.7152 + hat.b * 0.0722;
  // Multiplication produces almost no visible separation around a black cap.
  // Give very dark materials a small perceptual ramp so crown panels and the
  // underside of a bill survive against the cabinet's near-black background.
  const hatShadow = hatLuma < 48 ? mix(hat, { r: 0, g: 0, b: 0 }, 0.45) : shade(hat, 0.74);
  const hatLight = hatLuma < 48 ? mix(hat, { r: 255, g: 255, b: 255 }, 0.14) : mix(hat, { r: 255, g: 255, b: 255 }, 0.16);
  const hatOutline = hatLuma < 48 ? mix(hat, { r: 104, g: 110, b: 132 }, 0.24) : shade(hatShadow, 0.62);
  const noBeard = (feat.facialHair ?? 'none') === 'none' || (feat.facialHairColor ?? '').trim().toLowerCase() === 'none';
  const beard = noBeard ? null : hexToRgb(normHex(feat.facialHairColor, bald ? '#4a3a2e' : normHex(feat.hairColor, '#2a2320')));
  const browBase = feat.hairStyle === 'hidden' ? (beard ?? shade(skin, 0.52)) : hair;
  return {
    outline: shade(skin, 0.32),
    skin,
    skinLight: shade(skin, 1.07),
    skinShadow: shade(skin, 0.82),
    bald,
    hair,
    hairShadow: shade(hair, 0.7),
    hairLight: shade(hair, 1.2),
    beard,
    hasHat,
    hat,
    hatShadow,
    hatLight,
    hatOutline,
    brow: bald ? shade(skin, 0.5) : shade(browBase, 0.85),
    eyeWhite: { r: 238, g: 236, b: 230 },
    eyeDark: { r: 30, g: 28, b: 40 },
    lip: mix(skin, { r: 156, g: 52, b: 80 }, 0.5),
    glass: feat.glasses ? hexToRgb(normHex(feat.glassesColor, '#20202a')) : null,
  };
}

// ------------------------------------------------------------- geometry ------
// Face silhouette as anchored half-widths (fraction of rx) down the face, so the
// outline varies by faceShape + chin instead of being a fixed ellipse.
const SHAPE_RX: Record<FaceShape, number> = { round: 0.43, oval: 0.4, square: 0.43, long: 0.37, heart: 0.43 };
const SHAPE_RY: Record<FaceShape, number> = { round: 0.45, oval: 0.48, square: 0.47, long: 0.52, heart: 0.48 };
// [crown, forehead, temple, cheekbone, jaw, chin] as fractions of rx
const SHAPE_ANCHORS: Record<FaceShape, number[]> = {
  round: [0.34, 0.8, 0.95, 1.0, 0.9, 0.58],
  oval: [0.3, 0.74, 0.9, 1.0, 0.8, 0.44],
  square: [0.4, 0.86, 0.97, 1.0, 0.96, 0.8],
  long: [0.3, 0.72, 0.88, 0.97, 0.78, 0.44],
  heart: [0.42, 0.9, 1.0, 0.98, 0.7, 0.34],
};
const ANCHOR_T = [0.0, 0.16, 0.34, 0.48, 0.72, 1.0];

function anchorsFor(faceShape: FaceShape, chin: ChinShape): number[] {
  const a = [...SHAPE_ANCHORS[faceShape]];
  const jawMul = chin === 'wide' ? 1.06 : chin === 'square' ? 1.05 : chin === 'pointed' ? 0.94 : 1;
  const chinMul = chin === 'wide' ? 1.4 : chin === 'square' ? 1.35 : chin === 'pointed' ? 0.66 : 1;
  a[4] = Math.min(1.02, a[4]! * jawMul);
  a[5] = Math.min(1.0, a[5]! * chinMul);
  return a;
}

/** One pixel avatar for a given size. `detailAt` is the size at/above which the
 *  fine features (brows, nose, structured facial hair) turn on — 32 by default
 *  (they need the portrait), but the Likeness Lab lowers it to preview bigger
 *  in-game heads. */
function drawAvatar(feat: NormalizedFaceFeatures, size: number, detailAt = 32): Buffer {
  const C = resolveColors(feat);
  const detail = size >= detailAt;
  const native = size <= 20;
  const portraitMix = smoothstep(20, 64, size);

  const faceShape = feat.faceShape ?? 'oval';
  const chin = feat.chin ?? 'round';
  const anchors = anchorsFor(faceShape, chin);
  const cx = (size - 1) / 2;
  const cy = size * 0.52;
  // Leave a real transparent margin for native ears. Previously the face
  // itself reached x=1/14 at 16px, forcing ears onto the canvas edge.
  const rx = SHAPE_RX[faceShape] * size * (0.92 + portraitMix * 0.08);
  const ry = SHAPE_RY[faceShape] * size;

  // half-width of the face at row y, interpolated between the shape anchors
  const halfW = (y: number): number => {
    const t = (y - (cy - ry)) / (2 * ry);
    if (t < 0 || t > 1) return 0;
    let i = 0;
    while (i < ANCHOR_T.length - 2 && t > ANCHOR_T[i + 1]!) i++;
    const u = smoothstep(ANCHOR_T[i]!, ANCHOR_T[i + 1]!, t);
    return rx * (anchors[i]! + (anchors[i + 1]! - anchors[i]!) * u);
  };
  const inFace = (x: number, y: number): boolean => Math.abs(x - cx) <= halfW(y) && y >= cy - ry && y <= cy + ry;

  const buf = Buffer.alloc(size * size * 4);
  const hatMaterial = Buffer.alloc(size * size);
  const earMaterial = Buffer.alloc(size * size);
  const set = (x: number, y: number, c: Rgb, isHat = false): void => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return;
    const i = (yi * size + xi) * 4;
    buf[i] = c.r;
    buf[i + 1] = c.g;
    buf[i + 2] = c.b;
    buf[i + 3] = 255;
    hatMaterial[yi * size + xi] = isHat ? 1 : 0;
  };
  const get = (x: number, y: number): Rgb | null => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return null;
    const i = (yi * size + xi) * 4;
    if (buf[i + 3] !== 255) return null;
    return { r: buf[i]!, g: buf[i + 1]!, b: buf[i + 2]! };
  };
  const fillDisc = (dcx: number, dcy: number, drx: number, dry: number, c: Rgb, faceOnly = false, isEar = false): void => {
    for (let y = Math.floor(dcy - dry); y <= Math.ceil(dcy + dry); y++) {
      for (let x = Math.floor(dcx - drx); x <= Math.ceil(dcx + drx); x++) {
        const ex = (x - dcx) / drx;
        const ey = (y - dcy) / dry;
        if (ex * ex + ey * ey <= 1 && (!faceOnly || inFace(x, y))) {
          set(x, y, c);
          if (isEar && x >= 0 && y >= 0 && x < size && y < size) {
            earMaterial[Math.round(y) * size + Math.round(x)] = 1;
          }
        }
      }
    }
  };

  // --- ears (behind the face) -----------------------------------------------
  const ears = feat.ears ?? 'average';
  if (ears !== 'hidden' && detail) {
    const earY = cy + ry * 0.02;
    if (native) {
      // Hand-authored native grammar: small/average ears are one column and
      // prominent ears get one extra inner pixel. Fractional discs used to
      // quantize into 3x4 dark blobs that looked like sideburns.
      const y = Math.round(earY);
      for (const dir of [-1, 1]) {
        const x = Math.max(1, Math.min(size - 2, Math.round(cx + dir * (halfW(earY) + 0.9))));
        const points =
          ears === 'small'
            ? [[x, y]]
            : ears === 'prominent'
              ? [[x, y - 1], [x, y], [x, y + 1], [x - dir, y]]
              : [[x, y], [x, y + 1]];
        for (const [px, py] of points) {
          set(px!, py!, py === y ? C.skin : C.skinShadow);
          earMaterial[py! * size + px!] = 1;
        }
      }
    } else {
      const earScale = ears === 'prominent' ? 1.2 : ears === 'small' ? 0.68 : 0.9;
      const earR = size * 0.075 * earScale;
      for (const dir of [-1, 1]) {
        const ex = cx + dir * (halfW(earY) + earR * 0.3);
        fillDisc(ex, earY, earR * 0.58, earR, C.skin, false, true);
        fillDisc(ex + dir * earR * 0.05, earY, earR * 0.25, earR * 0.54, C.skinShadow, false, true);
      }
    }
  }

  // --- skin base with soft vertical shading ---------------------------------
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const hw = halfW(y);
    for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      if (Math.abs(x - cx) > hw) continue;
      const t = (y - (cy - ry)) / (2 * ry);
      let c = t < 0.32 ? mix(C.skinLight, C.skin, t / 0.32) : t < 0.68 ? C.skin : mix(C.skin, C.skinShadow, (t - 0.68) / 0.32);
      if (Math.abs(x - cx) > hw * 0.82) c = mix(c, C.skinShadow, 0.5); // rim shading for roundness
      set(x, y, c);
    }
  }

  // --- headwear coverage (resolved early so hair under a hat isn't drawn) -----
  const headwearTopology = feat.topology.headwear;
  // Prefer explicit visible topology when it is more specific than a legacy
  // coarse label. This makes a panelled/front-bill result render as a cap even
  // if an older provider called it merely "brim".
  const topologyHatType =
    headwearTopology.crown === 'panelled' && headwearTopology.projection === 'front-bill'
      ? 'cap'
      : headwearTopology.crown === 'knit'
        ? 'beanie'
        : null;
  const hatType = C.hasHat && feat.headwearType !== 'none' ? (topologyHatType ?? feat.headwearType) : 'none';
  const capBillY = Math.round(cy - ry * 0.42);
  const capBillThickness = Math.max(1, Math.round(size * 0.035));
  const capUnderThickness = Math.max(1, Math.round(size * 0.025));
  const beanieBottomY = Math.round(cy - ry * 0.18);
  const beanieCuffThickness = Math.max(2, Math.round(size * 0.09));
  const brimY = Math.round(cy - ry * 0.4);
  const brimThickness = Math.max(1, Math.round(size * 0.025));
  const scalpTop = Math.max(0, Math.ceil(cy - ry));
  const hatBottomY =
    hatType === 'cap' || hatType === 'flatCap'
      ? capBillY + capBillThickness + capUnderThickness - 1
      : hatType === 'beanie' || hatType === 'beret'
        ? beanieBottomY
        : brimY + brimThickness - 1;
  // A fitted hat sits over the hairline. Hair classified as visible at the
  // temples may still peek out beside the ears, but it must not begin directly
  // beneath the bill and turn into an exposed band of scalp/hair across the
  // forehead. Keep that cue down at eye/sideburn height instead.
  const fittedHat = hatType === 'cap' || hatType === 'flatCap' || hatType === 'beanie';
  const templeRevealY = fittedHat ? cy - ry * 0.055 : hatBottomY + 1;

  // --- hair: native silhouette categories that remain distinct at 16px -------
  const hairStyle = feat.hairStyle;
  const hairLength = feat.hairLength;
  const hairTexture = feat.hairTexture;
  const visibleHair = feat.topology.scalpHair;
  const isAfro = hairStyle === 'afro';
  const isHorseshoe = hairStyle === 'horseshoe';
  const crownVisible = visibleHair.crown && !isHorseshoe;
  const hairline =
    cy -
    ry *
      (hairLength === 'buzz'
        ? 0.52
        : feat.hairPart !== 'none'
          ? 0.28
          : hairLength === 'jaw' || hairLength === 'long'
            ? 0.3
            : 0.34);
  if (!C.bald && (crownVisible || visibleHair.temples || visibleHair.belowEars)) {
    // Tied-back length is primarily an outside silhouette cue. Keep it clear
    // of the face so it still reads after the final outline pass.
    if (hairLength === 'tied' && visibleHair.belowEars) {
      const tx = cx + rx * 1.08;
      const ty = cy + ry * 0.34;
      fillDisc(tx, ty, size * 0.09, size * 0.18, C.hairShadow);
      fillDisc(tx + size * 0.025, ty + size * 0.13, size * 0.065, size * 0.13, C.hair);
    }

    const lower =
      isAfro
        ? cy + ry * 0.42
        : isHorseshoe
          ? cy + ry * 0.34
          : hairLength === 'long'
        ? cy + ry * 0.82
        : hairLength === 'jaw' || hairLength === 'tied'
          ? cy + ry * 0.62
          : cy + ry * 0.3;
    for (let y = Math.floor(cy - ry * (isAfro ? 1.3 : 1.18)); y <= Math.ceil(lower); y++) {
      const outerHw = halfW(y) * 1.08;
      for (let x = Math.floor(cx - rx * 1.24); x <= Math.ceil(cx + rx * 1.24); x++) {
        const baseOuterScale =
          isAfro
            ? 1.32
            : hairTexture === 'coily'
            ? 1.16
            : hairTexture === 'curly'
              ? 1.12
              : hairTexture === 'wavy' || hairLength === 'long'
                ? 1.12
                : 1.08;
        const lobeRows = Math.max(2, Math.round(size * 0.055));
        const lobe = Math.floor((y - (cy - ry)) / lobeRows) % 2 === 0 ? 1 : 0;
        const outerScale =
          baseOuterScale +
          (isAfro
            ? lobe * 0.1
            : hairTexture === 'coily'
              ? lobe * 0.07
              : hairTexture === 'curly'
                ? lobe * 0.045
                : 0);
        const outer =
          ((x - cx) / (rx * outerScale)) ** 2 +
          ((y - cy) / (ry * (isAfro ? 1.18 : 1.08))) ** 2;
        if (outer > 1) continue;
        if (hatType !== 'none' && y <= hatBottomY) continue;
        // A hat occludes the entire crown. Only genuinely exposed side/long
        // hair may survive below it; never paint an invented forehead band.
        const isTop = hatType === 'none' && crownVisible && y <= hairline;
        const templeTop = isHorseshoe ? cy - ry * 0.58 : cy - ry * 1.1;
        const templeBottom = isAfro
          ? cy + ry * 0.24
          : isHorseshoe
            ? cy + ry * 0.3
            : cy - ry * 0.02;
        const isTemple =
          visibleHair.temples &&
          (hatType === 'none' || y >= templeRevealY) &&
          y >= templeTop &&
          y <= templeBottom &&
          Math.abs(x - cx) >
            halfW(y) *
              (hatType !== 'none' ? 0.84 : isAfro ? 0.54 : isHorseshoe ? 0.68 : 0.66);
        const isCurtain =
          visibleHair.belowEars &&
          (hairLength === 'jaw' || hairLength === 'long' || hairLength === 'tied') &&
          y <= lower &&
          Math.abs(x - cx) >
            Math.max(size * 0.21, halfW(y) * (0.7 + portraitMix * 0.08));
        const on = hairLength === 'buzz' ? isTop : isTop || isTemple || isCurtain;
        if (!on) continue;
        if (hairLength === 'buzz') {
          if (!inFace(x, y)) continue;
          const under = get(x, y) ?? C.skin;
          const hash = Math.abs((x * 29 + y * 43 + x * y * 5) % 11);
          const amount = native ? (hash < 5 ? 0.58 : 0.38) : hash < 4 ? 0.5 : 0.28;
          set(x, y, mix(under, hash < 2 ? C.hairShadow : C.hair, amount));
          continue;
        }
        let c = y < cy - ry * 0.8 ? C.hairLight : Math.abs(x - cx) > outerHw ? C.hairShadow : C.hair;
        if (
          (isAfro || hairTexture === 'curly' || hairTexture === 'coily') &&
          outer > 0.78 &&
          lobe === 1 &&
          x < cx
        ) {
          c = C.hairLight;
        }
        set(x, y, c);
      }
    }

    if (feat.hairPart !== 'none' && crownVisible && hatType === 'none') {
      // A proportional offset collapses left and centre to the same column on
      // a 12/16px grid. Author the three native placements one pixel apart;
      // left/right are from the person's perspective, hence the screen-space
      // inversion. At portrait scale the same grammar expands proportionally.
      const partOffset = feat.hairPart === 'left' ? 1 : feat.hairPart === 'right' ? -1 : 0;
      const partX = native
        ? Math.round(cx) + partOffset
        : Math.round(cx + partOffset * rx * 0.16);
      const partDirection = feat.hairPart === 'left' ? 1 : feat.hairPart === 'right' ? -1 : 0;
      const partEnd = Math.round(hairline + size * 0.01);
      const proportionalStart = Math.round(cy - ry * 0.72);
      const partStart = native
        ? Math.max(proportionalStart, partEnd - (size <= 12 ? 2 : 3))
        : proportionalStart;
      const span = Math.max(1, partEnd - partStart);
      for (let y = partStart; y <= partEnd; y++) {
        const progress = (y - partStart) / span;
        const sweep = partDirection * (native
          ? (progress >= 0.67 ? 1 : 0)
          : Math.round(progress * size * 0.026));
        // This is a shadowed scalp/hair transition, not a raw skin-colored
        // incision. Slight row variation keeps it from reading as a ruler line.
        const skinMix = native
          ? 0.28 + ((y - partStart) % 2) * 0.08
          : 0.3 + progress * 0.08;
        set(partX + sweep, y, mix(C.hair, C.skin, skinMix));
      }
    }
  }

  // --- facial hair: four independent visible regions ------------------------
  // A defined moustache can coexist with lighter jaw/chin stubble. The legacy
  // single enum could not encode that very common combination.
  const eyeY = cy - ry * 0.06;
  const mouthY = cy + ry * 0.5;
  const facialTopology = feat.topology.facialHair;
  const regionRank = (density: HairRegion): number =>
    density === 'solid' ? 2 : density === 'stubble' ? 1 : 0;
  if (
    C.beard &&
    Object.values(facialTopology).some((density) => density !== 'none') &&
    (detail || native)
  ) {
    for (let y = Math.floor(eyeY); y <= Math.ceil(cy + ry); y++) {
      const hw = halfW(y);
      for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) {
        if (!inFace(x, y)) continue;
        const edge = Math.abs(x - cx) / hw; // 0 centre → 1 jaw rim
        const mw = rx * (native ? 0.48 : 0.42);
        const stacheT = Math.abs(x - cx) / mw;
        const stacheMidY = mouthY - size * 0.06;
        const stacheHalfH = Math.max(native ? 0.55 : 0.8, size * 0.025 * (1 - 0.4 * stacheT * stacheT));
        const stacheDrop = size * 0.018 * stacheT;
        const philtrum = Math.abs(x - cx) < Math.max(0.65, size * 0.014) && y <= stacheMidY;
        // At 12px the continuous moustache curve rounded onto the mouth row,
        // where the mouth redraw erased it completely. Reserve the row above
        // the mouth as a tiny two-lobed native glyph.
        const stacheOn = native
          ? stacheT <= 1 && y === Math.round(mouthY) - 1 && !philtrum
          : stacheT <= 1 &&
            Math.abs(y - (stacheMidY + stacheDrop)) <= stacheHalfH &&
            !philtrum;
        const fullBeard =
          facialTopology.chin === 'solid' &&
          (facialTopology.jaw === 'solid' || facialTopology.cheeks === 'solid');
        const chinStart = mouthY + size * 0.055;
        const chinT = smoothstep(chinStart, cy + ry * 0.9, y);
        const chinHalf = fullBeard
          ? rx * (0.4 + chinT * 0.14)
          : rx * (0.17 + chinT * 0.14);
        const chinOn = y >= chinStart && Math.abs(x - cx) < chinHalf;
        const jawTop = mouthY + size * 0.025 - edge * ry * 0.2;
        const jawOn =
          y >= jawTop &&
          (edge > (facialTopology.jaw === 'solid' ? 0.5 : 0.61) ||
            (facialTopology.jaw === 'solid' && y > mouthY + ry * 0.22));
        const cheekOn =
          edge > 0.67 &&
          y >= eyeY + ry * 0.24 &&
          y < mouthY + ry * 0.12;
        let density: HairRegion = 'none';
        const take = (on: boolean, candidate: HairRegion): void => {
          if (on && regionRank(candidate) > regionRank(density)) density = candidate;
        };
        take(stacheOn, facialTopology.upperLip);
        take(chinOn, facialTopology.chin);
        take(jawOn, facialTopology.jaw);
        take(cheekOn, facialTopology.cheeks);
        if (density === 'none') continue;
        const base = edge > 0.72 ? shade(C.beard, 0.82) : C.beard;
        const under = get(x, y) ?? C.skin;
        if (density === 'stubble') {
          if (native) {
            const hash = Math.abs((x * 37 + y * 61 + x * y * 7) % 11);
            // Native stubble must retain skin gaps; a full translucent fill is
            // spatially identical to a beard and only differs in brightness.
            if (!stacheOn && hash > 4) continue;
            set(x, y, mix(under, base, stacheOn ? 0.48 : 0.42));
          } else {
            // Stable, non-diagonal stipple. Most skin stays untouched, so this
            // reads as short hair instead of the old checkerboard beard mask.
            const hash = Math.abs((x * 37 + y * 61 + x * y * 7) % 17);
            if (hash > (stacheOn ? 7 : 4)) {
              if (stacheOn) set(x, y, mix(under, base, 0.17));
              continue;
            }
            set(x, y, mix(under, base, stacheOn ? 0.48 : hash < 2 ? 0.38 : 0.24));
          }
        } else {
          const boundary =
            Math.abs(Math.abs(x - cx) - mw) < 1 ||
            Math.abs(y - chinStart) < 1 ||
            Math.abs(edge - 0.61) < 0.04;
          set(x, y, mix(under, base, boundary ? 0.62 : 0.86));
        }
      }
    }
  }

  // --- eyes (spacing + shape) -----------------------------------------------
  const eyeDX = rx * (feat.eyeSpacing === 'close' ? 0.34 : feat.eyeSpacing === 'wide' ? 0.5 : 0.42);
  const eyeShape = feat.eyeShape ?? 'almond';
  const eyeRX =
    size *
    (eyeShape === 'round'
      ? 0.07 - portraitMix * 0.012
      : eyeShape === 'narrow'
        ? 0.068 - portraitMix * 0.01
        : 0.073 - portraitMix * 0.011);
  const eyeRY =
    size *
    (eyeShape === 'round'
      ? 0.054 - portraitMix * 0.013
      : eyeShape === 'narrow'
        ? 0.03 - portraitMix * 0.008
        : 0.041 - portraitMix * 0.011);
  const glassesTopology = feat.topology.glasses;
  for (const dir of [-1, 1]) {
    const ex = cx + dir * eyeDX;
    if (native) {
      const ey = Math.round(eyeY);
      const centre = Math.round(ex);
      const half = eyeShape === 'narrow' ? 1 : size === 20 ? 2 : 1;
      for (let x = centre - half; x <= centre + half; x++) {
        if (inFace(x, ey)) set(x, ey, C.eyeWhite);
      }
      if (eyeShape === 'round' && size > 16 && inFace(centre, ey - 1)) set(centre, ey - 1, C.eyeWhite);
      set(centre, ey, C.eyeDark); // exactly one pupil pixel at native size
    } else {
      fillDisc(ex, eyeY, eyeRX, eyeRY, C.eyeWhite, true);
      fillDisc(
        ex + dir * eyeRX * 0.08,
        eyeY + eyeRY * 0.08,
        Math.max(0.85, eyeRX * 0.4),
        Math.max(0.85, eyeRY * 0.68),
        C.eyeDark,
      );
      if (size >= 48) set(ex - dir, eyeY - 1, C.eyeWhite);
    }
    if (detail) {
      // eyebrow: thickness + shape
      const thick = Math.max(1, Math.round(size * (feat.eyebrows === 'thin' ? 0.02 : feat.eyebrows === 'thick' ? 0.05 : 0.032)));
      const browY = eyeY - eyeRY - size * (0.036 - portraitMix * 0.011);
      for (let x = Math.round(ex - eyeRX); x <= Math.round(ex + eyeRX); x++) {
        const f = (x - ex) / eyeRX; // -1 inner? depends on dir
        const inner = -dir * f; // >0 toward the nose
        let dy = 0;
        if (feat.eyebrowShape === 'arched') dy = Math.abs(f) * size * 0.03; // ends dip, middle raised
        else if (feat.eyebrowShape === 'angled') dy = inner * size * 0.03; // inner end lower
        for (let k = 0; k < thick; k++) set(x, browY + dy + k, C.brow);
      }
    }
    if (C.glass && glassesTopology.frame !== 'none') {
      if (native) {
        // Native glasses are sparse authored glyphs, not downscaled geometric
        // rings. The old 3x3 frame consumed every interior pixel and erased
        // both eyes. Keep the eye row readable and spend the frame on top/bottom
        // rails plus the outer temple.
        const ey = Math.round(eyeY);
        const centre = Math.round(ex);
        const halfX = size >= 16 ? 2 : 1;
        const left = centre - halfX;
        const right = centre + halfX;
        const top = ey - 1;
        const bottom = ey + 1;
        const glassLuma = C.glass.r * 0.2126 + C.glass.g * 0.7152 + C.glass.b * 0.0722;
        const frame = glassLuma > 210 ? shade(C.glass, 0.62) : C.glass;

        if (glassesTopology.lensTint === 'dark') {
          for (let x = centre - 1; x <= centre + 1; x++) {
            const under = get(x, ey);
            if (under) set(x, ey, mix(under, frame, 0.42));
          }
        }

        if (glassesTopology.frame === 'rimless') {
          set(left, top, frame);
          set(right, top, frame);
        } else {
          const inset = glassesTopology.lensShape === 'rectangular' || size < 16 ? 0 : 1;
          for (let x = left + inset; x <= right - inset; x++) set(x, top, frame);
          set(centre + dir * halfX, ey, frame);
          if (glassesTopology.frame === 'thick') {
            for (let x = left + inset; x <= right - inset; x++) set(x, bottom, frame);
            set(centre - dir * halfX, ey, frame);
          }
        }

        // Reassert the critical eye grammar after the frame: clear lenses keep
        // exact whites/pupil; sunglasses keep a muted glint plus black pupil.
        const lensWhite =
          glassesTopology.lensTint === 'dark' ? mix(C.eyeWhite, frame, 0.42) : C.eyeWhite;
        if (inFace(centre - 1, ey)) set(centre - 1, ey, lensWhite);
        if (inFace(centre + 1, ey)) set(centre + 1, ey, lensWhite);
        set(centre, ey, C.eyeDark);
      } else {
        const frameThickness = Math.max(
          1,
          Math.round(size * (glassesTopology.frame === 'thick' ? 0.052 : 0.026)),
        );
        const detailScale = Math.max(0, Math.min(1, (size - 16) / 12));
        let lx =
          eyeRX +
          size *
            (0.004 +
              ((glassesTopology.frame === 'thick' ? 0.058 : 0.044) - 0.004) *
                detailScale);
        let ly = eyeRY + size * (0.012 + 0.038 * detailScale);
        if (glassesTopology.lensShape === 'round') {
          const radius = Math.max(lx * 0.88, ly * 1.12);
          lx = radius;
          ly = radius;
        } else if (glassesTopology.lensShape === 'oval') {
          lx *= 0.9;
          ly *= 1.08;
        }

        // Dark lenses tint rather than replace the eyes. Even sunglasses retain
        // two distinct interiors instead of becoming a single visor.
        if (glassesTopology.lensTint === 'dark') {
          for (let y = Math.round(eyeY - ly + 1); y <= Math.round(eyeY + ly - 1); y++) {
            for (let x = Math.round(ex - lx + 1); x <= Math.round(ex + lx - 1); x++) {
              const inside =
                glassesTopology.lensShape === 'rectangular'
                  ? true
                  : ((x - ex) / Math.max(1, lx - 1)) ** 2 +
                      ((y - eyeY) / Math.max(1, ly - 1)) ** 2 <=
                    1;
              const under = inside ? get(x, y) : null;
              if (under) set(x, y, mix(under, C.glass, 0.28));
            }
          }
        }

        const left = Math.round(ex - lx);
        const right = Math.round(ex + lx);
        const top = Math.round(eyeY - ly);
        const bottom = Math.round(eyeY + ly);
        for (let y = top; y <= bottom; y++) {
          for (let x = left; x <= right; x++) {
            const dx = Math.abs(x - ex);
            const dy = Math.abs(y - eyeY);
            const rectangular =
              dx >= lx - frameThickness || dy >= ly - frameThickness;
            const ellipse = (dx / Math.max(1, lx)) ** 2 + (dy / Math.max(1, ly)) ** 2;
            const innerEllipse = Math.max(
              0,
              1 - (frameThickness / Math.max(1, Math.min(lx, ly))) * 1.4,
            );
            const rounded = ellipse <= 1.12 && ellipse >= innerEllipse;
            const border =
              glassesTopology.lensShape === 'rectangular' ? rectangular : rounded;
            if (!border) continue;
            if (
              glassesTopology.frame === 'rimless' &&
              dx < lx * 0.7 &&
              dy < ly * 0.7
            ) {
              continue;
            }
            set(x, y, C.glass);
          }
        }
      }
    }
  }
  if (C.glass && glassesTopology.frame !== 'none') {
    // A one-pixel bridge is enough at native size. A full inner-edge run is
    // what made clear prescription frames read as a dark visor.
    set(Math.round(cx), Math.round(eyeY), C.glass);
  }

  // --- nose (size) -----------------------------------------------------------
  if (detail) {
    const noseHalf = size * (feat.noseSize === 'small' ? 0.03 : feat.noseSize === 'large' ? 0.06 : 0.045);
    const noseTip = cy + ry * (feat.noseSize === 'small' ? 0.18 : feat.noseSize === 'large' ? 0.32 : 0.26);
    for (let y = Math.round(eyeY + eyeRY + size * 0.03); y <= Math.round(noseTip); y++) set(cx + size * 0.02, y, C.skinShadow);
    set(cx - noseHalf, Math.round(noseTip), C.skinShadow); // nostril hints
    set(cx + noseHalf, Math.round(noseTip), C.skinShadow);
  }

  // --- mouth: compact neutral line over any beard ----------------------------
  // The old broad two-row pink smile dominated every face and erased the lower
  // edge of the moustache. A neutral mouth is a less identity-distorting default
  // until expression/width are explicit analysis fields.
  const mouthHalf = Math.max(1, Math.round(rx * (native ? 0.34 : 0.37)));
  const mouthDark = mix(C.lip, C.outline, 0.42);
  for (let x = -mouthHalf; x <= mouthHalf; x++) {
    const yy = Math.round(mouthY + Math.abs(x / mouthHalf) * size * 0.006);
    set(cx + x, yy, mouthDark);
  }
  if (detail && !native) {
    const lowerHalf = Math.max(1, Math.round(mouthHalf * 0.52));
    for (let x = -lowerHalf; x <= lowerHalf; x++) set(cx + x, Math.round(mouthY) + 1, C.lip);
  }

  // --- headwear: baseball cap / beanie / wide brim ---------------------------
  if (hatType !== 'none') {
    // Track hat pixels separately so the final silhouette uses a darkened hat
    // edge instead of the brown skin outline.
    const setHat = (x: number, y: number, c: Rgb): void => set(x, y, c, true);
    const drawCrown = (
      top: number,
      bottom: number,
      topHalfWidth: number,
      bottomHalfWidth: number,
      panelSeam: boolean,
    ): void => {
      const span = Math.max(1, bottom - top);
      for (let y = top; y <= bottom; y++) {
        const u = smoothstep(0, 1, (y - top) / span);
        // The crown is clothing around the head, so it can never be narrower
        // than the scalp it covers. Without this floor, some face shapes left
        // one-pixel skin wedges exposed along the cap's diagonal sides.
        const scalpHalf = halfW(y);
        const half = Math.max(
          topHalfWidth + (bottomHalfWidth - topHalfWidth) * u,
          scalpHalf > 0 ? scalpHalf + (native ? 0.25 : 0.65) : 0,
        );
        const left = Math.ceil(cx - half);
        const right = Math.floor(cx + half);
        for (let x = left; x <= right; x++) {
          const edge = x === left || x === right;
          setHat(x, y, y === top ? C.hatLight : edge ? C.hatShadow : C.hat);
        }
        if (panelSeam && y > top && y < bottom) {
          setHat(Math.round(cx), y, mix(C.hat, C.hatShadow, 0.38));
        }
      }
    };
    if (hatType === 'cap') {
      const crownTop = Math.max(0, Math.round(cy - ry * 1.0));
      // Structured crown: a much narrower top and a decisive asymmetric bill.
      // At 16px the crown is 10px wide and the bill is 13px wide, rather than
      // the previous one-pixel difference that read like a beanie cuff.
      drawCrown(
        crownTop,
        capBillY - 1,
        size * (native ? 0.19 : 0.16),
        size * (native ? 0.31 : 0.35),
        true,
      );
      const billLeft = Math.ceil(cx - size * 0.36);
      const billRight = Math.floor(cx + size * 0.43);
      for (let k = 0; k < capBillThickness; k++) {
        for (let x = billLeft; x <= billRight; x++) {
          setHat(x, capBillY + k, k === 0 ? C.hat : C.hatShadow);
        }
      }
      for (let k = 0; k < capUnderThickness; k++) {
        const y = capBillY + capBillThickness + k;
        const scalpHalf = halfW(y) + (native ? 0.25 : 0.65);
        const underLeft = Math.ceil(cx - Math.max(size * 0.29, scalpHalf));
        const underRight = Math.floor(cx + Math.max(size * 0.35, scalpHalf));
        for (let x = underLeft; x <= underRight; x++) {
          setHat(x, y, C.hatShadow);
        }
      }
      // A short diagonal panel highlight reads more like stitched canvas than
      // a full-width bright top edge, especially for black caps.
      if (!native) {
        for (let y = crownTop + 2; y < capBillY - 2; y++) {
          setHat(cx - (capBillY - y) * 0.22, y, mix(C.hat, C.hatLight, 0.55));
        }
      }
    } else if (hatType === 'flatCap') {
      // A flat cap has a low structured crown and a short forward projection.
      drawCrown(scalpTop, capBillY - 1, size * 0.14, size * 0.4, false);
      const billCentre = cx + size * 0.06;
      for (let x = Math.ceil(billCentre - size * 0.42); x <= Math.floor(billCentre + size * 0.42); x++) {
        setHat(x, capBillY, x > cx ? C.hatShadow : C.hat);
      }
      const underHalf = Math.max(size * 0.34, halfW(capBillY + 1) + (native ? 0.25 : 0.65));
      for (let k = 0; k < capUnderThickness; k++) {
        for (let x = Math.ceil(cx - underHalf); x <= Math.floor(cx + underHalf); x++) {
          setHat(x, capBillY + 1 + k, C.hatShadow);
        }
      }
    } else if (hatType === 'topHat') {
      const crownTop = Math.max(0, Math.round(cy - ry * 1.2));
      drawCrown(crownTop, brimY - 1, size * 0.28, size * 0.28, false);
      for (let x = Math.ceil(cx - size * 0.46); x <= Math.floor(cx + size * 0.46); x++) {
        setHat(x, brimY, C.hatShadow);
      }
    } else if (hatType === 'brim' || hatType === 'wideBrim') {
      const crownTop = Math.max(0, Math.round(cy - ry * 1.0));
      drawCrown(crownTop, brimY - 1, size * 0.2, size * 0.34, false);
      const brimHalf = size * (hatType === 'wideBrim' ? 0.49 : 0.45);
      for (let k = 0; k < brimThickness; k++) {
        for (let x = Math.ceil(cx - brimHalf); x <= Math.floor(cx + brimHalf); x++) {
          setHat(x, brimY + k, k === 0 ? C.hat : C.hatShadow);
        }
      }
    } else if (hatType === 'beret') {
      // Soft, asymmetric crown with a narrow band; no knit cuff or bill.
      const bandY = beanieBottomY;
      const crownTop = Math.max(0, Math.round(cy - ry * 1.0));
      const span = Math.max(1, bandY - crownTop);
      for (let y = crownTop; y < bandY; y++) {
        const u = (y - crownTop) / span;
        const centre = cx - size * (0.07 + 0.03 * (1 - u));
        const desiredHalf = size * (0.24 + 0.18 * Math.sin(Math.PI * u));
        const scalpHalf = halfW(y) > 0 ? halfW(y) + (native ? 0.25 : 0.65) : 0;
        const left = Math.min(centre - desiredHalf, cx - scalpHalf);
        const right = Math.max(centre + desiredHalf, cx + scalpHalf);
        for (let x = Math.ceil(left); x <= Math.floor(right); x++) {
          setHat(x, y, x < centre - desiredHalf * 0.7 ? C.hatShadow : C.hat);
        }
      }
      const bandHalf = Math.max(size * 0.32, halfW(bandY) + (native ? 0.25 : 0.65));
      for (let x = Math.ceil(cx - bandHalf); x <= Math.floor(cx + bandHalf); x++) {
        setHat(x, bandY, C.hatShadow);
      }
    } else {
      // A beanie has a rounded crown and a folded cuff, but deliberately no
      // projecting bill. Its silhouette must remain distinct from a cap even
      // at the shipping 16px size.
      const cuffTop = beanieBottomY - beanieCuffThickness + 1;
      const crownTop = Math.max(0, Math.round(cy - ry * 1.04));
      drawCrown(crownTop, cuffTop - 1, size * 0.19, size * 0.43, false);
      const cuffHalf = size * 0.43;
      for (let y = cuffTop; y <= beanieBottomY; y++) {
        for (let x = Math.ceil(cx - cuffHalf); x <= Math.floor(cx + cuffHalf); x++) {
          setHat(x, y, y === cuffTop ? C.hat : C.hatShadow);
        }
      }
    }
  }

  // --- 1px outline around the whole silhouette -------------------------------
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < size && y < size && buf[(y * size + x) * 4 + 3] === 255;
  const rim = Buffer.from(buf);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!opaque(x, y)) continue;
      if (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1)) {
        const i = (y * size + x) * 4;
        const materialIndex = y * size + x;
        const outline =
          hatMaterial[materialIndex] === 1
            ? C.hatOutline
            : earMaterial[materialIndex] === 1 && native
              ? C.skinShadow
              : native && hatType !== 'none' && !visibleHair.temples
                ? mix(C.outline, C.skinShadow, 0.45)
                : C.outline;
        rim[i] = outline.r;
        rim[i + 1] = outline.g;
        rim[i + 2] = outline.b;
        rim[i + 3] = 255;
      }
    }
  }
  return rim;
}

/**
 * Directional in-game heads use their own pixel grammar rather than warping the
 * frontal bitmap. `side` is authored facing right and is mirrored by the engine
 * for left-facing frames. `back` deliberately contains no facial features.
 */
function drawDirectionalAvatar(
  feat: NormalizedFaceFeatures,
  size: number,
  view: Exclude<AvatarView, 'front'>,
  detailAt = 32,
): Buffer {
  const C = resolveColors(feat);
  const detail = size >= detailAt;
  const native = size <= 20;
  const faceShape = feat.faceShape ?? 'oval';
  const anchors = anchorsFor(faceShape, feat.chin ?? 'round');
  const cy = size * 0.52;
  const ry = SHAPE_RY[faceShape] * size;
  const rx = SHAPE_RX[faceShape] * size * (view === 'side' ? 0.84 : 0.96);
  // Leave room in front of portrait-scale noses and cap bills. Native side
  // heads get one deliberate forward pixel so they sit over the shoulders
  // instead of appearing rear-heavy; mirroring carries the offset to the left.
  const cx = view === 'side' ? size * 0.44 + (native ? 1 : 0) : (size - 1) / 2;

  const halfW = (y: number): number => {
    const t = (y - (cy - ry)) / (2 * ry);
    if (t < 0 || t > 1) return 0;
    let i = 0;
    while (i < ANCHOR_T.length - 2 && t > ANCHOR_T[i + 1]!) i++;
    const u = smoothstep(ANCHOR_T[i]!, ANCHOR_T[i + 1]!, t);
    return rx * (anchors[i]! + (anchors[i + 1]! - anchors[i]!) * u);
  };
  const leftAt = (y: number): number => cx - halfW(y) * (view === 'side' ? 1.06 : 1);
  const rightAt = (y: number): number => cx + halfW(y) * (view === 'side' ? 0.8 : 1);
  const inHead = (x: number, y: number): boolean =>
    y >= cy - ry && y <= cy + ry && x >= leftAt(y) && x <= rightAt(y);

  // 0 skin, 1 hat, 2 scalp hair, 3 ear, 4 unoutlined profile nose, 5 beard.
  // Material is used only for the final rim.
  const buf = Buffer.alloc(size * size * 4);
  const material = Buffer.alloc(size * size);
  const set = (x: number, y: number, c: Rgb, mat = 0): void => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return;
    const i = (yi * size + xi) * 4;
    buf[i] = c.r;
    buf[i + 1] = c.g;
    buf[i + 2] = c.b;
    buf[i + 3] = 255;
    material[yi * size + xi] = mat;
  };
  const get = (x: number, y: number): Rgb | null => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return null;
    const i = (yi * size + xi) * 4;
    return buf[i + 3] === 255 ? { r: buf[i]!, g: buf[i + 1]!, b: buf[i + 2]! } : null;
  };
  const fillDisc = (dcx: number, dcy: number, drx: number, dry: number, c: Rgb, mat = 0): void => {
    const safeRx = Math.max(0.55, drx);
    const safeRy = Math.max(0.55, dry);
    for (let y = Math.floor(dcy - safeRy); y <= Math.ceil(dcy + safeRy); y++) {
      for (let x = Math.floor(dcx - safeRx); x <= Math.ceil(dcx + safeRx); x++) {
        const dx = (x - dcx) / safeRx;
        const dy = (y - dcy) / safeRy;
        if (dx * dx + dy * dy <= 1) set(x, y, c, mat);
      }
    }
  };
  const fillRow = (y: number, left: number, right: number, c: Rgb, mat = 0): void => {
    for (let x = Math.ceil(left); x <= Math.floor(right); x++) set(x, y, c, mat);
  };

  const headwearTopology = feat.topology.headwear;
  const topologyHatType =
    headwearTopology.crown === 'panelled' && headwearTopology.projection === 'front-bill'
      ? 'cap'
      : headwearTopology.crown === 'knit'
        ? 'beanie'
        : null;
  const hatType = C.hasHat && feat.headwearType !== 'none' ? (topologyHatType ?? feat.headwearType) : 'none';
  const hatBandY = Math.round(cy - ry * (hatType === 'beanie' ? 0.12 : 0.38));
  const hatBandThickness = Math.max(1, Math.round(size * (hatType === 'beanie' ? 0.09 : 0.035)));
  const hatBottomY = hatType === 'none' ? -1 : hatBandY + hatBandThickness - 1;
  const scalpTop = Math.max(0, Math.ceil(cy - ry));

  let nativeSideEarCue: { x: number; y: number } | null = null;

  // Rear ear first, so the head and hair correctly overlap its inner edge.
  if ((feat.ears ?? 'average') !== 'hidden') {
    const earY = cy + ry * 0.01;
    if (native && view === 'side') {
      // At 12/16px an external ear competes directly with the nose and reads as
      // a rear-facing peg. Suppress ordinary ears; only an explicitly prominent
      // ear earns a quiet interior shadow without changing the silhouette.
      if (feat.ears === 'prominent') {
        nativeSideEarCue = { x: Math.ceil(leftAt(earY)) + 1, y: Math.round(earY) };
      }
    } else {
      const earScale = feat.ears === 'prominent' ? 1.18 : feat.ears === 'small' ? 0.68 : 0.88;
      const earX = view === 'side' ? leftAt(earY) - size * 0.015 : cx - halfW(earY) - size * 0.01;
      const earRx = Math.max(native ? 0.7 : 1, size * 0.045 * earScale);
      const earRy = Math.max(native ? 0.9 : 1, size * 0.072 * earScale);
      fillDisc(earX, earY, earRx, earRy, C.skin, 3);
      if (!native) fillDisc(earX, earY, earRx * 0.38, earRy * 0.52, C.skinShadow, 3);
      if (view === 'back') {
        const otherEarX = cx + halfW(earY) + size * 0.01;
        fillDisc(otherEarX, earY, earRx, earRy, C.skin, 3);
        if (!native) fillDisc(otherEarX, earY, earRx * 0.38, earRy * 0.52, C.skinShadow, 3);
      }
    }
  }

  // Skin volume. A side head is narrower at the face than at the rear cranium.
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const left = leftAt(y);
    const right = rightAt(y);
    for (let x = Math.ceil(left); x <= Math.floor(right); x++) {
      if (!inHead(x, y)) continue;
      const t = (y - (cy - ry)) / (2 * ry);
      let c = t < 0.34 ? mix(C.skinLight, C.skin, t / 0.34) : t < 0.7 ? C.skin : mix(C.skin, C.skinShadow, (t - 0.7) / 0.3);
      if (x < left + size * 0.035 || x > right - size * 0.025) c = mix(c, C.skinShadow, 0.46);
      set(x, y, c);
    }
  }

  // Skin volume must exist before this subtle interior cue is applied.
  if (nativeSideEarCue) {
    const under = get(nativeSideEarCue.x, nativeSideEarCue.y) ?? C.skin;
    set(nativeSideEarCue.x, nativeSideEarCue.y, mix(under, C.skinShadow, 0.55));
  }

  const eyeY = cy - ry * 0.07;
  const noseY = cy + ry * 0.12;
  const mouthY = cy + ry * 0.48;
  const eyeRow = Math.round(eyeY);
  const noseRow = Math.round(noseY);
  const mouthRow = Math.round(mouthY);

  if (view === 'side') {
    // The profile silhouette itself carries direction at native size. Nose size
    // controls how many forward pixels survive, rather than drawing a frontal
    // vertical nose line inside the face.
    const noseDepth = feat.noseSize === 'large' ? Math.max(2, Math.round(size * 0.045)) : 1;
    const noseBase = Math.floor(rightAt(noseRow));
    if (native) {
      // Keep the native silhouette to one projecting row. Shade from the
      // softer facial rim toward a darker tip, then darken the existing pixel
      // immediately beneath it. This gives the nose volume without restoring
      // the old dangling lower silhouette pixel.
      set(noseBase, noseRow, C.skinShadow, 4);
      for (let d = 1; d <= noseDepth; d++) {
        set(
          noseBase + d,
          noseRow,
          d === noseDepth
            ? mix(C.skinShadow, C.outline, 0.55)
            : mix(C.skin, C.skinShadow, 0.45),
          4,
        );
      }
      const undersideY = noseRow + 1;
      const undersideX = Math.floor(rightAt(undersideY));
      set(undersideX, undersideY, mix(C.skinShadow, C.outline, 0.3), 4);
    } else {
      set(noseBase + 1, noseY - 1, C.skin);
      for (let d = 1; d <= noseDepth; d++) {
        set(noseBase + d, noseY, d === noseDepth ? C.skinShadow : C.skin);
      }
      set(noseBase + 1, noseY + 1, C.skinShadow);
    }
  }

  // Scalp hair is a silhouette cue first. Hats occlude the crown; long hair can
  // remain visible behind/below it. Hidden/bald observations never invent hair.
  const hairStyle = feat.hairStyle;
  const hairLength = feat.hairLength;
  const hairTexture = feat.hairTexture;
  const scalp = feat.topology.scalpHair;
  const isAfro = hairStyle === 'afro';
  const isHorseshoe = hairStyle === 'horseshoe';
  const crownVisible = scalp.crown && !isHorseshoe;
  const hasVisibleHair =
    !C.bald && feat.hairStyle !== 'hidden' && hairLength !== 'none' &&
    (crownVisible || scalp.temples || scalp.belowEars);
  if (hasVisibleHair) {
    const hairline = cy - ry * (hairLength === 'buzz' ? 0.5 : 0.3);
    const attachmentTop =
      hatType === 'none' ? Math.round(cy - ry * 0.55) : hatBottomY + 1;
    const lower =
      isAfro
        ? cy + ry * 0.4
        : isHorseshoe
          ? cy + ry * 0.36
          : hairLength === 'long' || hairLength === 'tied'
        ? cy + ry * 0.9
        : hairLength === 'jaw'
          ? cy + ry * 0.62
          : cy + ry * 0.22;
    const hairStart = native
      ? Math.max(1, Math.ceil(cy - ry * (isAfro ? 1.22 : 1.08)))
      : Math.floor(cy - ry * (isAfro ? 1.22 : 1.08));
    for (let y = hairStart; y <= Math.ceil(lower); y++) {
      const hw = halfW(y);
      const textureRows = Math.max(2, Math.round(size * 0.055));
      const textureLobe = Math.abs(Math.floor((y - (cy - ry)) / textureRows)) % 2;
      const rearWave = native
        ? hairTexture === 'coily'
          ? textureLobe * 1.15
          : hairTexture === 'curly'
            ? textureLobe * 0.9
            : hairTexture === 'wavy'
              ? textureLobe * 0.45
              : 0
        : rx *
          (hairTexture === 'coily'
            ? textureLobe * 0.1
            : hairTexture === 'curly'
              ? textureLobe * 0.07
              : hairTexture === 'wavy'
                ? textureLobe * 0.035
                : 0);
      // Side hair needs its own rear volume; following the face ellipse made
      // every style look like a square patch glued to the scalp. Two native
      // pixels produces the requested backward silhouette without clipping.
      const rearPixels = 2;
      const rearRoundness = Math.max(
        0,
        Math.min(1, 1 - Math.abs(y - (cy - ry * 0.2)) / (ry * 0.88)),
      );
      const rearExpansion = native
        ? Math.round(rearPixels * rearRoundness)
        : size * (isAfro ? 0.075 : 0.04) * rearRoundness;
      const hairLeft = Math.max(
        native ? 1 : -size,
        leftAt(y) - rearExpansion - rearWave,
      );
      const hairRight = Math.min(
        native ? size - 2 : size * 2,
        rightAt(y) + (isAfro ? rearExpansion * 0.55 : 0),
      );
      const lowerTaper = smoothstep(cy + ry * 0.45, lower, y);
      const curtainLeft =
        hairLength === 'jaw' || hairLength === 'long' || hairLength === 'tied'
          ? Math.max(
              native ? 1 : -size,
              hairLeft + lowerTaper * (native ? 1 : size * 0.04),
            )
          : hairLeft;
      for (let x = Math.floor(cx - rx * 1.4 - (native ? 1 : 0)); x <= Math.ceil(cx + rx * 1.2); x++) {
        const inside = inHead(x, y);
        const hatOccludes = hatType !== 'none' && y <= hatBottomY;
        let on = false;
        if (view === 'back') {
          const rearCrown =
            crownVisible &&
            y <= cy + ry * (hairLength === 'buzz' ? -0.1 : isAfro ? 0.32 : 0.22) &&
            (inside || (isAfro && x >= hairLeft && x <= cx + (cx - hairLeft)));
          const horseshoeRing =
            isHorseshoe &&
            y >= cy - ry * 0.42 &&
            y <= cy + ry * 0.38 &&
            x >= hairLeft &&
            x <= cx + (cx - hairLeft) &&
            (Math.abs(x - cx) >= hw * 0.48 || y >= cy + ry * 0.08);
          const longBack =
            scalp.belowEars &&
            (hairLength === 'jaw' || hairLength === 'long' || hairLength === 'tied') &&
            y >= attachmentTop &&
            y <= lower &&
            Math.abs(x - cx) <= Math.max(size * 0.16, halfW(Math.min(y, cy + ry * 0.72)) * 1.02);
          on = rearCrown || horseshoeRing || longBack;
        } else {
          const crown = crownVisible && y <= hairline && x >= hairLeft && x <= hairRight;
          const rearTop = isHorseshoe ? cy - ry * 0.55 : cy - ry * 0.78;
          const rearBottom = isAfro
            ? cy + ry * 0.3
            : isHorseshoe
              ? cy + ry * 0.36
              : cy + ry * 0.2;
          const rearTaper = native
            ? Math.round(smoothstep(rearBottom - 1.5, rearBottom, y))
            : size * 0.025 * smoothstep(rearBottom - size * 0.08, rearBottom, y);
          const rear =
            scalp.temples &&
            y >= rearTop &&
            y <= rearBottom &&
            x >= hairLeft + rearTaper &&
            x <= cx - hw * 0.42;
          const longRear =
            scalp.belowEars &&
            (hairLength === 'jaw' || hairLength === 'long' || hairLength === 'tied') &&
            y >= attachmentTop &&
            y <= lower &&
            x >= curtainLeft &&
            x <= cx - hw * 0.18;
          on = crown || rear || longRear;
        }
        if (!on || hatOccludes) continue;
        if (hairLength === 'buzz') {
          if (!inside) continue;
          const under = get(x, y) ?? C.skin;
          const hash = Math.abs((x * 31 + y * 47 + x * y * 3) % 9);
          set(x, y, mix(under, hash < 3 ? C.hairShadow : C.hair, native ? 0.42 : 0.32), 2);
          continue;
        }
        const contour =
          view === 'side'
            ? x <= hairLeft + 0.8
            : Math.abs(x - cx) >= Math.max(1, halfW(y) * 0.9);
        const c =
          (isAfro || hairTexture === 'curly' || hairTexture === 'coily') && contour
            ? C.hairLight
            : x < cx - hw * 0.7 || y > cy + ry * 0.45
              ? C.hairShadow
              : C.hair;
        set(x, y, c, 2);
      }
    }
    if (view === 'back' && feat.hairPart !== 'none' && crownVisible && hatType === 'none' && hairLength !== 'buzz') {
      const partX = cx + (feat.hairPart === 'left' ? -1 : feat.hairPart === 'right' ? 1 : 0) * size * 0.08;
      for (let y = Math.round(cy - ry * 0.94); y <= Math.round(cy - ry * 0.48); y++) {
        set(partX, y, C.hairShadow, 2);
      }
    }
  }

  if (view === 'side') {
    // One eye, placed toward the direction of travel. At native resolution it
    // is an intentional white/pupil pair instead of a squashed frontal pair.
    const ex = cx + rx * 0.26;
    if (native) {
      set(ex - 1, eyeY, C.eyeWhite);
      set(ex, eyeY, C.eyeDark);
    } else {
      fillDisc(ex, eyeY, size * 0.055, size * 0.038, C.eyeWhite);
      fillDisc(ex + size * 0.012, eyeY, Math.max(0.8, size * 0.018), Math.max(0.8, size * 0.022), C.eyeDark);
    }
    if (detail) {
      const browWidth = Math.max(2, Math.round(size * 0.1));
      const browY = Math.round(eyeY - size * 0.075);
      for (let x = Math.round(ex - browWidth * 0.55); x <= Math.round(ex + browWidth * 0.45); x++) {
        set(x, browY, C.brow);
      }
    }

    const glasses = feat.topology.glasses;
    if (C.glass && glasses.frame !== 'none') {
      if (native) {
        const centre = Math.round(ex);
        const frameLuma = C.glass.r * 0.2126 + C.glass.g * 0.7152 + C.glass.b * 0.0722;
        const frame = frameLuma > 210 ? shade(C.glass, 0.62) : C.glass;
        const top = eyeRow - 1;
        const armEnd = Math.round(cx - rx * 0.73);
        if (glasses.frame === 'rimless') {
          set(centre + 1, top, frame);
        } else {
          for (let x = armEnd; x <= centre + 1; x++) set(x, top, frame);
          set(centre + 1, eyeRow, frame);
          if (glasses.frame === 'thick') {
            for (let x = centre - 1; x <= centre + 1; x++) set(x, eyeRow + 1, frame);
          }
        }
        const lensWhite = glasses.lensTint === 'dark' ? mix(C.eyeWhite, frame, 0.42) : C.eyeWhite;
        set(centre - 1, eyeRow, lensWhite);
        set(centre, eyeRow, C.eyeDark);
      } else {
        const lensHalfX = Math.max(1, Math.round(size * (glasses.frame === 'thick' ? 0.075 : 0.06)));
        const lensHalfY = Math.max(1, Math.round(size * 0.055));
        const left = Math.round(ex - lensHalfX);
        const right = Math.round(ex + lensHalfX);
        const top = Math.round(eyeY - lensHalfY);
        const bottom = Math.round(eyeY + lensHalfY);
        for (let x = left; x <= right; x++) {
          set(x, top, C.glass);
          set(x, bottom, C.glass);
        }
        for (let y = top; y <= bottom; y++) {
          set(left, y, C.glass);
          set(right, y, C.glass);
        }
        const armEnd = Math.round(cx - rx * 0.73);
        for (let x = left - 1; x >= armEnd; x--) set(x, top + 1, C.glass);
      }
    }

    const facial = feat.topology.facialHair;
    if (C.beard && (detail || native) && Object.values(facial).some((density) => density !== 'none')) {
      const beardRight = (y: number) => Math.floor(rightAt(y));
      const beardLeft = Math.ceil(cx - rx * 0.42);
      for (let y = noseRow + 1; y <= Math.round(cy + ry * 0.92); y++) {
        for (let x = beardLeft; x <= beardRight(y); x++) {
          if (!inHead(x, y)) continue;
          const underMaterial = material[y * size + x];
          // Facial hair belongs to the cheek/jaw plane. Keep it off both scalp
          // hair and the three-pixel nose volume so the profile stays legible.
          if (underMaterial === 2 || underMaterial === 4) continue;
          const upperLip =
            facial.upperLip !== 'none' &&
            y === mouthRow - 1 &&
            x >= rightAt(mouthRow) - size * 0.2;
          const cheek =
            facial.cheeks !== 'none' &&
            y >= noseRow + 1 &&
            y <= mouthRow &&
            x <= cx + rx * 0.28;
          const jaw = facial.jaw !== 'none' && y >= mouthRow + 1;
          const chin = facial.chin !== 'none' && y >= mouthRow + 1 && x >= cx - rx * 0.08;
          let density: HairRegion = 'none';
          for (const candidate of [
            upperLip ? facial.upperLip : 'none',
            cheek ? facial.cheeks : 'none',
            jaw ? facial.jaw : 'none',
            chin ? facial.chin : 'none',
          ] as HairRegion[]) {
            if (candidate === 'solid' || (candidate === 'stubble' && density === 'none')) density = candidate;
          }
          if (density === 'none') continue;
          const under = get(x, y) ?? C.skin;
          if (density === 'solid') {
            set(x, y, mix(under, C.beard, 0.82), 5);
          } else {
            const hash = Math.abs((x * 37 + y * 59 + x * y * 5) % 13);
            const anchor =
              (upperLip && x === Math.floor(rightAt(mouthRow) - 1)) ||
              (jaw && x === beardLeft && y === mouthRow + 1) ||
              (chin && x === Math.round(cx) && y === mouthRow + 1);
            if (anchor || hash < (native ? 6 : 4)) {
              // Stubble keeps the skin rim; solid beard alone owns a hair rim.
              set(x, y, mix(under, C.beard, native ? 0.45 : 0.25), native ? 0 : 2);
            }
          }
        }
      }
    }

    // Compact mouth just behind the profile edge, redrawn over facial hair.
    const mouthRight = Math.floor(rightAt(mouthY) - size * 0.025);
    const mouthWidth = Math.max(1, Math.round(size * 0.095));
    for (let x = mouthRight - mouthWidth; x <= mouthRight; x++) set(x, mouthY, mix(C.lip, C.outline, 0.38));
  }

  // Direction-aware headwear. Side caps get a decisive forward bill; the rear
  // view shows panel construction/band but correctly hides the front bill.
  if (hatType !== 'none') {
    const drawCrown = (
      top: number,
      bottom: number,
      centre: number,
      topHalf: number,
      bottomHalf: number,
      panel: boolean,
    ): void => {
      const span = Math.max(1, bottom - top);
      for (let y = top; y <= bottom; y++) {
        const u = smoothstep(0, 1, (y - top) / span);
        const scalpLeft = leftAt(y);
        const scalpRight = rightAt(y);
        const desiredHalf = topHalf + (bottomHalf - topHalf) * u;
        const left = Math.min(centre - desiredHalf, scalpLeft - (native ? 0.2 : 0.6));
        const right = Math.max(centre + desiredHalf, scalpRight + (native ? 0.2 : 0.6));
        for (let x = Math.ceil(left); x <= Math.floor(right); x++) {
          const edge = x === Math.ceil(left) || x === Math.floor(right);
          set(x, y, y === top ? C.hatLight : edge ? C.hatShadow : C.hat, 1);
        }
        if (panel && y > top + 1 && y < bottom) {
          const seamX = view === 'side' ? centre - (bottom - y) * 0.1 : centre;
          set(seamX, y, mix(C.hat, C.hatShadow, 0.42), 1);
        }
      }
    };
    const crownTop = Math.max(0, Math.round(cy - ry * 1.02));
    if (hatType === 'cap') {
      drawCrown(crownTop, hatBandY - 1, cx - (view === 'side' ? size * 0.035 : 0), size * 0.15, size * 0.34, true);
      const bandLeft = view === 'side' ? cx - size * 0.34 : cx - size * 0.38;
      const bandRight = view === 'side' ? cx + size * 0.3 : cx + size * 0.38;
      for (let k = 0; k < hatBandThickness; k++) fillRow(hatBandY + k, bandLeft, bandRight, k === 0 ? C.hat : C.hatShadow, 1);
      if (view === 'side') {
        const billLeft = cx + size * 0.12;
        const billRight = Math.min(size - (native ? 1 : 2), cx + size * 0.5);
        fillRow(hatBandY, billLeft, billRight, C.hat, 1);
        if (!native) fillRow(hatBandY + 1, billLeft + size * 0.025, billRight, C.hatShadow, 1);
      } else {
        // Rear panel/button cues, not a fake sideways bill.
        set(cx, crownTop, C.hatLight, 1);
        fillRow(hatBandY, cx - size * 0.11, cx + size * 0.11, C.hatLight, 1);
      }
    } else if (hatType === 'flatCap') {
      drawCrown(scalpTop, hatBandY - 1, cx - size * 0.03, size * 0.14, size * 0.36, false);
      fillRow(hatBandY, cx - size * 0.38, cx + size * (view === 'side' ? 0.47 : 0.38), C.hatShadow, 1);
    } else if (hatType === 'beanie') {
      const cuffTop = hatBandY - Math.max(1, Math.round(size * 0.08));
      drawCrown(
        crownTop,
        cuffTop - 1,
        cx,
        size * 0.15,
        size * (view === 'side' && native ? 0.3 : 0.4),
        false,
      );
      // Keep a side-view knit cuff rear-heavy. Centering its full width on the
      // forward-shifted face made it reach as far as a cap bill.
      const cuffRight = cx + size * (view === 'side' && native ? 0.3 : 0.4);
      for (let y = cuffTop; y <= hatBottomY; y++) {
        fillRow(y, cx - size * 0.4, cuffRight, y === cuffTop ? C.hat : C.hatShadow, 1);
      }
    } else if (hatType === 'beret') {
      const top = Math.max(0, Math.round(cy - ry * 0.95));
      const span = Math.max(1, hatBandY - top);
      for (let y = top; y < hatBandY; y++) {
        const u = (y - top) / span;
        const centre = cx - size * (view === 'side' ? 0.08 + 0.03 * (1 - u) : 0.06 + 0.02 * (1 - u));
        const desiredHalf = size * (0.24 + 0.18 * Math.sin(Math.PI * u));
        const left = Math.min(centre - desiredHalf, leftAt(y) - (native ? 0.2 : 0.6));
        const right = Math.max(centre + desiredHalf, rightAt(y) + (native ? 0.2 : 0.6));
        for (let x = Math.ceil(left); x <= Math.floor(right); x++) {
          const edge = x === Math.ceil(left) || x === Math.floor(right);
          set(x, y, edge ? C.hatShadow : C.hat, 1);
        }
      }
      const bandLeft = Math.min(cx - size * 0.32, leftAt(hatBandY) - (native ? 0.2 : 0.6));
      const bandRight = Math.max(cx + size * 0.32, rightAt(hatBandY) + (native ? 0.2 : 0.6));
      fillRow(hatBandY, bandLeft, bandRight, C.hatShadow, 1);
    } else if (hatType === 'topHat') {
      const top = Math.max(0, Math.round(cy - ry * 1.15));
      drawCrown(top, hatBandY - 1, cx, size * 0.26, size * 0.26, false);
      fillRow(hatBandY, cx - size * 0.44, cx + size * 0.44, C.hatShadow, 1);
    } else {
      drawCrown(crownTop, hatBandY - 1, cx, size * 0.18, size * 0.32, false);
      const rear = hatType === 'wideBrim' ? size * 0.47 : size * 0.4;
      const front = view === 'side' ? size * (hatType === 'wideBrim' ? 0.52 : 0.46) : rear;
      fillRow(hatBandY, cx - rear, cx + front, C.hatShadow, 1);
    }
  }

  const opaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < size && y < size && buf[(y * size + x) * 4 + 3] === 255;
  const rim = Buffer.from(buf);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!opaque(x, y)) continue;
      if (opaque(x - 1, y) && opaque(x + 1, y) && opaque(x, y - 1) && opaque(x, y + 1)) continue;
      const i = (y * size + x) * 4;
      const mat = material[y * size + x];
      // The native nose already carries a two-tone skin ramp; do not erase it
      // with the generic silhouette outline.
      if (mat === 4) continue;
      const softFrontProfile =
        native &&
        view === 'side' &&
        mat === 0 &&
        x >= cx + rx * 0.08 &&
        y >= eyeRow - 1 &&
        y <= noseRow + 1;
      const c =
        mat === 1
          ? C.hatOutline
          : mat === 2
            ? C.hairShadow
            : mat === 5
              ? shade(C.beard ?? C.hair, 0.65)
              : mat === 3 || softFrontProfile
                ? C.skinShadow
                : C.outline;
      rim[i] = c.r;
      rim[i + 1] = c.g;
      rim[i + 2] = c.b;
      rim[i + 3] = 255;
    }
  }
  return rim;
}

const toAvatarPng = (
  feat: NormalizedFaceFeatures,
  size: number,
  detailAt = 32,
  view: AvatarView = 'front',
): Promise<Buffer> =>
  sharp(view === 'front' ? drawAvatar(feat, size, detailAt) : drawDirectionalAvatar(feat, size, view, detailAt), {
    raw: { width: size, height: size, channels: 4 },
  })
    .png()
    .toBuffer();

export async function drawAvatarLikeness(feat: FaceFeatures): Promise<LikenessArtifacts> {
  const normalized = normalizeFaceFeatures(feat);
  const [head12, head12Side, head12Back, head16, head16Side, head16Back, portrait] = await Promise.all([
    toAvatarPng(normalized, HEAD_SPRITE_SIZES[0]),
    toAvatarPng(normalized, HEAD_SPRITE_SIZES[0], 32, 'side'),
    toAvatarPng(normalized, HEAD_SPRITE_SIZES[0], 32, 'back'),
    // 16px is now a real shipping head size. Enable the coarse, native-size
    // versions of facial hair, brows, ears, and nose instead of silently using
    // the portrait-only 32px threshold.
    toAvatarPng(normalized, HEAD_SPRITE_SIZES[1], 16),
    toAvatarPng(normalized, HEAD_SPRITE_SIZES[1], 16, 'side'),
    toAvatarPng(normalized, HEAD_SPRITE_SIZES[1], 16, 'back'),
    toAvatarPng(normalized, PORTRAIT_SIZE),
  ]);
  return { head12, head12Side, head12Back, head16, head16Side, head16Back, portrait };
}

/** Render the avatar head at an arbitrary set of sizes (Likeness Lab size compare). */
export async function drawAvatarSizes(
  feat: FaceFeatures,
  sizes: number[],
  detailAt = 32,
  view: AvatarView = 'front',
): Promise<Record<number, Buffer>> {
  const normalized = normalizeFaceFeatures(feat);
  const entries = await Promise.all(
    sizes.map(async (s) => [s, await toAvatarPng(normalized, s, detailAt, view)] as const),
  );
  return Object.fromEntries(entries);
}
