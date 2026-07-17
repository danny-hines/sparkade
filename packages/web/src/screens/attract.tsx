// Attract screen: logo + PRESS START, a featured-game marquee, and the
// dream-field — sprites from the library's own games drifting up from the
// bottom, fading from idea into existence. Kept deliberately calm: few
// sprites, low opacity, all dissolved before the title zone, disabled under
// prefers-reduced-motion, and cheap enough to idle for hours on a Pi 3B+.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { decodeSprite } from '@sparkade/engine';
import type { GameListItem } from '@sparkade/shared';
import { api } from '../api';
import { GameCover } from '../components';
import { shellInput } from '../shell-input';
import type { Screen } from '../app';

const W = 1024;
const H = 600;
const MAX_DREAMS = 8;
const SPAWN_EVERY_S = 1.5;
const COALESCE_S = 1.2; // how long the star-pixels take to rush in and assemble

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
/** Smooth 0→1 ramp between edges a and b. */
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Sample up to n opaque pixels (home position + colour) so a sprite can be
 *  reconstituted from drifting star-pixels. Done once per pool sprite. */
function samplePixels(img: HTMLCanvasElement, n: number): { hx: number; hy: number; color: string }[] {
  const ctx = img.getContext('2d');
  if (!ctx) return [];
  const w = img.width;
  const h = img.height;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return [];
  }
  const opaque: number[] = [];
  for (let i = 0; i < w * h; i++) if ((data[i * 4 + 3] ?? 0) > 40) opaque.push(i);
  if (!opaque.length) return [];
  const out: { hx: number; hy: number; color: string }[] = [];
  const step = Math.max(1, opaque.length / n);
  for (let k = 0; out.length < n && Math.floor(k) < opaque.length; k += step) {
    const idx = opaque[Math.floor(k)]!;
    const o = idx * 4;
    const r = data[o] ?? 0;
    const gg = data[o + 1] ?? 0;
    const bb = data[o + 2] ?? 0;
    out.push({ hx: idx % w, hy: Math.floor(idx / w), color: `rgb(${r},${gg},${bb})` });
  }
  return out;
}

interface Dream {
  active: boolean;
  img: HTMLCanvasElement;
  x: number;
  y: number;
  speed: number; // px/s upward
  swayAmp: number;
  swayHz: number;
  swayPhase: number;
  scale: number;
  peakAlpha: number;
  spawnY: number;
  /** Fully dissolved by this y — randomized so there's no visible cutoff line. */
  dissolveY: number;
  t: number;
  /** Star-pixels that rush in to assemble the sprite: home (hx,hy) + colour +
   *  scattered start offset (ox,oy) from the sprite centre. */
  parts: { hx: number; hy: number; color: string; ox: number; oy: number }[];
}

function DreamField(props: { games: GameListItem[] }): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Decode every cover sprite once (hero, showcase enemy, boss — per game,
    // in that game's own palette). Bosses drift as big dim shapes.
    const pool: { img: HTMLCanvasElement; big: boolean; pixels: { hx: number; hy: number; color: string }[] }[] = [];
    for (const g of props.games) {
      const cover = g.cover;
      if (!cover) continue;
      for (const [data, big] of [
        [cover.hero, false],
        [cover.enemy, false],
        [cover.boss, true],
      ] as const) {
        if (!data) continue;
        try {
          const img = decodeSprite(data, cover.palette);
          pool.push({ img, big, pixels: samplePixels(img, big ? 12 : 16) });
        } catch {
          /* skip malformed sprite */
        }
      }
    }
    if (pool.length === 0) return;

    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    const dreams: Dream[] = Array.from({ length: MAX_DREAMS }, () => ({
      active: false,
      img: pool[0]!.img,
      x: 0,
      y: 0,
      speed: 0,
      swayAmp: 0,
      swayHz: 0,
      swayPhase: 0,
      scale: 2,
      peakAlpha: 0.4,
      spawnY: H,
      dissolveY: 150,
      t: 0,
      parts: [],
    }));

    const spawn = () => {
      const slot = dreams.find((d) => !d.active);
      if (!slot) return;
      const pick = pool[Math.floor(Math.random() * pool.length)]!;
      slot.active = true;
      slot.img = pick.img;
      slot.scale = pick.big ? 2 : Math.random() < 0.4 ? 3 : 2;
      slot.x = 40 + Math.random() * (W - 120);
      const sh = pick.img.height * slot.scale;
      const halfW = (pick.img.width * slot.scale) / 2;
      // Coalesce in the lower third — clearly on-screen — then drift up and dissolve.
      slot.spawnY = H - 60 - Math.random() * 100 - sh / 2;
      slot.y = slot.spawnY;
      // Scatter each pixel out from the centre; it rushes back to home as it forms.
      slot.parts = pick.pixels.map((p) => {
        const a = Math.random() * Math.PI * 2;
        const dist = halfW * (0.7 + Math.random() * 1.2);
        return { hx: p.hx, hy: p.hy, color: p.color, ox: Math.cos(a) * dist, oy: Math.sin(a) * dist };
      });
      slot.speed = 16 + Math.random() * 18;
      slot.swayAmp = 8 + Math.random() * 14;
      slot.swayHz = 0.08 + Math.random() * 0.1;
      slot.swayPhase = Math.random() * Math.PI * 2;
      // Bosses stay extra faint; small sprites still gentle.
      slot.peakAlpha = pick.big ? 0.16 + Math.random() * 0.08 : 0.26 + Math.random() * 0.16;
      slot.dissolveY = 130 + Math.random() * 150;
      slot.t = 0;
    };

    let raf = 0;
    let last = performance.now();
    let spawnClock = SPAWN_EVERY_S; // first sprite appears immediately
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      spawnClock += dt;
      if (spawnClock >= SPAWN_EVERY_S) {
        spawnClock = 0;
        spawn();
      }
      ctx.clearRect(0, 0, W, H);
      for (const d of dreams) {
        if (!d.active) continue;
        d.t += dt;
        d.y -= d.speed * dt;
        const h = d.img.height * d.scale;
        if (d.y + h < d.dissolveY) {
          d.active = false;
          continue;
        }
        // Dissolve approaching this dream's own ceiling.
        const fadeOut = Math.max(0, Math.min(1, (d.y + h - d.dissolveY) / 110));
        if (fadeOut <= 0.01) continue;
        const x = Math.round(d.x + Math.sin(d.t * d.swayHz * Math.PI * 2 + d.swayPhase) * d.swayAmp);
        const y = Math.round(d.y);
        const sw = d.img.width * d.scale;
        const c = Math.min(1, d.t / COALESCE_S); // 0 = scattered star-pixels, 1 = assembled

        // The finished sprite ramps in as the star-pixels land, holds at
        // peakAlpha, then dissolves near its ceiling.
        const spriteAlpha = d.peakAlpha * smooth(0.45, 1, c) * fadeOut;
        if (spriteAlpha > 0.01) {
          ctx.globalAlpha = spriteAlpha;
          ctx.drawImage(d.img, x, y, sw, h);
        }

        // Star-pixels rush from a scattered ring into their home pixels — bright
        // white in flight, settling into the sprite's own colours — and fade out
        // as the assembled sprite takes over.
        if (c < 1) {
          const pAlpha = (1 - smooth(0.5, 1, c)) * fadeOut;
          if (pAlpha > 0.01) {
            const inv = 1 - easeOut(c); // 1 = scattered, 0 = home
            const white = easeOut(c) < 0.7;
            const cx = x + sw / 2;
            const cy = y + h / 2;
            const sz = Math.max(2, Math.round(d.scale));
            ctx.globalAlpha = pAlpha;
            if (white) ctx.fillStyle = '#ffffff';
            for (const p of d.parts) {
              const homeX = x + p.hx * d.scale;
              const homeY = y + p.hy * d.scale;
              if (!white) ctx.fillStyle = p.color;
              ctx.fillRect(Math.round(homeX + (cx + p.ox - homeX) * inv), Math.round(homeY + (cy + p.oy - homeY) * inv), sz, sz);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.games]);

  return <canvas ref={ref} class="dream-field" />;
}

export function AttractScreen(props: { go: (s: Screen) => void }): ComponentChildren {
  const [games, setGames] = useState<GameListItem[]>([]);
  const [spot, setSpot] = useState(0);

  useEffect(() => {
    void api.listGames().then((g) => setGames(g.filter((x) => x.status === 'ready')));
    const t = setInterval(() => setSpot((s) => s + 1), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(
    () =>
      shellInput.pushHandler((btn) => {
        if (btn === 'START' || btn === 'A') {
          shellInput.blip('select');
          props.go({ name: 'home' });
        }
      }),
    [props.go],
  );

  const featured = games.length ? games[spot % games.length] : null;

  return (
    <div class="screen attract" style="justify-content:center">
      <DreamField games={games} />
      <div class="center-col" style="position:relative;z-index:1">
        <div class="logo pixel">
          SPARK<span class="spark">ADE</span>
        </div>
        <div style="color:var(--text-dim);font-size:21px">The arcade that dreams up its own games</div>
        {featured && (
          <div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:6px">
            <GameCover
              cover={featured.cover}
              archetype={featured.archetype}
              gameId={featured.id}
              seedText={featured.title}
              class="marquee"
            />
            <div style="color:var(--cyan);font-size:18px">{featured.title}</div>
          </div>
        )}
        <div class="press-start" style="margin-top:26px">
          PRESS START
        </div>
      </div>
    </div>
  );
}
