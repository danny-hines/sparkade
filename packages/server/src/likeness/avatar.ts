// Feature-driven likeness avatar: instead of quantizing the webcam photo, DRAW a
// clean pixel-art face from the traits the vision model detects (FaceFeatures).
// The model reports not just colours + accessories but PROPORTIONS (face shape,
// chin, nose size, eye spacing/shape, brow thickness/shape, ears), so the drawn
// character varies in structure per person — not just a recolour. Same output
// shape as bakeLikeness so it drops into the pipeline as an alternative.
import sharp from 'sharp';
import { HEAD_SPRITE_SIZES, PORTRAIT_SIZE } from '@sparkade/shared';
import type { FaceFeatures, FaceShape, ChinShape } from './features';
import type { LikenessArtifacts } from './likeness';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

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
  brow: Rgb;
  eyeWhite: Rgb;
  eyeDark: Rgb;
  lip: Rgb;
  glass: Rgb | null;
}
function resolveColors(feat: FaceFeatures): Colors {
  const skin = hexToRgb(normHex(feat.skinTone, '#c98f6b'));
  const bald = (feat.hairColor ?? '').trim().toLowerCase() === 'none';
  const hair = bald ? shade(skin, 0.55) : hexToRgb(normHex(feat.hairColor, '#2a2320'));
  const hasHat = !!feat.headwear && (feat.headwearColor ?? '').trim().toLowerCase() !== 'none';
  const hat = hasHat ? hexToRgb(normHex(feat.headwearColor, '#3a4a63')) : hair;
  const noBeard = (feat.facialHair ?? 'none') === 'none' || (feat.facialHairColor ?? '').trim().toLowerCase() === 'none';
  const beard = noBeard ? null : hexToRgb(normHex(feat.facialHairColor, bald ? '#4a3a2e' : normHex(feat.hairColor, '#2a2320')));
  return {
    outline: shade(skin, 0.32),
    skin,
    skinLight: shade(skin, 1.12),
    skinShadow: shade(skin, 0.82),
    bald,
    hair,
    hairShadow: shade(hair, 0.7),
    hairLight: shade(hair, 1.2),
    beard,
    hasHat,
    hat,
    hatShadow: shade(hat, 0.74),
    hatLight: shade(hat, 1.2),
    brow: bald ? shade(skin, 0.5) : shade(hair, 0.85),
    eyeWhite: { r: 238, g: 236, b: 230 },
    eyeDark: { r: 30, g: 28, b: 40 },
    lip: mix(skin, { r: 156, g: 52, b: 80 }, 0.5),
    glass: feat.glasses ? { r: 32, g: 32, b: 42 } : null,
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

/** One pixel avatar for a given size. */
function drawAvatar(feat: FaceFeatures, size: number): Buffer {
  const C = resolveColors(feat);
  const detail = size >= 32; // brows / nose / glasses / structured facial hair need the portrait

  const faceShape = feat.faceShape ?? 'oval';
  const chin = feat.chin ?? 'round';
  const anchors = anchorsFor(faceShape, chin);
  const cx = (size - 1) / 2;
  const cy = size * 0.52;
  const rx = SHAPE_RX[faceShape] * size;
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
  const set = (x: number, y: number, c: Rgb): void => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return;
    const i = (yi * size + xi) * 4;
    buf[i] = c.r;
    buf[i + 1] = c.g;
    buf[i + 2] = c.b;
    buf[i + 3] = 255;
  };
  const fillDisc = (dcx: number, dcy: number, drx: number, dry: number, c: Rgb, faceOnly = false): void => {
    for (let y = Math.floor(dcy - dry); y <= Math.ceil(dcy + dry); y++) {
      for (let x = Math.floor(dcx - drx); x <= Math.ceil(dcx + drx); x++) {
        const ex = (x - dcx) / drx;
        const ey = (y - dcy) / dry;
        if (ex * ex + ey * ey <= 1 && (!faceOnly || inFace(x, y))) set(x, y, c);
      }
    }
  };

  // --- ears (behind the face) -----------------------------------------------
  const ears = feat.ears ?? 'average';
  if (ears !== 'hidden' && detail) {
    const earScale = ears === 'prominent' ? 1.25 : ears === 'small' ? 0.8 : 1;
    const earY = cy + ry * 0.02;
    const earR = size * 0.09 * earScale;
    for (const dir of [-1, 1]) {
      const ex = cx + dir * (halfW(earY) + earR * 0.55);
      fillDisc(ex, earY, earR * 0.8, earR, C.skin);
      fillDisc(ex + dir * earR * 0.15, earY, earR * 0.42, earR * 0.6, C.skinShadow);
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

  // --- hair: crown cap down to the hairline + temples framing the face -------
  const hairline = cy - ry * 0.34;
  if (!C.bald) {
    for (let y = Math.floor(cy - ry * 1.14); y <= Math.ceil(cy + ry * 0.3); y++) {
      const outerHw = halfW(y) * 1.08;
      for (let x = Math.floor(cx - rx * 1.14); x <= Math.ceil(cx + rx * 1.14); x++) {
        const outer = ((x - cx) / (rx * 1.08)) ** 2 + ((y - cy) / (ry * 1.06)) ** 2;
        if (outer > 1) continue;
        const isTop = y <= hairline;
        const isTemple = y <= cy - ry * 0.02 && Math.abs(x - cx) > halfW(y) * 0.66;
        if (!isTop && !isTemple) continue;
        const c = y < cy - ry * 0.8 ? C.hairLight : Math.abs(x - cx) > outerHw ? C.hairShadow : C.hair;
        set(x, y, c);
      }
    }
  }

  // --- facial hair: shaped by style, jaw-hugging (not a flat lower-face fill) -
  const style = feat.facialHair ?? 'none';
  const eyeY = cy - ry * 0.06;
  const mouthY = cy + ry * 0.5;
  if (C.beard && style !== 'none' && detail) {
    const stubble = style === 'stubble';
    for (let y = Math.floor(eyeY); y <= Math.ceil(cy + ry); y++) {
      const hw = halfW(y);
      for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) {
        if (!inFace(x, y)) continue;
        const edge = Math.abs(x - cx) / hw; // 0 centre → 1 jaw rim
        let on = false;
        if (style === 'mustache') {
          on = y >= mouthY - size * 0.1 && y <= mouthY - size * 0.03 && Math.abs(x - cx) < rx * 0.42;
        } else if (style === 'goatee') {
          const chinPatch = y > mouthY - size * 0.02 && Math.abs(x - cx) < hw * 0.55;
          const stache = y >= mouthY - size * 0.1 && y <= mouthY - size * 0.03 && Math.abs(x - cx) < rx * 0.4;
          on = chinPatch || stache;
        } else {
          // beard / stubble: U-shape framing the mouth — starts high at the jaw
          // rim (sideburns) and low in the centre (below the mouth).
          const topAtEdge = eyeY + ry * 0.16;
          const topAtCentre = mouthY + size * 0.04;
          const topY = topAtCentre + (topAtEdge - topAtCentre) * smoothstep(0.35, 0.95, edge);
          on = y >= topY;
        }
        if (!on) continue;
        const base = edge > 0.72 ? shade(C.beard, 0.82) : C.beard;
        set(x, y, stubble ? mix(C.skin, base, (x + y) % 2 === 0 ? 0.5 : 0.28) : base);
      }
    }
  }

  // --- eyes (spacing + shape) -----------------------------------------------
  const eyeDX = rx * (feat.eyeSpacing === 'close' ? 0.34 : feat.eyeSpacing === 'wide' ? 0.5 : 0.42);
  const eyeShape = feat.eyeShape ?? 'almond';
  const eyeRX = size * (eyeShape === 'round' ? 0.072 : eyeShape === 'narrow' ? 0.08 : 0.088);
  const eyeRY = size * (eyeShape === 'round' ? 0.066 : eyeShape === 'narrow' ? 0.042 : 0.052);
  for (const dir of [-1, 1]) {
    const ex = cx + dir * eyeDX;
    fillDisc(ex, eyeY, eyeRX, eyeRY, C.eyeWhite, true);
    fillDisc(ex + dir * eyeRX * 0.12, eyeY + eyeRY * 0.05, Math.max(0.9, eyeRX * 0.6), Math.max(0.9, eyeRY * 0.86), C.eyeDark);
    if (detail) {
      // eyebrow: thickness + shape
      const thick = Math.max(1, Math.round(size * (feat.eyebrows === 'thin' ? 0.02 : feat.eyebrows === 'thick' ? 0.05 : 0.032)));
      const browY = eyeY - eyeRY - size * 0.05;
      for (let x = Math.round(ex - eyeRX); x <= Math.round(ex + eyeRX); x++) {
        const f = (x - ex) / eyeRX; // -1 inner? depends on dir
        const inner = -dir * f; // >0 toward the nose
        let dy = 0;
        if (feat.eyebrowShape === 'arched') dy = Math.abs(f) * size * 0.03; // ends dip, middle raised
        else if (feat.eyebrowShape === 'angled') dy = inner * size * 0.03; // inner end lower
        for (let k = 0; k < thick; k++) set(x, browY + dy + k, C.brow);
      }
    }
    if (C.glass) {
      const lx = eyeRX + size * 0.045;
      const ly = eyeRY + size * 0.05;
      for (let x = Math.round(ex - lx); x <= Math.round(ex + lx); x++) {
        set(x, Math.round(eyeY - ly), C.glass);
        set(x, Math.round(eyeY + ly), C.glass);
      }
      for (let y = Math.round(eyeY - ly); y <= Math.round(eyeY + ly); y++) {
        set(Math.round(ex - lx), y, C.glass);
        set(Math.round(ex + lx), y, C.glass);
      }
    }
  }
  if (C.glass) {
    for (let x = Math.round(cx - eyeDX + eyeRX); x <= Math.round(cx + eyeDX - eyeRX); x++) set(x, Math.round(eyeY - size * 0.02), C.glass);
  }

  // --- nose (size) -----------------------------------------------------------
  if (detail) {
    const noseHalf = size * (feat.noseSize === 'small' ? 0.03 : feat.noseSize === 'large' ? 0.06 : 0.045);
    const noseTip = cy + ry * (feat.noseSize === 'small' ? 0.18 : feat.noseSize === 'large' ? 0.32 : 0.26);
    for (let y = Math.round(eyeY + eyeRY + size * 0.03); y <= Math.round(noseTip); y++) set(cx + size * 0.02, y, C.skinShadow);
    set(cx - noseHalf, Math.round(noseTip), C.skinShadow); // nostril hints
    set(cx + noseHalf, Math.round(noseTip), C.skinShadow);
  }

  // --- mouth: gentle smile over any beard ------------------------------------
  const mouthW = rx * 0.5;
  for (let x = -mouthW; x <= mouthW; x++) {
    const yy = mouthY + Math.cos((x / mouthW) * (Math.PI / 2)) * size * 0.03;
    set(cx + x, yy, C.lip);
    if (detail) set(cx + x, yy + 1, shade(C.lip, 0.8));
  }

  // --- headwear: beanie/cap over the crown with a brim band ------------------
  if (C.hasHat) {
    const brimY = cy - ry * 0.42;
    for (let y = Math.floor(cy - ry * 1.2); y <= Math.ceil(brimY); y++) {
      for (let x = Math.floor(cx - rx * 1.16); x <= Math.ceil(cx + rx * 1.16); x++) {
        const outer = ((x - cx) / (rx * 1.1)) ** 2 + ((y - cy) / (ry * 1.14)) ** 2;
        if (outer > 1) continue;
        let c = y < cy - ry * 0.86 ? C.hatLight : C.hat;
        if (y >= brimY - Math.max(1, size * 0.06)) c = C.hatShadow;
        set(x, y, c);
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
        rim[i] = C.outline.r;
        rim[i + 1] = C.outline.g;
        rim[i + 2] = C.outline.b;
        rim[i + 3] = 255;
      }
    }
  }
  return rim;
}

export async function drawAvatarLikeness(feat: FaceFeatures): Promise<LikenessArtifacts> {
  const toPng = (size: number): Promise<Buffer> =>
    sharp(drawAvatar(feat, size), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  const [head12, head16, portrait] = await Promise.all([toPng(HEAD_SPRITE_SIZES[0]), toPng(HEAD_SPRITE_SIZES[1]), toPng(PORTRAIT_SIZE)]);
  return { head12, head16, portrait };
}
