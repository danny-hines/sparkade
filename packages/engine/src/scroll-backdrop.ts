// Vertical-scroll backdrop generator for the SHOOTER archetype (top-down /
// fly-through). The horizontal makeBackdrop (backdrops.ts) anchors all its
// scenery to a horizon at the bottom of the screen and wraps horizontally — so
// a vertical shmup flying "up" could only ever use 'starfield'. These scenes are
// top-down and tile VERTICALLY.
//
// Depth model (this is the thing that makes them read right): TERRESTRIAL scenes
// are one flat ground plane, so ALL their ground detail lives on a single layer
// at one speed, with a SEPARATE cloud deck on top scrolling faster (it's closer
// to the camera than the distant ground). SPACE scenes genuinely have depth, so
// their star fields / planets / asteroids parallax against each other. Rendered
// once at load to offscreen canvases; asteroids additionally spin per-frame.
import { INTERNAL_HEIGHT, INTERNAL_WIDTH, SHOOTER_BACKDROP_VARIANTS } from '@sparkade/shared';
import type { ShooterBackdropId } from '@sparkade/shared';
import { Rng } from './rng';

export type ScrollBackdropVariant = ShooterBackdropId;

export { SHOOTER_BACKDROP_VARIANTS };

export interface ScrollBackdrop {
  /** Draw the fixed gradient + the vertically-scrolling parallax layers.
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

/** A fresh transparent W×H layer painted by `paint`. */
function bakeLayer(paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  paint(c.getContext('2d')!);
  return c;
}

/** A soft cloud deck built like the horizontal 'clouds' backdrop: clusters of
 *  flat, slightly-ragged horizontal SLABS (not stacked circles — those compound
 *  into bright cores where they overlap), tiling vertically. Higher `density` =
 *  heavier cover. The fast, close layer on ground scenes so the distant terrain
 *  reads as a single receding plane beneath it. */
function bakeClouds(density: number, tint: string, alpha: number, rng: Rng): HTMLCanvasElement {
  return bakeLayer((ctx) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = tint;
    for (let i = 0; i < density; i++) {
      const cx = rng.int(0, W - 1);
      const cy = rng.int(0, H - 1);
      const cw = rng.int(34, 84);
      for (let p = 0; p < rng.int(4, 6); p++) {
        const px = cx + rng.int(-cw / 2, cw / 2);
        const pw = rng.int(16, cw);
        fillV(ctx, px, cy + rng.int(-5, 5), pw, rng.int(5, 9));
      }
    }
    ctx.globalAlpha = 1;
  });
}

interface Asteroid {
  canvas: HTMLCanvasElement;
  x: number;
  y0: number;
  p: number; // parallax (depth)
  spin: number; // radians per world-px
  phase: number;
}

/** A lumpy, shaded, pixelated rock in an irregular silhouette. Rotated per-frame
 *  at draw time (nearest-neighbour, so it tumbles blockily). */
function makeAsteroid(size: number, body: string, rng: Rng): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;
  const pts = rng.int(8, 11);
  const radii = Array.from({ length: pts }, () => r * rng.range(0.72, 1));
  const blob = (): void => {
    ctx.beginPath();
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const x = cx + Math.cos(a) * radii[i]!;
      const y = cy + Math.sin(a) * radii[i]!;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = body;
  blob();
  ctx.fill();
  ctx.save();
  blob();
  ctx.clip(); // keep the shading inside the rock silhouette
  const disc = (dx: number, dy: number, rr: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, rr, 0, Math.PI * 2);
    ctx.fill();
  };
  disc(r * 0.4, r * 0.4, r * 0.85, shade(body, 0.55)); // shadow (down-right)
  disc(0, 0, r * 0.72, body);
  disc(-r * 0.3, -r * 0.3, r * 0.6, shade(body, 1.3)); // lit (up-left)
  ctx.fillStyle = shade(body, 0.4); // craters
  for (let i = 0; i < rng.int(2, 4); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, r * 0.6);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rng.range(1, size * 0.13), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = shade(body, 0.35); // dark rim
  ctx.lineWidth = 1;
  blob();
  ctx.stroke();
  return c;
}

/**
 * Seed-varied default pick across all vertical variants, with a light palette
 * nudge (very dark palettes lean space; lighter ones lean aerial/terrestrial).
 * Only a fallback — the design model normally sets a theme-matched backdrop.
 */
export function pickScrollVariant(
  palette: string[],
  seed: number,
  prefer?: ScrollBackdropVariant,
): ScrollBackdropVariant {
  if (prefer) return prefer;
  const rng = new Rng(seed ^ 0x5c0117);
  const bgLum = luminance(palette[2] ?? '#101020');
  const dark: ScrollBackdropVariant[] = ['deepspace', 'nebula', 'asteroids', 'swamp'];
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

  // Fixed banded gradient (SNES-style, no smooth gradients). The base tint; on
  // ground scenes it reads as the far ground/water since only detail scrolls.
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

  const stars = (ctx: CanvasRenderingContext2D, n: number, big: boolean, alpha: number): void => {
    ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      const bright = rng.chance(0.3);
      ctx.fillStyle = bright ? '#ffffff' : shade(light, 1.25);
      const s = big && bright ? 2 : 1;
      ctx.fillRect(rng.int(0, W - 1), rng.int(0, H - 1), s, s);
    }
    ctx.globalAlpha = 1;
  };

  // Layers scroll bottom-ward at their parallax factor; asteroids also spin.
  const layers: { canvas: HTMLCanvasElement; p: number }[] = [];
  let asteroids: Asteroid[] | null = null;

  switch (v) {
    case 'deepspace': {
      layers.push({ canvas: bakeLayer((c) => stars(c, 130, false, 0.55)), p: 0.12 });
      // 1-3 planets of varied size/colour; some banded-gradient spheres, some flat.
      layers.push({
        canvas: bakeLayer((c) => {
          const tints = [mid, light, warm, hazard, leaf, gold];
          for (let i = 0; i < rng.int(1, 3); i++) {
            const hue = tints[rng.int(0, tints.length - 1)]!;
            const px = rng.int(30, W - 30);
            const py = rng.int(0, H - 1);
            const pr = rng.int(12, 36);
            if (rng.chance(0.5)) {
              // lit sphere: concentric rings, dark→light, offset toward top-left
              const steps = 6;
              for (let s = 0; s < steps; s++) {
                c.fillStyle = shade(hue, 0.6 + (s / steps) * 0.75);
                discV(c, px - (s / steps) * pr * 0.35, py - (s / steps) * pr * 0.35, pr * (1 - s / steps));
              }
            } else {
              c.fillStyle = hue; // flat disc with a terminator crescent
              discV(c, px, py, pr);
              c.fillStyle = shade(hue, 0.62);
              discV(c, px + pr * 0.32, py + pr * 0.34, pr * 0.82);
            }
          }
        }),
        p: 0.22,
      });
      layers.push({ canvas: bakeLayer((c) => stars(c, 42, true, 1)), p: 0.42 });
      break;
    }
    case 'nebula': {
      const gas = (c: CanvasRenderingContext2D, blobs: number, a: number): void => {
        const tints = [light, warm, hazard, mid, leaf];
        c.globalAlpha = a;
        for (let i = 0; i < blobs; i++) {
          c.fillStyle = shade(tints[rng.int(0, tints.length - 1)]!, 1.1);
          const gx = rng.int(0, W - 1);
          const gy = rng.int(0, H - 1);
          for (let p = 0; p < 5; p++) discV(c, gx + rng.int(-30, 30), gy + rng.int(-30, 30), rng.int(20, 46));
        }
        c.globalAlpha = 1;
      };
      layers.push({ canvas: bakeLayer((c) => { gas(c, 9, 0.13); stars(c, 90, false, 0.5); }), p: 0.14 });
      layers.push({ canvas: bakeLayer((c) => { gas(c, 6, 0.18); stars(c, 34, true, 1); }), p: 0.42 });
      break;
    }
    case 'asteroids': {
      layers.push({ canvas: bakeLayer((c) => stars(c, 90, false, 0.4)), p: 0.1 });
      asteroids = [];
      const count = rng.int(9, 13);
      for (let i = 0; i < count; i++) {
        const size = rng.int(12, 32);
        asteroids.push({
          canvas: makeAsteroid(size, shade(mid, rng.range(0.7, 1.05)), rng),
          x: rng.int(10, W - 10),
          y0: rng.int(0, H - 1),
          p: rng.range(0.32, 0.62),
          spin: rng.range(0.002, 0.006) * (rng.chance(0.5) ? 1 : -1),
          phase: rng.range(0, Math.PI * 2),
        });
      }
      break;
    }
    case 'ocean': {
      // Water = the fixed blue gradient; one slow ground layer of foam shimmer.
      layers.push({
        canvas: bakeLayer((c) => {
          c.fillStyle = shade(light, 1.15);
          c.globalAlpha = 0.5;
          for (let i = 0; i < 70; i++) {
            const y = rng.int(0, H - 1);
            for (let d = 0; d < rng.int(2, 5); d++) fillV(c, rng.int(0, W - 7), y, rng.int(3, 7), 1);
          }
          c.globalAlpha = 1;
        }),
        p: 0.28,
      });
      layers.push({ canvas: bakeClouds(11, shade(light, 1.3), 0.5, rng), p: 0.8 });
      break;
    }
    case 'metropolis': {
      // Rooftops + streets on ONE ground plane (no separate drifting grid),
      // under a heavy cloud deck.
      layers.push({
        canvas: bakeLayer((c) => {
          const pitch = 64; // divides W=512, tiles horizontally
          c.fillStyle = shade(dark, 1.1); // streets recede, baked into the ground plane
          for (let gx = 0; gx < W; gx += pitch) c.fillRect(gx, 0, 3, H);
          for (let gy = 0; gy < H; gy += pitch) fillV(c, 0, gy, W, 3);
          for (let gx = 4; gx < W; gx += pitch)
            for (let gy = 0; gy < H; gy += pitch) {
              if (rng.chance(0.15)) continue; // a plaza / lot
              const pad = rng.int(3, 8);
              const bx = gx + pad;
              const by = gy + pad;
              const bw = pitch - 4 - pad * 2;
              const bh = pitch - 4 - pad * 2;
              c.fillStyle = shade(mid, rng.range(0.55, 0.9));
              fillV(c, bx, by, bw, bh);
              c.fillStyle = shade(mid, 1.2);
              fillV(c, bx, by, bw, 1); // lit roof edge
              c.fillStyle = shade(gold, 1.1); // windows
              for (let wy = by + 3; wy < by + bh - 2; wy += 5)
                for (let wx = bx + 2; wx < bx + bw - 2; wx += 5) if (rng.chance(0.35)) fillV(c, wx, wy, 2, 2);
            }
        }),
        p: 0.28,
      });
      layers.push({ canvas: bakeClouds(20, shade(light, 1.05), 0.6, rng), p: 0.85 });
      break;
    }
    case 'canyon': {
      // A vertical GORGE: two meandering rock walls (left + right) with a lit
      // inner rim — you fly up the chasm between them. (This is the horizontal
      // ceiling/floor corridor rotated 90°.) Clouds pass faster overhead.
      const baseL = W * 0.15;
      const baseR = W * 0.15;
      const ampL = rng.int(26, 44);
      const ampR = rng.int(26, 44);
      const k = rng.int(2, 3);
      const phL = rng.range(0, Math.PI * 2);
      const phR = rng.range(0, Math.PI * 2);
      const edgeL = (y: number): number => baseL + ampL * Math.sin((2 * Math.PI * k * y) / H + phL);
      const edgeR = (y: number): number => W - baseR - ampR * Math.sin((2 * Math.PI * k * y) / H + phR);
      layers.push({
        canvas: bakeLayer((c) => {
          const body = shade(mid, 0.4);
          const band = shade(mid, 0.72);
          const rim = shade(light, 1.25);
          for (let y = 0; y < H; y++) {
            const lx = Math.round(edgeL(y));
            const rx = Math.round(edgeR(y));
            c.fillStyle = body; c.fillRect(0, y, lx, 1);
            c.fillStyle = band; c.fillRect(lx - 6, y, 6, 1);
            c.fillStyle = rim; c.fillRect(lx - 2, y, 2, 1); // lit inner edge
            c.fillStyle = body; c.fillRect(rx, y, W - rx, 1);
            c.fillStyle = band; c.fillRect(rx, y, 6, 1);
            c.fillStyle = rim; c.fillRect(rx, y, 2, 1);
          }
          // rock texture flecks inside the walls
          c.globalAlpha = 0.5;
          for (let i = 0; i < 44; i++) {
            const y = rng.int(0, H - 1);
            c.fillStyle = rng.chance(0.5) ? shade(mid, 0.35) : shade(mid, 0.7);
            if (rng.chance(0.5)) fillV(c, rng.int(2, Math.max(3, Math.round(edgeL(y)) - 4)), y, 2, 2);
            else fillV(c, rng.int(Math.min(W - 3, Math.round(edgeR(y)) + 4), W - 2), y, 2, 2);
          }
          c.globalAlpha = 1;
        }),
        p: 0.28,
      });
      layers.push({ canvas: bakeClouds(8, shade(light, 1.25), 0.4, rng), p: 0.78 });
      break;
    }
    case 'swamp': {
      // Murky bog on one plane (mottle + glowing pools + vines), fog above.
      const glow = luminance(leaf) > 60 ? leaf : gold;
      layers.push({
        canvas: bakeLayer((c) => {
          c.globalAlpha = 0.5;
          for (let i = 0; i < 34; i++) {
            c.fillStyle = rng.chance(0.5) ? shade(dark, 0.7) : shade(mid, 0.7);
            discV(c, rng.int(0, W - 1), rng.int(0, H - 1), rng.int(10, 30));
          }
          c.globalAlpha = 1;
          for (let i = 0; i < rng.int(4, 7); i++) {
            const px = rng.int(20, W - 20);
            const py = rng.int(0, H - 1);
            const pr = rng.int(10, 22);
            c.fillStyle = shade(glow, 0.55);
            discV(c, px, py, pr);
            c.fillStyle = shade(glow, 0.85);
            discV(c, px, py, pr * 0.6);
            c.fillStyle = shade(glow, 1.15);
            for (let b = 0; b < rng.int(2, 4); b++) discV(c, px + rng.int(-pr, pr), py + rng.int(-pr, pr), rng.int(1, 2));
          }
          c.fillStyle = shade(leaf, 0.5); // vines
          for (let i = 0; i < 10; i++) {
            const vx = rng.int(0, W - 1);
            const vy = rng.int(0, H - 1);
            fillV(c, vx, vy, 2, rng.int(14, 34));
            fillV(c, vx, vy + rng.int(4, 10), rng.int(4, 10), 2);
          }
        }),
        p: 0.28,
      });
      layers.push({ canvas: bakeClouds(13, shade(leaf, 0.85), 0.44, rng), p: 0.72 });
      break;
    }
    case 'tundra': {
      // Cracked ice sheets on one plane; blowing snow above.
      layers.push({
        canvas: bakeLayer((c) => {
          for (let i = 0; i < 12; i++) {
            const sx = rng.int(0, W - 1);
            const sy = rng.int(0, H - 1);
            const sw = rng.int(30, 70);
            const sh = rng.int(24, 60);
            c.fillStyle = shade(light, rng.range(0.85, 1.05));
            fillV(c, sx, sy, sw, sh);
            c.fillStyle = shade(mid, 0.6); // crack lines on the sheet
            for (let k = 0; k < rng.int(1, 3); k++) {
              if (rng.chance(0.5)) fillV(c, sx, sy + rng.int(2, sh - 2), sw, 1);
              else fillV(c, sx + rng.int(2, sw - 2), sy, 1, sh);
            }
          }
        }),
        p: 0.28,
      });
      const snow = bakeClouds(10, '#ffffff', 0.5, rng);
      {
        const c = snow.getContext('2d')!;
        c.fillStyle = '#ffffff'; // blowing flakes on the fast layer
        for (let i = 0; i < 40; i++) fillV(c, rng.int(0, W - 1), rng.int(0, H - 1), rng.chance(0.3) ? 2 : 1, 1);
      }
      layers.push({ canvas: snow, p: 0.82 });
      break;
    }
  }

  const drawScroll = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, offset: number): void => {
    const oy = ((Math.round(offset) % H) + H) % H;
    ctx.drawImage(canvas, 0, oy);
    ctx.drawImage(canvas, 0, oy - H);
  };

  return {
    draw(ctx: CanvasRenderingContext2D, scrollY: number) {
      ctx.drawImage(bg, 0, 0);
      for (const { canvas, p } of layers) drawScroll(ctx, canvas, scrollY * p);
      if (asteroids) {
        ctx.imageSmoothingEnabled = false;
        for (const a of asteroids) {
          const y = ((Math.round(a.y0 + scrollY * a.p) % H) + H) % H;
          const ang = scrollY * a.spin + a.phase;
          for (const dy of [0, -H, H]) {
            const yy = y + dy;
            if (yy < -a.canvas.height || yy > H + a.canvas.height) continue;
            ctx.save();
            ctx.translate(a.x, yy);
            ctx.rotate(ang);
            ctx.drawImage(a.canvas, -a.canvas.width / 2, -a.canvas.height / 2);
            ctx.restore();
          }
        }
      }
    },
  };
}
