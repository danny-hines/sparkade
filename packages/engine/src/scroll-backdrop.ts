// Vertical-scroll backdrop generator for the SHOOTER archetype (top-down /
// fly-through). The horizontal makeBackdrop (backdrops.ts) anchors all its
// scenery to a horizon at the bottom of the screen and wraps horizontally — so
// a vertical shmup flying "up" could only ever use 'starfield'. These scenes are
// top-down and tile VERTICALLY: a fixed banded gradient plus two parallax layers
// (far + near) whose features wrap at H, drawn twice stacked so they scroll
// downward seamlessly (reads as flying up). Rendered once at load to offscreen
// canvases; runtime cost is ~5 drawImage calls per frame.
import { INTERNAL_HEIGHT, INTERNAL_WIDTH, SHOOTER_BACKDROP_VARIANTS } from '@sparkade/shared';
import type { ShooterBackdropId } from '@sparkade/shared';
import { Rng } from './rng';

export type ScrollBackdropVariant = ShooterBackdropId;

export { SHOOTER_BACKDROP_VARIANTS };

export interface ScrollBackdrop {
  /** Draw the fixed gradient + the two vertically-scrolling parallax layers.
   *  `scrollY` grows over time (the shooter's world scroll in px). */
  draw(ctx: CanvasRenderingContext2D, scrollY: number): void;
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

const H = INTERNAL_HEIGHT;
const W = INTERNAL_WIDTH;

/** fillRect that wraps VERTICALLY so the scrolling layer's seam stays invisible. */
function fillV(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const ym = ((Math.round(y) % H) + H) % H;
  ctx.fillRect(x, ym, w, h);
  if (ym + h > H) ctx.fillRect(x, ym - H, w, h);
}

/** Filled disc that wraps vertically (redrawn across the top/bottom seam). */
function discV(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const ym = ((Math.round(y) % H) + H) % H;
  for (const dy of [0, -H, H]) {
    const cy = ym + dy;
    if (cy + r < 0 || cy - r > H) continue;
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A smooth meandering vertical band (river / lava vein / road). Uses an integer
 *  wave count `k` so the sine period divides H and the band tiles vertically. */
function windingBand(
  ctx: CanvasRenderingContext2D,
  cx: number,
  amp: number,
  k: number,
  width: number,
  phase = 0,
): void {
  for (let y = 0; y < H; y++) {
    const x = cx + amp * Math.sin((2 * Math.PI * k * y) / H + phase);
    ctx.fillRect(Math.round(x - width / 2), y, width, 1);
  }
}

/**
 * Seed-varied default pick across all vertical variants, with a light palette
 * nudge (very dark palettes lean space/hazard; lighter ones lean aerial). Only
 * a fallback — the design model normally sets a theme-matched `spec.backdrop`.
 */
export function pickScrollVariant(
  palette: string[],
  seed: number,
  prefer?: ScrollBackdropVariant,
): ScrollBackdropVariant {
  if (prefer) return prefer;
  const rng = new Rng(seed ^ 0x5c0117);
  const bgLum = luminance(palette[2] ?? '#101020');
  const dark: ScrollBackdropVariant[] = ['deepspace', 'nebula', 'asteroids', 'lava', 'swamp'];
  const light: ScrollBackdropVariant[] = ['ocean', 'metropolis', 'canyon', 'tundra', 'nebula'];
  const pool = bgLum < 46 ? dark : light;
  return pool[rng.int(0, pool.length - 1)]!;
}

export function makeScrollBackdrop(
  palette: string[],
  seed: number,
  variant?: ScrollBackdropVariant,
): ScrollBackdrop {
  const v = pickScrollVariant(palette, seed, variant);
  const rng = new Rng(seed ^ 0x5eed_a11);
  const dark = palette[2] ?? '#101020';
  const mid = palette[3] ?? '#29366f';
  const light = palette[4] ?? '#3b5dc9';
  const warm = palette[12] ?? '#ffa300';
  const gold = palette[13] ?? '#ffd75e';
  const hazard = palette[11] ?? '#e04040';
  const leaf = palette[6] ?? '#a7f070';

  // Fixed banded gradient (SNES-style, no smooth gradients). base + per-variant
  // top/bottom shade so each scene has its own value mood.
  const bg = document.createElement('canvas');
  bg.width = W;
  bg.height = H;
  {
    const ctx = bg.getContext('2d')!;
    const ramp: Record<ScrollBackdropVariant, { base: string; top: number; bot: number }> = {
      deepspace: { base: dark, top: 0.35, bot: 0.75 },
      nebula: { base: dark, top: 0.4, bot: 0.9 },
      asteroids: { base: dark, top: 0.4, bot: 0.7 },
      ocean: { base: mid, top: 0.6, bot: 1.05 },
      metropolis: { base: dark, top: 0.5, bot: 1.0 },
      canyon: { base: mid, top: 0.55, bot: 0.85 },
      lava: { base: dark, top: 0.35, bot: 0.7 },
      swamp: { base: mid, top: 0.35, bot: 0.6 },
      tundra: { base: light, top: 0.8, bot: 1.08 },
    };
    const { base, top, bot } = ramp[v];
    const bands = 7;
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = shade(base, top + (i / (bands - 1)) * (bot - top));
      ctx.fillRect(0, Math.floor((i * H) / bands), W, Math.ceil(H / bands) + 1);
    }
  }

  // Two transparent parallax layers (features wrap vertically via fillV/discV).
  const far = document.createElement('canvas');
  far.width = W;
  far.height = H;
  const near = document.createElement('canvas');
  near.width = W;
  near.height = H;
  const fctx = far.getContext('2d')!;
  const nctx = near.getContext('2d')!;

  const scatterStars = (ctx: CanvasRenderingContext2D, n: number, big: boolean, alpha: number): void => {
    ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      const bright = rng.chance(0.3);
      ctx.fillStyle = bright ? '#ffffff' : shade(light, 1.25);
      const s = big && bright ? 2 : 1;
      ctx.fillRect(rng.int(0, W - 1), rng.int(0, H - 1), s, s);
    }
    ctx.globalAlpha = 1;
  };

  // A shaded rock/asteroid: body disc + a darker crescent + a light glint.
  const rock = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, body: string): void => {
    ctx.fillStyle = body;
    discV(ctx, x, y, r);
    ctx.fillStyle = shade(dark, 0.6);
    discV(ctx, x + r * 0.35, y + r * 0.35, r * 0.72); // shadow crescent
    ctx.fillStyle = shade(body, 1.25);
    discV(ctx, x - r * 0.32, y - r * 0.32, Math.max(1, r * 0.28)); // glint
  };

  switch (v) {
    case 'deepspace': {
      scatterStars(fctx, 130, false, 0.6);
      scatterStars(nctx, 40, true, 1);
      // a distant planet + ring, and a comet streak
      nctx.fillStyle = shade(mid, 1.1);
      discV(nctx, rng.int(70, W - 70), rng.int(40, H - 40), rng.int(16, 28));
      nctx.fillStyle = shade(warm, 0.9);
      nctx.globalAlpha = 0.8;
      const cx = rng.int(40, W - 40);
      const cy = rng.int(30, H - 60);
      for (let i = 0; i < 22; i++) fillV(nctx, cx + i, cy + i * 2, 2, 2);
      nctx.globalAlpha = 1;
      break;
    }
    case 'nebula': {
      // soft gas clouds (translucent accent discs), then stars over them
      for (const [ctx, blobs, a] of [[fctx, 10, 0.14] as const, [nctx, 7, 0.2] as const]) {
        const tints = [light, warm, hazard, mid, leaf];
        ctx.globalAlpha = a;
        for (let i = 0; i < blobs; i++) {
          ctx.fillStyle = shade(tints[rng.int(0, tints.length - 1)]!, 1.1);
          const gx = rng.int(0, W - 1);
          const gy = rng.int(0, H - 1);
          for (let p = 0; p < 5; p++) discV(ctx, gx + rng.int(-30, 30), gy + rng.int(-30, 30), rng.int(20, 46));
        }
        ctx.globalAlpha = 1;
      }
      scatterStars(fctx, 90, false, 0.5);
      scatterStars(nctx, 34, true, 1);
      break;
    }
    case 'asteroids': {
      scatterStars(fctx, 70, false, 0.4);
      for (let i = 0; i < 16; i++) rock(fctx, rng.int(0, W - 1), rng.int(0, H - 1), rng.int(3, 7), shade(mid, 0.7));
      for (let i = 0; i < 12; i++) {
        const ax = rng.int(0, W - 1);
        const ay = rng.int(0, H - 1);
        const r = rng.int(9, 22);
        rock(nctx, ax, ay, r, shade(mid, 0.95));
        nctx.fillStyle = shade(dark, 0.7); // craters
        for (let c = 0; c < rng.int(1, 3); c++)
          discV(nctx, ax + rng.int(-r / 2, r / 2), ay + rng.int(-r / 2, r / 2), Math.max(1, r * 0.22));
      }
      break;
    }
    case 'ocean': {
      // far: deep-water foam wave rows (thin light dashes)
      fctx.fillStyle = shade(light, 1.15);
      fctx.globalAlpha = 0.5;
      for (let i = 0; i < 60; i++) {
        const y = rng.int(0, H - 1);
        for (let d = 0; d < rng.int(2, 5); d++) fillV(fctx, rng.int(0, W - 6), y, rng.int(3, 7), 1);
      }
      fctx.globalAlpha = 1;
      // near: islands (sandy discs with foam rim) + a couple of ship wakes
      for (let i = 0; i < rng.int(3, 5); i++) {
        const ix = rng.int(30, W - 30);
        const iy = rng.int(0, H - 1);
        const r = rng.int(14, 30);
        nctx.fillStyle = shade(light, 1.3); // foam ring
        discV(nctx, ix, iy, r + 3);
        nctx.fillStyle = shade(gold, 0.85); // sand
        discV(nctx, ix, iy, r);
        nctx.fillStyle = shade(leaf, 0.8); // greenery
        discV(nctx, ix + rng.int(-4, 4), iy + rng.int(-4, 4), Math.max(2, r * 0.5));
      }
      nctx.fillStyle = '#ffffff';
      nctx.globalAlpha = 0.7;
      for (let i = 0; i < 3; i++) {
        const wx = rng.int(20, W - 20);
        const wy = rng.int(0, H - 1);
        for (let k = 0; k < 10; k++) {
          fillV(nctx, wx - k, wy + k * 2, 1, 1);
          fillV(nctx, wx + k, wy + k * 2, 1, 1);
        }
      }
      nctx.globalAlpha = 1;
      break;
    }
    case 'metropolis': {
      // top-down night city: avenues (fixed columns) + scrolling cross-streets,
      // then rooftop blocks with lit windows in the grid cells.
      const road = shade(dark, 1.4);
      fctx.fillStyle = road;
      fctx.globalAlpha = 0.9;
      const pitch = 64; // divides W=512
      for (let gx = 0; gx < W; gx += pitch) fctx.fillRect(gx, 0, 4, H);
      for (let gy = 0; gy < H; gy += pitch) fillV(fctx, 0, gy, W, 4);
      fctx.globalAlpha = 1;
      for (let gx = 4; gx < W; gx += pitch) {
        for (let gy = 0; gy < H; gy += pitch) {
          if (rng.chance(0.15)) continue; // a plaza / empty lot
          const pad = rng.int(3, 8);
          const bx = gx + pad;
          const by = gy + pad;
          const bw = pitch - 4 - pad * 2;
          const bh = pitch - 4 - pad * 2;
          nctx.fillStyle = shade(mid, rng.range(0.55, 0.9));
          fillV(nctx, bx, by, bw, bh);
          nctx.fillStyle = shade(mid, 1.2); // lit roof edge
          fillV(nctx, bx, by, bw, 1);
          nctx.fillStyle = shade(gold, 1.1); // windows
          for (let wy = by + 3; wy < by + bh - 2; wy += 5)
            for (let wx = bx + 2; wx < bx + bw - 2; wx += 5) if (rng.chance(0.35)) fillV(nctx, wx, wy, 2, 2);
        }
      }
      break;
    }
    case 'canyon': {
      // rocky ground mottle + a winding river carved through it
      fctx.globalAlpha = 0.5;
      for (let i = 0; i < 40; i++) {
        fctx.fillStyle = rng.chance(0.5) ? shade(mid, 0.6) : shade(mid, 1.2);
        discV(fctx, rng.int(0, W - 1), rng.int(0, H - 1), rng.int(6, 18));
      }
      fctx.globalAlpha = 1;
      const cx = W / 2 + rng.int(-60, 60);
      const amp = rng.int(50, 90);
      const k = rng.int(1, 2);
      nctx.fillStyle = shade(dark, 0.7); // river banks (shadow)
      windingBand(nctx, cx, amp, k, rng.int(30, 40), 0);
      nctx.fillStyle = shade(light, 1.1); // water
      windingBand(nctx, cx, amp, k, rng.int(14, 20), 0);
      nctx.fillStyle = shade(light, 1.35); // shimmer
      windingBand(nctx, cx, amp, k, 3, 0.4);
      // ridges + scrub
      nctx.fillStyle = shade(mid, 0.7);
      for (let i = 0; i < 14; i++) {
        const rx = rng.int(0, W - 1);
        const ry = rng.int(0, H - 1);
        fillV(nctx, rx, ry, rng.int(10, 26), rng.int(2, 4));
      }
      nctx.fillStyle = shade(leaf, 0.7);
      for (let i = 0; i < 22; i++) fillV(nctx, rng.int(0, W - 1), rng.int(0, H - 1), 2, 2);
      break;
    }
    case 'lava': {
      // dark cracked rock (far embers) + bright molten rivers/pools (near)
      fctx.globalAlpha = 0.6;
      for (let i = 0; i < 50; i++) {
        fctx.fillStyle = rng.chance(0.5) ? shade(warm, 0.7) : shade(hazard, 0.6);
        fillV(fctx, rng.int(0, W - 1), rng.int(0, H - 1), 1, 1);
      }
      fctx.globalAlpha = 1;
      const veins = rng.int(2, 3);
      for (let i = 0; i < veins; i++) {
        const cx = rng.int(60, W - 60);
        const amp = rng.int(30, 70);
        const k = rng.int(2, 4);
        nctx.fillStyle = shade(hazard, 0.7); // outer glow
        windingBand(nctx, cx, amp, k, rng.int(12, 18), i);
        nctx.fillStyle = warm; // molten body
        windingBand(nctx, cx, amp, k, rng.int(6, 9), i);
        nctx.fillStyle = shade(gold, 1.15); // bright core
        windingBand(nctx, cx, amp, k, 2, i);
      }
      for (let i = 0; i < rng.int(3, 6); i++) {
        const px = rng.int(20, W - 20);
        const py = rng.int(0, H - 1);
        const pr = rng.int(8, 16);
        nctx.fillStyle = shade(hazard, 0.7);
        discV(nctx, px, py, pr);
        nctx.fillStyle = warm;
        discV(nctx, px, py, pr * 0.6);
        nctx.fillStyle = shade(gold, 1.2);
        discV(nctx, px, py, pr * 0.28);
      }
      break;
    }
    case 'swamp': {
      // murky bog: dark organic mottle + sickly glowing pools + bubbles
      fctx.globalAlpha = 0.5;
      for (let i = 0; i < 34; i++) {
        fctx.fillStyle = rng.chance(0.5) ? shade(dark, 0.7) : shade(mid, 0.7);
        discV(fctx, rng.int(0, W - 1), rng.int(0, H - 1), rng.int(10, 30));
      }
      fctx.globalAlpha = 1;
      const glow = luminance(leaf) > 60 ? leaf : gold;
      for (let i = 0; i < rng.int(4, 7); i++) {
        const px = rng.int(20, W - 20);
        const py = rng.int(0, H - 1);
        const pr = rng.int(10, 22);
        nctx.fillStyle = shade(glow, 0.55);
        discV(nctx, px, py, pr);
        nctx.fillStyle = shade(glow, 0.85);
        discV(nctx, px, py, pr * 0.6);
        nctx.fillStyle = shade(glow, 1.15);
        for (let b = 0; b < rng.int(2, 4); b++) discV(nctx, px + rng.int(-pr, pr), py + rng.int(-pr, pr), rng.int(1, 2));
      }
      // gnarled vines
      nctx.fillStyle = shade(leaf, 0.5);
      for (let i = 0; i < 10; i++) {
        const vx = rng.int(0, W - 1);
        const vy = rng.int(0, H - 1);
        fillV(nctx, vx, vy, 2, rng.int(14, 34));
        fillV(nctx, vx, vy + rng.int(4, 10), rng.int(4, 10), 2);
      }
      break;
    }
    case 'tundra': {
      // cracked ice sheets (light polygons split by darker crack lines) + snow
      nctx.globalAlpha = 1;
      for (let i = 0; i < 10; i++) {
        const sx = rng.int(0, W - 1);
        const sy = rng.int(0, H - 1);
        const sw = rng.int(30, 70);
        const sh = rng.int(24, 60);
        fctx.fillStyle = shade(light, rng.range(0.85, 1.05));
        fillV(fctx, sx, sy, sw, sh);
        nctx.fillStyle = shade(mid, 0.6); // crack lines
        windingBand2(nctx, sx, sy, sw, sh, rng);
      }
      fctx.globalAlpha = 0.5;
      for (let i = 0; i < 40; i++) {
        fctx.fillStyle = '#ffffff';
        fillV(fctx, rng.int(0, W - 1), rng.int(0, H - 1), rng.chance(0.3) ? 2 : 1, 1);
      }
      fctx.globalAlpha = 1;
      // drifting snow sparkles on the near layer
      nctx.fillStyle = '#ffffff';
      for (let i = 0; i < 26; i++) fillV(nctx, rng.int(0, W - 1), rng.int(0, H - 1), 1, 1);
      break;
    }
  }

  const drawLayer = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, offset: number): void => {
    const oy = ((Math.round(offset) % H) + H) % H;
    ctx.drawImage(canvas, 0, oy);
    ctx.drawImage(canvas, 0, oy - H);
  };

  return {
    draw(ctx: CanvasRenderingContext2D, scrollY: number) {
      ctx.drawImage(bg, 0, 0); // fixed sky/ground tint
      drawLayer(ctx, far, scrollY * 0.2);
      drawLayer(ctx, near, scrollY * 0.55);
    },
  };
}

/** A couple of straight cracks across an ice sheet rect (tundra helper). */
function windingBand2(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: Rng,
): void {
  for (let c = 0; c < rng.int(1, 3); c++) {
    if (rng.chance(0.5)) fillV(ctx, x, y + rng.int(2, h - 2), w, 1);
    else fillV(ctx, x + rng.int(2, w - 2), y, 1, h);
  }
}
