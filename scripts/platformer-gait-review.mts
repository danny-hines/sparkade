#!/usr/bin/env tsx
// Gait review page: plays each saved game's production run frames as the
// runtime does today, with runtime polish (bob, squash, lean, dust), with
// procedural in-between frames, and with both. In-betweens are generated
// offline from the existing frames; no model calls. Output is one
// self-contained HTML file.
//
//   npx tsx scripts/platformer-gait-review.mts            # ten varied games
//   npx tsx scripts/platformer-gait-review.mts --all      # every saved platformer
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  alignSprites,
  ditherInbetween,
  encodeSprite,
  flowInbetween,
} from '../packages/server/src/assets/platformer-inbetween';

const root = resolve(import.meta.dirname, '..');
const dataDir = resolve(process.env.SPARKADE_DATA ?? join(root, 'data'));
const gamesDir = join(dataDir, 'games');
const out = join(dataDir, 'experiments', 'platformer-gait');
const DEFAULT_GAMES = [
  'golden-platformer',
  'g-3ozov1rfzj',
  'g-9ncsqbiwot',
  'g-gwj65cz1hv',
  'g-hsqnmk8ntw',
  'g-mkujetzsu4',
  'g-aco9qwvbvx',
  'g-hehhcnoczp',
  'g-28mdl1klva',
  'g-k8dta3erxq',
];
const FILES = { walk1: 'walk-1', idle: 'side-idle', walk2: 'walk-2' } as const;
const asset = (game: string, name: string) =>
  join(gamesDir, game, 'assets', `platformer-player-${name}.png`);
const games = process.argv.includes('--all')
  ? readdirSync(gamesDir)
      .filter((game) => Object.values(FILES).every((name) => existsSync(asset(game, name))))
      .sort()
  : DEFAULT_GAMES;

const uri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
const rows: Array<{ id: string; title: string; frames: Record<string, string> }> = [];
for (const game of games) {
  const [walk1, idle, walk2] = await alignSprites(
    (['walk1', 'idle', 'walk2'] as const).map((pose) => readFileSync(asset(game, FILES[pose]))),
  );
  // Half-stride frames come from the contact frames, which have two legs to
  // close; the idle has none to open.
  const frames = {
    walk1: walk1!,
    idle: idle!,
    walk2: walk2!,
    flow1: flowInbetween(walk1!, idle!),
    flow2: flowInbetween(walk2!, idle!),
    // A third of the way stretches fast hands and feet less than halfway.
    third1: flowInbetween(walk1!, idle!, 1 / 3),
    third2: flowInbetween(walk2!, idle!, 1 / 3),
    dither1: ditherInbetween(walk1!, idle!),
    dither2: ditherInbetween(walk2!, idle!),
  };
  const encoded: Record<string, string> = {};
  for (const [name, sprite] of Object.entries(frames)) {
    const png = await encodeSprite(sprite);
    mkdirSync(join(out, 'frames', game), { recursive: true });
    writeFileSync(join(out, 'frames', game, `${name}.png`), png);
    encoded[name] = uri(png);
  }
  const spec = JSON.parse(readFileSync(join(gamesDir, game, 'game.json'), 'utf8')) as {
    meta?: { heroConcept?: string };
  };
  rows.push({ id: game, title: spec.meta?.heroConcept ?? '', frames: encoded });
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Run Gait Review</title>
<style>
:root{--bg:#f3f4f6;--fg:#1c2027;--muted:#5b6370;--card:#fff;--line:#d8dce3;--stage:#cfd8e3;--ground:#7d8a9c;--accent:#3b5bdb}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121418;--fg:#e7e9ee;--muted:#9aa3b2;--card:#1b1e24;--line:#30353f;--stage:#2a313c;--ground:#5d6b80;--accent:#8ea8ff}}
:root[data-theme="dark"]{--bg:#121418;--fg:#e7e9ee;--muted:#9aa3b2;--card:#1b1e24;--line:#30353f;--stage:#2a313c;--ground:#5d6b80;--accent:#8ea8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
header h1{font-size:16px;margin:0 6px 0 0}label{display:inline-flex;gap:5px;align-items:center;color:var(--muted)}
button,select{font:inherit;padding:3px 9px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}
main{padding:12px 16px 40px;max-width:1500px;margin:0 auto}
.note{color:var(--muted);font-size:13px;margin:4px 0 0}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:14px 0}
section h2{font-size:15px;margin:0}section p{margin:2px 0 10px;color:var(--muted);font-size:12px}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.tile{display:flex;flex-direction:column;gap:4px}.tile span{font-size:12px;color:var(--muted)}
canvas{width:100%;background:var(--stage);border-radius:6px;image-rendering:pixelated}
.strip{display:none;gap:6px;flex-wrap:wrap;margin-top:8px}.strip.on{display:flex}
.strip figure{margin:0;text-align:center;font-size:11px;color:var(--muted)}.strip img{height:128px;image-rendering:pixelated;background:var(--stage);border-radius:4px}
@media (max-width:900px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body>
<header>
  <h1>Run gait review</h1>
  <label>Speed <input id="speed" type="range" min="2" max="16" step="0.5" value="11"><span id="speedOut"></span></label>
  <label>Scale <select id="scale"><option value="1">1× (about in-game)</option><option value="2" selected>2×</option><option value="3">3×</option></select></label>
  <button id="play">Pause</button><button id="step">Step</button>
  <label>In-betweens <select id="method"><option value="third" selected>pixel shift, one third</option><option value="flow">pixel shift, halfway</option><option value="dither">dither smear</option></select></label>
  <label><input type="checkbox" id="bob" checked>bob</label>
  <label><input type="checkbox" id="squash" checked>squash</label>
  <label><input type="checkbox" id="lean" checked>lean</label>
  <label><input type="checkbox" id="dust" checked>dust</label>
  <label>Polish <select id="amount"><option value="0.5">subtle</option><option value="1" selected>runtime unit</option><option value="2">strong</option></select></label>
  <label><input type="checkbox" id="frames">show frames</label>
  <button id="theme">Theme</button>
</header>
<main>
  <p class="note">Every tile uses the game's existing frames: contact A, side idle, contact B. "Polish" moves and squashes those frames at runtime in the game's 1-world-pixel units (4 sprite pixels). "In-betweens" adds two half-stride frames made by shifting the contact frames' pixels toward the side idle, giving an 8-beat cycle in the same cycle time. Speed is the game's gait beats per second (7–15 in play). The ground moves at the matching run speed.</p>
  <div id="games"></div>
</main>
<script>
const ROWS = ${JSON.stringify(rows)};
// Today's runtime: six beats, each contact held for two, side idle between.
const RUNTIME = [
  { f: 'walk1', bob: 0, squash: 0, lean: 0, dust: true },
  { f: 'walk1', bob: 0, squash: 1, lean: 0 },
  { f: 'idle', bob: 2, squash: 0, lean: 1 },
  { f: 'walk2', bob: 0, squash: 0, lean: 0, dust: true },
  { f: 'walk2', bob: 0, squash: 1, lean: 0 },
  { f: 'idle', bob: 2, squash: 0, lean: 1 },
];
// Eight beats in the same cycle time: contact, down, passing, up per leg.
const INBETWEEN = [
  { f: 'walk1', bob: 0, squash: 0, lean: 0, dust: true },
  { f: 'half1', bob: 0, squash: 1, lean: 0 },
  { f: 'idle', bob: 1, squash: 0, lean: 1 },
  { f: 'half2', bob: 2, squash: 0, lean: 1 },
  { f: 'walk2', bob: 0, squash: 0, lean: 0, dust: true },
  { f: 'half2', bob: 0, squash: 1, lean: 0 },
  { f: 'idle', bob: 1, squash: 0, lean: 1 },
  { f: 'half1', bob: 2, squash: 0, lean: 1 },
];
const KINDS = [
  { label: 'Game today (3 frames)', seq: RUNTIME, polish: false },
  { label: '+ runtime polish', seq: RUNTIME, polish: true },
  { label: '+ procedural in-betweens', seq: INBETWEEN, polish: false },
  { label: '+ both', seq: INBETWEEN, polish: true },
];
const UNIT = 4; // sprite pixels per world pixel
const RUN_PER_BEAT = 43; // sprite pixels of travel per gait beat (12 world px / 1.12)
const $ = (id) => document.getElementById(id);
let playing = true, beats = 0, last = performance.now();
const tiles = [];
function images(row) {
  const load = (src) => { const i = new Image(); i.src = src; return i; };
  const f = Object.fromEntries(Object.entries(row.frames).map(([k, v]) => [k, load(v)]));
  return f;
}
function render() {
  const root = $('games');
  for (const row of ROWS) {
    const sec = document.createElement('section');
    sec.innerHTML = '<h2></h2><p></p><div class="tiles"></div><div class="strip"></div>';
    sec.querySelector('h2').textContent = row.id;
    sec.querySelector('p').textContent = row.title;
    const imgs = images(row);
    for (const kind of KINDS) {
      const tile = document.createElement('div'); tile.className = 'tile';
      const canvas = document.createElement('canvas');
      const cap = document.createElement('span'); cap.textContent = kind.label;
      tile.append(canvas, cap); sec.querySelector('.tiles').appendChild(tile);
      tiles.push({ canvas, kind, imgs, dust: [], lastIndex: -1 });
    }
    const strip = sec.querySelector('.strip');
    for (const [name, label] of [['walk1','contact A'],['third1','one third A'],['flow1','halfway A'],['idle','side idle'],['flow2','halfway B'],['third2','one third B'],['walk2','contact B']]) {
      const fig = document.createElement('figure');
      fig.innerHTML = '<img><figcaption></figcaption>';
      fig.querySelector('img').src = row.frames[name];
      fig.querySelector('figcaption').textContent = label;
      strip.appendChild(fig);
    }
    root.appendChild(sec);
  }
}
function frameImage(t, name) {
  if (name === 'half1') return t.imgs[$('method').value + '1'];
  if (name === 'half2') return t.imgs[$('method').value + '2'];
  return t.imgs[name];
}
function draw() {
  const scale = Number($('scale').value);
  const amount = Number($('amount').value);
  for (const t of tiles) {
    const sample = t.imgs.walk1;
    if (!sample.naturalWidth) continue;
    const w = sample.naturalWidth, h = sample.naturalHeight;
    const cw = (w + 96) * scale, ch = (h + 44) * scale;
    if (t.canvas.width !== cw || t.canvas.height !== ch) { t.canvas.width = cw; t.canvas.height = ch; }
    const g = t.canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cw, ch);
    const ground = ch - 12 * scale;
    const scroll = beats * RUN_PER_BEAT * scale;
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ground');
    for (let x = -((scroll % (28 * scale)) + 28 * scale); x < cw; x += 28 * scale) g.fillRect(x, ground + 2 * scale, 14 * scale, 4 * scale);
    // Map the shared runtime clock onto this tile's cycle (same cycle time).
    const index = Math.floor((beats / 6) * t.kind.seq.length) % t.kind.seq.length;
    const beat = t.kind.seq[index];
    const on = (id) => t.kind.polish && $(id).checked;
    const left = (cw - w * scale) / 2;
    if (index !== t.lastIndex) {
      if (beat.dust && on('dust')) for (let k = 0; k < 3; k++) t.dust.push({ x: left / scale + w * 0.3 - k * 5, born: beats, rise: 1 + k });
      t.lastIndex = index;
    }
    t.dust = t.dust.filter((d) => beats - d.born < 3);
    for (const d of t.dust) {
      const age = beats - d.born;
      const size = (4 + age * 2) * scale;
      g.fillStyle = 'rgba(214,220,228,' + (0.85 * (1 - age / 3)).toFixed(3) + ')';
      g.fillRect((d.x - age * RUN_PER_BEAT * 0.5) * scale, ground - (d.rise * 3 + age * 3) * scale - size / 2, size, size);
    }
    const image = frameImage(t, beat.f);
    if (!image || !image.naturalWidth) continue;
    const bob = on('bob') ? Math.round(beat.bob * UNIT * amount / 2) : 0;
    const squash = on('squash') ? Math.round(beat.squash * UNIT * amount) : 0;
    const lean = on('lean') ? Math.round(beat.lean * 2 * amount) : 0;
    const drawH = h - squash;
    const top = ground - (drawH + bob) * scale;
    // Lean: shift the head and torso (top 45%) forward a few pixels.
    const hip = Math.round(h * 0.45);
    const k = drawH / h;
    g.drawImage(image, 0, hip, w, h - hip, left, top + hip * k * scale, w * scale, (h - hip) * k * scale);
    g.drawImage(image, 0, 0, w, hip, left + lean * scale, top, w * scale, hip * k * scale);
  }
}
function loop(now) {
  const dt = (now - last) / 1000; last = now;
  if (playing) beats += dt * Number($('speed').value);
  draw(); requestAnimationFrame(loop);
}
$('speed').oninput = () => $('speedOut').textContent = $('speed').value + '/s';
$('speed').oninput();
$('play').onclick = (e) => { playing = !playing; e.target.textContent = playing ? 'Pause' : 'Play'; };
$('step').onclick = () => { playing = false; $('play').textContent = 'Play'; beats = (Math.floor((beats / 6) * 8) + 1) * 6 / 8 + 1e-6; };
$('frames').onchange = (e) => document.querySelectorAll('.strip').forEach((s) => s.classList.toggle('on', e.target.checked));
$('theme').onclick = () => { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark'; };
render(); requestAnimationFrame(loop);
</script></body></html>`;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'review.html'), html);
console.log(
  JSON.stringify({
    out: join(out, 'review.html'),
    games: rows.length,
    sizeKb: Math.round(html.length / 1024),
  }),
);
