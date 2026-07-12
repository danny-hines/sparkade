// Feature-driven likeness avatar: instead of quantizing the webcam photo, DRAW a
// clean pixel-art face from the traits the vision model already detects
// (FaceFeatures) — skin tone, hair colour, glasses, facial hair, headwear. The
// result is a deliberately-authored 8-bit character with the player's colouring
// and accessories, consistent regardless of lighting or webcam quality. Same
// output shape as bakeLikeness so it drops into the pipeline as an alternative.
import sharp from 'sharp';
import { HEAD_SPRITE_SIZES, PORTRAIT_SIZE } from '@sparkade/shared';
import type { FaceFeatures } from './features';
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

interface Palette {
  outline: Rgb;
  skin: Rgb;
  skinLight: Rgb;
  skinShadow: Rgb;
  skinDeep: Rgb;
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

function resolvePalette(feat: FaceFeatures): Palette {
  const skin = hexToRgb(normHex(feat.skinTone, '#c98f6b'));
  const bald = (feat.hairColor ?? '').trim().toLowerCase() === 'none';
  const hair = bald ? shade(skin, 0.55) : hexToRgb(normHex(feat.hairColor, '#2a2320'));
  const hasHat = !!feat.headwear && (feat.headwearColor ?? '').trim().toLowerCase() !== 'none';
  const hat = hasHat ? hexToRgb(normHex(feat.headwearColor, '#3a4a63')) : hair;
  const facial = !!feat.facialHair;
  return {
    outline: shade(skin, 0.32),
    skin,
    skinLight: shade(skin, 1.12),
    skinShadow: shade(skin, 0.82),
    skinDeep: shade(skin, 0.66),
    bald,
    hair,
    hairShadow: shade(hair, 0.7),
    hairLight: shade(hair, 1.2),
    beard: facial ? (bald ? shade(skin, 0.5) : shade(hair, 0.92)) : null,
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

/** One pixel canvas with an oval face mask + 1px dark rim, drawn by math. */
function drawAvatar(feat: FaceFeatures, size: number): Buffer {
  const P = resolvePalette(feat);
  const buf = Buffer.alloc(size * size * 4); // transparent
  const detail = size >= 32; // brows / nose / glasses / mustache only on the portrait

  const cx = (size - 1) / 2;
  const cy = size * 0.52;
  const rx = size * 0.4;
  const ry = size * 0.47;

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
  // normalized offset from the face-oval centre (1 = on the rim)
  const nrm = (x: number, y: number): number => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy;
  };
  const inFace = (x: number, y: number): boolean => nrm(x, y) <= 1;
  const fillDisc = (dcx: number, dcy: number, drx: number, dry: number, c: Rgb, faceOnly = false): void => {
    for (let y = Math.floor(dcy - dry); y <= Math.ceil(dcy + dry); y++) {
      for (let x = Math.floor(dcx - drx); x <= Math.ceil(dcx + drx); x++) {
        const ex = (x - dcx) / drx;
        const ey = (y - dcy) / dry;
        if (ex * ex + ey * ey <= 1 && (!faceOnly || inFace(x, y))) set(x, y, c);
      }
    }
  };

  // --- skin base with soft vertical shading (light forehead → shadowed jaw) ---
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = nrm(x, y);
      if (n > 1) continue;
      const t = (y - (cy - ry)) / (2 * ry); // 0 top → 1 bottom
      let c = t < 0.32 ? mix(P.skinLight, P.skin, t / 0.32) : t < 0.68 ? P.skin : mix(P.skin, P.skinShadow, (t - 0.68) / 0.32);
      if (n > 0.72) c = mix(c, P.skinShadow, 0.5); // rim shadow for roundness
      set(x, y, c);
    }
  }

  // --- hair: a cap from the crown down to the forehead, plus temples ---------
  const hairline = cy - ry * 0.34;
  if (!P.bald) {
    for (let y = Math.floor(cy - ry * 1.12); y <= Math.ceil(cy + ry * 0.35); y++) {
      for (let x = Math.floor(cx - rx * 1.12); x <= Math.ceil(cx + rx * 1.12); x++) {
        // hair occupies a slightly larger oval than the face, above the hairline
        const outer = ((x - cx) / (rx * 1.08)) ** 2 + ((y - cy) / (ry * 1.06)) ** 2;
        if (outer > 1) continue;
        const templeY = cy - ry * 0.02;
        const isTop = y <= hairline;
        const isTemple = y <= templeY && Math.abs(x - cx) > rx * 0.62; // sides frame the face
        if (!isTop && !isTemple) continue;
        const c = y < cy - ry * 0.8 ? P.hairLight : nrm(x, y) > 1 ? P.hairShadow : P.hair;
        set(x, y, c);
      }
    }
  }

  const eyeY = cy - ry * 0.08;
  const eyeDX = rx * 0.42;
  const eyeRX = Math.max(1.1, size * 0.078);
  const eyeRY = Math.max(1, size * 0.058);

  // --- beard: fill the lower face under the cheekbones, keep the mouth clear --
  if (P.beard) {
    for (let y = Math.floor(eyeY); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (!inFace(x, y)) continue;
        const jaw = (y - (cy + ry * 0.02)) / (ry * 0.98); // below mid-face
        const sideburn = Math.abs(x - cx) > rx * 0.5 && y > eyeY + ry * 0.05;
        if (jaw > 0 || sideburn) set(x, y, nrm(x, y) > 0.7 ? shade(P.beard, 0.85) : P.beard);
      }
    }
  }

  // --- eyes (whites + pupils), browed and be-spectacled on the portrait ------
  for (const dir of [-1, 1]) {
    const ex = cx + dir * eyeDX;
    fillDisc(ex, eyeY, eyeRX, eyeRY, P.eyeWhite, true);
    fillDisc(ex + dir * eyeRX * 0.12, eyeY + eyeRY * 0.05, Math.max(0.9, eyeRX * 0.66), Math.max(0.9, eyeRY * 0.86), P.eyeDark);
    if (detail) {
      // eyebrow
      for (let x = Math.round(ex - eyeRX); x <= Math.round(ex + eyeRX); x++) set(x, Math.round(eyeY - eyeRY - size * 0.045), P.brow);
    }
    if (P.glass) {
      // rectangular lens frame around the eye + temple arm
      const lx = eyeRX + size * 0.05;
      const ly = eyeRY + size * 0.05;
      for (let x = Math.round(ex - lx); x <= Math.round(ex + lx); x++) {
        set(x, Math.round(eyeY - ly), P.glass);
        set(x, Math.round(eyeY + ly), P.glass);
      }
      for (let y = Math.round(eyeY - ly); y <= Math.round(eyeY + ly); y++) {
        set(Math.round(ex - lx), y, P.glass);
        set(Math.round(ex + lx), y, P.glass);
      }
    }
  }
  if (P.glass) {
    // bridge between lenses
    for (let x = Math.round(cx - eyeDX + eyeRX); x <= Math.round(cx + eyeDX - eyeRX); x++) set(x, Math.round(eyeY - size * 0.02), P.glass);
  }

  // --- nose + mouth ----------------------------------------------------------
  if (detail) {
    const noseY0 = eyeY + eyeRY + size * 0.03;
    for (let y = Math.round(noseY0); y <= Math.round(cy + ry * 0.26); y++) set(cx + size * 0.03, y, P.skinShadow);
    set(cx - size * 0.05, Math.round(cy + ry * 0.26), P.skinShadow);
  }
  // mouth: a gentle smile in lip colour, drawn over any beard
  const mouthY = cy + ry * 0.52;
  const mouthW = rx * 0.5;
  for (let x = -mouthW; x <= mouthW; x++) {
    const yy = mouthY + Math.cos((x / mouthW) * (Math.PI / 2)) * size * 0.03; // gentle smile
    set(cx + x, yy, P.lip);
    if (detail) set(cx + x, yy + 1, shade(P.lip, 0.8));
  }

  // --- headwear: a beanie/cap over the crown with a brim band ----------------
  if (P.hasHat) {
    const brimY = cy - ry * 0.42;
    for (let y = Math.floor(cy - ry * 1.18); y <= Math.ceil(brimY); y++) {
      for (let x = Math.floor(cx - rx * 1.14); x <= Math.ceil(cx + rx * 1.14); x++) {
        const outer = ((x - cx) / (rx * 1.1)) ** 2 + ((y - cy) / (ry * 1.12)) ** 2;
        if (outer > 1) continue;
        let c = y < cy - ry * 0.85 ? P.hatLight : P.hat;
        if (y >= brimY - Math.max(1, size * 0.06)) c = P.hatShadow; // brim band
        set(x, y, c);
      }
    }
  }

  // --- 1px outline just inside the face rim + around the silhouette ----------
  const opaque = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    return buf[(y * size + x) * 4 + 3] === 255;
  };
  const rim = Buffer.from(buf);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!opaque(x, y)) continue;
      if (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1)) {
        const i = (y * size + x) * 4;
        rim[i] = P.outline.r;
        rim[i + 1] = P.outline.g;
        rim[i + 2] = P.outline.b;
        rim[i + 3] = 255;
      }
    }
  }
  return rim;
}

export async function drawAvatarLikeness(feat: FaceFeatures): Promise<LikenessArtifacts> {
  const toPng = (size: number): Promise<Buffer> =>
    sharp(drawAvatar(feat, size), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  const [head12, head16, portrait] = await Promise.all([
    toPng(HEAD_SPRITE_SIZES[0]),
    toPng(HEAD_SPRITE_SIZES[1]),
    toPng(PORTRAIT_SIZE),
  ]);
  return { head12, head16, portrait };
}
