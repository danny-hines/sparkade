// Dev-only asset gallery (http://localhost:5173/?dev=assets): every library
// sprite, the bitmap font, AND the procedural backdrops — all rendered by the
// REAL engine code (decodeSprite / makeBackdrop), so what you review is what
// ships. Tabbed + mouse-and-scroll friendly; tree-shaken out of production
// builds via the import.meta.env.DEV gate in app.tsx.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  BACKDROP_VARIANTS,
  decodeSprite,
  FONT_GLYPHS,
  LIBRARY,
  makeBackdrop,
  makeWeather,
  WEATHER_KINDS,
  type LibraryEntry,
} from '@sparkade/engine';
import { LIB_TILE_THEMES, PALETTE_MOODS } from '@sparkade/shared';
import type { GameListItem, PaletteMood } from '@sparkade/shared';
import { api } from '../api';

/** Same preview palette the contact-sheet checker uses (Sweetie-16-derived). */
const PREVIEW_PALETTE = [
  '#000000', '#1a1c2c', '#29366f', '#3b5dc9', '#41a6f6', '#38b764', '#a7f070', '#ffcd75',
  '#b13e53', '#ef7d57', '#5d275d', '#e04040', '#ffa300', '#ffd75e', '#94b0c2', '#f4f4f4',
];

type Matcher = (id: string) => boolean;

// Sprite groups become top-level tabs. Tiles collapse into a single 'Tiles' tab
// with a family sub-selector, since there are many families and you review them
// against each other; Backdrops and Font are their own tabs.
const SPRITE_TABS: [string, Matcher][] = [
  ['Heroes & ships', (id) => /^(hero_|ship_)/.test(id)],
  ['Enemies & foes', (id) => /^(enemy_|foe_)/.test(id)],
  ['Bosses', (id) => /^boss_/.test(id)],
  ['NPCs', (id) => /^npc_/.test(id)],
  ['Props', (id) => /^(proj_|pickup_|item_|obj_)/.test(id)],
];

// Tile families come from the shared constant so new themes appear automatically.
const TILE_FAMILIES: [string, Matcher][] = [
  ['default', (id) => /^tile_/.test(id)],
  ...LIB_TILE_THEMES.map((t): [string, Matcher] => [t, (id) => id.startsWith(`${t}_`)]),
];

const isTileId = (id: string) =>
  id.startsWith('tile_') || LIB_TILE_THEMES.some((t) => id.startsWith(`${t}_`));

function SpriteCell(props: {
  id: string;
  entry: LibraryEntry;
  palette: string[];
  zoom: number;
  animate: boolean;
  tiled: boolean;
  headSlots: boolean;
}): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const frames = props.entry.frames.map((f) => decodeSprite(f, props.palette));
    let fi = 0;
    const draw = () => {
      const f = props.entry.frames[fi]!;
      const img = frames[fi]!;
      const reps = props.tiled && isTileId(props.id) ? 3 : 1;
      canvas.width = f.w * props.zoom * reps;
      canvas.height = f.h * props.zoom * reps;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      for (let ry = 0; ry < reps; ry++)
        for (let rx = 0; rx < reps; rx++)
          ctx.drawImage(img, rx * f.w * props.zoom, ry * f.h * props.zoom, f.w * props.zoom, f.h * props.zoom);
      if (props.headSlots && props.entry.headSlots) {
        const hs = props.entry.headSlots[fi] ?? props.entry.headSlots[0]!;
        ctx.strokeStyle = '#ff9a2a';
        ctx.strokeRect(
          hs.x * props.zoom + 0.5,
          hs.y * props.zoom + 0.5,
          hs.size * props.zoom - 1,
          hs.size * props.zoom - 1,
        );
      }
    };
    draw();
    if (!props.animate || props.entry.frames.length < 2) return;
    const t = setInterval(() => {
      fi = (fi + 1) % props.entry.frames.length;
      draw();
    }, 400);
    return () => clearInterval(t);
  }, [props.id, props.palette, props.zoom, props.animate, props.tiled, props.headSlots]);
  const f0 = props.entry.frames[0]!;
  return (
    <div class="gal-cell">
      <canvas ref={ref} />
      <div class="gal-id">{props.id}</div>
      <div class="gal-meta">
        {f0.w}×{f0.h} · {props.entry.frames.length}f
      </div>
    </div>
  );
}

const SLOT_LABELS = '0123456789abcdef';

/** A curated palette mood: labeled 16-swatch strip + an in-use mini scene. */
function PaletteCell(props: { mood: PaletteMood }): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  const c = props.mood.colors;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const W = 300;
    const H = 78;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    // bg bands (2,3,4)
    ctx.fillStyle = c[2]!; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = c[3]!; ctx.fillRect(0, 0, W, Math.floor(H * 0.66));
    ctx.fillStyle = c[4]!; ctx.fillRect(0, 0, W, Math.floor(H * 0.33));
    const disc = (cx: number, cy: number, r: number, col: string) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    // hero (5/6/7 + outline 1)
    disc(46, 46, 19, c[1]!); disc(46, 46, 17, c[5]!); disc(46, 42, 10, c[6]!); disc(42, 39, 3.5, c[7]!);
    // enemy (8/9/a + outline)
    disc(112, 46, 17, c[1]!); disc(112, 46, 15, c[8]!); disc(112, 43, 8, c[9]!); disc(109, 40, 3, c[10]!);
    // hazard spikes (b)
    ctx.fillStyle = c[11]!;
    for (let k = 0; k < 5; k++) { const hx = 150 + k * 12; ctx.beginPath(); ctx.moveTo(hx, H - 4); ctx.lineTo(hx + 5, H - 14); ctx.lineTo(hx + 10, H - 4); ctx.fill(); }
    // gold pips (d) + warm accent (c)
    disc(225, 22, 6, c[13]!); disc(242, 30, 6, c[13]!); disc(233, 44, 5, c[12]!);
    // text-contrast chip: near-white (f) 'text' bars on bg-dark (2)
    ctx.fillStyle = c[2]!; ctx.fillRect(255, 14, 40, 50);
    ctx.fillStyle = c[15]!;
    for (const bx of [259, 266, 273, 280, 287]) ctx.fillRect(bx, 26, 4, 26);
  }, [props.mood.id]);
  return (
    <div class="gal-cell gal-palette">
      <div class="gal-swatches">
        {c.map((hex, i) => (
          <div key={i} class="gal-swatch" style={`background:${hex}`} title={`slot ${SLOT_LABELS[i]} · ${hex}`}>
            <span>{SLOT_LABELS[i]}</span>
          </div>
        ))}
      </div>
      <canvas ref={ref} style="width:300px;height:78px" />
      <div class="gal-id">{props.mood.name}</div>
      <div class="gal-meta">{props.mood.hint}</div>
    </div>
  );
}

/** A live weather panel: the real makeWeather overlay over a sample backdrop. */
function WeatherCell(props: { kind: string; palette: string[]; seed: number }): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = 512;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const backdrop = makeBackdrop(props.palette, props.seed, 'mountains');
    const weather = makeWeather(props.kind as never, props.palette, props.seed);
    let scroll = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      scroll += dt * 40;
      weather.update(dt);
      ctx.fillStyle = props.palette[2] ?? '#111';
      ctx.fillRect(0, 0, 512, 300);
      backdrop.draw(ctx, scroll, 0);
      weather.draw(ctx, scroll, 0);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.kind, props.palette, props.seed]);
  return (
    <div class="gal-cell">
      <canvas ref={ref} style="width:340px;height:199px" />
      <div class="gal-id">{props.kind}</div>
    </div>
  );
}

/** A live backdrop panel: the real generator, parallax animated. */
function BackdropCell(props: { variant: string; palette: string[]; seed: number }): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = 512;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const backdrop = makeBackdrop(props.palette, props.seed, props.variant as never);
    let scroll = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      scroll += ((now - last) / 1000) * 60; // simulate camera motion to show parallax
      last = now;
      ctx.fillStyle = props.palette[2] ?? '#111';
      ctx.fillRect(0, 0, 512, 300);
      backdrop.draw(ctx, scroll, 0);
      backdrop.drawForeground(ctx, scroll, 0); // close foreground plane (parallax > 1)
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.variant, props.palette, props.seed]);
  return (
    <div class="gal-cell">
      <canvas ref={ref} style="width:384px;height:225px" />
      <div class="gal-id">
        {props.variant} · seed {props.seed}
      </div>
    </div>
  );
}

const TABS = ['Palettes', 'Backdrops', 'Weather', ...SPRITE_TABS.map(([t]) => t), 'Tiles', 'Font'] as const;

export function AssetsGalleryScreen(): ComponentChildren {
  const [games, setGames] = useState<GameListItem[]>([]);
  const [paletteId, setPaletteId] = useState('preview');
  const [zoom, setZoom] = useState(5);
  const [animate, setAnimate] = useState(true);
  const [tiled, setTiled] = useState(true);
  const [headSlots, setHeadSlots] = useState(false);
  const [seed, setSeed] = useState(12345);
  const [tab, setTab] = useState<string>('Heroes & ships');
  const [tileFamily, setTileFamily] = useState('default');

  useEffect(() => {
    // Unlock the kiosk viewport lock on BOTH html and body — html keeps its fixed
    // 600px height + overflow:hidden otherwise, which clips the scrollable body.
    document.documentElement.classList.add('dev-gallery');
    document.body.classList.add('dev-gallery');
    void api.listGames().then(setGames).catch(() => {});
    return () => {
      document.documentElement.classList.remove('dev-gallery');
      document.body.classList.remove('dev-gallery');
    };
  }, []);

  const palettes = useMemo(() => {
    const list: { id: string; title: string; palette: string[] }[] = [
      { id: 'preview', title: 'Preview (slot semantics)', palette: PREVIEW_PALETTE },
    ];
    for (const g of games) {
      if (g.cover?.palette) list.push({ id: g.id, title: `${g.title} (${g.archetype})`, palette: g.cover.palette });
    }
    return list;
  }, [games]);
  const palette = palettes.find((p) => p.id === paletteId)?.palette ?? PREVIEW_PALETTE;

  const ids = Object.keys(LIBRARY);
  const countFor = (name: string): number => {
    if (name === 'Palettes') return PALETTE_MOODS.length;
    if (name === 'Backdrops') return BACKDROP_VARIANTS.length;
    if (name === 'Weather') return WEATHER_KINDS.length;
    if (name === 'Font') return Object.keys(FONT_GLYPHS).length;
    if (name === 'Tiles') return ids.filter(isTileId).length;
    return ids.filter(SPRITE_TABS.find(([t]) => t === name)?.[1] ?? (() => false)).length;
  };

  const spriteGrid = (matched: string[]): ComponentChildren => (
    <div class="gal-grid">
      {matched.map((id) => (
        <SpriteCell
          key={id}
          id={id}
          entry={LIBRARY[id]!}
          palette={palette}
          zoom={zoom}
          animate={animate}
          tiled={tiled}
          headSlots={headSlots}
        />
      ))}
    </div>
  );

  const activeSprite = SPRITE_TABS.find(([t]) => t === tab);
  const tileMatch = TILE_FAMILIES.find(([t]) => t === tileFamily)?.[1] ?? (() => false);

  return (
    <div class="gal-page">
      <div class="gal-header">
        <h1>
          Sparkade asset gallery <span class="gal-dim">(dev only — colors come from the selected palette)</span>{' '}
          <a href="/?dev=likeness" style="color:var(--cyan);text-decoration:none;font-size:14px">→ likeness lab</a>
        </h1>
        <div class="gal-controls">
          <label>
            Palette{' '}
            <select value={paletteId} onChange={(e) => setPaletteId((e.target as HTMLSelectElement).value)}>
              {palettes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Zoom{' '}
            <select value={zoom} onChange={(e) => setZoom(Number((e.target as HTMLSelectElement).value))}>
              <option>3</option>
              <option>5</option>
              <option>8</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={animate} onChange={(e) => setAnimate((e.target as HTMLInputElement).checked)} /> Animate
          </label>
          <label>
            <input type="checkbox" checked={tiled} onChange={(e) => setTiled((e.target as HTMLInputElement).checked)} /> 3×3 tile previews
          </label>
          <label>
            <input type="checkbox" checked={headSlots} onChange={(e) => setHeadSlots((e.target as HTMLInputElement).checked)} /> Head slots
          </label>
        </div>
        <div class="gal-tabs" role="tablist">
          {TABS.map((name) => {
            const n = countFor(name);
            return (
              <button
                key={name}
                type="button"
                class={`gal-tab${tab === name ? ' active' : ''}${n === 0 ? ' gal-warn' : ''}`}
                aria-selected={tab === name}
                onClick={() => setTab(name)}
              >
                {name} <span class="gal-tab-n">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div class="gal-panel">
        {tab === 'Palettes' && (
          <div>
            <div class="gal-controls gal-subcontrols">
              <span class="gal-dim">Curated moods — the design cookbook + legibility fallback. Each passes the palette validator. Swatch slots 0–f; scene shows hero/enemy/hazard/gold/text-in-use.</span>
            </div>
            <div class="gal-grid">
              {PALETTE_MOODS.map((m) => (
                <PaletteCell key={m.id} mood={m} />
              ))}
            </div>
          </div>
        )}

        {tab === 'Backdrops' && (
          <div>
            <div class="gal-controls gal-subcontrols">
              <span class="gal-dim">Procedural — the real generator, parallax animated.</span>
              <label>
                Seed <input type="number" value={seed} style="width:110px" onChange={(e) => setSeed(Number((e.target as HTMLInputElement).value) || 0)} />
              </label>
              <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>Reroll</button>
            </div>
            <div class="gal-grid">
              {BACKDROP_VARIANTS.map((v) => (
                <BackdropCell key={`${v}-${seed}-${paletteId}`} variant={v} palette={palette} seed={seed} />
              ))}
            </div>
          </div>
        )}

        {tab === 'Weather' && (
          <div>
            <div class="gal-controls gal-subcontrols">
              <span class="gal-dim">Ambient overlays (real makeWeather) over a sample backdrop — as drawn over gameplay, under the HUD.</span>
              <label>
                Seed <input type="number" value={seed} style="width:110px" onChange={(e) => setSeed(Number((e.target as HTMLInputElement).value) || 0)} />
              </label>
              <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>Reroll</button>
            </div>
            <div class="gal-grid">
              {WEATHER_KINDS.map((k) => (
                <WeatherCell key={`${k}-${seed}-${paletteId}`} kind={k} palette={palette} seed={seed} />
              ))}
            </div>
          </div>
        )}

        {activeSprite && (
          <div>
            {countFor(tab) === 0 && <p class="gal-warn">No sprites match this group — MISSING.</p>}
            {spriteGrid(ids.filter(activeSprite[1]))}
          </div>
        )}

        {tab === 'Tiles' && (
          <div>
            <div class="gal-tabs gal-subtabs" role="tablist">
              {TILE_FAMILIES.map(([name, match]) => {
                const n = ids.filter(match).length;
                return (
                  <button
                    key={name}
                    type="button"
                    class={`gal-tab${tileFamily === name ? ' active' : ''}${n === 0 ? ' gal-warn' : ''}`}
                    aria-selected={tileFamily === name}
                    onClick={() => setTileFamily(name)}
                  >
                    {name} <span class="gal-tab-n">{n}</span>
                  </button>
                );
              })}
            </div>
            {spriteGrid(ids.filter(tileMatch))}
          </div>
        )}

        {tab === 'Font' && (
          <div class="gal-grid">
            {Object.entries(FONT_GLYPHS).map(([ch, rows]) => (
              <FontCell key={ch} ch={ch} rows={rows} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FontCell(props: { ch: string; rows: string[] }): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f4f4f4';
    props.rows.forEach((row, y) => {
      for (let x = 0; x < 8; x++) if (row[x] === '#') ctx.fillRect(x * 4, y * 4, 4, 4);
    });
  }, [props.ch]);
  return (
    <div class="gal-cell">
      <canvas ref={ref} />
      <div class="gal-id">{JSON.stringify(props.ch)}</div>
    </div>
  );
}
