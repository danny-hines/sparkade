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
}

function DreamField(props: { games: GameListItem[] }): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Decode every cover sprite once (hero, showcase enemy, boss — per game,
    // in that game's own palette). Bosses drift as big dim shapes.
    const pool: { img: HTMLCanvasElement; big: boolean }[] = [];
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
          pool.push({ img: decodeSprite(data, cover.palette), big });
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
    }));

    const spawn = () => {
      const slot = dreams.find((d) => !d.active);
      if (!slot) return;
      const pick = pool[Math.floor(Math.random() * pool.length)]!;
      slot.active = true;
      slot.img = pick.img;
      slot.scale = pick.big ? 2 : Math.random() < 0.4 ? 3 : 2;
      slot.x = 40 + Math.random() * (W - 120);
      slot.spawnY = H + 20;
      slot.y = slot.spawnY;
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
        // idea → reality: fade in over the first ~130px of rise…
        const risen = d.spawnY - d.y;
        const fadeIn = Math.min(1, risen / 130);
        // …then dissolve approaching this dream's own ceiling.
        const fadeOut = Math.max(0, Math.min(1, (d.y + h - d.dissolveY) / 110));
        const alpha = d.peakAlpha * Math.min(fadeIn, fadeOut);
        if (alpha <= 0.01) continue;
        const x = Math.round(d.x + Math.sin(d.t * d.swayHz * Math.PI * 2 + d.swayPhase) * d.swayAmp);
        const y = Math.round(d.y);
        ctx.globalAlpha = alpha;
        ctx.drawImage(d.img, x, y, d.img.width * d.scale, h);
        // a few twinkles while materializing
        if (fadeIn < 1) {
          ctx.globalAlpha = (1 - fadeIn) * 0.8;
          ctx.fillStyle = '#f4f4f4';
          for (let i = 0; i < 3; i++) {
            const tx = x + Math.round(((i * 53 + d.swayPhase * 37) % (d.img.width * d.scale + 16)) - 8);
            const ty = y + Math.round((i * 31 + d.t * 60) % h);
            ctx.fillRect(tx, ty, 2, 2);
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
            <GameCover cover={featured.cover} gameId={featured.id} seedText={featured.title} class="marquee" />
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
