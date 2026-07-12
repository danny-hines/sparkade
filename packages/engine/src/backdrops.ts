// Procedural parallax backdrop generator: gradient + starfield / hills / clouds
// variants keyed by the game's palette and seed. Rendered once at load time to
// offscreen canvases; runtime cost is two drawImage calls per layer.
import { BACKDROP_VARIANTS, INTERNAL_HEIGHT, INTERNAL_WIDTH } from '@sparkade/shared';
import type { BackdropVariantId } from '@sparkade/shared';
import { Rng } from './rng';

export type BackdropVariant = BackdropVariantId;

export { BACKDROP_VARIANTS };

export interface Backdrop {
  /** Draw the two background layers with parallax; scrollX/scrollY in world pixels. */
  draw(ctx: CanvasRenderingContext2D, scrollX: number, scrollY: number): void;
  /**
   * Optional close foreground layer (parallax > 1), meant to be drawn AFTER
   * tiles/entities so it passes in front of gameplay for depth. Top-anchored so
   * it never hides the player. A no-op when the variant has no foreground.
   */
  drawForeground(ctx: CanvasRenderingContext2D, scrollX: number, scrollY: number): void;
}

function shade(hex: string, factor: number): string {
  const r = Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) * factor)));
  const b = Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) * factor)));
  return `rgb(${r},${g},${b})`;
}

function luminance(hex: string): number {
  return (
    0.2126 * parseInt(hex.slice(1, 3), 16) +
    0.7152 * parseInt(hex.slice(3, 5), 16) +
    0.0722 * parseInt(hex.slice(5, 7), 16)
  );
}

/** fillRect that wraps horizontally so the layer's tile seam stays invisible. */
function wrapRect(
  ctx: CanvasRenderingContext2D,
  W: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const xm = ((Math.round(x) % W) + W) % W;
  ctx.fillRect(xm, y, w, h);
  if (xm + w > W) ctx.fillRect(xm - W, y, w, h);
}

/** Filled disc that wraps horizontally (drawn again across the seam if clipped). */
function wrapDisc(ctx: CanvasRenderingContext2D, W: number, x: number, y: number, r: number): void {
  const xm = ((Math.round(x) % W) + W) % W;
  for (const dx of [0, -W, W]) {
    const cx = xm + dx;
    if (cx + r < 0 || cx - r > W) continue;
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Stepped (quantized-column) triangle peak with an optional two-tone snow cap. */
function steppedPeak(
  ctx: CanvasRenderingContext2D,
  W: number,
  bottom: number,
  cx: number,
  base: number,
  h: number,
  hw: number,
  ridge: string,
  snow?: { lo: string; hi: string },
): void {
  const snowBottom = base - h + Math.floor(h * 0.3);
  for (let sx = -hw; sx <= hw; sx++) {
    let ch = Math.floor((h * (hw - Math.abs(sx))) / hw);
    ch = Math.floor(ch / 3) * 3;
    if (ch <= 0) continue;
    const top = base - ch;
    ctx.fillStyle = ridge;
    wrapRect(ctx, W, cx + sx, top, 1, bottom - top);
    if (snow && top < snowBottom) {
      ctx.fillStyle = snow.lo;
      wrapRect(ctx, W, cx + sx, top, 1, snowBottom - top);
      ctx.fillStyle = snow.hi;
      wrapRect(ctx, W, cx + sx, top, 1, Math.min(3, snowBottom - top));
    }
  }
}

/**
 * Pick a variant deterministically from palette mood + seed. The pick pool is
 * frozen at the original four: published games without a `backdrop` spec field
 * re-derive their backdrop from the seed at load, so growing this pool would
 * silently repaint existing libraries. New variants are opt-in via the spec.
 */
export function pickVariant(palette: string[], seed: number, prefer?: BackdropVariant): BackdropVariant {
  if (prefer) return prefer;
  const rng = new Rng(seed ^ 0xbadc0de);
  const bgLum = luminance(palette[2] ?? '#202040');
  if (bgLum < 40) return rng.chance(0.5) ? 'starfield' : 'caves';
  return rng.chance(0.5) ? 'hills' : 'clouds';
}

export function makeBackdrop(palette: string[], seed: number, variant?: BackdropVariant): Backdrop {
  const v = pickVariant(palette, seed, variant);
  const rng = new Rng(seed ^ 0x5eed);
  const dark = palette[2] ?? '#1a1c2c';
  const mid = palette[3] ?? '#29366f';
  const light = palette[4] ?? '#3b5dc9';

  const W = INTERNAL_WIDTH;
  const H = INTERNAL_HEIGHT;

  // Far layer: vertical gradient (banded, SNES-style — no smooth gradients).
  const far = document.createElement('canvas');
  far.width = W;
  far.height = H;
  {
    const ctx = far.getContext('2d')!;
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = shade(dark, 0.55 + (i / bands) * 0.7);
      ctx.fillRect(0, Math.floor((i * H) / bands), W, Math.ceil(H / bands));
    }
    if (v === 'starfield' || v === 'caves') {
      for (let i = 0; i < 90; i++) {
        const bright = rng.chance(0.25);
        ctx.fillStyle = bright ? '#ffffff' : shade(light, 1.2);
        ctx.globalAlpha = bright ? 0.9 : 0.5;
        ctx.fillRect(rng.int(0, W - 1), rng.int(0, H - 1), 1 + (bright ? 1 : 0), 1 + (bright ? 1 : 0));
      }
      ctx.globalAlpha = 1;
    } else if (v === 'mountains') {
      // tiny hazy peaks on the horizon
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < 6; i++) {
        const h = rng.int(12, 24);
        const base = rng.int(170, 210);
        steppedPeak(ctx, W, base, rng.int(0, W - 1), base, h, h, shade(dark, 1.2));
      }
      ctx.globalAlpha = 1;
    } else if (v === 'candy') {
      // striped swirl "sun" discs: concentric flat rings
      const discs = rng.int(1, 2);
      for (let d = 0; d < discs; d++) {
        const cx = rng.int(40, W - 40);
        const cy = rng.int(30, 95);
        const r0 = rng.int(16, 26);
        for (let r = r0, ring = 0; r > 0; r -= 5, ring++) {
          ctx.fillStyle = ring % 2 === 0 ? shade(light, 1.25) : shade(mid, 0.9);
          wrapDisc(ctx, W, cx, cy, r);
        }
      }
    } else if (v === 'city') {
      // sparse night sky over the skyline
      ctx.globalAlpha = 0.45;
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = rng.chance(0.2) ? '#ffffff' : shade(light, 1.2);
        ctx.fillRect(rng.int(0, W - 1), rng.int(0, 160), 1, 1);
      }
      ctx.globalAlpha = 1;
    } else if (v === 'ruins') {
      // dim broken stubs on a distant horizon strip
      ctx.fillStyle = shade(dark, 0.8);
      ctx.globalAlpha = 0.5;
      let x = rng.int(0, 12);
      while (x < W) {
        const w = rng.int(14, 34);
        const h = rng.int(8, 28);
        if (rng.chance(0.7)) wrapRect(ctx, W, x, 210 - h, w, h);
        x += w + rng.int(6, 18);
      }
      ctx.globalAlpha = 1;
    } else if (v === 'pyramids') {
      // banded sun/moon disc
      const cx = rng.int(60, W - 60);
      const cy = rng.int(36, 80);
      const r = rng.int(18, 28);
      ctx.fillStyle = shade(light, 1.25);
      wrapDisc(ctx, W, cx, cy, r);
      ctx.fillStyle = shade(light, 1.0);
      for (let dy = 3; dy < r; dy += 5) {
        const hwc = Math.floor(Math.sqrt(r * r - dy * dy));
        wrapRect(ctx, W, cx - hwc, cy + dy, hwc * 2, 2);
      }
      // low banded dune humps
      ctx.fillStyle = shade(dark, 1.25);
      for (let i = 0; i < 4; i++) {
        const dr = rng.int(60, 110);
        wrapDisc(ctx, W, rng.int(0, W - 1), H + Math.floor(dr * 0.55), dr);
      }
    } else if (v === 'circuit') {
      // faint board grid (32px pitch divides W so the tile seam stays clean)
      ctx.fillStyle = shade(mid, 0.6);
      ctx.globalAlpha = 0.35;
      for (let gx = 0; gx < W; gx += 32) ctx.fillRect(gx, 0, 1, H);
      for (let gy = 0; gy < H; gy += 32) ctx.fillRect(0, gy, W, 1);
      ctx.globalAlpha = 1;
    } else if (v === 'factory') {
      // hanging smog bands
      ctx.fillStyle = shade(mid, 0.9);
      ctx.globalAlpha = 0.18;
      for (let i = 0; i < 3; i++) ctx.fillRect(0, rng.int(110, 210), W, rng.int(6, 14));
      ctx.globalAlpha = 1;
    }
  }

  // Near layer: silhouettes, tiles horizontally.
  const near = document.createElement('canvas');
  near.width = W;
  near.height = H;
  {
    const ctx = near.getContext('2d')!;
    if (v === 'hills') {
      for (let layer = 0; layer < 2; layer++) {
        ctx.fillStyle = shade(mid, layer === 0 ? 0.7 : 0.95);
        const base = H - 40 - layer * 45;
        let x = 0;
        // Build a wrapping skyline so the tile seam is invisible.
        const heights: number[] = [];
        const segs = 8;
        for (let i = 0; i < segs; i++) heights.push(rng.int(15, 70));
        for (let i = 0; i < segs; i++) {
          const w = W / segs;
          const h0 = heights[i]!;
          const h1 = heights[(i + 1) % segs]!;
          for (let sx = 0; sx < w; sx++) {
            const t = sx / w;
            const hh = Math.round(h0 + (h1 - h0) * (t * t * (3 - 2 * t)));
            ctx.fillRect(x + sx, base - hh, 1, H - (base - hh));
          }
          x += w;
        }
      }
    } else if (v === 'clouds') {
      for (let i = 0; i < 14; i++) {
        const cx = rng.int(0, W - 1);
        const cy = rng.int(10, H - 120);
        const cw = rng.int(30, 80);
        ctx.fillStyle = shade(light, 1.15);
        ctx.globalAlpha = 0.55;
        for (let p = 0; p < 4; p++) {
          const px = cx + rng.int(-cw / 2, cw / 2);
          const pw = rng.int(14, cw);
          // wrap horizontally
          ctx.fillRect((px + W) % W, cy + rng.int(-4, 4), pw, rng.int(5, 9));
          if (px + pw > W) ctx.fillRect(px - W, cy, pw, 8);
        }
      }
      ctx.globalAlpha = 1;
    } else if (v === 'caves') {
      // stalactite/skyline silhouette top and bottom
      ctx.fillStyle = shade(dark, 0.8);
      const segs = 16;
      for (let i = 0; i < segs; i++) {
        const w = W / segs;
        ctx.fillRect(i * w, 0, w, rng.int(10, 60));
        ctx.fillRect(i * w, H - rng.int(10, 50), w, 60);
      }
    } else if (v === 'mountains') {
      // two ridge layers: far ridge lighter/hazy, near ridge darker; snow caps
      for (let layer = 0; layer < 2; layer++) {
        const ridge = shade(mid, layer === 0 ? 0.95 : 0.6);
        const snow =
          layer === 0
            ? { lo: shade(light, 1.2), hi: shade(light, 1.3) }
            : { lo: shade(light, 1.25), hi: shade(light, 1.35) };
        const base = layer === 0 ? H - 58 : H - 14;
        ctx.fillStyle = ridge;
        ctx.fillRect(0, base, W, H - base);
        const peaks = layer === 0 ? 5 : 4;
        for (let i = 0; i < peaks; i++) {
          const cx = Math.floor(((i + 0.5) * W) / peaks) + rng.int(-22, 22);
          const h = layer === 0 ? rng.int(60, 100) : rng.int(55, 95);
          const hw = rng.int(Math.floor(h * 0.55), Math.floor(h * 0.9));
          steppedPeak(ctx, W, H, cx, base, h, hw, ridge, snow);
        }
      }
    } else if (v === 'candy') {
      // rounded lollipop-hill bumps in two layers + candy-dot sprinkles
      for (let layer = 0; layer < 2; layer++) {
        ctx.fillStyle = shade(mid, layer === 0 ? 0.9 : 0.62);
        const base = layer === 0 ? H - 58 : H - 14;
        ctx.fillRect(0, base, W, H - base);
        const bumps = layer === 0 ? 6 : 5;
        for (let i = 0; i < bumps; i++) {
          const cx = Math.floor(((i + 0.5) * W) / bumps) + rng.int(-25, 25);
          const r = rng.int(24, 48);
          wrapDisc(ctx, W, cx, base + Math.floor(r * 0.25), r);
        }
      }
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = rng.chance(0.3) ? '#ffffff' : shade(light, 1.2);
        wrapRect(ctx, W, rng.int(0, W - 1), rng.int(H - 95, H - 8), 2, 2);
      }
      ctx.globalAlpha = 1;
    } else if (v === 'city') {
      // futuristic skyline: towers, antenna spires, sparse lit windows, monorail
      const tower = shade(mid, 0.6);
      let x = 0;
      while (x < W) {
        const tw = rng.int(22, 46);
        const th = rng.int(60, 170);
        const top = H - th;
        ctx.fillStyle = tower;
        wrapRect(ctx, W, x, top, tw, th);
        if (rng.chance(0.5)) wrapRect(ctx, W, x + Math.floor(tw / 2), top - rng.int(10, 30), 1, 30);
        ctx.fillStyle = shade(light, 1.3);
        for (let wy = top + 6; wy < H - 10; wy += 8) {
          for (let wx = x + 4; wx < x + tw - 4; wx += 6) {
            if (rng.chance(0.12)) wrapRect(ctx, W, wx, wy, 2, 1);
          }
        }
        x += tw + rng.int(2, 10);
      }
      // Elevated monorail. Structure it so it reads as a transit line, not a
      // seam: support pylons down to the ground, a beam with a bright top edge,
      // running lights, and one lit car. Pylon/light spacings divide W (512) so
      // the horizontally-tiled near layer has no visible seam.
      const railY = H - rng.int(80, 100);
      ctx.fillStyle = shade(mid, 1.15); // lighter than the towers (mid×0.6) → visible against them
      for (let px = rng.int(0, 64); px < W; px += 64) {
        ctx.fillRect(px, railY + 3, 3, H - railY - 3); // support pylon to the ground
        ctx.fillRect(px - 2, railY + 1, 7, 3); // cap under the beam
      }
      ctx.fillStyle = shade(light, 0.85); // beam body
      ctx.fillRect(0, railY, W, 3);
      ctx.fillStyle = shade(light, 1.4); // bright top rail
      ctx.fillRect(0, railY - 1, W, 1);
      ctx.fillStyle = shade(light, 1.5); // running lights
      for (let lx = rng.int(0, 16); lx < W; lx += 16) ctx.fillRect(lx, railY + 1, 1, 1);
      const carX = rng.int(24, W - 44); // a single car on the line
      ctx.fillStyle = shade(light, 1.15);
      ctx.fillRect(carX, railY - 5, 20, 6);
      ctx.fillStyle = shade(light, 1.7);
      for (let wx = carX + 3; wx < carX + 17; wx += 4) ctx.fillRect(wx, railY - 4, 2, 2); // windows
    } else if (v === 'ruins') {
      // broken skyline: shorn towers, dark window holes, slabs, rubble, I-beams
      const wall = shade(mid, 0.7);
      ctx.fillStyle = wall;
      ctx.fillRect(0, H - 14, W, 14);
      let x = rng.int(0, 12);
      while (x < W) {
        const tw = rng.int(26, 50);
        const th = rng.int(50, 130);
        const top = H - th;
        ctx.fillStyle = wall;
        const cols = 4;
        const cw = Math.ceil(tw / cols);
        for (let c = 0; c < cols; c++) {
          wrapRect(ctx, W, x + c * cw, top + rng.int(0, 22), cw, th);
        }
        ctx.fillStyle = shade(dark, 0.6);
        for (let wy = top + 28; wy < H - 22; wy += 12) {
          for (let wx = x + 5; wx < x + tw - 6; wx += 9) {
            if (rng.chance(0.4)) wrapRect(ctx, W, wx, wy, 3, 4);
          }
        }
        if (rng.chance(0.45)) {
          ctx.fillStyle = shade(light, 1.2);
          wrapRect(ctx, W, x + rng.int(2, tw - 10), top + rng.int(2, 8), rng.int(6, 12), 1);
        }
        x += tw + rng.int(10, 30);
      }
      ctx.fillStyle = shade(mid, 0.55);
      for (let i = 0; i < 3; i++) {
        const sx = rng.int(0, W - 1);
        const steps = rng.int(8, 14);
        const dir = rng.chance(0.5) ? 1 : -1;
        for (let s = 0; s < steps; s++) wrapRect(ctx, W, sx + s * 3 * dir, H - 12 - s * 4, 8, 5);
      }
      ctx.fillStyle = shade(mid, 0.62);
      for (let i = 0; i < 6; i++) {
        const r = rng.int(6, 14);
        wrapDisc(ctx, W, rng.int(0, W - 1), H - 10 + Math.floor(r * 0.3), r);
      }
    } else if (v === 'pyramids') {
      // low horizon band + stepped pyramids with lit and shadow faces
      ctx.fillStyle = shade(mid, 0.8);
      ctx.fillRect(0, H - 26, W, 26);
      const count = rng.int(2, 3);
      for (let i = 0; i < count; i++) {
        const cx = Math.floor(((i + 0.5) * W) / count) + rng.int(-30, 30);
        const ph = rng.int(70, 115);
        const hw = Math.floor(ph * rng.range(0.75, 1.0));
        const stepH = 7;
        const steps = Math.floor(ph / stepH);
        const baseY = H - 22;
        for (let s = 0; s < steps; s++) {
          const y = baseY - (s + 1) * stepH;
          const w = Math.round((hw * (steps - s)) / steps);
          ctx.fillStyle = shade(mid, 1.1);
          wrapRect(ctx, W, cx - w, y, w, stepH);
          ctx.fillStyle = shade(mid, 0.7);
          wrapRect(ctx, W, cx, y, w, stepH);
        }
      }
    } else if (v === 'circuit') {
      // orthogonal 1px traces with 90-degree bends ending in solder pads
      for (let i = 0; i < 14; i++) {
        let tx = rng.int(0, W - 1);
        let ty = rng.int(10, H - 10);
        let horizontal = rng.chance(0.5);
        ctx.fillStyle = shade(mid, 1.15);
        ctx.globalAlpha = 0.8;
        const segs = rng.int(2, 4);
        for (let s = 0; s < segs; s++) {
          const len = rng.int(20, 70) * (rng.chance(0.5) ? 1 : -1);
          if (horizontal) {
            wrapRect(ctx, W, Math.min(tx, tx + len), ty, Math.abs(len), 1);
            tx += len;
          } else {
            const ny = Math.max(4, Math.min(H - 5, ty + len));
            wrapRect(ctx, W, tx, Math.min(ty, ny), 1, Math.abs(ny - ty));
            ty = ny;
          }
          horizontal = !horizontal;
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = shade(light, 1.2);
        wrapRect(ctx, W, tx - 1, ty - 1, 2, 2);
      }
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 5; i++) wrapRect(ctx, W, rng.int(0, W - 1), rng.int(10, H - 10), 3, 3);
      ctx.globalAlpha = 1;
    } else if (v === 'factory') {
      // smokestacks with puff clusters, gantry cranes, base pipe runs
      const iron = shade(dark, 0.7);
      ctx.fillStyle = shade(dark, 0.65);
      ctx.fillRect(0, H - 24, W, 24);
      const stacks = rng.int(4, 6);
      for (let i = 0; i < stacks; i++) {
        const sx = Math.floor(((i + 0.5) * W) / stacks) + rng.int(-24, 24);
        const sw = rng.int(12, 26);
        const sh = rng.int(80, 170);
        const top = H - sh;
        ctx.fillStyle = iron;
        wrapRect(ctx, W, sx, top, sw, sh);
        wrapRect(ctx, W, sx - 2, top, sw + 4, 4);
        const puffs = rng.int(2, 3);
        ctx.fillStyle = shade(light, 1.05);
        ctx.globalAlpha = 0.45;
        for (let p = 0; p < puffs; p++) {
          wrapDisc(ctx, W, sx + Math.floor(sw / 2) + 6 + p * 10, top - 7 - p * 12, 8 - p * 2 + rng.int(0, 2));
        }
        ctx.globalAlpha = 1;
        if (rng.chance(0.4)) {
          ctx.fillStyle = shade(light, 1.3);
          wrapRect(ctx, W, sx + Math.floor(sw / 2), top - 2, 1, 1);
        }
      }
      ctx.fillStyle = shade(dark, 0.85);
      for (let i = 0; i < 2; i++) {
        const gx = rng.int(0, W - 1);
        const gy = H - rng.int(60, 95);
        const gw = rng.int(60, 110);
        wrapRect(ctx, W, gx, gy, gw, 4);
        wrapRect(ctx, W, gx + 6, gy, 4, H - 24 - gy);
        wrapRect(ctx, W, gx + gw - 10, gy, 4, H - 24 - gy);
        wrapRect(ctx, W, gx + rng.int(14, gw - 18), gy + 4, 2, rng.int(8, 18));
      }
      for (let i = 0; i < 2; i++) {
        const py = H - 9 - i * 8;
        ctx.fillStyle = shade(dark, 0.8);
        ctx.fillRect(0, py, W, 5);
        ctx.fillStyle = shade(mid, 0.95);
        ctx.fillRect(0, py, W, 1);
      }
    } else {
      // starfield near layer: a few big twinkles + distant planet
      ctx.fillStyle = shade(mid, 1.1);
      const px = rng.int(60, W - 60);
      const py = rng.int(40, 120);
      const pr = rng.int(14, 26);
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(mid, 0.8);
      ctx.fillRect(px - pr, py + Math.floor(pr * 0.2), pr * 2, Math.max(2, Math.floor(pr * 0.18)));
      for (let i = 0; i < 24; i++) {
        ctx.fillStyle = rng.chance(0.3) ? '#ffffff' : shade(light, 1.3);
        const s = rng.chance(0.2) ? 2 : 1;
        ctx.fillRect(rng.int(0, W - 1), rng.int(0, H - 1), s, s);
      }
    }
  }

  // Foreground layer (optional, per-variant): close scenery hanging from the top
  // that scrolls FASTER than the world (parallax > 1), so the scene reads with
  // depth instead of one flat plane and two games sharing a backdrop feel
  // different. Top-anchored (only the upper strip is painted) so it passes in
  // front of gameplay without ever hiding the player in the mid/lower field.
  const foreMotif: 'teeth' | 'icicle' | 'candy' | 'girder' | 'foliage' | null =
    v === 'caves'
      ? 'teeth'
      : v === 'mountains'
        ? 'icicle'
        : v === 'candy'
          ? 'candy'
          : v === 'factory'
            ? 'girder'
            : v === 'hills' || v === 'ruins'
              ? 'foliage'
              : null;
  let fore: HTMLCanvasElement | null = null;
  if (foreMotif) {
    fore = document.createElement('canvas');
    fore.width = W;
    fore.height = H;
    const ctx = fore.getContext('2d')!;
    const silhouette = shade(dark, 0.4);
    if (foreMotif === 'foliage') {
      const base = palette[6] ?? palette[5] ?? mid; // foliage/vine green
      const leafDark = shade(base, 0.5);
      const leafMid = shade(base, 0.82);
      ctx.fillStyle = leafDark;
      wrapRect(ctx, W, 0, 0, W, rng.int(5, 9)); // canopy band along the top edge
      const clusters = rng.int(5, 7);
      for (let c = 0; c < clusters; c++) {
        const cx = rng.int(0, W - 1);
        const blobs = rng.int(5, 8);
        for (let b = 0; b < blobs; b++) {
          ctx.fillStyle = rng.chance(0.45) ? leafMid : leafDark;
          wrapDisc(ctx, W, cx + rng.int(-18, 18), rng.int(-4, 24), rng.int(6, 14));
        }
        if (rng.chance(0.7)) {
          ctx.fillStyle = leafDark;
          wrapRect(ctx, W, cx + rng.int(-10, 10), 8, 1, rng.int(14, 38)); // dangling vine
        }
      }
    } else {
      // teeth family: things hanging from a ceiling (stalactites / icicles /
      // candy drips / factory girders).
      if (foreMotif === 'girder') {
        ctx.fillStyle = shade(dark, 0.55);
        wrapRect(ctx, W, 0, 0, W, 5); // ceiling beam the bars hang from
      } else {
        ctx.fillStyle = foreMotif === 'icicle' ? shade(light, 0.9) : silhouette;
        wrapRect(ctx, W, 0, 0, W, rng.int(3, 6)); // rock/ice ceiling band
      }
      let x = rng.int(-8, 12);
      while (x < W) {
        const w = foreMotif === 'girder' ? rng.int(6, 12) : rng.int(10, 26);
        const h = rng.int(14, foreMotif === 'girder' ? 32 : 48);
        if (foreMotif === 'girder') {
          ctx.fillStyle = shade(dark, 0.5);
          wrapRect(ctx, W, x, 0, w, h);
          wrapRect(ctx, W, x - 1, h - 3, w + 2, 3); // end flange
        } else {
          ctx.fillStyle =
            foreMotif === 'icicle'
              ? shade(light, 1.05)
              : foreMotif === 'candy'
                ? rng.chance(0.5)
                  ? shade(light, 1.15)
                  : shade(mid, 0.95)
                : silhouette;
          for (let sy = 0; sy < h; sy++) {
            const sw = Math.max(1, Math.round(w * (1 - sy / h)));
            wrapRect(ctx, W, x + ((w - sw) >> 1), sy, sw, 1); // narrows to a point
          }
          if (foreMotif === 'icicle') {
            ctx.fillStyle = '#ffffff';
            wrapRect(ctx, W, x + (w >> 1), h - 4, 1, 4); // bright tip
          } else if (foreMotif === 'candy') {
            ctx.fillStyle = shade(light, 1.25);
            wrapDisc(ctx, W, x + (w >> 1), h, Math.max(2, w >> 2)); // gumdrop tip
          }
        }
        x += w + rng.int(6, 26);
      }
    }
  }

  return {
    draw(ctx: CanvasRenderingContext2D, scrollX: number, scrollY: number) {
      const fx = Math.round(scrollX * 0.1) % W;
      const nx = Math.round(scrollX * 0.3) % W;
      const fy = Math.round(scrollY * 0.05);
      ctx.drawImage(far, -fx, -fy);
      if (fx > 0) ctx.drawImage(far, W - fx, -fy);
      ctx.drawImage(near, -nx, -Math.round(scrollY * 0.15));
      if (nx > 0) ctx.drawImage(near, W - nx, -Math.round(scrollY * 0.15));
    },
    drawForeground(ctx: CanvasRenderingContext2D, scrollX: number, scrollY: number) {
      if (!fore) return;
      const gx = ((Math.round(scrollX * 1.5) % W) + W) % W; // parallax > 1: closer than the player
      const gy = Math.round(scrollY * 0.4);
      ctx.drawImage(fore, -gx, -gy);
      if (gx > 0) ctx.drawImage(fore, W - gx, -gy);
    },
  };
}
