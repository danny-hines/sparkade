// Procedural weather / ambient-particle overlays. A small, bounded, screen-space
// particle field (worst case ~144 draw primitives/frame — storm; a unit test
// enforces ≤160), zero allocation after construction, drawn OVER gameplay and
// UNDER the HUD, colored from the game palette so it recolors coherently per
// game. Deterministic from the seed. 'none' is a no-op. Cheap for the Pi 3B+.
import { INTERNAL_HEIGHT, INTERNAL_WIDTH, WEATHER_KINDS, type WeatherKind } from '@sparkade/shared';
import { Rng } from './rng';

export { WEATHER_KINDS };
export type { WeatherKind };

/** Ambient overlay: advance with fixed dt, then draw (scroll enables parallax). */
export interface Weather {
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D, scrollX: number, scrollY: number): void;
}

const W = INTERNAL_WIDTH; // 512
const H = INTERNAL_HEIGHT; // 300

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
/** Multiply an #rgb or #rrggbb hex by a factor → an rgb() string. */
function shade(hex: string, f: number): string {
  const b = hex.slice(1);
  const h = b.length === 3 ? b[0]! + b[0]! + b[1]! + b[1]! + b[2]! + b[2]! : b;
  return `rgb(${clampByte(parseInt(h.slice(0, 2), 16) * f)},${clampByte(parseInt(h.slice(2, 4), 16) * f)},${clampByte(parseInt(h.slice(4, 6), 16) * f)})`;
}

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number; // size
  ph: number; // phase (flicker/sway/wobble)
  c: string; // baked color
}

type Recycle = 'down' | 'up' | 'wrap';

interface Kind {
  count: number;
  alpha: number;
  parallax: number; // fraction of camera scroll applied to x (depth)
  recycle: Recycle;
  colors: (pal: string[]) => string[];
  spawn: (p: P, rng: Rng, cols: string[]) => void;
  step: (p: P, dt: number, t: number) => void;
  render: (ctx: CanvasRenderingContext2D, p: P, t: number) => void;
}

const dot = (ctx: CanvasRenderingContext2D, p: P): void => {
  ctx.fillStyle = p.c;
  ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
};

const KINDS: Partial<Record<WeatherKind, Kind>> = {
  rain: {
    count: 60,
    alpha: 0.55,
    parallax: 0.1,
    recycle: 'down',
    colors: (pal) => [shade(pal[4] ?? '#8fd', 1.1), pal[14] ?? '#cde', pal[15] ?? '#eef'],
    spawn: (p, rng, cols) => {
      p.x = rng.int(0, W);
      p.y = rng.int(-H, H);
      p.vx = 40;
      p.vy = rng.int(420, 560);
      p.s = rng.int(5, 9); // streak length
      p.ph = 0;
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    },
    render: (ctx, p) => {
      ctx.strokeStyle = p.c;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(p.x), Math.round(p.y));
      ctx.lineTo(Math.round(p.x - p.vx * 0.02), Math.round(p.y - p.s));
      ctx.stroke();
    },
  },
  storm: {
    count: 72,
    alpha: 0.6,
    parallax: 0.15,
    recycle: 'down',
    colors: (pal) => [pal[14] ?? '#cde', shade(pal[4] ?? '#8fd', 1.1)],
    spawn: (p, rng, cols) => {
      p.x = rng.int(-40, W);
      p.y = rng.int(-H, H);
      p.vx = 150;
      p.vy = rng.int(560, 720);
      p.s = rng.int(8, 14);
      p.ph = 0;
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    },
    render: (ctx, p) => {
      ctx.strokeStyle = p.c;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(p.x), Math.round(p.y));
      ctx.lineTo(Math.round(p.x - p.vx * 0.02), Math.round(p.y - p.s));
      ctx.stroke();
    },
  },
  snow: {
    count: 90,
    alpha: 0.9,
    parallax: 0.2,
    recycle: 'down',
    colors: (pal) => [pal[15] ?? '#fff', pal[15] ?? '#fff', pal[14] ?? '#dde'],
    spawn: (p, rng, cols) => {
      p.x = rng.int(0, W);
      p.y = rng.int(-H, H);
      p.vx = 0;
      p.vy = rng.int(22, 50);
      p.s = rng.int(2, 3);
      p.ph = rng.range(0, Math.PI * 2);
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += Math.sin(t * 1.5 + p.ph) * 16 * dt;
    },
    render: dot,
  },
  embers: {
    count: 72,
    alpha: 0.95,
    parallax: 0.1,
    recycle: 'up',
    // hot spark: orange-forward with white-hot tips (reads apart from gold fireflies)
    colors: (pal) => [pal[12] ?? '#fa0', pal[12] ?? '#fa0', pal[13] ?? '#fd5', pal[15] ?? '#fff'],
    spawn: (p, rng, cols) => {
      p.x = rng.int(0, W);
      p.y = rng.int(0, 2 * H);
      p.vx = 0;
      p.vy = -rng.int(32, 74);
      p.s = rng.int(2, 3);
      p.ph = rng.range(0, Math.PI * 2);
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += Math.sin(t * 3 + p.ph) * 22 * dt;
    },
    render: (ctx, p, t) => {
      ctx.globalAlpha *= 0.6 + 0.4 * Math.sin(t * 8 + p.ph); // flicker, never fully out
      dot(ctx, p);
    },
  },
  ash: {
    count: 80,
    alpha: 0.65,
    parallax: 0.12,
    recycle: 'down',
    // grey flecks: light-grey slot + a darker grey, so it reads as ash not colour
    colors: (pal) => [pal[14] ?? '#99a', shade(pal[14] ?? '#99a', 0.72), pal[14] ?? '#99a'],
    spawn: (p, rng, cols) => {
      p.x = rng.int(0, W);
      p.y = rng.int(-H, H);
      p.vx = 0;
      p.vy = rng.int(16, 38);
      p.s = rng.int(1, 2);
      p.ph = rng.range(0, Math.PI * 2);
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += Math.sin(t + p.ph) * 9 * dt;
    },
    render: dot,
  },
  leaves: {
    count: 30,
    alpha: 0.85,
    parallax: 0.18,
    recycle: 'down',
    colors: (pal) => [pal[6] ?? '#7d4', pal[13] ?? '#fd5', pal[12] ?? '#fa0'],
    spawn: (p, rng, cols) => {
      p.x = rng.int(0, W);
      p.y = rng.int(-H, H);
      p.vx = rng.int(-10, 30);
      p.vy = rng.int(30, 60);
      p.s = rng.int(2, 4);
      p.ph = rng.range(0, Math.PI * 2);
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t * 2 + p.ph) * 40) * dt;
    },
    render: (ctx, p, t) => {
      // tumble: width pulses so the flake reads as spinning
      const w = 1 + Math.round((0.5 + 0.5 * Math.abs(Math.sin(t * 4 + p.ph))) * p.s);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), w, p.s);
    },
  },
  petals: {
    count: 48,
    alpha: 0.88,
    parallax: 0.16,
    recycle: 'down',
    colors: (pal) => [pal[15] ?? '#fff', pal[15] ?? '#fff', pal[6] ?? '#f9c', pal[14] ?? '#ecd'],
    spawn: (p, rng, cols) => {
      p.x = rng.int(0, W);
      p.y = rng.int(-H, H);
      p.vx = rng.int(-8, 24);
      p.vy = rng.int(22, 44);
      p.s = rng.int(2, 4);
      p.ph = rng.range(0, Math.PI * 2);
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t * 1.8 + p.ph) * 34) * dt;
    },
    render: (ctx, p, t) => {
      // softer tumble than leaves: pulses width but keeps a rounder 2px-ish body
      const w = 1 + Math.round((0.5 + 0.5 * Math.abs(Math.sin(t * 3 + p.ph))) * p.s);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), w, Math.max(2, p.s - 1));
    },
  },
  fog: {
    count: 5,
    alpha: 0.2,
    parallax: 0.05,
    recycle: 'wrap',
    // light slots so a band reads over both the dark top and the light band
    colors: (pal) => [pal[14] ?? '#99a', shade(pal[4] ?? '#446', 1.4)],
    spawn: (p, rng, cols) => {
      p.x = rng.int(-W, W);
      p.y = rng.int(40, H - 40);
      p.vx = rng.chance(0.5) ? rng.int(6, 16) : -rng.int(6, 16);
      p.vy = 0;
      p.s = rng.int(70, 150); // band width
      p.ph = rng.int(24, 42); // band height
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt) => {
      p.x += p.vx * dt;
    },
    render: (ctx, p) => {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      const bw = p.s;
      const h3 = Math.max(2, Math.round(p.ph / 3));
      const base = ctx.globalAlpha;
      ctx.fillStyle = p.c;
      // faint / solid / faint strips give the band soft top & bottom edges
      for (let k = 0; k < 3; k++) {
        ctx.globalAlpha = base * (k === 1 ? 1 : 0.45);
        ctx.fillRect(x, y + k * h3, bw, h3);
        ctx.fillRect(x - W, y + k * h3, bw, h3); // wrap seam
      }
      ctx.globalAlpha = base;
    },
  },
  bubbles: {
    count: 34,
    alpha: 0.5,
    parallax: 0.1,
    recycle: 'up',
    colors: (pal) => [pal[14] ?? '#adf', pal[15] ?? '#fff'],
    spawn: (p, rng, cols) => {
      p.x = rng.int(0, W);
      p.y = rng.int(0, 2 * H);
      p.vx = 0;
      p.vy = -rng.int(24, 54);
      p.s = rng.int(2, 5);
      p.ph = rng.range(0, Math.PI * 2);
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt, t) => {
      p.y += p.vy * dt;
      p.x += Math.sin(t * 2 + p.ph) * 12 * dt;
    },
    render: (ctx, p) => {
      ctx.strokeStyle = p.c;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(Math.round(p.x), Math.round(p.y), p.s, 0, Math.PI * 2);
      ctx.stroke();
    },
  },
  fireflies: {
    count: 40,
    alpha: 1,
    parallax: 0.15,
    recycle: 'wrap',
    // classic yellow-green glow: gold + green, no orange, to read apart from embers
    colors: (pal) => [pal[13] ?? '#fd5', pal[13] ?? '#fd5', pal[6] ?? '#af6', pal[6] ?? '#af6'],
    spawn: (p, rng, cols) => {
      p.x = rng.int(0, W);
      p.y = rng.int(0, H);
      p.vx = rng.int(-16, 16);
      p.vy = rng.int(-10, 10);
      p.s = rng.int(2, 3);
      p.ph = rng.range(0, Math.PI * 2);
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt, t) => {
      p.x += (p.vx + Math.sin(t + p.ph) * 12) * dt;
      p.y += (p.vy + Math.cos(t * 0.8 + p.ph) * 10) * dt;
    },
    render: (ctx, p, t) => {
      const g = 0.5 + 0.5 * Math.sin(t * 4 + p.ph);
      ctx.globalAlpha *= 0.15 + 0.85 * g * g; // pulse, but a faint glow always lingers
      const s = p.s + (g > 0.8 ? 1 : 0); // brightest glints swell to a clear glint
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    },
  },
  dust: {
    count: 68,
    alpha: 0.5,
    parallax: 0.14,
    recycle: 'wrap',
    colors: (pal) => [pal[14] ?? '#ccb', pal[14] ?? '#ccb', shade(pal[4] ?? '#987', 1.3)],
    spawn: (p, rng, cols) => {
      p.x = rng.int(0, W);
      p.y = rng.int(0, H);
      p.vx = rng.int(8, 26);
      p.vy = rng.int(-4, 6);
      p.s = rng.chance(0.3) ? 2 : 1; // mostly fine motes, a few slightly larger
      p.ph = rng.range(0, Math.PI * 2);
      p.c = cols[rng.int(0, cols.length - 1)]!;
    },
    step: (p, dt, t) => {
      p.x += p.vx * dt;
      p.y += (p.vy + Math.sin(t * 0.6 + p.ph) * 6) * dt;
    },
    render: dot,
  },
};

class NoWeather implements Weather {
  update(): void {}
  draw(): void {}
}

class Field implements Weather {
  private ps: P[];
  private t = 0;
  constructor(
    private kind: Kind,
    seed: number,
    palette: string[],
  ) {
    const rng = new Rng(seed ^ 0x77ea731);
    const cols = kind.colors(palette);
    this.ps = Array.from({ length: kind.count }, () => {
      const p: P = { x: 0, y: 0, vx: 0, vy: 0, s: 1, ph: 0, c: '#fff' };
      kind.spawn(p, rng, cols);
      return p;
    });
  }

  update(dt: number): void {
    this.t += dt;
    const m = 24;
    for (const p of this.ps) {
      this.kind.step(p, dt, this.t);
      // recycle off-screen so the field is endless without reallocation
      if (this.kind.recycle === 'down' && p.y > H + m) {
        p.y = -m;
        p.x = ((p.x % W) + W) % W;
      } else if (this.kind.recycle === 'up' && p.y < -m) {
        p.y = H + m;
        p.x = ((p.x % W) + W) % W;
      } else if (this.kind.recycle === 'wrap') {
        p.x = ((p.x % W) + W) % W;
        p.y = ((p.y % H) + H) % H;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, scrollX: number): void {
    const ox = this.kind.parallax ? -Math.round(scrollX * this.kind.parallax) : 0;
    const base = this.kind.alpha;
    ctx.save();
    for (const p of this.ps) {
      const realX = p.x;
      p.x = (((realX + ox) % W) + W) % W; // apply parallax without allocating
      ctx.globalAlpha = base; // reset per particle (render may multiply for flicker)
      this.kind.render(ctx, p, this.t);
      p.x = realX;
    }
    ctx.restore();
  }
}

export function makeWeather(kind: WeatherKind, palette: string[], seed: number): Weather {
  const k = KINDS[kind];
  return k ? new Field(k, seed, palette) : new NoWeather();
}
